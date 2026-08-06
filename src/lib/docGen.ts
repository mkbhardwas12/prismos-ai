// docGen — Local Word / PowerPoint / PDF / Excel generation from a request.
//
// Detects when the user asks the chatbot to create a document/presentation,
// asks the local model for a structured JSON spec, then hands it to the Rust
// backend which writes a real artifact to the Downloads folder through the
// fixed loopback inference route. A deterministic verification-first template
// keeps malformed model JSON from becoming a user-visible failure.

import { invoke } from "@tauri-apps/api/core";
import type { GeneratedAttachment } from "../types";

export type DocKind = "docx" | "pptx" | "pdf" | "xlsx";

/**
 * Detect whether the user is asking to create a supported local artifact.
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
    /\b(power\s?point|pptx?|presentation|slide\s?deck|slides?|slideshow|deck)\b/.test(
      t,
    );
  const pdfWords = /\b(pdf|portable\s+document(?:\s+format)?)\b/.test(t);
  const excelWords =
    /\b(excel|xlsx?|workbook|spreadsheet|work\s*sheet)\b/.test(t);
  const docWords =
    /\b(word\s+document|word\s+doc|docx|word\s+file|\bdocument\b|report|write-?up|essay|letter|memo|brief)\b/.test(
      t,
    );

  if (pptWords) return "pptx";
  // Explicit formats must win over generic words such as "report".
  if (pdfWords) return "pdf";
  if (excelWords) return "xlsx";
  if (docWords) return "docx";
  return null;
}

/** Pull the first complete JSON object out of a model response. */
function extractJson(raw: string): string {
  const text = raw.trim();
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start === -1) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error("The model returned an incomplete artifact specification.");
}

const VERSION_SENSITIVE_REQUEST =
  /\b(upgrad(?:e|ing)|migrat(?:e|ion|ing)|patch(?:ing)?|support\s+package|kernel|production|deploy(?:ment)?|install(?:ation|ing)?|security|database|backup|restore|rollback|runbook|sap|oracle|hana)\b/i;

/** Collect only model-authored string values; JSON field names are not claims. */
function collectStringValues(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStringValues(item, output);
    }
  }
  return output;
}

function unsupportedMatches(text: string, input: string, pattern: RegExp): string[] {
  const request = input.toLocaleLowerCase();
  const matches = text.match(pattern) ?? [];
  return matches.filter((match) => !request.includes(match.toLocaleLowerCase()));
}

/**
 * Deterministic release gate for model-authored artifacts.
 *
 * A document request currently carries the request itself, not an authoritative
 * evidence packet. For version-sensitive operational work, exact citations,
 * commands, paths, versions, dates, and duration estimates are therefore only
 * allowed when the user supplied them. This prevents a plausible-looking local
 * model draft from becoming an executable runbook or fabricated source list.
 */
