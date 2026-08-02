#!/usr/bin/env python3
"""Render the overlay PNGs used by scripts/build-demo.sh."""
from __future__ import annotations
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "media" / "_overlays"
OUT.mkdir(parents=True, exist_ok=True)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
FONT_BOLD_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

def pick(cands):
    for c in cands:
        if os.path.exists(c):
            return c
    raise SystemExit("no usable font found")

FONT = pick(FONT_CANDIDATES)
FONT_BOLD = pick(FONT_BOLD_CANDIDATES)

def load(font_path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(font_path, size)

SCENES = [
    ("scene_01.png", "Local knowledge chat starts from your explicit prompt."),
    ("scene_02.png", "Chat uses loopback inference by default."),
    ("scene_03.png", "Approved knowledge and chats build your local graph."),
    ("scene_04.png", "Searchable on your device."),
    ("scene_05.png", "Modeled actions pass a bounded native policy gate."),
    ("scene_06.png", "See how your interaction profile changes over time."),
]

BAR_H = 92
BG = (10, 10, 20, 235)
STRIPE = (72, 224, 167, 220)
TEXT = (255, 255, 255, 255)
META = (122, 126, 154, 230)

def render_caption(filename: str, text: str) -> None:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # bottom bar
    draw.rectangle([(0, H - BAR_H), (W, H)], fill=BG)
    # green stripe at top of bar
    draw.rectangle([(0, H - BAR_H), (W, H - BAR_H + 3)], fill=STRIPE)
    # caption text
    f = load(FONT_BOLD, 34)
    draw.text((40, H - BAR_H + 24), text, font=f, fill=TEXT)
    # corner meta
    fm = load(FONT, 14)
    meta = "PrismOS-AI · local-first · explicit privacy boundaries"
    bbox = draw.textbbox((0, 0), meta, font=fm)
    tw = bbox[2] - bbox[0]
    draw.text((W - tw - 40, H - 30), meta, font=fm, fill=META)
    img.save(OUT / filename)

def render_title() -> None:
    img = Image.new("RGBA", (W, H), (10, 10, 20, 255))
    draw = ImageDraw.Draw(img)
    # main title
    f1 = load(FONT_BOLD, 68)
    title = "Local-first. Open. Yours."
    bb = draw.textbbox((0, 0), title, font=f1)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    draw.text(((W - tw) / 2, (H - th) / 2 - 80), title, font=f1, fill=TEXT)
    # subtitle (accent)
    f2 = load(FONT_BOLD, 30)
    sub = "Sequential model workflow  ·  Spectrum Graph  ·  local-first core"
    bb = draw.textbbox((0, 0), sub, font=f2)
    tw = bb[2] - bb[0]
    draw.text(((W - tw) / 2, (H / 2) + 10), sub, font=f2, fill=STRIPE)
    # url
    f3 = load(FONT, 22)
    url = "github.com/mkbhardwas12/prismos-ai"
    bb = draw.textbbox((0, 0), url, font=f3)
    tw = bb[2] - bb[0]
    draw.text(((W - tw) / 2, (H / 2) + 80), url, font=f3, fill=META)
    img.save(OUT / "scene_99_title.png")

for name, txt in SCENES:
    render_caption(name, txt)
render_title()
print(f"wrote {len(SCENES)+1} overlays to {OUT}")
