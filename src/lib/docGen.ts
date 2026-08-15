// docGen — Local Word / PowerPoint generation from a natural-language request.
//
// Detects when the user asks the chatbot to create a document/presentation,
// asks the local model for a structured JSON spec, then hands it to the Rust
// backend which writes a real .docx / .pptx to the Downloads folder. 100% local.

import { invoke } from "@tauri-apps/api/core";
import type { GeneratedAttachment } from "../types";

export type DocKind = "docx" | "pptx";

/** Doc specs need room for full paragraphs (and reasoning-model traces count
 *  against the same budget) — never let the chat response-length slider starve
 *  them. */
const MIN_SPEC_TOKENS = 8192;

/**
 * Detect whether the user is asking to CREATE a Word document or PowerPoint.
 * Requires a creation verb plus a document/presentation noun to avoid firing
 * on ordinary questions that merely mention the word "document".
 */
const CREATE_VERBS = [
  "create", "make", "generate", "build", "write", "draft", "prepare",
  "produce", "design", "give",
];

/** Edit distance ≤ 1 (one substitution, insertion, or deletion). Catches the
 *  imperative-typo class — "reate a word document…", "mke a ppt…" — that a
 *  strict word-boundary regex silently drops into plain chat. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; }        // substitution
    else if (la > lb) { i++; }           // deletion from a
    else { j++; }                        // insertion into a
  }
  return edits + (la - i) + (lb - j) <= 1;
}

function hasCreateVerb(t: string): boolean {
  if (
    /\b(create|make|generate|build|write|draft|prepare|produce|design|put together|give me)\b/.test(
      t,
    )
  ) {
    return true;
  }
  // Fuzzy pass over the first few tokens for one-letter typos.
  const tokens = t.split(/[^a-z]+/).filter(Boolean).slice(0, 3);
  return tokens.some(
    (tok) => tok.length >= 3 && CREATE_VERBS.some((v) => withinOneEdit(tok, v)),
  );
}

/** Questions and read-style requests about an existing document must never
 *  trigger generation. */
function looksLikeReadRequest(t: string): boolean {
  return (
    /^(what|who|where|when|why|how|is|are|does|do|can|could|should|would|did)\b/.test(t) ||
    /\b(read|open|summariz|explain|analyz|review|check|look at|compare|translate)/.test(t)
  );
}

export function detectDocRequest(input: string): DocKind | null {
  const t = input.toLowerCase().trim();

  const pptWords =
    /\b(power\s?point|pptx?|presentation|slide\s?deck|slides?|slideshow|deck)\b/.test(
      t,
    );
  const docWords =
    /\b(word\s+document|word\s+doc|docx?|word\s+file|\bdocument\b|report|write-?up|essay|letter|memo|brief)\b/.test(
      t,
    );
  if (!pptWords && !docWords) return null;

  if (looksLikeReadRequest(t)) return null;

  // A recognized (or one-typo-off) creation verb is the primary signal; a
  // verb-less "word document on/about X" style request is accepted too.
  const topicMarker = /\b(pptx?|docx?|power\s?point|presentation|document|doc|report|slide\s?deck|slides|deck|memo|letter|essay|brief)\b\s+(on|about|for|of|covering|regarding)\b/.test(t);
  if (!hasCreateVerb(t) && !topicMarker) return null;

  if (pptWords) return "pptx";
  return "docx";
}

