# Launch posts — Show HN, r/LocalLLaMA, X

Rewritten 2026-08-12 after the deep-research report. The old drafts led with
"agentic OS", "7D", Hermes contrast, and Brain Wrapped. Those get roasted.
These lead with installers, file formats, and what runs with Wi-Fi off.

Do **not** quote 236★ / 214 forks. Honest figures (2026-08-12): 47 lifetime
installer downloads, 2 watchers, empty issues until the seed batch, 1 contributor.

Post only after you have read the post out loud. Do not paste LLM cadence
("Not X — but Y"). One human post, not three platforms in 30 minutes.

Suggested order (weekday morning in US time):

1. Show HN
2. r/LocalLLaMA, after the HN thread exists, asking what broke
3. Skip X unless you already have a real account people follow

Demo file that actually exists: `docs/media/prismos-demo.gif`
(not `docs/screenshots/prismos-demo.gif`).

---

## 1. Show HN

**Title** (78 chars):

> Show HN: PrismOS-AI – desktop AI that answers over your files, fully offline

**Body** (plain text; HN strips Markdown):

```
Hi HN — I shipped PrismOS-AI v0.6.0, a desktop app that talks to a local
Ollama model. Drop a PDF (or DOCX/PPTX/XLSX), ask a question, get an answer
that stays on the laptop. Works with Wi-Fi off.

Installers on the GitHub release (v0.6.0):
  Windows x64: .msi / .exe
  macOS: Apple Silicon .dmg and Intel .dmg
  Linux x64: .AppImage and .deb
  Linux ARM: not published; build from source

https://github.com/mkbhardwas12/prismos-ai/releases/latest

macOS / Linux x64 one-liner (read the script first):
  curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh

Windows:
  irm https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.ps1 | iex

Demo (GIF): https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/docs/media/prismos-demo.gif
MP4: https://github.com/mkbhardwas12/prismos-ai/blob/main/docs/media/prismos-demo.mp4

Stack: Tauri 2 + React 18 + Rust. Inference is loopback Ollama only
(default qwen3:4b). Answers and notes land in a local SQLite knowledge graph
so the next conversation can use them. MIT.

It is not a cloud-model replacement. Local 4B-class models are fine for
"what changed in this contract" and a bad fit for a 10k-word research report.

Repo: https://github.com/mkbhardwas12/prismos-ai
What broke on first run? That is the useful comment.
```

**Reply playbook**

| Comment | Reply |
|---|---|
| "Why not just use Ollama?" | Ollama is the model server. This is the desktop shell: file drop, a local graph that persists, and an installer. `prismos-cli` still talks to the same daemon. |
| "Is inference actually local?" | Yes. After Ollama and a model are on the machine, prompts go to `localhost:11434`. The install script may hit the network once to fetch Ollama and the model. |
| "GPU?" | qwen3:4b is usable on an M1 and on recent 16GB x64 boxes. The onboarding wizard picks a smaller model if RAM is tight. |

---

## 2. r/LocalLLaMA

**Title**:

> [Release] PrismOS-AI v0.6 — Win / macOS / Linux x64 installers, local Ollama, works with Wi-Fi off

**Body**:

I shipped v0.6.0 of PrismOS-AI. Desktop app on top of your Ollama install.
Drop a file, ask a question, the answer stays on disk. No account.

**Installers** (GitHub release v0.6.0): Windows `.msi`/`.exe`, macOS arm64 +
Intel `.dmg`, Linux x64 `.AppImage` + `.deb`. Linux ARM is not published.

https://github.com/mkbhardwas12/prismos-ai/releases/latest

```bash
# read it first
curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh
```

**Hardware I actually use**
- Apple Silicon: `qwen3:4b` is the default
- 16GB x64: same, or `llama3.2:3b`
- 8GB: `qwen3:1.7b` / `phi-3:mini` — expect it to feel slow

Onboarding reads `sysinfo` and suggests a tier. Swap models in Settings.

**What I want from this thread:** what broke on first run. Model too big,
AppImage not executable, Windows SmartScreen, Ollama already on a weird
port — those reports are more useful than stars.

MIT: https://github.com/mkbhardwas12/prismos-ai
Demo: the GIF at the top of the README (`docs/media/prismos-demo.gif`).

---

## 3. X (optional, last)

Do not lead with a coined metaphor. One post is enough:

> PrismOS-AI v0.6.0 is on GitHub Releases: Windows .msi, macOS arm64+Intel
> .dmg, Linux x64 AppImage/.deb. Drop a file, ask locally, Wi-Fi can be off.
> https://github.com/mkbhardwas12/prismos-ai/releases/latest

Attach `docs/media/prismos-demo.gif` if the client will play it.
