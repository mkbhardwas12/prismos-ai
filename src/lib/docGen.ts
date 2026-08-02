// docGen — Local Word / PowerPoint generation from a natural-language request.
//
// Detects when the user asks the chatbot to create a document/presentation,
// asks the local model for a structured JSON spec, then hands it to the Rust
// backend which writes a real .docx / .pptx to the Downloads folder through the
// fixed loopback inference route.

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

/** A concise, user-facing decision record carried into the generated file. */
export interface DecisionAppendix {
  /** Key choices, assumptions, source limits, and verification notes. */
  rationale: string[];
  /** One-line verdict, e.g. "Judge accepted the answer (92%)". */
  verdict: string;
}

interface GenerateOptions {
  model: string;
  maxTokens?: number;
  onPhase?: (phase: string) => void;
  /** Include a concise "Decision Record" appendix in the file (default true). */
  includeReasoning?: boolean;
  /** Optional verifier metadata carried over from a prior goal-loop answer. */
  priorReasoning?: { verdict?: string; criteria?: string[] };
}

/**
 * Generate a document/presentation end-to-end: model → JSON spec → written file.
 * When `includeReasoning` is set (the default), the file ends with a concise
 * Decision Record. Raw model/goal-loop chain-of-thought is never exported.
 */
export async function generateDocument(
  kind: DocKind,
  input: string,
  opts: GenerateOptions,
): Promise<GeneratedAttachment> {
  const includeReasoning = opts.includeReasoning ?? true;
  const label = kind === "pptx" ? "presentation" : "document";
  opts.onPhase?.(`Drafting ${label} outline with ${opts.model}…`);

  const raw = await invoke<string>("generate_document_spec", {
    kind,
    input,
    model: opts.model,
    maxTokens: opts.maxTokens ?? 4096,
  });

  const specJson = extractJson(raw);
  // Reshape the model's bounded decision record into the backend's legacy
  // `reasoning` envelope. The envelope name stays wire-compatible, but no raw
  // hidden reasoning is copied into it.
  const spec = JSON.parse(specJson) as Record<string, unknown>;

  if (includeReasoning) {
    const modelRationale = Array.isArray(spec.decision_record)
      ? (spec.decision_record as unknown[])
          .map(String)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .slice(0, 5)
      : [];
    const rationale = [
      ...(opts.priorReasoning?.criteria ?? []).map((value) => value.trim()),
      ...modelRationale,
    ].filter(Boolean).slice(0, 8);
    const appendix: DecisionAppendix = {
      rationale,
      verdict: opts.priorReasoning?.verdict ?? "",
    };
    delete spec.decision_record;
    spec.reasoning =
      appendix.rationale.length > 0 || appendix.verdict
        ? appendix
        : undefined;
  } else {
    delete spec.decision_record;
    delete spec.reasoning;
  }

  opts.onPhase?.(`Writing ${kind === "pptx" ? "PowerPoint" : "Word"} file…`);
  const command = kind === "pptx" ? "create_powerpoint" : "create_word_document";
  const resultJson = await invoke<string>(command, { specJson: JSON.stringify(spec) });
  return JSON.parse(resultJson) as GeneratedAttachment;
}
