#!/usr/bin/env python3
"""Render a Brain Wrapped preview loop (7 slides) as a series of PNGs that
match the colors and layout of src/components/BrainWrapped.{tsx,css}. Then
ffmpeg stitches them into a 14-second GIF and MP4.

This is an illustrated preview made only from synthetic public sample data. The
live React component uses the owner's local profile and may render differently.
"""
from __future__ import annotations
import math
import os
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "media" / "_brain_wrapped"
OUT_DIR.mkdir(parents=True, exist_ok=True)
FINAL_DIR = ROOT / "docs" / "media"

W, H = 1080, 1350  # 4:5 portrait (Instagram / Twitter feed friendly)

BG_TOP    = (10, 4, 32)
BG_BOTTOM = (0, 0, 0)
TEXT      = (245, 240, 255)
TEXT_DIM  = (245, 240, 255, 180)
TEXT_MUTE = (158, 152, 200)
TAG       = (196, 181, 253)
PALETTE = [(139, 92, 246), (236, 72, 153), (245, 158, 11),
           (16, 185, 129), (59, 130, 246), (139, 92, 246)]

FONT_REG  = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)

def gradient_bg() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_BOTTOM)
    px = img.load()
    cx, cy = W // 2, H // 2
    max_r = math.hypot(cx, cy)
    for y in range(H):
        for x in range(W):
            r = math.hypot(x - cx, y - cy) / max_r
            t = min(1.0, r * 1.3)
            px[x, y] = (
                int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t),
                int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t),
                int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t),
            )
    return img

def base(tag: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = gradient_bg()
    d = ImageDraw.Draw(img, "RGBA")
    # progress dots
    n = 7
    gap = 14
    dot_w = 60
    total = n * dot_w + (n - 1) * gap
    x0 = (W - total) // 2
    y0 = 40
    idx = int(tag.split("·")[0].strip().split(" ")[-1]) - 1 if "SLIDE" in tag else 0
    for i in range(n):
        fill = (255, 255, 255, 240) if i == idx else \
               (255, 255, 255, 100) if i < idx else (255, 255, 255, 38)
        d.rounded_rectangle([x0 + i*(dot_w+gap), y0,
                             x0 + i*(dot_w+gap) + dot_w, y0 + 6],
                            radius=3, fill=fill)
    # tag chip
    f = font(14, bold=True)
    bb = d.textbbox((0, 0), tag, font=f)
    tw = bb[2] - bb[0]
    cx = (W - tw) // 2
    d.text((cx, 80), tag, font=f, fill=TAG)
    # watermark
    fw = font(18, bold=True)
    d.text((50, H - 60), "PrismOS-AI", font=fw, fill=TEXT)
    fwm = font(14)
    d.text((W - 330, H - 56), "SYNTHETIC PUBLIC PREVIEW",
           font=fwm, fill=TEXT_MUTE)
    return img, d

def center_text(d, text, y, size, bold=False, fill=TEXT):
    f = font(size, bold=bold)
    bb = d.textbbox((0, 0), text, font=f)
    tw = bb[2] - bb[0]
    d.text(((W - tw) // 2, y), text, font=f, fill=fill)

def slide_1_fingerprint():
    img, d = base("SLIDE 1 · SYNTHETIC PROFILE SIGNATURE")
    center_text(d, "An illustrated preference signature.", 200, 58, bold=True)
    center_text(d, "Derived from synthetic interaction-profile signals.",
                310, 24, fill=TEXT_MUTE)
    center_text(d, "Deterministic visualization — not a unique identity.",
                345, 24, fill=TEXT_MUTE)
    # fingerprint polygon
    cx, cy = W // 2, 760
    r = 240
    pts = []
    for i in range(7):
        a = (i / 7) * 2 * math.pi - math.pi / 2
        rr = r * (0.65 + 0.35 * ((i * 73) % 11) / 11)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    # outer glow rings
    for rr, alpha in [(r + 30, 18), (r + 60, 10)]:
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  outline=(139, 92, 246, alpha), width=1)
    # filled polygon with gradient effect (multi-layer)
    for k, alpha in enumerate([60, 90, 130]):
        scale = 1 - k * 0.08
        scaled = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in pts]
        d.polygon(scaled, fill=PALETTE[k % len(PALETTE)] + (alpha,))
    d.polygon(pts, outline=(236, 72, 153, 220), width=3)
    # vertex dots
    for (x, y), c in zip(pts, PALETTE * 2):
        d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=c + (255,))
    # hash
    f = font(16)
    d.text((cx - 230, 1180), "PROFILE SIGNATURE",
           font=font(14, bold=True), fill=TEXT_MUTE)
    d.text((cx - 230, 1205), "f9-3a-7c-be-21-5d-04-91-cc-7e",
           font=font(20, bold=True), fill=TEXT)
    img.save(OUT_DIR / "slide_1.png")

