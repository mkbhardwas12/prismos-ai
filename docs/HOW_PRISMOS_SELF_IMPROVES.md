# How PrismOS Self-Improves

PrismOS gets better at **three timescales — all on-device, zero bytes leaving the
machine.** Nothing here calls a cloud model; every loop closes locally against
Ollama (`localhost:11434`) and a local SQLite brain. Wi-Fi off changes nothing.

```
                 ┌──────────────────────────────────────────────┐
   your question │                                              │
        ──────▶  │  ① RAG / Knowledge Graph    (per query, ms)  │  better CONTEXT
                 │     retrieve nodes + 👍 few-shot exemplars   │  (grounds the answer
                 │                                              │   in YOUR data)
                 ├──────────────────────────────────────────────┤
                 │  ② Response Loop + Council  (per answer, sec)│  better ANSWER
                 │     plan→build→judge→refine; N models debate │  (this reply, now)
                 ├──────────────────────────────────────────────┤
   👍 / 👎 ─────▶│  ③ Model Flywheel           (per model, wks) │  better MODEL
                 │     harvest→LoRA→eval-gate→ship-if-better    │  (the weights, over time)
                 └──────────────────────────────────────────────┘
                          ▲                               │
                          └──────  response_feedback  ◀───┘
                            every rating fuels ① and ③
```

## ① RAG / Knowledge Graph — better *context* (milliseconds · **live**)
Most weak answers are missing context, not a weak model. Each query retrieves
relevant nodes from the Spectrum Graph **and** pulls your highest-rated past
answers as **few-shot exemplars** (`get_good_examples`), then applies your
cognitive profile. So a 👍 you give today literally shapes tomorrow's prompts —
the cheapest, fastest improvement, and it's already wired in the app.

## ② Response Loop + Council — better *answer* (seconds · designed, not yet implemented)
For hard questions the one-pass pipeline becomes **plan → build → judge → refine**,
with the **Council** (several local models answer, peer-review each other
*anonymously*, a chairman synthesizes) acting as the judge. An ensemble of local
models beats any single one, and refinement catches what a single pass misses.
Opt-in, so quick everyday queries stay snappy.
→ `docs/LOCAL_LOOP_ENGINE.md`

## ③ Model Flywheel — better *model* (weeks · runnable prototype)
The only loop that changes the weights:
`response_feedback` → `harvest.py` (**only rating > 0 / validated answers** become
training data) → MLX **LoRA** fine-tune → `eval_gate.py` holdout (**ship only if it
beats the base**) → `ollama create`, keeping **N‑1 for instant rollback**. The
payoff is a model specialized to *your* reasoning / technical / market-research /
innovation domains — the moat a generic bigger model can't match.
→ `docs/SELF_IMPROVING_LLM.md` · `scripts/flywheel/`

## Why it improves instead of degrading or leaking
- **No model collapse.** Only human-validated (👍) answers train; nothing ships
  unless it beats the current model on a held-out set; the prior version is kept
  for rollback. (Auto-training on self-output is the classic collapse trap — so the
  flywheel stays **human-gated** for the first rounds; the eval-gate is what makes it
  *safe* to automate on a cron later.)
- **No egress.** All three loops run against local Ollama + local SQLite. This is the
  core invariant ("zero bytes leave the machine") and a hard review gate on every change.

## The virtuous cycle
One 👍 does triple duty: a **few-shot exemplar** (① now), a **training example**
(③ later), and a **graph node** (① context). The more you use PrismOS and rate
answers, the better both the answers (today) and the model (over time) — without a
single byte leaving your laptop.

## Status (honest)
| Layer | State |
|---|---|
| ① RAG + 👍 few-shot retrieval | **live in the app** |
| ② Loop + Council | **designed, not yet implemented** — see `docs/LOCAL_LOOP_ENGINE.md`; will land default-off |
| ③ Flywheel | **runnable prototype** — needs a validated corpus (keep rating answers 👍) |

> Round-one fuel is measured by `scripts/flywheel/harvest.py` against your local
> `spectrum_graph.db`. A 30B LoRA on a few dozen examples overfits — aim for
> hundreds of validated answers before the first real round; until then, `--smoke`
> validates the whole pipeline on a tiny model in minutes.
