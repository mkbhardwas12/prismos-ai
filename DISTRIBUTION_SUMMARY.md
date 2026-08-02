# PrismOS-AI Distribution Status

**Reviewed:** 2026-08-01

**Source version:** 0.5.2

**Status:** Candidate-building infrastructure exists; public distribution is not
approved by this document.

## Current facts

- `.github/workflows/release.yml` is manual (`workflow_dispatch`) and read-only.
- It builds unsigned Windows x64, macOS arm64/x64, and Linux x64 candidates.
- macOS candidates are unnotarized.
- Candidates are retained as workflow artifacts for maintainer testing; the
  workflow does not create, update, or publish a GitHub Release.
- Tags do not trigger the workflow.
- Android and iOS packages are not produced by this workflow and are not current
  prebuilt distribution claims.
- PrismOS has no in-app updater or automatic installation path.
- Current Cargo audit evidence reports zero known vulnerabilities and 19 allowed
  maintenance/unsound warnings; every candidate must rerun and review the audit.
- Test totals are recorded from each candidate run, not frozen in documentation.

## Documentation map

| Document | Purpose |
|---|---|
| [`README.md`](README.md) | Current product and capability boundary |
| [`DOWNLOAD_BUILD_GUIDE.md`](DOWNLOAD_BUILD_GUIDE.md) | Verified installation or source-build guidance |
| [`docs/INSTALLATION.md`](docs/INSTALLATION.md) | Platform installation and local setup |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | Mandatory candidate, security, signing, and publication gates |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Store/distribution reference; publication remains manual |
| [`docs/PRIVATE_KNOWLEDGE_ARCHITECTURE.md`](docs/PRIVATE_KNOWLEDGE_ARCHITECTURE.md) | Public/private source, backup, and restore design |
| [`SECURITY.md`](SECURITY.md) | Security limits, audit status, and reporting |

Mobile/store documents are planning references. Their existence does not establish
that a package, store listing, signing identity, privacy review, or platform test is
complete.

## Candidate workflow

After selecting and reviewing an exact source revision:

```bash
gh workflow run release.yml -f version=vX.Y.Z-rcN --ref REVIEWED_REF
gh run list --workflow release.yml
gh run view RUN_ID
```

The version input labels artifacts only. Workflow success means the configured
build/test/audit steps completed; it does not mean the artifacts are safe to
distribute.

## Required release sequence

1. Review the complete candidate diff and full commit SHA.
2. Stage an explicit allowlist of intended files; never use `git add .` for a
   release change.
3. Inspect `git diff --cached` and the tracked-file inventory for private data.
4. Run current frontend and Rust tests, builds, lint, and dependency audits from
   a clean checkout; record emitted totals and full audit output.
5. Exercise the privacy boundaries and complete a clean-profile Private Vault
   export/restore drill.
6. Dispatch the manual candidate workflow from the reviewed revision.
7. Download candidates, hash them, reproduce where practical, and clean-machine
   test installation, first run, upgrade, and uninstall.
8. Sign final Windows/Linux deliverables according to the approved distribution
   process; sign and notarize macOS deliverables.
9. Independently verify final signatures, notarization, source provenance,
   checksums, SBOM, and package contents after signing.
10. Obtain explicit release-manager and independent-verifier approval.
11. Only then create the final tag and manually create/publish a GitHub Release.

Follow the detailed [Release Checklist](docs/RELEASE_CHECKLIST.md). A tag or CI run
must never bypass these gates.

## Installation trust boundary

Only an independently verified signed/notarized release may be described as a
downloadable installer. Never tell users to bypass SmartScreen, Gatekeeper,
quarantine, or Android unknown-source protection for a candidate.

An approved release must provide:

- the exact source commit;
- SHA-256 digests for final artifacts;
- verifiable platform publisher signatures;
- successful macOS notarization where applicable;
- an SBOM and reviewed release notes;
- tested platform and upgrade/restore scope.

If those are unavailable, users should build from reviewed source.

## Platform scope

| Platform | Automated candidate | Distribution state |
|---|---|---|
| Windows x64 | Yes | Unsigned candidate; sign and test before publication |
| macOS arm64 | Yes | Unsigned/unnotarized candidate; sign, notarize, and test |
| macOS x64 | Yes | Unsigned/unnotarized candidate; sign, notarize, and test |
| Linux x64 | Yes | Unsigned candidate; apply approved package provenance/signing and test |
| Android | No | Developer experiment; separate signed/tested release process required |
| iOS | No | Developer experiment; separate signed/tested release process required |

Do not claim a platform based only on generated configuration or a build guide.

## Public/private release boundary

Release inputs and artifacts must not contain personal prompts, Project Knowledge,
trend data, SQLite files, audit logs, device keys, Private Vaults, flywheel datasets,
adapters, or model weights. Ignore rules are only a guardrail. Review tracked,
staged, generated, and packaged content before every candidate and again before
publication.

Encrypted backup packages are also private and do not belong in the public source
repository or public release assets.

## Stop conditions

Do not publish when any of these is true:

- a test, build, lint, dependency audit, or private-data scan failed;
- the dependency warning set changed without review;
- artifact provenance, signature, notarization, checksum, or SBOM is missing;
- a clean-machine or Private Vault restore drill is incomplete;
- documentation advertises an unavailable feature or untested platform;
- a candidate contains an unreviewed generated file or personal fixture;
- approval comes only from the person who produced the artifacts.

The repository is open source, but distribution trust must be established for each
exact binary release.
