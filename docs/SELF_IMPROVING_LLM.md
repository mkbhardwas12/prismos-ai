# PrismOS — Self-Improving Local LLM (the data flywheel)

> Grow your *own* reasoning LLM on-device: the loop+council validates answers, the best ones
> become training data, and a periodic **MLX LoRA** fine-tune folds them back into an Ollama
> model. 100% offline. Verifier-grounded so it gets **better, not collapsed.**
> (Backed by the deep-research run `wyvtvcrao` — 24/25 claims adversarially verified.)

## TL;DR verdict
Feasible today on the 64 GB M5 Max. Three pieces:
1. **Base** — already on disk: `qwen3:30b-a3b` (Qwen3-30B-A3B-Thinking, MoE 3.3B active) or `qwen3:32b`. Alternatives: QwQ-32B, Phi-4-reasoning (14B).
2. **Method** — rejection-sampling / STaR-family **SFT on the model's OWN verifier-validated outputs** (Think-Prune-Train, V-STaR, Self-Rewarding LMs). *Not* heavy RL — DeepSeek showed distillation/SFT beats small-model RL.
3. **Toolchain** — **MLX-LM LoRA/QLoRA** (64 GB LoRA-tunes up to 32B), fuse → GGUF → Ollama.

## The flywheel
```
                ┌───────────────────────── PrismOS loop engine ─────────────────────────┐
 user asks ──▶  PLAN ──▶ BUILD (generate) ──▶ JUDGE (council: peer-review + chairman
                                                      / verifier where ground-truth exists)
                                              │
                                  PRUNE: keep ONLY validated traces  ◀── the load-bearing safety gate
                                              │
        spectrum_graph.db  ◀── thumbs-up + good answers accumulate (response_feedback)
                                              │
                  (periodic, offline)         ▼
   HARVEST validated (prompt,answer) SFT pairs  +  (chosen,rejected) preference pairs
                                              │
                       MLX LoRA fine-tune `qwen3:30b-a3b`
                                              │
                          HOLDOUT EVAL gate (ship only if ≥ base)
                                              │
                  fuse → GGUF → `ollama create qwen3-prism:vN`
                                              │
                        better base ──▶ loop runs on it next time ──▶ repeat
```

## Why verifier-grounding is non-negotiable
Training on **unfiltered** self-generated data causes **model collapse** (Shumailov et al., *Nature* 2024 — irreversible degradation). The fix proven across the literature: **keep only correctness/verifier-pruned traces** ("stabilizes training, preserving knowledge" — Think-Prune-Train, arXiv 2504.18116). So the **judge/verifier is the safety mechanism**, not the generation.

## The honest limit (shapes the rollout)
Every verified self-improvement result was on **math/code with a ground-truth answer key.** Your goals include **market research & innovation — no ground truth**, where the council/LLM-judge signal is weaker and more collapse-prone, and self-judging **saturates after a few rounds**. Therefore:

| Domain | Quality signal | Flywheel cadence |
|---|---|---|
| Code, SAP ops, anything checkable | **automated verifier** (tests/exec/exact-match) → trustworthy | aggressive |
| Reasoning/technical Q&A | council peer-review + chairman | moderate, holdout-gated |
| Market research / innovation | **human thumbs-up only** (rating>0) | conservative, human-in-loop, holdout-gated |

**Every retrain is gated by a holdout eval — a bad round can never ship.** Self-judging is a few-round booster, not infinite improvement; schedule periodic human review and fresh data.

## Data schema (already in your DB)
`~/Library/Application Support/com.prismos.app/spectrum_graph.db` → `response_feedback`:
`(id, conversation_id, question, response, rating, context_nodes, model, created_at)`.
- `rating > 0` → SFT positive (prompt=question, completion=response).
- `rating < 0` → rejected; pair with a positive same-question answer → DPO (chosen, rejected).

## Components (prototype in `scripts/flywheel/`)
| File | Role |
|---|---|
| `harvest.py` | read `response_feedback` → `data/train.jsonl` + `data/valid.jsonl` (+ optional `prefs.jsonl`) in MLX chat format |
| `train_lora.py` | MLX-LM LoRA/QLoRA fine-tune → fuse → (GGUF) → Ollama Modelfile |
| `eval_gate.py` | holdout eval: tuned vs base; emit SHIP / NO-SHIP |
| `run_flywheel.sh` | orchestrate harvest → train → eval-gate → register |
| `README.md` | setup (mlx-lm), `--smoke` end-to-end test on a tiny model first |

## Key practicalities
- **Train from HF/MLX weights, not the Ollama GGUF.** MLX can't train a GGUF. Pull the MLX base (e.g. `mlx-community/Qwen3-30B-A3B-...-4bit`); fine-tune; convert the *result* back to GGUF for Ollama.
- **Memory (64 GB):** MLX LoRA fits ≤32B; QLoRA (quantized base) roughly halves it. Start small: validate the whole pipeline on a 0.5–3B model (`--smoke`) before a 30B run.
- **MoE GGUF caveat:** MLX→GGUF export for Qwen3-MoE may be unsupported; fall back to `llama.cpp convert_hf_to_gguf.py` + quantize. `train_lora.py` documents both paths.
- **Versioning:** every shipped model is `qwen3-prism:vN`; keep the prior version so you can roll back. Never overwrite.

## Guardrails (hard rules)
1. **Only verifier/human-validated traces enter training** (collapse prevention).
2. **Holdout eval gate** before any `ollama create` ships a new version.
3. **Keep N-1** (roll back instantly if vN regresses in real use).
4. **Diversity + human-in-loop** every few rounds; watch for self-judge saturation/reward-hacking.
5. **Zero egress** — harvest, train, eval, register all run locally; nothing leaves the machine.

## Sources (verified)
Think-Prune-Train [arXiv 2504.18116] · V-STaR [2402.06457] · Self-Rewarding LMs [2401.10020] ·
RLHFlow self-rewarding-reasoning [github.com/RLHFlow] · MLX-LM LoRA [github.com/ml-explore/mlx-lm] ·
mlx-tune (DPO/GRPO on MLX) [github.com/ARahim3/mlx-tune] · model collapse [Nature s41586-024-07566-y] ·
DeepSeek-R1 distillation>small-RL [Nature s41586-025-09422-z]. Full report: task `wyvtvcrao`.
