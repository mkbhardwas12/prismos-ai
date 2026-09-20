# How PrismOS Improves — Current Capabilities and Limits

PrismOS can retrieve stored context and reuse positively rated answers in prompts.
That changes the information supplied to a model, not its weights. Neither a
stored note nor a thumbs-up establishes that an answer is correct.

## What runs in the app

1. **Context retrieval:** the Refractive Core retrieves graph nodes and selected
   positively rated examples, then adds profile guidance to the prompt.
2. **One model draft:** the standard chat workflow calls a local model. Other
   roles perform deterministic routing, context-availability and keyword-policy
   checks. They are not five independent model reviewers.
3. **Explicit uncertainty:** the answer is marked factually unvalidated. Retrieved
   sources are treated as untrusted data. New assistant-derived memories are
   marked unverified; historical memories are not retroactively fact-checked.

The checks do not verify SAP Notes, release compatibility, commands, source
accuracy, files created, or general answer correctness. More stored context can
help relevance, but can also carry outdated or incorrect material.

## What is a design, not an implemented capability

A plan–draft–critique–revise loop, multiple independent model reviewers, and
claim-to-source verification remain future work. See [the loop design](LOCAL_LOOP_ENGINE.md).
A multi-model council would still require evaluation; agreement alone would not
prove correctness. No hidden chain-of-thought is needed for useful visibility:
show source references, action results, assumptions and brief decision summaries.

## Manual model-training prototype

The scripts in [scripts/flywheel](../scripts/flywheel/README.md) can be explicitly
run for an experiment:

```text
Positive user feedback → human/source review → candidate training corpus
→ manual LoRA training → independent holdout comparison → manual promotion decision
```

The current harvester filters ratings; it does **not** perform the human/source
review in that sequence. A positive rating is preference feedback, not verified
ground truth. Training, downloads and model registration are separate operations;
the app does not automatically train, schedule experiments, or change its default
model after a rating.

The evaluation gate now fails closed on malformed test data, missing references,
invalid judge replies and invalid margins. Exact mode means normalized equality,
not substring matching. An LLM judge supplies a preference signal, not a factual
verdict. Passing a holdout is limited evidence; it does not guarantee improvement,
safety, or protection against model collapse.

## Privacy and recovery

Personal prompts, feedback corpora, adapters, weights, and evaluation data must
remain outside public source control. Git ignore rules do not encrypt files or
remove existing history. Keep independently protected backups and preserve a
known-working model/configuration before any manual switch. Dependencies or base
model downloads may use the network; local computation alone is not proof that
the complete environment is offline.

No personal corpus was harvested and no training run was performed by the
synthetic evaluation-gate tests.
