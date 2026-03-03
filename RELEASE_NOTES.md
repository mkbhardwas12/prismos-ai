<div align="center">

# 🔷 PrismOS-AI v0.4.0

### The Local-First AI Operating System

**Your AI. Your Data. Your Machine. Period.**

[![Release](https://img.shields.io/badge/Release-v0.4.0-0ea5e9?style=for-the-badge&logo=github)](https://github.com/mkbhardwas12/prismos-ai)
[![Patent](https://img.shields.io/badge/Patent_Pending-US_63%2F993%2C589-10b981?style=for-the-badge)](.)
[![License](https://img.shields.io/badge/License-MIT-a78bfa?style=for-the-badge)](LICENSE)
[![Offline](https://img.shields.io/badge/100%25-Offline-f59e0b?style=for-the-badge)](.)

**Release Date:** March 3, 2026 · **Author:** Manish Kumar

</div>

---

## 🎯 What Is This Release?

PrismOS-AI v0.2.1 is the **first feature-complete desktop release** of a patent-pending AI operating system that runs **entirely on your machine** — no cloud, no telemetry, no data ever leaves your device.

> **In one sentence:** A Tauri 2.0 desktop app with 5 AI agents, a physics-inspired knowledge graph, WASM sandboxing, 9 security layers, and a modern glassmorphism UI — all running 100% offline.

### 📌 Key Numbers

| | |
|:--|:--|
| 🔌 **53** Tauri IPC commands | 🤖 **5** autonomous AI agents |
| 🦀 **16** Rust backend modules | ⚛️ **16** TypeScript components |
| 🎨 **4,100+** lines of CSS | 📏 **15,800+** total lines of code |
| 🔒 **9** security layers | 🌈 **7** spectral dimensions |

---

## ✨ What's New in v0.2.1

### 🛡️ WASM Sandbox Isolation
> Code execution that can't escape.

- Full **wasmtime** containment with memory + CPU limits
- Execute button in Sandbox Prisms with live results
- Automatic rollback on failure

### 🎙️ Voice Input & Output
> Talk to your AI. It talks back.

- Web Speech API — speech-to-text + text-to-speech
- Mic toggle with visual feedback in Intent Console
- 100% offline — your browser's built-in speech engine, no cloud

### 🪟 Multi-Window Support
> Pop out any view into its own window.

- Tauri `WebviewWindowBuilder` for detachable views
- Independent window lifecycle (resize, close, minimize)
- Any panel becomes a standalone native window

### ⏳ Spectral Timeline
> See how your knowledge evolves over time.

- Time-based graph history with date grouping
- Temporal navigation and snapshot restore
- Visual timeline of every graph change

### 💡 Proactive Suggestions
> Your graph tells you what to do next.

- Context-aware **SuggestionCards** with confidence bars and category badges
- Inline follow-up cards after every AI response
- Persistent **Daily Suggestions** sidebar section with auto-refresh
- Graph-node analysis + time-of-day awareness for smart recommendations

### 🌅 Morning Brief & Evening Recap
> A greeting that knows your day.

- Time-aware greeting card (☀️ Good morning / 🌆 Good evening / 🌙 Late night)
- 2-3 personalized SuggestionCards pulled from your Spectrum Graph
- **Daily Summary** pill button with dropdown stats panel
- "Get Full AI Summary" button dispatches a contextual recap intent
- Dismissible with one-click re-open

### ♿ UX Polish & Accessibility
> Beautiful for everyone.

- ARIA labels, focus management, `prefers-reduced-motion`
- Light theme with automatic OS detection
- Responsive sidebar with hamburger menu (< 768px)
- Keyboard shortcuts: `Ctrl+1` through `Ctrl+6`
- 2-click delete, keyboard-accessible cards, form labels
- Settings persistence across restarts
- UTF-8 safety (no more Rust panics on emoji or accented text)

### 🏠 Welcome Screen & Onboarding
> From zero to AI in under 2 minutes.

- First-time setup wizard modal (shows once, never again)
- 3-step Ollama onboarding: **Install → Start → Pull Model**
- Clickable example intents that auto-fill the input box
- Live Ollama status detection (running / stopped / not installed)
- Collapsible wizard — compact after first use

### 🎨 Modern Blue UI Overhaul
> A UI you actually want to look at.

- Complete color system rewrite — modern blue glassmorphism
- `backdrop-filter` transparency layers throughout
- Dark-first design with full light theme parity
- Consistent design tokens across all 4,100+ CSS lines

### 🔐 Security Hardening
> Defense-in-depth, not defense-as-afterthought.

- **Tamper-evident audit log** — SHA-256 hash chain; each entry references the previous hash, making retroactive tampering instantly detectable
- **LLM model verification** — SHA-256 fingerprinting against a known-good registry; unknown models are flagged (not blocked)
- **Secure enclave abstraction** — Auto-detects Windows TPM, macOS Secure Enclave, Linux TPM2; software fallback when hardware unavailable
- 4 new IPC commands: `get_audit_log` · `verify_audit_chain` · `verify_model` · `get_security_status`

---

## 📊 Growth: v0.1.0 → v0.2.1

```
                    v0.1.0-alpha        v0.2.1
                    ────────────        ──────
IPC Commands        30                  53          (+77%)
Rust Modules        6                   16          (+167%)
TypeScript Files    10                  16          (+60%)
CSS Lines           ~1,200              4,100+      (+242%)
Total LOC           ~8,000              15,800+     (+98%)
Security Layers     6                   9           (+50%)
```

---

## 🏗️ Architecture at a Glance

```
┌──────────────────────────────────────────────────────────┐
│                    PrismOS-AI Desktop App                    │
├──────────────────────────────────────────────────────────┤
│  React 18 + TypeScript 5.5            (Frontend)         │
│  ├── Intent Console         Natural language chat        │
│  ├── Spectrum Graph         7D force-directed viz        │
│  ├── Sandbox Prisms         WASM execution sandbox       │
│  ├── Spectral Timeline      Time-based graph history     │
│  └── Settings & Security    Config + security status     │
├─────────────────── 53 Tauri IPC Commands ──────────────────┤
│  Rust 1.82+ Backend                  (16 Modules)        │
│  ├── spectrum_graph.rs      SQLite knowledge store       │
│  ├── ollama_bridge.rs       LLM inference (local)        │
│  ├── sandbox_engine.rs      wasmtime WASM runtime        │
│  ├── agents/                5 LangGraph AI agents        │
│  ├── you_port.rs            Encrypted sync/export        │
│  ├── audit_log.rs           SHA-256 hash chain           │
│  ├── model_verify.rs        LLM integrity checking       │
│  └── secure_enclave.rs      Hardware security module     │
└──────────────────────────────────────────────────────────┘
        ↓ Everything runs locally. Nothing phones home. ↓
```

---

## 🔒 9 Security Layers

| # | Layer | What It Does |
|:-:|-------|-------------|
| 1 | **HMAC-SHA256** | Every agent action is cryptographically signed |
| 2 | **Allow-lists** | Only whitelisted operations can execute |
| 3 | **WASM Sandbox** | Code runs in `wasmtime` with memory/CPU limits |
| 4 | **Anomaly Detection** | Statistical monitoring flags unusual patterns |
| 5 | **Auto-Rollback** | Automatic checkpoint restoration on failure |
| 6 | **Encryption at Rest** | XOR stream cipher + HMAC for stored state |
| 7 | **Audit Hash Chain** | SHA-256 chain — tamper one entry, break the chain |
| 8 | **Model Verification** | SHA-256 fingerprint vs known-good registry |
| 9 | **Secure Enclave** | Hardware TPM / Secure Enclave key derivation |

---

## ⚠️ Breaking Changes

**None.** This is the first public release.

---

## 🛤️ What's Next — v0.5.0

| Feature | Description |
|---------|-------------|
| 🧩 Plugin Marketplace | Community-built extensions |
| 🧠 Federated Learning | Privacy-preserving model updates |
| 📱 Mobile Companion | React Native app |
| 🔗 P2P Sync | Device-to-device, no central server |
| 🌈 Custom Dimensions | User-defined spectral properties |
| 🔑 Hardware Keys | YubiKey / Titan Security Key integration |

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
