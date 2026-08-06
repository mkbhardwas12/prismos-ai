# PrismOS-AI Architecture

## Overview

PrismOS-AI is a Tauri 2 desktop application with a React/TypeScript frontend and a
Rust backend. Private chat, document, vision, and workflow inference is fixed to Ollama
at `http://localhost:11434`, with persistent local SQLite memory. Configured Ollama URLs
are limited to model management and status; they are not inference destinations. Model
downloads and browser-provided speech services have separate network boundaries.
PrismOS does not ship a general web crawler or internet-research agent.

## Layers

### 1. React frontend

The frontend renders chat, workflow activity, graph views, document input, settings,
security status, and the Project Knowledge approval flow. It calls the Rust backend with
Tauri `invoke` and receives progress/activity events with `listen`.

Key surfaces include:

| Surface | Responsibility |
|---|---|
| `MainView` / `IntentInput` | Chat, ephemeral one-off attachments, request lifecycle, and response rendering |
| `SettingsPanel` | Models, Project Knowledge, graph import/export, integrations, and live security facts |
| `SpectrumGraphView` / `SpectrumExplorer` | Knowledge visualization, search, and management |
| `ActiveAgents` | Workflow-stage activity and collaboration trace |
| `DailyDashboard` / `ProactivePanel` | Local graph-derived summaries and suggestions |

### 2. Tauri IPC boundary

Commands are registered in `src-tauri/src/lib.rs`. Important groups are:

- chat/refractive execution and typed inference failures;
- graph query, feedback, import/export, and maintenance;
- metadata-only Project Knowledge scan, one-time approval/index, refresh, list, and Forget;
- ephemeral one-off document extraction/chunking and approval-gated Project Knowledge;
- fixed-loopback Ollama inference plus separately scoped model management/status operations;
- sandbox, audit, model verification, and security status;
- browser-provided speech controls and explicit model downloads;
- private-vault export and restart-gated disaster restore.

Email, calendar, and finance prototypes exist in the source tree but their commands are
intentionally not registered. There is no active in-app auto-updater.
Legacy background file-watcher/indexer ingestion is disabled (the compatibility start
command reports a migration error), and the bundled Whisper prototype does not provide
real transcription. A one-off attachment is kept out of the graph unless the user
separately approves its containing root as Project Knowledge.

Command counts change frequently, so the handler registration is the authoritative
inventory.

### 3. Rust orchestration and inference

The Refractive Core performs this chat path sequentially:

1. parse the intent and classify its response style/domain;
2. retrieve pinned profile context, recent persisted conversation turns, and relevant
   Spectrum Graph nodes;
3. place retrieved text in an explicit untrusted-reference envelope;
4. define bounded acceptance criteria, using a model-backed Planner for applicable
   open-ended intents and a deterministic fallback otherwise;
5. BUILD a candidate with the Reasoner, apply a Sentinel gate, then JUDGE it with a
   sequential Critic call when the goal loop is enabled;
6. feed bounded deficiencies into the next BUILD until the answer passes, progress stalls,
   or the iteration cap is reached;
7. run the remaining deterministic Tool Smith, Memory Keeper, debate, and consensus stages;
8. persist the successful conversation and reinforce relevant graph relationships;
9. return the response with context provenance, inference identity facts, and a workflow
   trace.

Planner, Reasoner, and Critic calls are serialized through the same typed inference bridge;
they are not a parallel multi-model Council. Simple intents can use deterministic planning,
and an unavailable or invalid judge produces an explicitly ungraded fallback instead of
unbounded retry. Tool Smith, Memory Keeper, debate text, and consensus votes remain
deterministic policy/heuristic stages. This is an answer-refinement loop, not an autonomous
plan/tool/observe agent with independent filesystem or network authority. See
[LOCAL_LOOP_ENGINE.md](LOCAL_LOOP_ENGINE.md).

Important backend modules:

| Module | Responsibility |
|---|---|
| `refractive_core.rs` | Intent processing, retrieval assembly, chat continuity, and result provenance |
| `agents/langgraph_workflow.rs` | Sequential Planner/Reasoner/Critic loop, activity, policy review, and persistence |
| `agents/nodes.rs` | Bounded Planner/Critic prompts and deterministic role behavior |
| `inference_bridge.rs` | Typed target/request/result identity and local-policy validation |
| `ollama_bridge.rs` | Fixed-loopback private inference and separate model-management origin policy |
| `spectrum_graph.rs` | SQLite graph, hybrid retrieval, source synchronization, and feedback data |
| `project_knowledge.rs` | Approval-gated metadata scan, filtering, redaction, and deterministic chunks |
| `doc_chunker.rs` | Standalone document chunking and TF-IDF retrieval |
| `sandbox_prism.rs` | Native allow-list simulation, risk tiers, authenticated records, and checkpoints |
| `you_port.rs` | AES-256-GCM export/sync packages |
| `private_vault.rs` | Encrypted full-database recovery candidate and restart-gated restore staging |
| `audit_log.rs` | Tamper-evident append-only hash-chain records |

## Project Knowledge path

