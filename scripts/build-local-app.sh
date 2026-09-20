#!/bin/bash
# Build the checked-out macOS app. This helper never updates Git or launches apps.
set -euo pipefail
umask 077

fail() { printf 'Build stopped: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 0 ]] || fail "This helper takes no arguments."
[[ "$(uname -s)" == "Darwin" ]] || fail "This helper builds the macOS .app bundle."

PRISMOS_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ -n "$PRISMOS_SCRIPT_DIR" && "$PRISMOS_SCRIPT_DIR" != / ]] || fail "Invalid script directory."
PRISMOS_REPO_ROOT="$(cd -- "$PRISMOS_SCRIPT_DIR/.." && pwd -P)"
[[ -n "$PRISMOS_REPO_ROOT" && "$PRISMOS_REPO_ROOT" != / ]] || fail "Invalid repository directory."
[[ -f "$PRISMOS_REPO_ROOT/package.json" && -f "$PRISMOS_REPO_ROOT/src-tauri/tauri.conf.json" ]] || fail "PrismOS package/configuration not found beside this script."

# Finder launches may omit the package-manager and Rust toolchain directories.
[[ -n "${HOME:-}" && -d "$HOME" ]] || fail "A valid user home directory is required."
PRISMOS_USER_DIR="$(cd -- "$HOME" && pwd -P)"
[[ "$PRISMOS_USER_DIR" != / ]] || fail "Invalid user directory."
export PATH="$PRISMOS_USER_DIR/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
for PRISMOS_TOOL in npm node cargo shasum stat mktemp find tee; do
  command -v "$PRISMOS_TOOL" >/dev/null || fail "Required tool is missing: $PRISMOS_TOOL"
done
[[ -x /usr/bin/ditto && -x /usr/libexec/PlistBuddy ]] || fail "Required macOS bundle tools are missing."

cd -- "$PRISMOS_REPO_ROOT"
node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
  if (config.productName !== "PrismOS-AI" || config.identifier !== "com.prismos.app") {
    throw new Error("Unexpected product name or application data identifier");
  }
'
[[ -z "${CARGO_TARGET_DIR:-}" || "$CARGO_TARGET_DIR" == "$PRISMOS_REPO_ROOT/src-tauri/target" ]] || fail "Unset the custom CARGO_TARGET_DIR before using this helper."

