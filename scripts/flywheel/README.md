# PrismOS Flywheel — self-improving local LLM (prototype)

Manual, experimental tools for turning reviewed user feedback into a candidate
personal model. Positive ratings are **preferences, not factual validation**;
improvement is not guaranteed. See `docs/SELF_IMPROVING_LLM.md` for the design.

```
harvest.py   spectrum_graph.db (rating>0) ─▶ data/train.jsonl, valid.jsonl, prefs.jsonl
train_lora.py  MLX LoRA/QLoRA ─▶ fuse ─▶ GGUF ─▶ ollama create qwen3-prism:vN
eval_gate.py   holdout comparison → eligible for manual review, or NO-SHIP
run_flywheel.sh  manually invoked wrapper; never changes the app default
```

## ⚠️ Privacy — this directory handles YOUR personal data
`data/`, `adapters/`, `fused/`, `*.gguf`, `holdout.jsonl` contain your questions/answers and
fine-tuned weights. **They are git-ignored and must NEVER be committed** (this repo is public).
Do not move them outside this folder without re-checking `.gitignore`.
Ignore rules are not encryption or a backup. Review existing tracked files and
keep private exports/weights in separately protected storage. Dependencies and
base-model downloads may use the network; local training does not itself prove
an offline environment.

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
# 1) Optional, explicitly chosen small-model training experiment:
# This reads real feedback and writes private data/weights. It is NOT a dry run.
./run_flywheel.sh --smoke --eval-base CURRENT_OLLAMA_MODEL

# 2) Real round from a 4-bit MLX base (QLoRA, fits 64GB):
./run_flywheel.sh --base mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit \
                  --eval-base CURRENT_OLLAMA_MODEL --judge qwen3:32b --holdout holdout.jsonl
```

Replace `CURRENT_OLLAMA_MODEL` with the exact model:tag you intend to compare
against (normally the app's current selected model). `--base` supplies training
weights; `--eval-base` supplies the separate Ollama evaluation baseline. There is
no implicit evaluation default. Missing `--eval-base` fails before harvesting or
training. Check parsing safely with `--help` or, for example:

```bash
./run_flywheel.sh --smoke --eval-base CURRENT_OLLAMA_MODEL --check-args
```

`--check-args` validates arguments only; it does not read feedback, validate
holdout contents, contact models, or start training.

## The rules (don't skip these)
1. **Review feedback examples before training.** `rating > 0` is a user preference;
   the harvester does not verify factual accuracy or filter all sensitive material.
2. Keep a representative, independently reviewed holdout separate from training
   and validation data. A small or contaminated test set can give false confidence.
3. Run `eval_gate.py` against the **actual current base**, then manually inspect
   failures, regressions and privacy before deciding whether to change the default.
4. `--exact` accepts only normalized equality (case and whitespace ignored), with
   non-empty reviewed references. It is not a code executor, SAP procedure
   verifier, semantic checker, or replacement for operational testing.
5. `--judge MODEL` is a model preference signal, not independent fact verification.
   Only exact `A`, `B`, or `TIE` responses count; malformed results abort the gate.
6. Keep the previous working model and its configuration. The scripts do not
   automatically back up, restore, validate, schedule training, or promote models.

The promotion margin must be finite and nonnegative. Exit code `0` means the
comparison passed the margin, `1` means NO-SHIP, and `2` means invalid/incomplete
evaluation. Missing/empty holdouts, malformed rows, missing exact references,
truncated model completions and malformed judges cannot pass. Passing does not
guarantee general correctness or prevent model collapse.

Run the **offline synthetic tests** without reading personal data or training:

```bash
python3 -B -m unittest discover -s scripts/flywheel -p 'test_*.py' -v
```

## Status
Prototype: no automatic training, model promotion, or independent answer
validation is wired into the app. Unit tests verify gate logic, not training
quality. A training run remains an explicit manual action requiring reviewed
private data, installed dependencies, sufficient hardware, and an independent
holdout. No schedule is created by these scripts.
