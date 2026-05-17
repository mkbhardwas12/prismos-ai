# Launch posts — Show HN, r/LocalLLaMA, Twitter/X

Three ready-to-post drafts for the v0.6 launch push, all built around the same narrative: **PrismOS is the offline counterpart to cloud agents** (Hermes, GPT, Claude). Each one is tuned to the platform's voice and the audience's BS-detector.

For long-form (LinkedIn) see `LAUNCH_POST.md` in the repo root.

Posting order suggestion (Tuesday or Wednesday, 9am ET):

1. Show HN at 9:00 ET (HN front-page window).
2. r/LocalLLaMA at 9:15 — links back to the HN thread for "discussion".
3. Twitter/X thread at 9:30 — links to both.

The single decisive asset is the demo GIF — get that right first (see `DEMO_RECORDING.md`).

---

## 1. Show HN

**Title** (HN cuts at 80 chars, this is 78):

> Show HN: PrismOS-AI – Local-first agentic OS with 8 AI agents that debate offline

**Body** (HN strips Markdown — keep it plain, short, link the GIF):

```
Hi HN — I've been building PrismOS-AI for about a year and just shipped v0.6.

Demo (30s GIF): https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/docs/screenshots/prismos-demo.gif

The thing I wanted didn't exist: a desktop AI that

  - keeps all my data on my laptop,
  - has persistent memory across conversations (not just a session window),
  - actually uses multiple agents that disagree with each other, not "agentic mode" that's one model doing tool calls.

So I built it. Tauri 2.0 + React 18 + Rust. All inference goes through a local
Ollama daemon. Eight agents (Orchestrator, Memory Keeper, Reasoner, Tool Smith,
Sentinel, Email/Calendar/Finance Keepers) run a LangGraph-style debate and a
consensus vote. Everything they produce lands in a 7-dimensional SQLite
"Spectrum Graph" that grows over time.

A few things that I think are actually interesting:

  - WASM Sandbox Prism: every agent action runs inside wasmtime with a per-agent
    allow-list and CPU fuel limit. Restricted ops get auto-rolled back with a
    plain-English explanation.
  - Smart Router: detects when you've attached an image or asked a code
    question, swaps to llava / a code model, swaps back after. You set this once,
    not per-conversation.
  - Brain Wrapped: a Spotify-Wrapped-style 7-slide story of how YOU think,
    generated entirely from local cognitive data. You can export the whole
    thing as a single PNG.
  - One-line install: `curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh`
    bootstraps Ollama if it's not already there, pulls qwen3:4b, drops the
    signed binary in /Applications or /usr/local/bin.

What it isn't: a Hermes / Claude / GPT replacement when you want frontier
quality. Local models top out around qwen3:4b / phi-4 / llama 3.2 on most
laptops — fine for "summarize this", "what changed", "draft this email" but
not for "write me a 10k-word research report". Pick the right tool for the
job; sometimes that tool should run on your machine.

Repo (MIT, US provisional patent on the architecture): https://github.com/mkbhardwas12/prismos-ai
CLI (no GUI required): `cargo install --path src-tauri --bin prismos-cli`

Happy to answer questions about the sandbox model, the LangGraph workflow, or
why I picked SQLite over a real graph DB. Roast away — that's why I'm here.
```

**Reply playbook** — pre-drafts for the comments you'll definitely get:

| Comment | Reply |
|---|---|
| "Why not just use Ollama directly?" | Ollama is the inference backend. PrismOS is the layer above: persistent memory, multi-agent debate, sandboxing, the cognitive graph. You can still drop down to raw Ollama via `prismos-cli`. |
| "Patent pending on what exactly?" | The Spectrum Graph + Refractive Core architecture, not on running models locally. Code is MIT. The patent line is there because investors and customers ask. |
| "How is this different from $other_local_agent?" | Three things: persistent 7D knowledge graph, formal multi-agent debate (not tool calls), WASM sandbox with auto-rollback. Most others are wrappers around a single model. |
| "Does it work without a GPU?" | Yes — qwen3:4b runs at conversational speed on an M1 or a recent Intel. We auto-recommend a model based on detected hardware. |

---

## 2. r/LocalLLaMA

**Title**:

> [Release] PrismOS-AI v0.6 — 8-agent debate, persistent 7D memory, all offline (MIT + Rust)

**Body** (Markdown OK on Reddit):

> **Hermes is your cloud agent. PrismOS is your offline cofounder.**

I lurked here for months while building this. Posting now because v0.6 is the first version I'd actually use myself.

