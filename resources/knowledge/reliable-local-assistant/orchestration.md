# Bounded parallel orchestration and truthful activity reporting

Reviewed: 2026-09-08. Classification: public technical reference.

Ollama supports tool-calling workflows in which a model requests named tools, the application executes approved calls, and results are returned to the model. Its documentation includes parallel calls and iterative loops. These are capabilities an application must implement; naming several workflow roles does not create independent model workers. [Source: Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)

An orchestration design needs explicit inputs and outputs, task ownership, time and token budgets, concurrency limits, cancellation, maximum iterations, error propagation, and acceptance checks. Parallelize independent read-only subtasks. Serialize conflicting writes or use transactions. Retries must respect idempotency; replaying an entire state-changing pipeline can duplicate work.

Activity logs should show assigned task, current phase, actual tool or model, elapsed time, source references, concise findings, and next dependency. Deterministic policy checks must be labeled as such, not presented as conversations or factual reviews by independent experts.

A critic can identify omissions but is not automatically correct. Correlated errors are likely when the same model reviews its own answer using the same evidence. Expensive model launches, downloads, training, remote data transfers and external actions require explicit scope and resource controls. More workers are useful only when measurable quality improves enough to justify added latency and cost.