def slide_2_archetype():
    img, d = base("SLIDE 2 · SYNTHETIC ARCHETYPE")
    center_text(d, "Example archetype mapped from synthetic profile signals:",
                240, 26, fill=TEXT_MUTE)
    center_text(d, "The Cartographer", 360, 110, bold=True,
                fill=PALETTE[1])
    center_text(d, "You map ideas before you commit to one.",
                510, 28, fill=TEXT_DIM[:3])
    # rosette
    cx, cy = W // 2, 880
    r0, r1 = 110, 240
    for i, c in enumerate(PALETTE):
        a0 = (i / len(PALETTE)) * 360 - 90
        a1 = ((i + 1) / len(PALETTE)) * 360 - 90
        # approximate pie slice
        d.pieslice([cx - r1, cy - r1, cx + r1, cy + r1],
                   a0, a1, fill=c + (200,))
    d.ellipse([cx - r0, cy - r0, cx + r0, cy + r0], fill=(10, 4, 32, 255))
    img.save(OUT_DIR / "slide_2.png")

def slide_3_axes():
    img, d = base("SLIDE 3 · SYNTHETIC PREFERENCE AXES")
    center_text(d, "Illustrated preference axes.", 200, 60, bold=True)
    axes = [
        ("CURIOSITY",   0.84, PALETTE[0]),
        ("RIGOR",       0.71, PALETTE[1]),
        ("BREVITY",     0.42, PALETTE[2]),
        ("EMPATHY",     0.66, PALETTE[3]),
        ("PLAYFULNESS", 0.58, PALETTE[4]),
    ]
    y = 380
    for label, val, color in axes:
        d.text((140, y), label, font=font(22, bold=True), fill=TEXT)
        bar_x, bar_y = 140, y + 38
        bar_w, bar_h = W - 280, 22
        d.rounded_rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h],
                            radius=11, fill=(255, 255, 255, 18))
        d.rounded_rectangle([bar_x, bar_y, bar_x + int(bar_w * val), bar_y + bar_h],
                            radius=11, fill=color + (240,))
        d.text((bar_x + bar_w + 14, y + 32),
               f"{int(val*100)}", font=font(20, bold=True), fill=TEXT)
        y += 110
    img.save(OUT_DIR / "slide_3.png")

