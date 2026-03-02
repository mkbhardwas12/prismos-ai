<p align="center">
  <img src="src/assets/prismos-icon.png" width="100" alt="PrismOS Logo" />
</p>

<h1 align="center">PrismOS</h1>

<p align="center">
  <strong>Local-First Agentic Personal AI Operating System</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0--alpha-blueviolet" alt="Version" />
  <img src="https://img.shields.io/badge/patent-US%2063%2F993%2C589-orange" alt="Patent Pending" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/100%25-Local-brightgreen" alt="100% Local" />
</p>

<p align="center">
  A fully local, privacy-first AI operating system that learns and evolves with you.<br/>
  Built on the <strong>Spectrum Graph™</strong> — a patent-pending knowledge representation<br/>
  that refracts every interaction into spectral dimensions of meaning.
</p>

---

## ⚡ What is PrismOS?

PrismOS is a desktop AI operating system that runs **entirely on your machine** — no cloud, no telemetry, no data leaving your device. It combines:

- **Spectrum Graph™** — Persistent multi-dimensional knowledge graph
- **Refractive Core™** — Intent processing through spectral analysis
- **Multi-Agent Collaboration** — Five specialized AI agents (Planner, Researcher, Coder, Reviewer, Executor) that collaborate via structured messaging, voting, and consensus
- **Sandbox Prisms** — Secure, isolated execution environments with HMAC-SHA256 verification, allow-lists, anomaly detection, and auto-rollback
- **You-Port™** — Encrypted state migration that lets you carry your AI personality across devices
- **100% Local** — Powered by Ollama running local LLMs (Mistral, Llama, etc.)

---

## 🏗️ Architecture

PrismOS follows a **6-layer architecture** as described in the patent:

| Layer | Name | Status | Description |
|-------|------|--------|-------------|
| L1 | **Spectrum Graph** | ✅ Implemented | Spectral knowledge graph with 7-dimensional node embeddings, edge scoring, temporal decay, and SQLite persistence |
| L2 | **Refractive Core** | ✅ Implemented | Intent parsing → graph traversal → spectral weighting → LLM synthesis pipeline |
| L3 | **Agent Mesh** | ✅ Implemented | LangGraph-inspired DAG with 5 agents, structured messages, voting/consensus, 6-phase pipeline |
| L4 | **Sandbox Prisms** | ✅ Implemented | HMAC-SHA256 code signing, syscall allow-lists, anomaly detection, WASM-ready isolation, auto-rollback |
| L5 | **You-Port** | ✅ Implemented | Encrypted state export/import with device fingerprinting, XOR stream cipher, HMAC key derivation |
| L6 | **Intent Console** | ✅ Implemented | React UI with conversation history, agent status, graph visualization, settings, and export/import |

---

## 📸 Screenshots

<!-- TODO: Add screenshots after first release -->

