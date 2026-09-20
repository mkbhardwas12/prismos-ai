# PrismOS-AI

> **A desktop AI that reads your files, answers offline, and remembers — in a knowledge graph that lives on your disk, not someone's server.**

Drop a PDF and ask. A local [Ollama](https://ollama.com) model answers, and what it learns lands in a SQLite knowledge graph you can explore in 3D and that the *next* conversation can use. Works with Wi-Fi off.

<p align="center">
  <a href="https://github.com/mkbhardwas12/prismos-ai/releases/latest">
    <img src="docs/media/prismos-demo.gif" width="880" alt="PrismOS-AI demo — drop a file, ask a question, answer stays on the laptop" />
  </a>
  <br/>
  <sub>
    <a href="docs/media/prismos-demo.mp4">▶ 1280×720 MP4 (with voiceover)</a> ·
    <a href="docs/media/stream-demo.mp4">live Ollama stream</a> ·
    <a href="docs/screenshots/">stills</a>
  </sub>
</p>

[![CI](https://github.com/mkbhardwas12/prismos-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/mkbhardwas12/prismos-ai/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mkbhardwas12/prismos-ai?label=download)](https://github.com/mkbhardwas12/prismos-ai/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Ollama](https://img.shields.io/badge/LLM-Ollama%20(local)-blueviolet)](https://ollama.com)

Tauri 2 + React 18 + Rust · MIT · no account, no sign-up, no telemetry.
Private inference is loopback-only Ollama; the exact network boundary is spelled
out in [What stays local](#what-stays-local-and-what-can-use-the-network).

---

## What it does

| | |
|---|---|
| **Remembers across sessions** | Answers and concepts persist to a local SQLite knowledge graph. Explore it as a [3D/2D atlas](docs/KNOWLEDGE_ATLAS.md), filter by source, read notes, trace connections, scrub a timeline. The next conversation retrieves from it. |
| **Reads your documents** | PDF, DOCX, PPTX, XLSX. Text is extracted on-device, chunked, and retrieved with TF-IDF instead of naively truncated. |
| **Talks to any local model** | Streaming chat against any Ollama model; curated registry of 18 models with hardware-aware recommendations on first run. Attach an image and it swaps to a vision model, then swaps back. |
| **Generates documents, decks and small apps** | Ask for a report, a slide deck (5 layouts, speaker notes) or a self-contained HTML app; it writes the file locally and opens it. |
| **Agent roles debate the answer** | Orchestrator, Reasoner, Memory Keeper, Tool Smith and Sentinel vote on the response before it's shown; operation approvals go through a small wasmtime policy module. |
| **Stays out of your way** | Global hotkey summons it over any app; it minimizes to the tray and the agents stay resident. |

Optional, **off by default**, opt-in: user-directed Web Research (only URLs you
type), IMAP Email Keeper, Yahoo Finance Keeper. Full feature history in
[CHANGELOG.md](CHANGELOG.md).

---

## Try it

> **Installers are unsigned** (one maintainer, no cert yet — it's on the
> roadmap). macOS: `xattr -rd com.apple.quarantine /Applications/PrismOS-AI.app`
> or System Settings → Privacy & Security → *Open Anyway*. Windows: SmartScreen
> → **More info → Run anyway**. Or skip the dance: use the
> [CLI](#the-60-second-version-use-the-cli) or [build from source](#build-from-source).

### Install

```bash
# macOS / Linux x64 — read the script first: scripts/install.sh
curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh
```

```powershell
# Windows — per-user, no admin. Read it first: scripts/install.ps1
irm https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.ps1 | iex
```

The script resolves the right asset for your architecture, **verifies its
SHA-256 against the digest GitHub publishes** and aborts on mismatch, then
bootstraps [Ollama](https://ollama.com) with `qwen3:4b` if you don't have it.

**What it costs you before the first answer:** ~15 MB app + the Ollama runtime
+ ~2.5 GB of model weights. Budget 5–15 minutes on a decent connection. You
need roughly 4 GB of free RAM to run `qwen3:4b` comfortably.

On macOS you can also install through the tap:

```bash
brew tap mkbhardwas12/prismos
brew install --cask prismos-ai   # add --no-quarantine to skip the Gatekeeper dance
```

Prefer to click? Grab an installer from the
[Releases page](https://github.com/mkbhardwas12/prismos-ai/releases/latest):

| Platform | Asset |
|---|---|
| Windows x64 | `.msi` (recommended) or `.exe` |
| macOS Apple Silicon | `PrismOS-AI_0.6.0_aarch64.dmg` |
| macOS Intel | `PrismOS-AI_0.6.0_x64.dmg` |
| Linux x64 | `.AppImage` or `.deb` |
| Linux ARM | not published — [build from source](#build-from-source) |

---

## The 60-second version: use the CLI

If you'd rather not install a desktop app to evaluate this, don't. There's a
standalone binary that talks straight to your local Ollama daemon — no GUI, no
Gatekeeper, no quarantine flag:

```bash
cargo build --release --bin prismos-cli

./target/release/prismos-cli health          # is the daemon up?
./target/release/prismos-cli models          # what's pulled locally
./target/release/prismos-cli ask "explain WASM fuel metering in one paragraph"
cat notes.md | ./target/release/prismos-cli ask --stdin --model qwen3:4b
```

`PRISMOS_MODEL` and `PRISMOS_OLLAMA_URL` override the defaults. It's pipeable,
so it composes with the rest of your shell.

Here's a real run — unedited, `qwen3:4b` (Q4_K_M, 2.5 GB) on an M5 Max, 64 GB:

```console
$ prismos-cli ask "explain WASM sandboxing in one paragraph"
WebAssembly (WASM) modules themselves do not include built-in sandboxing;
instead, **browsers enforce strict security policies that isolate WASM
execution within a secure sandbox** to prevent malicious behavior. This
sandbox restricts WASM from directly accessing the DOM, file system, network
resources, or other system-level features, enforces memory isolation via
linear memory with strict access controls (preventing memory corruption or
unauthorized reads/writes), and requires code signing to verify module
integrity before execution. By design, browsers treat WASM as a confined,
trusted environment that minimizes attack surfaces while enabling
high-performance web applications without compromising security—effectively
acting as a critical layer of defense against exploits like cross-site
scripting (XSS) or resource theft when WASM code is deployed in the browser
context.
```

8.4 s wall-clock (including the model's hidden reasoning pass), 134 tokens/s.
And an honesty note: the answer has a small-model wobble — WASM does *not*
require code signing. That's what a 2.5 GB model really sounds like; bigger
local models sharpen it, and nothing leaves the machine either way.

---

## What stays local, and what can use the network

Private inference requests—including document text, images, summaries and
embeddings—use the fixed `http://127.0.0.1:11434` daemon. The desktop and CLI
inference clients disable proxies and redirects. The configurable Ollama URL
is for management/status; desktop inference ignores it and CLI `ask` rejects
remote/custom endpoints. This does **not** attest that the separately managed
Ollama daemon or its selected model is offline.

The webview also has this Content Security Policy connection allow-list, from
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json):

```
connect-src 'self' http://localhost:11434 http://127.0.0.1:11434
```

This constrains webview requests, **not Rust network clients, Ollama, or your
system browser**. Local chat can work without internet once its models are
installed, but PrismOS is not an OS-level network sandbox:

- Installers, model/voice downloads, configured model-management endpoints and
  update checks can access external services.
- The optional **Email Keeper** agent connects to *your* IMAP server if you
  configure it. It is off by default.
- The optional **Finance Keeper** fetches public market data from Yahoo Finance.
  Its requests reveal the ticker symbols being requested. It is off by default.
- The optional **Web Research** feature fetches web pages — but only the URLs
  you explicitly type into chat, over HTTPS, with localhost/LAN addresses
  refused. It is off by default, double-gated (a Settings toggle plus a
  Rust-side gate that hard-refuses fetches while disabled), uses no search
  engine, and sends nothing in the background. Fetches run in parallel, and
  saying *"explore"* additionally follows the most relevant links found on the
  pages you named — bounded, and every followed link passes the same gates.
  What it reads is indexed into the local knowledge graph so later answers can
  retrieve it; that indexing is local SQLite, not telemetry.
- Opening a URL uses your system browser, which can access the internet even
  when Web Research is disabled. Reading a screen sends the captured image to
  local Ollama, but does not make the page you opened an offline page.

Generated app pages receive a restrictive policy before model-generated
markup. This limits resource loading and fetches; it is not a full browser
sandbox or a guarantee against navigation to another site. Review generated
code before using it with sensitive information.

For an offline check, disable optional integrations, install the required models,
disconnect the network, and test the workflows you use. Network monitoring must
include PrismOS, Ollama and any browser it opens—not just the webview.

See also the [2026-09-08 audit and remaining release blockers](docs/AUDIT_2026-09-08.md)
and the [reviewed public knowledge pack](resources/knowledge/reliable-local-assistant/manifest.json)
(public reference guidance only; your personal knowledge database stays outside
this repository, and ingestion is not model training).

---

## Security model

Every row links to the code, because a table of self-awarded checkmarks isn't
evidence.

| Layer | What it does | Source |
|---|---|---|
| WASM policy checks | A small module checks operation approvals; host-side work is not contained by its fuel/memory limits | [`sandbox_prism.rs`](src-tauri/src/sandbox_prism.rs) |
| Action tags | HMAC tags use public identifiers; they are not trusted code signatures | [`sandbox_prism.rs`](src-tauri/src/sandbox_prism.rs) |
| 3-tier allow-list | Operation categories and per-role permissions, not an OS permission boundary | [`sandbox_prism.rs`](src-tauri/src/sandbox_prism.rs) |
| Audit chain | Local SHA-256 chain detects consistency errors; it is neither immutable nor protected against full-file rewriting | [`audit_log.rs`](src-tauri/src/audit_log.rs) |
| Hardware detection | Detects platform hardware; current software key derivation does not perform protected TPM/Secure Enclave key operations | [`secure_enclave.rs`](src-tauri/src/secure_enclave.rs) |
| Live storage | Ordinary, unencrypted SQLite in local app data; use OS disk encryption and access controls | [`spectrum_graph.rs`](src-tauri/src/spectrum_graph.rs) |
| Graph exports | AES-GCM payloads, but legacy identity-derived keys and a fast passphrase derivation need a versioned security upgrade; keep exports private | [`you_port.rs`](src-tauri/src/you_port.rs) |
| Private inference transport | Literal loopback, no proxies or redirects; does not attest the Ollama daemon | [`ollama_bridge.rs`](src-tauri/src/ollama_bridge.rs) |
| Webview CSP | Limits frontend resource connections; does not restrict Rust or external browser traffic | [`tauri.conf.json`](src-tauri/tauri.conf.json) |

Policy checkpoints are status records, not full data snapshots. They do not
provide automatic rollback of arbitrary filesystem or database changes.

### Private knowledge and recovery

Keep personal knowledge, training data, databases, state files and exports
outside public Git. `.gitignore` is a convenience, not a security boundary:
already tracked files and forced additions bypass it. Before committing run
`node scripts/check-public-files.mjs --staged`; before publishing run it with
`--tracked`. This filename-only guard does not inspect secrets inside source,
documents, screenshots or Git history; those require a separate review.

You-Port and Graph Export are **graph exports, not full disaster-recovery
backups**. They do not preserve the complete SQLite database, embeddings,
feedback/history/profile tables, application settings or original source files.
Startup handoff recovery is limited to an empty graph; manual imports merge
records rather than provide complete point-in-time rollback. Identity-derived
exports can fail after device/account/path changes. Do not rely on their current
encryption as protection for public storage.

A full recovery plan needs versioned, independently protected backups of app
data, settings and original private sources, outside this public checkout,
plus recovery keys stored separately. Capture SQLite consistently using a
backup-capable tool or after fully quitting the app; copying a live `.db` alone
can omit WAL changes. Test restoration into an isolated destination before
depending on a backup. Automatic private Git backup/key recovery is not yet a
shipped feature; the local build helper preserves app code, not knowledge.

**Not yet independently audited.** No third party has reviewed this. If you
work in security and want to look, open an issue — I'll take the findings.

---

## Architecture

<p align="center">
  <img src="docs/diagrams/architecture-overview.svg" width="800" alt="PrismOS-AI system architecture" />
</p>

React frontend → Tauri IPC → Rust backend (agents, graph, sandbox) → SQLite +
local Ollama. More diagrams — data flow, security model, the intent pipeline —
in [docs/diagrams/](docs/diagrams/).

Current counts, if you're curious: 105 IPC commands, 23 Rust modules plus 5
agent sub-modules, 24 React components. Verify with
`grep -c '^#\[tauri::command\]' src-tauri/src/lib.rs`.

---

## Build from source

```bash
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai
npm install

# Frontend only — fastest loop, no Rust toolchain needed
npm run dev

# Full desktop app — needs Rust ≥ 1.75 and your platform's Tauri prereqs
npm run tauri dev
```

Checks:

```bash
npx tsc --noEmit                  # type-check
npx vitest run                    # 176 frontend tests
cd src-tauri && cargo test        # Rust suite
```

CI runs all of these on every push and PR.

---

## Contributing

Genuinely wanted, and the bar is low — this project has had exactly one
contributor for most of its life. Good places to start are tagged
[`good first issue`](https://github.com/mkbhardwas12/prismos-ai/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
Setup, code style, and the PR process are in [CONTRIBUTING.md](CONTRIBUTING.md).

The most useful thing anyone can do right now is **install it and tell me what
broke**. Reports on hardware I don't own are worth more than code.

## Extending it

A *skill* is a folder with a `SKILL.md` and a `manifest.json` that runs in the
same WASM sandbox as the built-in agents. The spec is an open v0.1 draft in
[`docs/SKILLS.md`](docs/SKILLS.md) — comments and PRs welcome before the
implementation lands.

---

## Where this actually stands

Being straight about it, because you can check most of this anyway:

- **It works.** v0.6.0 ships CI-built installers for Windows, both Macs, and
  Linux x64. 176 frontend tests and the Rust suite pass; CI is green.
- **Almost nobody uses it yet.** A few dozen installer downloads. The star and
  fork counts on this repo are not a reliable signal of anything — judge it by
  the release download counts, the issue tracker, and the commit log.
- **The auto-updater is not wired up.** The plugin is compiled in but update
  signing isn't configured, so it does nothing. Update by downloading the new
  installer.
- **Installers are unsigned.** See the macOS/Windows note above.
- **Linux ARM has no published build.** Build from source.

## Tech stack

Tauri 2.0 · React 18 · TypeScript 5.5 · Vite 5.4 · Rust 2021 · SQLite
(rusqlite) · wasmtime 27 · Ollama · AES-256-GCM · HMAC-SHA256 · GitHub Actions

## Related

[**quant-truth**](https://github.com/mkbhardwas12/quant-truth) — an open,
reproducible check of how quantization changes a local model's answers. Same
motivation: measure the thing instead of asserting it.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<p align="center">
  <sub>Built by <a href="https://github.com/mkbhardwas12">Manish Kumar</a> ·
  <a href="https://github.com/mkbhardwas12/prismos-ai/releases/latest">Download</a> ·
  <a href="https://github.com/mkbhardwas12/prismos-ai/issues">Issues</a> ·
  <a href="CHANGELOG.md">Changelog</a></sub>
</p>
