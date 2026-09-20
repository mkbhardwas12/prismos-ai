# Evaluating improvements before training or promotion

Reviewed: 2026-09-08. Classification: public reference; original evaluation guidance.

Maintain a versioned evaluation set with representative tasks and independent expected outcomes. Include factual questions with sources, unknown-answer cases, noisy retrieval, prompt injection attempts, complete document generation, missing models, truncation, tool failures and privacy checks. Measure source accuracy, completeness, refusal/uncertainty behavior, latency and regression rate separately.

Hold evaluation examples out of training. Deduplicate related questions and split by source or task family when simple row splitting would leak near-duplicates. A thumbs-up is feedback, not a factual ground-truth label. Generated answers need human or independent evidence review before becoming training targets.

Exact-match evaluation means equality after explicitly defined normalization, not substring containment. Invalid evaluator output is an evaluation failure, not a tie. A model judge is another fallible model: preserve the rubric, request ordering and results, and audit disagreement cases. Empty holdouts, missing references or invalid margins must block promotion.

Training, model conversion and deployment are separate resource-consuming operations. Require explicit approval, a known base model, reproducible data and parameters, safe resource limits, held-out evaluation, and a rollback checkpoint. A candidate should remain inactive until the agreed gate passes. Keep private training data and model artifacts out of the public source repository. This knowledge pack starts no training or autonomous promotion.
