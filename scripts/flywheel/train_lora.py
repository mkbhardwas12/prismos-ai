#!/usr/bin/env python3
"""
train_lora.py — MLX-LM LoRA fine-tune → fuse → GGUF → Ollama Modelfile.

Synthetic MLX toolchain validation. Compute is launched locally on Apple
Silicon. The tiny base may be downloaded when it is not already cached. Generated
datasets, adapters, fused weights, GGUF, and Modelfile stay in one temporary
workspace and are deleted when the process exits normally.

Synthetic smoke pipeline:
  1. mlx_lm.lora  --train  (LoRA adapters; QLoRA auto-selected if --base is quantized)
  2. mlx_lm.fuse           (merge adapters into the base weights)
  3. -> GGUF               (mlx_lm.fuse --export-gguf, else llama.cpp fallback — see README)
  4. write a disposable Modelfile beside the temporary GGUF

Usage:
  python3 train_lora.py --smoke

Every non-smoke invocation fails closed until consent, secret/PII review,
private-output manifests, and OS-level cross-process locking are implemented.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

SMOKE_BASE = "mlx-community/Qwen2.5-0.5B-Instruct-4bit"  # tiny: proves the pipeline in minutes


def run(cmd, **kw):
    print(f"\n$ {' '.join(shlex.quote(c) for c in cmd)}")
    return subprocess.run(cmd, check=True, **kw)


def have(mod):
    return subprocess.run([sys.executable, "-c", f"import {mod}"],
                          capture_output=True).returncode == 0


def write_synthetic_smoke_data(directory):
    """Create generic examples that contain no PrismOS/user history."""
    directory.mkdir(parents=True, exist_ok=True)
    examples = [
        ("Return the word blue.", "blue"),
        ("What is two plus two?", "Four."),
        ("Name one primary color.", "Red."),
        ("Finish: water freezes at zero degrees ___.", "Celsius."),
        ("Reply with a short greeting.", "Hello!"),
        ("What comes after Monday?", "Tuesday."),
        ("Is a triangle a three-sided shape?", "Yes."),
        ("Give one synonym for quick.", "Fast."),
    ]
    records = [
        {"messages": [
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer},
        ]}
        for question, answer in examples
    ]
    for name, rows in (("train.jsonl", records[:-2]), ("valid.jsonl", records[-2:])):
        with (directory / name).open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=400)
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--num-layers", type=int, default=8, help="# layers to apply LoRA to")
    ap.add_argument("--learning-rate", type=float, default=1e-5)
    ap.add_argument("--smoke", action="store_true",
                    help="tiny base + few iters: validate the pipeline end-to-end fast")
    ap.add_argument("--no-gguf", action="store_true",
                    help="stop after fuse (skip GGUF/Ollama); useful for testing")
    args = ap.parse_args()

    if not args.smoke:
        sys.exit(
            "[train] full personal-data training is disabled until dataset preview/consent, "
            "secret and PII review, private output manifests, and an OS-level cross-process lock ship."
        )

    if not have("mlx_lm"):
        sys.exit("[train] mlx-lm not installed. See scripts/flywheel/README.md "
                 "(pip install mlx-lm; consider a Python 3.11/3.12 venv if 3.14 has no wheels).")

    base = SMOKE_BASE
    iters = 30
    temporary_workspace = tempfile.TemporaryDirectory(prefix="prismos-flywheel-smoke-")
    private_root = Path(temporary_workspace.name)
    data_path = private_root / "data"
    adapter_path = private_root / "adapters"
    fused_path = private_root / "fused"
    write_synthetic_smoke_data(data_path)
    print(f"[train] synthetic smoke workspace -> {private_root}")

    for f in ("train.jsonl", "valid.jsonl"):
        if not (data_path / f).is_file():
            sys.exit(f"[train] missing {f} in {data_path}.")

    # 1) LoRA / QLoRA training (QLoRA auto-selected when --model is quantized).
    run([sys.executable, "-m", "mlx_lm.lora",
         "--model", base, "--train",
         "--data", str(data_path),
         "--fine-tune-type", "lora",
         "--iters", str(iters),
         "--batch-size", str(args.batch_size),
         "--num-layers", str(args.num_layers),
         "--learning-rate", str(args.learning_rate),
         "--adapter-path", str(adapter_path)])

    # 2) Fuse adapters into the base weights.
    fuse_cmd = [sys.executable, "-m", "mlx_lm.fuse",
                "--model", base,
                "--adapter-path", str(adapter_path),
                "--save-path", str(fused_path)]
    run(fuse_cmd)
    print(f"[train] fused model -> {fused_path}")

    if args.no_gguf:
        print("[train] --no-gguf set; stopping before GGUF/Ollama.")
        return

    # 3) Export to GGUF. MLX can export GGUF for some architectures; MoE (qwen3-a3b)
    #    is often unsupported -> fall back to llama.cpp (documented in README).
    gguf = os.path.join(fused_path, "model-f16.gguf")
    try:
        run([sys.executable, "-m", "mlx_lm.fuse",
             "--model", base, "--adapter-path", str(adapter_path),
             "--save-path", str(fused_path), "--export-gguf"])
        # mlx exports as ggml-model-*.gguf inside save-path
        cand = [f for f in os.listdir(fused_path) if f.endswith(".gguf")]
        if cand:
            gguf = os.path.join(fused_path, cand[0])
    except subprocess.CalledProcessError:
        print("[train] MLX GGUF export failed (expected for some MoE archs). "
              "Use the llama.cpp fallback in README.md:\n"
              "  python convert_hf_to_gguf.py <fused> --outfile model-f16.gguf\n"
              "  ./llama-quantize model-f16.gguf model-q4.gguf Q4_K_M\n"
              "then re-run with --gguf <path> (or hand-build the Modelfile).")
        sys.exit(2)

    # 4) Write a disposable Ollama-compatible Modelfile. Do not register a model:
    # smoke validation must not leave persistent daemon state behind.
    modelfile = os.path.join(fused_path, "Modelfile")
    with open(modelfile, "w") as f:
        f.write(f"FROM {gguf}\n")
        # qwen3 thinking models: keep the loop's /no_think discipline available downstream.
        f.write('PARAMETER temperature 0.6\n')
        f.write('PARAMETER num_ctx 8192\n')
    print(f"\n[train] ✅ wrote temporary GGUF + Modelfile under: {private_root}")
    print("[train] No Ollama model was registered or promoted; temporary outputs are now discarded.")


if __name__ == "__main__":
    main()
