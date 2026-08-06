// researchDoc — build REAL, knowledge-grounded documents in any format.
//
// Unlike a template, this first RETRIEVES relevant knowledge from your Spectrum
// Graph (courses, research-bridge findings, project knowledge, past answers),
// grounds the model in it, generates substantive content, and renders it to
// Word / PowerPoint / PDF / Excel using the existing document commands. 100% local.

import { invoke } from "@tauri-apps/api/core";
import type { GeneratedAttachment } from "../types";
import { runResearchBridge } from "./researchBridge";

export type DocFormat = "docx" | "pptx" | "pdf" | "xlsx";

export const FORMAT_LABEL: Record<DocFormat, string> = {
  docx: "Word",
  pptx: "PowerPoint",
  pdf: "PDF",
  xlsx: "Excel",
};

const COMMAND: Record<DocFormat, string> = {
  docx: "create_word_document",
  pdf: "create_pdf_document",
  pptx: "create_powerpoint",
  xlsx: "create_excel_workbook",
};

const RESEARCH_RE =
  /\b(online research|research online|search (the )?web|look (this |it )?up online|find (the |me )?(the )?latest|latest (developments|advances|news|research|version|update)|newest|most recent|up[- ]?to[- ]?date|current (state|info|information|trends|developments)|updated (info|content|information|knowledge)|what'?s new)\b/i;

/** True when a chat message reads like a request for fresh/online information. */
export function isResearchRequest(text: string): boolean {
  return text.trim().length >= 8 && RESEARCH_RE.test(text);
}

const AUTO_RESEARCH_KEY = "prismos-auto-research";

/** Standing consent to auto-research chat questions online (off by default).
 * Stored under its own key so the settings object can't drop it. */
export function getAutoResearch(): boolean {
  try {
    return localStorage.getItem(AUTO_RESEARCH_KEY) === "true";
  } catch {
    return false;
  }
}

export function setAutoResearch(on: boolean): void {
  try {
    localStorage.setItem(AUTO_RESEARCH_KEY, on ? "true" : "false");
  } catch {
    /* ignore */
  }
}

interface KnowledgeChunk {
  label: string;
  content: string;
  score: number;
}

/** Retrieve the most relevant knowledge for a topic from the Spectrum Graph. */
async function retrieveKnowledge(topic: string, limit = 8): Promise<KnowledgeChunk[]> {
  try {
    const raw = await invoke<string>("query_spectrum_intent", {
      rawInput: topic,
      intentType: "Analyze",
      entities: [],
    });
    const results = JSON.parse(raw) as Array<{
      node?: { label?: string; content?: string };
      relevance_score?: number;
    }>;
    return results
      .filter((r) => (r.node?.content ?? "").trim().length > 0)
      .slice(0, limit)
      .map((r) => ({
        label: r.node?.label ?? "",
        content: r.node?.content ?? "",
        score: r.relevance_score ?? 0,
      }));
  } catch {
    return [];
  }
}

function knowledgeBlock(chunks: KnowledgeChunk[], maxChars = 9000): string {
  let out = "";
  for (const c of chunks) {
    const piece = `### ${c.label}\n${c.content}\n\n`;
    if (out.length + piece.length > maxChars) break;
    out += piece;
  }
  return out.trim();
}

function specPrompt(format: DocFormat, topic: string, knowledge: string): string {
  const grounding = knowledge
    ? `You have KNOWLEDGE retrieved from the user's own knowledge graph. GROUND the document in it — ` +
      `use its facts, structure, and specifics, prefer it over generic knowledge, and cite concrete ` +
      `details from it. Do NOT produce a template or placeholders.\n\n<knowledge>\n${knowledge}\n</knowledge>\n\n`
    : `No stored knowledge matched; produce accurate, real content from general knowledge — no placeholders.\n\n`;
  const head =
    `${grounding}Task: produce a REAL, substantive ${FORMAT_LABEL[format]} document on: "${topic}". ` +
    `Output ONLY a single valid minified JSON object — no markdown, no code fences, no commentary.\n\nJSON schema:\n`;

  if (format === "xlsx") {
    return (
      head +
      `{"title":"string","subtitle":"string","sheets":[{"name":"string","headers":["string"],"rows":[["string"]]}]}\n\n` +
      `Rules: 1-4 sheets of REAL tabular data drawn from the topic and knowledge (comparison matrix, plan, ` +
      `checklist, dataset, roadmap). EVERY row array length must equal the sheet's headers length. Concrete ` +
      `values only — never "TBD"/placeholders.`
    );
  }
  if (format === "pptx") {
    return (
      head +
      `{"title":"string","subtitle":"string","slides":[{"title":"string","bullets":["string"]}]}\n\n` +
      `Rules: 6-10 slides with real, substantive bullets grounded in the knowledge. 3-5 concise bullets per ` +
      `slide (~<15 words). No placeholders.`
    );
  }
  // docx + pdf share the WordSpec schema
  return (
    head +
    `{"title":"string","subtitle":"string","sections":[{"heading":"string","paragraphs":["string"],"bullets":["string"]}]}\n\n` +
    `Rules: 4-7 sections with real, substantive paragraphs (2-4 per section) grounded in the knowledge, plus ` +
    `bullets where useful. Cite specific facts from the knowledge. No placeholders or generic filler.`
  );
}

function extractJson(raw: string): string {
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error("The model did not return a document spec.");
  return t.slice(s, e + 1);
}

export interface GenerateResult {
  attachment: GeneratedAttachment;
  grounded: number; // how many knowledge sources were used
  freshSources: number; // web sources fetched this run (0 unless researchFirst)
}

export interface GenerateOpts {
  model: string;
  ollamaUrl?: string | null;
  maxTokens?: number;
  onPhase?: (phase: string) => void;
  /** Search the web (DMZ bridge, consented) for fresh sources before drafting. */
  researchFirst?: boolean;
}

/**
 * Run consented online research (DMZ bridge): search → fetch → ingest fresh
 * sources into the graph. Returns how many sources landed. Egress happens only
 * because the caller explicitly asked for it.
 */
export async function researchOnline(
  query: string,
  onPhase?: (phase: string) => void,
): Promise<number> {
  onPhase?.("Searching the web (DMZ, consented)…");
  const run = await runResearchBridge([], true, true, query, 6);
  return run.receipts.length;
}

/**
 * Build a knowledge-grounded document end-to-end: (optionally research online) →
 * retrieve → draft → render.
 */
export async function generateGroundedDocument(
  format: DocFormat,
  topic: string,
  opts: GenerateOpts,
): Promise<GenerateResult> {
  // 1) ACCESS your own knowledge first.
  opts.onPhase?.("Checking your knowledge…");
  let chunks = await retrieveKnowledge(topic);

  // 2) THEN go online (consented) to supplement / update — the "access, then
  //    online" order. Especially valuable when local knowledge is thin or the
  //    topic implies freshness. Merges the fresh sources back in.
  let freshSources = 0;
  const localThin = chunks.length < 3;
  if (opts.researchFirst) {
    try {
      opts.onPhase?.(
        localThin
          ? "Limited local knowledge — researching online (DMZ)…"
          : "Supplementing with fresh web sources (DMZ)…",
      );
      freshSources = await researchOnline(topic, opts.onPhase);
      if (freshSources > 0) {
        opts.onPhase?.("Merging fresh sources with your knowledge…");
        chunks = await retrieveKnowledge(topic); // re-retrieve; now includes research-* nodes
      }
    } catch {
      /* research is best-effort; fall back to stored knowledge */
    }
  }
  const knowledge = knowledgeBlock(chunks);

  opts.onPhase?.(
    chunks.length > 0
      ? `Drafting from ${chunks.length} knowledge source(s) with ${opts.model}…`
      : `Drafting with ${opts.model}…`,
  );
  const raw = await invoke<string>("query_ollama", {
    prompt: specPrompt(format, topic, knowledge),
    model: opts.model,
    ollamaUrl: opts.ollamaUrl ?? null,
    maxTokens: opts.maxTokens ?? 4096,
  });

  const specJson = extractJson(raw);
  JSON.parse(specJson); // fail fast on malformed JSON before hitting the backend

  opts.onPhase?.(`Writing the ${FORMAT_LABEL[format]} file…`);
  const resultJson = await invoke<string>(COMMAND[format], { specJson });
  return {
    attachment: JSON.parse(resultJson) as GeneratedAttachment,
    grounded: chunks.length,
    freshSources,
  };
}
