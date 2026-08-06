// useChat — Messages, intent processing, conversation history

import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, Message, RefractiveResult, RefractionAlternative, CollaborationSummary, DebateSummary, IntentTransparency, ReviewRequest, TextBackend, GraphAnswerTrace } from "../types";
import { detectDocRequest, generateDocument } from "../lib/docGen";
import { detectReviewRequest, formatReportMarkdown, type ReviewReportPayload } from "../lib/projectReview";
import { DEFAULT_MODEL } from "../lib/config";

interface UseChatOptions {
  settings: AppSettings;
  onIntentProcessed: (agentUsed?: string, collaboration?: CollaborationSummary, debate?: DebateSummary | null, graphTrace?: GraphAnswerTrace) => void;
  clearLiveSteps: (taskId?: string) => void;
  voiceEnabled: boolean;
  voiceSpeak: (text: string) => void;
  refreshSuggestions: (input: string, msgId: string) => Promise<void>;
}

export const MAX_REFRACT_REQUEST_ID_BYTES = 128;

const REFRACT_REQUEST_ID_PATTERN = /[A-Za-z0-9][A-Za-z0-9._:-]*/;

export interface RefractIntentInvokeArgs extends Record<string, unknown> {
  input: string;
  model: string;
  requestId: string;
}

export type RefractCommandInvoker = (
  command: "refract_intent",
  args: RefractIntentInvokeArgs,
) => Promise<string>;

export interface RefractRetryOptions {
  retries?: number;
  retryDelayMs?: number;
  /** Caller-supplied logical request identity for activity correlation. */
  requestId?: string;
  requestIdFactory?: () => string;
}

export type RefractFailureKind =
  | "unavailable"
  | "admission"
  | "policy"
  | "integrity"
  | "timeout"
  | "cancelled"
  | "protocol"
  | "transport";

export interface RefractCommandFailure {
  schema_version: 1;
  kind: RefractFailureKind;
  backend: TextBackend;
  request_id: string;
  retryable: boolean;
  message: string;
}

const REFRACT_FAILURE_KINDS = new Set<RefractFailureKind>([
  "unavailable",
  "admission",
  "policy",
  "integrity",
  "timeout",
  "cancelled",
  "protocol",
  "transport",
]);

/** Parse only the strict command envelope emitted by the Rust inference seam. */
export function parseRefractCommandFailure(error: unknown): RefractCommandFailure | null {
  if (error instanceof Error) {
    return parseRefractCommandFailure(error.message);
  }

  let candidate: unknown = error;
  if (typeof error === "string") {
    try {
      candidate = JSON.parse(error);
    } catch {
      return null;
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const value = candidate as Record<string, unknown>;
  if (
    value.schema_version !== 1
    || typeof value.kind !== "string"
    || !REFRACT_FAILURE_KINDS.has(value.kind as RefractFailureKind)
    || (value.backend !== "ollama" && value.backend !== "aivm_loopback")
    || typeof value.request_id !== "string"
    || typeof value.retryable !== "boolean"
    || typeof value.message !== "string"
  ) {
    return null;
  }

  return value as unknown as RefractCommandFailure;
}

/**
 * Only a future, explicitly classified Ollama transport failure may retry.
 * Native failures never retry, even if malformed input claims they are safe.
 * Unknown/string failures also fail closed because durable deduplication is not
 * implemented yet.
 */
export function shouldRetryRefractFailure(error: unknown): boolean {
  const failure = parseRefractCommandFailure(error);
  return failure?.backend === "ollama"
    && failure.kind === "transport"
    && failure.retryable === true;
}

export function isValidRefractRequestId(requestId: string): boolean {
  const match = REFRACT_REQUEST_ID_PATTERN.exec(requestId);
  return requestId.length >= 1
    && requestId.length <= MAX_REFRACT_REQUEST_ID_BYTES
    && match?.[0] === requestId;
}

export function createRefractRequestId(
  requestIdFactory: () => string = () => crypto.randomUUID(),
): string {
  const requestId = requestIdFactory();
  if (!isValidRefractRequestId(requestId)) {
    throw new Error(
      `Invalid request ID: expected 1..=${MAX_REFRACT_REQUEST_ID_BYTES} ASCII bytes using letters, digits, '.', '_', ':', or '-'`,
    );
  }
  return requestId;
}

// Retry wrapper for API calls (up to 2 retries with exponential backoff)
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  retryDelayMs = 500,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries || !shouldRetry(e)) throw e;
      const delay = retryDelayMs * (attempt + 1);
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error("Unreachable");
}

