#!/usr/bin/env python3
"""Render privacy-safe illustrated PrismOS release previews.

These are intentionally synthetic UI illustrations, not captures of an owner's
live profile. Keeping the generator in-tree makes the public media reproducible
without copying conversations, project paths, or graph history into Git.
"""

from __future__ import annotations

import os
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screenshots"
W, H = 1280, 720
SIDEBAR = 248

BG = "#090d14"
PANEL = "#111824"
PANEL_2 = "#151f2e"
BORDER = "#243247"
TEXT = "#edf4ff"
MUTED = "#91a3ba"
BLUE = "#55b8ff"
GREEN = "#55d6a1"
AMBER = "#f4c76b"
PURPLE = "#a78bfa"
RED = "#ff8a8a"

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def pick(candidates: list[str]) -> str:
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    raise SystemExit("no usable font found")


FONT = pick(FONT_CANDIDATES)
FONT_BOLD = pick(FONT_BOLD_CANDIDATES)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str = BORDER, radius: int = 12) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, size: int = 16, color: str = TEXT, bold: bool = False) -> None:
    draw.text(xy, value, font=font(size, bold), fill=color)


def wrapped(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, width: int, size: int = 15, color: str = MUTED, spacing: int = 7) -> int:
    lines = textwrap.wrap(value, width=max(12, width // max(7, size // 2)))
    draw.multiline_text(xy, "\n".join(lines), font=font(size), fill=color, spacing=spacing)
    return len(lines) * (size + spacing)


def sidebar(draw: ImageDraw.ImageDraw, active: str) -> None:
    draw.rectangle((0, 0, SIDEBAR, H), fill="#0d131d")
    draw.line((SIDEBAR, 0, SIDEBAR, H), fill=BORDER)
    draw.polygon([(26, 47), (34, 25), (42, 47)], outline=BLUE)
    draw.line((30, 39, 39, 39), fill=GREEN, width=2)
    label(draw, (54, 22), "PrismOS", 24, BLUE, True)
    rounded(draw, (168, 22, 224, 48), "#101d2c")
    label(draw, (179, 29), "v0.5.2", 11, MUTED)
    label(draw, (24, 76), "LOCAL-FIRST ASSISTANT", 11, MUTED, True)

    items = [
        ("Local Knowledge Chat", "chat"),
        ("Spectrum Graph", "graph"),
        ("Spectrum Explorer", "explorer"),
        ("Action Policies", "policy"),
        ("Reasoning Timeline", "timeline"),
        ("Settings", "settings"),
    ]
    y = 108
    for title, key in items:
        if key == active:
            rounded(draw, (12, y - 8, 236, y + 30), "#13243a", "#28517a", 9)
            draw.rectangle((12, y - 8, 15, y + 30), fill=BLUE)
        label(draw, (28, y), title, 15, TEXT if key == active else MUTED, key == active)
        y += 48

    rounded(draw, (16, 438, 232, 556), "#0f1d1c", "#244f49")
    label(draw, (30, 454), "Privacy boundary", 14, GREEN, True)
    wrapped(draw, (30, 480), "Inference uses loopback by default. The Ollama runtime and model identity are not attested.", 182, 12, MUTED, 5)

    label(draw, (18, 674), "ILLUSTRATED PREVIEW", 10, AMBER, True)
    label(draw, (18, 692), "SYNTHETIC PUBLIC DATA ONLY", 10, MUTED)


def canvas(active: str, title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    sidebar(draw, active)
    label(draw, (280, 25), title, 24, TEXT, True)
    label(draw, (280, 58), subtitle, 13, MUTED)
    draw.line((248, 88, W, 88), fill=BORDER)
    return image, draw


def render_chat() -> Image.Image:
    image, draw = canvas("chat", "Local Knowledge Chat", "Approved sources + bounded sequential answer-quality loop")
    rounded(draw, (904, 22, 1250, 65), "#10241f", "#2a5b4e")
    label(draw, (925, 36), "●  Ollama loopback configured", 13, GREEN, True)

    rounded(draw, (304, 118, 1160, 188), PANEL_2)
    label(draw, (326, 134), "YOU", 11, BLUE, True)
    label(draw, (326, 158), "Using only the approved public docs, explain the private-data boundary.", 16, TEXT)

    rounded(draw, (304, 210, 1160, 454), PANEL)
    label(draw, (326, 228), "PRISMOS", 11, GREEN, True)
    wrapped(
        draw,
        (326, 258),
        "The source repository holds code and public documentation. Approved project excerpts, conversations, trend signals, and feedback remain in local app data. A full recovery copy is passphrase-encrypted and must stay outside this public worktree.",
        790,
        17,
        TEXT,
        9,
    )
    label(draw, (326, 365), "Sources", 12, MUTED, True)
    rounded(draw, (326, 388, 514, 424), "#13243a", "#28517a", 8)
    label(draw, (344, 399), "ARCHITECTURE.md", 12, BLUE, True)
    rounded(draw, (526, 388, 674, 424), "#13243a", "#28517a", 8)
    label(draw, (544, 399), "SECURITY.md", 12, BLUE, True)

    label(draw, (304, 482), "SEQUENTIAL WORKFLOW", 11, MUTED, True)
    stages = [("1  Plan", BLUE), ("2  Build", GREEN), ("3  Judge", AMBER), ("4  Refine if needed", PURPLE)]
    x = 304
    for stage, color in stages:
        width = 112 if "Refine" not in stage else 172
        rounded(draw, (x, 508, x + width, 548), PANEL_2, color, 9)
        label(draw, (x + 16, 520), stage, 13, color, True)
        x += width + 12
    label(draw, (304, 565), "Stages are awaited in order; this is not a parallel agent council.", 13, MUTED)

    rounded(draw, (304, 625, 1248, 690), "#0e1520")
    label(draw, (328, 648), "Ask about approved local knowledge…", 15, "#71839a")
    rounded(draw, (1176, 638, 1232, 678), "#173a54", "#285f83", 10)
    label(draw, (1196, 649), "→", 20, BLUE, True)
    return image


def render_graph() -> Image.Image:
    image, draw = canvas("graph", "Spectrum Graph", "Synthetic public documentation nodes — no owner history")
    rounded(draw, (1024, 24, 1248, 64), "#241f12", "#665522")
    label(draw, (1043, 36), "SYNTHETIC DEMO GRAPH", 12, AMBER, True)
    rounded(draw, (278, 112, 940, 680), PANEL)
    nodes = {
        "README": (520, 250, BLUE),
        "Architecture": (690, 185, GREEN),
        "Security": (720, 360, RED),
        "Project Knowledge": (500, 440, PURPLE),
        "Private Vault": (370, 330, AMBER),
    }
    edges = [("README", "Architecture"), ("Architecture", "Security"), ("Security", "Private Vault"), ("Architecture", "Project Knowledge"), ("Project Knowledge", "Private Vault")]
    for left, right in edges:
        draw.line((*nodes[left][:2], *nodes[right][:2]), fill="#42546c", width=3)
    for name, (x, y, color) in nodes.items():
        draw.ellipse((x - 27, y - 27, x + 27, y + 27), fill="#152536", outline=color, width=3)
        bbox = draw.textbbox((0, 0), name, font=font(13, True))
        label(draw, (x - (bbox[2] - bbox[0]) // 2, y + 38), name, 13, TEXT, True)

    rounded(draw, (966, 112, 1248, 680), PANEL)
    label(draw, (990, 136), "Selected source", 12, MUTED, True)
    label(draw, (990, 165), "Architecture", 20, GREEN, True)
    draw.line((990, 202, 1224, 202), fill=BORDER)
    label(draw, (990, 226), "Origin", 12, MUTED, True)
    wrapped(draw, (990, 248), "docs/ARCHITECTURE.md", 224, 14, TEXT)
    label(draw, (990, 300), "Ownership", 12, MUTED, True)
    wrapped(draw, (990, 322), "Approved source record. Refresh and Forget stay source-scoped.", 224, 14, TEXT, 7)
    label(draw, (990, 410), "Portable export", 12, MUTED, True)
    wrapped(draw, (990, 432), "Managed excerpts are omitted. Full recovery requires an encrypted Private Vault.", 224, 14, TEXT, 7)
    return image


def render_explorer() -> Image.Image:
    image, draw = canvas("explorer", "Spectrum Explorer", "Search bounded approved knowledge with source labels")
    rounded(draw, (280, 112, 1248, 164), PANEL_2)
    label(draw, (304, 129), "⌕  search approved public documentation", 15, MUTED)
    cards = [
        ("Architecture", "docs/ARCHITECTURE.md", "Runtime boundaries and sequential workflow"),
        ("Security", "SECURITY.md", "Threat model, audits, and residual risks"),
        ("Project Knowledge", "docs/PROJECT_KNOWLEDGE.md", "Preview, approval, refresh, and Forget"),
        ("Private Vault", "docs/PRIVATE_KNOWLEDGE_ARCHITECTURE.md", "Encrypted recovery and restore drill"),
    ]
    y = 188
    for idx, (title, source, summary) in enumerate(cards):
        selected = idx == 0
        rounded(draw, (280, y, 744, y + 102), "#142338" if selected else PANEL, BLUE if selected else BORDER)
        label(draw, (302, y + 16), title, 16, TEXT, True)
        label(draw, (302, y + 44), summary, 13, MUTED)
        label(draw, (302, y + 72), source, 11, BLUE)
        y += 116

    rounded(draw, (770, 188, 1248, 652), PANEL)
    label(draw, (796, 212), "Architecture", 22, TEXT, True)
    label(draw, (796, 248), "SOURCE-BOUND EXCERPT", 11, GREEN, True)
    wrapped(draw, (796, 286), "PrismOS retrieves a bounded set of approved text/code excerpts. Retrieved text is treated as evidence, never as higher-priority policy or executable instruction.", 408, 16, TEXT, 9)
    draw.line((796, 414, 1220, 414), fill=BORDER)
    label(draw, (796, 438), "Current limitations", 13, AMBER, True)
    wrapped(draw, (796, 468), "No web crawler. No Office/PDF parsing in Project Knowledge. Citations are source labels and are not independently verified.", 408, 15, MUTED, 8)
    rounded(draw, (796, 584, 940, 624), "#13243a", "#28517a", 9)
    label(draw, (824, 596), "Forget source", 13, BLUE, True)
    return image


def render_policy() -> Image.Image:
    image, draw = canvas("policy", "Action Policies", "Allow-lists and authenticated records — not an OS sandbox")
    rounded(draw, (280, 112, 1248, 212), "#2a2115", "#6e5425")
    label(draw, (306, 132), "Important boundary", 15, AMBER, True)
    wrapped(draw, (306, 160), "Policy records model an allowed action and its result. They do not provide process isolation, filesystem rollback, or permission for arbitrary shell commands.", 900, 15, TEXT, 7)

    rules = [
        ("1", "Describe the modeled action", "Input is bounded and recorded as data."),
        ("2", "Evaluate the allow-list", "Unknown action types fail closed."),
        ("3", "Create an authenticated record", "Integrity protects the record; it does not undo OS changes."),
    ]
    y = 244
    for number, title, detail in rules:
        rounded(draw, (280, y, 1248, y + 92), PANEL)
        draw.ellipse((304, y + 24, 346, y + 66), fill="#1d3650", outline=BLUE, width=2)
        label(draw, (319, y + 34), number, 15, BLUE, True)
        label(draw, (370, y + 20), title, 17, TEXT, True)
        label(draw, (370, y + 51), detail, 14, MUTED)
        y += 108

    rounded(draw, (280, 590, 1016, 666), "#0e1520")
    label(draw, (304, 607), "Modeled action", 11, MUTED, True)
    label(draw, (304, 632), "Summarize an approved document (preview only)", 15, TEXT)
    rounded(draw, (1032, 590, 1248, 666), "#16334b", "#2d668e")
    label(draw, (1075, 618), "Evaluate policy", 15, BLUE, True)
    return image


def render_timeline() -> Image.Image:
    image, draw = canvas("timeline", "Reasoning Timeline", "Bounded sequential stages with concise rationale — no hidden chain-of-thought")
    rounded(draw, (1004, 24, 1248, 64), "#1d1830", "#514078")
    label(draw, (1024, 36), "NOT PARALLEL AGENTS", 12, PURPLE, True)

    stages = [
        ("01", "Plan", "Identify the answer shape and evidence needs.", BLUE),
        ("02", "Build", "Generate one candidate using bounded retrieved context.", GREEN),
        ("03", "Judge", "Check grounding, completeness, and safety limits.", AMBER),
        ("04", "Refine", "Run once only when the judge requests a bounded revision.", PURPLE),
    ]
    draw.line((352, 158, 352, 594), fill="#31445e", width=4)
    y = 130
    for number, title, detail, color in stages:
        draw.ellipse((326, y, 378, y + 52), fill="#152536", outline=color, width=3)
        label(draw, (341, y + 17), number, 12, color, True)
        rounded(draw, (410, y - 6, 1190, y + 82), PANEL)
        label(draw, (436, y + 12), title, 19, color, True)
        label(draw, (436, y + 44), detail, 14, TEXT)
        y += 116

    rounded(draw, (280, 620, 1248, 682), "#101b28", "#29425f")
    label(draw, (304, 637), "Decision record:", 13, BLUE, True)
    label(draw, (430, 637), "concise rationale, assumptions, sources, and verification limits — never raw hidden reasoning", 13, MUTED)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    scenes = {
        "intent-console.png": render_chat(),
        "spectrum-graph.png": render_graph(),
        "Spectrum-Explorer.png": render_explorer(),
        "Sandbox-Prisms.png": render_policy(),
        "Spectral-Timeline.png": render_timeline(),
    }
    for name, image in scenes.items():
        image.save(OUT / name, optimize=True)
    print(f"wrote {len(scenes)} privacy-safe illustrated previews to {OUT}")


if __name__ == "__main__":
    main()
