# v0.6 launch gate

Re-verified 2026-08-12 (keep-working loop) against GitHub Releases,
`scripts/install.sh`, and release workflow run `31621834468`.
Do not mark v0.6 "latest" until every **blocker** is checked.
Do not launch Show HN / r/LocalLLaMA until the installers exist.

Source of the ranking: the 2026-08-12 deep-research report
(install friction converts; stars, coined metaphors, and "patent pending" do not).

## What is actually published today

`/releases/latest` still resolves to **v0.5.1** (published after v0.5.2, so GitHub
treats 0.5.1 as latest). Lifetime binary downloads across the two published tags: **43**.

Draft **v0.6.0** exists (`releaseDraft: true`) and is **not** latest.

| Asset | `install.sh` glob | v0.5.1 latest | v0.6.0 draft |
|---|---|---|---|
| Apple Silicon `.dmg` | `aarch64\.dmg` | ships | ships (`PrismOS-AI_0.6.0_aarch64.dmg`) |
| Intel Mac `.dmg` | `_x64\.dmg` | **missing** | ships (`PrismOS-AI_0.6.0_x64.dmg`) |
| Windows `.exe` / `.msi` | `install.ps1` path | ships | ships (`PrismOS-AI_0.6.0_x64-setup.exe`, `_x64_en-US.msi`) |
| Linux x64 AppImage | `(amd64\|x86_64)\.AppImage` | **missing** | **missing — ubuntu-22.04 job failed** |
| Linux ARM AppImage | refused in `install.sh` | n/a | n/a |
| Linux `.deb` | README must not claim this until attached | **missing** | **missing** (same Linux job) |
| `PrismOS-AI_aarch64.app.tar.gz` | updater, not the one-liner | ships | not yet on draft |

### Linux failure (2026-08-12)

Release job `build-desktop (ubuntu-22.04, --bundles appimage,deb)` failed compiling
crates.io `libspa 0.9.2` against Ubuntu 22.04 PipeWire headers:

- `spa_video_info_raw` has no field `flags`
- `modifier` is `i64` in the system header, `u64` in the crate

CI `cargo test` already passes on `ubuntu-latest` (24.04). The working-tree fix
is to build Linux on **ubuntu-24.04**, not 22.04. Do not advertise Linux until
an AppImage is attached to the draft.

Android desktop-adjacent job also failed; not a desktop-launch blocker.

## Version files (local `main` at e4ede09 + this loop)

| File | Current |
|---|---|
| `package.json` | 0.6.0 |
| `src-tauri/tauri.conf.json` | 0.6.0 |
| `src-tauri/Cargo.toml` | 0.6.0 |
| README version badge | GitHub latest-release shield (currently shows 0.5.1 — correct until draft publishes) |
| `CHANGELOG.md` | `[0.6.0] — 2026-08-12` |
| GitHub latest tag | v0.5.1 |
| GitHub draft tag | v0.6.0 |

- [x] Bump all four version files to **0.6.0** in one commit (`e4ede09`)
- [x] CHANGELOG 0.6.0 date is the ship-prep day (2026-08-12)
- [x] README download table describes `/releases/latest` only (Win + Apple Silicon)
- [x] Draft release notes list only attached assets (both Mac `.dmg`s + Win `.msi`/`.exe`)

## Blockers (v0.6 is not latest until these pass)

- [x] Apple Silicon `.dmg` attached on the draft (`*aarch64.dmg`)
- [x] Intel Mac `.dmg` attached on the draft (`*x64.dmg`)
- [x] Windows `.msi` and `.exe` attached on the draft
- [ ] Linux x64 AppImage attached (`*amd64.AppImage` or `*x86_64.AppImage`)
- [x] Linux ARM: `install.sh` refuses with a clear message (do not glob-miss)
- [ ] Linux `.deb` **or** every public note stops listing `.deb` until it exists
- [ ] On a clean Apple Silicon Mac: `curl …/install.sh | sh` opens the app
      (still hits **v0.5.1** until the draft is published)
- [ ] On a clean Windows box: `.msi` installs without admin, Ollama bootstrap works
- [ ] On a clean Ubuntu box: AppImage is executable and talks to local Ollama
- [x] `npx tsc --noEmit` clean (2026-08-12 this loop)
- [x] `npx vitest run` green — **176** tests, 17 files (2026-08-12 this loop)
- [ ] `cd src-tauri && cargo test` green (not re-run in this loop)
- [x] GitHub repo homepage is the repo URL, not `#-what-is-prismos`
- [x] Demo section links `docs/media/prismos-demo.mp4`, never `https://youtube.com`
- [x] First README screen does not say "patent pending", "AI operating system",
      or claim Linux/Intel as published

## After the binaries exist (not before)

- [ ] Show HN — lead with install command, file formats, and what runs with
      Wi-Fi off. Do not lead with star/fork counts.
- [ ] r/LocalLLaMA — hardware notes + model tiers. Ask what broke.
- [ ] One GitHub Discussion that invites first-run reports
- [ ] Seed 5–8 labeled issues (`good first issue`, `help wanted`) so the
      issues tab is not empty

## Do not do this month

- Buy or farm stars. HN treats that as fraud.
- Quote 236★ / 214 forks as traction. Honest figures: 43 lifetime installer
  downloads, 2 watchers, 0 issues, 1 contributor.
- Lead with Brain Wrapped. Treat it as a post-use recap, not the install wedge.
- Launch the existing `docs/LAUNCH_POSTS.md` drafts before the missing
  installers exist.
- Mark the v0.6.0 draft as latest while Linux is red.

## Commands

```bash
# PRE / POST gates
npx tsc --noEmit
npx vitest run
cd src-tauri && cargo test

# What GitHub will actually serve to install.sh
gh release view --json tagName,publishedAt,isDraft,assets \
  --jq '{tag:.tagName, published:.publishedAt, draft:.isDraft, assets:[.assets[].name]}'
gh release view v0.6.0 --json isDraft,assets \
  --jq '{draft:.isDraft, assets:[.assets[].name]}'

# After publishing v0.6.0, confirm every live glob hits
# aarch64\.dmg  _x64\.dmg  (amd64|x86_64)\.AppImage
```

See also the long generic process in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
This file is the gate that decides whether a launch is honest.
