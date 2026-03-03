# Changelog

All notable changes to PrismOS-AI are documented in this file.

> Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-03-03

### 🎯 Highlights

PrismOS-AI v0.4.0 — **Local-First Agentic OS** release. Adds local voice engine (cpal audio capture + Whisper model download infrastructure), Spotlight-style global command palette (Ctrl+Space), local RAG file indexer watching directories and ingesting into Spectrum Graph, and deep Framer Motion animation polish across all UI components.

### Added

- **Local Voice Engine** — cpal-based cross-platform microphone capture with mono conversion, 16kHz resampling, and WAV encoding via hound; Whisper model download infrastructure from Hugging Face with progress streaming (Tiny/Base/Small); hybrid voice hook (`useVoice.ts`) with automatic Whisper → Web Speech API fallback
- **Spotlight Overlay** — macOS Spotlight-style global command palette (Ctrl+Space) with 6 quick commands, keyboard navigation (Arrow/Enter/Escape), graph node suggestions, frosted glass UI with backdrop-filter blur, full dark/light theme support, and `prismos:navigate` event dispatch
- **Local RAG File Indexer** — Watches `~/Documents/PrismDocs` directory for file changes (notify crate); initial scan with walkdir; auto-ingests text files into Spectrum Graph as knowledge nodes; supports 23 file extensions; max 1MB file size, 4KB content preview; tracks indexed files with metadata
- **Deep Framer Motion Polish** — SuggestionCard upgraded to `motion.button` with scale/opacity/position animations and stagger delays; live debate log steps wrapped in AnimatePresence with slide-in animations; proactive and inline follow-up suggestion cards animated with AnimatePresence

### Changed

- 13 new Tauri IPC commands for voice and file indexer operations
- `useVoice` hook now supports hybrid Whisper + Web Speech API with smart routing
- Startup banner updated to v0.4.0 with Whisper and File Indexer status
- `IndexerState` and `VoiceStopFlag` managed via Tauri state

---

## [0.3.0] — 2026-03-03

### 🎯 Highlights

PrismOS-AI v0.3.0 — **Phase 3** release. Adds onboarding wizard, model hub, Spectrum dynamic theming, Framer Motion transitions, global hotkey, and intent templates.

### Added

- **Onboarding Wizard** — Multi-step first-run experience guiding users through setup
- **Model Hub** — Browse, download, and manage Ollama models from within the app
- **Spectrum Theming** — Dynamic theme engine driven by Spectrum Graph spectral properties
- **Framer Motion Transitions** — Smooth page-level transitions with AnimatePresence
- **Global Hotkey** — Ctrl+Space / Cmd+Space to instantly focus the app (tauri-plugin-global-shortcut)
- **Intent Templates** — Pre-built intent templates for common workflows

---

## [0.2.1] — 2026-03-03

### 🎯 Highlights

PrismOS-AI v0.2.1 is a polish and stability release focusing on code quality, test coverage, CI/CD automation, and professional repository standards.

### Added

- **Test Coverage Expansion** — 65 comprehensive unit and integration tests across 7 test files (was 16 tests)
  - Frontend tests: Ollama client (8 tests), Agent definitions (22 tests), IntentInput component (7 tests), DailyBrief component (5 tests), Sidebar component (6 tests)
  - Backend tests: Type safety, Settings validation
- **Enhanced CI/CD Pipeline** — GitHub Actions now includes Rust `cargo clippy` linting, test coverage reporting, and full release-build verification
- **Centralized Configuration** — New `src/lib/config.ts` module consolidates Ollama URL, model defaults, and settings constants
- **Streaming Progress Bars** — Model pulls now display real-time progress with MB downloaded, percent complete, and visual progress bar via Tauri event streaming
- **SECURITY.md** — Security policy and vulnerability reporting guidelines
- **CODE_OF_CONDUCT.md** — Community guidelines for contributors and participants
- **Pull Request Template** — Standardized PR format with checklist and guidelines
- **.gitattributes** — Consistent line-ending and binary file handling across platforms

### Changed

- Improved UI feedback during long-running operations (Ollama model pulls)
- Enhanced README.md with badges, architecture diagrams, and configuration documentation
- New `docs/ARCHITECTURE.md` with complete technical architecture, data flow diagrams, and module inventory

### Fixed

- Hardcoded Ollama URLs centralized into configuration module (13 occurrences across 7 files)
- Model pull timeout increased to 30 minutes for large models
- All tests now passing (65/65) with improved coverage

### Documentation

- Expanded README with feature table, quick-start guide, configuration reference, security model, and project structure
- Added comprehensive ARCHITECTURE.md covering layers, components, data flow, and security design
- Created SECURITY.md with vulnerability reporting and supported versions

---

## [0.2.0] — 2026-03-02

### 🎉 Highlights

PrismOS-AI v0.2.0 is a major feature release bringing WASM sandbox isolation, voice I/O,
multi-window support, a spectral timeline, graph merge/diff for multi-device sync,
and full release polish with accessibility improvements.

### Added