| Intent Console | Spectrum Explorer | Agent Status |
|:-:|:-:|:-:|
| *Coming soon* | *Coming soon* | *Coming soon* |

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | ≥ 18 | Frontend build tooling |
| [Rust](https://rustup.rs/) | ≥ 1.75 | Tauri backend |
| [Ollama](https://ollama.com/) | Latest | Local LLM inference |

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# 2. Install frontend dependencies
npm install

# 3. Pull a local model (Mistral recommended)
ollama pull mistral

# 4. Start Ollama (if not already running)
ollama serve

# 5. Launch PrismOS in development mode
npm run tauri dev
```

The app will compile Rust (~2 min first time), then open the PrismOS desktop window.

### Build for Production

```bash
npm run tauri build
```

The installer will be generated in `src-tauri/target/release/bundle/`.

---

## 🧬 Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop Shell | **Tauri 2.0** (Rust + WebView) |
| Frontend | **React 18.3** + **TypeScript 5.5** + **Vite 5.4** |
| Backend | **Rust** (4,586 lines across 12 source files) |
| Database | **SQLite** (via rusqlite, bundled) |
| LLM Runtime | **Ollama** (localhost:11434) |
| Graph Viz | **react-force-graph-2d** |
| Crypto | **SHA-256** + **HMAC-SHA256** + **XOR stream cipher** |

### Codebase at a Glance

| Metric | Count |
|--------|------:|
| Rust source files | 12 |
| Rust lines of code | ~4,586 |
| TypeScript/TSX files | 14 |
| TypeScript/React lines | ~2,256 |
| CSS lines | ~2,245 |
| Tauri IPC commands | 37 |
| **Total lines** | **~9,087** |

---

## 📁 Project Structure

```
PrismOS/
├── src/                          # React frontend
│   ├── App.tsx                   # Main shell, routing, startup sequence
│   ├── App.css                   # Global design system (2,245 lines)
│   ├── main.tsx                  # React entry point
│   ├── components/
│   │   ├── MainView.tsx          # Intent Console with conversation history
│   │   ├── SettingsPanel.tsx     # Settings, export/import, theme, about
│   │   ├── Sidebar.tsx           # Navigation sidebar with agent status
│   │   ├── IntentInput.tsx       # Intent input with submit handling
│   │   ├── ActiveAgents.tsx      # Live agent status cards
│   │   ├── SandboxPanel.tsx      # Sandbox Prisms security dashboard
│   │   ├── SpectrumExplorer.tsx  # Graph node browser with spectra
│   │   └── SpectrumGraphView.tsx # Force-directed graph visualization
│   ├── lib/
│   │   ├── agents.ts             # Agent Tauri bindings
│   │   └── ollama.ts             # Ollama API client
│   ├── types/
│   │   └── index.ts              # TypeScript type definitions
│   └── assets/
│       └── prismos-icon.png      # App icon
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri window & app config
│   ├── capabilities/             # Tauri 2.0 permission capabilities
│   └── src/
│       ├── lib.rs                # 37 Tauri IPC commands (514 lines)
│       ├── main.rs               # Tauri entry point
│       ├── spectrum_graph.rs     # Spectrum Graph™ engine (1,191 lines)
│       ├── refractive_core.rs    # Refractive Core™ pipeline (452 lines)
│       ├── sandbox.rs            # Sandbox Prisms security (710 lines)
│       ├── you_port.rs           # You-Port™ encrypted migration (460 lines)
│       ├── db.rs                 # SQLite schema & migrations (109 lines)
│       ├── ollama.rs             # Ollama HTTP client (89 lines)
│       └── agents/               # LangGraph multi-agent system
│           ├── mod.rs            # Agent module exports (37 lines)
│           ├── graph.rs          # DAG execution engine (287 lines)
│           ├── messages.rs       # Structured message types (251 lines)
│           └── nodes.rs          # 5 agent node implementations (480 lines)
├── agents/                       # Python agent stubs (future)
│   ├── __init__.py
│   ├── planner.py
│   └── researcher.py
├── README.md
├── LICENSE                       # MIT License
└── package.json
```

---

## 🔌 Tauri IPC Commands

PrismOS exposes **37 Tauri commands** for frontend–backend communication:

<details>
<summary>Click to expand full command list</summary>

| Category | Command | Description |
|----------|---------|-------------|
| **Core** | `process_intent` | Run intent through Refractive Core pipeline |
| **Core** | `get_graph_stats` | Get node/edge counts and graph statistics |
| **Core** | `check_ollama` | Verify Ollama is running and responsive |
| **Core** | `query_ollama` | Direct LLM query to Ollama |
| **Graph CRUD** | `add_node` | Add a node to the Spectrum Graph |
| **Graph CRUD** | `add_edge` | Add a weighted edge between nodes |
| **Graph CRUD** | `get_node` | Retrieve a node by ID |
| **Graph CRUD** | `get_all_nodes` | List all nodes in the graph |
| **Graph CRUD** | `get_neighbors` | Get neighboring nodes |
| **Graph CRUD** | `search_nodes` | Full-text search across nodes |
| **Graph CRUD** | `delete_node` | Remove a node and its edges |
| **Graph CRUD** | `update_node_spectra` | Update spectral dimensions of a node |
| **Patent Spectra** | `refract_query` | Refract a query through spectral analysis |
| **Patent Spectra** | `get_spectral_profile` | Get a node's 7-dimensional spectral profile |
| **Patent Spectra** | `get_spectral_clusters` | Cluster nodes by spectral similarity |
| **Patent Spectra** | `apply_temporal_decay` | Apply time-based decay to spectral weights |
| **Patent Spectra** | `spectral_search` | Search by spectral dimension similarity |
| **Patent Spectra** | `merge_spectral_profiles` | Merge two spectral profiles |
| **Patent Spectra** | `get_resonance_score` | Calculate resonance between two nodes |
| **Persistence** | `persist_graph` | Save graph to SQLite |
| **Persistence** | `load_graph` | Load graph from SQLite |
| **Persistence** | `export_graph_json` | Export graph as JSON |
| **Persistence** | `get_db_stats` | Get database statistics |
| **Agents** | `run_agent_pipeline` | Execute multi-agent DAG pipeline |
| **Ollama** | `list_ollama_models` | List available Ollama models |
| **Ollama** | `set_ollama_model` | Switch active model |
| **Sandbox** | `sandbox_execute` | Execute code in sandbox |
| **Sandbox** | `sandbox_verify` | Verify code signature |
| **Sandbox** | `sandbox_get_anomalies` | Get anomaly detection log |
| **Sandbox** | `sandbox_rollback` | Rollback sandbox state |
| **You-Port** | `save_state` | Encrypt and save state to disk |
| **You-Port** | `load_state` | Load and decrypt saved state |
| **You-Port** | `has_saved_state` | Check if saved state exists |
| **You-Port** | `get_device_fingerprint` | Get current device fingerprint |
| **You-Port** | `you_port_status` | Get You-Port migration status |
| **Settings** | `export_graph` | Export encrypted graph backup |
| **Settings** | `import_graph` | Import encrypted graph backup |
| **Settings** | `clear_graph` | Clear all graph data |

</details>

---

## 🧠 How It Works

### The Refractive Pipeline

```
User Intent
    │
    ▼
┌─────────────────┐
│  Intent Parsing  │  ← Extract keywords, entities, context
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Graph Traversal  │  ← Find relevant nodes via spectral search
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Spectral Weight  │  ← Score by 7 dimensions × temporal decay
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM Synthesis   │  ← Ollama generates response with context
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Graph Learning  │  ← New nodes/edges created from interaction
└─────────────────┘
```

### Multi-Agent Collaboration (LangGraph-style)

```
Intent
  │
  ▼
┌──────────┐    ┌────────────┐    ┌────────┐
│ Planner  │───▶│ Researcher │───▶│ Coder  │
└──────────┘    └────────────┘    └────┬───┘
                                      │
                                      ▼
                              ┌──────────────┐    ┌──────────┐
                              │   Reviewer   │───▶│ Executor │
                              └──────────────┘    └──────────┘
                                                       │
                                                       ▼
                                               Final Response
```

Each agent produces structured messages with confidence scores. The pipeline uses **voting and consensus** to resolve conflicts.

### Spectral Dimensions

Every node in the Spectrum Graph carries a 7-dimensional spectral profile:

| Dimension | Range | Meaning |
|-----------|-------|---------|
| 🧠 Cognitive | 0.0–1.0 | Intellectual complexity and depth |
| 💜 Emotional | 0.0–1.0 | Emotional significance and resonance |
| ⏳ Temporal | 0.0–1.0 | Time relevance and recency |
| 👥 Social | 0.0–1.0 | Social context and relationships |
| 🎨 Creative | 0.0–1.0 | Creative and generative potential |
| 📊 Analytical | 0.0–1.0 | Analytical and logical precision |
| 🏃 Physical | 0.0–1.0 | Physical-world grounding |

These dimensions undergo **temporal decay** — older knowledge gracefully fades unless reinforced by new interactions, creating a natural learning curve.

---

## 🔐 Security Model

| Feature | Implementation |
|---------|---------------|
| Code Signing | HMAC-SHA256 with per-session keys |
| Syscall Control | Configurable allow-lists per sandbox |
| Anomaly Detection | Behavioral scoring with automatic flagging |
| State Encryption | XOR stream cipher with HMAC-derived keys |
| Device Binding | Hardware fingerprint for migration verification |
| Auto-Rollback | Snapshot-based recovery on sandbox failures |

All cryptographic operations run locally — no keys or encrypted data ever leave the device.

---

## 🗺️ Roadmap

### v0.1.0-alpha (Current) ✅

- [x] Spectrum Graph with 7-dimensional spectral embeddings
- [x] SQLite persistence with full CRUD
- [x] Refractive Core intent pipeline
- [x] Ollama integration (Mistral, Llama, etc.)
- [x] React UI with Intent Console
- [x] Force-directed graph visualization
- [x] LangGraph multi-agent collaboration (5 agents)
- [x] Sandbox Prisms with HMAC signing and anomaly detection
- [x] You-Port encrypted state migration
- [x] Settings page with encrypted export/import
- [x] Startup loading screen with progress
- [x] Error handling with contextual guidance

### v0.2.0 (Planned)

- [ ] WASM-based sandbox isolation (full containment)
- [ ] Plugin system for third-party Prisms
- [ ] Voice input/output integration
- [ ] Multi-window support
- [ ] Spectral timeline visualization
- [ ] Graph merge/diff for multi-device sync

### v0.3.0 (Future)

- [ ] Federated learning (privacy-preserving cross-device)
- [ ] Custom model fine-tuning pipeline
- [ ] Mobile companion app
- [ ] Spectral API for external integrations

---

## ⚖️ Patent Notice

> **PrismOS** is protected under **US Provisional Patent Application No. [application number]**
> filed February 28, 2026. The Spectrum Graph™, Refractive Core™, and You-Port™
> architectures described herein are patent-pending inventions.
>
> This software is released under the MIT License for personal and educational use.
> Commercial use of the patented architectures requires a separate license.

---

## 🤝 Contributing

PrismOS is in early alpha. Contributions are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

Copyright © 2026 Manish Kumar

---

<p align="center">
  <strong>PrismOS</strong> — Your mind, refracted. 🌈
</p>
