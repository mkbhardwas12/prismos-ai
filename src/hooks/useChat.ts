// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// useChat — Messages, intent processing, conversation history

import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, Message, RefractiveResult, RefractionAlternative, CollaborationSummary, DebateSummary } from "../types";

interface UseChatOptions {
  settings: AppSettings;
  onIntentProcessed: (agentUsed?: string, collaboration?: CollaborationSummary, debate?: DebateSummary | null) => void;
  clearLiveSteps: () => void;
  voiceEnabled: boolean;
  voiceSpeak: (text: string) => void;
  refreshSuggestions: (input: string, msgId: string) => Promise<void>;
}

// Retry wrapper for API calls (up to 2 retries with exponential backoff)
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
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
  const [pendingIntent, setPendingIntent] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);

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
  }, []);

  async function handleIntent(input: string, imageData?: string, documentText?: string) {
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
    clearLiveSteps();

    try {
      // ── Document analysis path: RAG-powered document analysis (Phase 6) ──
      if (documentText) {
        setProcessingPhase("Checking Ollama connection…");
        const ollamaOk = await invoke<boolean>("check_ollama_status", { ollamaUrl: settings.ollamaUrl || null });
        if (!ollamaOk) {
          throw new Error("Ollama is not running. Please start Ollama first: ollama serve");
        }

        const sourceMatch = documentText.match(/\[Document:\s*(.*?)\]/);
        const fileMatch = documentText.match(/\[File:\s*(.*?)\]/);
        const sourceName = sourceMatch?.[1] || fileMatch?.[1] || "document";

        setProcessingPhase(`Chunking & indexing "${sourceName}"…`);
        const ragJson = await invoke<string>("rag_query", {
          documentText,
          query: input,
          source: sourceName,
        });
        const ragResult: { context: string; chunks_used: number; total_chunks: number; source: string; rag_used: boolean } = JSON.parse(ragJson);

        const docPrompt = ragResult.rag_used
          ? `The following are the most relevant sections from "${sourceName}" (${ragResult.chunks_used}/${ragResult.total_chunks} sections retrieved via RAG):\n\n---\n${ragResult.context}\n---\n\nUser request: ${input}`
          : `Here is a document for analysis:\n\n---\n${ragResult.context}\n---\n\nUser request: ${input}`;

        const modelName = settings.defaultModel || "llama3.2";
        setProcessingPhase(`Analyzing with ${modelName} (${ragResult.rag_used ? ragResult.chunks_used + " chunks" : "full doc"})…`);

        const docResponse = await invoke<string>("query_ollama", {
          prompt: docPrompt,
          model: modelName,
          ollamaUrl: settings.ollamaUrl || null,
          maxTokens: settings.maxTokens || 4096,
        });

        const ragBadge = ragResult.rag_used
          ? `RAG: ${ragResult.chunks_used}/${ragResult.total_chunks} chunks`
          : "Full document";
        const metaLine = `\n\n───\n📄 Document Analysis · ${sourceName} · ${ragBadge} · ${modelName} · 100% local`;

        const docMsgId = crypto.randomUUID();
        const aiMsg: Message = {
          id: docMsgId,
          role: "ai",
          content: docResponse + metaLine,
          timestamp: new Date(),
          agent: "Document Analyst",
        };
        setMessages((prev) => [...prev, aiMsg]);

        invoke("index_document_chunks", { text: documentText, source: sourceName }).catch(() => {});
        onIntentProcessed("Document Analyst");
        await refreshSuggestions(input, docMsgId);

      } else if (imageData) {
        // ── Vision path: Smart Model Routing (Phase 6) ──
        setProcessingPhase("Checking Ollama connection…");
        const ollamaOk = await invoke<boolean>("check_ollama_status", { ollamaUrl: settings.ollamaUrl || null });
        if (!ollamaOk) {
          throw new Error("Ollama is not running. Please start Ollama first: ollama serve");
        }

        setProcessingPhase("Routing to vision model…");
        const routeJson = await invoke<string>("smart_route_model", {
          userModel: settings.defaultModel || "mistral",
          hasImage: true,
          hasDocument: false,
          ollamaUrl: settings.ollamaUrl || null,
        });
        const route: { model: string; auto_swapped: boolean; original_model: string; reason: string; is_vision: boolean } = JSON.parse(routeJson);

        setProcessingPhase(`Analyzing image with ${route.model}…`);
        const response = await invoke<string>("query_ollama_vision", {
          prompt: input,
          imageData,
          model: route.model,
          ollamaUrl: settings.ollamaUrl || null,
        });

        const routeBadge = route.auto_swapped
          ? `🔄 Auto-routed: ${route.original_model} → ${route.model}`
          : `Model: ${route.model}`;

        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: response + `\n\n───\n👁️ Vision · ${routeBadge} · 100% local`,
          timestamp: new Date(),
          agent: "Vision",
        };
        setMessages((prev) => [...prev, aiMsg]);
        onIntentProcessed("Vision");
        await refreshSuggestions(input, aiMsg.id);

      } else {
        // ── Standard text path (Refractive Core pipeline) ──
        try {
          const resultJson = await withRetry(() => invoke<string>("refract_intent", { input, model: settings.defaultModel || "mistral" }));
          const result: RefractiveResult = JSON.parse(resultJson);

          // Build a clean, minimal footer — no internal debug info
          const timeSec = result.processing_time_ms
            ? `${(result.processing_time_ms / 1000).toFixed(1)}s`
            : "";
          const consensusIcon = result.collaboration?.consensus_approved ? "✅" : "🛡️";
          const metaLine = timeSec
            ? `\n\n───\n${consensusIcon} ${timeSec} · ${settings.defaultModel || "local"} · 100% private`
            : "";

          const aiContent = result.response + metaLine;
          const aiMsg: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: aiContent,
            timestamp: new Date(),
            agent: result.agent_used,
            contextNodes: result.context_nodes,
            conversationId: result.conversation_id,
            userQuestion: input,
          };
          setMessages((prev) => [...prev, aiMsg]);

          if (voiceEnabled) {
            voiceSpeak(result.response);
          }

          onIntentProcessed(result.agent_used, result.collaboration ?? undefined, result.collaboration?.debate ?? null);

          // Alive Graph: auto-strengthen related edges
          try {
            const keywords = input.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
            if (keywords.length > 0) {
              await invoke("strengthen_related_edges", { keywords });
            }
          } catch { /* non-critical */ }

          await refreshSuggestions(input, aiMsg.id);

          // ── Prism Refraction: generate alternative perspective in background ──
          // Non-blocking — fires after the primary response is already displayed.
          // The alternative appears as an expandable "See another perspective" option.
          generateRefractionAlternative(input, aiMsg.id);

        } catch (e) {
          // Fallback to legacy process_intent if refract_intent fails
          try {
            const response = await invoke<string>("process_intent", { input });
            const aiMsg: Message = {
              id: crypto.randomUUID(),
              role: "ai",
              content: response,
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, aiMsg]);
            onIntentProcessed();
            await refreshSuggestions(input, aiMsg.id);
          } catch (fallbackErr) {
            setMessages((prev) => [...prev, buildErrorMessage(fallbackErr, settings)]);
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, buildErrorMessage(err, settings)]);
    } finally {
      setIsProcessing(false);
      setProcessingPhase("");
    }
  }

  // Keep ref in sync so event listeners always call the latest handleIntent
  handleIntentRef.current = handleIntent;

  // ── Contextual Screen Awareness (Phase 7) ──
  // Captures the screen via Rust, sends to a local vision model, and injects
  // the extracted context into the conversation as if the user pasted it.
  async function handleScreenRead(userPrompt?: string) {
    const label = userPrompt?.trim() || "Summarize what I'm looking at";

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: `🖥️ [Screen Read]\n${label}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    clearLiveSteps();

    try {
      setProcessingPhase("Capturing screen…");

      const resultJson = await invoke<string>("read_screen", {
        prompt: label,
        ollamaUrl: settings.ollamaUrl || null,
      });

      const result: { context: string; model: string; auto_routed: boolean } =
        JSON.parse(resultJson);

      setProcessingPhase("");

      const metaLine = `\n\n───\n🖥️ Screen Read · ${result.model}${result.auto_routed ? " (auto-routed)" : ""} · 100% local`;
      const aiMsgId = crypto.randomUUID();
      const aiMsg: Message = {
        id: aiMsgId,
        role: "ai",
        content: result.context + metaLine,
        timestamp: new Date(),
        agent: "Screen Reader",
      };
      setMessages((prev) => [...prev, aiMsg]);

      if (voiceEnabled) {
        voiceSpeak(result.context);
      }

      onIntentProcessed("Screen Reader");
      await refreshSuggestions(label, aiMsgId);
    } catch (err) {
      setMessages((prev) => [...prev, buildErrorMessage(err, settings)]);
    } finally {
      setIsProcessing(false);
      setProcessingPhase("");
    }
  }

  // ── Prism Refraction — background alternative perspective generation ──
  // After the primary response is shown, this fires a background request
  // to generate an alternative from a contrasting cognitive band.
  async function generateRefractionAlternative(question: string, messageId: string) {
    try {
      const resultJson = await invoke<string>("generate_refraction_alternative", {
        question,
        model: settings.defaultModel || "mistral",
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
        model: settings.defaultModel || "mistral",
      });

      // Update local message state with feedback
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m))
      );
    } catch (e) {
      console.error("[Feedback] Failed to submit:", e);
    }
  }

  return {
    messages,
    isProcessing,
    processingPhase,
    pendingIntent,
    setPendingIntent,
    conversationRef,
    handleIntent,
    handleScreenRead,
    clearConversation,
    submitFeedback,
    selectRefractionPreference,
  };
}

// ── Helper: build user-friendly error messages ──
function buildErrorMessage(err: unknown, settings: AppSettings): Message {
  const errorStr = String(err);
  const isOllamaError = errorStr.includes("connection") || errorStr.includes("refused") || errorStr.includes("timeout") || errorStr.includes("error sending request") || errorStr.includes("fetch");
  const isModelError = errorStr.includes("model") || errorStr.includes("not found");

  let content: string;
  if (isOllamaError) {
    content = `⚠️ Cannot connect to Ollama.\n\nPlease ensure Ollama is running:\n  1. Install from https://ollama.com\n  2. ollama pull ${settings.defaultModel}\n  3. ollama serve\n\nIf Ollama is running, check that it's accessible at:\n  ${settings.ollamaUrl}\n\nThen try your intent again.`;
  } else if (isModelError) {
    content = `⚠️ Model "${settings.defaultModel}" not available.\n\nTo fix this:\n  1. ollama pull ${settings.defaultModel}\n  2. Or switch to a different model in Settings\n\nAvailable models can be listed with:\n  ollama list`;
  } else {
    content = `⚠️ Unable to process your intent.\n\nError: ${errorStr}\n\nTroubleshooting:\n  • Check that Ollama is running: ollama serve\n  • Verify your model is downloaded: ollama list\n  • Check Settings for the correct Ollama URL\n  • Try a simpler intent to test the connection`;
  }

  return {
    id: crypto.randomUUID(),
    role: "system",
    content,
    timestamp: new Date(),
  };
}
