# PrismOS Local Loop Engine

> **Status (August 2026): shipped as a bounded, sequential answer-refinement
> loop.** Planner, Reasoner, and Critic calls can use installed local models, but
> they run one after another through the same typed inference bridge. PrismOS does
> not currently run a true parallel multi-model Council or an autonomous
> plan/tool/observe agent.

The loop improves a candidate response against explicit acceptance criteria:

```text
PLAN
  Define bounded acceptance criteria.
  Open-ended Analyze/Create/Connect intents can use a model-backed Planner;
  simpler intents and failures use deterministic criteria.
    ↓
BUILD
  The Reasoner produces a candidate from the user intent and bounded,
  untrusted reference context.
    ↓
SECURITY GATE
  Sentinel can halt the loop. A veto is final for that request.
    ↓
JUDGE
  A sequential Critic call scores the candidate against the criteria and
  returns bounded deficiencies. Invalid or unavailable judging is an
  ungraded rejection, never an approval.
    ↓
  pass? ─── yes ──→ QUALITY RELEASE GATE
    │
    no, budget remains, and score improves
    └──────────────→ REFINE prior draft + deficiencies into the next BUILD

QUALITY RELEASE GATE
  A graded rejection cannot be overruled by deterministic role votes.
  Operational/version-sensitive work also requires a valid grade.
  Only validated, released responses may be persisted or drive follow-ons.
```

## Bounds and stopping rules

- The goal loop is enabled by default and can be disabled with
  `PRISMOS_GOAL_LOOP=0` for a single-pass compatibility path.
- The default budget is two attempts for ordinary intents and three for
  Analyze/Create/Connect intents.
- `PRISMOS_LOOP_MAX_ITERS` may set a value from 1 through 5; values outside that
  range are ignored.
- A passing Critic verdict stops the loop.
- A non-improving score stops the loop and retains the best candidate only for
  audit/selection; a graded rejection is not released to the user.
- A Sentinel veto stops immediately.
- A first BUILD inference failure is returned as a typed failure. A later BUILD
  failure retains the best earlier candidate.
- If the Critic is unavailable or its response is invalid, the result is
  explicitly ungraded. Operational/version-sensitive output is held; a low-risk
  best-effort answer may be shown but is not spoken, persisted, reinforced,
  used for suggestions, or used to generate an alternative.

These bounds limit latency and runaway retries. A model-generated grade is still
an estimate, not proof that an answer is correct. Artifact generation adds a
separate deterministic claim gate for unsupported citations, local paths,
commands, versions/dates, and duration estimates.

## Context isolation

Private memory is not injected into every task. A self-contained request receives
only explicitly named graph nodes and consented research excerpts that match the
request. Pinned personal profile nodes are included only for an explicit
identity/profile request; recent chat turns are included only for detected
follow-ups; project-wide knowledge requires explicit project/knowledge wording.

This prevents unrelated personal projects or earlier assistant mistakes from
becoming apparent vendor sources in an external technical answer.

## Spectrum Graph visibility

The interactive graph uses a bounded presentation projection rather than a
newest-first dump of the database. Generated proactive suggestions are
summarized, durable/core/context knowledge is selected first, edges are limited
to displayed endpoints, and the UI reports shown versus summarized/omitted
records. Reading proactive suggestions is side-effect free; opening a dashboard
must not create new memory nodes.

The graph opens as labeled family hubs. Exploring a family is capped, searchable,
and uses a consistent grammar: color is family, shape is node kind, border is
lifecycle, line width is relationship strength, and focused arrows show stored
direction. Project knowledge recognizes both `project-*` source IDs and the
`project`/`project_chunk` types.

`Trace last answer` highlights the bounded `context_nodes` and
`edges_reinforced` receipts returned for the most recent response. This is an
audit view of recorded context and memory changes, not a verbatim transcript of
agent messages or model chain-of-thought.

## Model routing

Planner and Critic prefer an installed reasoning lane; the Reasoner uses the
selected general, reasoning, code, or vision route for the intent. Routing can
select different installed models for roles, but calls remain sequential. This
avoids describing model diversity as concurrency.

Ollama endpoint admission remains a separate security boundary. All Planner,
Reasoner, and Critic inference is fixed to `http://localhost:11434`, with proxy and
redirect behavior disabled. `PRISMOS_ALLOW_REMOTE_OLLAMA=1` can admit a configured
non-loopback origin only for model management and status operations; it does not
redirect prompts, retrieved context, or loop roles away from loopback.

## What the collaboration trace means

The workflow still records Orchestrator, Tool Smith, Memory Keeper, Sentinel,
debate, and consensus stages. Today, Tool Smith and Memory Keeper proposals,
debate statements, and consensus votes are deterministic policy/heuristic
outputs. They should not be presented as independent LLM agents debating in
parallel.

The loop refines response text. It does not itself:

- execute arbitrary shell commands or model-authored code;
- browse or crawl the internet;
- grant a model filesystem access;
- train, download, promote, or roll back model weights;
- make email, calendar, or finance commands available.

Project files can enter context only through the separate approval-gated Project
Knowledge or review flows.

## Relevant implementation

- `agents/langgraph_workflow.rs` owns `AcceptanceCriteria`, `JudgeVerdict`,
  `IterationRecord`, iteration bounds, stopping rules, and workflow events.
- `agents/nodes.rs` owns bounded Planner/Critic prompts, strict JSON parsing,
  deterministic fallbacks, and deficiency-to-refinement formatting.
- `inference_bridge.rs` validates typed request, route, and model identity.
- `smart_router.rs` selects an installed role-appropriate model lane.
- `ollama_bridge.rs` keeps private inference on fixed loopback and separately
  validates configured model-management/status origins.

## Historical design versus current implementation

The original design proposed a single-pass fan-out followed by a Council of
several models, potentially loaded concurrently. The shipped implementation took
a narrower route: explicit criteria, one candidate at a time, one Critic grade at
a time, and hard iteration bounds. This provides inspectable refinement without
claiming parallel LLM orchestration.

A future parallel Council would need an explicit opt-in, RAM/VRAM preflight,
maximum candidate count, per-branch request identity, timeout/cancellation,
queue backpressure, and a side-effect-free candidate phase. It is not part of
the current capability set.

## Verification expectations

Tests should continue to cover:

- bounded planner and critic parsing;
- pass, iteration-cap, stuck, Sentinel-veto, and unavailable-model paths;
- graded quality rejection overriding role-vote consensus;
- zero persistence and follow-on generation for unvalidated output;
- context isolation for self-contained, follow-up, project, and profile requests;
- explicit Word/PPT/PDF/Excel routing to actual `.docx`, `.pptx`, `.pdf`, and
  `.xlsx` artifacts;
- JSON-mode artifact authoring, complete-object extraction, typed shape checks,
  and the deterministic safe-template path for malformed or truncated output;
- deterministic rejection or safe replacement of unsupported operational claims
  in artifacts;
- request/model identity propagation across Planner, Reasoner, and Critic calls;
- prompt-injection separation for user intent, retrieved context, criteria, and
  candidate text;
- honest `validated` versus `ungraded` result metadata.
