# PrismOS Flywheel — synthetic smoke-test prototype

The flywheel is **not currently authorized to train on PrismOS personal data**.
Full harvesting/training is disabled until the dataset and output controls below
are implemented and reviewed. Nothing runs on a schedule, and PrismOS never
promotes or changes the default model automatically.

The currently permitted path is `--smoke`: a mechanical validation using synthetic
fixtures only. It must not read `spectrum_graph.db`, `response_feedback`, Project
Knowledge, conversations, or another owner dataset.

See `docs/SELF_IMPROVING_LLM.md` for the architecture and release conditions.

```text
CURRENT
synthetic fixtures -> smoke training toolchain -> disposable smoke artifact

DISABLED
personal response_feedback -> harvest -> LoRA -> holdout -> candidate model
```

## Privacy boundary

Potential full-run inputs and outputs can contain questions, answers, source-derived
facts, personal trends, memorized secrets, and recoverable information in model
weights. Git ignore rules are not a privacy control.

Never commit or publish:

- `data/`, `holdout.jsonl`, review manifests, or extracted feedback;
- `adapters/`, `fused/`, `*.gguf`, `*.safetensors`, or candidate weights;
- a source database, audit log, device key, Private Vault, or passphrase.

Smoke fixtures must be synthetic and non-sensitive. Smoke outputs are created in
one temporary workspace, are not registered with Ollama, and are discarded after
a normal run. A force-killed process can leave operating-system temporary files,
so ordinary host cleanup and inspection still apply.

## Setup for synthetic smoke validation

Use a reviewed Python environment and locked dependencies. Installing MLX-LM or
acquiring uncached smoke-model weights can use the network; review the package,
publisher, hashes, and destination before proceeding.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install mlx-lm
./run_flywheel.sh --smoke
```

`--smoke` is a toolchain check, not evidence that training quality, privacy,
evaluation, registration, or promotion is production-ready.

## Why full training is disabled

A positive rating is not consent to use private text for model training and is not
proof that the text contains no secret, PII, proprietary code, or source-derived
material. A process-local “already running” flag also cannot prevent a second app
process or direct script invocation from training concurrently.

Full personal-data training must remain unavailable until all of these exist:

1. **Explicit dataset review and consent** — show the exact bounded examples,
   sources, purpose, base model, retention, and intended outputs before export.
2. **Secret/PII and ownership handling** — scan, redact/exclude, and let the owner
   remove individual examples; positive feedback alone is insufficient.
3. **Private output destination** — require an explicit non-public, non-Git
   destination with restrictive permissions for datasets, adapters, logs, and
   fused weights.
4. **Cross-process lock** — an OS-backed exclusive lock covering UI launches,
   multiple PrismOS processes, and direct script execution, with safe stale-lock
   recovery.
5. **Immutable review manifest** — bind the approved dataset, split, tool versions,
   base weights, evaluation set, and destination by digest.
6. **Independent evaluation and manual promotion** — deterministic references or
   blinded human review, retained prior model, and a separate promotion action.

Until those gates ship, do not run `harvest.py` against a personal database and do
not use the full-run arguments shown in older documentation.

## Evaluation limits

- Executable tests and exact references are preferred for code/math work.
- LLM-as-judge results are advisory and cannot authorize release or promotion.
- Subjective work requires blinded human review.
- Process exit success means only that the process exited successfully.
- No smoke or future full path may upload private weights to a remote Ollama daemon.

## Status

| Path | Current state |
|---|---|
| Synthetic `--smoke` | Allowed for mechanical validation only |
| Personal-data harvest | Disabled pending explicit review/consent and secret/PII controls |
| Full LoRA training | Disabled pending private destination and cross-process lock |
| Candidate evaluation | Design/prototype only; no automatic release decision |
| Model promotion | Manual future action; never performed by these scripts |
