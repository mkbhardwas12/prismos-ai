# PrismOS-AI Comprehensive Guide

> **Patent Pending** — US Provisional Patent filed February 2026

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

PrismOS-AI is a **local-first agentic personal AI operating system** that runs entirely on your device. Unlike cloud-based AI assistants, PrismOS-AI ensures that your data never leaves your machine. It combines eight collaborative AI agents with a persistent 7-dimensional knowledge graph called the Spectrum Graph, creating a personal AI OS that grows with you.

### Key Innovations (Patent Pending)

- **Spectrum Graph™**: 7-dimensional knowledge representation (cognitive, emotional, temporal, social, creative, analytical, physical)
- **Refractive Core™**: Intent processing pipeline that refracts user inputs through the knowledge graph
- **Sandbox Prism™**: WASM-isolated execution environment with cryptographic signing
- **You-Port™**: Encrypted state migration for cross-device synchronization

### Current Version

**v0.5.1** — Released March 2026

---

## Core Concepts

### The Eight AI Agents

PrismOS-AI employs eight specialized agents that work collaboratively:

1. **Orchestrator**: Coordinates multi-agent workflows and manages task distribution
2. **Memory Keeper**: Manages the Spectrum Graph, stores knowledge, and maintains context
3. **Reasoner**: Performs logical analysis, pattern recognition, and inference
4. **Tool Smith**: Handles code execution, file operations, and system interactions
5. **Sentinel**: Security guardian that validates all operations before execution
6. **Email Keeper**: Monitors IMAP inbox, provides summaries, and smart notifications
7. **Calendar Keeper**: Manages local .ics calendar integration and scheduling
8. **Finance Keeper**: Tracks portfolios, provides market alerts, and financial insights

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
→ Agent Selection → Multi-Agent Debate (LangGraph) → Consensus Voting
→ Sandbox Prism (safe execution) → Response + Graph Update
```

---

## Architecture Deep Dive

### System Layers

#### Layer 1: Frontend (React 18 + TypeScript)

**18 Components:**
- MainView, IntentInput, DailyDashboard, ProactivePanel
- SpectrumGraphView, SpectrumExplorer, SpectralTimeline
- SandboxPanel, SettingsPanel, TitleBar, Sidebar
- OnboardingWizard, SpotlightOverlay, ActiveAgents
- DailyBrief, DailySuggestions, SuggestionCard, ErrorBoundary

**Key Hooks:**
- `useChat.ts`: Conversation state management
- `useOllama.ts`: Ollama connection lifecycle
- `useVoice.ts`: Hybrid voice input (Whisper + Web Speech API)
- `useSuggestions.ts`: Proactive suggestion engine

#### Layer 2: IPC Bridge (Tauri 2.0)

**83 Tauri Commands** covering:
- Intent processing and refraction
- Spectrum Graph CRUD operations
- Sandbox Prism execution and rollback
- Ollama model management and inference
- Voice recording and transcription
- File indexing and RAG
- Document analysis (PDF, DOCX, PPTX, XLSX)
- Vision model routing and inference
- Email/Calendar/Finance keeper operations

#### Layer 3: Backend (Rust)

**17 Core Modules:**
- `spectrum_graph.rs` (~2300 lines): SQLite-backed 7D graph
- `refractive_core.rs` (~600 lines): Intent processing pipeline
- `sandbox_prism.rs` (~1100 lines): WASM isolation + cryptographic signing
- `ollama_bridge.rs` (~195 lines): LLM inference client
- `you_port.rs` (~400 lines): AES-256-GCM encrypted export/import
- `audit_log.rs` (~200 lines): SHA-256 tamper-evident hash chain
- `secure_enclave.rs` (~100 lines): Platform-specific key derivation
- `intent_lens.rs`: Natural language parsing
- `model_verify.rs`: Model integrity verification
- `whisper_engine.rs`: Local voice transcription
- `file_indexer.rs`: RAG file watcher
- `smart_router.rs`: Auto model switching
- `doc_chunker.rs`: Document chunking + TF-IDF retrieval
- `email_keeper.rs`: IMAP email integration
- `calendar_keeper.rs`: .ics calendar parsing
- `finance_keeper.rs`: Portfolio tracking

**Agent Sub-Modules:**
- `agents/mod.rs`: Agent DAG definitions
- `agents/graph.rs`: LangGraph execution engine
- `agents/langgraph_workflow.rs`: Workflow orchestration
- `agents/messages.rs`: Inter-agent message protocol
- `agents/nodes.rs`: Individual agent implementations

#### Layer 4: Storage & Inference

- **SQLite Database**: 3-table schema (nodes, edges, spectra)
- **Local Ollama**: 100% local LLM inference, no cloud
- **File System**: Indexed documents in `~/Documents/PrismDocs`

### Data Flow Diagrams

See visual diagrams in:
- `docs/diagrams/architecture-overview.svg`
- `docs/diagrams/data-flow.svg`
- `docs/diagrams/refractive-pipeline.svg`
- `docs/diagrams/multi-agent-pipeline.svg`
- `docs/diagrams/security-model.svg`

---

## Installation & Setup

### Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Node.js | ≥ 18 | https://nodejs.org/ |
| Rust | ≥ 1.75 | https://rustup.rs/ |
| Ollama | Latest | https://ollama.com/ |

### Quick Start (Development)

```bash
# 1. Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# 2. Install frontend dependencies
npm install