def slide_4_evolution():
    img, d = base("SLIDE 4 · SYNTHETIC PROFILE TREND")
    center_text(d, "Synthetic preference trend by month.", 200, 48, bold=True)
    center_text(d, "Curiosity climbed. Rigor steadied.",
                300, 24, fill=TEXT_MUTE)
    # multi-line chart
    pad = 120
    cw, ch = W - pad * 2, 600
    cx0, cy0 = pad, 420
    # grid
    for i in range(5):
        yy = cy0 + (ch * i) // 4
        d.line([cx0, yy, cx0 + cw, yy], fill=(255, 255, 255, 22), width=1)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    series = [
        [0.40, 0.45, 0.48, 0.52, 0.55, 0.60, 0.62, 0.68, 0.72, 0.78, 0.81, 0.84],
        [0.60, 0.62, 0.63, 0.66, 0.65, 0.68, 0.69, 0.70, 0.71, 0.70, 0.71, 0.71],
        [0.30, 0.32, 0.35, 0.38, 0.40, 0.42, 0.40, 0.41, 0.43, 0.44, 0.43, 0.42],
    ]
    colors = [PALETTE[0], PALETTE[1], PALETTE[2]]
    for vals, c in zip(series, colors):
        pts = [(cx0 + i * cw // (len(vals) - 1), cy0 + ch - int(v * ch))
               for i, v in enumerate(vals)]
        for a, b in zip(pts, pts[1:]):
            d.line([a, b], fill=c + (240,), width=4)
        for p in pts:
            d.ellipse([p[0]-5, p[1]-5, p[0]+5, p[1]+5], fill=c + (255,))
    for i, m in enumerate(months):
        d.text((cx0 + i * cw // 11 - 10, cy0 + ch + 14),
               m, font=font(14), fill=TEXT_MUTE)
    # legend
    lg = [("Curiosity", PALETTE[0]),
          ("Rigor",     PALETTE[1]),
          ("Brevity",   PALETTE[2])]
    x = pad
    for label, c in lg:
        d.rectangle([x, 1120, x + 18, 1138], fill=c)
        d.text((x + 26, 1118), label, font=font(18, bold=True), fill=TEXT)
        x += 200
    img.save(OUT_DIR / "slide_4.png")

def slide_5_currents():
    img, d = base("SLIDE 5 · RECURRING GRAPH PATTERNS")
    center_text(d, "Patterns that keep coming back.", 200, 52, bold=True)
    currents = [
        ("Tuesday morning ⟶ deep reading",    78, PALETTE[0]),
        ("After dinner ⟶ creative tangents",  64, PALETTE[1]),
        ("Sunday ⟶ system rebuilds",          51, PALETTE[3]),
        ("Late night ⟶ architecture",         43, PALETTE[4]),
    ]
    y = 380
    for label, strength, color in currents:
        d.rounded_rectangle([100, y, W - 100, y + 110],
                            radius=18, fill=(255, 255, 255, 14))
        d.rounded_rectangle([100, y, 100 + (W - 200) * strength // 100, y + 110],
                            radius=18, fill=color + (60,))
        d.text((130, y + 30), label, font=font(24, bold=True), fill=TEXT)
        d.text((130, y + 70), f"strength {strength}",
               font=font(16), fill=TEXT_MUTE)
        y += 140
    img.save(OUT_DIR / "slide_5.png")

def slide_6_prophecies():
    img, d = base("SLIDE 6 · SYNTHETIC CANDIDATE LINKS")
    center_text(d, "Candidate graph links from a heuristic.",
                200, 44, bold=True)
    center_text(d, "Illustrated from synthetic graph signals.",
                280, 22, fill=TEXT_MUTE)
    edges = [
        ("contract clauses", "negotiation tactics", 0.91),
        ("rust ownership",   "tauri IPC bugs",      0.84),
        ("morning notes",    "weekly review",       0.79),
        ("calendar gaps",    "focus time",          0.72),
    ]
    y = 420
    for a, b, score in edges:
        d.text((140, y), a, font=font(22, bold=True), fill=PALETTE[0])
        d.text((W - 480, y), b, font=font(22, bold=True), fill=PALETTE[1])
        d.line([(140 + 280, y + 14), (W - 480 - 20, y + 14)],
               fill=(255, 255, 255, 110), width=2)
        d.text((W - 220, y),
               f"{int(score*100)}% score",
               font=font(18, bold=True), fill=TEXT_MUTE)
        y += 110
    img.save(OUT_DIR / "slide_6.png")

def slide_7_stats():
    img, d = base("SLIDE 7 · SYNTHETIC PROFILE BY NUMBERS")
    center_text(d, "1,247", 280, 200, bold=True, fill=PALETTE[0])
    center_text(d, "conversations", 510, 28, fill=TEXT_MUTE)

    center_text(d, "4,892", 640, 140, bold=True, fill=PALETTE[1])
    center_text(d, "nodes in your graph", 820, 26, fill=TEXT_MUTE)

    center_text(d, "LOCAL-FIRST", 930, 88, bold=True, fill=PALETTE[3])
    center_text(d, "fixed-loopback inference · optional egress disclosed",
                1055, 24, fill=TEXT_MUTE)

    center_text(d, "export intentionally · sharing creates egress",
                1200, 18, bold=True, fill=TEXT)
    img.save(OUT_DIR / "slide_7.png")

if __name__ == "__main__":
    slide_1_fingerprint()
    slide_2_archetype()
    slide_3_axes()
    slide_4_evolution()
    slide_5_currents()
    slide_6_prophecies()
    slide_7_stats()

    # Build GIF (silent) — 2.5s per slide, fade transitions
    slides = sorted(OUT_DIR.glob("slide_*.png"))
    tmp_list = OUT_DIR / "list.txt"
    with tmp_list.open("w") as f:
        for s in slides:
            f.write(f"file '{s}'\nduration 2.5\n")
        f.write(f"file '{slides[-1]}'\n")

    mp4 = FINAL_DIR / "brain-wrapped-loop.mp4"
    gif = FINAL_DIR / "brain-wrapped-loop.gif"

    # MP4 (h264, 1080x1350)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(tmp_list),
        "-vf", "scale=1080:1350,fps=24",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(mp4)
    ], check=True)

    # GIF (smaller — 540x675, 8fps)
    palette = OUT_DIR / "palette.png"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
        "-vf", "fps=8,scale=540:-1:flags=lanczos,palettegen=max_colors=96",
        str(palette)
    ], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(mp4), "-i", str(palette),
        "-lavfi", "fps=8,scale=540:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
        str(gif)
    ], check=True)

    print(f"✓ wrote {mp4}")
    print(f"✓ wrote {gif}")
    for p in (mp4, gif):
        print(f"  {p.name}: {p.stat().st_size // 1024} KB")
