#!/usr/bin/env bash
# Capture live screenshots of the running PrismOS-AI Tauri window on macOS.
#
# Strategy:
#   1. Find the window ID owned by the "prismos" process via `osascript` + AppleScript.
#   2. Bring the window forward.
#   3. screencapture -l <windowID> for each scene.
#   4. Between scenes, AppleScript drives keystrokes / click events so the
#      user sees actual content (not just an empty Intent Console).
#
# Outputs land in docs/screenshots/live/.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/screenshots/live"
mkdir -p "$OUT"

APP_NAME="prismos"   # cargo binary name from tauri.conf.json -> mainBinaryName

# Find window ID for the app's frontmost window.
find_window_id() {
  osascript <<'OSA'
tell application "System Events"
  set theApp to first application process whose name contains "prismos"
  set theWin to first window of theApp
  set winID to value of attribute "AXWindowID" of theWin
  return winID as string
end tell
OSA
}

activate_app() {
  osascript -e 'tell application "System Events" to set frontmost of (first application process whose name contains "prismos") to true'
  sleep 0.6
}

shoot() {
  local name="$1"
  local wid
  wid=$(find_window_id)
  if [ -z "$wid" ]; then
    echo "!! could not find window id, falling back to interactive capture"
    screencapture -o -x "$OUT/$name"
  else
    screencapture -o -x -l "$wid" "$OUT/$name"
  fi
  echo "  → $OUT/$name"
}

type_text() {
  osascript -e "tell application \"System Events\" to keystroke \"$1\""
}

press_key() {
  osascript -e "tell application \"System Events\" to key code $1"
}

echo "» activating PrismOS-AI window"
activate_app

echo "» scene 1: initial Intent Console"
shoot "01-intent-empty.png"
sleep 1

echo "» scene 2: typing a query"
activate_app
# Click into the input area (Tab a few times or just type — input is usually autofocused)
type_text "Summarize the local-first manifesto in three bullet points"
sleep 0.6
shoot "02-intent-typed.png"

echo "» scene 3: submit and watch agents respond"
press_key 36   # Return
sleep 2
shoot "03-agents-thinking.png"
sleep 4
shoot "04-agents-streaming.png"
sleep 6
shoot "05-agents-done.png"

# Try navigating to other tabs via keyboard shortcut (Cmd+1..Cmd+5 if wired)
for i in 1 2 3 4 5 6; do
  echo "» scene: trying Cmd-$i"
  osascript -e "tell application \"System Events\" to keystroke \"$i\" using command down"
  sleep 1.2
  shoot "1${i}-tab-${i}.png"
done

echo "✓ done — $(ls "$OUT" | wc -l) frames captured"
ls -lh "$OUT"