**What it is.** Local-first desktop app (Tauri + Rust + React) that runs on top of your existing Ollama install. Eight agents collaborate through a LangGraph debate pipeline, with everything persisted to a 7-dimensional SQLite "Spectrum Graph" that grows over time.

**What it gives you that a single-model setup doesn't:**

- **Memory across sessions.** Every intent lands in the graph. The next conversation can reference it without you re-pasting.
- **Smart Router.** Auto-swaps to a vision model (llava / llama3.2-vision) when you attach an image, swaps back after. Same for code-heavy queries.
- **Per-agent WASM sandbox.** Every action runs inside wasmtime with a per-agent capability list. Anomalous actions get auto-rolled back.
- **Brain Wrapped.** Spotify-Wrapped-but-for-your-mind: 7-slide animated story of how you think, generated entirely from local data, exports as a single shareable PNG.

**What it doesn't do.** Replace Claude / GPT for frontier-quality work. Local models cap out where they cap out. PrismOS is for the work that should never leave your laptop in the first place.

**Hardware notes.**
- M1/M2: qwen3:4b is conversational speed, phi-4 is fine, llama3.2 is comfortable.
- 16GB intel: qwen3:4b / llama3.2:3b are the sweet spot.
- 8GB intel: qwen3:1.7b or phi-3:mini, expect slower responses on long contexts.

The onboarding wizard auto-recommends based on `sysinfo`-detected hardware.

**One-line install** (macOS + Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh
```

Windows: `.msi` on the [releases page](https://github.com/mkbhardwas12/prismos-ai/releases/latest).

**Source + license**: MIT, [github.com/mkbhardwas12/prismos-ai](https://github.com/mkbhardwas12/prismos-ai). Patent-pending on the architecture (Spectrum Graph + Refractive Core), code itself is open.

**Demo GIF**: ↑ at top of the README.

Open to feedback — particularly interested in what models you'd want as defaults at each hardware tier, and whether the WASM sandbox model is too restrictive for the workflows you actually run.

---

## 3. Twitter / X thread

8 tweets. Each one stands alone — if someone retweets just tweet 3, it still says something.

> **1/** Hermes is your cloud agent.
>
> PrismOS is your offline cofounder.
>
> Built it because I wanted an AI that worked on a plane, kept everything on my laptop, and actually remembered me from yesterday.
>
> v0.6 just shipped. MIT + Rust. ↓
>
> [attach: demo.gif]

> **2/** What it does, in one sentence:
>
> Ask anything. Eight local agents debate it, remember it, and refract it — all on your laptop, offline.
>
> No round-trip to anyone's cloud. No per-token cost. No "we may use your data to improve the model."

> **3/** A side-by-side, because the question is always "vs Hermes / GPT / Claude":
>
> Cloud agents → great when you have Wi-Fi + are OK paying per token.
>
> PrismOS → for the work that should never leave your laptop in the first place. Contracts. Codebases. Journals. Half-finished ideas.

> **4/** Three things I think are actually new:
>
> • Spectrum Graph — 7-dimensional persistent memory
> • Refractive Core — multi-agent debate w/ formal consensus
> • Sandbox Prism — WASM-isolated action execution + auto-rollback
>
> US provisional patent filed Feb 2026.

> **5/** Brain Wrapped 🪐
>
> Spotify Wrapped, but for your mind. 7-slide animated story generated entirely from local cognitive data. Export the whole thing as one PNG.
>
> Yours, mathematically unique, never uploaded.
>
> [attach: brain-wrapped-poster.png]

> **6/** Install in one line (mac/linux):
>
> ```
> curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh
> ```
>
> It detects your OS, pulls the latest signed binary, and bootstraps Ollama if it's not already installed.

> **7/** CLI mode for devs who don't want a GUI:
>
> ```
> prismos-cli ask "explain WASM sandboxing in one paragraph"
> cat notes.md | prismos-cli ask --stdin --model qwen3:4b
> ```
>
> Talks straight to your local Ollama. Zero ceremony.

> **8/** Repo (MIT): https://github.com/mkbhardwas12/prismos-ai
>
> Discussion on HN: [link]
>
> What you'd build with it: replies welcome.

---

## Bonus — Comparison table (paste into any post that needs it)

```
                          Hermes / GPT / Claude   |   PrismOS-AI
Runs where                Someone else's GPU      |   Your laptop
Data egress               Every prompt + reply    |   Zero bytes
Works on a plane          No                      |   Yes
Per-token cost            Yes                     |   None
Memory                    Session window          |   Persistent 7D graph
Multi-agent               Tool calls, one model   |   8 agents, formal debate
Plugins                   Vendor catalog          |   Local skills + WASM
```