# 3. Pull a local LLM model
ollama pull llama3.2

# 4. Start Ollama server
ollama serve &

# 5. Run in development mode
npm run tauri dev
```

### Pre-Built Installers (Production)

Download from: https://github.com/mkbhardwas12/prismos-ai/releases/latest

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

**Android:**
- `.apk` file available in releases
- Enable "Install from unknown sources" in Settings
- Note: Ollama integration limited on mobile

---

## User Guide

### First Launch

1. **Onboarding Wizard**: Choose your preferred model and theme
2. **Model Download**: Install recommended models (llama3.2, llama3.2-vision)
3. **First Intent**: Type a question or request in the Intent Console

### Daily Workflow

#### Morning Brief

- Open **Daily Dashboard** (Ctrl+7)
- View calendar events, email summaries, and highlights
- Review proactive suggestions

#### Intent Console

- Type natural language requests
- Attach images with the 🖼️ button or drag-drop
- Upload documents (PDF, DOCX, PPTX, XLSX) with the 📄 button
- Use voice input with the 🎤 button

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

- Safe code execution in WASM containers
- View execution history in Sandbox Panel
- Rollback anomalous actions with one click

#### You-Port (Export/Import)

1. Go to Settings → You-Port
2. Enter a passphrase
3. Click "Export Graph"
4. Transfer the encrypted file to another device
5. Import on the new device with the same passphrase

#### Multi-Device Sync

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
│   ├── components/               # 18 UI components
│   ├── lib/                      # Core logic
│   ├── hooks/                    # React hooks
│   └── test/                     # 97 Vitest tests
├── src-tauri/                    # Rust backend
│   └── src/
│       ├── lib.rs                # 83 IPC commands
│       ├── spectrum_graph.rs     # 7D knowledge graph
│       ├── refractive_core.rs    # Intent pipeline
│       ├── sandbox_prism.rs      # WASM isolation
│       ├── agents/               # Multi-agent system
│       └── (14+ more modules)
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
- 97 tests covering components, hooks, and utilities
- Run: `npx vitest run`

**Backend (Cargo):**
- 65 tests covering modules and integration
- Run: `cd src-tauri && cargo test`

**Total: 162 tests**

---

## API Reference

### Tauri Commands (83 total)

#### Intent Processing

```typescript
// Process intent through full Refractive Core pipeline
invoke('process_intent', { input: string }): Promise<string>

