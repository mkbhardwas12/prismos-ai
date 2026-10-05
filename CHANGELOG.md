# Changelog

All notable changes to PrismOS-AI are documented in this file.


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Research lane.** Attach several sources at once (or start a message with `research:`) and ask one question. PrismOS picks the best passages from every source (BM25, so a long document can't drown out a short one), the local model answers with a passage tag after every fact (`[S2.1]`), and the answer is checked: tags that don't exist, factual sentences with no citation, and numbers that don't appear in the passages they cite. The reply lists its sources, and the full report (answer, checks, every passage used) is saved. With nothing attached it searches indexed documents and imported packs, and answers normally if they hold nothing on the question; `research … online` still goes to the opt-in web lane. Nothing is fetched. Passwords and keys in attached configs or logs are masked before the report is saved or the text is indexed.
- **Several attachments at once.** The document picker and drag-and-drop take several files, each kept as its own source and removable on its own. Logs and config files (`.log`, `.ini`, `.pfl`, `.conf`, `.cfg`, `.yaml`, `.xml`, `.sql`, `.tsv`) attach as documents, so they reach the security lane with their file names. Several config files are reviewed one by one, and sending waits until every file has been read.
- **SAP checks in the security lane.** SAP instance profiles (27 checks: password rules and hashes, SAP*, RFC authorization and callbacks, gateway ACLs and simulation mode, message server, Security Audit Log, SNC, UCON and more) and SAP HANA `.ini` files (10 checks: auditing, CSV audit trail, password policy, SYSTEM lock, `log_mode`, log backups) get line-by-line findings with the exact line to set. Fifteen log detectors cover requests to the Visual Composer metadata uploader (CVE-2025-31324), portal web shells, SecStore reads, HANA user creation, SYSTEM reactivation, powerful grants, auditing or encryption switched off, backup catalog deletes, and Security Audit Log events (AU7, AUB, AUE, CUL/CUK, AUM, DU9/CUZ). SQL passwords are masked before anything reaches the model. "Harden SAP", "harden SAP HANA" and "SAP BTP security checklist" get plans of their own.
- **SAP and security reference pack** (`resources/knowledge/sap-and-security`): 11 dated documents with their sources on SAP Basis releases and maintenance, Basis hardening and the Security Audit Log, SAP HANA operations and security, SAP BTP, the SAP vulnerabilities exploited or rated critical in 2025 and 2026 with published indicators, and ATT&CK v19, OWASP and exploitation trends. Import it with `prismos-knowledge`. Facts that only third parties state are marked, and facts found only in unofficial copies of SAP documentation were left out.
- **`prismos-eval`**: asks a question set through the local model twice, alone and with passages retrieved from an app directory that has a pack imported, and scores both answers by expected terms. `resources/eval/sap-and-security.jsonl` holds 39 questions for the new pack. Inference goes only to `127.0.0.1:11434`.

### Changed
- **New logo and app icon.** The mark is a P drawn as one white beam that opens into three lanes of light, cyan, blue and violet, the order in which glass bends them: one tool, many solutions. The wordmark is drawn from lines and arcs with no font and reads in three parts: Prism, OS in a heavier weight, and AI in blue. New icons for macOS, Windows, Linux, Android and iOS, with their sources and the steps to rebuild them in `docs/brand`. Inside the app the mark follows the theme (a white beam on dark, a blue beam on light). The macOS menu bar now shows one template icon instead of two: a second, icon-less tray declared in `tauri.conf.json` showed up as a blank square.
- The security lane's ATT&CK mapping follows v19: obfuscation and indicator removal sit under Stealth, and disabled tools, cleared logs and switched-off auditing map to T1685 Disable or Modify Tools under Defense Impairment.
- **Retrieval finds what was imported.** Keyword retrieval now weighs words by how rare they are, reads up to 200 matches per word instead of the first 30 (text imported later was cut off by insertion order), ignores punctuation around words (the last word of "…CVE-2025-31324?" matched nothing), and no longer lets a long document's chunks lift each other over a precise match elsewhere. Chat context carries whole document chunks (up to 2,000 characters, about 4.5k tokens in total) instead of each node's first 1,200 characters. On the SAP pack's 39 questions, the share of expected answer terms present in the retrieved passages went from 68% to 100%.
- **A calmer, chat-first app.** The sidebar now has plain destinations (Chat, Today, Memory, Library, Timeline, then Sandbox and Settings) with line icons, and the suggestions, memory overview and agents fold into one Insights drawer that remembers whether you left it open. The welcome screen leads with what PrismOS is for (*Ask anything. Attach anything.*), four one-line starters (a 3D scene, investigating a log file, hardening a server, a website) and a short privacy line, in place of ten template chips and three feature cards. The daily brief stays a one-line pill in Chat and opens in place; a dismissal lasts for the day. Calmer graphite and warm-paper themes, softer accent, consistent radii and focus rings.
- The version shown in the sidebar, title bar and settings now comes from `package.json` at build time (it said v0.6.0 and v0.5.2 after the 0.7.0 release).

### Fixed
- **Imported passages now surface in a large graph.** On a copy of a lived-in graph (hundreds of linked notes and thousands of suggestions), the research lane found the SAP pack passage for only 29 of the 39 eval questions, and a live question about CVE-2025-31324 was answered without it. Each search word read only its newest 200 matches, so after a later ingest the pack fell out for common words; that cap also made common words look rare, so linked notes outscored the one passage holding the rare term; and the research lane kept the general top 20 before picking out passages. Passages are now ranked among passages, a word that fills 200 rows is counted (up to 20,000), and an ordinary chat turn puts up to four passages that hold a rare word of the question first. On the same copy: expected document found for 39/39 questions (was 29/39), expected terms in the passages 97% (was 72%), and the expected document is in an ordinary chat turn's top 20 for 37/39. `prismos-eval` now reports that last number too.
- **App Builder: "The app plan contained no files."** The plan step now asks Ollama for schema-constrained JSON, reads file lists in the shapes models drift into (bare paths, `pages`, nested `project.files`), asks once more if a sample still plans nothing, and falls back to the standard index.html, data.js, styles.css and app.js layout rather than ending the build. Only earlier App Builder turns are passed as context, so an unrelated answer (an incident report, a scene) no longer crowds the plan prompt. App files are now written with Qwen's recommended sampling plus a presence penalty against repetition loops (a bakery site's styles.css ran past the 12,288-token ceiling twice at default sampling), and a file that still runs past the ceiling gets one compact retry instead of ending the build. `query_ollama` accepts the same sampling overrides the Scene Builder uses.
- **App Builder self-check saw only part of the project.** It skipped any file larger than its remaining budget, so on the Maple Lane build it never read `js/app.js`, reported it missing and flagged working features as broken, which also sends the repair rounds after problems that aren't there. The check and the repair planner now read every HTML and JS file first (indentation stripped), add styling only if room is left, name any file left out with its size, and get a 32k window only when the behaviour files need it.
- **Food sites plan the right form.** A bakery, a food truck or a request that mentions pickup, takeaway, delivery or orders now plans a pickup order form (items, pickup time inside opening hours, name and phone, an order number). The Maple Lane site's pickup form asked for a party size because every food site got a table-reservation note.
- **Security lane detectors:** `usermod -aG sudo` (and `-a -G`, `--groups=`, `gpasswd -a`, `adduser user sudo`) is now flagged as an admin-group change, and crontab's own `REPLACE` / `BEGIN EDIT` syslog lines and `| crontab -` are flagged as persistence. Both were missed on a real run. The secret masker no longer hides sudo's working directory (`PWD=/home/deploy`) while still masking a `pwd=` that is a password.

