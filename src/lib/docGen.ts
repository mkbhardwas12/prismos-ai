// docGen — Local Word / PowerPoint generation from a natural-language request.
//
// Detects when the user asks the chatbot to create a document/presentation,
// asks the local model for a structured JSON spec, then hands it to the Rust
// backend which writes a real .docx / .pptx to the Downloads folder. 100% local.

import { invoke } from "@tauri-apps/api/core";
import type { GeneratedAttachment } from "../types";

export type DocKind = "docx" | "pptx";

/**
 * Detect whether the user is asking to CREATE a Word document or PowerPoint.
 * Requires a creation verb plus a document/presentation noun to avoid firing
 * on ordinary questions that merely mention the word "document".
 */
export function detectDocRequest(input: string): DocKind | null {
  const t = input.toLowerCase();
  const createVerb =
    /\b(create|make|generate|build|write|draft|prepare|produce|design|put together|give me)\b/.test(
      t,
    );
  if (!createVerb) return null;

  const pptWords =
    /\b(power\s?point|pptx|presentation|slide\s?deck|slides?|slideshow|deck)\b/.test(
      t,
    );
  const docWords =
    /\b(word\s+document|word\s+doc|docx|word\s+file|\bdocument\b|report|write-?up|essay|letter|memo|brief)\b/.test(
      t,
    );

  if (pptWords) return "pptx";
  if (docWords) return "docx";
  return null;
}

/** Build the system-style prompt that makes the model emit a strict JSON spec. */
function specPrompt(kind: DocKind, input: string): string {
  if (kind === "pptx") {
    return [
      "You are a presentation generator. Based on the user request below, output ONLY a single valid minified JSON object — no markdown, no code fences, no commentary.",
      "",
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
function extractJson(raw: string): string {
  let text = raw.trim();
  // Strip code fences if the model added them despite instructions.
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return a JSON document spec.");
  }
  return text.slice(start, end + 1);
}

interface GenerateOptions {
  model: string;
  ollamaUrl?: string | null;
  maxTokens?: number;
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
    prompt: specPrompt(kind, input),
    model: opts.model,
    ollamaUrl: opts.ollamaUrl ?? null,
    maxTokens: opts.maxTokens ?? 4096,
  });

  const specJson = extractJson(raw);
  // Validate it parses before sending to the backend for a clearer error.
  JSON.parse(specJson);

  opts.onPhase?.(`Writing ${kind === "pptx" ? "PowerPoint" : "Word"} file…`);
  const command = kind === "pptx" ? "create_powerpoint" : "create_word_document";
  const resultJson = await invoke<string>(command, { specJson });
  return JSON.parse(resultJson) as GeneratedAttachment;
}
