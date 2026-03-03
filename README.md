# PrismOS — Local-First Agentic Personal AI Operating System

[![CI](https://github.com/mkbhardwas12/prismos-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/mkbhardwas12/prismos-ai/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mkbhardwas12/prismos-ai?label=download)](https://github.com/mkbhardwas12/prismos-ai/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Patent Pending** — US Provisional Patent filed February 2026

PrismOS is a **local-first agentic personal AI operating system** that runs 100% on your device. Your data never leaves your machine. Five collaborative AI agents work together via a formal debate pipeline, storing everything in a persistent 7-dimensional Spectrum Graph that grows with you.

<p align="center">
  <img src="docs/screenshots/intent-console.png" width="700" alt="PrismOS Intent Console" />
</p>

---

## ✨ Core Features (v0.2.0)

| Feature | Description |
|---------|-------------|
| **Refractive Core** | Intent → 5-agent pipeline → Spectrum Graph → response |
| **Spectrum Graph** | Persistent Multi-dimensional knowledge graph |
| **5 AI Agents** | Orchestrator, Memory Keeper, Reasoner, Tool Smith, Sentinel |
| **LangGraph Debates** | Multi-agent debate with formal consensus voting |
| **Sandbox Prism** | WASM-isolated execution with HMAC-SHA256 signing & auto-rollback |
| **Proactive Suggestions** | Context-aware cards that auto-process on click |
| **Morning Brief / Evening Recap** | Daily summary of your knowledge graph activity |
| **You-Port** | Encrypted state migration — export/import your entire graph |
| **Voice I/O** | Browser-native speech input/output (no cloud transcription) |
| **Spectral Timeline** | Time-series view of knowledge evolution |
| **Multi-Window** | Open Spectrum Graph in a separate window |

Everything runs offline. All inference via local [Ollama](https://ollama.com) models.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│  React 18 + TypeScript + Vite (Frontend)            │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Intent    │  │ Spectrum │  │ Active Agents    │  │
│  │ Console   │  │ Graph    │  │ + Sandbox Panel  │  │
│  └───────────┘  └──────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────┤
│  Tauri 2.0 IPC Bridge                               │
├─────────────────────────────────────────────────────┤
│  Rust Backend                                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Spectrum │  │ Sandbox  │  │ Ollama Bridge     │  │
│  │ Graph    │  │ Prism    │  │ (local LLM)       │  │
│  │ (SQLite) │  │ (WASM)   │  │                   │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────┘
```

See [docs/architecture.svg](docs/architecture.svg) and the [docs/diagrams/](docs/diagrams/) folder for detailed visual diagrams.

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | ≥ 18 | Frontend build |
| [Rust](https://rustup.rs/) | ≥ 1.75 | Tauri backend |
| [Ollama](https://ollama.com/) | Latest | Local LLM |

### Install & Run

```bash
# Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# Install frontend dependencies
npm install

# Pull a local model (PrismOS will guide you through this on first launch)
ollama pull mistral

# Start Ollama in the background
ollama serve &

# Run in development mode
npm run tauri dev
```

### Download Pre-Built Installers

Pre-built installers are available on the [Releases page](https://github.com/mkbhardwas12/prismos-ai/releases/latest):

- **Windows**: `.msi` or `.exe` installer
- **macOS**: `.dmg` (Apple Silicon & Intel)
- **Linux**: `.deb` or `.AppImage`

---

## 🔧 Configuration

PrismOS uses [Ollama](https://ollama.com/) for local LLM inference. The default configuration:

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama URL | `http://localhost:11434` | API endpoint for local Ollama |
| Default Model | `llama3.2` | Model used for inference |
| Theme | `dark` | UI theme (`dark` / `light`) |
| Max Tokens | `2048` | Max response length |

All settings are configurable in the Settings panel (⚙️) within the app. The Ollama URL constant is centralized in:
- **Frontend**: [`src/lib/config.ts`](src/lib/config.ts)
- **Backend**: [`src-tauri/src/ollama_bridge.rs`](src-tauri/src/ollama_bridge.rs) (`DEFAULT_OLLAMA_URL`)

---

## 🧪 Testing

```bash
# Frontend unit tests (Vitest + React Testing Library)
npx vitest run

# TypeScript type-check
npx tsc --noEmit

# Rust backend tests
cd src-tauri && cargo test

# Rust lint (clippy)
cd src-tauri && cargo clippy
```

CI runs automatically on every push and PR via [GitHub Actions](.github/workflows/ci.yml).

---

## 📁 Project Structure

```
src/                          → React frontend (TypeScript)
  ├── components/             → UI components (MainView, Sidebar, etc.)
  ├── lib/                    → Shared libraries (ollama client, agents, config)
  ├── hooks/                  → React hooks (useVoice)
  ├── types/                  → TypeScript interfaces
  └── test/                   → Vitest unit tests
src-tauri/src/                → Rust backend
  ├── lib.rs                  → Tauri command registration + app setup
  ├── spectrum_graph.rs       → 7D Spectrum Graph engine (SQLite)
  ├── refractive_core.rs      → Intent processing pipeline
  ├── sandbox_prism.rs        → WASM isolation + cryptographic signing
  ├── ollama_bridge.rs        → Local LLM client (streaming + non-streaming)
  ├── langgraph_collab.rs     → Multi-agent debate workflow
  ├── you_port.rs             → Encrypted state migration
  └── audit_log.rs            → Tamper-proof audit trail
docs/                         → Architecture diagrams (SVG)
.github/workflows/            → CI + Release pipelines
```

---

## 🔒 Security Model

PrismOS implements defense-in-depth with patent-pending security:

1. **Sandbox Prism** — Every agent action runs inside an isolated WASM container
2. **HMAC-SHA256 Signing** — All actions are cryptographically signed
3. **Allow-List Enforcement** — Only pre-approved operations execute
4. **Auto-Rollback** — Anomalous actions are automatically reverted
5. **Audit Trail** — Tamper-proof chain of all operations
6. **Zero Ambient Authority** — Agents have no default permissions

See [docs/diagrams/security-model.svg](docs/diagrams/security-model.svg) for the full security flow.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and contribution guidelines.

---

## 📜 Patent Notice

PrismOS and its core architectures (Spectrum Graph, Refractive Core, Sandbox Prism, You-Port) are protected by a US Provisional Patent filed February 2026. This open-source release is for personal and educational use.
