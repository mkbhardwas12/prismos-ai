# PrismOS-AI Skills — Proposed Plugin Standard (Draft v0.1)

> [!WARNING]
> **Design proposal; not implemented or shipped.** PrismOS does not currently
> scan skill folders, inject third-party `SKILL.md` files, execute skill scripts,
> provide a Skill Hub/registry, or expose the CLI described below. The current
> Sandbox Prism is a native action-policy simulator, **not** a Wasmtime/WASM code
> isolation runtime. Script entrypoints must remain disabled until a real,
> separately reviewed isolation and consent boundary exists.

## Why a standard?

PrismOS-AI exposes named workflow roles, with model-backed Planner/Reasoner/Critic
calls running sequentially and other roles remaining deterministic. Users have
many small workflows the core project will never anticipate. This draft explores
how reusable, explicitly approved prompt bundles might represent those workflows.

A future skill would be a folder that PrismOS reads only after explicit install
approval. The folder would describe what the skill does, how the user invokes it,
and what local capabilities it requests. No such loader exists today.

The proposed authoring shape is intentionally small: a Markdown instruction file
and a strict manifest. That shape is illustrative until a parser and consent UI ship.

## Anatomy of a skill

```
my-skill/
├── SKILL.md          # human-readable instructions for both user and model
├── manifest.json     # machine-readable: name, triggers, capabilities, version
├── scripts/          # reserved; execution is disabled until a real isolation runtime ships
│   └── extract.py
└── assets/           # optional — templates, example outputs, schema files
    └── soap-template.md
```

### `manifest.json`

```jsonc
{
  "schema":        "https://prismos.ai/schemas/skill/0.1",
  "name":          "soap-note",
  "version":       "1.2.0",
  "summary":       "Turns a clinical transcript into a SOAP note (subjective, objective, assessment, plan).",
  "author":        "alice@example.com",
  "license":       "MIT",

  // ── When PrismOS should consider activating this skill ───────────────────
  "triggers": {
    "intent_keywords": ["soap note", "clinical note", "encounter summary"],
    "domains":         ["medical"],          // see Domain Detection in PrismOS
    "file_types":      [".txt", ".md", ".docx"]
  },

  // ── What the skill needs ─────────────────────────────────────────────────
  "capabilities": {
    "network":        false,                 // hard default — no internet
    "filesystem":     "read:input,write:output",
    "models":         ["qwen3:4b", "llama3.2"],   // hints for Smart Router
    "timeout_ms":     30000                  // proposed host-enforced request bound
  },

  // ── How it gets run ──────────────────────────────────────────────────────
  "entrypoints": {
    "main":   "scripts/extract.py",          // reserved; current PrismOS must reject it
    "prompt": "SKILL.md"                     // always required
  },

  // ── How PrismOS verifies the bundle ──────────────────────────────────────
  "integrity": {
    "algorithm": "sha256",
    "manifest_hash": "fe3a…b912",
    "signed_by":     "did:key:z6Mk…"        // optional, for marketplace listings
  }
}
```

### `SKILL.md`

In this proposal, `SKILL.md` is both a user-facing description and model-facing
instruction content. It is **not** a PrismOS system prompt and cannot grant tools,
change policy, or override higher-trust instructions.

Conventions:
- Lead with a one-sentence summary that matches `manifest.summary`.
- Use `## When to use` to spell out trigger conditions in plain English.
- Use `## Output format` to constrain what the model returns.
- Use `## Examples` for 1–3 worked examples (input → output).
- Do not define a hidden `## Internal` section. The install preview should make
  every model-facing instruction visible to the user.

## Proposed lifecycle

1. **Install and preview.** The user would choose a folder, see its bounded file
   inventory, declared capabilities, hashes, and signature status, then approve it.
2. **Verification.** PrismOS would parse a strict manifest and verify declared
   hashes/signatures against an explicit trust store.
3. **Activation.** A matching prompt-only skill would be suggested, not silently
   inserted into the system policy.
4. **Prompt use.** Skill instructions would be encoded as lower-trust data below
   PrismOS system policy and activated only for the approved request.
5. **Script entrypoints.** `entrypoints.main` would be rejected in the initial
   implementation. Enabling it requires a real code-isolation runtime, scoped file
   handles, network denial by construction, time/resource bounds, and a separate
   user confirmation.
6. **Local metrics.** If implemented, per-skill latency and feedback would remain
   local and would not imply network telemetry or a public leaderboard.

## Proposed security requirements

The existing native action-policy simulator can classify and record an action
description, but it does not safely execute untrusted code. A future skill system
must not present that simulator as process, WASM, filesystem, or network isolation.

| Concern | How it's handled |
|---|---|
| Untrusted code | Disabled. Do not enable scripts until a reviewed isolation runtime and OS-level boundaries ship. |
| Capability creep | Future manifests must use a deny-by-default, per-skill capability set; declaration alone is not authorization. |
| Filesystem reach | Future code must receive explicit scoped handles after user approval, not raw home-directory paths. |
| Network | Denied by construction in the initial design. A future network-capable skill needs per-origin consent and egress disclosure. |
| Prompt injection | Skill text must be encoded as untrusted data below system policy and unable to authorize tools or new capabilities. |
| Tampering | Future installs must verify bounded file hashes and signatures before activation and after change. |
| Audit | Future installs, activations, grants, and rejections should enter the tamper-evident audit chain without logging sensitive prompt content. |

## Proposed distribution

Possible tiers, listed from most-trusted to least:

1. **Bundled.** Source reviewed in the public repository.
2. **Curated registry.** A future signed index with permanent content hashes; no
   registry endpoint or trust root is shipped today.
3. **Local / sideloaded.** A user-selected folder with a prominent unverified
   badge and an install preview.

No registry or skill-execution service is currently deployed.

## Compatibility with `agentskills.io` / Anthropic Skills

The shapes overlap deliberately:
- `SKILL.md` plays the same role.
- `manifest.json` keys map almost 1:1 to Anthropic skill metadata (`name`, `version`, `summary`, `triggers`).
- Triggers and capability declarations are conceptually similar. Executable
  entrypoints are intentionally unresolved and disabled in this proposal.

If a third-party ecosystem converges on a stable standard, PrismOS could later
adopt a compatibility layer. The proposed `prismos-skill convert` command does
not exist today.

## Open questions

- Versioning + breaking-change policy. Lean towards SemVer + a `compat_min_prismos` field in the manifest.
- Per-skill model defaults versus user override; the manifest shape above is not
  currently consumed by Smart Router.
- Marketplace economics. Out of scope for v0.1.
- Mobile parity (Android build doesn't currently expose `~/PrismosSkills/` paths — likely a content provider).

## Reference implementation roadmap

This draft is not a compatibility contract. Versions below are planning targets,
not release commitments.

| Milestone | Target version |
|---|---|
| Manifest parser + Skill Hub UI (list / enable / disable) | v0.7 |
| `SKILL.md` injection into Orchestrator routing | v0.7 |
| Select and audit a real isolation design; keep `entrypoints.main` disabled until then | uncommitted |
| Curated registry + signature verification | v0.8 |
| `prismos-skill convert` CLI subcommand | v0.9 |

---

*Comments? Open an issue with the `skills-spec` label.*
