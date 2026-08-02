# PrismOS-AI Release Checklist

This checklist describes the current desktop release process. It does not imply
that a release exists, that candidate artifacts are signed, or that CI publishes
anything.

## Current automation boundary

`.github/workflows/release.yml` is a manually dispatched candidate builder.

- It has read-only repository permissions.
- It does not run on tags.
- It does not create, update, draft, or publish a GitHub Release.
- It produces unsigned Windows, macOS, and Linux candidate artifacts with short
  retention.
- Its macOS candidates are not notarized.
- It does not build Android or iOS packages.
- PrismOS has no in-app updater or automatic installation path.

Every candidate remains untrusted until the independent signing, notarization,
provenance, testing, and approval gates below are complete.

## 1. Freeze and identify the candidate

- [ ] Select the exact reviewed commit; record its full SHA.
- [ ] Confirm the worktree contains no accidental local or private files.
- [ ] Review the complete diff from the previous release.
- [ ] Update `CHANGELOG.md` with only verified changes.
- [ ] Align the version in:
  - [ ] `package.json`
  - [ ] `src-tauri/Cargo.toml`
  - [ ] `src-tauri/tauri.conf.json`
- [ ] Update mobile version metadata only if a separately approved mobile release
  is actually in scope.
- [ ] Confirm README, security, installation, deployment, privacy, and recovery
  documentation describe the candidate rather than a roadmap.
- [ ] Confirm generated screenshots and videos do not contain personal data.

Do not use `git add .` as a release shortcut. Review and stage intended paths
explicitly.

## 2. Run the current full gates

Run these commands from a clean checkout with the locked dependency files. Do not
copy a test count from this document: record the totals emitted by the current
suites and the commit on which they ran.

```bash
npm ci
npm exec tsc -- --noEmit
npm test -- --run
npm run build
npm audit --audit-level=high

cd src-tauri
cargo check --locked --all-targets
cargo test --locked --lib
cargo clippy --locked --all-targets
cargo audit --file Cargo.lock
```

- [ ] TypeScript check passed.
- [ ] Frontend tests passed; current total recorded in release evidence.
- [ ] Frontend production build passed.
- [ ] npm audit passed at the release threshold; full output archived.
- [ ] Rust check passed for all targets available in the gate environment.
- [ ] Rust library tests passed; current total recorded in release evidence.
- [ ] Clippy completed; every warning was reviewed and no new release-blocking
  warning was accepted silently.
- [ ] Cargo audit reported zero known vulnerabilities; full output archived.
- [ ] Allowed maintenance/unsound warnings were compared with the reviewed
  baseline and have owners or documented rationale.
- [ ] `git diff --check` passed.

Audit snapshot as of 2026-08-01: Cargo reports **zero known vulnerabilities** and
**19 reviewed maintenance/unsound warnings**. The automated gate compares the
advisory IDs, classes, packages, and versions with the checked-in baseline. This
dated snapshot is not a waiver or future result; any vulnerability or unexpected
warning-set change is a stop condition until reviewed.

## 3. Exercise privacy and recovery gates

- [ ] Scan tracked files, staged files, generated packages, logs, screenshots,
  and fixtures for credentials, personal paths, project excerpts, prompts,
  databases, keys, audit logs, adapters, and backups.
- [ ] Confirm the public repository contains no `*.db`, SQLite sidecar,
  `*.prismos-vault`, device key, flywheel dataset, adapter, or model weight.
- [ ] Verify Project Knowledge requires preview and approval, rejects changed
  candidates, and Forget remains source-scoped.
- [ ] Verify portable graph and sync packages exclude managed project excerpts.
- [ ] Create a Private Vault through Settings to a new non-Git destination.
- [ ] Restore that vault into a clean disposable profile through the staged
  restart path.
- [ ] Verify representative conversations, knowledge sources, learned state,
  and the audit chain after restore.
- [ ] Verify a failed or interrupted restore fails closed and preserves or
  recovers the prior profile as designed.
- [ ] Confirm the passphrase never appears in UI persistence, logs, audit detail,
  process arguments, screenshots, or release evidence.

A unit-test round trip does not replace the clean-profile restore drill.

## 4. Build unpublished candidate artifacts

After reviewing the workflow revision, dispatch it manually from the selected
commit or branch:

```bash
gh workflow run release.yml -f version=vX.Y.Z-rcN --ref REVIEWED_REF
gh run list --workflow release.yml
gh run view RUN_ID
```

