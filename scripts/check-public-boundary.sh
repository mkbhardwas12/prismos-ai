#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/check-public-boundary.sh [--worktree | --treeish <object>]

With no option, inspect the exact staged index. --worktree is useful during
development; --treeish lets CI and the pre-push hook inspect an exact Git
commit, tree, or annotated tag that peels to a tree.
EOF
}

mode="cached"
treeish=""
case "${1:-}" in
  "") ;;
  --worktree)
    [[ "$#" -eq 1 ]] || { usage; exit 2; }
    mode="worktree"
    ;;
  --treeish)
    [[ "$#" -eq 2 ]] || { usage; exit 2; }
    mode="treeish"
    treeish="$2"
    ;;
  *)
    usage
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Public-boundary check must run inside the PrismOS Git worktree." >&2
  exit 2
fi
if [[ "${mode}" == "treeish" ]] && ! git rev-parse --verify "${treeish}^{tree}" >/dev/null 2>&1; then
  echo "Public-boundary treeish does not peel to a readable tree." >&2
  exit 2
fi

failed=0
filtered_terms=""
snapshot_records_temp=""
snapshot_paths_temp=""
untracked_paths_temp=""
grep_result_temp=""
metadata_temp=""
media_manifest_temp=""
media_paths_temp=""
binary_paths_temp=""

cleanup() {
  local temp_path
  for temp_path in \
    "${filtered_terms}" \
    "${snapshot_records_temp}" \
    "${snapshot_paths_temp}" \
    "${untracked_paths_temp}" \
    "${grep_result_temp}" \
    "${metadata_temp}" \
    "${media_manifest_temp}" \
    "${media_paths_temp}" \
    "${binary_paths_temp}"; do
    if [[ -n "${temp_path}" && -f "${temp_path}" ]]; then
      rm -f -- "${temp_path}"
    fi
  done
}
trap cleanup EXIT

filtered_terms="$(mktemp)"
snapshot_records_temp="$(mktemp)"
snapshot_paths_temp="$(mktemp)"
untracked_paths_temp="$(mktemp)"
grep_result_temp="$(mktemp)"
metadata_temp="$(mktemp)"
media_manifest_temp="$(mktemp)"
media_paths_temp="$(mktemp)"
binary_paths_temp="$(mktemp)"

report_path_violation() {
  local reason="$1"
  local path="$2"
  local withhold_path="${3:-0}"
  if [[ "${withhold_path}" == "1" ]]; then
    printf '%s (path withheld).\n' "${reason}" >&2
  else
    printf '%s: %s\n' "${reason}" "${path}" >&2
  fi
  failed=1
}

grep_file_regex() {
  local file="$1"
  local pattern="$2"
  local rc
  set +e
  LC_ALL=C grep -E -q -e "${pattern}" -- "${file}"
  rc=$?
  set -e
  case "${rc}" in
    0) return 0 ;;
    1) return 1 ;;
    *)
      echo "Public-boundary regex scanner failed closed." >&2
      failed=1
      return 2
      ;;
  esac
}

grep_file_fixed_patterns() {
  local file="$1"
  local patterns_file="$2"
  local rc
  set +e
  LC_ALL=C grep -F -q -f "${patterns_file}" -- "${file}"
  rc=$?
  set -e
  case "${rc}" in
    0) return 0 ;;
    1) return 1 ;;
    *)
      echo "Public-boundary owner-term scanner failed closed." >&2
      failed=1
      return 2
      ;;
  esac
}

grep_file_exact_line() {
  local file="$1"
  local literal="$2"
  local rc
  set +e
  LC_ALL=C grep -F -x -q -e "${literal}" -- "${file}"
  rc=$?
  set -e
  case "${rc}" in
    0) return 0 ;;
    1) return 1 ;;
    *)
      echo "Public-boundary exact-line scanner failed closed." >&2
      failed=1
      return 2
      ;;
  esac
}

