# Changelog

All notable changes to PrismOS-AI are documented in this file.

> Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.1] — 2026-03-03

### 🎯 Highlights

PrismOS-AI v0.5.1 — **Phase 6: Brain Upgrades** release. Adds Smart Model Routing (auto-swap to vision models for images), intelligent Document Chunking + RAG retrieval for large documents, Background Omnipresence via Alt+Space global hotkey, and a tiered model recommendation catalog.

### Added

- **Smart Model Router** — `smart_router.rs` with automatic vision model detection and routing:
  - Auto-detects vision-capable models (llama3.2-vision, llava, qwen2-vl, bakllava, moondream, etc.)
  - Priority-based selection: prefers llama3.2-vision → llava → qwen2-vl → bakllava → moondream
  - `RoutingDecision` type with `auto_swapped`, `original_model`, `reason`, and `is_vision` fields
  - `route_model()` handles image, document, and code routing decisions
  - `classify_models()` returns `ModelCapabilities` for all installed models
  - 11 unit tests covering vision detection, priority ordering, and routing logic
- **Document Chunking + RAG** — `doc_chunker.rs` with intelligent text chunking and retrieval:
  - Paragraph-aware splitting with 2000-char chunks and 200-char overlap
  - TF-IDF-lite scoring with coverage and position bonuses
  - `build_rag_context()` end-to-end pipeline: chunk → score → retrieve top-5
  - `index_chunks_to_graph()` stores chunks as `doc_chunk` nodes in Spectrum Graph with `next_chunk` edges
  - Replaces naive 12KB truncation for large documents
  - 10 unit tests covering chunking, retrieval, and graph indexing
- **Background Omnipresence** — `Alt+Space` global hotkey:
  - Registers alongside existing `Ctrl+Space` / `Cmd+Space`
  - `bringToFront()` helper: sets always-on-top, unminimizes, shows, focuses, then releases after 500ms
  - PrismOS pops up over any app the user is currently using
- **Tiered Model Recommendations** — Curated model catalog organized by purpose:
  - 📝 Text & Reasoning tier: llama3.2 (🏆 default), llama3.1, mistral, mistral-nemo, deepseek-r1
  - 👁️ Vision & Image tier: llama3.2-vision (🏆 default), llava, qwen2-vl, moondream
  - ⚡ Power User tier: qwen2.5, codellama, gemma2:2b
  - Model dropdown shows tiered sections with category headers
  - Updated OnboardingWizard with vision model options
  - Updated SettingsPanel Quick Pull chips and default placeholder

### Changed

- `lib.rs`: Added `mod smart_router; mod doc_chunker;` declarations; 5 new Tauri commands (`smart_route_model`, `classify_installed_models`, `chunk_document`, `rag_query`, `index_document_chunks`); total IPC commands now **76**
- `MainView.tsx`: Document analysis path now uses RAG chunking + streaming with fallback; Vision path uses Smart Model Routing with auto-swap badge
- `App.tsx`: Global hotkey block registers both `Ctrl+Space` and `Alt+Space`; `bringToFront()` always-on-top helper
- `ollama_bridge.rs`: `GENERATE_TIMEOUT` increased from 120s to 300s for large reasoning models
- `smart_router.rs`: Added `qwen2-vl` to vision model patterns and priority ordering
- `OnboardingWizard.tsx`: Updated `POPULAR_MODELS` with vision model options and accurate descriptions
- `SettingsPanel.tsx`: Quick Pull chips updated; default model placeholder and hint text updated

### Fixed

- Document analysis no longer hangs — Ollama pre-check (3s fast-fail) before expensive generate calls
- "Error sending request" now correctly detected as Ollama connectivity error
- Empty AI response bubble after document attachment — safety net fills content from full response
- Streaming fallback: if streaming fails, removes empty bubble and falls back to blocking `query_ollama`
- Garbled Unicode in error messages cleaned up

---

## [0.5.0] — 2026-03-03

### 🎯 Highlights

PrismOS-AI v0.5.0 — **Phase 5: Native OS Experience** release. Removes native window decorations and adds a custom frameless title bar with drag region and window controls. System tray integration keeps agents resident when the window is closed. Drag-and-drop file ingest lets users drop files directly into the Intent Input for instant text extraction. Auto-updater infrastructure enables seamless OTA updates via GitHub Releases. **Phase 5.5: Local Vision** adds multimodal image analysis — drag-drop images or capture photos via webcam, analyzed entirely offline using llava/llama3.2-vision models.

### Added