/** Optional enrichment must never keep a released answer in the loading state. */
function runInBackground(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    console.warn(`[${label}] Background task failed:`, error);
  });
}

/**
 * Invoke one logical request with one caller identity. Transport retries reuse
 * the exact same ID; this helper does not provide persistence or deduplication.
 */
export async function refractIntentWithRetry(
  input: string,
  model: string,
  invokeCommand: RefractCommandInvoker = (command, args) => invoke<string>(command, args),
  options: RefractRetryOptions = {},
): Promise<string> {
  const requestId = options.requestId !== undefined
    ? createRefractRequestId(() => options.requestId as string)
    : createRefractRequestId(options.requestIdFactory);
  return withRetry(
    () => invokeCommand("refract_intent", { input, model, requestId }),
    options.retries,
    options.retryDelayMs,
    shouldRetryRefractFailure,
  );
}

export function useChat({
  settings,
  onIntentProcessed,
  clearLiveSteps,
  voiceEnabled,
  voiceSpeak,
  refreshSuggestions,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<string>("");
  const [processingElapsed, setProcessingElapsed] = useState<number>(0);
  const [pendingIntent, setPendingIntent] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const processingStartRef = useRef<number>(0);
  const processingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable ref for handleIntent so event listeners don't go stale
  const handleIntentRef = useRef<(input: string, imageData?: string, documentText?: string) => void>(() => {});

  // Load conversation history from Spectrum Graph on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await invoke<string>("search_spectrum_nodes", {
          query: "conversation",
        });
        const nodes = JSON.parse(result) as Array<{
          id: string;
          label: string;
          content: string;
          created_at: string;
        }>;

        const restored: Message[] = [];
        for (const node of nodes.slice(0, 20).reverse()) {
          const parts = node.content.split("\n\nA: ");
          if (parts.length === 2) {
            const question = parts[0].replace(/^Q: /, "");
            restored.push({
              id: `hist-user-${node.id}`,
              role: "user",
              content: question,
              timestamp: new Date(node.created_at),
            });
            restored.push({
              id: `hist-ai-${node.id}`,
              role: "ai",
              content: parts[1],
              timestamp: new Date(node.created_at),
            });
          }
        }
        if (restored.length > 0) {
          setMessages(restored);
        }
      } catch {
        // No history — that's fine
      }
    })();
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Listen for sidebar proactive clicks
  useEffect(() => {
    const fillHandler = (e: Event) => {
      const intent = (e as CustomEvent<string>).detail;
      if (intent) setPendingIntent(intent);
    };
    const processHandler = (e: Event) => {
      const intent = (e as CustomEvent<string>).detail;
      if (intent) handleIntentRef.current(intent);
    };
    window.addEventListener("prismos:fill-intent", fillHandler);
    window.addEventListener("prismos:process-intent", processHandler);
    return () => {
      window.removeEventListener("prismos:fill-intent", fillHandler);
      window.removeEventListener("prismos:process-intent", processHandler);
    };
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    clearLiveSteps();
  }, [clearLiveSteps]);

  async function handleIntent(input: string, imageData?: string, documentText?: string) {
    const activityTaskId = createRefractRequestId();
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: documentText
        ? `📄 [Document attached]\n${input}`
        : imageData
          ? `🖼️ [Image attached]\n${input}`
          : input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    processingStartRef.current = Date.now();
    setProcessingElapsed(0);
    processingTimerRef.current = setInterval(() => {
      setProcessingElapsed(Math.floor((Date.now() - processingStartRef.current) / 1000));
    }, 1000);
    clearLiveSteps(activityTaskId);

    try {
      // ── Document analysis path: RAG-powered document analysis (Phase 6) ──
      if (documentText) {
        setProcessingPhase("Checking Ollama connection…");
        const ollamaOk = await invoke<boolean>("check_local_inference_status");
        if (!ollamaOk) {
          throw new Error("Ollama is not running. Please start Ollama first: ollama serve");
        }

        const sourceMatch = documentText.match(/\[Document:\s*(.*?)\]/);
        const fileMatch = documentText.match(/\[File:\s*(.*?)\]/);
        const sourceName = sourceMatch?.[1] || fileMatch?.[1] || "document";

        // One-off attachments are deliberately ephemeral: build a bounded RAG
        // context in memory, send only that context to the local analyzer, and
        // never create Spectrum Graph document-chunk nodes.
        setProcessingPhase(`Preparing ephemeral context for "${sourceName}"…`);
        const ragJson = await invoke<string>("rag_query", {
          documentText,
          query: input,
          source: sourceName,
        });
        const ragResult: { context: string; chunks_used: number; total_chunks: number; source: string; rag_used: boolean } = JSON.parse(ragJson);

        const modelName = settings.defaultModel || DEFAULT_MODEL;
        setProcessingPhase(`Analyzing with ${modelName} (${ragResult.rag_used ? ragResult.chunks_used + " chunks" : "full doc"})…`);

        const docResponse = await invoke<string>("analyze_document_context", {
          context: ragResult.context,
          query: input,
          source: sourceName,
          model: modelName,
          maxTokens: settings.maxTokens || 4096,
        });

        const ragBadge = ragResult.rag_used
          ? `RAG: ${ragResult.chunks_used}/${ragResult.total_chunks} chunks`
          : "Full document";
        const metaLine = `\n\n───\n📄 Document Analysis · ${sourceName} · ${ragBadge} · ${modelName} · ephemeral attachment · fixed loopback typed boundary`;

        const docMsgId = crypto.randomUUID();
        const aiMsg: Message = {
          id: docMsgId,
          role: "ai",
          content: docResponse + metaLine,
          timestamp: new Date(),
          agent: "Document Analyst",
        };
        setMessages((prev) => [...prev, aiMsg]);

        onIntentProcessed("Document Analyst");
        runInBackground("Document suggestions", () => refreshSuggestions(input, docMsgId));

      } else if (imageData) {
        // ── Vision path: Smart Model Routing (Phase 6) ──
        setProcessingPhase("Checking Ollama connection…");
        const ollamaOk = await invoke<boolean>("check_local_inference_status");
        if (!ollamaOk) {
          throw new Error("Ollama is not running. Please start Ollama first: ollama serve");
        }

        setProcessingPhase("Routing to vision model…");
        const routeJson = await invoke<string>("smart_route_model", {
          userModel: settings.defaultModel || DEFAULT_MODEL,
          hasImage: true,
          hasDocument: false,
        });
        const route: { model: string; auto_swapped: boolean; original_model: string; reason: string; is_vision: boolean } = JSON.parse(routeJson);
        if (!route.is_vision) {
          throw new Error(
            `${route.reason} Install a supported local vision model such as gemma3:4b, qwen2.5vl:7b, or llama3.2-vision, then retry.`,
          );
        }

        setProcessingPhase(`Analyzing image with ${route.model}…`);
        const response = await invoke<string>("query_ollama_vision", {
          prompt: input,
          imageData,
          model: route.model,
        });

        const routeBadge = route.auto_swapped
          ? `🔄 Auto-routed: ${route.original_model} → ${route.model}`
          : `Model: ${route.model}`;

        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: response + `\n\n───\n👁️ Vision · ${routeBadge} · fixed loopback inference boundary`,
          timestamp: new Date(),
          agent: "Vision",
        };
        setMessages((prev) => [...prev, aiMsg]);
        onIntentProcessed("Vision");
        runInBackground("Vision suggestions", () => refreshSuggestions(input, aiMsg.id));

      } else {
        // ── Project review path (gated, READ-ONLY) ──
        // "Review this project/codebase …" → metadata-only scan first, then an
        // explicit approval card. Nothing is read until the user approves;
        // nothing is EVER modified or deleted in the reviewed project.
        // Checked before doc-gen because review requests often say "create a report".
        const reviewReq = detectReviewRequest(input);
        if (reviewReq) {
          if (!reviewReq.path) {
            const askMsg: Message = {
              id: crypto.randomUUID(),
              role: "ai",
              content: "I can review an entire project — read-only, with approval gates — and produce a report. Which folder should I look at? Reply with the full path, e.g.:\n\n`review the project at ~/Documents/my-app`",
              timestamp: new Date(),
              agent: "Code Reviewer",
            };
            setMessages((prev) => [...prev, askMsg]);
            onIntentProcessed("Code Reviewer");
            return;
          }

          setProcessingPhase(`Scanning ${reviewReq.path} (metadata only)…`);
          const previewJson = await invoke<string>("scan_project_for_review", { path: reviewReq.path });
          const p = JSON.parse(previewJson) as {
            scan_id: string; root: string; project_name: string; total_files: number;
            candidate_files: number; total_candidate_bytes: number; llm_files: number;
            skipped_dirs: string[]; top_extensions: [string, number][]; truncated: boolean;
          };

          const review: ReviewRequest = {
            scanId: p.scan_id,
            root: p.root,
            projectName: p.project_name,
            totalFiles: p.total_files,
            candidateFiles: p.candidate_files,
            totalCandidateBytes: p.total_candidate_bytes,
            llmFiles: p.llm_files,
            skippedDirs: p.skipped_dirs,
            topExtensions: p.top_extensions,
            truncated: p.truncated,
            status: "pending",
          };
          const gateMsg: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: `🔍 Scan of **${p.project_name}** complete — metadata only, no file contents read yet.\n\nApprove below to start the **read-only** review. I will not modify, create or delete anything in the project; the only output is a report saved in PrismOS's account-private app data outside the reviewed root.`,
            timestamp: new Date(),
            agent: "Code Reviewer",
            reviewRequest: review,
          };
          setMessages((prev) => [...prev, gateMsg]);
          onIntentProcessed("Code Reviewer");
          return;
        }

        // ── Local artifact generation path ──
        // Create a real Word, PowerPoint, PDF, or Excel file instead of merely
        // printing an outline into chat.
        const docKind = detectDocRequest(input);
        if (docKind) {
          setProcessingPhase("Checking Ollama connection…");
          const ollamaOk = await invoke<boolean>("check_local_inference_status");
          if (!ollamaOk) {
            throw new Error("Ollama is not running. Please start Ollama first: ollama serve");
          }

          // Documents include a concise Decision Record by default; the user
          // can opt out with phrasing like "without the rationale". Raw hidden
          // model reasoning is never copied into the generated file.
          const includeReasoning = !/\b(no|without|skip|hide|omit|drop)\s+(the\s+)?(reasoning|thinking|thought\s*process|rationale)\b/i.test(input);
          const attachment = await generateDocument(docKind, input, {
            model: settings.defaultModel || DEFAULT_MODEL,
            maxTokens: settings.maxTokens || 4096,
            onPhase: setProcessingPhase,
            includeReasoning,
          });

          const kindLabel = {
            pptx: "PowerPoint presentation",
            docx: "Word document",
            pdf: "PDF document",
            xlsx: "Excel workbook",
          }[docKind];
          const agentLabel = {
            pptx: "Presentation Builder",
            docx: "Document Writer",
            pdf: "PDF Publisher",
            xlsx: "Workbook Builder",
          }[docKind];
          const reasoningNote = includeReasoning ? " It ends with a Decision Record covering choices, assumptions, and verification limits." : "";
          const fallbackNote = attachment.generationNotice
            ? `\n\n⚠️ ${attachment.generationNotice}`
            : "";
          const aiMsg: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: `✅ Created your ${kindLabel} — **${attachment.filename}** — and saved it locally.${reasoningNote}${fallbackNote}\n\n───\n📎 ${docKind.toUpperCase()} · generated on this device`,
            timestamp: new Date(),
            agent: agentLabel,
            attachment,
          };
          setMessages((prev) => [...prev, aiMsg]);
          onIntentProcessed(aiMsg.agent);
          runInBackground("Artifact suggestions", () => refreshSuggestions(input, aiMsg.id));
          return;
        }

        // ── Standard text path (Refractive Core pipeline) ──
        const resultJson = await refractIntentWithRetry(
          input,
          settings.defaultModel || DEFAULT_MODEL,
          undefined,
          { requestId: activityTaskId },
        );
        const result: RefractiveResult = JSON.parse(resultJson);
        const actualModel = result.inference?.actual.identity_attested
          ? result.inference.actual.model_id
          : result.inference?.requested.model_id || settings.defaultModel || DEFAULT_MODEL;
        const localityLabel = result.inference?.backend_offline_attested
          ? "verified offline"
          : result.inference
            ? "fixed loopback · offline not attested"
            : "local";

        // Build a clean, minimal footer — no internal debug info
        const timeSec = result.processing_time_ms
          ? `${(result.processing_time_ms / 1000).toFixed(1)}s`
          : "";
        const adaptiveFastPath =
          result.judge_graded === false && result.max_iterations === 1;
        const qualityUnapproved =
          result.judge_graded === false ||
          (result.judge_graded === true && result.validated !== true);
        const consensusIcon = adaptiveFastPath
          ? "⚡"
          : qualityUnapproved
          ? "⚠️"
          : result.collaboration?.consensus_approved
            ? "✅"
            : "🛡️";
        // Goal-loop badge distinguishes a real accepted model grade from a
        // rejected/unvalidated grade and from the availability fallback.
        const loopBadge =
          adaptiveFastPath
            ? " · adaptive single pass"
            : result.judge_graded === false
            ? " · ⚠ unjudged best-effort"
            : result.validated === true
            ? ` · ✓ judged${result.iterations_used && result.iterations_used > 1 ? ` (${result.iterations_used} passes)` : ""}`
            : result.judge_graded === true
              ? ` · ⚠ judged but unvalidated${result.iterations_used && result.iterations_used > 1 ? ` (${result.iterations_used} passes)` : ""}`
              : "";
        const metaLine = timeSec
          ? `\n\n───\n${consensusIcon} ${timeSec} · ${actualModel} · ${localityLabel}${loopBadge}`
          : "";

        const aiContent = result.response + metaLine;
        const responseCanDriveSideEffects =
          result.validated === true && result.collaboration?.consensus_approved !== false;
        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: aiContent,
          timestamp: new Date(),
          agent: result.agent_used,
          contextNodes: result.context_nodes,
          conversationId: result.conversation_id,
          userQuestion: input,
          transparency: {
            query_type: result.query_type || result.intent.intent_type || "Unknown",
            natural_band: result.natural_band || result.agent_used || "default",
            applied_band: result.applied_band || result.agent_used || "default",
            context_nodes_used: result.context_nodes?.length ?? 0,
            model_used: actualModel,
            domain_detected: result.domain_detected || "General",
          },
        };
        setMessages((prev) => [...prev, aiMsg]);

        if (voiceEnabled && responseCanDriveSideEffects) {
          voiceSpeak(result.response);
        }

        onIntentProcessed(
          result.agent_used,
          result.collaboration ?? undefined,
          result.collaboration?.debate ?? null,
          {
            context_node_ids: result.context_nodes ?? [],
            reinforced_edge_ids: result.edges_reinforced ?? [],
            recorded_at: new Date().toISOString(),
            validated: result.validated === true,
          },
        );

        if (responseCanDriveSideEffects) {
          // Only a validated, released response may strengthen memory, seed
          // suggestions, or become the source for another generated variant.
          runInBackground("Post-response enrichment", async () => {
            try {
              const keywords = input.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
              if (keywords.length > 0) {
                await invoke("strengthen_related_edges", { keywords });
              }
            } catch { /* graph reinforcement is optional */ }

            await refreshSuggestions(input, aiMsg.id);

            // The alternative perspective is optional and may arrive after the
            // composer is ready for the next turn.
            await generateRefractionAlternative(input, aiMsg.id);
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, buildErrorMessage(err, settings)]);
    } finally {
      if (processingTimerRef.current) {
        clearInterval(processingTimerRef.current);
        processingTimerRef.current = null;
      }
      setIsProcessing(false);
      setProcessingPhase("");
      setProcessingElapsed(0);
    }
  }

  // Keep ref in sync so event listeners always call the latest handleIntent
  handleIntentRef.current = handleIntent;

  // ── Prism Refraction — background alternative perspective generation ──
  // After the primary response is shown, this fires a background request
  // to generate an alternative from a contrasting cognitive band.
  async function generateRefractionAlternative(question: string, messageId: string) {
    try {
      const resultJson = await invoke<string>("generate_refraction_alternative", {
        question,
        model: settings.defaultModel || DEFAULT_MODEL,
      });
      const alt: RefractionAlternative = JSON.parse(resultJson);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, refractionAlternative: alt } : m))
      );
    } catch (e) {
      // Non-critical — if refraction fails, the primary response is still there.
      console.warn("[Refraction] Alternative generation failed:", e);
    }
  }

  // ── Prism Refraction — user selects preferred cognitive band ──
  // When the user clicks "Prefer this style", we signal the backend
  // to reinforce that band in the cognitive profile.
  async function selectRefractionPreference(band: string) {
    try {
      await invoke("select_refraction_preference", { band });
    } catch (e) {
      console.warn("[Refraction] Preference signal failed:", e);
    }
  }

  // ── Response Feedback — closed-loop learning ──
  // When a user clicks 👍 or 👎, this sends the signal to the Spectrum Graph
  // so edge weights are adjusted and good answers become few-shot examples.
  async function submitFeedback(messageId: string, rating: "good" | "bad") {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== "ai") return;

    const ratingValue = rating === "good" ? 1 : -1;

    try {
      await invoke("submit_response_feedback", {
        conversationId: msg.conversationId || "",
        question: msg.userQuestion || "",
        response: msg.content,
        rating: ratingValue,
        contextNodes: msg.contextNodes || [],
        model: msg.transparency?.model_used || settings.defaultModel || DEFAULT_MODEL,
      });

      // Update local message state with feedback
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m))
      );
    } catch (e) {
      console.error("[Feedback] Failed to submit:", e);
    }
  }

  // ── Project Review approval gates ──
  // Approve: consumes the scan_id (one-shot token) and runs the read-only review.
  async function approveProjectReview(messageId: string) {
    const msg = messages.find((m) => m.id === messageId);
    const review = msg?.reviewRequest;
    if (!review || review.status !== "pending") return;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.reviewRequest
          ? { ...m, reviewRequest: { ...m.reviewRequest, status: "approved" } }
          : m,
      ),
    );

    setIsProcessing(true);
    processingStartRef.current = Date.now();
    setProcessingElapsed(0);
    processingTimerRef.current = setInterval(() => {
      setProcessingElapsed(Math.floor((Date.now() - processingStartRef.current) / 1000));
    }, 1000);
    clearLiveSteps(review.scanId);
    setProcessingPhase(`Reviewing ${review.projectName} (read-only)…`);

    try {
      const reportJson = await invoke<string>("run_project_review", {
        scanId: review.scanId,
        model: settings.defaultModel || null,
      });
      const report = JSON.parse(reportJson) as ReviewReportPayload;

      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: formatReportMarkdown(report),
        timestamp: new Date(),
        agent: "Code Reviewer",
        attachment: {
          path: report.report_docx_path,
          filename: report.report_docx_filename,
          kind: "docx",
        },
      };
      setMessages((prev) => [...prev, aiMsg]);
      onIntentProcessed("Code Reviewer");
    } catch (err) {
      setMessages((prev) => [...prev, buildErrorMessage(err, settings)]);
    } finally {
      if (processingTimerRef.current) {
        clearInterval(processingTimerRef.current);
        processingTimerRef.current = null;
      }
      setIsProcessing(false);
      setProcessingPhase("");
      setProcessingElapsed(0);
    }
  }

  // Decline: discards the pending scan server-side; nothing was ever read.
  async function declineProjectReview(messageId: string) {
    const msg = messages.find((m) => m.id === messageId);
    const review = msg?.reviewRequest;
    if (!review || review.status !== "pending") return;

    try {
      await invoke("cancel_project_review", { scanId: review.scanId });
    } catch {
      // State cleanup is best-effort; the scan_id is one-shot anyway.
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.reviewRequest
          ? { ...m, reviewRequest: { ...m.reviewRequest, status: "declined" } }
          : m,
      ),
    );
  }

  return {
    messages,
    isProcessing,
    processingPhase,
    processingElapsed,
    pendingIntent,
    setPendingIntent,
    conversationRef,
    handleIntent,
    clearConversation,
    submitFeedback,
    selectRefractionPreference,
    approveProjectReview,
    declineProjectReview,
  };
}