// Get full refraction result with metadata
invoke('process_intent_full', { input: string }): Promise<RefractiveResult>

// Direct Ollama query (bypass agents)
invoke('query_ollama', {
  prompt: string,
  model?: string,
  ollama_url?: string,
  max_tokens?: number
}): Promise<string>

// Streaming Ollama query
invoke('query_ollama_stream', {
  prompt: string,
  model?: string,
  ollama_url?: string,
  max_tokens?: number
}): Promise<string>
// Listen to 'ollama-stream' events
```

#### Spectrum Graph Operations

```typescript
// Add a node to the graph
invoke('add_node', { content: string, spectra: number[] }): Promise<number>

// Query nodes by content
invoke('query_nodes', { query: string }): Promise<Node[]>

// Get all nodes
invoke('get_all_nodes'): Promise<Node[]>

// Get node by ID
invoke('get_node', { id: number }): Promise<Node>

// Add an edge between nodes
invoke('add_edge', {
  from_id: number,
  to_id: number,
  edge_type: string
}): Promise<void>

// Get node edges
invoke('get_edges', { node_id: number }): Promise<Edge[]>

// Delete node
invoke('delete_node', { id: number }): Promise<void>

// Update node content
invoke('update_node', {
  id: number,
  content: string
}): Promise<void>
```

#### Vision & Document Analysis

```typescript
// Analyze image with vision model
invoke('query_ollama_vision', {
  prompt: string,
  image_data: string,  // base64
  model?: string,
  ollama_url?: string
}): Promise<string>

// Read image file as base64
invoke('read_image_as_base64', { path: string }): Promise<string>

// Extract text from document
invoke('extract_file_text', { path: string }): Promise<string>

// Document analysis with RAG
invoke('chunk_document', { text: string }): Promise<DocChunk[]>

invoke('rag_query', {
  chunks: DocChunk[],
  query: string
}): Promise<string>
```

#### Model Management

```typescript
// List installed Ollama models
invoke('list_ollama_models'): Promise<Model[]>

// Pull a model
invoke('pull_ollama_model', { model: string }): Promise<void>
// Listen to 'pull-progress' events

// Delete a model
invoke('delete_ollama_model', { model: string }): Promise<void>

// Smart model routing
invoke('smart_route_model', {
  current_model: string,
  has_image: boolean,
  has_document: boolean
}): Promise<RoutingDecision>
```

#### Sandbox Prism

```typescript
// Execute code in sandbox
invoke('execute_prism', {
  code: string,
  language: string
}): Promise<ExecutionResult>

// Rollback prism execution
invoke('rollback_prism', { prism_id: string }): Promise<void>

// Get sandbox history
invoke('get_sandbox_history'): Promise<SandboxEntry[]>
```

#### You-Port (Export/Import)

```typescript
// Export encrypted graph
invoke('export_graph', { passphrase: string }): Promise<string>

// Import encrypted graph
invoke('import_graph', {
  data: string,
  passphrase: string
}): Promise<void>
```

---

## Security Model

### Defense-in-Depth (7 Layers)

1. **WASM Sandbox Isolation**
   - Every agent action runs in wasmtime container
   - Memory limits: 1-16 MB configurable
   - CPU fuel metering: max 100M instructions

2. **HMAC-SHA256 Signing**
   - All actions cryptographically signed
   - Per-prism salt via Secure Enclave
   - Replay attack prevention

3. **3-Tier Allow-List**
   - Safe: File reads, queries (no confirmation)
   - Moderate: File writes, network (user prompt)
   - Restricted: System commands (blocked by default)

4. **Anomaly Detection**
   - Injection attempt detection
   - Abuse loop detection (>5 similar operations in 1s)
   - Tier escalation detection

5. **Auto-Rollback**
   - Anomalous actions automatically reverted
   - Plain-English explanation provided
   - No user data loss

6. **Tamper-Evident Audit Chain**
   - SHA-256 hash chain with genesis entry
   - O(1) verification
   - Immutable history

7. **Secure Enclave**
   - Windows: TPM 2.0
   - macOS: Secure Enclave
   - Linux: TPM device or fallback key derivation

### Data Privacy

- **100% Local**: All processing on-device
- **No Cloud**: No data sent to external servers
- **No Telemetry**: Zero usage tracking
- **Encrypted Storage**: SQLite database at rest
- **Encrypted Export**: AES-256-GCM for You-Port

---

## Troubleshooting

### Ollama Connection Issues

**Problem**: "Ollama connection failed"

**Solutions**:
1. Ensure Ollama is running: `ollama serve`
2. Check Ollama URL in Settings (default: `http://localhost:11434`)
3. Test with: `curl http://localhost:11434/api/tags`

