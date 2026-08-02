# PrismOS-AI — verified launch-copy template

> Do not publish this template until the referenced build has passed the current
> release checklist and its artifact digest, signature, and publisher identity
> have been independently verified.

PrismOS-AI is an open-source, local-first desktop assistant built with Rust,
Tauri, React, SQLite, and Ollama.

Its private inference client is fixed to loopback. You can explicitly approve a
project directory for bounded local indexing, then ask grounded questions with
source citations. A passphrase-encrypted Private Vault can capture the complete
local database as a recovery candidate; complete a clean-profile restore drill
before relying on it. The public repository contains architecture and code, not
your personal knowledge.

For harder questions, PrismOS can run a bounded sequential workflow: plan,
build, judge, and optionally refine. Those are ordered model calls plus
deterministic policy/memory traces—not eight autonomous agents or a parallel
debate council. Hidden model reasoning is discarded; the UI exposes useful
rationale, criteria, limits, and citations instead.

Current safety boundaries are explicit:

- no general web crawler or autonomous internet research;
- no WASM/OS execution sandbox or generic rollback;
- no automatic model training or promotion;
- full personal-data training is disabled; only synthetic smoke validation is available;
- browser speech, model downloads, explicit Brain Wrapped sharing, and enabled
  remote model-management operations may use the network;
- release workflow output is a manual candidate until signing/notarization and
  publisher verification are independently completed.

Source: <https://github.com/mkbhardwas12/prismos-ai>

Before posting, replace this footer with the exact tested version, commit,
platform matrix, audit date, and verified artifact links. Do not use absolute
claims such as “zero egress,” “tamper-proof,” or “mathematically unique.”
