# PrismOS-AI Skills — Plugin Standard (Draft v0.1)

> Status: **draft**. This document proposes the skill/plugin interface for PrismOS-AI. It's intentionally close to the emerging "Anthropic Skills" + agentskills.io conventions so that skills written for PrismOS can later be cross-published with minimal change. Comments and PRs welcome.

## Why a standard?

PrismOS-AI ships with 8 built-in agents. Real users have hundreds of small workflows we will never anticipate — "draft a SOAP note from this transcript", "spot regressions in this CSV", "translate this contract into plain English". Skills are how those workflows ship.

A skill is a folder that PrismOS reads at startup. The folder describes what the skill does, how the user invokes it, what local capabilities it needs, and what it costs to run. The skill itself is a self-contained bundle — no network calls unless explicitly declared and approved.

The standard is intentionally minimal. If you can write a Markdown file and a JSON manifest, you can ship a skill.

## Anatomy of a skill

```
my-skill/
├── SKILL.md          # human-readable instructions for both user and model
├── manifest.json     # machine-readable: name, triggers, capabilities, version
├── scripts/          # optional — Python/Node helpers run inside the Sandbox Prism
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
    "memory_mb":      8,                     // wasmtime memory ceiling
    "fuel":           50000000,              // wasmtime fuel ceiling
    "timeout_ms":     30000
  },

  // ── How it gets run ──────────────────────────────────────────────────────
  "entrypoints": {
    "main":   "scripts/extract.py",          // optional — invoked in sandbox
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

`SKILL.md` is the soul of the skill. It is **both** the user-facing description ("what does this skill do, when do I use it?") and the model-facing system prompt ("how should you behave when this skill is active?"). One file, both audiences.

Conventions:
- Lead with a one-sentence summary that matches `manifest.summary`.
- Use `## When to use` to spell out trigger conditions in plain English.
- Use `## Output format` to constrain what the model returns.
- Use `## Examples` for 1–3 worked examples (input → output).
- Anything below `## Internal` is hidden from the user but still given to the model — useful for guard rails.

## Lifecycle

1. **Discovery.** On launch, PrismOS scans `~/PrismosSkills/` (configurable in Settings) and any folders the user adds via "Install Skill from Folder". Each `manifest.json` is parsed; invalid manifests are listed in the Skill Hub with their parse error.
2. **Verification.** The bundle's manifest hash is checked against `integrity.manifest_hash`. Signature, if present, is verified against the configured trust root.
3. **Activation.** When an incoming intent matches a skill's `triggers`, the Orchestrator agent adds the skill's `SKILL.md` to its routing options and surfaces it to the user as a one-tap suggestion ("This looks like a SOAP-note task — use the `soap-note` skill?").
4. **Execution.** The skill's prompt is fused into the Reasoner agent's context. If `entrypoints.main` is declared, it runs inside a Sandbox Prism with the declared capabilities. Anything outside the declared capabilities is rejected by the existing 3-tier allow-list.
5. **Telemetry.** PrismOS tracks per-skill latency and user satisfaction the same way it tracks model performance today (`model_tracker.rs`). The Skill Hub shows a leaderboard.

## Security model

Skills inherit the existing PrismOS defense-in-depth. There is no new sandbox; we re-use what already runs the 8 built-in agents.

| Concern | How it's handled |
|---|---|
| Untrusted code | Runs inside the existing **Sandbox Prism** (wasmtime 27, per-skill memory + fuel ceilings). |
| Capability creep | The 3-tier allow-list (Safe / Moderate / Restricted) is per-skill, declared in `manifest.capabilities`. Anything not declared is denied. |
| Filesystem reach | Skills get a per-skill scratch dir under `~/PrismosSkills/<name>/work/`. The user must approve any read outside it. |
| Network | Off by default. Skills that need it must declare it and get an explicit "Allow network" toggle from the user. |
| Prompt injection from skill content | Skills can't override system-level prompts; they're prepended below the user's intent, not above PrismOS's own instructions. |
| Tampering | `integrity.manifest_hash` is checked on every load. Mismatch → skill is disabled and surfaced in the audit log. |
| Audit | Skill activations, capability grants, and rejections all enter the tamper-evident **audit chain** (`audit_log.rs`). |

## Distribution

There are three tiers, listed from most-trusted to least:

1. **Bundled with PrismOS.** Skills the project ships. Source lives in `skills/` in this repo. Reviewed in PR.
2. **Curated registry.** A signed JSON index hosted at `https://prismos.ai/skills/index.json`. Each entry has a permanent content-hash. We do not host the bundles themselves — they're fetched from their declared URL and verified.
3. **Local / sideloaded.** User points PrismOS at a folder. No signature required, but PrismOS displays a clear "Unverified skill" badge in the Hub.

There is no central server that mediates skill execution. The registry is a discoverability layer, nothing more.

## Compatibility with `agentskills.io` / Anthropic Skills

The shapes overlap deliberately:
- `SKILL.md` plays the same role.
- `manifest.json` keys map almost 1:1 to Anthropic skill metadata (`name`, `version`, `summary`, `triggers`).
- Triggers, capabilities, and entrypoints are roughly the same idea, with PrismOS adding `memory_mb`/`fuel` for its wasmtime sandbox.

The intent is: if a third-party tooling ecosystem converges on a standard, PrismOS can adopt it with a `compat` flag rather than asking skill authors to rewrite. Until that happens, a **`prismos-skill convert`** CLI subcommand can ingest existing Anthropic-style skill folders.

## Open questions

- Versioning + breaking-change policy. Lean towards SemVer + a `compat_min_prismos` field in the manifest.
- Per-skill model defaults vs. user override — currently `manifest.capabilities.models` is a hint to Smart Router. Should it become a hard requirement when the skill explicitly relies on a vision model?
- Marketplace economics. Out of scope for v0.1.
- Mobile parity (Android build doesn't currently expose `~/PrismosSkills/` paths — likely a content provider).

## Reference implementation roadmap

This spec is the contract; the implementation lands in stages.

| Milestone | Target version |
|---|---|
| Manifest parser + Skill Hub UI (list / enable / disable) | v0.7 |
| `SKILL.md` injection into Orchestrator routing | v0.7 |
| Sandboxed `entrypoints.main` execution | v0.8 |
| Curated registry + signature verification | v0.8 |
| `prismos-skill convert` CLI subcommand | v0.9 |

---

*Comments? Open an issue with the `skills-spec` label.*
