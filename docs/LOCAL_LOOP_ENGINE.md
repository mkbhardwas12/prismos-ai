# PrismOS Local Loop Engine — design

> **Status (2026-08-13):** rollout phases 1 & 4 are shipped (reasoning lane in
> `smart_router`, `keep_alive` + think control in `ollama_bridge`). The judge
> (phase 2) and the loop itself (phase 3) are **designed here, not yet built** —
> `execute_goal_loop`, `JudgeVerdict`, and `AcceptanceCriteria` do not exist in
> the codebase yet.

> Turn the single-pass multi-agent pipeline into a real **plan → build → judge → refine**
> goal loop that runs **entirely on-device** (Ollama), with explicit stopping criteria and
> per-role model routing. Inspired by "loop engineering" (Boris Cherny / Anthropic plan-build-judge),
> but offline — *zero bytes leave the machine*.

## Why
The current `agents/langgraph_workflow.rs` runs one pass and stops:
`orchestrate → fan-out → debate → sentinel → consensus → execute/reject`.
Three gaps vs. a real loop:
1. **No iteration / no goal validation** — consensus-reject returns a canned apology (no retry).
2. **Debate is canned** — `run_debate` emits hard-coded strings; only the Reasoner calls the LLM.
3. **One model for all roles** — `smart_router` is not wired into the workflow.

The fix unifies two ideas: a *local goal loop* + *per-role free-model routing*.

## Core invariant (hard gate)
Every new inference call goes through `ollama_bridge` → local Ollama. **No network egress.**
The loop adds local compute/latency, never a remote call. Sentinel security veto stays absolute.

## The loop
```
PLAN   Orchestrator decomposes intent AND emits explicit AcceptanceCriteria ("what "done" looks like")
  ↓
BUILD  existing fan-out (Reasoner + ToolSmith + MemoryKeeper) produces a candidate   ← reused as-is
  ↓
JUDGE  CriticNode (REAL llm call) scores candidate vs. AcceptanceCriteria → JudgeVerdict{pass, deficiencies[]}
       Sentinel security review runs here too (hard veto, unchanged)
  ↓
  pass? ───yes──→ EXECUTE (Sandbox Prism) + persist to Spectrum Graph   ← reused
  │
  no, and (iter < max) and (not stuck) and (Sentinel not vetoing)
  └──→ REFINE: feed deficiencies[] back into BUILD as additional context, iterate
```

### Stopping criteria (the article's emphasis — explicit "done")
- **Validated**: JudgeVerdict.pass == true → execute.
- **Budget cap**: `iter >= max_iterations` (default 3) → return best-so-far, labelled "unvalidated".
- **Stuck**: judge score does not improve between two rounds → stop (don't burn loops).
- **Security veto**: Sentinel flags → halt immediately, never execute. (Absolute, unchanged.)
- **Offline fallback**: Ollama unreachable → one graceful pass, no loop, honest message.

## Per-role model routing (wire `smart_router` in)
Add a **reasoning lane** alongside the existing vision/code lanes and route by role:

| Role            | Model lane        | Example (local, free)              |
|-----------------|-------------------|------------------------------------|
| Planner / Critic| reasoning         | deepseek-r1-distill / qwen3        |
| Builder/Reasoner| general (or code) | llama3.3:70b / qwen2.5-coder       |
| Vision intents  | vision            | qwen2.5-vl / llama3.2-vision       |

### Memory policy on 64 GB (M5 Max) — avoid thrash
A 70B builder (~40 GB Q4) + a 32B judge (~20 GB Q4) ≈ 60 GB — both can stay warm, tight.
- Default: **single warm model** for plan/build/judge to avoid reloads each loop turn (fastest).
- Escalate to a **separate reasoning judge** only for high-stakes / low-confidence answers (adaptive).
- Set Ollama `keep_alive` per call + `OLLAMA_MAX_LOADED_MODELS` so swap behaviour is explicit, not accidental.

## Concrete code changes (grounded in current files)
- `agents/langgraph_workflow.rs`
  - New structs: `AcceptanceCriteria { checks: Vec<String> }`, `JudgeVerdict { pass: bool, score: f64, deficiencies: Vec<String>, summary: String }`,
    `IterationRecord { attempt, candidate, verdict }`, extend `WorkflowState` with `iterations: Vec<IterationRecord>` + `max_iterations`.
  - New `WorkflowEngine::execute_goal_loop(...)` that wraps the existing single-pass `execute(...)` as the BUILD stage and loops.
  - Real `judge()` step (LLM critic) replacing/augmenting the canned `run_debate` (keep debate as optional flavor, demote from decision-maker).
- `agents/nodes.rs`
  - `PlannerNode::acceptance_criteria(&intent, ctx) -> AcceptanceCriteria` (real LLM, reasoning model).
  - `CriticNode::judge(candidate, &criteria) -> JudgeVerdict` (real LLM, reasoning model).
- `smart_router.rs`
  - `REASONING_MODEL_PATTERNS` + `find_best_reasoning_model`, and `route_for_role(role, intent, available) -> RoutingDecision`.
- `ollama_bridge.rs`
  - Thread `keep_alive: Option<&str>` into `GenerateOptions`/`ChatOptions`; read `OLLAMA_MAX_LOADED_MODELS` from env at startup.
- Frontend (`src/`)
  - Extend `AgentActivityEvent` with `iteration: u32`; new phases `plan | build | judge | refine`.
  - UI: "Refining (attempt 2/3)…" + show the judge's deficiency list live (this is the demo money-shot).

## Tests (keep tsc/vitest green, cargo clean)
- loop converges to pass on a solvable intent;
- loop respects `max_iterations` and returns best-so-far labelled unvalidated;
- stuck-detection halts when score doesn't improve;
- Sentinel veto halts the loop regardless of judge;
- offline (Ollama down) path returns one graceful pass, no infinite loop;
- `route_for_role` picks reasoning model for Planner/Critic, vision for image intents.

## Rollout (phased, each independently shippable)
1. **Routing lane** — add reasoning lane + `route_for_role` + tests. (No behaviour change yet.)
2. **Judge** — `CriticNode::judge` real LLM verdict; surface verdict in UI; still single pass.
3. **Loop** — `execute_goal_loop` with acceptance criteria + stopping criteria + iteration UI.
4. **keep_alive / memory policy** — wire `keep_alive` + adaptive judge escalation; benchmark load/tok-s on M5 Max.

## Risks
- **Latency**: each loop turn = full pass + judge LLM ≈ seconds × N. Cap N=3; stream so the UI feels alive.
- **Model thrash**: per-turn model swaps on 64 GB. Mitigate with single warm model default + adaptive escalation.
- **Loop never converges**: stuck-detection + hard cap are mandatory, not optional.
- **Debate vs judge confusion**: demote canned debate to cosmetic; the *judge* is the decision-maker.
