# Project Knowledge

Project Knowledge lets PrismOS answer chat questions from approved local codebases and
documentation. It is designed for repeatable source refreshes, traceable answers, and a
clear privacy boundary.

This is distinct from a one-off chat attachment. Supported documents attached to a chat
are extracted, chunked, and retrieved only for that request; their chunks are discarded
afterward and are not added to the Spectrum Graph. A document becomes durable Project
Knowledge only through the preview and **Approve & Index** flow below.

## Add a source

1. Open **Settings → Project Knowledge**.
2. Enter one project directory, or a directory containing several projects.
3. Select **Scan**. This first pass reads filesystem metadata only and shows the bounded
   candidate set.
4. Review the file count, byte count, exclusions, and truncation warning.
5. Select **Approve & Index** to read and index that one-time snapshot.

Each later refresh repeats the metadata preview and approval step. PrismOS never silently
expands an approved root.

## What is indexed

The index accepts common source, documentation, configuration, and manifest text files.
It prioritizes READMEs, manifests, docs, and entrypoints within these default limits:

- 25,000 filesystem entries inspected;
- 2,500 candidate files;
- 64 MiB of candidate text;
- 512 KiB per file;
- 16 directory levels;
- 8,000 stored chunks.

The scanner does not follow symlinks. It excludes common VCS, dependency, build, cache,
and virtual-environment directories. It also excludes `.env` files, credential files,
private-key/certificate stores, binaries, invalid UTF-8, and files over the size limit.
Likely literal passwords, tokens, API keys, and private-key blocks are redacted again
before persistence. These rules reduce accidental exposure; they are not a substitute for
keeping secrets out of source files.

Content indexing currently requires Unix same-handle file identity checks. On Windows,
the metadata preview may run, but approval fails closed until equivalent reparse-point-safe
handle validation is implemented; PrismOS does not fall back to a path-only read.

## Retrieval and citations

Approved files are split into deterministic, source-addressed chunks. Chat retrieval
combines SQLite full-text search with the graph's existing keyword, relationship,
recency, and optional local-embedding signals. Recent persisted conversation turns are
also supplied for continuity.

Retrieved text is placed inside an explicit untrusted-reference boundary. The Reasoner is
instructed to ignore instructions found inside project files, avoid unsupported claims,
and cite relevant `Source` paths in its answer. Citations are model-generated pointers,
so verify important answers against the named file.

## Refresh and deletion behavior

Chunk IDs are stable across refreshes. Unchanged chunks retain their embeddings, changed
chunks invalidate stale embeddings, and chunks no longer present in the approved source
snapshot are deleted atomically. This prevents old source text from continuing to answer
queries after a file changes or disappears.

**Forget** removes only PrismOS-owned nodes for the selected source. It requires a second
confirmation and never writes to or deletes the original project directory.

Graph backup, You-Port state, and cross-device sync packages intentionally omit indexed
project excerpts and source approvals. This prevents a restore from creating unowned
copies that cannot be refreshed or forgotten reliably. Re-approve and index each local
root after a restore or on another device.

## Storage and network boundary

Project excerpts are stored in the local Spectrum Graph SQLite database. On Unix-like
systems PrismOS restricts the app-data directory and database to the current OS account,
but the graph is **not encrypted at rest**. You-Port export packages use AES-256-GCM.

Private project inference is fixed to Ollama at `http://localhost:11434`; prompts and
retrieved project excerpts are never routed to the configurable management endpoint.
`PRISMOS_ALLOW_REMOTE_OLLAMA=1` can admit a non-loopback URL only for explicit model
management and status operations. It does not opt chat into remote inference. Model
downloads and browser-provided speech services can use the network when invoked. Email,
calendar, and finance commands are unavailable.

## Current orchestration scope

The shipped chat path performs retrieval and a bounded sequential
plan/build/judge/optional-refine loop through local model inference. Planner and Critic
may select a different installed model from the Reasoner, but calls are awaited one at a
time. Tool/memory checks, Sentinel review, collaboration-role messages, debate, and vote
records remain deterministic policy or bookkeeping outputs; they are not independent
models running in parallel.

This is not a Codex-style autonomous plan/tool/observe loop: chat does not gain arbitrary
filesystem, shell, network, or code-execution authority from an indexed source. See
[LOCAL_LOOP_ENGINE.md](LOCAL_LOOP_ENGINE.md) for the implemented bounds and stopping
rules.
