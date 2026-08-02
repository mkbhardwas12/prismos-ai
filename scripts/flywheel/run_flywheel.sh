#!/usr/bin/env bash
# run_flywheel.sh — privacy-safe synthetic smoke validation only.
#
# Product-triggered training on personal response history is disabled until the
# application has explicit dataset preview/consent, secret and PII review,
# private per-run output selection, and an OS-level cross-process lock.
set -euo pipefail
cd "$(dirname "$0")"

SMOKE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke)
      SMOKE="yes"
      shift
      ;;
    --base|--eval-base|--judge|--holdout|--name)
      echo "full personal-data training is disabled; '$1' is not accepted by this launcher"
      exit 2
      ;;
    --exact)
      echo "full personal-data training is disabled; '--exact' is not accepted by this launcher"
      exit 2
      ;;
    *)
      echo "unknown argument: $1"
      exit 2
      ;;
  esac
done

if [[ -z "$SMOKE" ]]; then
  echo "full personal-data training is disabled in this build"
  echo "use --smoke to validate the MLX/Ollama toolchain with synthetic examples only"
  exit 2
fi

if [[ -x ".venv/bin/python3" ]]; then
  PYTHON=".venv/bin/python3"
elif [[ -x ".venv/bin/python" ]]; then
  PYTHON=".venv/bin/python"
else
  echo "create scripts/flywheel/.venv and install the reviewed flywheel dependencies first"
  exit 2
fi

echo "=== [1/2] PREPARE synthetic, non-personal smoke dataset in a temporary directory ==="
echo "=== [2/2] VALIDATE LoRA -> fuse -> GGUF -> disposable Modelfile ==="
"$PYTHON" train_lora.py --smoke

echo "✅ Synthetic smoke pipeline completed; temporary artifacts were discarded."
echo "No personal feedback was read and no Ollama model was registered or promoted."
