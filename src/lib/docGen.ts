// docGen — Local Word / PowerPoint generation from a natural-language request.
//
// Detects when the user asks the chatbot to create a document/presentation,
// asks the local model for a structured JSON spec, then hands it to the Rust
// backend which writes a real .docx / .pptx to the Downloads folder. 100% local.

import { invoke } from "@tauri-apps/api/core";
import type { GeneratedAppInfo, GeneratedAttachment } from "../types";

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

// ─── Generic text files (.html / .md / .txt / .csv / .json / .svg) ────────────

export type FileKind = "html" | "md" | "txt" | "csv" | "json" | "svg";

/** Lighter read-guard for file requests: "open in browser" is a CREATION
 *  phrasing here, so unlike documents we only exclude questions and
 *  clearly analytical verbs. */
function looksLikeFileReadRequest(t: string): boolean {
  return (
    /^(what|who|where|when|why|how|is|are|does|do|could|should|would|did)\b/.test(t) ||
    /\b(summariz|explain|analyz|review|translate)/.test(t)
  );
}

/**
 * Detect a request to create a generic text-format file (HTML page, Markdown
 * note, CSV, …). Checked AFTER detectDocRequest so docx/pptx keep priority.
 */
export function detectFileRequest(input: string): FileKind | null {
  const t = input.toLowerCase().trim();
  if (looksLikeFileReadRequest(t)) return null;

  const kind: FileKind | null =
    /\.html\b|\bhtml\s+(file|page)\b|\bweb\s?page\b|\bopen(able)?\s+in\s+(a\s+|the\s+)?browser\b/.test(t)
      ? "html"
      : /\.md\b|\bmarkdown\b/.test(t)
        ? "md"
        : /\.txt\b|\btext\s+file\b/.test(t)
          ? "txt"
          : /\.csv\b|\bcsv\b/.test(t)
            ? "csv"
            : /\.json\b|\bjson\s+file\b/.test(t)
              ? "json"
              : /\.svg\b|\bsvg\s+(file|image|icon)\b/.test(t)
                ? "svg"
                : null;
  if (!kind) return null;

  // Require an actual (typo-tolerant) creation verb — merely mentioning a file
  // ("open the CSV file", "I have an HTML file") must not trigger generation.
  if (!hasCreateVerb(t)) return null;
  return kind;
}

/** Prompt for raw file content (not JSON — these formats ARE the payload). */
function filePrompt(kind: FileKind, input: string, context?: string): string {
  const contextBlock = context
    ? [
        "Recent conversation (the request may refer to it — e.g. \"this\", \"that\", \"the above\"):",
        context,
        "",
      ]
    : [];
  const kindHint: Record<FileKind, string> = {
    html: "a complete, self-contained HTML5 document (inline CSS/JS, no external assets)",
    md: "a well-structured Markdown document",
    txt: "a plain-text document",
    csv: "a CSV table with a header row",
    json: "a single valid JSON document",
    svg: "a single valid standalone SVG image",
  };
  return [
    `You are a file generator. Produce ${kindHint[kind]} for the user request below.`,
    "",
    ...contextBlock,
    `User request: "${input}"`,
    "",
    "Output format — follow EXACTLY:",
    `Line 1: FILENAME: <short-kebab-case-name>.${kind}`,
    "Line 2 onward: ONLY the raw file contents. No code fences, no commentary before or after.",
  ].join("\n");
}

/** Strip an outer ``` wrapper ONLY as a matched pair — a document that merely
 *  ENDS with a fenced code block must keep its closing delimiter. */
