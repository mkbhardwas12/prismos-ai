# Platform launch-copy guide

Use the verified facts in [`../LAUNCH_POST.md`](../LAUNCH_POST.md) as the single
source of truth. Tailor tone and length per platform, but do not change the
architecture or privacy claims.

## Required pre-publication fields

- exact version and commit;
- tested operating systems and hardware;
- current test/audit results and date;
- direct artifact digest plus verified signature/publisher identity;
- whether the artifact is signed and notarized;
- links to the current security, private-knowledge, and release documentation.

## Short form

> PrismOS-AI is an open-source, local-first desktop assistant with approval-gated
> project knowledge, source-grounded chat, a passphrase-encrypted private vault,
> and a bounded sequential plan → build → judge → refine workflow over local
> Ollama. Public code stays public; personal knowledge stays on your device.
> Review the documented network and release boundaries before installing.

## Technical form

> Built with Rust, Tauri, React, SQLite, and Ollama. Private prompts use a fixed
> loopback client route. Project ingestion is metadata-previewed and explicitly
> approved, retrieval returns citations, portable graph formats omit managed
> project excerpts, and full-database recovery tooling uses an encrypted Private
> Vault that must pass a clean-profile restore drill before reliance.
> Workflow role labels describe ordered model calls and deterministic traces—not
> a parallel multi-agent council. Full personal-data training is disabled.

## Claims that must not be published

- “eight agents debate,” “formal multi-agent consensus,” or similar;
- “WASM sandbox,” “isolated code execution,” or “automatic rollback”;
- “zero bytes leave,” “fully offline” without the documented exceptions;
- “tamper-proof,” “cryptographically verified model,” or “hardware enclave”;
- “mathematically unique” or “anonymous” Brain Wrapped signatures;
- prebuilt, signed, notarized, or auto-updating artifacts without current proof;
- autonomous web research, autonomous training, or automatic model promotion.

Brain Wrapped sharing is an explicit egress action: the selected native share
target or X composer can receive a PNG plus derived, linkable behavioral-profile
text. It does not send raw chat text, but it is not anonymous.
