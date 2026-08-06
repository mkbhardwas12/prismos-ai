// ChatResearchChip — a one-click, EXPLICITLY-CONSENTED research affordance for chat.
//
// Two triggers, both requiring a click (the click IS the consent; nothing is ever
// fetched automatically, and the PrismOS core never egresses):
//   • links in your message      → "Fetch & add" those pages
//   • a research request (no URL) → "Research online" (search the web for fresh sources)
// Fetched content lands fenced-as-untrusted in your graph, so the NEXT answer is grounded.
// Renders nothing otherwise.

import { useMemo, useState } from "react";
import { runResearchBridge } from "../lib/researchBridge";
import { isResearchRequest } from "../lib/researchDoc";
import "./ChatResearchChip.css";

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

export default function ChatResearchChip({ text }: { text: string }) {
  const urls = useMemo(() => {
    const found = (text.match(URL_RE) || []).map((u) => u.replace(/[.,)\]]+$/, ""));
    return Array.from(new Set(found)).slice(0, 12);
  }, [text]);

  const isResearch = useMemo(
    () => urls.length === 0 && isResearchRequest(text),
    [text, urls],
  );

  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  if (urls.length === 0 && !isResearch) return null;

  const run = async () => {
    setStatus("busy");
    setMsg("");
    try {
      const result =
        urls.length > 0
          ? // fetch the explicit links (click = consent)
            await runResearchBridge(urls, true, true)
          : // search the web for the request (click = consent)
            await runResearchBridge([], true, true, text.trim(), 6);
      const added = result.receipts.length;
      setStatus("done");
      setMsg(
        urls.length > 0
          ? `Fetched & added ${urls.length} link${urls.length > 1 ? "s" : ""}. Ask again for a grounded answer, or build a doc in the Research panel.`
          : `Searched the web and added ${added} fresh source${added === 1 ? "" : "s"} to your knowledge. Ask again and I'll answer with them — or open Research to build a doc.`,
      );
    } catch (e) {
      setStatus("error");
      setMsg(String(e));
    }
  };

  const label =
    status === "busy"
      ? urls.length > 0
        ? "Fetching…"
        : "Researching…"
      : urls.length > 0
        ? "Fetch & add (consent)"
        : "Research online (consent)";

  return (
    <div className={`chat-research-chip ${status}`}>
      <span className="crc-icon" aria-hidden="true">🌐</span>
      <span className="crc-text">
        {urls.length > 0
          ? `${urls.length} link${urls.length > 1 ? "s" : ""} detected — the core won't fetch automatically.`
          : "Looks like a research request — search the web for fresh sources? The core won't fetch automatically."}
      </span>
      {status !== "done" && (
        <button className="crc-btn" disabled={status === "busy"} onClick={run}>
          {label}
        </button>
      )}
      {msg && <span className="crc-msg">{msg}</span>}
    </div>
  );
}
