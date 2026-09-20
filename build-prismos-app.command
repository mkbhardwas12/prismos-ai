#!/bin/bash
# Double-click to build this checkout. App launch is a separate, manual step.
set -euo pipefail
PRISMOS_LAUNCHER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ -n "$PRISMOS_LAUNCHER_DIR" && "$PRISMOS_LAUNCHER_DIR" != / ]] || { printf 'Invalid launcher directory.\n' >&2; exit 1; }
PRISMOS_BUILD_HELPER="$PRISMOS_LAUNCHER_DIR/scripts/build-local-app.sh"
[[ -f "$PRISMOS_BUILD_HELPER" && ! -L "$PRISMOS_BUILD_HELPER" ]] || { printf 'Local build helper not found.\n' >&2; exit 1; }
exec /bin/bash "$PRISMOS_BUILD_HELPER" "$@"
