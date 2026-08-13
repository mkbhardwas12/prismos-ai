# Contributing to PrismOS-AI

Thanks for looking. This project has had one contributor for most of its life,
so almost anything you send is welcome — including "I installed it and it did
this weird thing."

## The single most useful contribution

Install it on hardware I don't own and report what happened. I develop on an
Apple Silicon Mac. Windows, Intel Macs, and every Linux distro are effectively
untested in the wild. A first-run report — what worked, what broke, what was
confusing — is worth more to this project than a feature PR.

Note that the installers are **unsigned**, so macOS and Windows will warn you.
The README explains how to get past it, and that's part of what I'd like
reports on.

## Development setup

| Tool | Version | Needed for |
|------|---------|-----------|
| [Node.js](https://nodejs.org/) | ≥ 18 | everything |
| [Ollama](https://ollama.com/) | latest | running a model |
| [Rust](https://rustup.rs/) | ≥ 1.75 | the desktop app and CLI only |

```bash
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai
npm install
```

### Frontend-only loop (no Rust needed)

If you're working on React components, styling, or anything in `src/`, this is
the loop you want. It's seconds, not minutes:

```bash
npm run dev
```

Tauri IPC calls are unavailable in this mode, so backend-dependent views will
show empty states. That's expected.

### Full desktop app

Needs the Rust toolchain plus your platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
# Start Ollama first — on macOS the desktop app already runs it,
# in which case `ollama serve` will say "address already in use" and
# you can skip it.
ollama serve

# Pull the default model (this is what the app expects)
ollama pull qwen3:4b

npm run tauri dev
```

## Before you open a PR

```bash
npx tsc --noEmit                  # type-check, must be clean
npx vitest run                    # frontend tests, must be green
cd src-tauri && cargo test        # Rust tests, if you touched Rust
```

You do **not** need to run `npm run tauri build` — that's a full release build
and CI does it for you. If CI catches something, we'll fix it in the PR.

## Submitting

1. Fork, then branch: `git checkout -b fix/thing-that-was-broken`
2. Make the change
3. Run the checks above
4. Commit with a [conventional commit](https://www.conventionalcommits.org/)
   prefix — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
5. Push and open a PR against `main`

Small PRs get reviewed fast. Large ones are fine too, but open an issue first
so you don't build something I was about to rip out.

## Reporting bugs

Include your OS and version, whether you used an installer or built from
source, the model you were running, and what you expected versus what happened.
Screenshots help. If the app logged something, include it.

## Code style

**TypeScript / React** — functional components with hooks, typed props and
state, components under ~300 lines, `useCallback` for anything passed as a prop.

**Rust** — standard `rustfmt`, `Result<T, E>` over `unwrap()` in non-test code,
`#[cfg(test)]` modules where the logic is worth pinning down.

**CSS** — custom properties for colors and spacing, the BEM-ish naming already
in use, a section comment header for each new feature area.

## Where things live

```
src/               React frontend (TypeScript)
src/components/    UI components
src/lib/           agents, Ollama client, model registry, config
src/test/          frontend tests (Vitest)
src-tauri/src/     Rust backend — one module per subsystem
src-tauri/src/agents/   multi-agent graph
docs/              architecture diagrams, screenshots, specs
```

## License

By contributing you agree your contributions are licensed under the MIT
License, same as the rest of the project.
