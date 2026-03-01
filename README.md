# ◈ PrismOS

**Patent Pending — US [application number] (Feb 28, 2026)**

> PrismOS — Local-First Agentic Personal AI Operating System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue.svg)](https://tauri.app)
[![Ollama](https://img.shields.io/badge/Ollama-Local%20LLM-green.svg)](https://ollama.com)

---

## 🔮 What is PrismOS?

PrismOS is a **local-first agentic personal AI operating system** that keeps all your data on your device. It combines a multi-agent orchestration engine (Refractive Core), a persistent knowledge graph (Spectrum Graph), sandboxed execution (Prism Sandboxes), and natural language understanding (Intent Lenses) — all powered by local LLM inference via Ollama.

**No cloud. No telemetry. No data leaves your machine.**

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PrismOS Frontend                      │
│              React + TypeScript (Tauri 2.0)              │
├─────────────────────────────────────────────────────────┤
│                     Intent Lenses                        │
│           Natural Language Decomposition Engine           │
├─────────────────────────────────────────────────────────┤
│                   Refractive Core                        │
│         LangGraph Multi-Agent Orchestration               │
│  ┌──────────┬──────────┬──────────┬──────────┬────────┐ │
│  │Orchestr- │ Memory   │ Reasoner │  Tool    │Sentinel│ │
│  │  ator    │ Keeper   │          │  Smith   │        │ │
│  └──────────┴──────────┴──────────┴──────────┴────────┘ │
├─────────────────────────────────────────────────────────┤
│                   Spectrum Graph                         │
│        SQLite + LanceDB Vector + Graph Layers            │
├──────────────────┬──────────────────────────────────────┤
│  Sandbox Prisms  │            You-Port                   │
│  WASM + Crypto   │     Encrypted State Transfer          │
│  + Auto-rollback │       (Handoff Stub)                  │
├──────────────────┴──────────────────────────────────────┤
│                  Ollama (Local LLM)                       │
│              mistral / llama3 / phi3 / etc.              │
└─────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Rust** ≥ 1.75 (with cargo)
- **Ollama** — [Install from ollama.com](https://ollama.com)
- **A local model** — e.g., `ollama pull mistral`

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# 2. Install dependencies
npm install

# 3. Start Ollama (in a separate terminal)
ollama serve

# 4. Pull a model (if you haven't already)
ollama pull mistral

# 5. Run PrismOS
npm run tauri dev
```

## 🧠 Core Components

### Refractive Core (Multi-Agent Orchestration)
Five specialized AI agents working in concert via LangGraph:

| Agent | Role |
|-------|------|
| **Orchestrator** | Decomposes intents, routes to specialized agents |
| **Memory Keeper** | Manages Spectrum Graph persistence & retrieval |
| **Reasoner** | Deep analysis & inference via local LLM |
| **Tool Smith** | Executes sandboxed operations in Prism containers |
| **Sentinel** | Monitors security, privacy, and system health |

### Spectrum Graph (Persistent Knowledge)
- **SQLite** relational layer for structured data
- **LanceDB** vector layer for semantic search (planned)
- **Graph layer** for relationship mapping between knowledge nodes

### Intent Lenses (NLU Decomposition)
Natural language input → structured intent with type classification, entity extraction, and confidence scoring.

### Sandbox Prisms (Safe Execution)
WASM-based sandboxed environments with:
- Cryptographic state checkpoints
- Auto-rollback on failure
- Side-effect tracking

### You-Port (State Transfer)
Encrypted local state export/import for device handoff (stub implementation — full E2E encryption planned).

## 📁 Project Structure

```
prismos-ai/
├── src/                        # React + TypeScript frontend
│   ├── components/             # UI components
│   │   ├── Sidebar.tsx         # Navigation + agent status
│   │   ├── MainView.tsx        # Intent console + conversation
│   │   ├── IntentInput.tsx     # Natural language input
│   │   ├── ActiveAgents.tsx    # Agent status panel
│   │   ├── SpectrumGraphView.tsx  # Knowledge graph viewer
│   │   └── SettingsPanel.tsx   # Configuration
│   ├── lib/                    # Client libraries
│   │   ├── ollama.ts           # Ollama TypeScript client
│   │   └── agents.ts           # Agent definitions
│   ├── types/                  # TypeScript types
│   ├── App.tsx                 # Main application
│   └── main.tsx                # Entry point
├── src-tauri/                  # Rust backend (Tauri 2.0)
│   ├── src/
│   │   ├── lib.rs              # Tauri commands & setup
│   │   ├── refractive_core.rs  # Multi-agent engine
│   │   ├── spectrum_graph.rs   # SQLite knowledge graph
│   │   ├── sandbox_prism.rs    # WASM sandbox stubs
│   │   ├── intent_lens.rs      # NLU decomposition
│   │   ├── ollama_bridge.rs    # Ollama HTTP client
│   │   └── you_port.rs         # Encrypted state transfer
│   ├── Cargo.toml
│   └── tauri.conf.json
└── agents/                     # Python LangGraph agents
    ├── graph.py                # Multi-agent graph definition
    └── requirements.txt
```

## 🗺️ Roadmap

- [x] **v0.1** — MVP skeleton with Tauri 2.0 + React + Rust
- [x] **v0.1** — Ollama integration for local LLM inference
- [x] **v0.1** — SQLite-backed Spectrum Graph
- [x] **v0.1** — 5-agent Refractive Core architecture
- [x] **v0.1** — Intent Lens NLU decomposition
- [ ] **v0.2** — LanceDB vector search integration
- [ ] **v0.2** — Full LangGraph Python sidecar orchestration
- [ ] **v0.3** — WASM sandbox execution engine
- [ ] **v0.3** — Auto-rollback with cryptographic checkpoints
- [ ] **v0.4** — You-Port encrypted state transfer (AES-256-GCM)
- [ ] **v0.5** — Plugin system for community extensions
- [ ] **v1.0** — Production release with full patent implementation

## ⚖️ Legal

**Patent Pending — US Provisional Patent Application No. [application number]**
Filed: February 28, 2026
Title: PrismOS — Local-First Agentic Personal AI Operating System

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

*Built with ◈ by PrismOS Contributors — Your AI, Your Device, Your Data.*
