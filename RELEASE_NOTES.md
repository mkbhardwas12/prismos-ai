<div align="center">

# 🔷 PrismOS-AI v0.5.1

### The Local-First AI Operating System

**Your AI. Your Data. Your Machine. Period.**

[![Release](https://img.shields.io/badge/Release-v0.5.1-0ea5e9?style=for-the-badge&logo=github)](https://github.com/mkbhardwas12/prismos-ai)
[![Patent](https://img.shields.io/badge/Patent-Pending-10b981?style=for-the-badge)](.)
[![License](https://img.shields.io/badge/License-MIT-a78bfa?style=for-the-badge)](LICENSE)
[![Offline](https://img.shields.io/badge/100%25-Offline-f59e0b?style=for-the-badge)](.)

**Author:** Manish Kumar

</div>

---

## 🎯 What Is This Release?

PrismOS-AI v0.5.1 is a feature release of the patent-pending AI operating system that runs **entirely on your machine** — no cloud, no telemetry, no data ever leaves your device.

> **In one sentence:** A Tauri 2.0 desktop app with 8 AI agents, a physics-inspired knowledge graph, WASM sandboxing, Daily Dashboard, ProactivePanel, Email/Calendar/Finance Keepers, Local Vision, Document Analysis, frameless window, system tray, auto-updater, and a modern glassmorphism UI — all running 100% offline.

### 📌 Key Numbers

| | |
|:--|:--|
| 🔌 **76** Tauri IPC commands | 🤖 **8** autonomous AI agents |
| 🦀 **20** Rust backend modules | ⚛️ **30+** core features |
| 🔒 **7** security layers | 🌈 **7** spectral dimensions |
| ✅ **162** automated tests | 📄 **4** document formats supported |

---

## ✨ What's New in v0.5.1

### 🏠 Daily Dashboard
> Your unified morning-brief command center.

- Hero greeting with time-of-day awareness (morning/afternoon/evening/night)
- Stats strip: total nodes, today's additions, active agents, health score
- Six content cards: Calendar Events, Email Summary, Finance Overview, Today's Highlights, Pending Topics, Daily Suggestions
- Quick links grid for one-click navigation to all views
- Auto-refresh every 10 minutes; keyboard shortcut `Ctrl+7`

### 📊 ProactivePanel
> A permanent sidebar panel that keeps you in the loop.

- Live feeds: calendar events, email summaries, finance updates, daily suggestions
- Graph insight card showing top Spectrum Graph node
- Collapsible with smooth animation; state persists across sessions

### 📧 Keeper Agents (Email, Calendar, Finance)
> Three new specialized AI agents join the roster.

- **Email Keeper** — Email monitoring, inbox summaries, and smart notifications
- **Calendar Keeper** — Calendar awareness, upcoming events, and scheduling reminders
- **Finance Keeper** — Portfolio tracking, market alerts, and financial insights
- Total AI agents: **8** (was 5)

### ⚙️ Startup View Setting
> Choose what greets you when PrismOS opens.

- New "Startup View" dropdown in Settings → Appearance
- Options: Dashboard, Chat, Graph, Explorer, Sandbox, Timeline, Settings
- Persists via localStorage

### 📊 162 Automated Tests
> Comprehensive quality coverage.

- 97 frontend tests (Vitest + React Testing Library)
- 65 backend tests (cargo test)
- 9 test files covering all major components

---

## ✨ Previously in v0.5.0 / v0.5.1

### 🖼️ Frameless Window & Native Feel
> A true desktop OS experience.

- Custom frameless window with titlebar drag region
- Minimize / maximize / close buttons integrated into the UI
- Native window state persistence via `tauri-plugin-window-state`

### 🔽 System Tray
> Always accessible, never intrusive.

- System tray icon with Show/Quit context menu
- Close-to-tray behavior — app keeps running in background
- One-click restore from tray

### 📂 Drag & Drop File Ingest
> Drop files straight into PrismOS-AI.

- Drag any text file (.txt, .md, .json, .csv, .log) onto Intent Console
- Automatic text extraction and ingestion into Spectrum Graph
- Visual drop-zone highlight with smooth animations

### 🔄 Auto-Updater
> Stay current automatically.

- Built-in update checker via `tauri-plugin-updater`
- Notification when new version is available
- One-click update from within the app

### 👁️ Local Vision Engine (Multimodal)
> See what your AI sees — 100% on-device.

- Multimodal image understanding via llava / llama3.2-vision
- 🖼️ Image upload button and drag-drop image support
- 📷 Camera capture for live image analysis
- Image preview card with remove option before sending
- All vision processing runs entirely on-device via Ollama

### 📄 Document Analysis Engine
> Upload PDF, DOCX, PPTX, XLSX — get AI-powered summaries.

- **PDF** text extraction via `pdf-extract`
- **DOCX** parsing via `docx-rs`
- **PPTX** slide extraction via `zip` (Open XML)
- **XLSX** spreadsheet parsing via `calamine`
- 📄 Upload button + drag-drop document support
- Document preview card with page/word count
- AI analyzes and summarizes document content entirely offline

---

## 📊 Growth: v0.4.0 → v0.5.0

```
                    v0.4.0              v0.5.0
                    ──────              ──────
IPC Commands        55                  71          (+29%)
Feature Count       20                  26          (+30%)
Document Formats    0                   4           (NEW)
Vision Support      No                  Yes         (NEW)
System Tray         No                  Yes         (NEW)
Auto-Updater        No                  Yes         (NEW)
Frameless Window    No                  Yes         (NEW)
```

---

## 🏗️ Architecture at a Glance

```
┌──────────────────────────────────────────────────────────┐
│              PrismOS-AI Desktop App (v0.5.1)             │
├──────────────────────────────────────────────────────────┤
│  React 18 + TypeScript 5.5            (Frontend)         │
│  ├── Daily Dashboard      Morning brief + proactive cards │
│  ├── ProactivePanel       Live sidebar feeds              │
│  ├── Intent Console       NL chat + vision + documents   │
│  ├── Spectrum Graph       7D force-directed viz          │
│  ├── Sandbox Prisms       WASM execution sandbox         │
│  ├── Spectral Timeline    Time-based graph history       │
│  └── Settings & Security  Config + security status       │
├─────────────────── 76 Tauri IPC Commands ──────────────────┤
│  Rust 1.82+ Backend                (20 Modules)          │
│  ├── spectrum_graph.rs    SQLite knowledge store          │
│  ├── ollama_bridge.rs     LLM + vision inference         │
│  ├── sandbox_prism.rs     wasmtime WASM runtime          │
│  ├── agents/              8 AI agents (incl. Keepers)    │
│  ├── you_port.rs          Encrypted sync/export          │
│  ├── audit_log.rs         SHA-256 hash chain             │
│  ├── model_verify.rs      LLM integrity checking         │
│  ├── secure_enclave.rs    Hardware security module        │
│  ├── file_indexer.rs      RAG file watching              │
│  └── whisper_engine.rs    Audio transcription            │
└──────────────────────────────────────────────────────────┘
        ↓ Everything runs locally. Nothing phones home. ↓
```

---

## 🔒 Security Layers

| # | Layer | What It Does |
|:-:|-------|-------------|
| 1 | **HMAC-SHA256** | Every agent action is cryptographically signed |
| 2 | **Allow-lists** | Only whitelisted operations can execute |
| 3 | **WASM Sandbox** | Code runs in `wasmtime` with memory/CPU limits |
| 4 | **Anomaly Detection** | Statistical monitoring flags unusual patterns |
| 5 | **Auto-Rollback** | Automatic checkpoint restoration on failure |
| 6 | **Encryption at Rest** | AES-256-GCM + HMAC for stored state |
| 7 | **Audit Hash Chain** | SHA-256 chain — tamper one entry, break the chain |

---

## 🛤️ What's Next — v0.6.0

| Feature | Description |
|---------|-----------|
| 🎤 Whisper.cpp | Local audio transcription via Whisper |
| 🧩 Plugin Marketplace | Community-built extensions |
| 🧠 Federated Learning | Privacy-preserving model updates |
| 📱 Mobile Companion | React Native companion app |
| 🔗 P2P Sync | Device-to-device, no central server |

---

## 📥 Get Started

```bash
# Clone and run — that's it
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai
npm install
npm run tauri dev
```

**You'll need:** Node.js 18+ · Rust 1.82+ · Ollama (optional — guided setup walks you through it)

---

## 📜 Legal

| | |
|:--|:--|
| **Patent** | US Provisional Patent Application (Patent Pending) |
| **Filed** | February 2026 |
| **Author** | Manish Kumar |
| **License** | MIT — free to use, modify, distribute |

---

<div align="center">

*Built with the conviction that AI should serve its user, not a platform.*

**[⭐ Star on GitHub](https://github.com/mkbhardwas12/prismos-ai)** · **[📖 Read the README](README.md)** · **[🐛 Report a Bug](https://github.com/mkbhardwas12/prismos-ai/issues)**

</div>
