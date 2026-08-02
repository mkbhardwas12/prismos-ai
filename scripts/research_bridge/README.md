# PrismOS Research Bridge — DMZ egress sidecar

The **only** thing in the PrismOS world allowed to reach the web. The core never
egresses; this small, standalone, **on-demand** process fetches a page, sanitizes it
to clean text, and drops it + a fetch **receipt** into a local folder that PrismOS
ingests through its normal offline path. So the core stays **provably clean and fast**,
and you get consented research reach.

## Design guarantees

- **Zero performance impact.** Not a daemon — it runs, fetches, and exits. Nothing in
  the background, nothing on PrismOS's hot path. When you're not researching, it isn't
  running at all.
- **Fully isolated.** A single standalone script, stdlib-only (no installs). It edits
  **no** PrismOS app code — purely additive.
- **Off by default.** Refuses to touch the network without `--allow-egress`.

## Threat model & mitigations

| Threat | Mitigation |
|---|---|
| Reach the web without consent | Off by default; `--allow-egress` is the consent gate. |
| **SSRF** (hit LAN / cloud metadata) | Reject any host resolving to private / loopback / link-local / reserved / metadata addresses. |
| **DNS rebinding / TOCTOU** | Resolve once, **pin** the connection to that exact public IP; re-validate **and re-pin** every redirect hop. |
| **MITM** | https cert verified against the hostname (even when pinned to the IP). Plain http refused unless `--allow-http`. |
| Data exfiltration | Only a fixed User-Agent + Accept go out — no cookies, auth, referer, or PII. |
| Other local users read your data | Output dir `0700`, every file `0600`. |
| **Prompt injection** | Content written **fenced** as `trust="untrusted"` (both tags neutralized) + control chars stripped, so a page can't act as instructions. |
| DoS / bombs | Size cap + timeout + bounded redirects; raw capped read (gzip not requested). |

**Residual risk / defense-in-depth:** the checks above are process-level. For high
assurance, also run this script behind an OS/container **egress policy** that blocks all
RFC-1918 / link-local routes, so even a bypass can't reach internal resources.

## Usage

```bash
python3 bridge.py https://example.com/article            # OFF by default → refuses
python3 bridge.py --allow-egress https://<url>           # consent + fetch
python3 bridge.py --allow-egress --ingest https://<url>  # also seed research-* graph nodes
python3 bridge.py --allow-egress --allow-host wikipedia.org https://en.wikipedia.org/...
python3 bridge.py --dry-run https://<url>                # validate only, never fetch
```

Output → `~/Documents/PrismDocs/research/` (`0700`): `<slug>.md` (fenced clean text) +
`<slug>.receipt.json`. PrismOS ingests it via **Settings → Project Knowledge** (scan
that folder), or use `--ingest` to seed `research-*` nodes directly.

## How PrismOS "observes"

Every fetch produces a receipt (`url`, `final_url`, `pinned_ip`, `status`,
`content_sha256`, `ingress_bytes`, `fetched_at`, `robots_respected`). That receipt is
the audit record; the content lands **fenced as untrusted**. Nothing enters the graph
until you scan/ingest it — you're always in the loop.

Remove ingested nodes: `DELETE FROM edges WHERE id LIKE 'research-%'; DELETE FROM nodes WHERE id LIKE 'research-%';`
