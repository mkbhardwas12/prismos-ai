#!/usr/bin/env bash
# PrismOS-AI verified-release installer (disabled unless the operator supplies
# an independently obtained SHA-256 digest).
#
# Download and inspect this script first, then run:
#   PRISMOS_EXPECTED_SHA256=<64-hex-release-digest> \
#   PRISMOS_EXPECTED_MAC_TEAM_ID=<publisher-team-id-on-macOS> \
#   ./scripts/install.sh [--pull-model]
#
# Detects OS/arch, downloads the latest GitHub asset, verifies its exact digest,
# and additionally enforces platform signature checks on macOS. Linux relies on
# the explicitly supplied out-of-band digest until detached release signatures ship.
#
# Review the destination before running; this helper is not an unattended updater.
# Model downloads are separate network actions and are never bootstrapped here.

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
EXPECTED_SHA256="${PRISMOS_EXPECTED_SHA256:-}"
EXPECTED_MAC_TEAM_ID="${PRISMOS_EXPECTED_MAC_TEAM_ID:-}"
PULL_MODEL=0
MOUNT_POINT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pull-model) PULL_MODEL=1 ;;
    *) die "unknown option: $1 (supported: --pull-model)" ;;
  esac
  shift
done

cleanup_mount() {
  if [ -n "$MOUNT_POINT" ]; then
    hdiutil detach -quiet "$MOUNT_POINT" >/dev/null 2>&1 \
      || warn "could not detach verified image at $MOUNT_POINT; detach it manually"
    MOUNT_POINT=""
  fi
}
trap cleanup_mount EXIT HUP INT TERM

# ─── 0. detect platform ──────────────────────────────────────────────────────
detect_platform() {
  local uname_s uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  case "$uname_s" in
    Darwin)
      case "$uname_m" in
        arm64|aarch64) ASSET_SUFFIX='aarch64.dmg';  OS=mac    ;;
        x86_64)        ASSET_SUFFIX='x64.dmg';      OS=mac    ;;
        *) die "Unsupported macOS arch: $uname_m" ;;
      esac
      ;;
    Linux)
      case "$uname_m" in
        x86_64)  ASSET_SUFFIX='amd64.AppImage'; OS=linux ;;
        aarch64) ASSET_SUFFIX='arm64.AppImage'; OS=linux ;;
        *) die "Unsupported Linux arch: $uname_m" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      die "Windows detected — download and inspect scripts/install.ps1, then run it with -ExpectedSha256 and -ExpectedPublisher."
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
  need awk
  need find
  need tr
  case "$(uname -s)" in
    Darwin) need shasum; need codesign; need spctl ;;
    Linux) need sha256sum ;;
  esac
}

require_trusted_digest() {
  printf '%s' "$EXPECTED_SHA256" | grep -Eq '^[A-Fa-f0-9]{64}$' \
    || die "Set PRISMOS_EXPECTED_SHA256 to the 64-character digest obtained from an independently trusted release announcement. Automated releases are currently paused until signed artifacts exist."
  if [ "$OS" = "mac" ]; then
    printf '%s' "$EXPECTED_MAC_TEAM_ID" | grep -Eq '^[A-Za-z0-9]{6,20}$' \
      || die "Set PRISMOS_EXPECTED_MAC_TEAM_ID to the publisher Team ID from an independently trusted release announcement."
  fi
}

verify_digest() {
  local file="$1" actual
  case "$OS" in
    mac) actual=$(shasum -a 256 "$file" | awk '{print $1}') ;;
    linux) actual=$(sha256sum "$file" | awk '{print $1}') ;;
  esac
  [ "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]')" ] \
    || die "SHA-256 mismatch; refusing to install the downloaded asset"
  ok "SHA-256 matches the independently supplied digest"
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
        | grep -F "$ASSET_SUFFIX" \
        | head -n1 || true)
  [ -n "$url" ] || die "couldn't find a release asset ending in $ASSET_SUFFIX"
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
  verify_digest "$tmp/$fname"

  case "$OS" in
    mac)
      info "mounting $fname"
      MOUNT_POINT="$tmp/verified-mount"
      mkdir "$MOUNT_POINT"
      hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MOUNT_POINT" "$tmp/$fname"
      local vol
      vol="$MOUNT_POINT"
      local app_bundle
      app_bundle=$(find "$vol" -maxdepth 1 -type d -name '*.app' -print -quit)
      [ -n "$app_bundle" ] || die "couldn't find a PrismOS app bundle after mount"
      codesign --verify --deep --strict "$app_bundle" \
        || die "macOS code-signature verification failed"
      local actual_team_id
      actual_team_id=$(codesign -dv --verbose=4 "$app_bundle" 2>&1 \
        | sed -n 's/^TeamIdentifier=//p' | head -n1)
      [ "$actual_team_id" = "$EXPECTED_MAC_TEAM_ID" ] \
        || die "macOS Team ID '$actual_team_id' does not match expected Team ID '$EXPECTED_MAC_TEAM_ID'"
      spctl --assess --type execute "$app_bundle" \
        || die "macOS Gatekeeper assessment failed (not notarized or untrusted publisher)"
      ok "macOS publisher signature and Gatekeeper assessment passed"
      info "copying app to /Applications (may prompt for password) …"
      cp -R "$app_bundle" /Applications/ || sudo cp -R "$app_bundle" /Applications/
      hdiutil detach -quiet "$vol"
      MOUNT_POINT=""
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

# ─── 4. optionally prepare an already-installed Ollama ──────────────────────
prepare_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama already installed"
  else
    warn "Ollama is not installed. Install it separately from https://ollama.com after reviewing its installer, then run 'ollama pull $DEFAULT_MODEL'."
    return
  fi

  if [ "$PULL_MODEL" -ne 1 ]; then
    warn "Model pull skipped. Re-run with --pull-model or run 'ollama pull $DEFAULT_MODEL' after reviewing the registry/network action."
    return
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

Core inference uses a fixed loopback client route. This installer queried GitHub,
and pulling the model contacts the registry configured for Ollama.
EOF
}

# ─── go ──────────────────────────────────────────────────────────────────────
require_tools
detect_platform
require_trusted_digest
ASSET_URL=$(latest_asset_url)
install_app "$ASSET_URL"
prepare_ollama
done_msg
