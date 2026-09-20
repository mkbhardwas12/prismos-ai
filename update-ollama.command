#!/bin/zsh
# One-shot Ollama updater — double-click to run.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
echo "─────────────────────────────────────────────"
echo " Updating Ollama (current: $(ollama --version 2>/dev/null || echo unknown))"
echo "─────────────────────────────────────────────"
if command -v brew >/dev/null 2>&1 && brew list ollama >/dev/null 2>&1; then
  echo "→ Homebrew install detected. Upgrading..."
  brew upgrade ollama || brew reinstall ollama
  echo "→ Restarting the daemon..."
  brew services restart ollama 2>/dev/null || {
    pkill -x ollama 2>/dev/null; pkill -f "ollama serve" 2>/dev/null
    sleep 1
    nohup ollama serve >/tmp/ollama-serve.log 2>&1 & disown
  }
else
  OLLA=$(command -v ollama || echo "not found")
  echo "Ollama binary: $OLLA (not a Homebrew package)."
  echo "→ Standalone install: please grab the latest from https://ollama.com/download"
  echo "  (or: brew install ollama)"
  exit 1
fi
sleep 3
echo "─────────────────────────────────────────────"
echo " Done. New version: $(ollama --version 2>/dev/null)"
curl -s http://localhost:11434/api/version && echo
echo " You can close this window."
echo "─────────────────────────────────────────────"