```text
folder path
  → metadata-only bounded scan
  → user preview and approval
  → validated non-symlink text reads
  → best-effort credential redaction
  → deterministic chunks + content hashes
  → atomic source synchronization
  → FTS/keyword/graph/optional-vector retrieval
  → untrusted reference envelope
  → local Reasoner answer with Source-path guidance
```

Refreshes preserve unchanged embeddings, invalidate changed embeddings, and delete stale
source-owned chunks in one transaction. Forget deletes only nodes owned by the selected
source and never modifies source files. See [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md).

One-off chat attachments use a separate ephemeral path: bounded DOCX, PPTX, and
allowlisted UTF-8 text/code content—including CSV/TSV—is extracted, chunked, retrieved in
memory for the current answer, and then discarded. PDF extraction fails closed until it
can be safely resource-isolated; users must convert PDFs to UTF-8 text. XLSX and legacy
`.xls` fail closed before parsing and must be exported as CSV/TSV. This path does not
create `doc_chunk` graph nodes or silently promote content into Project Knowledge.
Project Knowledge is narrower: it indexes only allowlisted UTF-8 source, documentation,
configuration, and manifest text after preview and approval; it does not parse Office or
PDF attachments.

Generated artifacts use a separate outbound path. Explicit creation requests route to a
bounded DOCX, PPTX, PDF, or XLSX semantic schema. Ollama is asked for JSON at temperature
zero, Rust extracts one complete object and validates the kind-specific shape, and the
frontend applies request-coverage and grounding gates before calling a local renderer. If
the model response is malformed, truncated, structurally weak, or ungrounded, PrismOS uses
a disclosed deterministic verification-first template built only from the request. XLSX
cells are emitted as inline strings rather than formulas. Completed files are atomically
reserved, registered as session capabilities, and only registered generated paths can be
opened by the UI. This outbound support does not relax the fail-closed PDF/XLSX ingestion
boundary above.

## Storage

The Spectrum Graph uses SQLite under the platform app-data directory. Regular tables cover
nodes/edges, intents, feedback, cognitive/profile history, agent memory, model performance,
proactive suggestions, examples, and approved knowledge-source metadata. FTS5 adds an
optional `nodes_fts` virtual table and triggers; retrieval degrades to the existing paths if
FTS5 is unavailable.

The live graph contains conversations and approved project excerpts and is not encrypted at
rest. On Unix-like systems PrismOS sets the app-data directory to mode `0700` and the graph
database to `0600`.

Two encrypted export scopes are intentionally different:

- You-Port portable/sync packages omit managed Project Knowledge excerpts.
- A `.prismos-vault` recovery candidate contains a consistent full database snapshot and the
  bounded audit log when present. Export refuses a destination inside a Git worktree. Restore validates and
  stages the package while the app is running, then applies it before SQLite opens on the
  next startup.

The private-vault round trip has automated coverage, but a documented operator restore
drill on a disposable app-data directory is still required before treating it as recovery
media. Keep independent backups and the passphrase separate from the encrypted vault; never commit
either personal data or recovery secrets to the public source repository.

## Retrieval

Intent retrieval combines:

- SQLite FTS5/BM25 when available;
- existing lexical matching;
- graph relationship/path strength;
- recency and access signals;
- optional embeddings generated through Ollama.

Embeddings are invalidated whenever node content changes. Recent conversation turns are
included separately and treated as lower-trust continuity than versioned project sources.

## Network and endpoint policy

All private inference uses the fixed loopback origin `http://localhost:11434`. URL
credentials, paths, queries, fragments, proxies, and redirects are rejected/disabled on
that inference path. The Ollama URL shown in settings is a separate model-management and
status boundary. `PRISMOS_ALLOW_REMOTE_OLLAMA=1` can admit a non-loopback origin for those
operations only; it does not send prompts, attachments, retrieved project excerpts, or
workflow role calls to that origin.

Loopback is a routing boundary, not daemon attestation. PrismOS does not mutually
authenticate the local Ollama HTTP process, so a same-account process able to impersonate
`localhost:11434` could receive prompts. The current design therefore relies on OS-account
and local-process integrity in addition to its URL policy.

This policy does not make the whole application network-free. Explicit model downloads
and browser-provided speech services can use the network when invoked. Real bundled
Whisper transcription and the legacy background watcher/indexer are unavailable. Email,
calendar, and finance commands are also unavailable, and PrismOS does not crawl or
research the public web.

## Security scope

Every guarded action is classified by a native Rust policy simulator against a per-agent
allow-list and recorded with an authenticated action record. The component does not execute
untrusted code in Wasmtime/WASM. Its rollback command restores only the simulator's own
checkpointed bookkeeping; it is not a generic transaction over filesystem, network, model,
or database side effects. The audit log is tamper-evident, not tamper-proof.

Retrieved files are data, never trusted instructions. Control-tag escaping and Reasoner
rules reduce indirect prompt injection risk, but important results should still be checked
against cited source files.

## Verification

Run `npx vitest run`, `npx tsc --noEmit`, `npm run build`, and `cargo test --lib` before a
release. Exact test counts change with the source tree and should not be treated as a
capability claim. A release checklist must also include a private-vault restore drill.
