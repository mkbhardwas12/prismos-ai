# Changelog

All notable changes to PrismOS are documented in this file.

> Patent Pending — PrismOS (US Provisional Patent, Feb 2026)

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-03-02

### 🎉 Highlights

PrismOS v0.2.0 is a major feature release bringing WASM sandbox isolation, voice I/O,
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

[0.2.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.1.0-alpha...v0.2.0
[0.1.0-alpha]: https://github.com/mkbhardwas12/prismos-ai/releases/tag/v0.1.0-alpha
