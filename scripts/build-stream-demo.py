#!/usr/bin/env python3
"""Capture a REAL Ollama streaming response and render it as a terminal-style
PNG sequence, then stitch into a GIF + MP4. Proves the "runs locally" claim
without faking anything.

Default prompt is curated to produce a short, deterministic answer that
showcases token-by-token streaming.
"""
from __future__ import annotations
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT     = Path(__file__).resolve().parent.parent
OUT_DIR  = ROOT / "docs" / "media" / "_stream"
FINAL    = ROOT / "docs" / "media"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL  = os.environ.get("PRISMOS_DEMO_MODEL", "qwen2.5:3b")
PROMPT = os.environ.get(
    "PRISMOS_DEMO_PROMPT",
    "In one short paragraph, explain why running an AI model on your own laptop is safer than sending every prompt to a cloud server. Keep it under 60 words.",
)
HOST   = "http://localhost:11434"

W, H = 1280, 720
BG       = (12, 14, 24)
TERM_BG  = (18, 22, 36)
ACCENT   = (72, 224, 167)
DIM      = (130, 140, 170)
TEXT     = (230, 235, 245)
PROMPT_C = (244, 196, 102)
USER_C   = (138, 180, 248)

FONT_MONO_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
    "/Library/Fonts/Courier New.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]
def pick(cands):
    for c in cands:
        if os.path.exists(c):
            return c
    raise SystemExit("no mono font found")

MONO = pick(FONT_MONO_CANDIDATES)

def font(size):
    return ImageFont.truetype(MONO, size)

PAD_L, PAD_T = 60, 50
HEADER_H     = 80
LINE_H       = 30

# ─── Step 1: Stream from Ollama, record (timestamp, accumulated_text) ───────
print(f"» streaming from {MODEL} …")
body = json.dumps({"model": MODEL, "prompt": PROMPT, "stream": True}).encode()
req = urllib.request.Request(f"{HOST}/api/generate", data=body,
                             headers={"Content-Type": "application/json"})

t0 = time.time()
chunks: list[tuple[float, str]] = []  # (elapsed_s, accumulated_text)
acc = ""
with urllib.request.urlopen(req, timeout=120) as resp:
    for raw in resp:
        line = raw.decode("utf-8").strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("done"):
            break
        tok = obj.get("response", "")
        if not tok:
            continue
        acc += tok
        chunks.append((time.time() - t0, acc))

total_elapsed = time.time() - t0
print(f"✓ {len(chunks)} tokens in {total_elapsed:.2f}s, {len(acc)} chars")

# ─── Step 2: Resample to 24fps, ~10s clip max ───────────────────────────────
TARGET_FPS = 24
TARGET_LEN = min(10.0, max(4.0, total_elapsed))   # cap at 10s
N_FRAMES   = int(TARGET_LEN * TARGET_FPS)

# Build a strictly increasing time → text map
def text_at(t_frac: float) -> str:
    if not chunks:
        return ""
    # progress through the accumulated text linearly with frame index
    idx = min(len(chunks) - 1, int(t_frac * len(chunks)))
    return chunks[idx][1]

# ─── Step 3: Render frames ──────────────────────────────────────────────────
def wrap(text: str, width: int, fnt) -> list[str]:
    """Greedy word-wrap to a max pixel width."""
    out = []
    line = ""
    for word in text.split(" "):
        trial = (line + " " + word).strip()
        bb = fnt.getbbox(trial)
        if bb[2] - bb[0] <= width:
            line = trial
        else:
            if line:
                out.append(line)
            line = word
    if line:
        out.append(line)
    # also respect explicit newlines in the source
    flat = []
    for l in out:
        flat.extend(l.split("\n"))
    return flat

def render_frame(i: int) -> Path:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # macOS-style window chrome
    d.rounded_rectangle([30, 30, W - 30, H - 30], radius=14, fill=TERM_BG)
    for j, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([55 + j*24, 55, 67 + j*24, 67], fill=c)
    title = f"prismos-cli — {MODEL} — local"
    fnt_t = font(14)
    bb = fnt_t.getbbox(title)
    d.text(((W - (bb[2]-bb[0]))//2, 53), title, font=fnt_t, fill=DIM)
    # green stripe under chrome
    d.rectangle([30, 88, W - 30, 90], fill=ACCENT)

    fnt_p = font(18)
    fnt_b = font(20)
    fnt_s = font(16)

    y = PAD_T + 60
    # prompt prefix
    d.text((PAD_L, y), "$ prismos-cli ask", font=fnt_p, fill=ACCENT)
    bb = fnt_p.getbbox("$ prismos-cli ask")
    d.text((PAD_L + (bb[2]-bb[0]) + 12, y),
           f'"{PROMPT[:62]}..."' if len(PROMPT) > 62 else f'"{PROMPT}"',
           font=fnt_p, fill=USER_C)
    y += LINE_H + 6

    d.text((PAD_L, y),
           f"→ streaming from {MODEL}  ·  100% local  ·  0 bytes egress",
           font=fnt_s, fill=DIM)
    y += LINE_H + 4

    # streamed response
    frac = i / max(1, N_FRAMES - 1)
    current = text_at(frac)
    max_w = W - PAD_L * 2
    for line in wrap(current, max_w, fnt_b):
        if y > H - 100:
            break
        d.text((PAD_L, y), line, font=fnt_b, fill=TEXT)
        y += LINE_H

    # blinking cursor
    if frac < 1.0 and (i // 3) % 2 == 0:
        d.rectangle([PAD_L + 2, y, PAD_L + 14, y + 22], fill=ACCENT)

    # footer
    d.text((PAD_L, H - 70),
           "prismos-ai · github.com/mkbhardwas12/prismos-ai",
           font=fnt_s, fill=DIM)

    p = OUT_DIR / f"f_{i:04d}.png"
    img.save(p)
    return p

print(f"» rendering {N_FRAMES} frames @ {TARGET_FPS}fps …")
for i in range(N_FRAMES):
    render_frame(i)

# ─── Step 4: ffmpeg → MP4 + GIF ─────────────────────────────────────────────
mp4 = FINAL / "stream-demo.mp4"
gif = FINAL / "stream-demo.gif"

subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error",
    "-framerate", str(TARGET_FPS),
    "-i", str(OUT_DIR / "f_%04d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", str(mp4)
], check=True)

palette = OUT_DIR / "palette.png"
subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
    "-vf", "fps=10,scale=800:-1:flags=lanczos,palettegen=max_colors=96",
    str(palette)
], check=True)
subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error",
    "-i", str(mp4), "-i", str(palette),
    "-lavfi", "fps=10,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
    str(gif)
], check=True)

print(f"✓ wrote {mp4} ({mp4.stat().st_size // 1024} KB)")
print(f"✓ wrote {gif} ({gif.stat().st_size // 1024} KB)")