function stripWrapperFence(text: string): string {
  const t = text.trim();
  if (!/^```[a-z]*\n/i.test(t)) return t;
  const body = t.replace(/^```[a-z]*\n/i, "");
  return body.replace(/\n?```\s*$/, "").trim();
}

/** Parse the FILENAME contract; fall back to a slug of the request. */
export function splitFileResponse(
  raw: string,
  kind: FileKind,
  input: string,
): { title: string; content: string } {
  let text = stripWrapperFence(raw);
  const m = text.match(/^FILENAME:\s*(\S+)\s*\n/i);
  let title: string;
  if (m) {
    title = m[1].replace(new RegExp(`\\.${kind}$`, "i"), "");
    text = text.slice(m[0].length);
  } else {
    title = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "generated-file";
  }
  // The content may itself be wrapper-fenced if the model ignored instructions
  // — strip only a matched pair so legitimate trailing fences survive.
  text = stripWrapperFence(text);
  return { title, content: text };
}

/**
 * Generate a generic text-format file end-to-end: model → raw content → file.
 */
export async function generateTextFile(
  kind: FileKind,
  input: string,
  opts: GenerateOptions,
): Promise<GeneratedAttachment> {
  opts.onPhase?.(`Drafting .${kind} file with ${opts.model}…`);

  const raw = await invoke<string>("query_ollama", {
    prompt: filePrompt(kind, input, opts.context),
    model: opts.model,
    ollamaUrl: opts.ollamaUrl ?? null,
    maxTokens: Math.max(opts.maxTokens ?? 0, MIN_SPEC_TOKENS),
  });

  const { title, content } = splitFileResponse(raw, kind, input);
  if (!content) {
    throw new Error(
      `The model returned no usable content for the .${kind} file. Try again or rephrase.`,
    );
  }

  opts.onPhase?.(`Writing .${kind} file…`);
  const resultJson = await invoke<string>("create_text_file", {
    title,
    ext: kind,
    content,
  });
  return JSON.parse(resultJson) as GeneratedAttachment;
}

// ─── App Builder — multi-file static web apps ────────────────────────────────

/** App specs are big (every file's full source rides in one JSON) — give the
 *  model real room. */
const MIN_APP_TOKENS = 16384;

/**
 * Detect a request to BUILD an app/website/game — the multi-file lane.
 * Checked after detectDocRequest (presentation/report words keep priority)
 * and before detectFileRequest (a bare "web page" stays a single file).
 */
export function detectAppRequest(input: string): boolean {
  const t = input.toLowerCase().trim();
  if (looksLikeReadRequest(t)) return false;
  // Multi-file signals. A lone "page" or "html file" is NOT an app.
  const appNoun =
    /\b(web\s?app|webapp|app|application|website|web\s?site|landing\s+page|game|dashboard|tool|calculator|tracker|portfolio\s+site|store(front)?|e-?commerce|clone)\b/.test(t);
  if (!appNoun) return false;
  // Documents/presentations about apps must not trigger the builder.
  if (/\b(power\s?point|pptx?|presentation|slide|deck|docx?|word\s+doc|report|memo|essay|letter)\b/.test(t)) return false;
  return hasCreateVerb(t);
}

/** Prompt for a complete multi-file static web app spec. */
function appSpecPrompt(input: string, context?: string): string {
  const contextBlock = context
    ? [
        "Recent conversation (the request may refer to it):",
        context,
        "",
      ]
    : [];
  return [
    "You are a senior front-end engineer. Build a COMPLETE, WORKING static web app for the user request below. Output ONLY a single valid minified JSON object — no markdown, no code fences, no commentary.",
    "",
    ...contextBlock,
    `User request: "${input}"`,
    "",
    "JSON schema:",
    '{"name":"string","description":"string","entry":"index.html","files":[{"path":"string","content":"string"}]}',
    "",
    "Rules:",
    "- Static web tech ONLY: index.html plus separate styles.css and app.js (ES modules allowed). Optional extra pages/assets. 3 to 12 files.",
    "- The app must be fully self-contained and OFFLINE: no CDNs, no external fonts, no fetch() to remote hosts, no build step. localStorage is fine for persistence.",
    "- Make it genuinely usable and polished: real interactions, real sample data, responsive layout, coherent styling.",
    '- Relative paths only ("index.html", "styles.css", "js/app.js") — never absolute paths and never "..".',
    "- Every file's full source goes in \"content\" as a JSON string (escape newlines as \\n).",
    "- Output JSON only, nothing else.",
  ].join("\n");
}

/**
 * Generate a multi-file app project end-to-end: model → JSON spec → project
 * folder on disk. Returns the written project's metadata.
 */
export async function generateAppProject(
  input: string,
  opts: GenerateOptions,
): Promise<GeneratedAppInfo> {
  opts.onPhase?.(`Designing the app with ${opts.model}…`);

  const raw = await invoke<string>("query_ollama", {
    prompt: appSpecPrompt(input, opts.context),
    model: opts.model,
    ollamaUrl: opts.ollamaUrl ?? null,
    maxTokens: Math.max(opts.maxTokens ?? 0, MIN_APP_TOKENS),
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
        `The app plan from ${opts.model} came back incomplete or malformed ` +
          "(often a truncated response). Try again, ask for a simpler app, " +
          "or raise Max Tokens in Settings.",
      );
    }
    specJson = repaired;
  }

  opts.onPhase?.("Writing project files…");
  const resultJson = await invoke<string>("build_app_project", { specJson });
  return JSON.parse(resultJson) as GeneratedAppInfo;
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
      "You are a presentation designer. Based on the user request below, output ONLY a single valid minified JSON object — no markdown, no code fences, no commentary.",
      "",
      ...contextBlock,
      `User request: "${input}"`,
      "",
      "JSON schema (every slide field except title is optional):",
      '{"title":"string","subtitle":"string","slides":[{"title":"string","layout":"bullets|section|two_column|big_fact|quote","bullets":["string"],"left_title":"string","left":["string"],"right_title":"string","right":["string"],"fact":"string","caption":"string","quote":"string","attribution":"string","notes":"string"}]}',
      "",
      "Rules:",
      "- Produce 6 to 10 slides with real, substantive content for the topic.",
      '- VARY the layouts — a deck of identical bullet slides is a failure:',
      '  - open each major chapter with a "section" slide (title + one-line description in bullets[0]),',
      '  - use "big_fact" when one number or short phrase carries the message (fact + caption),',
      '  - use "two_column" for comparisons, pros/cons, before/after (left_title/right_title + left/right),',
      '  - use "quote" at most once (quote + attribution),',
      '  - use "bullets" for everything else: 3 to 5 bullets, each under ~12 words.',
      '- Where natural, start bullets with a short label then a colon, e.g. "Speed: 36 tok/s locally" — the label is rendered bold.',
      '- EVERY slide gets "notes": 2 to 3 spoken sentences a presenter would actually say.',
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