### Model Not Found

**Problem**: "Model 'llama3.2' not found"

**Solutions**:
1. Pull the model: `ollama pull llama3.2`
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
1. Reduce sandbox memory limits in Settings
2. Clear old nodes in Spectrum Explorer
3. Use smaller models (e.g., `gemma2:2b` instead of `llama3.1`)

### Database Corruption

**Problem**: SQLite errors on startup

**Solutions**:
1. Backup: Copy database from app data directory
2. Export via You-Port before reset
3. Delete database file to reset (WARNING: loses all data)
4. Reimport from You-Port export

---

## FAQ

### General

**Q: Is my data sent to the cloud?**
A: No. PrismOS-AI is 100% local. All inference happens via local Ollama models. No data ever leaves your machine.

**Q: Can I use cloud LLMs like GPT-4?**
A: Not currently. PrismOS is designed for local-first privacy. Cloud integration would compromise this principle.

**Q: What models work best?**
A: For text: `llama3.2`, `mistral`, `deepseek-r1`. For vision: `llama3.2-vision`, `llava`.

**Q: Does PrismOS work offline?**
A: Yes, completely. Once models are downloaded, no internet connection is needed.

### Technical

**Q: How large is the Spectrum Graph?**
A: Scales to millions of nodes. Typical usage: 1000-10000 nodes, <100 MB database.

**Q: Can I export my graph?**
A: Yes, via You-Port (Settings → You-Port → Export). Creates an encrypted file you can import on another device.

**Q: What platforms are supported?**
A: Windows, macOS (Intel + Apple Silicon), Linux (Debian, AppImage), Android (experimental).

**Q: Does it support iOS?**
A: Not yet. iOS support is in development (see roadmap).

### Privacy & Security

**Q: Is the patent notice a concern?**
A: The open-source MIT license allows free personal and educational use. The patent protects the core architectures (Spectrum Graph, Refractive Core, You-Port) from unauthorized commercial exploitation.

**Q: How is encryption handled?**
A: You-Port uses AES-256-GCM encryption. Keys derived via platform-specific Secure Enclave (TPM on Windows/Linux, Secure Enclave on macOS).

**Q: Can agents access my files without permission?**
A: No. All file operations go through Sentinel agent and require user confirmation for write operations. Reads are restricted to indexed directories.

---

## Roadmap

### v0.6.0 (Next)
- Whisper.cpp local transcription
- Plugin Marketplace
- Settings UI for voice/indexer paths

### v0.7.0 (Planned)
- Federated learning (privacy-preserving)
- P2P sync between devices
- Mobile companion app (iOS + Android native)
- Custom spectral dimensions

### Future
- Custom model fine-tuning pipeline
- Spectral API for external integrations
- Plugin SDK for third-party developers

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup, code style, and contribution guidelines.

---

## License

MIT License — See [LICENSE](../LICENSE)

**Patent Pending** — US Provisional Patent filed February 2026

---

**PrismOS-AI v0.5.1** — Your mind, your machine, your OS.

Built by [Manish Kumar](https://github.com/mkbhardwas12)
