#!/usr/bin/env python3
"""
train_lora.py — MLX-LM LoRA fine-tune → fuse → GGUF → Ollama Modelfile.

The "retrain" step of the PrismOS flywheel. Runs 100% locally on Apple Silicon.

IMPORTANT — train from HF/MLX weights, NOT the Ollama GGUF:
  MLX cannot fine-tune a GGUF. Pass an HF repo or a local MLX model as --base, e.g.
  an mlx-community quantized build (auto-uses QLoRA), then we convert the RESULT back
  to GGUF for Ollama.

Pipeline:
  1. mlx_lm.lora  --train  (LoRA adapters; QLoRA auto-selected if --base is quantized)
  2. mlx_lm.fuse           (merge adapters into the base weights)
  3. -> GGUF               (mlx_lm.fuse --export-gguf, else llama.cpp fallback — see README)
  4. ollama create qwen3-prism:vN -f Modelfile

Examples:
  # Validate the WHOLE pipeline fast on a tiny model before committing to 30B:
  python3 train_lora.py --smoke
  # Real run from a 4-bit MLX base (QLoRA), modest iters:
  python3 train_lora.py --base mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit \\
      --data ./data --iters 400 --batch-size 1 --num-layers 8 --name qwen3-prism
"""
import argparse
import os
import shlex
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SMOKE_BASE = "mlx-community/Qwen2.5-0.5B-Instruct-4bit"  # tiny: proves the pipeline in minutes


def run(cmd, **kw):
    print(f"\n$ {' '.join(shlex.quote(c) for c in cmd)}")
    return subprocess.run(cmd, check=True, **kw)


def have(mod):
    return subprocess.run([sys.executable, "-c", f"import {mod}"],
                          capture_output=True).returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=None,
                    help="HF repo or local MLX model dir (NOT a .gguf). "
                         "Prefer a 4-bit mlx-community build → QLoRA.")
    ap.add_argument("--data", default=os.path.join(HERE, "data"),
                    help="dir with train.jsonl / valid.jsonl from harvest.py")
    ap.add_argument("--adapter-path", default=os.path.join(HERE, "adapters"))
    ap.add_argument("--fused-path", default=os.path.join(HERE, "fused"))
    ap.add_argument("--name", default="qwen3-prism", help="Ollama model name (gets :vN tag)")
    ap.add_argument("--version", default=None, help="override the vN tag (default: timestamp)")
    ap.add_argument("--iters", type=int, default=400)
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--num-layers", type=int, default=8, help="# layers to apply LoRA to")
    ap.add_argument("--learning-rate", type=float, default=1e-5)
    ap.add_argument("--smoke", action="store_true",
                    help="tiny base + few iters: validate the pipeline end-to-end fast")
    ap.add_argument("--no-gguf", action="store_true",
                    help="stop after fuse (skip GGUF/Ollama); useful for testing")
    args = ap.parse_args()

    if not have("mlx_lm"):
        sys.exit("[train] mlx-lm not installed. See scripts/flywheel/README.md "
                 "(pip install mlx-lm; consider a Python 3.11/3.12 venv if 3.14 has no wheels).")

    base = args.base or (SMOKE_BASE if args.smoke else None)
    if not base:
        sys.exit("[train] provide --base (HF repo / local MLX dir), or use --smoke.")
    iters = 30 if args.smoke else args.iters
    name = ("qwen-smoke" if args.smoke else args.name)
    version = args.version or ("smoke" if args.smoke else f"v{time.strftime('%Y%m%d-%H%M', time.localtime())}")
    tag = f"{name}:{version}"

    for f in ("train.jsonl", "valid.jsonl"):
        if not os.path.exists(os.path.join(args.data, f)):
            sys.exit(f"[train] missing {f} in {args.data}. Run harvest.py first.")

    # 1) LoRA / QLoRA training (QLoRA auto-selected when --model is quantized).
    run([sys.executable, "-m", "mlx_lm.lora",
         "--model", base, "--train",
         "--data", args.data,
         "--fine-tune-type", "lora",
         "--iters", str(iters),
         "--batch-size", str(args.batch_size),
         "--num-layers", str(args.num_layers),
         "--learning-rate", str(args.learning_rate),
         "--adapter-path", args.adapter_path])

    # 2) Fuse adapters into the base weights.
    fuse_cmd = [sys.executable, "-m", "mlx_lm.fuse",
                "--model", base,
                "--adapter-path", args.adapter_path,
                "--save-path", args.fused_path]
    run(fuse_cmd)
    print(f"[train] fused model -> {args.fused_path}")

    if args.no_gguf:
        print("[train] --no-gguf set; stopping before GGUF/Ollama.")
        return

    # 3) Export to GGUF. MLX can export GGUF for some architectures; MoE (qwen3-a3b)
    #    is often unsupported -> fall back to llama.cpp (documented in README).
    gguf = os.path.join(args.fused_path, "model-f16.gguf")
    try:
        run([sys.executable, "-m", "mlx_lm.fuse",
             "--model", base, "--adapter-path", args.adapter_path,
             "--save-path", args.fused_path, "--export-gguf"])
        # mlx exports as ggml-model-*.gguf inside save-path
        cand = [f for f in os.listdir(args.fused_path) if f.endswith(".gguf")]
        if cand:
            gguf = os.path.join(args.fused_path, cand[0])
    except subprocess.CalledProcessError:
        print("[train] MLX GGUF export failed (expected for some MoE archs). "
              "Use the llama.cpp fallback in README.md:\n"
              "  python convert_hf_to_gguf.py <fused> --outfile model-f16.gguf\n"
              "  ./llama-quantize model-f16.gguf model-q4.gguf Q4_K_M\n"
              "then re-run with --gguf <path> (or hand-build the Modelfile).")
        sys.exit(2)

    # 4) Ollama Modelfile + create.
    modelfile = os.path.join(args.fused_path, "Modelfile")
    with open(modelfile, "w") as f:
        f.write(f"FROM {gguf}\n")
        # qwen3 thinking models: keep the loop's /no_think discipline available downstream.
        f.write('PARAMETER temperature 0.6\n')
        f.write('PARAMETER num_ctx 8192\n')
    run(["ollama", "create", tag, "-f", modelfile])
    print(f"\n[train] ✅ created Ollama model: {tag}")
    print(f"[train] NEXT: gate it before shipping ->\n"
          f"  python3 eval_gate.py --candidate {tag} --base <current-default-model>")


if __name__ == "__main__":
    main()
