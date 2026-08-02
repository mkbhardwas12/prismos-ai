# PrismOS Answer Improvement and Gated Training Research

> **Current status (August 2026):** production chat has a bounded sequential
> Planner/Reasoner/Critic answer loop. Weight-level personal-data training is
> disabled. The flywheel currently permits synthetic smoke validation only and
> never promotes a model.

PrismOS does not autonomously train, schedule a training job, change the default
model, or roll back model weights. It also does not run a true parallel model
Council. Quality improvement is an evaluation goal, not a guarantee.

## What is live

The shipped answer path can improve a response without changing model weights:

```text
local retrieval -> bounded plan -> build -> policy gate -> judge -> optional refine
```

Positive feedback can influence local few-shot retrieval and profile adaptation.
That immediate personalization stays in the local Spectrum Graph. A rating does
not authorize export into a training dataset.

## Current flywheel boundary

```text
CURRENT
synthetic non-sensitive fixtures -> smoke toolchain validation -> disposable artifact

DISABLED
personal feedback -> reviewed dataset -> LoRA -> holdout -> candidate -> manual promotion
```

The smoke path must be synthetic and must not read conversations,
`response_feedback`, Project Knowledge, a Private Vault, or another local corpus.
Its purpose is to check tool availability and mechanical wiring on a small model.
Dependencies and uncached base weights may be downloaded, so smoke is not
necessarily offline.

## Why personal-data training is disabled

The local feedback table may contain private prompts, responses, project-derived
facts, names, identifiers, credentials, regulated data, or copyrighted material.
Fine-tuned weights can memorize and reproduce training content. Selecting a thumbs-up
does not establish consent, ownership, correctness, or absence of secrets.

The current process-local concurrency guard is also insufficient for a sensitive
training system: it cannot coordinate multiple PrismOS processes and direct script
invocations. A full path needs an OS-backed cross-process lock.

## Gates required before a full run

1. **Explicit consent and bounded preview**
   - Show every proposed example or an auditable bounded review set.
   - State purpose, model, retention, destination, and expected artifacts.
   - Require a separate training approval; chat feedback is not approval.
2. **Secret, PII, and ownership review**
   - Scan and redact/exclude credentials, private identifiers, proprietary/source
     material, and disallowed data.
   - Let the owner remove examples and re-run the manifest before training.
3. **Private output destination**
   - Require an explicit path outside the public source worktree and public build
     artifacts.
   - Apply restrictive permissions to datasets, logs, adapters, and fused weights.
4. **Cross-process exclusivity**
   - Use an OS-backed lock acquired by UI, backend, and scripts.
   - Define safe stale-lock detection and cleanup.
5. **Immutable provenance**
   - Hash the approved examples, split, holdout, base weights, tool versions,
     parameters, and destination into a review manifest.
6. **Independent evaluation**
   - Prefer executable tests or exact references.
   - Use blinded human review for subjective work.
   - Treat an LLM judge as advisory only.
7. **Manual promotion and rollback**
   - Keep the prior known-good model.
   - Separate training, evaluation, and promotion authority.

## Proposed toolchain, not a current authorization

The source tree contains research/prototype components:

| Component | Intended role | Current authorization |
|---|---|---|
| `run_flywheel.sh --smoke` | Synthetic mechanical validation | Allowed |
| `harvest.py` | Build SFT/preference data from reviewed feedback | Personal use disabled |
| `train_lora.py` | MLX-LM LoRA/QLoRA training and candidate packaging | Full use disabled |
| `eval_gate.py` | Compare candidate and base on a holdout | Advisory; no deployment action |
| PrismOS launcher | Start one explicitly requested process | Full mode disabled |

Older examples showing direct full-run commands are intentionally retired. Do not
run the harvester against a personal `spectrum_graph.db` until the gates above are
implemented.

## Evaluation policy

Training repeatedly on unfiltered generated data can degrade a model. Even after
full training is enabled, an in-chat Critic score or thumbs-up cannot be the only
quality gate.

| Domain | Stronger evaluation signal |
|---|---|
| Code, configuration, math | Executable tests, type checks, exact references |
| Technical explanation | Held-out references plus expert review |
| Market research and innovation | Time-bounded sources and blinded human review |
| Personal style | Explicit owner review with privacy/memorization checks |

Process success only means the training/evaluation process terminated as reported;
it does not mean the candidate beat the base or is safe to promote.

## Data and network boundaries

- Personal databases, datasets, holdouts, adapters, weights, and logs must never be
  committed to the public repository.
- Encrypted Private Vault packages are recovery candidates, not training inputs;
  complete a clean-profile restore drill before relying on one.
- Dataset and model artifacts require a separate private backup/retention policy.
- Base-model and dependency acquisition can reach external registries.
- Candidate registration and evaluation must remain on a numeric loopback Ollama
  endpoint unless a separately reviewed private deployment exists.
- A remote endpoint or private Git repository does not remove consent, licensing,
  PII, or memorization risk.

## Research context

LoRA/QLoRA and verifier-grounded fine-tuning can be useful, but published results do
not establish that a personal-data loop is safe or will improve this application.
Relevant background includes Think-Prune-Train, V-STaR, Self-Rewarding LMs,
model-collapse research, and the MLX-LM/PEFT documentation. Treat those sources as
design inputs, not evidence that the disabled production gate may be bypassed.
