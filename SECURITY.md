# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in PrismOS-AI, please email **via GitHub Issues** with:

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
| 0.3.x   | ⚠️ Limited | 2026-06-30 |

Security updates will be released as patch versions (e.g., 0.2.1).

## Security Features

PrismOS-AI implements defense-in-depth security:

- **WASM Sandboxing** — All agent code runs in isolated containers via wasmtime
- **Cryptographic Signing** — HMAC-SHA256 authentication for all operations
- **Allow-List Enforcement** — Only pre-approved operations execute
- **Auto-Rollback** — Anomalous actions trigger automatic state reversion
- **Audit Trail** — Tamper-proof log of all operations
- **Zero Ambient Authority** — Agents have no default permissions

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full security model.

## Responsible Disclosure

We appreciate responsible disclosure. After confirming a vulnerability:

1. We will work on a fix immediately
2. A security patch will be released
3. A GitHub Security Advisory will be published
4. Credit will be given to the reporter (with permission)

## Privacy & Data

PrismOS-AI is **fully local** — your data never leaves your machine. All inference runs on your device via Ollama. No telemetry is sent to external servers.

---

Thank you for helping keep PrismOS-AI secure! 🔒
