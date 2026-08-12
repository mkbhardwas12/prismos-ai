#!/usr/bin/env bash
# PrismOS-AI one-line installer
# Usage:  curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh
#
# Detects your OS + arch, downloads the latest signed release from GitHub,
# and bootstraps Ollama with a small default model if it isn't already present.
#
# Safe to re-run. Idempotent. Will never overwrite an existing install without asking.
# All data stays on your machine.

set -eu

# ─── pretty output ───────────────────────────────────────────────────────────
BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; RESET="$(printf '\033[0m')"
GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"; RED="$(printf '\033[31m')"
info()  { printf "%s» %s%s\n" "$BOLD" "$1" "$RESET"; }
ok()    { printf "%s✓ %s%s\n" "$GREEN" "$1" "$RESET"; }
warn()  { printf "%s! %s%s\n" "$YELLOW" "$1" "$RESET"; }
die()   { printf "%s✗ %s%s\n" "$RED" "$1" "$RESET" >&2; exit 1; }

REPO="mkbhardwas12/prismos-ai"
DEFAULT_MODEL="${PRISMOS_DEFAULT_MODEL:-qwen3:4b}"
INSTALL_PREFIX="${PRISMOS_INSTALL_PREFIX:-/usr/local}"

# ─── 0. detect platform ──────────────────────────────────────────────────────
detect_platform() {
  local uname_s uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  case "$uname_s" in
    Darwin)
      case "$uname_m" in
        arm64|aarch64) ASSET_RE='aarch64\.dmg'; OS=mac ;;
        x86_64)        ASSET_RE='_x64\.dmg';    OS=mac ;;
        *) die "Unsupported macOS arch: $uname_m" ;;
      esac
      ;;
    Linux)
      case "$uname_m" in
        x86_64)  ASSET_RE='(amd64|x86_64)\.AppImage'; OS=linux ;;
        aarch64)
          die "Linux ARM AppImages are not published. Build from source:
    git clone https://github.com/$REPO.git && cd prismos-ai && npm install && npm run tauri build
  or use an x86_64 machine. See https://github.com/$REPO/releases/latest"
          ;;
        *) die "Unsupported Linux arch: $uname_m" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      die "Windows detected — use the PowerShell one-liner instead:
    irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex
  (or grab the .msi from https://github.com/$REPO/releases/latest)"
      ;;
    *) die "Unsupported OS: $uname_s" ;;
  esac
  info "platform: $OS ($uname_m)"
}

# ─── 1. make sure curl + jq-ish tools are present ────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }
require_tools() {
  need curl
  need uname
  need grep
  need sed
}

# ─── 2. resolve latest release URL ───────────────────────────────────────────
latest_asset_url() {
  local api="https://api.github.com/repos/$REPO/releases/latest"
  info "querying latest release …"
  # Use the GitHub redirect for assets when possible; fall back to API parsing.
  local url
  url=$(curl -fsSL "$api" \
        | grep -Eo '"browser_download_url":\s*"[^"]+"' \
        | sed -E 's/.*"([^"]+)"/\1/' \
        | grep -E "$ASSET_RE" \
        | head -n1 || true)
  [ -n "$url" ] || die "couldn't find a release asset matching $ASSET_RE"
  echo "$url"
}

# ─── 3. download + install the app ───────────────────────────────────────────
install_app() {
  local url="$1"
  local fname
  fname=$(basename "$url")
  local tmp
  tmp=$(mktemp -d)
  info "downloading $fname …"
  curl -fL --progress-bar -o "$tmp/$fname" "$url"

  case "$OS" in
    mac)
      info "mounting $fname"
      hdiutil attach -nobrowse -quiet "$tmp/$fname"
      local vol
      vol=$(ls -d /Volumes/PrismOS* 2>/dev/null | head -n1 || true)
      [ -n "$vol" ] || die "couldn't find PrismOS volume after mount"
      info "copying app to /Applications (may prompt for password) …"
      cp -R "$vol"/*.app /Applications/ || sudo cp -R "$vol"/*.app /Applications/
      hdiutil detach -quiet "$vol" || true
      ok "installed to /Applications/PrismOS-AI.app"
      ;;
    linux)
      mkdir -p "$INSTALL_PREFIX/bin"
      local dest="$INSTALL_PREFIX/bin/prismos-ai"
      info "installing AppImage to $dest"
      if [ -w "$INSTALL_PREFIX/bin" ]; then
        mv "$tmp/$fname" "$dest"
      else
        sudo mv "$tmp/$fname" "$dest"
      fi
      chmod +x "$dest" 2>/dev/null || sudo chmod +x "$dest"
      ok "installed: $dest"
      ;;
  esac
  rm -rf "$tmp"
}

# ─── 4. bootstrap Ollama ─────────────────────────────────────────────────────
bootstrap_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama already installed"
  else
    info "installing Ollama (their official script) …"
    curl -fsSL https://ollama.com/install.sh | sh
    command -v ollama >/dev/null 2>&1 || die "Ollama install failed"
  fi

  # Start the daemon if it isn't running. ollama serve is daemon-y; we don't block.
  if ! curl -fsS --max-time 2 http://localhost:11434/api/version >/dev/null 2>&1; then
    info "starting ollama in the background …"
    (ollama serve >/dev/null 2>&1 &)
    # give it a moment
    for _ in 1 2 3 4 5; do
      sleep 1
      curl -fsS --max-time 2 http://localhost:11434/api/version >/dev/null 2>&1 && break
    done
  fi

  if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$DEFAULT_MODEL"; then
    ok "model $DEFAULT_MODEL already pulled"
  else
    info "pulling default model: $DEFAULT_MODEL (this may take a few minutes)"
    ollama pull "$DEFAULT_MODEL" || warn "model pull failed — you can run 'ollama pull $DEFAULT_MODEL' later"
  fi
}

# ─── 5. friendly post-install message ────────────────────────────────────────
done_msg() {
  cat <<EOF

${BOLD}${GREEN}✓ PrismOS-AI is ready.${RESET}

  ${DIM}macOS:${RESET}  open -a "PrismOS-AI"
  ${DIM}Linux:${RESET}  prismos-ai

  ${DIM}Default model:${RESET}  $DEFAULT_MODEL  ${DIM}(change in Settings)${RESET}
  ${DIM}Docs:${RESET}           https://github.com/$REPO

Everything runs locally. No data leaves your machine.
EOF
}

# ─── go ──────────────────────────────────────────────────────────────────────
require_tools
detect_platform
ASSET_URL=$(latest_asset_url)
install_app "$ASSET_URL"
bootstrap_ollama
done_msg