## [0.7.0] - 2026-10-04

### Added
- **Answer receipts** (opt-in): every answer can carry a locally signed, verifiable receipt of the question, model and sources.
- **Contradiction alerts** (opt-in): a new document that disagrees with what the knowledge graph already holds is flagged.
- **Data lane**: CSV and XLSX attachments get a deterministic profile and offline charts, explained by the model.
- **Audio to knowledge**: offline transcription through a whisper.cpp sidecar (the speech model is downloaded once).

- **Scene Builder** (`src/lib/sceneGen.ts`, `src/lib/sceneKit.js`): one short prompt such as *"a voxel pagoda garden"* becomes one real-time 3D scene file that opens in the browser and works with Wi-Fi off.
  - The local model only builds the world, on the **PrismOS Scene Kit**: renderer, mood lighting with fitted soft shadows and a rim light, world-space sky, fog, ground, instanced voxels with hidden-voxel culling, bloom, title card, and a camera framed on what was actually built (projected, centred, tall towers keep their tops).
  - Only what really moves moves. Buildings, terrain and the camera stay still (a turntable is opt-in); moving pieces go in `world.part()` groups (windmill sails, a rocking boat), `world.beam()` sweeps lighthouse or searchlight shafts sized to the scene that light what they pass and flare when they face the viewer, `world.lightning()` adds bolts, flashes and a drifting cloud deck, and rain falls as streaks.
  - `world.water()` is a GPU ocean: Gerstner swells travel across the whole surface with the wind, ripples shimmer between them, whitecaps form along the crests, foam rolls outward from every shoreline, the surface reflects the sky, and a sea that spans the scene runs on to the horizon.
  - The scene fills in its own detail. Director's notes turn the words of a one-line request into kit-level suggestions (a lighthouse gets its beam, the keeper's cottage and a boat at the jetty; a storm gets rain, lightning and a rough sea), the model plans hero, setting, details, motion, light and palette as comments before building, and `world.weather()` guarantees the weather the request named.
  - The kit and PrismOS's own copy of three.js (MIT) are inlined as `data:` URLs in an import map: no CDN, no server.
  - Self-checks before shipping: cut-off output, repetition loops, `const x.y` declarations, duplicate top-level names, the InstancedMesh-capacity bug, online resources and unknown modules, a scene or camera moved every frame when nobody asked for it, a browser-grade syntax probe, and a dry run of the scene's own code in a throwaway worker (three.js and the kit stubbed, nothing rendered). Hex colours a model split with spaces are rejoined, a line the browser can't parse is repaired on its own, and anything else gets one fix pass (or a compact rewrite). The result card says what was caught and fixed.
  - Every scene file carries a Content-Security-Policy that blocks all network access, so it stays offline even if the model wrote a URL.
  - Honest stats in the result card (tokens, seconds, tok/s, passes).
  - `/scene <idea>` always routes to the Scene Builder, and a "Build a 3D scene from one line" quick-start card sits on the welcome screen.
