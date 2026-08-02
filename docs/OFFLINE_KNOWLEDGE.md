# Offline knowledge & the network boundary — the honest version

PrismOS is local-first. Its core inference client is locked to a loopback Ollama
endpoint by default, while the Spectrum knowledge graph stays in local app data.
The client policy is enforced in code
(`ollama_bridge::validate_base_url_with_policy`), but Ollama does not provide an
authenticated runtime/zero-egress receipt, so this is not an end-to-end locality
attestation.

This document is the honest, complete picture — including the parts a strict
"zero bytes ever leave the machine" slogan glosses over. The app exposes it at
runtime via the `offline_boundary_report` command (`src-tauri/src/offline_report.rs`).

## Can PrismOS "check all the sources on the internet" to teach itself?

**No — and that is deliberate, not a missing feature.** There is no web crawler,
no web-search, and no scraper in the shipped application. Automatically mining
the open internet would also introduce provenance, prompt-injection, licensing,
SSRF, retention, and personal-data risks. A future Research Mode must therefore
be explicit and query-scoped rather than silently crawling "everything."

### The offline-safe substitute: local-corpus ingestion

Point PrismOS at the documents you *would* have crawled and it ingests them
on-device:

- **Settings → Project Knowledge** runs a human-approved, two-phase scan
  (metadata preview → you approve → indexed). Files are read from local disk,
  likely secrets are redacted, and content is chunked into the Spectrum Graph.
  Nothing is fetched from the network (`project_knowledge.rs` has zero network
  code).
- Put supported UTF-8 text, notes, configuration, and code files in a folder you
  approve, and they become first-class, queryable local knowledge. Project
  Knowledge does not parse PDF or Office files. One-off chat attachments use a
  separate bounded path for DOCX and PPTX. PDF, XLS, and XLSX parsing fail closed
  in this release; convert PDF to UTF-8 text and spreadsheets to CSV/TSV. File indexing itself does not require the network;
  model-assisted answers still use the configured inference endpoint.

So the capability you want ("feed it knowledge and make it great") is real; the
*source* is your local corpus, not the open internet.

## The network boundary, stated truthfully

| Path | Status | Detail |
|---|---|---|
| Reasoning (chat / agents / goal loop) | **Fixed loopback client policy** | The editable management URL is not used for private inference; daemon execution is not attested |
| Document / presentation generation | **Loopback + local file output** | Typed loopback model request → on-device `.docx`/`.pptx` |
| Knowledge graph ingestion | **Local** | Approved local-file scan; **no crawler** |
| Telemetry / analytics / crash reporting | **None** | Not present |
| Email / calendar / finance summaries | **Unavailable in this build** | UI disabled and commands are not registered until private configuration and consent boundaries ship |
| Self-improvement training (flywheel) | **Synthetic smoke only** | The permitted smoke path creates isolated synthetic fixtures and a disposable test artifact; personal-data harvest/full training and promotion are disabled |
| Brain Wrapped export | **Local generation; sharing is egress** | The PNG is deterministic for the same inputs, not unique or an authenticator. Sharing it discloses derived behavioral/profile metadata to the recipient or service |

### Opt-in integrations that *can* reach off-device

Each is off by default or requires an explicit operator action:

- **Ollama model install** → the registry configured for the local Ollama daemon.
  Sends the requested model identifier, not a chat prompt.
- **Browser speech services** → a platform-selected speech provider when browser
  voice input/output is enabled. Its privacy behavior depends on the OS/WebView;
  disable voice input when audio must remain strictly on-device because bundled
  local Whisper transcription is not implemented in this build.
- **Synthetic flywheel smoke-model weights** → Hugging Face or another reviewed
  registry when the tiny test base is not cached. Personal-data harvesting and
  full training remain disabled pending exact dataset review/consent, secret and
  PII handling, a private output destination, and an OS-backed cross-process lock.
- **Brain Wrapped sharing** → generating the image stays local, but uploading,
  messaging, or posting it is an explicit disclosure of derived behavioral
  metadata. Its visual signature is deterministic, not guaranteed unique, and
  cannot authenticate a person or prove the image was not modified.
- **Remote Ollama model management** → the redacted configured origin after
  setting `PRISMOS_ALLOW_REMOTE_OLLAMA=1`. Explicit status/list/pull/delete calls
  require HTTPS for every non-loopback origin and send connection metadata and model identifiers; chat, Project Knowledge,
  document and image prompts remain on fixed loopback inference. Screen capture is not
  available in this build.

## Recommended wording

Prefer: **"Core inference uses a loopback client route by default; optional model
downloads, browser speech, Brain Wrapped sharing, synthetic smoke dependencies,
and remote-model opt-in have separate network boundaries."** Do not claim that
zero bytes leave the machine or that a loopback request attests the model
runtime's behavior.
