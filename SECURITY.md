# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in PrismOS-AI, please report it privately via [GitHub Security Advisories](https://github.com/mkbhardwas12/prismos-ai/security/advisories/new) with:

1. **Description** — What is the vulnerability?
2. **Steps to Reproduce** — How can it be triggered?
3. **Impact** — What systems/data are affected?
4. **Your Name** — For credit (optional)

**Do NOT** open a public GitHub issue for security vulnerabilities.

## Supported Versions

| Version | Status | Support Until |
|---------|--------|-----------------|
| 0.5.x   | ✅ Active | Current |
| 0.4.x   | ⚠️ Limited | 2026-09-30 |
| 0.3.x   | ❌ Unsupported | Ended 2026-06-30 |

Security updates will be released as patch versions (e.g., 0.2.1).

## Security Features

PrismOS-AI uses defense-in-depth controls with explicit limits:

- **Action policy** — Modeled agent actions are classified against per-agent
  allow-lists and anomaly rules. This is not arbitrary-code, WASM, container, or
  operating-system isolation.
- **Authenticated action records** — Process-local HMAC-SHA256 detects changes to
  action-policy records. It is not an external authorization or signing service.
- **Bookkeeping checkpoints** — Policy state can be marked/reverted; PrismOS does
  not claim generic rollback of files, databases, email, or network effects.
- **Audit trail** — A SHA-256 hash chain makes prior audit-line modification
  detectable. It does not prevent deletion and is not a substitute for backup.
- **Encrypted packages** — Portable exports, sync packages, and full private
  vaults use authenticated encryption. The live SQLite database remains plaintext
  at rest to processes/accounts that can read the app-data directory.
- **Private-vault restore** — Full-database backup candidates are validated and staged
  while the app is running, then installed before SQLite opens on restart with rollback
  handling. Complete a clean-profile restore drill before relying on one as recovery media.
- **Guarded project ingestion** — Metadata preview, explicit approval, bounded
  same-file reads, source-scoped refresh/Forget, and likely-secret redaction.
- **Ephemeral attachments** — One-off document chunks are kept in memory for the
  request and are not silently written into the Spectrum Graph.
- **Fixed-loopback model policy** — Private chat, document, vision, and workflow
  inference always targets `http://localhost:11434`. That local HTTP hop is not
  mutually authenticated by PrismOS: a same-account process able to impersonate the
  endpoint could receive prompts. OS-account/process integrity is therefore part of
  the trust boundary, and loopback does not attest what the separately installed
  Ollama daemon does afterward.
- **Separate management policy** — `PRISMOS_ALLOW_REMOTE_OLLAMA=1` can admit a
  configured non-loopback origin for explicit model management/status operations;
  it cannot redirect prompts or retrieved context.

The legacy background watcher/indexer is disabled, and the bundled Whisper prototype
does not provide production transcription. There is no active wasmtime dependency or
in-app auto-updater. Do not run
untrusted binaries, scripts, plugins, or model tools on the assumption that
PrismOS isolates them. See [Private Knowledge Architecture](docs/PRIVATE_KNOWLEDGE_ARCHITECTURE.md)
and [Architecture](docs/ARCHITECTURE.md).

## Dependency Audit Status

Security audits are release inputs, not badges. As of 2026-08-01:

- the production npm audit is clean after updating the affected `lodash-es`;
- the current Cargo audit reports zero known vulnerabilities;
- Cargo reports 19 explicitly reviewed maintenance/unsound warnings in transitive
  dependencies. They remain tracked risk, not proof that the dependency graph is
  safe or permanently accepted;
- every candidate must rerun both audits and compare the complete output with the
  reviewed baseline. A new vulnerability or unexpected warning change is a release
  stop condition until reviewed.

## Responsible Disclosure

We appreciate responsible disclosure. After confirming a vulnerability:

1. We will work on a fix immediately
2. A security patch will be released
3. A GitHub Security Advisory will be published
4. Credit will be given to the reporter (with permission)

## Privacy & Data

PrismOS-AI is local-first, not absolutely offline. The knowledge database stays
in local app data, and private inference is fixed to the loopback Ollama route.
The configured Ollama URL is limited to model management/status even when
`PRISMOS_ALLOW_REMOTE_OLLAMA=1` admits a remote origin. Model downloads, browser
speech services, explicit flywheel weight downloads, and future integrations can
create network egress. Email, calendar, and finance commands are unavailable in
the current build until their private configuration and consent boundaries ship.
PrismOS does not include telemetry or a general web crawler.

Never commit databases, prompts, project excerpts, audit logs, keys, adapters,
or encrypted backup packages to this public repository. If encrypted vaults are
copied to Git for redundancy, use a completely separate private repository,
commit ciphertext only, and keep the passphrase elsewhere.

---

Thank you for helping keep PrismOS-AI secure! 🔒