- **Security lane** (`src/lib/securityLane.ts`): cyber investigation and hardening, fully offline.
  - Investigate: drop in logs (or paste them) and ask what happened. PrismOS extracts indicators (IPs, domains, URLs, hashes, emails, accounts, CVEs, paths), builds a timeline with activity peaks, and runs detectors mapped to MITRE ATT&CK: password guessing and a success that followed it, new accounts and admin grants, encoded PowerShell (decoded for you), download-and-run commands, reverse shells, persistence, log clearing, credential dumping, lateral movement and web attacks (SQL injection, traversal, Log4Shell, scanners), escalating any attack that got a 200. The local model writes the story, containment, recovery and hardening from that evidence only.
  - Harden a config: sshd_config, nginx, Dockerfile, Docker Compose, Kubernetes, .env, package.json and GitHub Actions are checked line by line, each finding with a severity and the exact fix; sshd_config also comes back fully patched.
  - Harden a platform: "harden my postgres" (Linux, SSH, nginx, Apache, Docker, Kubernetes, MySQL, Redis, MongoDB, Windows, macOS, WordPress, web apps, AWS, Azure, GCP, GitHub, home routers, personal accounts) gets a prioritised plan grounded in a curated checklist.
  - Indicators are defanged and secrets masked in everything shown or saved; the full report is saved as Markdown.