- **WASM Sandbox Isolation** — Full wasmtime-based containment for Sandbox Prisms with fuel metering, memory limits, and zero ambient authority
- **Voice Input/Output** — Web Speech API integration for hands-free interaction (STT + TTS), all processing stays local
- **Multi-Window Support** — Open Spectrum Graph and Timeline in separate windows via Tauri WebviewWindowBuilder
- **Spectral Timeline** — Time-based visualization of graph history with date grouping, search, and filtering
- **LangGraph Workflow Engine** — Formal state-graph execution with structured debate rounds, argument types (Position, Challenge, Rebuttal, Support, Concession), and agreement scoring
- **Graph Merge/Diff Engine** — Full merge/diff engine in Spectrum Graph for multi-device sync with conflict detection and resolution strategies (Latest Wins, Theirs Wins, Ours Wins)
- **Cross-Device Sync** — Passphrase-based encrypted sync packages (portable across devices) with preview-before-merge capability
- **Multi-Device Sync UI** — Settings panel with passphrase input, strategy selector, merge preview with conflict details, and result panel
- **Accessibility Polish** — Skip-link, focus-visible rings, ARIA roles/labels, `prefers-reduced-motion` support, screen reader only text, high-contrast mode support
- **Error Message Improvements** — Contextual troubleshooting for Ollama connection errors, model errors, and general failures
- **CSS Tooltips** — Data-attribute based tooltips with smooth transitions
- **Skeleton Loaders** — Shimmer animation placeholders for loading states
- **Progress Bars** — Determinate and indeterminate progress bar components
- **Button Press Feedback** — Tactile scale animation on button press
- **CONTRIBUTING.md** — Contributor guide with code style, setup, and PR instructions
- **CHANGELOG.md** — This changelog
- **Test Documentation** — Manual test checklist and Rust test instructions

### Changed

- Improved page transitions with cubic-bezier easing
- Enhanced error banner with slide-down animation
- Better empty state animations with floating effect
- Updated all components with ARIA attributes and roles
- Improved focus management for keyboard navigation
- Updated README.md with comprehensive setup instructions, roadmap, and release notes

### Fixed

- Edge merge validates endpoint existence before insertion (prevents foreign key violations)
- Conversation area properly announces new messages to screen readers

### Added (Phase 21 — UX Polish)

- **Light Theme** — Complete `[data-theme="light"]` CSS with 25+ component overrides; theme toggle now works and applies instantly
- **Settings Persistence** — All settings saved to `localStorage` and survive app restarts
- **Responsive Sidebar** — Collapses to hamburger menu on windows <768px with overlay backdrop
- **Keyboard Shortcuts** — Ctrl+1–6 for view navigation, Escape to close mobile sidebar
- **Form Labels** — `<label>` elements (sr-only) added to all form inputs in Spectrum Explorer and Sandbox Panel
- **Keyboard-Accessible Cards** — Node cards now have `tabIndex`, `role="button"`, Enter/Space support
- **2-Click Delete** — Replaced blocking `confirm()` with state-based confirmation pattern
- **Stable List Keys** — SandboxPanel results use unique keys instead of array indices
- **Sidebar Nested Button Fix** — Replaced invalid nested `<button>` with sibling layout for "Open in new window" buttons
- **`aria-current`** — Applied to all active nav items (was only on Intent Console)
- **Danger-Confirm Animation** — Pulsing red glow on delete confirmation buttons
- **`.kbd` CSS Class** — Keyboard shortcut hint styling in sidebar

### Fixed (Phase 21)

- **UTF-8 Panics** — Replaced `&content[..N]` with `.chars().take(N)` in 4 locations (lib.rs, spectrum_graph.rs) to prevent crashes on multi-byte characters
- **Consensus Voting** — ToolSmith now rejects unsandboxed write operations; MemoryKeeper varies confidence (0.6–0.95) based on context node count
- **Theme Toggle** — Was a no-op; now applies `data-theme` attribute and persists to localStorage

---

## [0.1.0-alpha] — 2026-02-28

### Added

- **Spectrum Graph™** — Multi-layered knowledge graph with 7-dimensional spectral embeddings (cognitive, emotional, temporal, social, creative, analytical, physical)
- **Refractive Core™** — AI reasoning engine that refracts intents through the Spectrum Graph
- **SQLite Persistence** — Full graph persistence with 3-table schema (nodes, edges, spectra)
- **Multi-Agent Collaboration** — 5 specialized agents (Planner, Researcher, Coder, Reviewer, Executor) with structured messaging, voting, and consensus
- **Sandbox Prisms** — Isolated execution with HMAC-SHA256 signing, allow-list enforcement, anomaly detection, and auto-rollback
- **You-Port™** — Device-bound encrypted state migration for session handoff
- **Ollama Integration** — Local LLM inference via Ollama (Mistral, Llama, etc.)
- **React UI** — Intent Console with conversation history, Spectrum Explorer, Force-directed Graph Visualization, Sandbox Panel, Settings Panel
- **Startup Loading Screen** — Progress animation with status updates
- **Error Handling** — Global error banner and contextual error messages
- **Encrypted Export/Import** — Device-bound encrypted graph backup and restore
- **37 Tauri IPC Commands** — Complete frontend–backend communication layer

---

## [Unreleased]

### Planned

- Plugin system for third-party Prisms
- Federated learning (privacy-preserving cross-device)
- Custom model fine-tuning pipeline
- Mobile companion app
- Spectral API for external integrations

---

[0.4.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.1.0-alpha...v0.2.0
[0.1.0-alpha]: https://github.com/mkbhardwas12/prismos-ai/releases/tag/v0.1.0-alpha
