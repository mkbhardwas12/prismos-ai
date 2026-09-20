import { invoke } from "@tauri-apps/api/core";
import type { SpectrumNode } from "../types";

const STOP = new Set("create make generate build write draft prepare produce design give powerpoint presentation slides slide deck document report word executive please about with from this that using into based attached file".split(" "));

export function artifactKeywords(input: string): string[] {
  return [...new Set(input.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.-]{2,}/gu) ?? [])]
    .filter((word) => !STOP.has(word)).slice(0, 6);
}

/** Retrieve bounded, local evidence; neither indexing nor networking is started here. */
export async function collectArtifactContext(input: string, recent = "", documentText?: string): Promise<string> {
  const blocks: string[] = [];
  if (recent) blocks.push(`RECENT CONVERSATION — user requirements and prior drafts, not independently verified facts:\n${recent.slice(-2000)}`);
  if (documentText) {
    const source = documentText.match(/\[(?:Document|File):\s*(.*?)\]/)?.[1] || "attached document";
    const raw = await invoke<string>("rag_query", { documentText, query: input, source });
    const rag = JSON.parse(raw) as { context?: unknown };
    if (typeof rag.context !== "string" || !rag.context.trim()) throw new Error("The attached document did not yield usable source text. Please check the attachment.");
    blocks.push(`[A1] User attachment: ${source}\n${rag.context.slice(0, 14000)}`);
  }
  const results = await Promise.all(artifactKeywords(input).map(async (query) => {
    try {
      const parsed: unknown = JSON.parse(await invoke<string>("search_spectrum_nodes", { query }));
      return Array.isArray(parsed) ? parsed as SpectrumNode[] : [];
    } catch { return []; }
  }));
  const unique = new Map<string, SpectrumNode>();
  for (const node of results.flat()) {
    if (!node || typeof node.id !== "string" || typeof node.content !== "string" || !node.content.trim()) continue;
    if (["suggestion", "doc_chunk_retired", "document_retired"].includes(node.node_type)) continue;
    if (!unique.has(node.id)) unique.set(node.id, node);
  }
  // Entity extraction and old conversations may contain the model's own
  // hallucinations. Do not relabel them as K-source evidence merely because
  // they were saved in the graph. Preserve them only as unverified continuity.
  const sourceTypes = new Set(["document", "doc_chunk", "file", "web_page"]);
  const sources = [...unique.values()].filter((node) => sourceTypes.has(node.node_type));
  sources
    .slice(0, 6).forEach((node, index) => blocks.push(
      `[K${index + 1}] Local source record (not independently verified): ${node.label}; type=${node.node_type}; updated=${node.updated_at || "unknown"}; id=${node.id}\n${node.content.slice(0, 2200)}`,
    ));
  [...unique.values()].filter((node) => !sourceTypes.has(node.node_type)).slice(0, 2).forEach((node) => blocks.push(
    `UNVERIFIED CONTINUITY ONLY — may be model-generated; not factual evidence and must not support technical claims: ${node.label}\n${node.content.slice(0, 800)}`,
  ));
  if (!sources.length) blocks.push("No supporting local knowledge was retrieved. Do not invent citations or imply research was performed.");
  return blocks.join("\n\n");
}