/** Build the system-style prompt that makes the model emit a strict JSON spec. */
function specPrompt(kind: DocKind, input: string, context?: string): string {
  const contextBlock = context
    ? [
        "Recent conversation (the request may refer to it — e.g. \"this\", \"that\", \"the above\"):",
        context,
        "",
      ]
    : [];
  if (kind === "pptx") {
    return [
      "You are a presentation generator. Based on the user request below, output ONLY a single valid minified JSON object — no markdown, no code fences, no commentary.",
      "",
      ...contextBlock,
      `User request: "${input}"`,
      "",
      "JSON schema:",
      '{"title":"string","subtitle":"string","slides":[{"title":"string","bullets":["string"]}]}',
      "",
      "Rules:",
      "- Produce 5 to 8 slides with real, substantive content for the topic.",
      "- Each slide has a short title and 3 to 5 concise bullet points.",
      "- Keep bullets under ~15 words each.",
      "- Output JSON only, nothing else.",
    ].join("\n");
  }
  return [
    "You are a document generator. Based on the user request below, output ONLY a single valid minified JSON object — no markdown, no code fences, no commentary.",
    "",
    ...contextBlock,
    `User request: "${input}"`,
    "",
    "JSON schema:",
    '{"title":"string","subtitle":"string","sections":[{"heading":"string","paragraphs":["string"],"bullets":["string"]}]}',
    "",
    "Rules:",
    "- Produce 3 to 6 sections with real, substantive content for the topic.",
    "- Each section has a heading, 1 to 3 paragraphs, and optionally a few bullets.",
    '- Use "bullets": [] when a section needs no bullet list.',
    "- Output JSON only, nothing else.",
  ].join("\n");
}

/** Pull the first balanced JSON object out of a model response. */
export function extractJson(raw: string): string {
  let text = raw.trim();
  // Strip code fences if the model added them despite instructions.
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("Model did not return a JSON document spec.");
  }
  const end = text.lastIndexOf("}");
  // A truncated response may lack the closing brace entirely — hand the tail
  // to the repair pass rather than failing here.
  return text.slice(start, end > start ? end + 1 : undefined);
}

/**
 * Best-effort repair of a truncated JSON object: walks the text respecting
 * string/escape state, drops a dangling partial token, strips a trailing
 * comma, and closes any still-open brackets/braces. Returns null when the
 * result still doesn't parse.
 */
export function repairJson(candidate: string): string | null {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  let lastComplete = -1;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') { inString = false; lastComplete = i; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch === "{" ? "}" : "]"); continue; }
    if (ch === "}" || ch === "]") { stack.pop(); lastComplete = i; continue; }
    if (!/\s/.test(ch)) lastComplete = i;
  }
  // Cut back to the last complete token (drops an unterminated string or a
  // dangling `"key":` fragment), then strip a trailing comma or colon-fragment.
  let text = candidate.slice(0, lastComplete + 1);
  text = text.replace(/,\s*$/, "").replace(/"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
  // Re-scan what remains to find which brackets are still open.
  inString = false;
  escaped = false;
  stack.length = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) text += '"';
  while (stack.length) text += stack.pop();
  try {
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}

interface GenerateOptions {
  model: string;
  ollamaUrl?: string | null;
  maxTokens?: number;
  /** Recent conversation snippet so requests like "…on this" resolve. */
  context?: string;
  onPhase?: (phase: string) => void;
}

/**
 * Generate a document/presentation end-to-end: model → JSON spec → written file.
 * Returns the saved file's metadata.
 */
export async function generateDocument(
  kind: DocKind,
  input: string,
  opts: GenerateOptions,
): Promise<GeneratedAttachment> {
  const label = kind === "pptx" ? "presentation" : "document";
  opts.onPhase?.(`Drafting ${label} outline with ${opts.model}…`);

  const raw = await invoke<string>("query_ollama", {
    prompt: specPrompt(kind, input, opts.context),
    model: opts.model,
    ollamaUrl: opts.ollamaUrl ?? null,
    maxTokens: Math.max(opts.maxTokens ?? 0, MIN_SPEC_TOKENS),
  });

  const candidate = extractJson(raw);
  let specJson: string;
  try {
    JSON.parse(candidate);
    specJson = candidate;
  } catch {
    const repaired = repairJson(candidate);
    if (!repaired) {
      throw new Error(
        `The ${label} outline from ${opts.model} came back incomplete or malformed ` +
          "(often a truncated response). Try again, ask for a shorter " +
          `${label}, or raise Max Tokens in Settings.`,
      );
    }
    specJson = repaired;
  }

  opts.onPhase?.(`Writing ${kind === "pptx" ? "PowerPoint" : "Word"} file…`);
  const command = kind === "pptx" ? "create_powerpoint" : "create_word_document";
  const resultJson = await invoke<string>(command, { specJson });
  return JSON.parse(resultJson) as GeneratedAttachment;
}