path_contains_sensitive_text() {
  local path="$1"
  local scan_temp
  local sensitive=1
  scan_temp="$(mktemp)"
  printf '%s' "${path}" > "${scan_temp}"
  if grep_file_regex "${scan_temp}" "${secret_pattern}"; then
    sensitive=0
  elif [[ "$?" -gt 1 ]]; then
    sensitive=0
  elif [[ "${private_terms_ready}" == "1" ]]; then
    if grep_file_fixed_patterns "${scan_temp}" "${filtered_terms}"; then
      sensitive=0
    elif [[ "$?" -gt 1 ]]; then
      sensitive=0
    fi
  fi
  rm -f -- "${scan_temp}"
  return "${sensitive}"
}

private_terms_file="${PRISMOS_PRIVATE_TERMS_FILE:-${repo_root}/.prismos-private-terms}"
private_terms_ready=0
if [[ -L "${private_terms_file}" ]]; then
  echo "Owner-private denylist must be a regular, non-symlink file." >&2
  failed=1
elif [[ -e "${private_terms_file}" && ! -f "${private_terms_file}" ]]; then
  echo "Owner-private denylist must be a regular file." >&2
  failed=1
elif [[ -f "${private_terms_file}" ]]; then
  private_mode=""
  if private_mode="$(stat -f '%Lp' -- "${private_terms_file}" 2>/dev/null)"; then
    :
  elif private_mode="$(stat -c '%a' -- "${private_terms_file}" 2>/dev/null)"; then
    :
  else
    echo "Could not verify owner-private denylist permissions; failing closed." >&2
    failed=1
  fi
  if [[ -n "${private_mode}" && "${private_mode}" != "600" ]]; then
    echo "Owner-private denylist must have Unix mode 0600." >&2
    failed=1
  fi
  if grep_file_regex "${private_terms_file}" $'\r'; then
    echo "Owner-private denylist must use LF line endings." >&2
    failed=1
  elif [[ "$?" -gt 1 ]]; then
    :
  fi
  if ! sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "${private_terms_file}" > "${filtered_terms}" 2>/dev/null; then
    echo "Could not read owner-private denylist; failing closed." >&2
    failed=1
  fi
  if [[ -s "${filtered_terms}" ]]; then
    private_terms_ready=1
  fi
elif [[ "${PRISMOS_REQUIRE_PRIVATE_TERMS:-0}" == "1" ]]; then
  echo "Owner-private denylist is required but was not provided." >&2
  failed=1
else
  echo "Note: owner-private denylist not provided; generic public-boundary checks only." >&2
fi

# Materialize the exact snapshot record list before inspecting it. Avoid process
# substitution here: an ls-files/ls-tree failure must not be hidden by a loop.
snapshot_list_rc=0
case "${mode}" in
  cached|worktree)
    git ls-files -s -z > "${snapshot_records_temp}" || snapshot_list_rc=$?
    ;;
  treeish)
    git ls-tree -r -z "${treeish}" > "${snapshot_records_temp}" || snapshot_list_rc=$?
    ;;
esac
if [[ "${snapshot_list_rc}" -ne 0 ]]; then
  echo "Could not enumerate the exact Git snapshot; failing closed." >&2
  exit 2
fi

if [[ "${mode}" == "worktree" ]]; then
  untracked_list_rc=0
  git ls-files --others --exclude-standard -z > "${untracked_paths_temp}" 2>/dev/null || untracked_list_rc=$?
  if [[ "${untracked_list_rc}" -ne 0 ]]; then
    echo "Could not enumerate nonignored untracked files; failing closed." >&2
    exit 2
  fi
  while IFS= read -r -d '' untracked; do
    if [[ -f "${untracked}" && ! -L "${untracked}" ]]; then
      untracked_mode="100644"
      [[ -x "${untracked}" ]] && untracked_mode="100755"
      if ! untracked_oid="$(git hash-object -- "${untracked}" 2>/dev/null)"; then
        echo "Could not hash a nonignored untracked file; failing closed." >&2
        failed=1
        untracked_oid="0000000000000000000000000000000000000000"
      fi
    elif [[ -L "${untracked}" ]]; then
      untracked_mode="120000"
      untracked_oid="0000000000000000000000000000000000000000"
    else
      untracked_mode="000000"
      untracked_oid="0000000000000000000000000000000000000000"
    fi
    printf '%s %s 0\t%s\0' "${untracked_mode}" "${untracked_oid}" "${untracked}" >> "${snapshot_records_temp}"
  done < "${untracked_paths_temp}"
