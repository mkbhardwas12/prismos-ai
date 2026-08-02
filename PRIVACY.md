# PrismOS-AI Privacy Notice

Effective: August 1, 2026  
Applies to: the first-party PrismOS-AI v0.5.2 source tree in this repository

PrismOS-AI is an open-source, local-first desktop assistant with bounded sequential
workflows. This notice describes the behavior of the source in this repository. It does
not certify an unsigned build, a third-party fork, a mobile planning target, a separately
installed model server, or a distribution platform. Review the exact artifact and its
configuration before using it with sensitive data.

## No PrismOS-operated cloud account or telemetry

The first-party application source does not include a PrismOS account service,
advertising SDK, analytics SDK, or application telemetry endpoint. The maintainers do not
receive prompts, graph data, or project files merely because the application is running.

Data can still leave the machine through the explicit or provider-controlled boundaries
listed below. Operating systems, app stores, GitHub, Ollama, browser/WebView providers,
model registries, and user-enabled integrations operate under their own terms and privacy
practices.

## Data stored by the application

Depending on the features used, PrismOS can store the following in its local app-data
directory:

- conversation prompts, responses, feedback, and workflow traces;
- Spectrum Graph nodes, edges, profiles, retrieval data, and model statistics;
- approved Project Knowledge source metadata and copied source excerpts;
- audit records and application-owned learned state; and
- user-interface settings in local WebView storage.

The live SQLite database is restricted with account-level filesystem permissions where
supported, but PrismOS does **not** encrypt that live database at rest. Other software or
accounts that can read the app-data directory can read its contents. Use full-disk
encryption, a protected operating-system account, and appropriate device controls.

### Project Knowledge

Project Knowledge performs a metadata preview before approval. After approval, it reads a
bounded set of allowlisted files, copies source-tagged chunks into the local SQLite graph,
and can later send retrieved excerpts to the fixed-loopback Ollama endpoint as prompt
context. Source files are not modified.

Sensitive-name filtering and literal-credential redaction are heuristic, best-effort
controls. They cannot guarantee that every secret, personal datum, regulated value, or
confidential passage is detected. Review the candidate paths and approve only a suitably
narrow project root. The **Forget** action removes PrismOS-owned chunks for that source; it
does not delete or edit the original project.

### One-off attachments and generated files

Supported one-off document and image attachments are held for the request and are not
automatically promoted into Project Knowledge. The extracted content is sent to the
fixed-loopback inference route. Generated documents and project-review reports are local
files. They remain private only while their destination and any later sharing are private.

## Network boundaries

### Fixed-loopback private inference

Chat, retrieved Project Knowledge, document, image, and workflow inference use a client
route fixed to `http://localhost:11434`. The application rejects proxies and redirects for
that route. The editable Ollama URL does not reroute private prompts.

Loopback is a transport restriction, not end-to-end attestation. PrismOS does not mutually
authenticate the separately installed Ollama daemon, prove which model bytes it loaded,
prove where it executes, or prevent that daemon from making its own network requests. A
same-account process that can impersonate the endpoint could receive prompts. Local
process and operating-system account integrity are part of the trust boundary.

### Operations that can use the network

- **Model management and downloads.** Listing, pulling, deleting, or checking models can
  contact Ollama or a model registry. A non-loopback management origin requires the
  documented environment opt-in and HTTPS. Management requests can reveal connection
  metadata and model identifiers, but the application does not send private inference
  prompts to that configurable origin.
- **Browser/WebView speech.** Speech recognition and text-to-speech availability and
  network behavior depend on the platform provider. Bundled Whisper transcription is not
  available in this source tree.
- **Explicit sharing.** Sharing a Brain Wrapped image or another generated artifact sends
  the selected content to the destination chosen by the user. A Brain Wrapped image can
  disclose derived, linkable interaction-profile information even though it omits raw chat
  text.
- **Synthetic flywheel setup.** Synthetic-only smoke validation can acquire public base
  model weights from a configured provider. Personal-data training and automatic model
  promotion are disabled.
- **External links and distribution services.** Opening links, reporting an issue,
  downloading a release, or using an app store can disclose data to the selected service.

The current source does not provide a general web crawler or autonomous internet research.
Email, calendar, and finance integrations are unavailable until their private
configuration and consent boundaries are implemented.

## Backups, exports, and Git

PrismOS provides different encrypted package scopes:

- device-bound graph export and passphrase sync packages omit managed Project Knowledge
  excerpts; and
- a Private Vault captures the complete SQLite database and the bounded audit log when
  present, then encrypts the package with a user passphrase.

Private Vault export refuses a destination inside a Git worktree. A vault is a recovery
candidate, not a proven backup until it has been restored into a clean profile and the
important data has been inspected. Keep independent encrypted copies and keep the
passphrase separate from every vault.

Never commit prompts, project excerpts, databases, audit logs, private keys, model
adapters, or backup packages to this public repository. Ignore rules and release checks are
guardrails, not access control. If encrypted ciphertext is deliberately copied to Git for
redundancy, use a separate private repository and understand that Git still exposes
filenames, timestamps, repository membership, and durable history.

See [Private Knowledge Architecture](docs/PRIVATE_KNOWLEDGE_ARCHITECTURE.md) for the
backup, restore, and public/private source boundary.

## Retention and deletion

Local application data remains until the user forgets a Project Knowledge source, uses
the application's clear-data controls, or removes the corresponding app-data files.
**Clear All Data** removes PrismOS-managed graph and learned state, but it cannot delete:

- original project folders or attachments outside app data;
- Ollama models or records maintained by the separately installed daemon;
- encrypted exports or vaults saved elsewhere;
- copies already shared with another person or service; or
- records held by an operating system, browser provider, app store, GitHub, or other
  third party.

Back up anything needed for recovery before deletion, and verify the backup with a restore
drill.

## Security and incident reports

The security model and known limitations are documented in [SECURITY.md](SECURITY.md).
Report a suspected vulnerability through the private reporting path described there. Do
not place personal data, credentials, private project excerpts, or an exploit containing
real secrets in a public issue.

## Voluntary communications

If a user opens a GitHub issue, discussion, or pull request, GitHub processes the account
and content under GitHub's policies, and the submitted content may be public. Share only
the minimum reproducible information and remove private data first.

## Children, regulated use, and platform declarations

PrismOS-AI is not designed specifically for children. This notice does not establish
compliance for health, financial, education, employment, biometric, or other regulated
uses. App-store privacy labels and platform permission declarations must be completed from
the exact tested artifact and every bundled provider; local-first architecture alone is
not sufficient evidence for a blanket “no data collected” declaration.

## Changes

Privacy behavior can change when features, providers, or platform targets change. Material
changes should update this notice and the release documentation. The Git history records
the applicable revision.

Questions about the public source can be opened at
[GitHub Issues](https://github.com/mkbhardwas12/prismos-ai/issues) without including
private data. Security reports should use the private path in [SECURITY.md](SECURITY.md).