- **App Builder: web design director's notes.** A one-line request now plans what that kind of site always has (a restaurant gets the menu with dietary tags, reservations and opening hours; a store gets filters, cart, checkout and empty states), with real copy, a mobile menu and accessibility. Generated code is secure by default: `target="_blank"` links get `rel="noopener noreferrer"`, and innerHTML built from variables, inline handlers, eval and tokens in localStorage are flagged in the result card.
- `query_ollama_stream` accepts optional `GenerationOverrides` (context window and sampling, clamped). The Scene Builder uses it for Qwen's recommended presence penalty against repetition loops.
- `cancel_ollama_stream` stops the in-flight stream at its next chunk. The Scene Builder uses it to end a pass that has started looping instead of spending its whole token budget.

## [0.6.0] — 2026-08-12

### 🎯 Highlights

**Brain Wrapped + Cognitive Fingerprint** — a 7-slide on-device recap of how you have been using PrismOS, plus a SHA-256 fingerprint of the 5-axis cognitive profile. Treat it as a post-use recap, not the install wedge.

### Added

- **`brain_wrapped.rs`** (~500 lines, 10 tests) — Cognitive Fingerprint engine:
  - `CognitiveFingerprint` — deterministic SHA-256 hash of 5-axis cognitive profile (depth/creativity/formality/technical_level/example_preference); same input ⇒ same hash, forever
  - 12 archetypes (Architect, Explorer, Synthesizer, Strategist, Storyteller, Specialist, Scout, Sage, Maker, Catalyst, Pragmatist, Pattern-Seer); selected via Euclidean distance to anchor points in 5-D cognitive space
  - HSL color palette + pentagon shape-points generated from the hash → unique visual signature per mind
  - `compute_compatibility(a, b)` — normalized Euclidean distance with 6-tier interpretation ("cognitive twin" → "complementary opposites")
  - `build_snapshot()` — aggregates fingerprint + profile + axis labels + drift + currents + prophecies + lifetime stats into a single shareable payload
- **`BrainWrapped.tsx`** + **`BrainWrapped.css`** (~930 lines, 11 tests) — 7-slide animated story:
  - Slide 1: SVG cognitive fingerprint pentagon
  - Slide 2: Archetype reveal with tagline
  - Slide 3: Five animated axis bars
  - Slide 4: Evolution / cognitive drift summary
  - Slide 5: Top thought currents
  - Slide 6: Edge prophecies (predicted connections)
  - Slide 7: Lifetime stats
  - Auto-advance, pause, keyboard nav (←/→/Space/Esc), PNG export via `html2canvas`, X (Twitter) share button, "◆ PrismOS-AI · prismos.ai · local · private" watermark
- **3 new Tauri commands** (96 → **99**): `generate_brain_snapshot`, `compute_cognitive_compatibility`, `get_cognitive_fingerprint`
- **Sidebar entry** "✨ Brain Wrapped" with shimmer hover gradient

### Distribution

- CI-built `/releases/latest` **v0.6.0**: Windows `.msi`/`.exe`, macOS Apple Silicon `.dmg`, macOS Intel `.dmg`, Linux x64 AppImage + `.deb`.
- `scripts/install.sh` matches those names and refuses unpublished Linux ARM. Linux is built on ubuntu-24.04 (22.04 PipeWire headers break `libspa` 0.9.2).

### Changed

- Test counts: backend **327 → 337** tests, frontend **151 → 162** tests (16 files), all passing
- `spectrum_graph.rs` — added public `get_lifetime_stats()` helper
- `Cargo.toml` — added `hex = "0.4"` dependency
- `package.json` — added `html2canvas` dependency
- `types/index.ts` — added 7 new interfaces for Brain Wrapped payload

