# PrismOS v0.2.0 — Release Notes

**Release Date:** March 2, 2026  
**Patent:** US Provisional Application No. [application number] (Filed Feb 28, 2026)  
**Author:** Manish Kumar  

---

## 🎯 Highlights

PrismOS v0.2.0 is the first feature-complete desktop release of the **local-first, patent-pending AI operating system**. This release delivers **51 Tauri IPC commands**, **5 autonomous AI agents**, **WASM sandboxing**, **hardware security integration**, and a polished modern UI — all running **100% offline** with zero cloud dependency.

---

## ✨ What's New

### Phase 18 — WASM Sandbox Isolation
- Full `wasmtime` containment for code execution
- Memory + CPU limits enforced at the runtime level
- Execute button in Sandbox Prisms with live results

### Phase 19 — Voice Input/Output
- Web Speech API integration (speech-to-text + text-to-speech)
- Mic toggle with visual feedback in Intent Console
- Works fully offline (browser engine speech)

### Phase 20 — Multi-Window Support
- Tauri `WebviewWindowBuilder` for detachable views
- Pop-out any view into its own native window
- Independent window lifecycle management

### Phase 21 — Spectral Timeline
- Time-based graph history visualization
- Date grouping and temporal navigation
- Snapshot restore from any timeline point

### Phase 22 — UX Polish & Accessibility
- ARIA labels, focus management, reduced-motion support
- Light theme with `prefers-color-scheme` detection
- Theme persistence via localStorage
- Responsive sidebar with hamburger menu (<768px)
- Keyboard shortcuts (Ctrl+1–6) for view navigation
- Form labels, keyboard-accessible cards, 2-click delete
- Settings persistence across app restarts
- UTF-8 safety fixes (prevent Rust panics on multi-byte input)
- Consensus voting improvements for ToolSmith + MemoryKeeper agents

### Phase 23 — Offline UX & Welcome Screen
- New welcome screen with clickable example intents
- Privacy-focused input placeholder messaging
- Offline status indicators throughout UI

### Phase 24 — Modern Blue UI Overhaul
- Complete color system replacement (legacy → modern blue glassmorphism)
- Consistent design tokens across all 4,700+ CSS lines
- Glassmorphism effects (backdrop-filter, transparency layers)
- Dark-first design with full light theme parity

### Phase 25 — Ollama Setup Wizard
- 3-step guided onboarding: Install → Start → Pull Model
- Live status detection (running/stopped/not installed)
- Start Ollama and Pull Model buttons with real-time progress
- Collapsible wizard with compact/expanded states
- Download Ollama button via `@tauri-apps/plugin-shell`

### Phase 26 — User-Friendly Improvements
- First-time setup modal (localStorage-gated, shows only on first launch)
- Plain-English tooltips on all security badges
- Live Security Status section in Settings (6 green checkmarks)
- Improved input placeholder with privacy messaging

### Phase 27 — Security Hardening
- **Tamper-evident audit log** — SHA-256 hash chain where each entry references the previous hash, making retroactive tampering detectable
- **Model verification** — SHA-256 fingerprinting of LLM models against a known-good registry, alerting on unknown or modified models
- **Secure enclave abstraction** — Detects Windows TPM, macOS Secure Enclave, and Linux TPM2 with automatic software fallback
- 4 new Tauri IPC commands: `get_audit_log`, `verify_audit_chain`, `verify_model`, `get_security_status`

---

## 📊 Project Stats

| Metric | v0.1.0-alpha | v0.2.0 |
|--------|:------------:|:------:|
| Tauri IPC commands | 30 | **51** |
| Rust source files | 6 | **16** |
| TypeScript files | 10 | **16** |
| CSS lines | ~1,200 | **4,700+** |
| AI agents | 5 | **5** |
| Total source lines | ~8,000 | **~18,000+** |

---

## 🏗️ Architecture

```
React 18 + TypeScript 5.5 (frontend)
    ↕ 51 Tauri IPC commands
Rust 1.82+ (backend)
    ├── SQLite (knowledge persistence)
    ├── wasmtime (WASM sandbox)
    ├── LangGraph (multi-agent workflows)
    ├── SHA-256 audit log (tamper-evident)
    ├── Model verification (integrity)
    └── Secure enclave (hardware security)
```

---

## 🔒 Security Layers (9 total)

1. **HMAC-SHA256** — Action signing and verification
2. **Allow-lists** — Operation whitelisting
3. **wasmtime WASM** — Memory + CPU isolation
4. **Statistical detection** — Anomaly alerting
5. **Auto-rollback** — Checkpoint restoration
6. **XOR stream cipher + HMAC** — State encryption at rest
7. **SHA-256 hash chain** — Tamper-evident audit log
8. **SHA-256 fingerprinting** — LLM model verification
9. **TPM / Secure Enclave** — Hardware-backed key derivation

---

## ⚠️ Breaking Changes

None. This is the first public release.

---

## 🛤️ What's Next (v0.3.0 Planned)

- [ ] Plugin marketplace (community extensions)
- [ ] Federated learning (privacy-preserving model updates)
- [ ] Mobile companion app (React Native)
- [ ] P2P sync without central server
- [ ] Custom spectral dimension definitions
- [ ] Hardware security key integration (YubiKey/Titan)

---

## 📥 Installation

```bash
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai
npm install
npm run tauri dev
```

**Prerequisites:** Node.js 18+, Rust 1.82+, Ollama (optional, guided setup included)

---

## 📜 Legal

**Patent Pending:** US Provisional Patent Application No. [application number]  
**Filed:** February 28, 2026  
**Author:** Manish Kumar  
**License:** MIT  

---

*Built with conviction that AI should serve its user, not a platform.*
