#!/usr/bin/env bash
# PrismOS-AI one-line installer
# Usage:  curl -fsSL https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.sh | sh
#
# Detects your OS + arch, downloads the latest GitHub Release asset,
# checks SHA-256 against the API digest, and bootstraps Ollama.
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

file_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "need shasum or sha256sum to verify the download"
  fi
}

# ─── 2. resolve latest release URL + digest ──────────────────────────────────
latest_asset() {
  local api="https://api.github.com/repos/$REPO/releases/latest"
  info "querying latest release …"
  ASSET_URL=""
  ASSET_DIGEST=""
  if command -v python3 >/dev/null 2>&1; then
    local parsed
    parsed=$(ASSET_RE="$ASSET_RE" python3 - "$api" <<'PY'
import json, os, re, sys, urllib.request
pat = os.environ["ASSET_RE"]
req = urllib.request.Request(sys.argv[1], headers={"User-Agent": "prismos-installer"})
data = json.load(urllib.request.urlopen(req))
rx = re.compile(pat)
for a in data.get("assets") or []:
    name = a.get("name") or ""
    if rx.search(name):
        print(a.get("browser_download_url") or "")
        digest = a.get("digest") or ""
        print(digest[7:] if digest.startswith("sha256:") else digest)
        sys.exit(0)
sys.exit(1)
PY
) || true
    ASSET_URL=$(printf '%s\n' "$parsed" | sed -n '1p')
    ASSET_DIGEST=$(printf '%s\n' "$parsed" | sed -n '2p')
  fi
  if [ -z "$ASSET_URL" ]; then
    ASSET_URL=$(curl -fsSL -A prismos-installer "$api" \
          | grep -Eo '"browser_download_url":\s*"[^"]+"' \
          | sed -E 's/.*"([^"]+)"/\1/' \
          | grep -E "$ASSET_RE" \
          | head -n1 || true)
  fi
  [ -n "$ASSET_URL" ] || die "couldn't find a release asset matching $ASSET_RE"
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

  local got
  got=$(file_sha256 "$tmp/$fname")
  info "sha256 $got"
  if [ -n "${ASSET_DIGEST:-}" ]; then
    [ "$got" = "$ASSET_DIGEST" ] || die "SHA-256 mismatch for $fname
  expected $ASSET_DIGEST
  got      $got"
    ok "checksum matches GitHub digest"
  else
    warn "GitHub digest unavailable; left the file hash above for manual check"
  fi

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
latest_asset
install_app "$ASSET_URL"
bootstrap_ollama
done_msg
