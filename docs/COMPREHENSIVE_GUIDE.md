# PrismOS-AI Comprehensive Guide

---

## Table of Contents

1. [Introduction](#introduction)
2. [Core Concepts](#core-concepts)
3. [Architecture Deep Dive](#architecture-deep-dive)
4. [Installation & Setup](#installation--setup)
5. [User Guide](#user-guide)
6. [Developer Guide](#developer-guide)
7. [API Reference](#api-reference)
8. [Security Model](#security-model)
9. [Troubleshooting](#troubleshooting)
10. [FAQ](#faq)

---

## Introduction

### What is PrismOS-AI?

PrismOS-AI is a **local-first personal AI desktop application**. Private chat,
document, vision, and workflow inference is fixed to Ollama at
`http://localhost:11434`, and durable memory lives in a local SQLite Spectrum
Graph. Configured Ollama URLs are for model management and status only.
Model downloads and browser-provided speech services have separate network
boundaries. Chat uses a bounded, sequential Planner → Reasoner → Critic answer
loop plus deterministic retrieval, policy, memory, debate-trace, and consensus
stages.

### Key Innovations

- **Spectrum Graph™**: SQLite graph memory with full-text, relationship, recency, feedback, and optional local-embedding retrieval signals
- **Refractive Core™**: Intent processing pipeline that refracts user inputs through the knowledge graph
- **Sandbox Prism™**: A native Rust allow-list/policy simulator with authenticated action records and checkpointed simulator state
- **You-Port™**: Encrypted portable state migration that omits managed Project Knowledge excerpts
- **Private Vault**: Encrypted full-database/audit recovery candidate, written outside Git and staged for restart; a clean-profile restore drill remains required

### Current Version

This guide follows the current source tree. Package/release versions can differ while a
release is being prepared; consult the application manifests and release assets rather
than treating this document as an update feed. PrismOS has no active in-app auto-updater.

---

## Core Concepts

### Workflow roles

PrismOS exposes several named workflow roles. These labels do **not** mean eight
independent LLMs are running in parallel:

1. **Planner/Orchestrator**: Defines bounded acceptance criteria and coordinates stages
2. **Memory Keeper**: Manages the Spectrum Graph, stores knowledge, and maintains context
3. **Reasoner**: Builds the candidate answer through a typed Ollama request
4. **Critic**: Sequentially judges applicable answers against the acceptance criteria
5. **Tool Smith**: Emits deterministic, bounded tool-policy proposals; it does not execute model-authored shell code
6. **Sentinel**: Applies an in-loop security veto and native action policy
7. **Memory/consensus roles**: Produce deterministic persistence and trace decisions

Legacy Email Keeper, Calendar Keeper, and Finance Keeper prototypes remain in the source
tree, but their Tauri commands are intentionally not registered. They are not current user
features.

### The Spectrum Graph

The Spectrum Graph is a multi-dimensional knowledge store that represents information across seven spectral dimensions:

- **Cognitive**: Facts, concepts, reasoning chains
- **Emotional**: Sentiment, user preferences, contextual mood
- **Temporal**: Time-based relationships, event sequences
- **Social**: Relationships between entities, social context
- **Creative**: Ideas, brainstorming, generative thinking
- **Analytical**: Data analysis, metrics, quantitative reasoning
- **Physical**: Spatial relationships, physical world context

Each node in the graph has:
- **Content**: The actual knowledge/information
- **Spectral Values**: Weights across all 7 dimensions
- **Decay Factor**: Natural forgetting over time
- **Momentum**: Reinforcement from repeated access
- **Facets**: Multi-perspective representation

### The Refractive Core Pipeline

When you submit an intent (natural language input), it flows through the Refractive Core:

```
User Input → Intent Lens (parsing) → Spectrum Graph (context retrieval)
→ PLAN criteria → BUILD answer → Sentinel gate → JUDGE answer
→ optional bounded REFINE → deterministic collaboration trace
→ Response + Graph Update
```

Planner, Reasoner, and Critic calls run one after another. PrismOS does not currently
launch a true parallel multi-model Council. The answer loop has no general shell,
filesystem-write, email, finance, or internet-research authority.

---

## Architecture Deep Dive

### System Layers

#### Layer 1: Frontend (React 18 + TypeScript)

**Selected components:**
- MainView, IntentInput, DailyDashboard, ProactivePanel
- SpectrumGraphView, SpectrumExplorer, SpectralTimeline
- SandboxPanel, SettingsPanel, TitleBar, Sidebar
- OnboardingWizard, SpotlightOverlay, ActiveAgents
- DailyBrief, DailySuggestions, SuggestionCard, ErrorBoundary

**Key Hooks:**
- `useChat.ts`: Conversation state management
- `useOllama.ts`: Ollama model-management and status lifecycle
- `useVoice.ts`: Browser-provided speech recognition and synthesis; real bundled
  Whisper transcription is unavailable
- `useSuggestions.ts`: Proactive suggestion engine

#### Layer 2: IPC Bridge (Tauri 2.0)

The command handler in `src-tauri/src/lib.rs` is the authoritative IPC inventory. Current
command groups cover:

- Intent processing and refraction
- Spectrum Graph CRUD operations
- Sequential Planner/Reasoner/Critic workflow execution
- Native Sandbox Prism policy simulation and simulator-state rollback
- Fixed-loopback Ollama inference and separately scoped model management/status
- Browser-provided speech controls; no production Whisper transcription IPC
- Approval-gated Project Knowledge and bounded retrieval
- Ephemeral one-off analysis for bounded DOCX, PPTX, and allowlisted UTF-8 text/code/CSV/TSV; PDF, XLSX, and legacy XLS parsing fail closed
- Bounded local DOCX, PPTX, PDF, and XLSX generation with JSON-mode authoring, typed pre-write validation, grounding/request-coverage gates, and a disclosed deterministic safe fallback
- Vision model routing and inference
- Encrypted portable export plus full-database private-vault recovery tooling;
  a clean-profile operator restore drill remains required before sole reliance
- Synthetic-only flywheel smoke controls; personal-data training remains disabled

Email/calendar/finance commands and a general web crawler are not exposed. There is no
active updater command.
The legacy background watcher/indexer start command returns a migration error and does
not ingest files. One-off attachment chunks remain in memory for the request and are not
automatically written into the Spectrum Graph.

#### Layer 3: Backend (Rust)

**Selected core modules:**

- `spectrum_graph.rs`: SQLite-backed graph, bounded retrieval, and source ownership
- `refractive_core.rs`: Intent processing and response provenance
- `sandbox_prism.rs`: Native action-policy simulator, allow-lists, and authenticated records
- `inference_bridge.rs`: Typed request/model/route admission
- `ollama_bridge.rs`: Fixed-loopback inference plus separate model-management origin policy
- `you_port.rs`: AES-256-GCM portable export/import
- `private_vault.rs`: Full-database encrypted backup candidate and restart-gated restore staging
- `audit_log.rs`: SHA-256 tamper-evident hash chain
- `project_knowledge.rs`: Approval-gated project preview, validation, redaction, and chunking
- `intent_lens.rs`: Natural language parsing
- `model_verify.rs`: Advisory Ollama model-metadata compatibility classification;
  it does not verify model bytes against a trusted publisher digest
- `whisper_engine.rs`: Retired transcription prototype; not exposed for real transcription
- `file_indexer.rs`: Legacy watcher implementation; automatic ingestion is disabled
- `smart_router.rs`: Auto model switching
- `doc_chunker.rs`: Document chunking + TF-IDF retrieval
- `flywheel.rs`: Synthetic smoke status/start boundary for the training prototype;
  personal-data full mode is disabled

**Agent Sub-Modules:**
- `agents/mod.rs`: Agent DAG definitions
- `agents/graph.rs`: LangGraph execution engine
- `agents/langgraph_workflow.rs`: Workflow orchestration
- `agents/messages.rs`: Inter-agent message protocol
- `agents/nodes.rs`: Bounded Planner/Critic prompts and deterministic role behavior

#### Layer 4: Storage & Inference

- **SQLite Database**: Spectrum Graph plus conversations, feedback, profile/history,
  knowledge-source ownership, model statistics, and related local tables
- **Ollama**: Private inference is fixed to `http://localhost:11434`; an allowed
  configured origin is limited to model management and status
- **Project Knowledge**: A metadata-only preview precedes approval and bounded read-only
  ingestion of allowlisted UTF-8 source, documentation, configuration, and manifest text.
  It does not parse Office or PDF attachments, and PrismOS never modifies source files.
- **One-off attachments**: Bounded DOCX, PPTX, and allowlisted UTF-8 text/code chunks,
  including CSV/TSV, are retrieved in memory for one request and discarded without
  creating graph `doc_chunk` nodes. Convert PDFs to UTF-8 text. XLSX and legacy `.xls`
  fail closed before parsing; export spreadsheets as CSV/TSV.
- **No crawler**: Documents and projects are user-supplied; PrismOS does not perform
  general internet research.

### Data Flow Diagrams

See visual diagrams in:
- `docs/diagrams/architecture-overview.svg`
- `docs/diagrams/data-flow.svg`
- `docs/diagrams/refractive-pipeline.svg`
- `docs/diagrams/multi-agent-pipeline.svg`
- `docs/diagrams/security-model.svg`

These diagrams have not all been regenerated for the native action-policy simulator and
sequential goal loop. If a diagram mentions WASM isolation, generic rollback, or parallel
model debate, treat that portion as historical; the current source and this capability
snapshot are authoritative.

---

## Installation & Setup

### Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Node.js | ≥ 22.12 (Node 24 LTS recommended) | https://nodejs.org/ |
| Rust | 1.95.0 (pinned by `rust-toolchain.toml`) | https://rustup.rs/ |
| Ollama | Latest | https://ollama.com/ |

### Quick Start (Development)

```bash
# 1. Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# 2. Install frontend dependencies
npm install

# 3. Pull a local LLM model
ollama pull qwen3:4b

# 4. Start Ollama server
ollama serve &

# 5. Run in development mode
npm run tauri dev
```

### Pre-Built Installers (Production)

Download from: https://github.com/mkbhardwas12/prismos-ai/releases/latest

Release assets vary. Verify that the required platform asset exists and that its checksum
or signature matches the release instructions before installation. PrismOS does not
currently self-update in the background.

**Windows:**
- `.msi` installer (recommended) or `.exe`
- Double-click to install
- Requires Ollama installed separately

**macOS:**
- `.dmg` for Apple Silicon or Intel
- Drag to Applications folder
- Requires Ollama installed separately

**Linux:**
- `.deb` (Debian/Ubuntu): `sudo dpkg -i prismos*.deb`
- `.AppImage`: `chmod +x prismos*.AppImage && ./prismos*.AppImage`

**Mobile:** iOS and Android documents are planning material, not evidence of a
verified production build. Use only platform artifacts that are actually present
and validated in the referenced release.

---

## User Guide

### First Launch

1. **Onboarding Wizard**: Choose your preferred model and theme
2. **Model Download**: Install recommended models (llama3.2, llama3.2-vision)
3. **First Intent**: Type a question or request in the Intent Console

### Daily Workflow

#### Morning Brief

- Open **Daily Dashboard** (Ctrl+7)
- View local graph-derived highlights and proactive suggestions
- Email, calendar, and finance feeds are unavailable until private configuration and
  consent boundaries ship

#### Intent Console

- Type natural language requests
- Attach images with the 🖼️ button or drag-drop
- Upload bounded DOCX, PPTX, and allowlisted UTF-8 text/code, including CSV/TSV, with the
  📄 button. PDF parsing is disabled until resource-isolated; convert PDFs to UTF-8 text.
  XLSX and legacy `.xls` fail closed before parsing; export spreadsheets as CSV/TSV.
- Use browser-provided speech input with the 🎤 button when the system webview
  exposes it; real bundled Whisper transcription is unavailable

#### Spectrum Graph

- Visualize your knowledge graph (force-directed layout)
- Click nodes to view details
- Use **Spectrum Explorer** to search and manage nodes

#### Background Omnipresence

- Press `Alt+Space` from any app to summon PrismOS
- Window appears always-on-top, then releases after interaction
- Perfect for quick queries while working

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+1` | Intent Console |
| `Ctrl+2` | Spectrum Graph |
| `Ctrl+3` | Spectrum Explorer |
| `Ctrl+4` | Sandbox Prisms |
| `Ctrl+5` | Timeline |
| `Ctrl+6` | Settings |
| `Ctrl+7` | Daily Dashboard |
| `Ctrl+Space` / `Alt+Space` | Global hotkey (background omnipresence) |
| `Escape` | Close overlays |

### Advanced Features

#### Sandbox Prisms

- Inspect native action-policy classifications and authenticated records
- View policy history in Sandbox Panel
- Restore a Sandbox Prism's own checkpointed bookkeeping state
- Do not treat this as arbitrary code isolation or as an undo for filesystem, network,
  model, or database side effects

#### Portable Sync (Export/Import)

1. Go to Settings → Sync.
2. Enter a passphrase of at least 12 characters.
3. Export the encrypted sync package.
4. Transfer the package to another device without transferring the passphrase alongside it.
5. Preview and import the merge on the new device with the same passphrase.

Portable graph/sync packages intentionally omit managed Project Knowledge excerpts. The
separate `export_graph` command is device-secret-bound and is not a substitute for a
cross-device passphrase package or a drilled full-database recovery vault.

#### Full-Database Private-Vault Recovery Candidate

1. In Settings, choose a new `.prismos-vault` path **outside every Git worktree**.
2. Enter and confirm a passphrase of at least 16 characters.
3. Export the vault and keep its passphrase in a separate password manager or recovery
   record.
4. To restore, select the vault, enter its passphrase and the exact destructive
   confirmation phrase, then stage the restore.
5. Restart PrismOS. The authenticated database swap occurs before SQLite opens.
6. Verify important sources, conversations, feedback, and the audit chain.

The automated suite covers vault round trips, tampering, and interrupted swaps. A manual
operator restore drill on disposable app data is still pending and should be completed
before relying on a vault as the only recovery copy. Vault ciphertext contains personal
data and must not be committed to the public repository; the backend refuses Git-worktree
destinations.

#### Multi-Device Merge

1. Settings → Sync → Enter passphrase
2. Choose merge strategy (Latest Wins, Theirs Wins, Ours Wins)
3. Preview conflicts before merging
4. Confirm merge

---

## Developer Guide

### Project Structure

```
prismos-ai/
├── src/                          # React frontend
│   ├── components/               # UI components
│   ├── lib/                      # Core logic
│   ├── hooks/                    # React hooks
│   └── test/                     # Vitest tests
├── src-tauri/                    # Rust backend
│   └── src/
│       ├── lib.rs                # Tauri IPC command registration
│       ├── spectrum_graph.rs     # SQLite knowledge graph and retrieval
│       ├── refractive_core.rs    # Intent pipeline
│       ├── private_vault.rs      # Encrypted full-database recovery tooling
│       ├── project_knowledge.rs  # Approval-gated project ingestion
│       ├── sandbox_prism.rs      # Native action-policy simulator
│       ├── agents/               # Sequential answer loop + workflow roles
│       └── (additional modules)
├── docs/                         # Documentation + diagrams
├── .github/workflows/            # CI/CD pipelines
└── README.md
```

### Development Workflow

```bash
# Frontend type-check
npx tsc --noEmit

# Frontend tests
npx vitest run

# Backend tests
cd src-tauri && cargo test

# Backend lint
cd src-tauri && cargo clippy

# Full production build
npm run tauri build
```

### Adding a New Agent

1. Define agent in `src-tauri/src/agents/nodes.rs`
2. Add to DAG in `src-tauri/src/agents/mod.rs`
3. Update `lib/agents.ts` with frontend definition
4. Add agent UI in `src/components/ActiveAgents.tsx`

### Adding a New Tauri Command

1. Define command in `src-tauri/src/lib.rs`
2. Register in `tauri::Builder` invocation handler
3. Call from frontend: `invoke('command_name', { params })`

### Testing

**Frontend (Vitest):**
- Tests cover components, hooks, and utilities
- Run: `npx vitest run`

**Backend (Cargo):**
- Tests cover modules and integration
- Run: `cd src-tauri && cargo test`

---

## API Reference

### Selected Tauri Commands

This is an orientation aid, not a generated API specification. Command names and payloads
can change; `tauri::generate_handler!` in `src-tauri/src/lib.rs` is authoritative.

#### Intent Processing

```typescript
// Process intent through full Refractive Core pipeline
invoke('process_intent', { input: string }): Promise<string>

// Get full refraction result with metadata
invoke('process_intent_full', { input: string }): Promise<RefractiveResult>

// Typed command used by the GUI chat path
invoke('refract_intent', {
  input: string,
  model?: string,
  requestId: string
}): Promise<string>
```

The generic `query_ollama` and `query_ollama_stream` prototypes are disabled.
Private inference commands do not accept an Ollama URL from the caller.

#### Spectrum Graph Operations

```typescript
// Add a node to the graph
invoke('add_spectrum_node', {
  label: string,
  content: string,
  nodeType: string
}): Promise<string>

// Query nodes by content
invoke('search_spectrum_nodes', { query: string }): Promise<string>

// Get all nodes
invoke('get_spectrum_nodes'): Promise<string>

// Get node by ID
invoke('get_spectrum_node', { id: string }): Promise<string>

// Add an edge between nodes
invoke('add_spectrum_edge', {
  sourceId: string,
  targetId: string,
  relation: string,
  weight: number
}): Promise<string>

// Get node edges
invoke('get_node_connections', { nodeId: string }): Promise<string>

// Delete node
invoke('delete_spectrum_node', { id: string }): Promise<void>

// Update node content
invoke('update_spectrum_node', {
  id: string,
  label: string,
  content: string
}): Promise<void>
```

#### Vision & Document Analysis

```typescript
// Analyze image with vision model
invoke('query_ollama_vision', {
  prompt: string,
  imageData: string,  // base64
  model?: string
}): Promise<string>

// Extract text from frontend-supplied document bytes
invoke('extract_document_from_bytes', {
  data: string,
  fileName: string
}): Promise<string>

// Build ephemeral in-memory retrieval context
invoke('chunk_document', {
  text: string,
  source: string
}): Promise<string>

invoke('rag_query', {
  documentText: string,
  query: string,
  source: string
}): Promise<string>

// Analyze only the bounded context through fixed-loopback inference
invoke('analyze_document_context', {
  context: string,
  query: string,
  source: string,
  model?: string,
  maxTokens?: number
}): Promise<string>
```

These one-off document commands do not persist attachment chunks. The retired
general arbitrary-path image/document read commands are not part of the supported
IPC surface; the frontend supplies the selected attachment content. Durable source
ingestion requires the separate Project Knowledge preview and approval flow. The
production extraction boundary accepts bounded DOCX, PPTX, and allowlisted UTF-8
text/code, including CSV/TSV. PDF parsing is disabled until it can be resource-isolated;
convert PDFs to UTF-8 text. XLSX and legacy `.xls` fail closed before parsing; export
spreadsheets as CSV/TSV. Project Knowledge separately indexes allowlisted UTF-8 text/code
files only.

#### Model Management

```typescript
// Model-management/status commands; ollamaUrl is never an inference destination
invoke('list_ollama_models', { ollamaUrl?: string }): Promise<string>

// Pull a model
invoke('pull_ollama_model', { model: string, ollamaUrl?: string }): Promise<string>
// Listen to 'pull-progress' events

// Delete a model
invoke('delete_ollama_model', { modelName: string, ollamaUrl?: string }): Promise<string>

// Advisory metadata compatibility check. This fingerprints model name/family/
// parameter/quantization metadata returned by Ollama; it does not hash the model
// blob or establish publisher authenticity, integrity, or absence of tampering.
invoke('inspect_model_metadata', { model: string }): Promise<string>

// Smart model routing
invoke('smart_route_model', {
  userModel: string,
  hasImage: boolean,
  hasDocument: boolean,
  hasCode?: boolean
}): Promise<string>
```

#### Sandbox Prism

```typescript
// Create a named native action-policy simulator
invoke('create_sandbox', {
  name: string,
  agentId?: string
}): Promise<string>

// Classify and record an action string; this does not execute model-authored code
invoke('execute_in_sandbox', {
  action: string,
  agentId: string
}): Promise<string>

// Restore only the simulator's own checkpointed state
invoke('rollback_sandbox', { name: string }): Promise<string>
```

#### Graph, Sync, and Private-Vault Export

```typescript
// Device-secret-bound encrypted graph package
invoke('export_graph'): Promise<string>

// Merge a compatible device-bound graph package
invoke('import_graph', {
  packageJson: string
}): Promise<string>

// Cross-device, passphrase-encrypted portable package
invoke('export_sync_package', {
  passphrase: string
}): Promise<string>

invoke('preview_sync_merge', {
  packageJson: string,
  passphrase: string,
  strategy: 'latest' | 'theirs' | 'ours'
}): Promise<string>
```

Portable exports do not contain managed Project Knowledge excerpts. Full-database
recovery candidates use separate commands; complete a clean-profile restore drill
before treating one as recovery media:

```typescript
invoke('export_private_vault', {
  destination: string, // new .prismos-vault path outside Git
  passphrase: string
}): Promise<string>

invoke('stage_private_vault_restore', {
  packagePath: string,
  passphrase: string,
  confirmation: 'RESTORE MY PRIVATE PRISMOS VAULT'
}): Promise<string> // restart required
```

---

## Security Model

### Defense-in-Depth

1. **Native Action Policy**
   - Guarded action strings are classified by bounded native Rust logic
   - Per-role allow-lists and risk tiers determine the simulator result
   - PrismOS does not execute untrusted actions inside Wasmtime/WASM

2. **Process-Local HMAC-SHA256 Records**
   - Ephemeral Action Policy records are authenticated and checked inside the process
   - One OS-random process-local key is used; it is not per-Prism, persisted, hardware-sealed, or an external authorization signature

3. **3-Tier Allow-List**
   - Safe: File reads, queries (no confirmation)
   - Moderate: File writes, network (user prompt)
   - Restricted: System commands (blocked by default)

4. **Anomaly Detection**
   - Injection attempt detection
   - Abuse loop detection (>5 similar operations in 1s)
   - Tier escalation detection

5. **Checkpoint Rollback**
   - Restores checkpointed policy-simulator bookkeeping
   - Plain-English explanation provided
   - This is not a generic undo for filesystem, network, model, or database side effects

6. **Tamper-Evident Audit Chain**
   - SHA-256 hash chain with genesis entry
   - O(n) verification across the retained entries
   - Tamper-evident history

7. **Encrypted Recovery Packages**
   - Portable You-Port packages use authenticated encryption and omit managed project excerpts
   - Full private vaults use passphrase-derived authenticated encryption, include the full
     database/audit scope, and refuse Git-worktree destinations
   - Restore is staged and applied before SQLite opens on restart

### Data Privacy

- **Fixed private-inference boundary**: Chat, document, vision, and workflow calls use
  `http://localhost:11434`; settings cannot redirect them
- **Separate management boundary**: `PRISMOS_ALLOW_REMOTE_OLLAMA=1` can admit a
  non-loopback URL for explicit model management/status only
- **Explicit network boundaries**: Model downloads and browser-provided speech services
  can use the network when invoked
- **Ephemeral attachments**: One-off document chunks are not auto-ingested into the graph
- **No PrismOS Telemetry**: The first-party source has no application telemetry endpoint
- **Account-private Storage**: SQLite is plaintext at rest; Unix permissions restrict it to the OS account
- **Encrypted Recovery Exports**: AES-256-GCM packages protect portable state; treat Private Vaults as recovery candidates until a clean-profile restore drill passes
- **No general web research**: PrismOS does not crawl or search the public internet
- **Unavailable prototypes**: Email, calendar, and finance Tauri commands are not registered

---

## Troubleshooting

### Ollama Connection Issues

**Problem**: "Ollama connection failed"

**Solutions**:
1. Ensure Ollama is running: `ollama serve`
2. Test the fixed private-inference endpoint:
   `curl http://localhost:11434/api/tags`
3. The Ollama URL in Settings controls model management/status only and cannot redirect
   private inference.

### Model Not Found

**Problem**: "Model 'qwen3:4b' not found"

**Solutions**:
1. Pull the model: `ollama pull qwen3:4b`
2. Use Model Hub in Settings to download models
3. Check installed models: `ollama list`

### Vision Model Issues

**Problem**: Image analysis fails

**Solutions**:
1. Install a vision model: `ollama pull llama3.2-vision` or `ollama pull llava`
2. PrismOS will auto-detect and switch
3. Check Smart Model Routing in Settings

### High Memory Usage

**Problem**: App uses >2 GB RAM

**Solutions**:
1. Select a smaller Ollama model or reduce model context
2. Clear old nodes in Spectrum Explorer
3. Use smaller models (e.g., `gemma2:2b` instead of `llama3.1`)

### Database Corruption

**Problem**: SQLite errors on startup

**Solutions**:
1. Stop PrismOS and preserve the entire app-data directory before troubleshooting.
2. If the UI still opens, create a full `.prismos-vault` outside Git before making changes.
3. Validate a known-good vault and stage its restore; restart PrismOS to apply it.
4. Do not delete the live database unless you have separately verified recovery media.
5. The automated restore path has tests, but a release/operator restore drill is still pending.

---

## FAQ

### General

**Q: Is my data sent to the cloud?**
A: Private chat, document, vision, and workflow inference is fixed to
`http://localhost:11434`. `PRISMOS_ALLOW_REMOTE_OLLAMA=1` applies only to a
configured model-management/status origin; it does not permit remote inference.
Model downloads and browser-provided speech services can use the network when invoked.
Email/calendar/finance commands are unavailable, and there is no general web crawler.

**Q: Can I use cloud LLMs like GPT-4?**
A: Not currently. PrismOS is designed for local-first privacy. Cloud integration would compromise this principle.

**Q: What models work best?**
A: For text: `llama3.2`, `mistral`, `deepseek-r1`. For vision: `llama3.2-vision`, `llava`.

**Q: Does PrismOS work offline?**
A: Core chat, ephemeral one-off document analysis, and approved Project Knowledge work
through fixed-loopback Ollama after models are installed. That loopback fact does not
attest whether the separately installed Ollama daemon is itself offline. Downloads and
browser-provided speech services may need the network.

### Technical

**Q: How large is the Spectrum Graph?**
A: Million-node scale has not been qualified. Each imported snapshot currently fails
closed above 25,000 nodes, 100,000 edges, 96 MiB of input, or 64 MiB of aggregate text;
live-database performance depends on content size, hardware, and query shape.

**Q: Can I export my graph?**
A: Yes. A portable You-Port/sync package omits managed Project Knowledge excerpts. For a full-database recovery candidate, create a `.prismos-vault` outside Git; it includes the full SQLite database and the audit log when present, and is applied on restart after validation. Complete the documented clean-profile restore drill and keep independent backups before relying on it.

**Q: What platforms are supported?**
A: The source targets Tauri desktop. Treat only the platform artifacts present in a
specific release as supported binaries. The iOS/Android material is not a verified
production release claim.

**Q: Does it support iOS?**
A: Not yet. iOS support is in development (see roadmap).

### Privacy & Security

**Q: How is encryption handled?**
A: Portable You-Port packages and passphrase-protected private vaults use AES-256-GCM authenticated encryption. The live Spectrum Graph database is not encrypted at rest; on Unix it is restricted to the current OS account. Keep the vault and passphrase separate and never commit either to the public repository.

**Q: Can agents access my files without permission?**
A: Project Knowledge performs a metadata-only preview and reads a bounded root only after approval. Source files are read-only. Chat does not currently have arbitrary filesystem or shell authority.

---

## Roadmap

### v0.6.0 (Next)
- Evaluate a production-grade, explicitly consented local transcription path
- Plugin Marketplace
- Evaluate approval-gated refresh automation without reviving silent ingestion

### v0.7.0 (Planned)
- Research only: privacy-preserving learning approaches (no commitment to autonomous training)
- P2P sync between devices
- Mobile companion app (iOS + Android native)
- Custom spectral dimensions

### Future
- Harden and document the explicit, human-gated model flywheel
- Optional bounded parallel candidate evaluation, only after resource and consent controls
- Spectral API for external integrations
- Plugin SDK for third-party developers

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup, code style, and contribution guidelines.

---

## License

MIT License — See [LICENSE](../LICENSE)

---

**PrismOS-AI source guide** — Your work, your machine, your control.

Built by [Manish Kumar](https://github.com/mkbhardwas12)