- [ ] Confirm the run used the intended full commit SHA.
- [ ] Confirm preflight gates passed without hidden retries or waivers.
- [ ] Download the Windows x64, macOS arm64/x64, and Linux x64 candidates.
- [ ] Confirm artifact names include `UNSIGNED`.
- [ ] Record each candidate's SHA-256 digest immediately after download.
- [ ] Preserve workflow logs and dependency-audit output with the candidate
  evidence.

Workflow artifacts are build inputs, not release assets.

## 5. Reproduce and clean-machine test

- [ ] Reproduce each platform build from the selected source revision in a
  controlled environment.
- [ ] Compare outputs or document every expected non-reproducible field.
- [ ] Install, launch, use, upgrade, and uninstall on clean supported systems.
- [ ] Test both first-run and existing-profile behavior.
- [ ] Confirm core inference is fixed to loopback and no public-network Ollama
  rule is required.
- [ ] Test the bounded sequential plan/build/judge/refine path.
- [ ] Test document and vision paths with non-sensitive fixtures.
- [ ] Test manual model download/delete management separately from private
  inference.
- [ ] Test global shortcut and tray behavior with ordinary user privileges.
- [ ] Confirm Email, Calendar, Finance, general web research, arbitrary plugin
  execution, automatic training, and auto-update are not advertised as shipped
  when unavailable.

Record the exact OS versions and hardware used. Do not claim an untested platform.

## 6. Sign, notarize, and independently verify

- [ ] Sign Windows deliverables with the approved publisher identity.
- [ ] Verify Windows signatures on a separate clean machine.
- [ ] Sign macOS application bundles and disk images with the approved identity.
- [ ] Submit macOS artifacts for notarization, wait for success, and staple the
  accepted ticket where applicable.
- [ ] Verify macOS signature, hardened-runtime/notarization status, and Gatekeeper
  assessment on the final downloaded artifact.
- [ ] Apply the approved Linux package-signing/provenance process for each
  distribution channel.
- [ ] Recompute SHA-256 digests after signing/notarization.
- [ ] Generate and review an SBOM for the final artifacts.
- [ ] Have someone other than the builder verify source revision, signatures,
  notarization, checksums, SBOM, and package contents.

Never instruct users to bypass SmartScreen, Gatekeeper, quarantine, or Android
unknown-source protection for an unsigned candidate.

## 7. Approve and publish manually

Only after every prior gate passes:

- [ ] Record release-manager and independent-verifier approval.
- [ ] Create and push the final tag from the reviewed commit. Remember: the tag
  does not trigger the candidate workflow.
- [ ] Create the GitHub Release manually.
- [ ] Upload only the final signed/notarized/tested artifacts, final checksums,
  SBOM, and accurate release notes.
- [ ] Describe optional network boundaries and the plaintext live SQLite store.
- [ ] State the exact tested platforms; omit unsupported mobile packages.
- [ ] Verify every uploaded asset by downloading it again and checking digest,
  signature, notarization, and package contents.
- [ ] Publish only after this second verification.

Do not click **Publish release** merely because GitHub Actions succeeded.

## 8. Post-release checks

- [ ] Install the downloaded public assets once more on clean systems.
- [ ] Test the documented manual upgrade from the previous approved release.
- [ ] Confirm the displayed version and release notes match the binaries.
- [ ] Confirm no updater check or update manifest was introduced.
- [ ] Monitor private security reports and public issue reports.
- [ ] Preserve release evidence according to the project retention policy.
- [ ] If an issue is discovered, stop distribution, mark the release appropriately,
  and point users to the last independently verified release.

## Hotfix and rollback

A hotfix repeats every applicable gate. Urgency does not authorize skipping
dependency audits, private-data review, clean-profile vault restore, signing,
notarization, or independent verification.

If a published release is unsafe:

- [ ] Mark it as a pre-release or remove it from “Latest” as appropriate.
- [ ] Add a clear warning without publishing exploit details prematurely.
- [ ] Restore the previous independently verified release as the recommended
  version.
- [ ] Pause any separately managed store rollout.
- [ ] Prepare a tested hotfix and publish a post-incident report.

## Sign-off

```text
Version:
Commit SHA:
Candidate workflow run:
Frontend test total/result:
Rust test total/result:
npm audit result:
Cargo audit vulnerabilities/warnings:
Private Vault drill result:
Clean-machine matrix:
Signing/notarization evidence:
Checksum/SBOM evidence:
Release manager:
Independent verifier:
Decision: PASS / FAIL
Date:
```
