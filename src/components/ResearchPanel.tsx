// ResearchPanel — drive the DMZ research bridge and observe every fetch.
//
// The core never egresses. This panel spawns an isolated sidecar that fetches
// pages you explicitly consent to, fences the text as untrusted, and records a
// receipt you can see here. Off by default; nothing is automatic.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  runResearchBridge,
  listResearchReceipts,
  type ResearchReceipt,
} from "../lib/researchBridge";
import {
  generateGroundedDocument,
  FORMAT_LABEL,
  getAutoResearch,
  setAutoResearch,
  type DocFormat,
} from "../lib/researchDoc";
import type { GeneratedAttachment } from "../types";
import "./ResearchPanel.css";

const DOC_FORMATS: DocFormat[] = ["docx", "pdf", "pptx", "xlsx"];

function readSettings(): { model: string; ollamaUrl: string | null; maxTokens: number } {
  try {
    const s = JSON.parse(localStorage.getItem("prismos-settings") || "{}");
    return {
      model: s.defaultModel || "mistral",
      ollamaUrl: s.ollamaUrl || null,
      maxTokens: s.maxTokens || 4096,
    };
  } catch {
    return { model: "mistral", ollamaUrl: null, maxTokens: 4096 };
  }
}

export default function ResearchPanel() {
  const [urlsText, setUrlsText] = useState("");
  const [consent, setConsent] = useState(false);
  const [ingest, setIngest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<ResearchReceipt[]>([]);

  // Grounded document builder
  const [docTopic, setDocTopic] = useState("");
  const [docFormat, setDocFormat] = useState<DocFormat>("docx");
  const [docBusy, setDocBusy] = useState(false);
  const [docPhase, setDocPhase] = useState("");
  const [docError, setDocError] = useState("");
  const [docResult, setDocResult] = useState<GeneratedAttachment | null>(null);
  const [docGrounded, setDocGrounded] = useState(0);
  const [docResearchFirst, setDocResearchFirst] = useState(false);
  const [docFresh, setDocFresh] = useState(0);
  const [autoResearch, setAutoResearchState] = useState(getAutoResearch());

  // Keep-current: refresh topics from the web into the graph
  const [kcTopics, setKcTopics] = useState<string>(() => {
    try {
      return localStorage.getItem("prismos-current-topics") || "";
    } catch {
      return "";
    }
  });
  const [kcBusy, setKcBusy] = useState(false);
  const [kcStatus, setKcStatus] = useState("");

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

  const buildDoc = useCallback(async () => {
    setDocBusy(true);
    setDocError("");
    setDocResult(null);
    setDocPhase("");
    try {
      const s = readSettings();
      const { attachment, grounded, freshSources } = await generateGroundedDocument(docFormat, docTopic.trim(), {
        model: s.model,
        ollamaUrl: s.ollamaUrl,
        maxTokens: s.maxTokens,
        onPhase: setDocPhase,
        researchFirst: docResearchFirst,
      });
      setDocResult(attachment);
      setDocGrounded(grounded);
      setDocFresh(freshSources);
    } catch (e) {
      setDocError(String(e));
    } finally {
      setDocBusy(false);
    }
  }, [docFormat, docTopic, docResearchFirst]);

  const openDoc = useCallback(async () => {
    if (docResult?.path) {
      try {
        await invoke("open_generated_file", { path: docResult.path });
      } catch {
        /* ignore */
      }
    }
  }, [docResult]);

  const refreshCurrent = useCallback(async () => {
    const topics = kcTopics
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 10);
    if (topics.length === 0) return;
    try {
      localStorage.setItem("prismos-current-topics", kcTopics);
    } catch {
      /* ignore */
    }
    setKcBusy(true);
    setKcStatus("");
    let fresh = 0;
    try {
      for (let i = 0; i < topics.length; i++) {
        setKcStatus(`Refreshing "${topics[i]}" (${i + 1}/${topics.length})…`);
        const run = await runResearchBridge([], true, true, topics[i], 4);
        fresh += run.receipts.length;
      }
      setKcStatus(`✅ Refreshed ${topics.length} topic(s) · added newly fetched sources for retrieval.`);
      refresh();
    } catch (e) {
      setKcStatus(`Error: ${String(e)}`);
    } finally {
      setKcBusy(false);
    }
  }, [kcTopics, refresh]);

  return (
    <div className="research-panel">
      <div className="rp-header">
        <h2>🌐 Research Bridge <span className="rp-dmz">DMZ · off by default</span></h2>
        <p className="rp-sub">
          The PrismOS core never touches the web. This runs an <strong>isolated sidecar</strong> for
          URLs you approve or searches covered by your explicit Live knowledge consent. Retrieved
          text is stored <strong>fenced as untrusted</strong>, with a receipt you can audit below.
          SSRF-guarded, IP-pinned, and HTTPS-verified; egress is off unless you enable it.
        </p>
      </div>

      <label className="rp-autotoggle">
        <input
          type="checkbox"
          checked={autoResearch}
          onChange={(e) => {
            setAutoResearch(e.target.checked);
            setAutoResearchState(e.target.checked);
          }}
        />
        <span>
          <strong>🔎 Auto-research in chat</strong> — when a chat question asks for online / latest /
          updated info, automatically search the web (DMZ) and ground the answer in fresh sources,
          in one shot. This is <strong>standing consent to egress</strong> for those questions; off by
          default (otherwise you get the one-click chip).
        </span>
      </label>

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

      <div className="rp-docbuilder">
        <h3>📑 Build a document from your knowledge</h3>
        <p className="rp-sub2">
          Retrieves what's relevant from your knowledge graph (courses, research, projects), grounds
          the model in it, and writes a <strong>real, researched</strong> document — not a template.
        </p>
        <div className="rp-formats">
          {DOC_FORMATS.map((f) => (
            <button
              key={f}
              className={`rp-format ${docFormat === f ? "active" : ""}`}
              onClick={() => setDocFormat(f)}
            >
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
        <input
          className="rp-topic"
          type="text"
          placeholder="What should the document be about? e.g. 'A one-pager on building AI agents' or 'SAP clean-core AI extension checklist'"
          value={docTopic}
          onChange={(e) => setDocTopic(e.target.value)}
        />
        <label className="rp-check" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={docResearchFirst}
            onChange={(e) => setDocResearchFirst(e.target.checked)}
          />
          🔎 Research online first (DMZ) — searches the web for fresh sources and adds them before drafting
          {docResearchFirst && <span className="rp-hint"> · consents to egress</span>}
        </label>
        <div className="rp-actions">
          <button className="rp-btn" disabled={docBusy || docTopic.trim().length < 3} onClick={buildDoc}>
            {docBusy ? "Building…" : `Build ${FORMAT_LABEL[docFormat]}`}
          </button>
          {docBusy && docPhase && <span className="rp-hint">{docPhase}</span>}
          {docResult && (
            <button className="rp-btn rp-ghost" onClick={openDoc}>
              📂 Open {docResult.filename}
            </button>
          )}
        </div>
        {docResult && (
          <div className="rp-doc-done">
            ✅ Saved <strong>{docResult.filename}</strong> to Downloads
            {docFresh > 0 ? ` · ${docFresh} fresh web source${docFresh > 1 ? "s" : ""} researched` : ""}
            {docGrounded > 0 ? ` · grounded in ${docGrounded} knowledge source${docGrounded > 1 ? "s" : ""}` : " · general knowledge (no graph match)"}.
          </div>
        )}
        {docError && <div className="rp-error">{docError}</div>}
      </div>

      <div className="rp-docbuilder">
        <h3>🔄 Keep your knowledge current</h3>
        <p className="rp-sub2">
          Your local model's training is frozen (~mid-2024). Rather than retrain it — slow, costly,
          and it can't keep up — pull <strong>today's</strong> sources on the topics you care about
          into your graph, so answers stay current. Efficient: <strong>retrieval, not retraining</strong>.
        </p>
        <textarea
          className="rp-textarea"
          rows={3}
          placeholder={"Topics to keep current (one per line)\ne.g. latest AI agent frameworks\nSAP Business AI updates"}
          value={kcTopics}
          onChange={(e) => setKcTopics(e.target.value)}
        />
        <div className="rp-actions">
          <button className="rp-btn" disabled={kcBusy || kcTopics.trim().length < 3} onClick={refreshCurrent}>
            {kcBusy ? "Refreshing…" : "Refresh from the web (consent)"}
          </button>
          {kcStatus && <span className="rp-hint">{kcStatus}</span>}
        </div>
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