- **Frameless Window + Custom Title Bar** — Native decorations disabled; custom `TitleBar.tsx` component with app branding, drag region (`data-tauri-drag-region`), and minimize/maximize/close-to-tray buttons with Windows-style hover states
- **System Tray** — `TrayIconBuilder` with "Show PrismOS-AI" and "Quit" menu items; clicking the tray icon restores the window; close button hides to tray instead of exiting
- **Drag & Drop File Ingest** — Drop files onto Intent Input to auto-extract text content via Rust `extract_file_text` command; supports 50+ text/code/data file extensions; 5MB size limit; visual drag overlay and file badge indicator
- **Auto-Updater Infrastructure** — `tauri-plugin-updater` configured with GitHub Releases endpoint; `tauri-plugin-window-state` for window position persistence across sessions
- **Local Vision Engine** — Multimodal image analysis via llava/llama3.2-vision models, entirely offline:
  - `query_ollama_vision` Tauri command: sends base64-encoded images to Ollama's `/api/generate` endpoint with vision models
  - `read_image_as_base64` Tauri command: reads image files from disk (jpg/png/gif/bmp/webp/tiff, 20MB limit) and returns base64
  - `IntentInput.tsx` vision UI: drag-drop images, 🖼️ file picker button, 📷 camera capture button, image preview with thumbnail
  - Camera capture via `navigator.mediaDevices.getUserMedia()` with live viewfinder and single-frame capture
  - `ollama_bridge.rs`: `GenerateRequest` struct extended with `images: Option<Vec<String>>` for base64 image arrays
  - Auto-detects vision-capable models; defaults to "llava" when current model doesn't support vision
  - `MainView.tsx`: Vision path in `handleIntent` — routes image+prompt to `query_ollama_vision`, shows 👁️ Vision metadata
- **Document Analysis Engine** — Upload and analyze PDF, DOCX, PPTX, XLSX documents entirely offline:
  - `extract_file_text` enhanced: now handles binary document formats (PDF, DOCX, PPTX, XLSX) in addition to text files
  - PDF extraction via `pdf-extract` crate — extracts text from digital PDFs, reports page count
  - DOCX extraction via XML parsing + `docx-rs` fallback — reads `word/document.xml` inside the zip archive
  - PPTX extraction via slide XML parsing — reads `ppt/slides/slideN.xml`, outputs per-slide text
  - XLSX/XLS extraction via `calamine` crate — reads all sheets, outputs tab-separated cell data
  - `extract_document_for_analysis` Tauri command for dedicated document workflow
  - `IntentInput.tsx`: 📄 document upload button, drag-drop document detection, document preview card with type-specific emoji icons
  - `MainView.tsx`: Document analysis path — injects document text as context, sends to Ollama, shows 📄 Document Analyst metadata
  - 50MB file size limit for documents; 12KB context truncation for model input
  - Supports: `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.xls`, `.txt`, `.md`, `.csv`, `.json`, `.rtf`

### Changed

- `tauri.conf.json`: `decorations` set to `false`, added `trayIcon` and `plugins.updater` config, version bumped to v0.5.0
- `lib.rs`: Registered `tauri-plugin-updater` and `tauri-plugin-window-state` plugins; added tray menu with event handlers; enhanced `extract_file_text` with PDF/DOCX/PPTX/XLSX support; added `extract_document_for_analysis`, `query_ollama_vision`, and `read_image_as_base64` commands; startup banner updated with Local Vision + Document Ingest Engine lines
- `ollama_bridge.rs`: `GenerateRequest` struct extended with `images` field; `generate()` and `generate_stream()` accept images parameter
- `refractive_core.rs`: Updated `generate()` call to pass `None` for images
- `agents/langgraph_workflow.rs`: Updated `generate()` call to pass `None` for images
- `App.tsx`: New `TitleBar` component rendered at top of layout; `.app-body` wrapper for sidebar + main content
- `IntentInput.tsx`: Added drag-over/drop handlers with visual feedback, file text extraction via Tauri IPC; added vision UI (image attachment, camera capture, file picker, image preview); added document upload UI (📄 button, document preview card, drag-drop document detection)
- `IntentInput.css`: Added vision CSS classes (preview, camera viewfinder, vision buttons, animations); added document CSS classes (doc-preview, doc-btn, type-specific styling)
- `MainView.tsx`: `handleIntent` accepts optional `imageData` and `documentText` parameters; vision path routes to `query_ollama_vision`; document path extracts text, builds context prompt, routes to `query_ollama`
- `IntentInput.test.tsx`: Updated `onSubmit` assertion for new `(input, imageData?, documentText?)` signature; updated button selector for vision/document buttons
- `Cargo.toml`: Added `tauri-plugin-updater`, `tauri-plugin-window-state`, `pdf-extract`, `docx-rs`, `calamine`, `zip`; enabled `tray-icon` feature on `tauri` crate
- `capabilities/default.json`: Added `updater:default` and `window-state:default` permissions
- All version references updated from v0.4.0 to v0.5.0

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

[0.5.1]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.1.0-alpha...v0.2.0
[0.1.0-alpha]: https://github.com/mkbhardwas12/prismos-ai/releases/tag/v0.1.0-alpha
