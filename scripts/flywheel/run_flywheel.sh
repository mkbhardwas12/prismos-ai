#!/usr/bin/env bash
# run_flywheel.sh — one self-improvement round, end to end, 100% local.
#   harvest positive feedback -> LoRA fine-tune -> holdout comparison -> manual review
#
# A passing comparison is not factual validation or a safety guarantee.
# This script never changes the app's default model; retain prior versions yourself.
#
# Usage:
#   ./run_flywheel.sh --smoke --eval-base CURRENT_MODEL  # explicit training experiment
#   ./run_flywheel.sh --base mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit \
#                     --eval-base CURRENT_MODEL --judge qwen3:32b --holdout holdout.jsonl
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "Usage: run_flywheel.sh (--smoke | --base MLX_BASE) --eval-base OLLAMA_MODEL [options]"
  echo "  --base MLX_BASE          Training weights (MLX path or repository), not the evaluation base"
  echo "  --eval-base MODEL       Required: exact currently intended Ollama baseline model:tag"
  echo "  --smoke                 Small-model training experiment; still reads private feedback"
  echo "  --judge MODEL           Local comparison judge (default: qwen3:32b)"
  echo "  --holdout FILE          Independent holdout JSONL (default: holdout.jsonl)"
  echo "  --name NAME             Candidate model name (default: qwen3-prism)"
  echo "  --check-args            Validate arguments only; no data read, model calls, or training"
  echo "  --help                  Show this help; no data read, model calls, or training"
}

require_value() {
  local flywheel_arg_value="${2-}"
  if [[ $# -lt 2 || -z "${flywheel_arg_value//[[:space:]]/}" || "$flywheel_arg_value" == --* ]]; then
    echo "Missing value for $1" >&2
    exit 2
  fi
}

SMOKE=""; BASE=""; EVAL_BASE=""; CHECK_ARGS=""; JUDGE="qwen3:32b"; HOLDOUT="holdout.jsonl"; NAME="qwen3-prism"
while [[ $# -gt 0 ]]; do case "$1" in
  --smoke)   SMOKE="--smoke"; NAME="qwen-smoke"; shift;;
  --base)    require_value "$@"; BASE="$2"; shift 2;;
  --eval-base) require_value "$@"; EVAL_BASE="$2"; shift 2;;
  --judge)   require_value "$@"; JUDGE="$2"; shift 2;;
  --holdout) require_value "$@"; HOLDOUT="$2"; shift 2;;
  --name)    require_value "$@"; NAME="$2"; shift 2;;
  --check-args) CHECK_ARGS="1"; shift;;
  --help|-h) usage; exit 0;;
  *) echo "Unknown argument: $1" >&2; exit 2;;
esac; done

# Fail before harvesting feedback or starting training. An MLX repository is
# not an Ollama tag, and the script cannot infer the app's selected baseline.
if [[ -z "$EVAL_BASE" ]]; then
  echo "Required: --eval-base OLLAMA_MODEL (the baseline you intend to compare against). Nothing harvested or trained." >&2
  exit 2
fi
if [[ -z "$SMOKE" && -z "$BASE" ]]; then
  echo "Required: --base MLX_BASE or --smoke. Training and evaluation bases are distinct. Nothing harvested or trained." >&2
  exit 2
fi
if [[ -n "$CHECK_ARGS" ]]; then
  echo "Arguments valid. Evaluation base: $EVAL_BASE"
  echo "No data read, model calls, training, or promotion performed."
  exit 0
fi

echo "=== [1/3] HARVEST positive user feedback (not fact-validated) ==="
python3 harvest.py --prefs

echo "=== [2/3] TRAIN LoRA -> fuse -> GGUF -> ollama create ==="
if [[ -n "$SMOKE" ]]; then
  python3 train_lora.py --smoke
  TAG="qwen-smoke:smoke"
else
  STAMP="v$(date +%Y%m%d-%H%M)"
  python3 train_lora.py --base "$BASE" --name "$NAME" --version "${STAMP#v}"
  TAG="$NAME:$STAMP"
fi

echo "=== [3/3] EVAL GATE (holdout) — ship only if it beats the base ==="
# For verifiable holdouts add --exact instead of --judge.
if [[ -f "$HOLDOUT" ]]; then
  if python3 eval_gate.py --candidate "$TAG" --base "$EVAL_BASE" --holdout "$HOLDOUT" --judge "$JUDGE"; then
    echo "SHIP-ELIGIBLE: '$TAG' passed this comparison. Review results against your actual default before any manual promotion; keep the previous version."
  else
    echo "🛑 NO-SHIP: '$TAG' did not beat the base. Keeping current default. (Roll back: nothing changed.)"
  fi
else
  echo "⚠️  No holdout set ($HOLDOUT). Created '$TAG' but DID NOT ship it — never promote an unevaluated model."
  echo "    Make a holdout.jsonl of {\"question\": \"...\"} lines and re-run the gate."
fi