# Refuse redirected output/backup sources rather than following a symlink out
# of this checkout. Every path passed here must be a descendant of this root.
check_repo_directory_chain() {
  local PRISMOS_CHECK_PATH="$1"
  case "$PRISMOS_CHECK_PATH" in "$PRISMOS_REPO_ROOT"/*) ;; *) fail "Path is outside the checkout." ;; esac
  while [[ "$PRISMOS_CHECK_PATH" != "$PRISMOS_REPO_ROOT" ]]; do
    [[ ! -L "$PRISMOS_CHECK_PATH" ]] || fail "Symlinked build directory requires manual inspection: $PRISMOS_CHECK_PATH"
    [[ ! -e "$PRISMOS_CHECK_PATH" || -d "$PRISMOS_CHECK_PATH" ]] || fail "Expected a directory: $PRISMOS_CHECK_PATH"
    PRISMOS_CHECK_PATH="${PRISMOS_CHECK_PATH%/*}"
  done
}

PRISMOS_BUNDLE_PARENT="$PRISMOS_REPO_ROOT/src-tauri/target/release/bundle/macos"
PRISMOS_BUNDLE="$PRISMOS_BUNDLE_PARENT/PrismOS-AI.app"
PRISMOS_EXECUTABLE="$PRISMOS_BUNDLE/Contents/MacOS/prismos"
PRISMOS_PLIST="$PRISMOS_BUNDLE/Contents/Info.plist"
check_repo_directory_chain "$PRISMOS_BUNDLE_PARENT"
[[ ! -L "$PRISMOS_BUNDLE" ]] || fail "The existing app bundle is a symbolic link."

PRISMOS_LOG_DIR="$PRISMOS_REPO_ROOT/build/local-build-logs"
check_repo_directory_chain "$PRISMOS_LOG_DIR"
mkdir -p -- "$PRISMOS_LOG_DIR"
PRISMOS_LOG_FILE="$(mktemp "$PRISMOS_LOG_DIR/build.XXXXXX")"
[[ -f "$PRISMOS_LOG_FILE" && ! -L "$PRISMOS_LOG_FILE" && "$PRISMOS_LOG_FILE" == "$PRISMOS_LOG_DIR/"* ]] || fail "Unable to create a safe build log."
trap 'printf "Build failed. Inspect the log: %s\n" "$PRISMOS_LOG_FILE" >&2' ERR

PRISMOS_OLD_HASH=""
PRISMOS_RECOVERY_DIR=""
if [[ -e "$PRISMOS_BUNDLE" ]]; then
  [[ -d "$PRISMOS_BUNDLE" && -f "$PRISMOS_PLIST" && -f "$PRISMOS_EXECUTABLE" && -x "$PRISMOS_EXECUTABLE" ]] || fail "Existing app bundle is incomplete; preserve it manually before rebuilding."
  PRISMOS_BUNDLE_LINK="$(find "$PRISMOS_BUNDLE" -type l -print -quit)"
  [[ -z "$PRISMOS_BUNDLE_LINK" ]] || fail "Existing app contains symbolic links; inspect them before making a recovery copy."
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PRISMOS_PLIST")" == "com.prismos.app" ]] || fail "Existing bundle has an unexpected application identifier."
  PRISMOS_OLD_HASH="$(shasum -a 256 "$PRISMOS_EXECUTABLE")"
  PRISMOS_OLD_HASH="${PRISMOS_OLD_HASH%% *}"
  [[ "$PRISMOS_OLD_HASH" =~ ^[0-9a-f]{64}$ ]] || fail "Could not hash the existing executable."

  PRISMOS_SUPPORT_DIR="$(cd -- "$PRISMOS_USER_DIR/Library/Application Support" && pwd -P)"
  [[ -n "$PRISMOS_SUPPORT_DIR" && "$PRISMOS_SUPPORT_DIR" != / ]] || fail "Invalid local recovery parent."
  case "$PRISMOS_SUPPORT_DIR/" in "$PRISMOS_REPO_ROOT/"*) fail "Recovery copies must live outside the checkout." ;; esac
  PRISMOS_RECOVERY_DIR="$(mktemp -d "$PRISMOS_SUPPORT_DIR/prismos-build-recovery.XXXXXX")"
  [[ -d "$PRISMOS_RECOVERY_DIR" && ! -L "$PRISMOS_RECOVERY_DIR" && "$PRISMOS_RECOVERY_DIR" == "$PRISMOS_SUPPORT_DIR/prismos-build-recovery."* ]] || fail "Invalid recovery directory."
  [[ "$(stat -f '%u' "$PRISMOS_RECOVERY_DIR")" == "$(id -u)" && "$(stat -f '%Lp' "$PRISMOS_RECOVERY_DIR")" == 700 ]] || fail "Recovery directory must be owned by this user with mode 700."
  PRISMOS_RECOVERY_BUNDLE="$PRISMOS_RECOVERY_DIR/PrismOS-AI.app"
  [[ ! -e "$PRISMOS_RECOVERY_BUNDLE" && ! -L "$PRISMOS_RECOVERY_BUNDLE" ]] || fail "Recovery destination is not fresh."
  /usr/bin/ditto "$PRISMOS_BUNDLE" "$PRISMOS_RECOVERY_BUNDLE"
  [[ -f "$PRISMOS_RECOVERY_BUNDLE/Contents/MacOS/prismos" ]] || fail "Recovery copy is incomplete."
  PRISMOS_RECOVERY_HASH="$(shasum -a 256 "$PRISMOS_RECOVERY_BUNDLE/Contents/MacOS/prismos")"
  PRISMOS_RECOVERY_HASH="${PRISMOS_RECOVERY_HASH%% *}"
  [[ "$PRISMOS_RECOVERY_HASH" == "$PRISMOS_OLD_HASH" ]] || fail "Recovery executable verification failed."
  printf 'Previous code bundle preserved: %s\nThis copy contains app code only; it is not a knowledge/database backup.\n' "$PRISMOS_RECOVERY_BUNDLE" | tee -a "$PRISMOS_LOG_FILE"
fi

PRISMOS_BUILD_EPOCH="$(date -u +%s)"
PRISMOS_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[[ "$PRISMOS_BUILD_EPOCH" =~ ^[0-9]+$ && -n "$PRISMOS_BUILD_TIME" ]] || fail "Unable to determine build time."
export VITE_PRISMOS_BUILD="$PRISMOS_BUILD_TIME"
printf 'Building checked-out local code: %s\nBuild marker: %s\nLog: %s\n' "$PRISMOS_REPO_ROOT" "$PRISMOS_BUILD_TIME" "$PRISMOS_LOG_FILE" | tee -a "$PRISMOS_LOG_FILE"

# pipefail propagates npm/Tauri errors even when tee succeeds. A stale .app can
# never turn a failed build into a successful result.
npm run tauri build -- --bundles app 2>&1 | tee -a "$PRISMOS_LOG_FILE"

check_repo_directory_chain "$PRISMOS_BUNDLE/Contents/MacOS"
[[ -f "$PRISMOS_EXECUTABLE" && -x "$PRISMOS_EXECUTABLE" && ! -L "$PRISMOS_EXECUTABLE" && -f "$PRISMOS_PLIST" && ! -L "$PRISMOS_PLIST" ]] || fail "Successful build did not produce the expected app and executable."
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PRISMOS_PLIST")" == "com.prismos.app" ]] || fail "Built bundle changed the application data identifier."
PRISMOS_BUNDLE_MTIME="$(stat -f '%m' "$PRISMOS_PLIST")"
[[ "$PRISMOS_BUNDLE_MTIME" =~ ^[0-9]+$ && "$PRISMOS_BUNDLE_MTIME" -ge "$PRISMOS_BUILD_EPOCH" ]] || fail "Bundle metadata predates this build."
PRISMOS_NEW_HASH="$(shasum -a 256 "$PRISMOS_EXECUTABLE")"
PRISMOS_NEW_HASH="${PRISMOS_NEW_HASH%% *}"
[[ "$PRISMOS_NEW_HASH" =~ ^[0-9a-f]{64}$ ]] || fail "Could not hash the built executable."
[[ -z "$PRISMOS_OLD_HASH" || "$PRISMOS_NEW_HASH" != "$PRISMOS_OLD_HASH" ]] || fail "Executable is unchanged despite the new frontend build marker; refusing to report a fresh build."
printf '\nBuild verified.\nApp: %s\nExecutable: %s\nExecutable SHA-256: %s\nBuild marker (UTC): %s\nFinished (UTC): %s\n' "$PRISMOS_BUNDLE" "$PRISMOS_EXECUTABLE" "$PRISMOS_NEW_HASH" "$PRISMOS_BUILD_TIME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$PRISMOS_LOG_FILE"
printf 'Quit PrismOS completely before opening this exact app bundle. Closing its window only hides it to the tray.\nAfter opening, confirm the Knowledge atlas 2 build date matches %s (full timestamp is in its tooltip).\nThis helper does not stop, restart, or launch any app.\n' "${PRISMOS_BUILD_TIME%%T*}" | tee -a "$PRISMOS_LOG_FILE"
