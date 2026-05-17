#!/usr/bin/env python3
"""Find the PrismOS-AI window on macOS via Quartz (no Accessibility perms
required) and capture it with `screencapture -R x,y,w,h`.

Usage:
    python3 capture-window.py <output.png> [window_name_substring]
"""
from __future__ import annotations
import sys
import subprocess
from pathlib import Path

try:
    from Quartz import (
        CGWindowListCopyWindowInfo,
        kCGWindowListOptionOnScreenOnly,
        kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )
except ImportError:
    sys.exit("Quartz (PyObjC) not available — usually ships with macOS python3")


def find_window(name: str = "prismos"):
    needle = name.lower()
    opts = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements
    windows = CGWindowListCopyWindowInfo(opts, kCGNullWindowID)
    matches = []
    for w in windows:
        owner = (w.get("kCGWindowOwnerName") or "").lower()
        title = (w.get("kCGWindowName") or "").lower()
        if needle in owner or needle in title:
            b = w["kCGWindowBounds"]
            matches.append({
                "id": w["kCGWindowNumber"],
                "owner": w.get("kCGWindowOwnerName"),
                "title": w.get("kCGWindowName"),
                "x": int(b["X"]),
                "y": int(b["Y"]),
                "w": int(b["Width"]),
                "h": int(b["Height"]),
                "layer": w.get("kCGWindowLayer", 0),
            })
    # Prefer the largest window at layer 0 (normal app windows)
    matches.sort(key=lambda m: (m["layer"], -(m["w"] * m["h"])))
    return matches


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    out = Path(sys.argv[1]).expanduser().resolve()
    name = sys.argv[2] if len(sys.argv) >= 3 else "prismos"

    candidates = find_window(name)
    if not candidates:
        print(f"!! no window matching '{name}' found", file=sys.stderr)
        print("   currently visible windows:", file=sys.stderr)
        for w in find_window(""):
            print(f"     - {w['owner']!r} :: {w['title']!r}  "
                  f"({w['w']}x{w['h']} @ {w['x']},{w['y']})", file=sys.stderr)
        return 1

    target = candidates[0]
    print(f"» capturing {target['owner']!r} window "
          f"{target['w']}x{target['h']} at {target['x']},{target['y']}")

    out.parent.mkdir(parents=True, exist_ok=True)
    # screencapture -R uses x,y,w,h relative to the main display.
    cmd = [
        "screencapture", "-o", "-x", "-t", "png",
        "-l", str(target["id"]),   # capture by window ID — clean, no chrome from other windows
        str(out),
    ]
    rc = subprocess.call(cmd)
    if rc != 0 or not out.exists():
        # Fallback to region capture
        print("» -l capture failed, retrying with -R region capture", file=sys.stderr)
        cmd = [
            "screencapture", "-o", "-x", "-t", "png",
            "-R", f"{target['x']},{target['y']},{target['w']},{target['h']}",
            str(out),
        ]
        rc = subprocess.call(cmd)

    if rc == 0 and out.exists():
        print(f"✓ wrote {out} ({out.stat().st_size // 1024} KB)")
        return 0
    print(f"!! screencapture failed (rc={rc})", file=sys.stderr)
    return rc


if __name__ == "__main__":
    sys.exit(main())
