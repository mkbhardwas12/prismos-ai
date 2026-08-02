#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this installer from the PrismOS Git worktree." >&2
  exit 2
fi
if [[ -L ".githooks" || ! -d ".githooks" || -L ".githooks/pre-push" || ! -f ".githooks/pre-push" ]]; then
  echo "Refusing to install from a missing or symlinked .githooks/pre-push." >&2
  exit 1
fi

config_temp="$(mktemp)"
cleanup() {
  rm -f -- "${config_temp}"
}
trap cleanup EXIT

config_rc=0
git config --null --get-all core.hooksPath > "${config_temp}" || config_rc=$?
case "${config_rc}" in
  0|1) ;;
  *)
    echo "Could not inspect effective Git hook configuration; failing closed." >&2
    exit 1
    ;;
esac

already_target=0
while IFS= read -r -d '' configured_hooks_path; do
  if [[ "${configured_hooks_path}" != ".githooks" ]]; then
    echo "Refusing to override an existing system/global/local core.hooksPath." >&2
    echo "Merge the PrismOS pre-push check into the existing hooks manually." >&2
    exit 1
  fi
  already_target=1
done < "${config_temp}"

if [[ "${already_target}" == "0" ]]; then
  default_hooks_dir="$(git rev-parse --git-path hooks)"
  if [[ -L "${default_hooks_dir}" ]]; then
    echo "Refusing to bypass a symlinked Git hooks directory." >&2
    echo "Merge the PrismOS pre-push check into the existing hooks manually." >&2
    exit 1
  fi
  if [[ -d "${default_hooks_dir}" ]]; then
    shopt -s nullglob dotglob
    for existing_hook in "${default_hooks_dir}"/*; do
      hook_name="${existing_hook##*/}"
      case "${hook_name}" in
        .|..|*.sample) continue ;;
      esac
      echo "Refusing to replace a non-sample hook in Git's current hooks directory." >&2
      echo "Merge the PrismOS pre-push check into the existing hooks manually." >&2
      exit 1
    done
    shopt -u nullglob dotglob
  fi

  git config --local core.hooksPath .githooks
fi

chmod +x .githooks/pre-push scripts/check-public-boundary.sh scripts/check-public-range.sh
if [[ "${already_target}" == "1" ]]; then
  echo "PrismOS .githooks is already the effective Git hooks path for this clone."
else
  echo "Installed the PrismOS pre-push public-boundary hook for this clone."
fi
echo "Git --no-verify can bypass local hooks; keep branch protection and review enabled too."
