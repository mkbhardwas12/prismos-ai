# Demo media — privacy-safe generation and optional live recording

The tracked `docs/media/prismos-demo.*` files are generated from illustrated
previews containing synthetic public documentation data. Regenerate them with:

```bash
bash scripts/build-demo.sh
```

Do not replace them with a capture of an owner's normal profile. The optional
live-recording guide below is only for a disposable test account/profile filled
with reviewed synthetic public fixtures.

## Why this matters

Every visitor decides whether to keep reading the README in the first 3 seconds. A static screenshot loses that decision. An animated GIF that shows PrismOS-AI using its fixed-loopback core on a useful task makes the behavior concrete.

## Specs

| | |
|---|---|
| Length | 25–30 seconds |
| Resolution | 1280×800 (Retina source, then downscaled) |
| Frame rate | 16–20 fps |
| File size | < 4 MB (GitHub README cap is 10 MB but smaller loads faster) |
| Format | `.gif` for README; keep a 1080p `.mp4` master in `docs/media/` |
| Loop | yes |
| Audio | none — README GIFs are silent |

## Shot list (each beat is on screen for ~3s)

1. **0:00–0:03 — App launch.** Click the dock icon. PrismOS opens into the empty Intent Console.
2. **0:03–0:08 — Drop a real file.** Drag a non-sensitive DOCX, PPTX, or allowlisted UTF-8 text/code file (including CSV/TSV) onto the input. The file pill appears. Convert PDFs to UTF-8 text first. XLSX and legacy `.xls` fail closed before parsing; export spreadsheets as CSV/TSV.
3. **0:08–0:13 — Ask the question.** Type: *"What changed compared to last week's draft?"* Hit return.
4. **0:13–0:20 — Watch the bounded workflow.** Camera stays on the workflow-role indicators and the sequential plan → build → judge → refine progress. Do not describe them as independent or parallel agents.
5. **0:20–0:24 — Show ephemeral handling.** Open the Spectrum Graph and confirm the one-off attachment did not create a persistent document-chunk node.
6. **0:24–0:28 — Brain Wrapped.** Open Brain Wrapped from the sidebar. Land on the Profile Signature slide.
7. **0:28–0:30 — Final card.** A title card overlay: **"Local-first core. Fixed-loopback inference. Optional egress disclosed."** + the project URL.

Keep the cursor visible. Slow, deliberate movements — fast pointer is unreadable in a GIF.

## Pre-flight (so the recording isn't full of jank)

- Use a separate OS test account or another disposable app profile. Never move,
  delete, or record the owner's live database for demo preparation.
- Populate the disposable profile only with reviewed synthetic public fixtures.
- Set the theme to dark (more contrast in GIFs).
- Resize the window to exactly 1280×800. On macOS: `osascript -e 'tell application "System Events" to tell process "PrismOS-AI" to set size of front window to {1280, 800}'`
- Quit Slack, Notion, Discord — anything that pops notifications or reveals an account.
- Use a clean desktop wallpaper (solid color).
- Make sure the selected local model is already installed so recording does not
  trigger a download. Loopback transport does not attest the model/runtime.

## Recording — macOS

### Option A: QuickTime (zero install)

```bash
# 1. Open QuickTime → File → New Screen Recording → select the PrismOS window only.
# 2. Save as ~/Movies/prismos-demo-raw.mov.
```

### Option B: `screencapture` (scriptable, recommended)

```bash
# Records the full screen for 30s at 30fps to ~/Movies/prismos-demo-raw.mov.
# Tip: use a window-coordinate-aware tool like `Kap` if you only want the app window.
screencapture -v -V 30 -k -T 0 ~/Movies/prismos-demo-raw.mov
```

### Option C: `Kap` (best signal-to-noise)

Free + open source: <https://getkap.co>. Records a selected window, exports straight to GIF, has built-in mouse-cursor highlighting.

## Recording — Linux

```bash
# Requires: ffmpeg, slop (for window selection)
geometry=$(slop -f "%wx%h+%x+%y")
ffmpeg -y -video_size "${geometry%+*+*}" -framerate 30 \
       -f x11grab -i :0.0+"${geometry#*+}" -t 30 \
       ~/prismos-demo-raw.mp4
```

## Recording — Windows

Use Xbox Game Bar (`Win+G` → Capture). Saves to `Videos\Captures\` as `.mp4`.

## Encode `.mov` / `.mp4` → optimized `.gif`

This is the part most people get wrong. Naïvely converting produces a 30+ MB GIF. Two-pass palette generation gets you under 4 MB.

```bash
INPUT=~/Movies/prismos-demo-raw.mov
OUT=docs/media/prismos-demo.gif

# 1. Generate an adaptive 128-color palette tuned to the video's actual colors.
ffmpeg -y -i "$INPUT" -vf "fps=18,scale=900:-1:flags=lanczos,palettegen=max_colors=128" /tmp/palette.png

# 2. Encode using that palette + Bayer dithering (sharper than the default).
ffmpeg -y -i "$INPUT" -i /tmp/palette.png \
       -filter_complex "fps=18,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
       "$OUT"

# 3. Verify it's under the 4 MB target.
ls -lh "$OUT"
```

If it's still over budget: drop fps to 15, drop width to 800, or trim a second off the end.

## Title card overlay (optional, for the final 2 seconds)

If you want the local-first boundary bumper:

```bash
ffmpeg -i raw.mov \
  -vf "drawtext=text='Local-first core. Fixed-loopback inference.':\
fontfile=/System/Library/Fonts/Helvetica.ttc:\
fontsize=44:fontcolor=white:x=(w-text_w)/2:y=h-100:\
enable='between(t,28,30)'" \
  with-overlay.mov
```

## Drop into the README

The README has a clearly marked `<!-- HERO GIF -->` slot in the opener. Replace the static screenshot block with:

```markdown
<p align="center">
  <img src="docs/media/prismos-demo.gif" width="720" alt="PrismOS-AI — 30-second demo" />
</p>
```

Commit the `.gif` to `docs/media/` (not `.mov` — keep the master out of git or use git-lfs).

## Master files

Keep these checked in to `docs/media/` (or git-lfs if your repo turns it on):

```
docs/media/
├── prismos-demo-1080p.mp4    # high-quality master, for Twitter/X
├── prismos-demo-720p.mp4     # for embeds
└── prismos-demo-thumb.png    # static fallback (poster frame)
```

Twitter/X autoplays MP4s and gets sharper compression than GIFs — use the 1080p master there, not the GIF.
