# v0.6 launch gate

Verified 2026-08-12 against GitHub Releases + `scripts/install.sh`.
Do not mark v0.6 "latest" until every **blocker** is checked.
Do not launch Show HN / r/LocalLLaMA until the installers exist.

Source of the ranking: the 2026-08-12 deep-research report
(install friction converts; stars, coined metaphors, and "patent pending" do not).

## What is actually published today

`/releases/latest` resolves to **v0.5.1** (published after v0.5.2, so GitHub
treats 0.5.1 as latest). Lifetime binary downloads across both tags: **43**.

| Asset on latest | `install.sh` glob | Status |
|---|---|---|
| `PrismOS-AI_0.5.1_aarch64.dmg` | `*aarch64.dmg` | ships |
| `PrismOS-AI_0.5.1_x64-setup.exe` | Windows `.ps1` path | ships |
| `PrismOS-AI_0.5.1_x64_en-US.msi` | Windows `.ps1` path | ships |
| `PrismOS-AI_aarch64.app.tar.gz` | (updater, not the one-liner) | ships |
| — | `*x64.dmg` (Intel Mac) | **missing — one-liner dies** |
| — | `*amd64.AppImage` (Linux x64) | **missing — one-liner dies** |
| — | `*arm64.AppImage` (Linux ARM) | **missing — one-liner dies** |
| — | `.deb` (README claims this) | **missing** |

CI (`release.yml`) already has matrix rows for `macos-13` (Intel) and
`ubuntu-22.04` (Linux). The builds are not landing as latest-release assets.

## Version files must all say the same thing before the tag

Measured 2026-08-12:

| File | Current |
|---|---|
| `package.json` | 0.5.1 |
| `src-tauri/tauri.conf.json` | 0.5.2 |
| `src-tauri/Cargo.toml` | 0.5.2 |
| README version badge | 0.6.0 |
| `CHANGELOG.md` | `[0.6.0] — 2026-04-18` |
| GitHub latest tag | v0.5.1 |

- [ ] Bump all four version files to **0.6.0** in one commit
- [ ] CHANGELOG 0.6.0 date is the ship day, not 2026-04-18
- [ ] README badge, platform badge, and download table match the assets that
      will actually be attached to the tag

## Blockers (v0.6 is not latest until these pass)

- [ ] Apple Silicon `.dmg` attached (`*aarch64.dmg`)
- [ ] Intel Mac `.dmg` attached (`*x64.dmg`) — `install.sh` requires this
- [ ] Windows `.msi` and `.exe`
- [ ] Linux x64 AppImage attached (`*amd64.AppImage`) — `install.sh` requires this
- [ ] Linux ARM AppImage attached (`*arm64.AppImage`) **or** `install.sh` updated
      to refuse ARM Linux with a clear message instead of a glob miss
- [ ] Linux `.deb` **or** README/release notes stop claiming `.deb`
- [ ] On a clean Apple Silicon Mac: `curl …/install.sh | sh` opens the app
- [ ] On a clean Windows box: `.msi` installs without admin, Ollama bootstrap works
- [ ] On a clean Ubuntu box: AppImage is executable and talks to local Ollama
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` green (176 tests as of 2026-08-12)
- [ ] `cd src-tauri && cargo test` green
- [ ] GitHub repo homepage is a working URL, not `#-what-is-prismos`
- [ ] Demo section links `docs/media/prismos-demo.mp4` (or a real YouTube),
      never `https://youtube.com`
- [ ] First README screen does not say "patent pending", "AI operating system",
      or claim Linux/Intel if those assets are absent

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

## Commands

```bash
# PRE / POST gates
npx tsc --noEmit
npx vitest run
cd src-tauri && cargo test

# What GitHub will actually serve to install.sh
gh release view --json tagName,publishedAt,assets \
  --jq '{tag:.tagName, published:.publishedAt, assets:[.assets[].name]}'

# After tagging v0.6.0, confirm every install.sh glob hits
# *aarch64.dmg  *x64.dmg  *amd64.AppImage  *arm64.AppImage
```

See also the long generic process in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
This file is the gate that decides whether a launch is honest.
