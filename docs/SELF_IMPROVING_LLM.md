# Personal Model Training — Experimental Design

This is a manual training prototype, not an autonomous self-improving system.
The app does not automatically train models, verify factual answers, or promote
a new default. Positive user feedback means a response was preferred; it is not
a factual-verification record.

## Current implementation

| Component | Actual behavior |
|---|---|
| Chat workflow | One model draft plus deterministic workflow/policy checks; facts remain unvalidated |
| `harvest.py` | Reads response feedback and exports positively rated examples plus optional preference pairs |
| `train_lora.py` | Explicitly invoked MLX training, conversion and candidate registration workflow |
| `eval_gate.py` | Compares candidate/base answers on a supplied holdout; never changes the app default |
| `run_flywheel.sh` | Manual wrapper for these operations; not a scheduler or auto-promotion mechanism |

The harvester does not validate the source, accuracy, safety, permission, or
training suitability of an answer. Review and curate its output before training.
Do not treat cached assistant answers as authoritative technical knowledge.

## Proposed review-gated lifecycle

1. Collect feedback while preserving its provenance and uncertainty.
2. Review facts against authoritative sources and exclude sensitive or unsuitable
   material before approving a candidate corpus.
3. Keep an independent holdout separate from training and validation splits.
4. Explicitly choose a training run and a distinct candidate model tag.
5. Compare with the actual currently deployed base; inspect important task
   regressions as well as aggregate scores.
6. Manually decide whether to promote. Retain the old model, configuration and
   recovery instructions.

Steps involving source validation, independent reviewers and automatic curation
are requirements for a future design, not claims about current implementation.

## Evaluation contract

Choose exactly one scoring mode:

- `--exact`: case/whitespace-normalized **equality** to a non-empty reviewed
  reference. Extra contradictory text is a mismatch. Use for narrowly defined
  short answers; it does not execute code or validate a SAP procedure.
- `--judge MODEL`: a model compares anonymous answers. Only the complete tokens
  `A`, `B`, or `TIE` are accepted. The result is a preference signal, not proof
  of factual accuracy.

The entire holdout is checked before inference. Missing/empty test data,
malformed rows, empty exact references, malformed judge output, and incomplete
model responses cannot pass. The promotion margin must be finite and
nonnegative, and candidate score must exceed base score plus that margin.
Exit codes are `0` for comparison passed, `1` for NO-SHIP, and `2` for invalid
or incomplete evaluation. No exit code changes the app's model selection.

A passing holdout does not establish general correctness, statistical
significance, privacy, or protection against model collapse. Test-set leakage,
unrepresentative samples, correlated judge errors and preference bias remain
risks. Keep independent domain review and operational tests where needed.

## Private data and model artifacts

Feedback text, datasets, adapters, fused models and trained weights can contain
or encode personal information. Keep them out of the public repository and
public model registries. Ignore rules are not encryption, access control, or
backup. Use separately protected storage and a tested restoration process.

Dependencies and base-model acquisition may require network downloads. Local
training/evaluation do not attest that the full environment is offline. The
synthetic gate tests use mocks and temporary synthetic files only; they do not
read the private database, call a model, train, or publish anything.

See [the prototype guide](../scripts/flywheel/README.md) for manual commands and
[the proposed response-loop design](LOCAL_LOOP_ENGINE.md) for future work.
