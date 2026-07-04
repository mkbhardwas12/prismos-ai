#!/usr/bin/env bash
# run_flywheel.sh — one self-improvement round, end to end, 100% local.
#   harvest validated answers -> LoRA fine-tune -> holdout eval gate -> (ship | discard)
#
# A bad round CANNOT ship: eval_gate.py is the hard gate. Keeps N-1 for rollback.
#
# Usage:
#   ./run_flywheel.sh --smoke                      # validate the whole pipeline fast
#   ./run_flywheel.sh --base mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit \
#                     --judge qwen3:32b --holdout holdout.jsonl
set -euo pipefail
cd "$(dirname "$0")"

SMOKE=""; BASE=""; JUDGE="qwen3:32b"; HOLDOUT="holdout.jsonl"; NAME="qwen3-prism"
while [[ $# -gt 0 ]]; do case "$1" in
  --smoke)   SMOKE="--smoke"; NAME="qwen-smoke"; shift;;
  --base)    BASE="$2"; shift 2;;
  --judge)   JUDGE="$2"; shift 2;;
  --holdout) HOLDOUT="$2"; shift 2;;
  --name)    NAME="$2"; shift 2;;
  *) echo "unknown arg: $1"; exit 1;;
esac; done

echo "=== [1/3] HARVEST validated answers from spectrum_graph.db ==="
python3 harvest.py --prefs

echo "=== [2/3] TRAIN LoRA -> fuse -> GGUF -> ollama create ==="
if [[ -n "$SMOKE" ]]; then
  python3 train_lora.py --smoke
  TAG="qwen-smoke:smoke"
else
  [[ -z "$BASE" ]] && { echo "provide --base (HF/MLX repo, e.g. mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit)"; exit 1; }
  STAMP="v$(date +%Y%m%d-%H%M)"
  python3 train_lora.py --base "$BASE" --name "$NAME" --version "${STAMP#v}"
  TAG="$NAME:$STAMP"
fi

echo "=== [3/3] EVAL GATE (holdout) — ship only if it beats the base ==="
CUR_DEFAULT="${BASE:-qwen3:30b-a3b}"
# For verifiable holdouts add --exact instead of --judge.
if [[ -f "$HOLDOUT" ]]; then
  if python3 eval_gate.py --candidate "$TAG" --base "qwen3:30b-a3b" --holdout "$HOLDOUT" --judge "$JUDGE"; then
    echo "✅ SHIP: '$TAG' beat the base. Set it as Default Model in PrismOS; keep the previous version for rollback."
  else
    echo "🛑 NO-SHIP: '$TAG' did not beat the base. Keeping current default. (Roll back: nothing changed.)"
  fi
else
  echo "⚠️  No holdout set ($HOLDOUT). Created '$TAG' but DID NOT ship it — never promote an unevaluated model."
  echo "    Make a holdout.jsonl of {\"question\": \"...\"} lines and re-run the gate."
fi