// ── Helper: build user-friendly error messages ──
function buildErrorMessage(err: unknown, settings: AppSettings): Message {
  const inferenceFailure = parseRefractCommandFailure(err);
  const errorStr = inferenceFailure?.message ?? String(err);
  const recoveryModel = settings.defaultModel || DEFAULT_MODEL;
  const isOllamaError = errorStr.includes("connection") || errorStr.includes("refused") || errorStr.includes("timeout") || errorStr.includes("error sending request") || errorStr.includes("fetch");
  const isModelError = errorStr.includes("model") || errorStr.includes("not found");
  const isVisionModelError = errorStr.toLowerCase().includes("vision-capable model");
  const isArtifactError = /artifact|presentation spec|document spec|workbook spec|pdf spec/i.test(errorStr);

  let content: string;
  if (inferenceFailure?.backend === "aivm_loopback") {
    content = `⚠️ The selected storage-native model did not complete.\n\n${errorStr}\n\nNo second legacy or Ollama text-inference attempt, alternate text model, or online text service was run after this failure. Earlier embedding or retrieval work may already have used the fixed-loopback Ollama service. Your text-generation request was stopped without fallback.`;
  } else if (isVisionModelError) {
    content = `⚠️ No installed vision-capable model is available.\n\n${errorStr}\n\nPrismOS stopped before sending the image to a text-only model.`;
  } else if (isArtifactError) {
    content = `⚠️ The requested file could not be created.\n\n${errorStr}\n\nNo completed artifact was reported. PrismOS validates the outline before writing and will not publish a malformed or ungrounded file.`;
  } else if (isOllamaError) {
    content = `⚠️ Cannot connect to Ollama.\n\nPlease ensure Ollama is running:\n  1. Install from https://ollama.com\n  2. ollama pull ${recoveryModel}\n  3. ollama serve\n\nPrivate inference always connects to:\n  http://localhost:11434\n\nThe configurable Ollama URL in Settings is only for model management/status and does not redirect private prompts. Then try your intent again.`;
  } else if (isModelError) {
    content = `⚠️ Model "${recoveryModel}" not available.\n\nTo fix this:\n  1. ollama pull ${recoveryModel}\n  2. Or switch to a different model in Settings\n\nAvailable models can be listed with:\n  ollama list`;
  } else {
    content = `⚠️ Unable to process your intent.\n\nError: ${errorStr}\n\nTroubleshooting:\n  • Check that Ollama is running: ollama serve\n  • Verify http://localhost:11434/api/tags is reachable\n  • Verify your model is downloaded: ollama list\n  • Try a simpler intent to test the connection\n\nThe Settings Ollama URL controls model management/status only; private inference remains fixed to loopback.`;
  }

  return {
    id: crypto.randomUUID(),
    role: "system",
    content,
    timestamp: new Date(),
  };
}
