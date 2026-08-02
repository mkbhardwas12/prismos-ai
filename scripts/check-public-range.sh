#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/check-public-range.sh <before-oid> <after-oid>" >&2
}

if [[ "$#" -ne 2 ]]; then
  usage
  exit 2
fi

before_oid="$1"
after_oid="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
checker="${repo_root}/scripts/check-public-boundary.sh"
cd "${repo_root}"

if [[ ! -x "${checker}" ]]; then
  echo "PrismOS public-boundary checker is missing or not executable." >&2
  exit 2
fi

is_zero_oid() {
  [[ "$1" =~ ^(0{40}|0{64})$ ]]
}

is_object_oid() {
  [[ "$1" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]
}

if ! is_object_oid "${before_oid}" || ! is_object_oid "${after_oid}"; then
  echo "Public-boundary range contains an invalid Git object ID." >&2
  exit 2
fi

if is_zero_oid "${after_oid}"; then
  echo "Deleted ref exposes no new snapshot; no public-boundary range to scan."
  exit 0
fi
if ! git rev-parse --verify "${after_oid}^{commit}" >/dev/null 2>&1; then
  echo "Public-boundary range endpoint is not a readable commit." >&2
  exit 2
fi

commits_temp="$(mktemp)"
cleanup() {
  rm -f -- "${commits_temp}"
}
trap cleanup EXIT

if is_zero_oid "${before_oid}"; then
  rev_args=("${after_oid}")
  # After a new branch arrives, checkout may already expose that same branch as
  # refs/remotes/origin/<name>. Exclude only *other* refs from the destination
  # remote, never all remotes and never the just-pushed ref itself.
  if [[ -n "${PRISMOS_DESTINATION_REMOTE:-}" ]]; then
    current_destination_ref=""
    case "${PRISMOS_SNAPSHOT_REF:-}" in
      refs/heads/*)
        current_destination_ref="refs/remotes/${PRISMOS_DESTINATION_REMOTE}/${PRISMOS_SNAPSHOT_REF#refs/heads/}"
        ;;
    esac
    destination_refs_temp="$(mktemp)"
    git for-each-ref --format='%(refname) %(objectname)' \
      "refs/remotes/${PRISMOS_DESTINATION_REMOTE}/" > "${destination_refs_temp}"
    while read -r destination_ref destination_oid; do
      [[ -n "${destination_ref}" ]] || continue
      [[ "${destination_ref}" != "${current_destination_ref}" ]] || continue
      if ! is_object_oid "${destination_oid}" || is_zero_oid "${destination_oid}"; then
        echo "Destination remote-tracking ref has an invalid object ID; failing closed." >&2
        rm -f -- "${destination_refs_temp}"
        exit 2
      fi
      rev_args+=("^${destination_oid}")
    done < "${destination_refs_temp}"
    rm -f -- "${destination_refs_temp}"
  fi
  git rev-list --reverse "${rev_args[@]}" > "${commits_temp}"
else
  if ! git rev-parse --verify "${before_oid}^{commit}" >/dev/null 2>&1; then
    echo "Public-boundary range start is not locally available; failing closed." >&2
    exit 2
  fi
  git rev-list --reverse "${after_oid}" "^${before_oid}" > "${commits_temp}"
fi

checked=0
while IFS= read -r commit; do
  [[ -n "${commit}" ]] || continue
  if ! is_object_oid "${commit}"; then
    echo "git rev-list returned an invalid object ID; failing closed." >&2
    exit 2
  fi
  PRISMOS_SNAPSHOT_REF="${PRISMOS_SNAPSHOT_REF:-}" bash "${checker}" --treeish "${commit}"
  checked=$((checked + 1))
done < "${commits_temp}"

# GitHub's push endpoint is normally the peeled commit. Resolve the pushed tag
# ref separately so an annotated tag message is scanned as well.
case "${PRISMOS_SNAPSHOT_REF:-}" in
  refs/tags/*)
    if ! tag_oid="$(git rev-parse --verify "${PRISMOS_SNAPSHOT_REF}^{object}" 2>/dev/null)"; then
      echo "Pushed tag object is not locally available; failing closed." >&2
      exit 2
    fi
    if [[ "$(git cat-file -t "${tag_oid}")" == "tag" ]]; then
      PRISMOS_SNAPSHOT_REF="${PRISMOS_SNAPSHOT_REF}" bash "${checker}" --treeish "${tag_oid}"
      checked=$((checked + 1))
    fi
    ;;
esac

# A force-push to an already-known commit can produce an empty revision range.
# Still scan its exact tree and the ref name.
if [[ "${checked}" -eq 0 ]]; then
  PRISMOS_SNAPSHOT_REF="${PRISMOS_SNAPSHOT_REF:-}" bash "${checker}" --treeish "${after_oid}"
  checked=1
fi

echo "Public-boundary range scan passed for ${checked} exact snapshot(s)."
