# PrismOS Flywheel — self-improving local LLM (prototype)

Turns your validated answers into a better personal model — **100% offline**.
See `docs/SELF_IMPROVING_LLM.md` for the architecture + the research behind it.

```
harvest.py   spectrum_graph.db (rating>0) ─▶ data/train.jsonl, valid.jsonl, prefs.jsonl
train_lora.py  MLX LoRA/QLoRA ─▶ fuse ─▶ GGUF ─▶ ollama create qwen3-prism:vN
eval_gate.py   holdout: ship ONLY if it beats the base   ◀── hard safety gate
run_flywheel.sh  orchestrates all three
```

## ⚠️ Privacy — this directory handles YOUR personal data
`data/`, `adapters/`, `fused/`, `*.gguf`, `holdout.jsonl` contain your questions/answers and
fine-tuned weights. **They are git-ignored and must NEVER be committed** (this repo is public).
Do not move them outside this folder without re-checking `.gitignore`.

## Setup (one time)
```bash
# mlx-lm needs a recent Python; if your default is 3.14 with no wheels, use a 3.11/3.12 venv:
python3.12 -m venv .venv && source .venv/bin/activate     # optional but recommended
pip install mlx-lm
# For the GGUF step on MoE models (qwen3-a3b), MLX export may be unsupported — use llama.cpp:
#   git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make
#   python convert_hf_to_gguf.py <fused-dir> --outfile model-f16.gguf
#   ./llama-quantize model-f16.gguf model-q4.gguf Q4_K_M
```

## Run
```bash
# 1) Validate the WHOLE pipeline on a tiny model first (minutes, ~1GB):
./run_flywheel.sh --smoke

# 2) Real round from a 4-bit MLX base (QLoRA, fits 64GB):
./run_flywheel.sh --base mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit \
                  --judge qwen3:32b --holdout holdout.jsonl
```

## The rules (don't skip these)
1. **Only `rating > 0` (validated) answers train** — unfiltered self-data → model collapse.
2. **Nothing ships without `eval_gate.py` passing** a holdout vs the current base.
3. **Keep the previous version** (`:vN-1`) — roll back instantly if a round regresses.
4. For **code/SAP/math** holdouts use `--exact` (ground truth) — far safer than LLM self-judging,
   which saturates after a few rounds. For market-research/innovation, gate on **human** ratings.
5. Start with **hundreds** of validated examples, not dozens — small sets overfit a 30B model.

## Status
Prototype: scripts are correct and `--smoke`-testable. A full 30B run needs `mlx-lm` installed
and a `holdout.jsonl`. Wire `run_flywheel.sh` into a monthly cron once you trust a few manual rounds.
