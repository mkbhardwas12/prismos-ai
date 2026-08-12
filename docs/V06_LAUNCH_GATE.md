# v0.6 launch gate

Re-verified 2026-08-12 after release run `31623587221`.
`/releases/latest` is **v0.6.0** (published, not draft).

Source of the ranking: the 2026-08-12 deep-research report
(install friction converts; stars, coined metaphors, and "patent pending" do not).

## What is actually published today

`/releases/latest` is **v0.6.0** (published 2026-08-12). `install.sh` resolves
all live globs against that tag.

| Asset | Matcher | v0.6.0 latest |
|---|---|---|
| Apple Silicon `.dmg` | `aarch64\.dmg` | `PrismOS-AI_0.6.0_aarch64.dmg` (valid UDIF; contains `PrismOS-AI.app`) |
| Intel Mac `.dmg` | `_x64\.dmg` | `PrismOS-AI_0.6.0_x64.dmg` |
| Windows `.exe` / `.msi` | `install.ps1` `*x64*.msi` | `PrismOS-AI_0.6.0_x64-setup.exe`, `_x64_en-US.msi` |
| Linux x64 AppImage | `(amd64\|x86_64)\.AppImage` | `PrismOS-AI_0.6.0_amd64.AppImage` (ELF x86-64) |
| Linux `.deb` | n/a (manual download) | `PrismOS-AI_0.6.0_amd64.deb` |
| Linux ARM AppImage | refused in `install.sh` | not published |

`install.ps1` now matches `*x64*.msi` (the published name is
`PrismOS-AI_0.6.0_x64_en-US.msi`). Windows ARM is refused. Both
installers check SHA-256 against the GitHub `digest` field.

Linux is built on **ubuntu-24.04**. ubuntu-22.04 fails: crates.io `libspa` 0.9.2
vs old PipeWire headers (`spa_video_info_raw.flags` missing). Android APK job
failed; not a desktop-launch blocker.

## Version files

| File | Current |
|---|---|
| `package.json` / lock | 0.6.0 |
| `src-tauri/tauri.conf.json` | 0.6.0 |
| `src-tauri/Cargo.toml` / lock | 0.6.0 |
| `CHANGELOG.md` | `[0.6.0] — 2026-08-12` |
| GitHub latest tag | v0.6.0 |

## Blockers

- [x] Apple Silicon `.dmg` attached and mountable
- [x] Intel Mac `.dmg` attached
- [x] Windows `.msi` and `.exe` attached
- [x] Linux x64 AppImage attached (`*amd64.AppImage`)
- [x] Linux ARM: `install.sh` refuses with a clear message
- [x] Linux `.deb` attached
- [x] Windows one-liner: `*x64*.msi` + SHA-256 digest check on `main`
- [ ] Full clean-machine GUI smoke (Ollama bootstrap + first ask) not run here
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` — 176 tests
- [x] `cd src-tauri && cargo test` — 370 tests (pre-tag)
- [x] GitHub homepage is the repo URL
- [x] Demo links `docs/media/prismos-demo.mp4`
- [x] Root `LAUNCH_POST.md` no longer ships the v0.5.1 “AI operating system” paste
- [x] README no longer advertises missing Voice / Audit screenshots

## After the binaries exist (not before)

- [ ] Show HN — use the rewritten copy in [`LAUNCH_POSTS.md`](LAUNCH_POSTS.md).
      Human posts this. Lead with installers and what runs with Wi-Fi off.
- [ ] r/LocalLLaMA — hardware notes + model tiers. Ask what broke.
- [x] GitHub Discussion: [v0.6.0 first-run reports](https://github.com/mkbhardwas12/prismos-ai/discussions/8)
- [x] Seeded issues #2–#7 (`help wanted` / `good first issue` / `bug`)

Downloads re-counted 2026-08-12 this loop: v0.6.0 = 4, lifetime published
binaries = **47** (was 43 before this tag).

## Do not do this month

- Buy or farm stars. HN treats that as fraud.
- Quote 236★ / 214 forks as traction. Honest figures: 47 lifetime installer
  downloads, 2 watchers, 1 contributor.
- Lead with Brain Wrapped. Treat it as a post-use recap, not the install wedge.
- Post the pre-rewrite `LAUNCH_POSTS.md` (agentic OS / 7D / Hermes). That
  file was rewritten; post only the new copy, and only as a human.
- Pretend Android shipped. The APK job is still red.

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