fi

# High-confidence tokens only. The checker never emits matching content or a
# sensitive path. It intentionally treats encoded binary bytes as text too.
secret_pattern='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{30,}|sk-(proj-)?[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'

while IFS= read -r -d '' record; do
  if [[ "${record}" != *$'\t'* ]]; then
    echo "Malformed Git snapshot record; failing closed." >&2
    failed=1
    continue
  fi
  record_meta="${record%%$'\t'*}"
  tracked="${record#*$'\t'}"
  object_mode=""
  object_oid=""
  object_type_or_stage=""
  read -r object_mode object_oid object_type_or_stage <<< "${record_meta}"

  if [[ "${mode}" == "treeish" ]]; then
    object_type="${object_oid}"
    object_oid="${object_type_or_stage}"
    if [[ "${object_mode}" != "100644" && "${object_mode}" != "100755" ]] || [[ "${object_type}" != "blob" ]]; then
      report_path_violation "Non-regular repository entry is forbidden" "${tracked}" 1
    fi
  else
    stage="${object_type_or_stage}"
    if [[ "${stage}" != "0" ]]; then
      report_path_violation "Unmerged index entry is forbidden" "${tracked}" 1
    fi
    if [[ "${object_mode}" != "100644" && "${object_mode}" != "100755" ]]; then
      report_path_violation "Non-regular repository entry is forbidden" "${tracked}" 1
    fi
    if [[ "${mode}" == "worktree" ]] && { [[ ! -f "${tracked}" ]] || [[ -L "${tracked}" ]]; }; then
      report_path_violation "Tracked worktree entry is missing or non-regular" "${tracked}" 1
    fi
  fi
  printf '%s\0' "${tracked}" >> "${snapshot_paths_temp}"

  sensitive_path=0
  path_scan_temp="$(mktemp)"
  printf '%s' "${tracked}" > "${path_scan_temp}"
  if grep_file_regex "${path_scan_temp}" "${secret_pattern}"; then
    echo "High-confidence secret pattern found in a public-candidate path (path withheld)." >&2
    sensitive_path=1
    failed=1
  elif [[ "$?" -gt 1 ]]; then
    sensitive_path=1
  fi
  if [[ "${private_terms_ready}" == "1" ]]; then
    if grep_file_fixed_patterns "${path_scan_temp}" "${filtered_terms}"; then
      echo "Owner-private deny term found in a public-candidate path (path withheld)." >&2
      sensitive_path=1
      failed=1
    elif [[ "$?" -gt 1 ]]; then
      sensitive_path=1
    fi
  fi
  rm -f -- "${path_scan_temp}"

  tracked_lower="$(printf '%s' "${tracked}" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  basename_only="${tracked_lower##*/}"

  path_control_temp="$(mktemp)"
  printf '%s' "${tracked}" > "${path_control_temp}"
  if grep_file_regex "${path_control_temp}" '[[:cntrl:]]'; then
    report_path_violation "Control characters in tracked paths are forbidden" "${tracked}" 1
    sensitive_path=1
  elif [[ "$?" -gt 1 ]]; then
    sensitive_path=1
  fi
  rm -f -- "${path_control_temp}"

  if [[ "${tracked_lower}" == "file.gif" ]]; then
    report_path_violation "Refusing tracked private artifact" "${tracked}" "${sensitive_path}"
    continue
  fi

  case "/${tracked_lower}" in
    */knowledge/*|*/prismdocs/*|*/private-backups/*|*/scripts/flywheel/data/*|*/scripts/flywheel/adapters/*|*/scripts/flywheel/fused/*|*/scripts/flywheel/holdout.jsonl|*/adapters/*|*/fused/*|*/com.prismos.app/*)
      report_path_violation "Refusing tracked private artifact" "${tracked}" "${sensitive_path}"
      continue
      ;;
  esac

  if [[ "${basename_only}" == .env || ("${basename_only}" == .env.* && "${basename_only}" != .env.example) ]]; then
    report_path_violation "Refusing tracked environment file" "${tracked}" "${sensitive_path}"
    continue
  fi

  case "${tracked_lower}" in
    *.db|*.db-journal|*.db-wal|*.db-shm|*.sqlite|*.sqlite-journal|*.sqlite-wal|*.sqlite-shm|*.sqlite3|*.sqlite3-journal|*.sqlite3-wal|*.sqlite3-shm|*.prismos|*.prismos-sync|*.prismos-vault|*.gguf|*.safetensors|*.npz|*.pem|*.key|*.p12|*.pfx|*.kdbx|*.log)
      report_path_violation "Refusing tracked private artifact" "${tracked}" "${sensitive_path}"
      ;;
    *.pdf|*.doc|*.docx|*.docm|*.dot|*.dotx|*.dotm|*.xls|*.xlsx|*.xlsm|*.xlsb|*.xlt|*.xltx|*.xltm|*.ppt|*.pptx|*.pptm|*.pot|*.potx|*.potm|*.pps|*.ppsx|*.ppsm|*.odt|*.ods|*.odp|*.rtf|*.pages|*.numbers|*.keynote|*.zip|*.7z|*.rar|*.tar|*.tgz|*.gz|*.bz2|*.xz|*.zst|*.lz|*.lz4|*.cab|*.iso|*.dmg|*.pkg|*.deb|*.rpm|*.jar|*.war|*.ear)
      report_path_violation "Opaque document/archive binary requires conversion to reviewed text" "${tracked}" "${sensitive_path}"
      ;;
  esac

  case "${basename_only}" in
    brain_export*.json|brain_wrapped*.json|spectrum_export*.json|cognitive_profile*.json|conversation*.json|memory_dump*.json)
      report_path_violation "Refusing tracked personal export" "${tracked}" "${sensitive_path}"
      ;;
  esac

  case "${basename_only}" in
    credentials.example.json|credentials.example.yaml|credentials.example.yml|credentials.example.toml|secrets.example.json|secrets.example.yaml|secrets.example.yml|secrets.example.toml|service-account.example.json|service-account.example.yaml|service-account.example.yml|service-account.example.toml|service_account.example.json|service_account.example.yaml|service_account.example.yml|service_account.example.toml)
      ;;
    credentials*.json|credentials*.yaml|credentials*.yml|credentials*.toml|secrets*.json|secrets*.yaml|secrets*.yml|secrets*.toml|service-account*.json|service-account*.yaml|service-account*.yml|service-account*.toml|service_account*.json|service_account*.yaml|service_account*.yml|service_account*.toml)
      report_path_violation "Refusing tracked credential configuration" "${tracked}" "${sensitive_path}"
      ;;
  esac

  case "${basename_only}" in
    you-port-device.key|prismos-audit.log|.npmrc|.pypirc|.netrc|.git-credentials|id_rsa|id_rsa.*|id_dsa|id_dsa.*|id_ecdsa|id_ecdsa.*|id_ed25519|id_ed25519.*|*.ppk|*.jks|*.keystore|keystore.properties)
      report_path_violation "Refusing tracked key/credential artifact" "${tracked}" "${sensitive_path}"
      ;;
  esac

  case "${tracked_lower}" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.bmp|*.tif|*.tiff|*.ico|*.mp4|*.webm|*.mov|*.mkv|*.avi|*.m4v)
      printf '%s\n' "${tracked}" >> "${binary_paths_temp}"
      ;;
  esac
done < "${snapshot_records_temp}"

run_worktree_file_scan() {
  local matcher="$1"
  local matcher_arg="$2"
  local scan_path
  local rc
  while IFS= read -r -d '' scan_path; do
    if [[ "${matcher}" == "regex" && "${scan_path}" == "scripts/check-public-boundary.sh" ]]; then
      continue
    fi
    if [[ ! -f "${scan_path}" || -L "${scan_path}" ]]; then
      echo "A worktree path changed or became non-regular during content scanning; failing closed." >&2
      failed=1
      return 2
    fi
    case "${matcher}" in
      regex)
        if grep_file_regex "${scan_path}" "${matcher_arg}"; then rc=0; else rc=$?; fi
        ;;
      fixed)
        if grep_file_fixed_patterns "${scan_path}" "${matcher_arg}"; then rc=0; else rc=$?; fi
        ;;
      *) return 2 ;;
    esac
    case "${rc}" in
      0) return 0 ;;
      1) ;;
      *) return 2 ;;
    esac
  done < "${snapshot_paths_temp}"
  return 1
}

run_snapshot_grep() {
  local matcher="$1"
  local matcher_arg="$2"
  local rc=0
  : > "${grep_result_temp}"
  if [[ "${mode}" == "worktree" ]]; then
    run_worktree_file_scan "${matcher}" "${matcher_arg}"
    return $?
  fi
  set +e
  case "${mode}:${matcher}" in
    cached:regex)
      git grep --cached -z -a -l -E -e "${matcher_arg}" -- . \
        ':(exclude)scripts/check-public-boundary.sh' > "${grep_result_temp}" 2>/dev/null
      rc=$?
      ;;
    treeish:regex)
      git grep -z -a -l -E -e "${matcher_arg}" "${treeish}" -- . \
        ':(exclude)scripts/check-public-boundary.sh' > "${grep_result_temp}" 2>/dev/null
      rc=$?
      ;;
    cached:fixed)
      git grep --cached -z -a -l -F -f "${matcher_arg}" -- . > "${grep_result_temp}" 2>/dev/null
      rc=$?
      ;;
    treeish:fixed)
      git grep -z -a -l -F -f "${matcher_arg}" "${treeish}" -- . > "${grep_result_temp}" 2>/dev/null
      rc=$?
      ;;
  esac
  set -e
  case "${rc}" in
    0) return 0 ;;
    1) return 1 ;;
    *)
      echo "git grep failed while scanning the exact snapshot; failing closed." >&2
      failed=1
      return 2
      ;;
  esac
}

if run_snapshot_grep regex "${secret_pattern}"; then
  echo "High-confidence secret pattern found in public-candidate content (details withheld)." >&2
  failed=1
elif [[ "$?" -gt 1 ]]; then
  :
fi
if [[ "${private_terms_ready}" == "1" ]]; then
  if run_snapshot_grep fixed "${filtered_terms}"; then
    echo "Owner-private deny term found in public-candidate content (details withheld)." >&2
    failed=1
  elif [[ "$?" -gt 1 ]]; then
    :
  fi
fi

# Scan the exact commit message (if any), an exact annotated-tag object (if
# supplied), and the caller-provided ref label. Nothing from this file is ever
# echoed, even on a match.
: > "${metadata_temp}"
metadata_rc=0
if [[ "${mode}" == "treeish" ]]; then
  object_type="$(git cat-file -t "${treeish}" 2>/dev/null)" || metadata_rc=$?
  if [[ "${metadata_rc}" -eq 0 ]]; then
    case "${object_type}" in
      tag)
        git cat-file tag "${treeish}" >> "${metadata_temp}" || metadata_rc=$?
        if peeled_commit="$(git rev-parse --verify "${treeish}^{commit}" 2>/dev/null)"; then
          git show -s --format=%B "${peeled_commit}" >> "${metadata_temp}" || metadata_rc=$?
        fi
        ;;
      commit)
        git show -s --format=%B "${treeish}" >> "${metadata_temp}" || metadata_rc=$?
        ;;
      tree) ;;
      *) metadata_rc=2 ;;
    esac
  fi
elif git rev-parse --verify HEAD^{commit} >/dev/null 2>&1; then
  git show -s --format=%B HEAD >> "${metadata_temp}" || metadata_rc=$?
fi
if [[ -n "${PRISMOS_SNAPSHOT_REF:-}" ]]; then
  printf '\n%s\n' "${PRISMOS_SNAPSHOT_REF}" >> "${metadata_temp}"
fi
if [[ "${metadata_rc}" -ne 0 ]]; then
  echo "Could not read snapshot commit/tag metadata; failing closed." >&2
  failed=1
else
  if grep_file_regex "${metadata_temp}" "${secret_pattern}"; then
    echo "High-confidence secret pattern found in commit/tag/ref metadata (details withheld)." >&2
    failed=1
  elif [[ "$?" -gt 1 ]]; then
    :
  fi
  if [[ "${private_terms_ready}" == "1" ]]; then
    if grep_file_fixed_patterns "${metadata_temp}" "${filtered_terms}"; then
      echo "Owner-private deny term found in commit/tag/ref metadata (details withheld)." >&2
      failed=1
    elif [[ "$?" -gt 1 ]]; then
      :
    fi
  fi
fi

snapshot_contains_path() {
  local wanted="$1"
  local candidate
  while IFS= read -r -d '' candidate; do
    [[ "${candidate}" == "${wanted}" ]] && return 0
  done < "${snapshot_paths_temp}"
  return 1
}

snapshot_blob_info() {
  local path="$1"
  local record=""
  local record_meta=""
  local stored_path=""
  local stage=""
  SNAPSHOT_BLOB_MODE=""
  SNAPSHOT_BLOB_OID=""

  case "${mode}" in
    cached)
      record="$(git ls-files -s -- "${path}" 2>/dev/null)" || return 1
      [[ -n "${record}" && "${record}" != *$'\n'* && "${record}" == *$'\t'* ]] || return 1
      record_meta="${record%%$'\t'*}"
      stored_path="${record#*$'\t'}"
      read -r SNAPSHOT_BLOB_MODE SNAPSHOT_BLOB_OID stage <<< "${record_meta}"
      [[ "${stage}" == "0" && "${stored_path}" == "${path}" ]] || return 1
      ;;
    worktree)
      snapshot_contains_path "${path}" || return 1
      [[ -f "${path}" && ! -L "${path}" ]] || return 1
      SNAPSHOT_BLOB_MODE="100644"
      [[ -x "${path}" ]] && SNAPSHOT_BLOB_MODE="100755"
      SNAPSHOT_BLOB_OID="$(git hash-object -- "${path}" 2>/dev/null)" || return 1
      ;;
    treeish)
      record="$(git ls-tree "${treeish}" -- "${path}" 2>/dev/null)" || return 1
      [[ -n "${record}" && "${record}" != *$'\n'* && "${record}" == *$'\t'* ]] || return 1
      record_meta="${record%%$'\t'*}"
      stored_path="${record#*$'\t'}"
      read -r SNAPSHOT_BLOB_MODE object_type SNAPSHOT_BLOB_OID <<< "${record_meta}"
      [[ "${object_type}" == "blob" && "${stored_path}" == "${path}" ]] || return 1
      ;;
  esac
  [[ "${SNAPSHOT_BLOB_MODE}" == "100644" || "${SNAPSHOT_BLOB_MODE}" == "100755" ]] || return 1
  [[ "${SNAPSHOT_BLOB_OID}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] || return 1
}

# Every staged/tree raster/video, plus every nonignored worktree candidate,
# must appear exactly once in a reviewed blob manifest. The manifest is strict
# so a malformed line, CRLF conversion, path traversal, symlink, or gitlink
# cannot weaken the coverage check.
media_manifest="docs/PUBLIC_MEDIA_BLOBS"
manifest_read_rc=0
case "${mode}" in
  cached)
    git show ":${media_manifest}" > "${media_manifest_temp}" 2>/dev/null || manifest_read_rc=$?
    ;;
  worktree)
    # Worktree mode is a pre-staging preview, so a new regular manifest may be
    # validated before it is added. Cached/treeish modes still require it in
    # the exact Git snapshot.
    if snapshot_contains_path "${media_manifest}" && [[ -f "${media_manifest}" && ! -L "${media_manifest}" ]]; then
      cp -- "${media_manifest}" "${media_manifest_temp}"
    else
      manifest_read_rc=1
    fi
    ;;
  treeish)
    git show "${treeish}:${media_manifest}" > "${media_manifest_temp}" 2>/dev/null || manifest_read_rc=$?
    ;;
esac
if [[ "${manifest_read_rc}" -ne 0 || ! -s "${media_manifest_temp}" ]]; then
  echo "Reviewed public-media manifest is missing from the exact snapshot." >&2
  failed=1
else
  if grep_file_regex "${media_manifest_temp}" $'\r'; then
    echo "Public-media manifest must use LF line endings (CRLF is rejected)." >&2
    failed=1
  elif [[ "$?" -gt 1 ]]; then
    :
  fi

  while IFS= read -r manifest_line || [[ -n "${manifest_line}" ]]; do
    [[ -z "${manifest_line}" || "${manifest_line}" == \#* ]] && continue
    if [[ ! "${manifest_line}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})\ \ (.+)$ ]]; then
      echo "Invalid public-media manifest entry; expected '<blob-id>  <path>'." >&2
      failed=1
      continue
    fi
    expected_oid="${BASH_REMATCH[1]}"
    media_path="${BASH_REMATCH[2]}"

    path_invalid=0
    case "${media_path}" in
      /*|./*|../*|*/../*|*/..|*/./*|*/.|*//*|*\\*) path_invalid=1 ;;
    esac
    if [[ "${media_path}" == "${media_path# }" && "${media_path}" == "${media_path% }" ]]; then
      :
    else
      path_invalid=1
    fi
    manifest_path_scan_temp="$(mktemp)"
    printf '%s' "${media_path}" > "${manifest_path_scan_temp}"
    if grep_file_regex "${manifest_path_scan_temp}" '[[:cntrl:]]'; then
      path_invalid=1
    elif [[ "$?" -gt 1 ]]; then
      path_invalid=1
    fi
    rm -f -- "${manifest_path_scan_temp}"
    if [[ "${path_invalid}" == "1" ]]; then
      echo "Public-media manifest contains an unsafe path (details withheld)." >&2
      failed=1
      continue
    fi

    media_sensitive=0
    if path_contains_sensitive_text "${media_path}"; then
      media_sensitive=1
    fi
    media_path_lower="$(printf '%s' "${media_path}" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
    case "${media_path_lower}" in
      *.png|*.jpg|*.jpeg|*.gif|*.webp|*.bmp|*.tif|*.tiff|*.ico|*.mp4|*.webm|*.mov|*.mkv|*.avi|*.m4v) ;;
      *)
        report_path_violation "Public-media manifest entry is not a raster/video asset" "${media_path}" "${media_sensitive}"
        continue
        ;;
    esac

    if grep_file_exact_line "${media_paths_temp}" "${media_path}"; then
      report_path_violation "Duplicate public-media manifest path" "${media_path}" "${media_sensitive}"
      continue
    elif [[ "$?" -gt 1 ]]; then
      continue
    fi
    printf '%s\n' "${media_path}" >> "${media_paths_temp}"

    if ! snapshot_blob_info "${media_path}"; then
      report_path_violation "Public-media manifest path is absent or not a regular blob" "${media_path}" "${media_sensitive}"
      continue
    fi
    if [[ "${SNAPSHOT_BLOB_OID}" != "${expected_oid}" ]]; then
      report_path_violation "Public media changed without reviewed manifest update" "${media_path}" "${media_sensitive}"
    fi
  done < "${media_manifest_temp}"

  while IFS= read -r binary_path; do
    [[ -n "${binary_path}" ]] || continue
    if grep_file_exact_line "${media_paths_temp}" "${binary_path}"; then
      :
    elif [[ "$?" -eq 1 ]]; then
      binary_sensitive=0
      if path_contains_sensitive_text "${binary_path}"; then
        binary_sensitive=1
      fi
      report_path_violation "Unreviewed raster/video binary is not in the media manifest" "${binary_path}" "${binary_sensitive}"
    fi
  done < "${binary_paths_temp}"
fi

if [[ "${failed}" -ne 0 ]]; then
  echo "Public-boundary check failed. Remove private material from the exact snapshot; ignore rules do not erase Git history." >&2
  exit 1
fi

echo "Public-boundary check passed for the exact ${mode} snapshot."