export function validateDocumentSpecGrounding(
  input: string,
  spec: Record<string, unknown>,
): void {
  const authoredText = collectStringValues(spec).join("\n");
  const violations = new Set<string>();

  const localPaths = unsupportedMatches(
    authoredText,
    input,
    /(?:~\/(?:[^\s,;)}\]]+)|\/(?:Users|home)\/(?:[^\s,;)}\]]+)|[A-Za-z]:\\(?:[^\s,;)}\]]+))/g,
  );
  if (localPaths.length > 0) violations.add("local filesystem paths");

  if (VERSION_SENSITIVE_REQUEST.test(input)) {
    const unsupportedReferences = unsupportedMatches(
      authoredText,
      input,
      /\b(?:SAP\s+)?(?:Note|KBA)\s*#?\s*\d{6,8}\b/gi,
    );
    if (unsupportedReferences.length > 0) violations.add("unverified note or KBA identifiers");

    const unsupportedCommands = unsupportedMatches(
      authoredText,
      input,
      /\b(?:sapgenpfl|sapcontrol|brbackup|sapcar|sumstart|startsap|stopsap)\b/gi,
    );
    if (unsupportedCommands.length > 0) violations.add("unsourced operational commands");

    const unsupportedVersions = unsupportedMatches(
      authoredText,
      input,
      /\b(?:SP\s?\d{1,3}|(?:19|20)\d{2}|\d+(?:\.\d+){1,2})\b/gi,
    );
    if (unsupportedVersions.length > 0) violations.add("version or date claims absent from the request");

    const unsupportedDurations = unsupportedMatches(
      authoredText,
      input,
      /\b\d+(?:\s*[–-]\s*\d+)?\s*(?:hours?|days?|weeks?|months?|years?)\b/gi,
    );
    if (unsupportedDurations.length > 0) violations.add("unverified duration estimates");

    const unsupportedUrls = unsupportedMatches(
      authoredText,
      input,
      /https?:\/\/[^\s<>)\]}]+/gi,
    );
    if (unsupportedUrls.length > 0) violations.add("source URLs that were not supplied");

    if (/\b(?:long[- ]term maintenance version|LTS)\b/i.test(authoredText)
      && !/\b(?:long[- ]term maintenance version|LTS)\b/i.test(input)) {
      violations.add("unsupported maintenance-status claims");
    }

    const lower = authoredText.toLocaleLowerCase();
    const hasRequiredInputs = lower.includes("required input") || lower.includes("assumption");
    const hasVerificationGate = lower.includes("verif") && (
      lower.includes("official source")
      || lower.includes("maintenance planner")
      || lower.includes("product availability")
    );
    const hasTestPlan = lower.includes("test") || lower.includes("rehearsal");
    const hasRecoveryPlan = lower.includes("rollback") || lower.includes("recovery") || lower.includes("restore");
    if (!hasRequiredInputs) violations.add("required inputs and assumptions");
    if (!hasVerificationGate) violations.add("an official-source verification gate");
    if (!hasTestPlan) violations.add("a test or rehearsal plan");
    if (!hasRecoveryPlan) violations.add("a rollback or recovery plan");

    const decisionRecord = spec.decision_record;
    const limitations = Array.isArray(decisionRecord)
      ? decisionRecord.map(String).join(" ").toLocaleLowerCase()
      : "";
    if (!/(?:not|requires?|must|needs? to be)[^.]{0,80}verif|source limitation/.test(limitations)) {
      violations.add("an explicit verification limitation");
    }

    if (Array.isArray(spec.slides) && spec.slides.length < 9) {
      violations.add("an executive-grade operational slide sequence");
    }
  }

  if (/\bexecutive(?:s)?\b/i.test(input) && !/\bexecutive(?:s)?\b/i.test(authoredText)) {
    violations.add("the requested executive audience");
  }

  const requestedLandscapes = Array.from(
    input.matchAll(/\b(dev(?:elopment)?|test|qa|uat|stage|staging|prod(?:uction)?|sandbox)\b/gi),
    (match) => match[0].toLocaleLowerCase(),
  );
  for (const landscape of new Set(requestedLandscapes)) {
    const alternatives: Record<string, string[]> = {
      development: ["development", "dev"],
      dev: ["dev", "development"],
      staging: ["staging", "stage"],
      stage: ["stage", "staging"],
      production: ["production", "prod"],
      prod: ["prod", "production"],
    };
    const accepted = alternatives[landscape] ?? [landscape];
    if (!accepted.some((value) => new RegExp(`\\b${value}\\b`, "i").test(authoredText))) {
      violations.add(`requested landscape coverage (${landscape})`);
    }
  }

  const compactAuthoredText = authoredText.toLocaleLowerCase().replace(/\s+/g, "");
  for (const version of requestVersions(input)) {
    if (!compactAuthoredText.includes(version.toLocaleLowerCase().replace(/\s+/g, ""))) {
      violations.add(`requested version coverage (${version})`);
    }
  }

  if (violations.size > 0) {
    throw new Error(
      `Artifact quality gate stopped this draft because it contained or omitted: ${Array.from(violations).join(", ")}. `
      + "No file was written. Include approved source material in the request, then retry.",
    );
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateSpecShape(kind: DocKind, spec: Record<string, unknown>): void {
  if (typeof spec.title !== "string" || spec.title.trim().length === 0) {
    throw new Error("Artifact title is missing.");
  }
  if (kind === "pptx") {
    if (!Array.isArray(spec.slides) || spec.slides.length === 0 || spec.slides.length > 12) {
      throw new Error("Presentation must contain 1 to 12 slides.");
    }
    for (const slide of spec.slides) {
      const candidate = slide as Record<string, unknown>;
      if (typeof candidate?.title !== "string" || !isStringArray(candidate?.bullets)) {
        throw new Error("Presentation slide structure is invalid.");
      }
    }
    return;
  }
  if (kind === "xlsx") {
    if (!Array.isArray(spec.sheets) || spec.sheets.length === 0 || spec.sheets.length > 8) {
      throw new Error("Workbook must contain 1 to 8 worksheets.");
    }
    for (const sheet of spec.sheets) {
      const candidate = sheet as Record<string, unknown>;
      if (
        typeof candidate?.name !== "string"
        || !isStringArray(candidate?.headers)
        || !Array.isArray(candidate?.rows)
        || !candidate.rows.every((row) => isStringArray(row))
      ) {
        throw new Error("Workbook worksheet structure is invalid.");
      }
    }
    return;
  }
  if (!Array.isArray(spec.sections) || spec.sections.length === 0 || spec.sections.length > 12) {
    throw new Error("Document must contain 1 to 12 sections.");
  }
  for (const section of spec.sections) {
    const candidate = section as Record<string, unknown>;
    if (
      typeof candidate?.heading !== "string"
      || !isStringArray(candidate?.paragraphs)
      || !isStringArray(candidate?.bullets)
    ) {
      throw new Error("Document section structure is invalid.");
    }
  }
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

function requestLandscapes(input: string): string[] {
  const labels: Record<string, string> = {
    dev: "DEV",
    development: "Development",
    test: "Test",
    qa: "QA",
    uat: "UAT",
    stage: "Stage",
    staging: "Stage",
    prod: "Prod",
    production: "Production",
    sandbox: "Sandbox",
  };
  const output: string[] = [];
  for (const match of input.matchAll(/\b(dev(?:elopment)?|test|qa|uat|stage|staging|prod(?:uction)?|sandbox)\b/gi)) {
    const label = labels[match[0].toLocaleLowerCase()] ?? match[0];
    if (!output.some((value) => value.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      output.push(label);
    }
  }
  return output;
}

function requestVersions(input: string): string[] {
  const output: string[] = [];
  for (const match of input.matchAll(/\b(?:SP\s?\d{1,3}|\d+(?:\.\d+){1,2})\b/gi)) {
    const value = match[0].replace(/^sp\s*/i, "SP");
    if (!output.some((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      output.push(value);
    }
  }
  return output;
}

function fallbackTitle(input: string): string {
  const versions = requestVersions(input);
  const isSap = /\bsap\b/i.test(input);
  const isNetWeaver = /\bnetweaver\b/i.test(input);
  const isPi = /\b(?:pi|process integration)\b/i.test(input);
  const prefix = isNetWeaver ? "SAP NetWeaver" : isPi ? "SAP PI" : isSap ? "SAP" : "Requested";
  const versionText = versions.length > 0 ? ` ${versions.join(" to ")}` : "";
  const purpose = /\b(upgrad|migrat|patch)/i.test(input) ? " Upgrade" : " Plan";
  const audience = /\bexecutive/i.test(input) ? "Executive " : "";
  return `${audience}${prefix}${versionText}${purpose}`.trim().slice(0, 180);
}

function safeFallbackSpec(kind: DocKind, input: string): Record<string, unknown> {
  const title = fallbackTitle(input);
  const landscapes = requestLandscapes(input);
  const landscapePath = landscapes.length > 0
    ? landscapes.join(" → ")
    : "The confirmed non-production-to-production landscape sequence";
  const landscapeList = landscapes.length > 0 ? landscapes.join(", ") : "all in-scope landscapes";
  const versions = requestVersions(input);
  const versionScope = versions.length > 0
    ? versions.join(" to ")
    : "the requested source and target versions";
  const isSap = /\bsap\b/i.test(input);
  const officialGate = isSap
    ? "Verify the target path and prerequisites in SAP Maintenance Planner, Product Availability Matrix/SAP for Me, and the applicable current SUM guide before approval."
    : "Verify all current prerequisites and compatibility facts against approved official sources before approval.";
  const limitation = "Version-specific facts are not verified in this draft and require independent verification against approved official sources.";
  const decisionRecord = [
    limitation,
    `The requested landscape order is ${landscapePath}.`,
    "The artifact separates executive decisions from technical evidence still required.",
    "No commands, dates, durations, compatibility claims, or external research were invented.",
  ];

  if (kind === "pptx") {
    return {
      title,
      subtitle: `Executive verification-first roadmap | ${versionScope} | ${landscapeList}`,
      slides: [
        {
          title: "Executive purpose and decision",
          bullets: [
            `Frame the requested ${versionScope} change as a controlled business decision.`,
            `Use the requested landscape progression: ${landscapePath}.`,
            "Approve execution only after evidence, ownership, testing, and recovery gates are complete.",
          ],
        },
        {
          title: "Scope, required inputs, and assumptions",
          bullets: [
            `In scope: ${landscapeList}; confirm every actual system and dependency.`,
            "Required inputs include installed components, topology, database, operating system, integrations, add-ons, and availability design.",
            "Assumptions remain provisional until system evidence is attached and reviewed.",
          ],
        },
        {
          title: "Landscape rollout strategy",
          bullets: [
            `Promote evidence and lessons through ${landscapePath}.`,
            "Require an explicit entry gate, exit evidence, accountable owner, and approval for every landscape.",
            "Prevent downstream promotion when defects, evidence gaps, or recovery readiness remain open.",
          ],
        },
        {
          title: "Authoritative-source verification gate",
          bullets: [
            officialGate,
            "Record each verified prerequisite with source owner, evidence location, review status, and approver.",
            limitation,
          ],
        },
        {
          title: `${landscapes[0] ?? "First landscape"} rehearsal and learning`,
          bullets: [
            "Rehearse the complete controlled procedure using the approved evidence pack.",
            "Capture observed issues, decisions, timings, validation results, and recovery evidence without estimating them in advance.",
            "Update the plan only through reviewed change control.",
          ],
        },
        {
          title: "Test and regression assurance",
          bullets: [
            "Build the test inventory from actual business processes, interfaces, jobs, security roles, operations, and monitoring.",
            "Define owners, expected results, evidence, defect severity, and exit criteria before testing begins.",
            "Carry unresolved risk forward visibly; do not convert missing evidence into an assumption of success.",
          ],
        },
        {
          title: "Stage readiness and production likeness",
          bullets: [
            `Use ${landscapes.find((value) => /stage/i.test(value)) ?? "Stage"} to validate the approved sequence under production-like controls.`,
            "Confirm operational handoffs, monitoring, access, communications, and support readiness.",
            "Require signed evidence for every exit criterion before the production decision.",
          ],
        },
        {
          title: "Recovery and rollback readiness",
          bullets: [
            "Define rollback and recovery triggers, decision authority, restore ownership, and validation evidence.",
            "Prove recoverability through a controlled rehearsal before production approval.",
            "Keep recovery status independent from upgrade success status so both are visible to executives.",
          ],
        },
        {
          title: "Production go/no-go",
          bullets: [
            `Apply the final gate before ${landscapes.find((value) => /prod/i.test(value)) ?? "Production"}.`,
            "Go only when prerequisites, test evidence, defects, operational readiness, communications, and recovery evidence meet approved criteria.",
            "Record the decision, conditions, accountable approvers, and any accepted residual risk.",
          ],
        },
        {
          title: "Governance, ownership, and reporting",
          bullets: [
            "Assign accountable owners for technical delivery, business validation, security, operations, recovery, and executive approval.",
            "Report evidence-backed status, open decisions, risk movement, and blocked gates by landscape.",
            "Escalate exceptions through named governance rather than bypassing a control.",
          ],
        },
        {
          title: "Executive decisions required",
          bullets: [
            "Confirm scope, business priority, risk tolerance, decision authority, and required evidence.",
            "Approve the landscape gate model and the conditions that stop promotion.",
            "Authorize production only after independent verification and signed go/no-go evidence.",
          ],
        },
      ],
      decision_record: decisionRecord,
    };
  }

  if (kind === "xlsx") {
    const landscapeRows = (landscapes.length > 0 ? landscapes : ["In-scope landscape"]).map(
      (landscape, index) => [
        String(index + 1),
        landscape,
        "Not started",
        "Owner required",
        "Required inputs and assumptions not yet verified",
        "Official-source verification pending",
        "Test and recovery evidence pending",
        "No-go until gates pass",
      ],
    );
    return {
      title,
      subtitle: `Verification-first workbook | ${versionScope} | ${landscapePath}`,
      sheets: [
        {
          name: "Landscape Plan",
          headers: ["Sequence", "Landscape", "Status", "Owner", "Required Inputs", "Verification", "Test and Recovery", "Gate Decision"],
          rows: landscapeRows,
        },
        {
          name: "Evidence Register",
          headers: ["Landscape", "Evidence Area", "Official Source", "Owner", "Status", "Evidence Location", "Reviewer", "Decision"],
          rows: [
            [landscapeList, "Version and compatibility", officialGate, "Owner required", "Pending verification", "Required", "Reviewer required", "Open"],
            [landscapeList, "Testing and rehearsal", "Approved test evidence", "Owner required", "Pending", "Required", "Reviewer required", "Open"],
            [landscapeList, "Rollback and recovery", "Approved recovery evidence", "Owner required", "Pending", "Required", "Reviewer required", "Open"],
          ],
        },
        {
          name: "Risks and Decisions",
          headers: ["Type", "Landscape", "Description", "Impact", "Owner", "Evidence", "Decision", "Status"],
          rows: [
            ["Source limitation", landscapeList, limitation, "Approval blocked", "Owner required", "Official-source evidence required", "Verify", "Open"],
            ["Recovery", landscapeList, "Rollback and recovery must be rehearsed", "Production decision", "Owner required", "Recovery evidence required", "No-go until proven", "Open"],
          ],
        },
      ],
      decision_record: decisionRecord,
    };
  }

  return {
    title,
    subtitle: `${kind === "pdf" ? "PDF" : "Word"} verification-first planning document | ${landscapeList}`,
    sections: [
      {
        heading: "Executive purpose and scope",
        paragraphs: [`This planning draft frames the requested ${versionScope} change for executive review across ${landscapePath}.`],
        bullets: ["Confirm business priority, scope boundaries, accountable owners, decision authority, and required evidence."],
      },
      {
        heading: "Required inputs and assumptions",
        paragraphs: ["Required inputs include the actual system inventory, topology, dependencies, integrations, add-ons, operating context, and availability design."],
        bullets: ["Treat every assumption as open until evidence is attached, reviewed, and approved."],
      },
      {
        heading: "Official-source verification gate",
        paragraphs: [officialGate, limitation],
        bullets: ["Record the source, owner, evidence location, review status, and approver for every prerequisite."],
      },
      {
        heading: "Landscape rehearsal and promotion",
        paragraphs: [`Promote only through the requested order: ${landscapePath}.`],
        bullets: ["Give each landscape explicit entry criteria, test evidence, exit criteria, accountable approval, and stop conditions."],
      },
      {
        heading: "Testing, operations, and governance",
        paragraphs: ["Build regression testing from actual business processes and interfaces, then retain evidence for every result and defect decision."],
        bullets: ["Confirm security, monitoring, support, communications, and business validation before production approval."],
      },
      {
        heading: "Rollback, recovery, and go/no-go",
        paragraphs: ["Define and rehearse rollback and recovery triggers, authority, restore ownership, and validation before the final decision."],
        bullets: ["No-go while verification, testing, defects, operational readiness, or recovery evidence remains incomplete."],
      },
    ],
    decision_record: decisionRecord,
  };
}

const ARTIFACT_LABELS: Record<DocKind, string> = {
  docx: "Word document",
  pptx: "PowerPoint presentation",
  pdf: "PDF document",
  xlsx: "Excel workbook",
};

const ARTIFACT_COMMANDS: Record<DocKind, string> = {
  docx: "create_word_document",
  pptx: "create_powerpoint",
  pdf: "create_pdf_document",
  xlsx: "create_excel_workbook",
};

/**
 * Generate an artifact end-to-end: model → validated spec → written file.
 * When `includeReasoning` is set (the default), the file ends with a concise
 * Decision Record. Raw model/goal-loop chain-of-thought is never exported.
 */
export async function generateDocument(
  kind: DocKind,
  input: string,
  opts: GenerateOptions,
): Promise<GeneratedAttachment> {
  const includeReasoning = opts.includeReasoning ?? true;
  opts.onPhase?.(`Drafting ${ARTIFACT_LABELS[kind]} outline with ${opts.model}…`);

  let spec: Record<string, unknown>;
  let usedFallback = false;
  try {
    const raw = await invoke<string>("generate_document_spec", {
      kind,
      input,
      model: opts.model,
      maxTokens: Math.max(opts.maxTokens ?? 4096, kind === "pptx" ? 4096 : 3072),
    });
    spec = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    validateSpecShape(kind, spec);
    validateDocumentSpecGrounding(input, spec);
  } catch {
    usedFallback = true;
    opts.onPhase?.("The model outline was incomplete; applying the safe verified template…");
    spec = safeFallbackSpec(kind, input);
    validateSpecShape(kind, spec);
    validateDocumentSpecGrounding(input, spec);
  }

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

  opts.onPhase?.(`Writing ${ARTIFACT_LABELS[kind]} file…`);
  try {
    const resultJson = await invoke<string>(ARTIFACT_COMMANDS[kind], {
      specJson: JSON.stringify(spec),
    });
    const attachment = JSON.parse(resultJson) as GeneratedAttachment;
    return {
      ...attachment,
      generationMode: usedFallback ? "safe_fallback" : "model",
      generationNotice: usedFallback
        ? "The local model outline was malformed or failed validation, so PrismOS created a conservative verification-first artifact from the request instead."
        : undefined,
    };
  } catch (error) {
    throw new Error(`Artifact file writer failed: ${String(error)}`);
  }
}
