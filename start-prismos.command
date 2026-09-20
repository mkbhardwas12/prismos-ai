#!/bin/zsh
# PrismOS-AI dev launcher — double-click to start the app.
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$HOME/Documents/prismos-ai" || { echo "repo not found"; exit 1; }
echo "─────────────────────────────────────────────"
echo " Starting PrismOS-AI (npm run tauri dev)"
echo " First Rust compile can take several minutes."
echo "─────────────────────────────────────────────"
npm run tauri dev
