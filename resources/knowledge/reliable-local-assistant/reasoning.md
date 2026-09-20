# Reliable reasoning: requirements, evidence, decisions, checks

Reviewed: 2026-09-08. Classification: public reference; original engineering guidance, not a record of model-internal reasoning.

A useful answer separates the user's requested outcome from the information available to support it. Requirements describe what to achieve; evidence supports factual claims; assumptions fill explicitly named gaps; decisions choose an approach under constraints. A confident tone or agreement among roles is not evidence.

A concise decision record can contain: objective, known facts with source IDs, unknowns, alternatives considered at a high level, chosen approach and tradeoff, actions actually taken, observed test results, and remaining risk. It need not expose private internal deliberation or fabricate a transcript between agents. Status updates should describe observable work and distinguish waiting for a model from executing a tool.

For a complex request, decompose it into independently checkable deliverables. Establish acceptance criteria before drafting. Retrieve relevant evidence, identify contradictions, and verify the risky claims. If evidence is missing, produce a provisional plan or ask a focused question. State failure when execution fails. A generated filename is not proof that a file exists, and a successful parse is not factual validation.

Related references: structured-output validation, evidence provenance, bounded orchestration, artifact acceptance checks in this knowledge pack.
