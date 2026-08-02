# How PrismOS Improves Answers Without Autonomous Training

> **Current implementation status (August 2026):** local retrieval, positive-
> response few-shot use, cognitive-profile updates, and a bounded sequential
> **plan → build → judge → refine** answer loop are live. Personal-data model
> training is disabled. Only synthetic smoke validation is currently permitted.

PrismOS improves the current experience at two live timescales. A third,
weight-changing layer remains gated.

```text
                 CURRENT
question -> 1. local retrieval and approved knowledge -> better context
         -> 2. sequential plan/build/judge/refine     -> better candidate answer

                 DISABLED FOR PERSONAL DATA
feedback -> reviewed/consented dataset -> LoRA -> holdout -> manual promotion

                 ALLOWED VALIDATION
synthetic fixtures -> smoke toolchain check -> disposable smoke artifact
```

## 1. Retrieval and local adaptation — live

Each query can retrieve relevant Spectrum Graph nodes, recent context, and highly
rated prior examples, then apply local response preferences. This changes prompt
context, not model weights. Approved Project Knowledge remains source-owned and
portable exports omit its managed excerpts.

A thumbs-up can affect future few-shot selection and profile statistics. It is not
consent to export the prompt/answer into a fine-tuning dataset.

## 2. Bounded response loop — live

For eligible open-ended requests, PrismOS runs in sequence:

1. Planner derives bounded acceptance criteria.
2. Reasoner builds one candidate.
3. Sentinel applies a policy veto and the Critic scores the candidate.
4. Bounded deficiencies can drive another build while the score improves.
5. PrismOS returns the accepted or best-so-far candidate.

Planner, Reasoner, and Critic may route to different installed models, but their
calls are serialized. Deterministic role traces, debate text, and vote records are
not independent parallel agents. The loop refines text; it does not authorize
filesystem, network, or tool actions.

See [Local Loop Engine](LOCAL_LOOP_ENGINE.md).

## 3. Model flywheel — personal-data path disabled

The repository contains a LoRA research prototype, but a full run over personal
`response_feedback` is currently disabled. Positive ratings alone do not establish
dataset consent or filter secrets, PII, proprietary material, or source-derived
content. Fine-tuned weights can memorize those inputs.

Before a personal-data run can be enabled, PrismOS needs:

- explicit preview, example-level review, and separate training consent;
- secret/PII/ownership handling with removals and a bound dataset manifest;
- an explicit private output destination with restrictive permissions;
- an OS-backed cross-process lock covering UI, backend, and direct scripts;
- independent holdout evaluation and separate manual promotion.

The only currently allowed flywheel operation is a smoke validation on synthetic,
non-sensitive fixtures. Smoke must not read the application database or Project
Knowledge and does not prove that a candidate is useful or safe.

See [Answer Improvement and Gated Training Research](SELF_IMPROVING_LLM.md) and
[`scripts/flywheel/README.md`](../scripts/flywheel/README.md).

## Status

| Layer | State |
|---|---|
| Local RAG and highly rated few-shot retrieval | Live |
| Cognitive/profile adaptation | Live |
| Bounded Planner/Reasoner/Critic loop | Live and sequential |
| Parallel multi-model Council | Not implemented |
| Synthetic flywheel smoke validation | Allowed for mechanical testing only |
| Personal-data harvest and full LoRA training | Disabled pending consent/security controls |
| Automatic scheduling or model promotion | Not implemented and not authorized |

## Honest limits

- Retrieved context and LLM judgment remain fallible; citations, executable tests,
  and human review are stronger evidence.
- Local execution does not erase privacy risk. The live SQLite database is plaintext
  to the OS account, model weights may memorize data, and downloads can use the network.
- Base-weight/dependency acquisition can reach external registries.
- Process exit success is not an evaluation result.
- Keep all personal datasets, adapters, logs, and weights out of the public repository.
