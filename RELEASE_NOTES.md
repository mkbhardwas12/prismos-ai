<div align="center">

# 🔷 PrismOS-AI v0.5.2

### The Local-First Desktop Assistant with Bounded Sequential Workflows

**Local-first core. Explicit privacy boundaries.**

[![Release](https://img.shields.io/badge/Release-v0.5.2-0ea5e9?style=for-the-badge&logo=github)](https://github.com/mkbhardwas12/prismos-ai)
[![License](https://img.shields.io/badge/License-MIT-a78bfa?style=for-the-badge)](LICENSE)
[![Local first](https://img.shields.io/badge/Core-Local--First-f59e0b?style=for-the-badge)](.)

**Author:** Manish Kumar

</div>

---

## 🎯 What Is This Release?

PrismOS-AI v0.5.2 is a local-first desktop assistant with a persistent knowledge graph, bounded project ingestion, and private inference fixed to loopback Ollama. Optional model downloads, browser speech services, flywheel base-weight acquisition, and remote model-management/status operations can use the network; PrismOS does not emit telemetry. `PRISMOS_ALLOW_REMOTE_OLLAMA=1` permits a non-loopback management origin only and never reroutes private prompts.

> **In one sentence:** A Tauri 2.0 desktop app with five core software roles, a bounded sequential plan → build → judge → refine loop, a physics-inspired knowledge graph, native action-policy bookkeeping, Private Vault recovery tooling, Local Vision, and document analysis.

### 📌 Key Numbers

| | |
|:--|:--|
| 🔌 **Typed** Tauri IPC boundaries | 🤖 **5** available core roles |
| 🦀 **Rust** backend | ⚛️ **React + TypeScript** frontend |
| 🔒 **Explicit** privacy boundaries | 🌈 **7** spectral dimensions |
| ✅ **Automated** Rust and UI tests | 📄 **Bounded** document ingestion |

---

## ✨ Current v0.5.2 Status

### 🏠 Daily Dashboard
> Your unified morning-brief command center.

- Hero greeting with time-of-day awareness (morning/afternoon/evening/night)
- Stats strip: total nodes, today's additions, active agents, health score
- Local cards for graph highlights, pending topics, and daily suggestions
- Quick links grid for one-click navigation to all views
- Auto-refresh every 10 minutes; keyboard shortcut `Ctrl+7`

### 📊 ProactivePanel
> A permanent sidebar panel that keeps you in the loop.

- Local graph insight and daily suggestions; no background keeper-network requests
- Graph insight card showing top Spectrum Graph node
- Collapsible with smooth animation; state persists across sessions

### 📵 Unavailable Integrations
> Email, calendar, and finance connectors are intentionally unavailable in this release.

- No email or calendar credentials are accepted by the active settings flow
- No background portfolio or market-data request is launched
- The active registry exposes five core roles: Orchestrator, Memory Keeper, Reasoner, Tool Smith, and Sentinel

### ⚙️ Startup View Setting
> Choose what greets you when PrismOS opens.

- New "Startup View" dropdown in Settings → Appearance
- Options: Intent Console, Daily Dashboard, Spectrum Graph, Spectrum Explorer, and Spectral Timeline
- Persists via localStorage

### 📊 Automated Tests
> Comprehensive quality coverage.

- Frontend tests use Vitest + React Testing Library
- Backend tests use Rust's test runner
- Test counts are reported by CI rather than frozen in release prose

---

## ✨ Previously in v0.5.0 / v0.5.1

### 🖼️ Window Chrome & Native Feel
> A native-feeling desktop application.

- Earlier v0.5 builds introduced an in-app title bar with a drag region
- The current build uses native OS window decorations and retains in-app window controls
- Native window state persistence via `tauri-plugin-window-state`

### 🔽 System Tray
> Always accessible, never intrusive.

- System tray icon with Show/Quit context menu
- Close-to-tray behavior — app keeps running in background
- One-click restore from tray

### 📂 Drag & Drop File Ingest
> Drop files straight into PrismOS-AI.

- Attach supported documents through the upload button or drag-and-drop surface
- One-off document analysis chunks remain in memory and do not create persistent
  `doc_chunk` nodes; durable Project Knowledge requires preview and approval
- Visual drop-zone highlight with smooth animations

### 📦 Manual Releases
> PrismOS does not ship an in-app update client.

- If an independently verified package has been published, download it from GitHub Releases
- Verify published checksums when available
- Install manually, then confirm the displayed version and data restore path

### 👁️ Local Vision Engine (Multimodal)
> Analyze images through the fixed-loopback private inference route.

- Multimodal image understanding via llava / llama3.2-vision
- 🖼️ Image upload button and drag-drop image support
- 📷 Camera capture for live image analysis
- Image preview card with remove option before sending
- Vision inference is fixed to loopback; the configured Ollama URL is only for model management/status

### 📄 Document Analysis Engine — Current Safety Boundary
> Earlier v0.5 builds experimented with more parsers; v0.5.2 intentionally narrows the accepted formats.

- **DOCX** bounded classic-ZIP and document-XML extraction
- **PPTX** bounded classic-ZIP and slide-XML extraction
- **UTF-8 text/code, CSV, and TSV** through an explicit extension allowlist
- **PDF** parsing fails closed; convert the file to UTF-8 text before attaching it
- **XLSX and legacy XLS** parsing fail closed; export the sheet as CSV or TSV
- 📄 Upload button + drag-drop document support
- Document preview card with remove option before sending
- AI analysis uses fixed-loopback Ollama after the selected model is installed;
  one-off attachments are not added to the Spectrum Graph

---

## 📊 Growth: v0.4.0 → v0.5.0

```
                    v0.4.0              v0.5.0
                    ──────              ──────
IPC Commands        55                  71          (+29%)
Feature Count       20                  26          (+30%)
Document Analysis   No                  Added       (boundary revised in v0.5.2)
Vision Support      No                  Yes         (NEW)
System Tray         No                  Yes         (NEW)
Manual Releases     Yes                 Yes         (CURRENT)
In-App Window UI    No                  Yes         (native decorations in v0.5.2)
```

---

## 🏗️ Architecture at a Glance

```
┌──────────────────────────────────────────────────────────┐
│              PrismOS-AI Desktop App (v0.5.2)             │
├──────────────────────────────────────────────────────────┤
│  React 18 + TypeScript 5.5            (Frontend)         │
│  ├── Daily Dashboard      Morning brief + proactive cards │
│  ├── ProactivePanel       Live sidebar feeds              │
│  ├── Intent Console       NL chat + vision + documents   │
│  ├── Spectrum Graph       7D force-directed viz          │
│  ├── Action Policy        Policy + process-local HMAC    │
│  ├── Spectral Timeline    Time-based graph history       │
│  └── Settings & Security  Config + security status       │
├────────────────── 100 registered Tauri commands ───────────┤
│  Rust 1.95.0 Backend (pinned toolchain)                  │
│  ├── spectrum_graph.rs    SQLite knowledge store          │
│  ├── ollama_bridge.rs     LLM + vision inference         │
│  ├── sandbox_prism.rs     Policy gate + bookkeeping      │
│  ├── agents/              Sequential bounded goal loop   │
│  ├── you_port.rs          Encrypted sync/export          │
│  ├── audit_log.rs         SHA-256 hash chain             │
│  ├── model_verify.rs      Advisory model metadata check  │
│  ├── private_vault.rs     Encrypted recovery candidate   │
│  ├── file_indexer.rs      Disabled legacy watcher source │
│  └── whisper_engine.rs    Prototype; no real transcription│
└──────────────────────────────────────────────────────────┘
        ↓ Private inference is fixed loopback; management/download egress is explicit. ↓
```

---

## 🔒 Security Layers

| # | Layer | What It Does |
|:-:|-------|-------------|
| 1 | **Process-local HMAC-SHA256** | Ephemeral modeled action-policy records are authenticated within the process; this is not persistent signing or attestation |
| 2 | **Allow-lists** | Only recognized modeled operations can be approved |
| 3 | **Native Action Policy** | Modeled actions are classified and recorded; arbitrary code is not executed |
| 4 | **Anomaly Detection** | Statistical monitoring flags unusual patterns |
| 5 | **Checkpoint Bookkeeping** | Records policy state; it is not generic database or filesystem rollback |
| 6 | **Encrypted Exports** | Portable exports and Private Vault packages are encrypted; the live SQLite database is plaintext at rest |
| 7 | **Audit Hash Chain** | Detects modification of retained prior lines; it does not prevent deletion or prove completeness |

---

## 🛤️ What's Next — v0.6.0

| Feature | Description |
|---------|-----------|
| 🎤 Local transcription | Future evaluation; real Whisper transcription is unavailable in v0.5.2 |
| 🧩 Plugin Marketplace | Design proposal only; no loader or marketplace is implemented |
| 🧠 Federated Learning | Research only; no autonomous personal-data training or model promotion |
| 📱 Mobile Companion | Planning only; no verified mobile release is represented here |
| 🔗 P2P Sync | Research only; current cross-device sync uses an encrypted transfer file |

---

## 📥 Get Started

```bash
# Clone and run — that's it
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai
npm install
npm run tauri dev
```

**You'll need:** Node.js 22.12+ (Node 24 LTS recommended) · Rust 1.95.0 via the checked-in toolchain · Ollama for model-backed chat and document/vision inference

---

## 📜 Legal

| | |
|:--|:--|
| **Author** | Manish Kumar |
| **License** | MIT — free to use, modify, distribute |

---

<div align="center">

*Built with the conviction that AI should serve its user, not a platform.*

**[⭐ Star on GitHub](https://github.com/mkbhardwas12/prismos-ai)** · **[📖 Read the README](README.md)** · **[🐛 Report a Bug](https://github.com/mkbhardwas12/prismos-ai/issues)**

</div>
