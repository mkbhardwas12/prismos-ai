// ResearchPanel — drive the DMZ research bridge and observe every fetch.
//
// The core never egresses. This panel spawns an isolated sidecar that fetches
// pages you explicitly consent to, fences the text as untrusted, and records a
// receipt you can see here. Off by default; nothing is automatic.

import { useCallback, useEffect, useState } from "react";
import {
  runResearchBridge,
  listResearchReceipts,
  type ResearchReceipt,
} from "../lib/researchBridge";
import "./ResearchPanel.css";

export default function ResearchPanel() {
  const [urlsText, setUrlsText] = useState("");
  const [consent, setConsent] = useState(false);
  const [ingest, setIngest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<ResearchReceipt[]>([]);

  const refresh = useCallback(async () => {
    try {
      setReceipts(await listResearchReceipts());
    } catch {
      /* panel still works without prior receipts */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const urls = urlsText
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  const validCount = urls.filter((u) => /^https?:\/\//i.test(u)).length;
  const canRun = consent && validCount > 0 && validCount <= 12 && !busy;

  const research = useCallback(async () => {
    setBusy(true);
    setError("");
    setLog("");
    try {
      const run = await runResearchBridge(urls, consent, ingest);
      setLog(run.log);
      setReceipts(run.receipts);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [urls, consent, ingest]);

  return (
    <div className="research-panel">
      <div className="rp-header">
        <h2>🌐 Research Bridge <span className="rp-dmz">DMZ · off by default</span></h2>
        <p className="rp-sub">
          The PrismOS core never touches the web. This runs an <strong>isolated sidecar</strong> that
          fetches only the pages you paste and explicitly consent to — the text is stored{" "}
          <strong>fenced as untrusted</strong>, with a receipt you can audit below. SSRF-guarded,
          IP-pinned, https-verified. Nothing is automatic.
        </p>
      </div>

      <div className="rp-form">
        <label className="rp-label">URLs to research (one per line, max 12)</label>
        <textarea
          className="rp-textarea"
          rows={4}
          placeholder="https://example.com/article&#10;https://en.wikipedia.org/wiki/…"
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
        />
        <div className="rp-row">
          <label className="rp-check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I consent to fetch these URLs over the web (egress)
          </label>
          <label className="rp-check">
            <input type="checkbox" checked={ingest} onChange={(e) => setIngest(e.target.checked)} />
            Add results to my knowledge graph
          </label>
        </div>
        <div className="rp-actions">
          <button className="rp-btn" disabled={!canRun} onClick={research}>
            {busy ? "Researching…" : `Research ${validCount || ""} URL${validCount === 1 ? "" : "s"}`}
          </button>
          <button className="rp-btn rp-ghost" onClick={refresh} disabled={busy}>↻ Refresh receipts</button>
          {!consent && validCount > 0 && (
            <span className="rp-hint">tick consent to enable</span>
          )}
        </div>
        {error && <div className="rp-error">{error}</div>}
        {log && <pre className="rp-log">{log}</pre>}
      </div>

      <div className="rp-receipts">
        <h3>Fetch receipts <span className="rp-count">{receipts.length}</span></h3>
        {receipts.length === 0 ? (
          <p className="rp-empty">No fetches yet. Everything here is local; nothing has left the machine.</p>
        ) : (
          <table className="rp-table">
            <thead>
              <tr><th>Source</th><th>Status</th><th>Pinned IP</th><th>Bytes</th><th>When</th><th>sha256</th></tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.content_sha256}>
                  <td title={r.final_url}>
                    <div className="rp-title">{r.title || r.host}</div>
                    <div className="rp-url">{r.host}</div>
                  </td>
                  <td>{r.status}</td>
                  <td className="rp-mono">{r.pinned_ip || "—"}</td>
                  <td>{r.ingress_bytes}</td>
                  <td>{r.fetched_at?.slice(0, 19).replace("T", " ")}</td>
                  <td className="rp-mono" title={r.content_sha256}>{r.content_sha256?.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