### Why this matters

A cognitive fingerprint is a short hash over five aggregate stats about how you have used the app. It is a shareable summary, not a credential: it proves nothing, verifies nothing, and is trivially forgeable. It exists because it is a fun thing to post, and for no stronger reason than that.

---

## [0.5.2] — 2026-03-03

### 🎯 Highlights

PrismOS-AI v0.5.2 — **Phase 7–10: Self-Learning Intelligence** release. Massive expansion adding Self-Learning AI (Cognitive Drift detection, Thought Currents tracking, Edge Prophecy predictions, Refraction Journal), Domain Detection (auto-detect code/medical/legal/finance/science domains), Model Registry (15 curated models across 4 tiers), Model Tracker (per-model performance analytics), Smart Router code routing, Intent Transparency UI, Daily Dashboard, ProactivePanel, 3 Keeper Agents, comprehensive security hardening, and 478 tests.

### Added

- **Self-Learning System** — Four interconnected self-learning modules:
  - `cognitive_drift.rs` — Detects topic drift patterns over time; `DriftVector` with magnitude/direction/confidence; `analyze_drift()` identifies sudden vs gradual topic shifts; graph persistence as `drift_pattern` nodes
  - `thought_currents.rs` — Tracks recurring thought patterns and frequencies; `ThoughtCurrent` with topic/frequency/momentum/last_seen; `detect_currents()` identifies dominant thinking patterns; graph persistence as `thought_current` nodes
  - `edge_prophecy.rs` — Predicts likely future connections in the knowledge graph; `Prophecy` with predicted source/target/confidence/reasoning; `predict_edges()` uses spectral similarity + temporal patterns; graph persistence as `edge_prophecy` nodes
  - `refraction_journal.rs` — Records every AI reasoning step for introspection; `JournalEntry` with intent/context/reasoning_path/outcome/learning; `record_refraction()` + `get_journal()` + `get_insights()`; graph persistence as `journal_entry` nodes
- **Domain Detection** — `domain_detector.rs` with automatic domain classification:
  - 6 domains: Code, Medical, Legal, Finance, Science, General
  - Keyword-based detection with confidence scoring
  - `detect_domain()` returns `DomainClassification` with domain/confidence/keywords_matched
  - Used by Smart Router for model selection
- **Model Registry** — `modelRegistry.ts` single source of truth for 15 curated AI models:
  - 📝 Essential tier: qwen3:4b (🏆 default), llama3.2, phi4-mini, gemma3:4b
  - 🎯 Recommended tier: mistral, deepseek-r1, llama3.1
  - ⚡ Power tier: qwen2.5, codellama, command-r, granite3.1-dense
  - 🔬 Edge/Specialized tier: moondream, tinyllama, llama3.2-vision, nomic-embed-text
  - Each model: id, name, size, description, category, tier, isDefault, visionCapable, embeddingModel flags
  - `getModelsByTier()`, `getDefaultModel()`, `getVisionModels()`, `getEmbeddingModels()` helpers
- **Model Tracker** — `model_tracker.rs` per-model performance analytics:
  - Tracks response_time, token_count, success/failure, domain per query
  - `ModelStats` with total_queries, avg_response_time, success_rate, tokens_generated, favorite_domain
  - `record_model_usage()` + `get_model_stats()` + `get_all_model_stats()`
  - SQLite `model_usage` table with full history
- **Smart Router Code Routing** — Enhanced `smart_router.rs`:
  - Domain-aware routing: code tasks → codellama, vision tasks → llama3.2-vision
  - `RoutingDecision` includes domain, auto_swapped flag, and human-readable reason
  - Integrates with Domain Detector for automatic classification
- **Intent Transparency** — UI shows routing decisions to the user:
  - Model swap badge when Smart Router auto-switches models
  - Domain detection indicator in conversation metadata
  - Processing timer showing response latency
- **Daily Dashboard** — New unified view (`DailyDashboard.tsx`) with:
  - Hero greeting with time-of-day awareness (morning/afternoon/evening/night)
  - Stats strip: total nodes, today's additions, active agents, health score
  - Six content cards: Calendar Events, Email Summary, Finance Overview, Today's Highlights, Pending Topics, Daily Suggestions
  - Quick links grid for one-click navigation to all views
  - Auto-refresh every 10 minutes with manual refresh button
  - Spectrum theming: `[data-spectrum="dashboard"]` purple/cyan accent; keyboard shortcut `Ctrl+7`
- **ProactivePanel** — Permanent collapsible sidebar panel (`ProactivePanel.tsx`) with:
  - Live calendar, email, finance, and daily suggestions feeds
  - Graph insight card showing top Spectrum Graph node
  - Collapsible with smooth animation; state persists across sessions
- **Keeper Agents** — Three new AI agents (total now 8):
  - Email Keeper — inbox monitoring, smart notifications
  - Calendar Keeper — event awareness, scheduling reminders
  - Finance Keeper — portfolio tracking, market alerts
- **Startup View Setting** — Default view dropdown in Settings → Appearance
- **Security Hardening** — 5 critical security fixes:
  - WASM fuel/memory validation: clamped to safe ranges (1K–100M fuel, 1–256 pages)
  - Sandbox enforcement: `enforce_sandbox()` gate on all code execution paths
  - Audit log completeness: 6 new audit points (model changes, exports, setting modifications)
  - CSP meta tag: strict Content-Security-Policy in `index.html`
  - Tauri capabilities: locked to minimum required permissions in `default.json`
  - Model verification: SHA-256 integrity checks on model files

### Changed

- `lib.rs`: Added 10 new modules; registered 9 new Tauri commands; total IPC commands now **85**
- `spectrum_graph.rs`: 4 new tables (`model_usage`, `domain_cache`, `thought_currents`, `edge_prophecies`); total **14 tables**
- `Cargo.toml`: Added `default-run = "prismos"`; version bumped to 0.5.2
- Default model changed from `llama3.2` to `qwen3:4b` across all config
- Agent count increased from 5 to **8**
- All components updated with security audit recommendations

### Tests

- **478 tests total** (was 162):
  - Frontend (Vitest): **151 tests** across 16 test files
  - Backend (cargo test): **327 tests** across all Rust modules
- New test files: `cognitive_drift.test.tsx`, `thought_currents.test.tsx`, `edge_prophecy.test.tsx`, `refraction_journal.test.tsx`, `domain_detector.test.tsx`, `model_tracker.test.tsx`, `model_registry.test.tsx`, `intent_transparency.test.tsx`, `security_hardening.test.tsx`, `processing_timer.test.tsx`
- Rust tests: comprehensive unit tests in every new module (drift vectors, current detection, edge prediction, journal CRUD, domain classification, model stats, routing logic)

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

- **Spectrum Graph** — Multi-layered knowledge graph with 7-dimensional spectral embeddings (cognitive, emotional, temporal, social, creative, analytical, physical)
- **Refractive Core** — AI reasoning engine that refracts intents through the Spectrum Graph
- **SQLite Persistence** — Full graph persistence with 3-table schema (nodes, edges, spectra)
- **Multi-Agent Collaboration** — 5 specialized agents (Planner, Researcher, Coder, Reviewer, Executor) with structured messaging, voting, and consensus
- **Sandbox Prisms** — Isolated execution with HMAC-SHA256 signing, allow-list enforcement, anomaly detection, and auto-rollback
- **You-Port** — Device-bound encrypted state migration for session handoff
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

[0.5.2]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mkbhardwas12/prismos-ai/compare/v0.1.0-alpha...v0.2.0
[0.1.0-alpha]: https://github.com/mkbhardwas12/prismos-ai/releases/tag/v0.1.0-alpha
