// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Main View — Intent Console + Conversation

import { useState, useRef, useEffect, useCallback, useMemo, memo, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "framer-motion";
import prismosLogo from "../assets/prismos-logo.svg";
import prismosIcon from "../assets/prismos-icon.svg";
import IntentInput from "./IntentInput";
import DailyBrief from "./DailyBrief";
import UserGuide from "./UserGuide";
import SuggestionCard from "./SuggestionCard";
import { useVoice } from "../hooks/useVoice";
import { generateFollowUpSuggestions } from "../lib/suggestions";
import type { AppSettings, Message, RefractiveResult, CollaborationSummary, DebateSummary, OllamaModel, AgentActivity, ProactiveSuggestion } from "../types";
import "./MainView.css";

interface MainViewProps {
  ollamaConnected: boolean;
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
  onIntentProcessed: (agentUsed?: string, collaboration?: CollaborationSummary, debate?: DebateSummary | null) => void;
  liveAgentSteps: AgentActivity[];
  clearLiveSteps: () => void;
  startupSuggestions: ProactiveSuggestion[];
  dailyGreeting: string;
}

type SetupStep = "install" | "start" | "model" | "ready";

export default function MainView({
  ollamaConnected,
  settings,
  onSettingsChange,
  onIntentProcessed,
  liveAgentSteps,
  clearLiveSteps,
  startupSuggestions,
  dailyGreeting,
}: MainViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingIntent, setPendingIntent] = useState("");
  const [proactiveSuggestions, setProactiveSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [messageSuggestions, setMessageSuggestions] = useState<Record<string, ProactiveSuggestion[]>>({});
  const conversationRef = useRef<HTMLDivElement>(null);

  // P1: Seed proactive suggestions from startup (before user's first intent)
  useEffect(() => {
    if (startupSuggestions.length > 0 && proactiveSuggestions.length === 0 && messages.length === 0) {
      setProactiveSuggestions(startupSuggestions);
    }
  }, [startupSuggestions]);

  // Listen for sidebar proactive clicks — auto-fill intent box
  useEffect(() => {
    const fillHandler = (e: Event) => {
      const intent = (e as CustomEvent<string>).detail;
      if (intent) setPendingIntent(intent);
    };
    const processHandler = (e: Event) => {
      const intent = (e as CustomEvent<string>).detail;
      if (intent) handleIntent(intent);
    };
    window.addEventListener("prismos:fill-intent", fillHandler);
    window.addEventListener("prismos:process-intent", processHandler);
    return () => {
      window.removeEventListener("prismos:fill-intent", fillHandler);
      window.removeEventListener("prismos:process-intent", processHandler);
    };
  }, []);

  // ── Inline model selector state ──
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string | null>(null);
  const [pullPercent, setPullPercent] = useState<number>(0);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Recommended models catalog — shown in dropdown for easy install
  const RECOMMENDED_MODELS = useMemo(() => [
    { name: "mistral", label: "Mistral 7B", desc: "Great all-rounder", size: "4.1 GB" },
    { name: "llama3.2", label: "Llama 3.2 3B", desc: "Fast & lightweight", size: "2.0 GB" },
    { name: "phi3", label: "Phi-3 3.8B", desc: "Strong reasoning", size: "2.2 GB" },
    { name: "llama3.1", label: "Llama 3.1 8B", desc: "Best quality", size: "4.7 GB" },
    { name: "gemma2:2b", label: "Gemma 2 2B", desc: "Ultra-light", size: "1.6 GB" },
    { name: "deepseek-r1", label: "DeepSeek R1 8B", desc: "Chain-of-thought", size: "4.7 GB" },
    { name: "qwen2.5", label: "Qwen 2.5 7B", desc: "Multilingual", size: "4.7 GB" },
    { name: "codellama", label: "Code Llama 7B", desc: "Code specialist", size: "3.8 GB" },
  ], []);

  // Ollama setup wizard state
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  const [hasModels, setHasModels] = useState<boolean | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [wizardExpanded, setWizardExpanded] = useState(false);

  // First-time setup wizard modal (shows only on first launch)
  const [showFirstTimeWizard, setShowFirstTimeWizard] = useState(
    () => !localStorage.getItem("prismos-setup-done")
  );

  const dismissFirstTimeWizard = useCallback(() => {
    localStorage.setItem("prismos-setup-done", "1");
    setShowFirstTimeWizard(false);
  }, []);

  // Determine which setup step the user is on
  const getSetupStep = useCallback((): SetupStep => {
    if (ollamaConnected && hasModels) return "ready";
    if (ollamaConnected && hasModels === false) return "model";
    if (ollamaConnected) return "model"; // Connected but haven't checked models yet
    return "start"; // Ollama not connected
  }, [ollamaConnected, hasModels]);

  // Check if Ollama has models when it connects
  useEffect(() => {
    if (ollamaConnected) {
      (async () => {
        try {
          const result = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
          const models = JSON.parse(result);
          setHasModels(Array.isArray(models) && models.length > 0);
        } catch {
          setHasModels(false);
        }
      })();
    } else {
      setHasModels(null);
    }
  }, [ollamaConnected]);

  // Voice output (TTS) — speaks AI responses aloud when enabled
  const voiceOutput = useVoice(() => {}, settings.voiceOutputEnabled ?? false);

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

        // Reconstruct messages from saved conversations (most recent 20)
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

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  const clearConversation = useCallback(() => {
    setMessages([]);
  }, []);

  // ── Ollama Setup Actions ──
  const handleStartOllama = useCallback(async () => {
    setIsLaunching(true);
    setLaunchStatus(null);
    try {
      const result = await invoke<string>("launch_ollama");
      setLaunchStatus(result);
      // Poll for connection a few times
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const connected = await invoke<boolean>("check_ollama_status", { ollamaUrl: settings.ollamaUrl });
          if (connected) {
            setLaunchStatus("✅ Ollama is running!");
            break;
          }
        } catch { /* keep trying */ }
      }
    } catch (e) {
      setLaunchStatus(`❌ ${String(e)}`);
    } finally {
      setIsLaunching(false);
    }
  }, []);

  // ── Fetch available models when connected & dropdown opens ──
  useEffect(() => {
    if (!ollamaConnected || !modelDropdownOpen) return;
    (async () => {
      try {
        const result = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
        setAvailableModels(JSON.parse(result));
      } catch {
        setAvailableModels([]);
      }
    })();
  }, [ollamaConnected, modelDropdownOpen, settings.ollamaUrl]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelDropdownOpen]);

  const selectModel = useCallback((name: string) => {
    onSettingsChange({ ...settings, defaultModel: name });
    setModelDropdownOpen(false);
  }, [settings, onSettingsChange]);

  const pullModelFromDropdown = useCallback(async (modelName: string) => {
    setPullingModel(modelName);
    setPullProgress("Starting download…");
    setPullPercent(0);

    // Listen for streaming progress events from the Rust backend
    const unlisten = await listen<{ model: string; status: string; completed: number; total: number; percent: number }>(
      "pull-progress",
      (event) => {
        const { status, completed, total, percent } = event.payload;
        if (total > 0) {
          const mb = (completed / 1_000_000).toFixed(0);
          const totalMb = (total / 1_000_000).toFixed(0);
          setPullProgress(`${status} — ${mb} / ${totalMb} MB (${percent}%)`);
          setPullPercent(percent);
        } else if (status) {
          setPullProgress(status);
        }
      }
    );

    try {
      const result = await invoke<string>("pull_ollama_model", { model: modelName, ollamaUrl: settings.ollamaUrl });
      setPullProgress(`✅ ${result}`);
      setPullPercent(100);
      // Refresh model list
      const listResult = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
      setAvailableModels(JSON.parse(listResult));
      // Auto-select the newly pulled model
      onSettingsChange({ ...settings, defaultModel: modelName });
      setTimeout(() => { setPullingModel(null); setPullProgress(null); setPullPercent(0); }, 2000);
    } catch (e) {
      setPullProgress(`❌ ${String(e)}`);
      setTimeout(() => { setPullingModel(null); setPullProgress(null); setPullPercent(0); }, 4000);
    } finally {
      unlisten();
    }
  }, [settings, onSettingsChange]);

  const handleRetryConnection = useCallback(async () => {
    setIsRetrying(true);
    try {
      await invoke<boolean>("check_ollama_status", { ollamaUrl: settings.ollamaUrl });
    } catch { /* ignore */ }
    // Parent checkOllama interval will pick up the change
    setTimeout(() => setIsRetrying(false), 2000);
  }, []);

  const handlePullModel = useCallback(async () => {
    const model = settings.defaultModel || "llama3.2";
    setIsPulling(true);
    setPullStatus(`Pulling ${model}... this may take a few minutes`);
    try {
      const result = await invoke<string>("pull_ollama_model", { model, ollamaUrl: settings.ollamaUrl });
      setPullStatus(`✅ ${result}`);
      setHasModels(true);
    } catch (e) {
      setPullStatus(`❌ ${String(e)}`);
    } finally {
      setIsPulling(false);
    }
  }, [settings.defaultModel]);

  // P3: Retry wrapper for API calls (up to 2 retries with exponential backoff)
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
    clearLiveSteps(); // Phase 2: clear previous live steps

    try {
      // ── Document analysis path: document text attached ──
      if (documentText) {
        // Truncate document text if extremely long (keep first ~12000 chars for model context)
        const maxDocLen = 12000;
        const truncatedDoc = documentText.length > maxDocLen
          ? documentText.slice(0, maxDocLen) + `\n\n[... truncated ${documentText.length - maxDocLen} chars ...]`
          : documentText;

        // Build a rich prompt with the document content as context
        const docPrompt = `Here is a document for analysis:\n\n---\n${truncatedDoc}\n---\n\nUser request: ${input}`;

        // Use the standard Ollama query with the enriched prompt
        const response = await invoke<string>("query_ollama", {
          prompt: docPrompt,
          model: settings.defaultModel || "mistral",
          ollamaUrl: settings.ollamaUrl || null,
        });

        const docMeta = documentText.match(/\[Document:.*?\]/) || documentText.match(/\[File:.*?\]/);
        const metaLine = docMeta ? `\n\n───\n📄 Document Analysis · ${docMeta[0]} · 100% local` : "\n\n───\n📄 Document Analysis · 100% local";

        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: response + metaLine,
          timestamp: new Date(),
          agent: "Document Analyst",
        };
        setMessages((prev) => [...prev, aiMsg]);
        onIntentProcessed("Document Analyst");

        // Generate follow-up suggestions
        try {
          const sugJson = await invoke<string>("get_proactive_suggestions");
          const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
          const enriched = generateFollowUpSuggestions(input, sug);
          setProactiveSuggestions(enriched);
          setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: enriched.slice(0, 3) }));
        } catch {
          const fallback = generateFollowUpSuggestions(input, []);
          setProactiveSuggestions(fallback);
          setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: fallback.slice(0, 3) }));
        }
      } else if (imageData) {
        const visionModel = settings.defaultModel?.includes("llava") || settings.defaultModel?.includes("vision")
          ? settings.defaultModel
          : "llava";  // Default to llava for vision tasks
        const response = await invoke<string>("query_ollama_vision", {
          prompt: input,
          imageData,
          model: visionModel,
          ollamaUrl: settings.ollamaUrl || null,
        });

        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          content: response + "\n\n───\n👁️ Vision · Model: " + visionModel + " · 100% local",
          timestamp: new Date(),
          agent: "Vision",
        };
        setMessages((prev) => [...prev, aiMsg]);
        onIntentProcessed("Vision");

        // Generate follow-up suggestions
        try {
          const sugJson = await invoke<string>("get_proactive_suggestions");
          const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
          const enriched = generateFollowUpSuggestions(input, sug);
          setProactiveSuggestions(enriched);
          setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: enriched.slice(0, 3) }));
        } catch {
          const fallback = generateFollowUpSuggestions(input, []);
          setProactiveSuggestions(fallback);
          setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: fallback.slice(0, 3) }));
        }
      } else {
        // ── Standard text path (existing Refractive Core pipeline) ──
        try {
          // Use full Refractive Core pipeline (Patent Pending) — with retry
          const resultJson = await withRetry(() => invoke<string>("refract_intent", { input }));
          const result: RefractiveResult = JSON.parse(resultJson);

          // Build metadata footer
          const metaParts: string[] = [];
          if (result.agent_used) metaParts.push(`Agent: ${result.agent_used}`);
          if (result.processing_time_ms) metaParts.push(`${result.processing_time_ms}ms`);
          if (result.npu_accelerated) metaParts.push("NPU⚡");
          if (result.context_nodes?.length) metaParts.push(`${result.context_nodes.length} ctx nodes`);
          if (result.edges_reinforced?.length) metaParts.push(`${result.edges_reinforced.length} edges reinforced`);

          // Collaboration trace
          if (result.collaboration) {
            const c = result.collaboration;
            metaParts.push(`🔗 ${c.approve_count}/${c.vote_count} consensus`);
            metaParts.push(`💬 ${c.message_count} agent msgs`);
          }

          const metaLine = metaParts.length > 0 ? `\n\n───\n📡 ${metaParts.join(" · ")}` : "";

          // Collaboration consensus line
          const collabLine = result.collaboration
            ? `\n${result.collaboration.consensus_approved ? '✅' : '🛡️'} ${result.collaboration.consensus_summary}`
            : "";

          // Build anticipation hint
          const hintLine = result.anticipations?.length
            ? `\n🔮 ${result.anticipations[0]}`
            : "";

          const aiContent = result.response + metaLine + collabLine + hintLine;
          const aiMsg: Message = {
            id: crypto.randomUUID(),
            role: "ai",
            content: aiContent,
            timestamp: new Date(),
            agent: result.agent_used,
          };
          setMessages((prev) => [...prev, aiMsg]);

          // Voice output — speak the AI response
          if (settings.voiceOutputEnabled) {
            voiceOutput.speak(result.response);
          }

          onIntentProcessed(result.agent_used, result.collaboration ?? undefined, result.collaboration?.debate ?? null);

          // Phase 1 — Alive Graph: auto-strengthen related edges + fetch proactive suggestions
          try {
            const keywords = input.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
            if (keywords.length > 0) {
              await invoke("strengthen_related_edges", { keywords });
            }
            const sugJson = await invoke<string>("get_proactive_suggestions");
            const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
            const enriched = generateFollowUpSuggestions(input, sug);
            setProactiveSuggestions(enriched);
            setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: enriched.slice(0, 3) }));
          } catch {
            const fallback = generateFollowUpSuggestions(input, []);
            setProactiveSuggestions(fallback);
            setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: fallback.slice(0, 3) }));
          }
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

            try {
              const sugJson = await invoke<string>("get_proactive_suggestions");
              const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
              const enriched = generateFollowUpSuggestions(input, sug);
              setProactiveSuggestions(enriched);
              setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: enriched.slice(0, 3) }));
            } catch {
              const fallback = generateFollowUpSuggestions(input, []);
              setProactiveSuggestions(fallback);
              setMessageSuggestions(prev => ({ ...prev, [aiMsg.id]: fallback.slice(0, 3) }));
            }
          } catch (fallbackErr) {
            const errorStr = String(fallbackErr);
            const isOllamaError = errorStr.includes("connection") || errorStr.includes("refused") || errorStr.includes("timeout");
            const isModelError = errorStr.includes("model") || errorStr.includes("not found");
            const errorMsg: Message = {
              id: crypto.randomUUID(),
              role: "system",
              content: isOllamaError
                ? `⚠️ Cannot connect to Ollama.\n\nPlease ensure Ollama is running:\n  1. Install from https://ollama.com\n  2. ollama pull ${settings.defaultModel}\n  3. ollama serve\n\nIf Ollama is running, check that it's accessible at:\n  ${settings.ollamaUrl}\n\nThen try your intent again.`
                : isModelError
                ? `⚠️ Model "${settings.defaultModel}" not available.\n\nTo fix this:\n  1. ollama pull ${settings.defaultModel}\n  2. Or switch to a different model in Settings\n\nAvailable models can be listed with:\n  ollama list`
                : `⚠️ Unable to process your intent.\n\nError: ${errorStr}\n\nTroubleshooting:\n  • Check that Ollama is running: ollama serve\n  • Verify your model is downloaded: ollama list\n  • Check Settings for the correct Ollama URL\n  • Try a simpler intent to test the connection`,
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMsg]);
          }
        }
      } // end if/else documentText/imageData
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <>
      <div className="main-header">
        <h2><img src={prismosIcon} alt="" className="header-icon" /> Intent Console</h2>
        <div className="header-actions">
          {messages.length > 0 && (
            <button
              className="toolbar-btn"
              onClick={clearConversation}
              title="Clear conversation"
            >
              🗑️ Clear
            </button>
          )}
          <div className="ollama-status" ref={modelDropdownRef}>
            <button
              className="model-selector-btn"
              onClick={() => ollamaConnected && setModelDropdownOpen(v => !v)}
              title={ollamaConnected ? "Click to change model" : "Ollama is offline"}
            >
              <span className={`status-dot ${ollamaConnected ? "connected" : ""}`} />
              {ollamaConnected
                ? <><span className="model-selector-label">Ollama ·</span> <strong>{settings.defaultModel}</strong> <span className="model-selector-caret">{modelDropdownOpen ? "▲" : "▼"}</span></>
                : "Ollama Offline"}
            </button>
            {modelDropdownOpen && (
              <div className="model-dropdown">
                {/* ── Installed Models ── */}
                <div className="model-dropdown-header">Installed Models</div>
                {availableModels.length === 0 ? (
                  <div className="model-dropdown-empty">Loading…</div>
                ) : (
                  availableModels.map(m => (
                    <button
                      key={m.name}
                      className={`model-dropdown-item ${settings.defaultModel === m.name ? "active" : ""}`}
                      onClick={() => selectModel(m.name)}
                    >
                      <span className="model-dropdown-name">{m.name}</span>
                      {m.size && <span className="model-dropdown-size">{(m.size / 1e9).toFixed(1)}GB</span>}
                      {settings.defaultModel === m.name && <span className="model-dropdown-check">✓</span>}
                    </button>
                  ))
                )}

                {/* ── Get More Models ── */}
                <div className="model-dropdown-divider" />
                <div className="model-dropdown-header">Get More Models</div>
                {pullingModel && (
                  <div className="model-pull-status">
                    <div className="model-pull-text">
                      <span className="model-pull-spinner">⏳</span> {pullProgress}
                    </div>
                    {pullPercent > 0 && (
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${pullPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {RECOMMENDED_MODELS
                  .filter(r => !availableModels.some(m => m.name.startsWith(r.name)))
                  .map(r => (
                    <button
                      key={r.name}
                      className="model-dropdown-item model-download-item"
                      onClick={() => pullModelFromDropdown(r.name)}
                      disabled={pullingModel !== null}
                    >
                      <div className="model-download-info">
                        <span className="model-dropdown-name">{r.label}</span>
                        <span className="model-download-desc">{r.desc}</span>
                      </div>
                      <span className="model-dropdown-size">{r.size}</span>
                      <span className="model-download-btn">{pullingModel === r.name ? "⏳" : "⬇"}</span>
                    </button>
                  ))}
                {RECOMMENDED_MODELS.filter(r => !availableModels.some(m => m.name.startsWith(r.name))).length === 0 && (
                  <div className="model-dropdown-empty">All recommended models installed ✓</div>
                )}

                {/* ── Response Length ── */}
                <div className="model-dropdown-divider" />
                <div className="model-dropdown-header">Response Length</div>
                <div className="model-tokens-control">
                  <input
                    type="range"
                    min={256}
                    max={8192}
                    step={256}
                    value={settings.maxTokens}
                    onChange={(e) => onSettingsChange({ ...settings, maxTokens: parseInt(e.target.value) })}
                    className="model-tokens-slider"
                  />
                  <div className="model-tokens-labels">
                    <span className="model-tokens-value">{settings.maxTokens} tokens</span>
                    <span className="model-tokens-hint">
                      {settings.maxTokens <= 512 ? "Concise" : settings.maxTokens <= 2048 ? "Standard" : settings.maxTokens <= 4096 ? "Detailed" : "Maximum"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            className="toolbar-btn guide-btn"
            onClick={() => setShowGuide(true)}
            title="User Guide"
            aria-label="Open User Guide"
          >
            📖 Guide
          </button>
        </div>
      </div>

      <div className="conversation-area" ref={conversationRef} role="log" aria-label="Conversation history" aria-live="polite">
        {/* ── Morning Brief / Evening Recap ── */}
        <DailyBrief onSuggestionClick={handleIntent} />

        {messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-icon"><img src={prismosLogo} alt="PrismOS-AI" className="welcome-logo-img" /></div>
            <h1>Welcome to PrismOS-AI</h1>
            <p>
              Your local-first agentic AI operating system. All processing
              happens on your device — your data never leaves.
            </p>

            {/* ── Ollama Setup Wizard ── */}
            {getSetupStep() !== "ready" && (
              <div className={`ollama-setup-wizard ${wizardExpanded ? "wizard-expanded" : "wizard-collapsed"}`} role="alert">
                <div className="setup-wizard-header" onClick={() => setWizardExpanded(v => !v)} style={{ cursor: "pointer" }}>
                  <span className="setup-wizard-icon">🚀</span>
                  <div style={{ flex: 1 }}>
                    <strong className="setup-wizard-title">Quick Setup</strong>
                    <span className="setup-wizard-subtitle">
                      {wizardExpanded
                        ? "Get PrismOS-AI running in 3 steps"
                        : `Step ${getSetupStep() === "start" ? "2" : "3"} — ${getSetupStep() === "start" ? "Start Ollama to continue" : "Pull a model to get started"}`
                      }
                    </span>
                  </div>
                  <span className="wizard-toggle-icon">{wizardExpanded ? "▲" : "▼"}</span>
                </div>

                {wizardExpanded && (
                <div className="setup-steps">
                  {/* Step 1: Install Ollama */}
                  <div className={`setup-step ${ollamaConnected ? "step-done" : "step-active"}`}>
                    <div className="step-indicator">
                      {ollamaConnected ? (
                        <span className="step-check">✓</span>
                      ) : (
                        <span className="step-number">1</span>
                      )}
                    </div>
                    <div className="step-content">
                      <div className="step-label">Install Ollama</div>
                      <div className="step-desc">One-click installer — downloads in seconds</div>
                      {!ollamaConnected && (
                        <button
                          className="step-action-btn"
                          onClick={() => shellOpen("https://ollama.com")}
                        >
                          ⬇️ Download from ollama.com
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Step 2: Start Ollama */}
                  <div className={`setup-step ${ollamaConnected ? "step-done" : getSetupStep() === "start" ? "step-active" : "step-pending"}`}>
                    <div className="step-indicator">
                      {ollamaConnected ? (
                        <span className="step-check">✓</span>
                      ) : (
                        <span className="step-number">2</span>
                      )}
                    </div>
                    <div className="step-content">
                      <div className="step-label">Start Ollama</div>
                      <div className="step-desc">
                        {ollamaConnected
                          ? "Connected and running"
                          : "Open the Ollama app, or click below to start it"}
                      </div>
                      {!ollamaConnected && (
                        <div className="step-actions">
                          <button
                            className="step-action-btn step-action-primary"
                            onClick={handleStartOllama}
                            disabled={isLaunching}
                          >
                            {isLaunching ? (
                              <><span className="btn-spinner" /> Starting…</>
                            ) : (
                              "▶️ Start Ollama"
                            )}
                          </button>
                          <button
                            className="step-action-btn step-action-secondary"
                            onClick={handleRetryConnection}
                            disabled={isRetrying}
                          >
                            {isRetrying ? "Checking…" : "🔄 Retry Connection"}
                          </button>
                        </div>
                      )}
                      {launchStatus && (
                        <div className={`step-status ${launchStatus.startsWith("✅") ? "step-status-ok" : launchStatus.startsWith("❌") ? "step-status-err" : "step-status-info"}`}>
                          {launchStatus}
                        </div>
                      )}
                      {!ollamaConnected && !isLaunching && (
                        <div className="step-hint">
                          Or run <code>ollama serve</code> in your terminal
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Pull a model */}
                  <div className={`setup-step ${hasModels ? "step-done" : ollamaConnected ? "step-active" : "step-pending"}`}>
                    <div className="step-indicator">
                      {hasModels ? (
                        <span className="step-check">✓</span>
                      ) : (
                        <span className="step-number">3</span>
                      )}
                    </div>
                    <div className="step-content">
                      <div className="step-label">Pull a Model</div>
                      <div className="step-desc">
                        {hasModels
                          ? `Model ready — ${settings.defaultModel}`
                          : `Download an AI model to use locally`}
                      </div>
                      {ollamaConnected && !hasModels && (
                        <div className="step-actions">
                          <button
                            className="step-action-btn step-action-primary"
                            onClick={handlePullModel}
                            disabled={isPulling}
                          >
                            {isPulling ? (
                              <><span className="btn-spinner" /> Pulling…</>
                            ) : (
                              `📦 Pull ${settings.defaultModel || "llama3.2"}`
                            )}
                          </button>
                        </div>
                      )}
                      {pullStatus && (
                        <div className={`step-status ${pullStatus.startsWith("✅") ? "step-status-ok" : pullStatus.startsWith("❌") ? "step-status-err" : "step-status-info"}`}>
                          {pullStatus}
                        </div>
                      )}
                      {!ollamaConnected && (
                        <div className="step-hint">Complete step 2 first</div>
                      )}
                    </div>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* All set — ready indicator */}
            {getSetupStep() === "ready" && (
              <div className="ollama-ready-banner">
                <span className="ready-icon">✅</span>
                <span className="ready-text">Ollama connected · <strong>{settings.defaultModel}</strong> ready — start typing below!</span>
              </div>
            )}

            {/* Quick-start example intents — auto-fill input box */}
            <div className="welcome-examples">
              <div className="welcome-examples-label">Quick-start templates — click to try</div>
              <div className="welcome-example-chips">
                {/* Productivity */}
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Summarize what I worked on this week and suggest priorities for tomorrow")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">📋</span>
                  <span className="example-chip-text">Summarize my week &amp; suggest priorities</span>
                  <span className="example-chip-badge">Productivity</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Create a structured daily plan with time blocks for deep work, meetings, and breaks")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">📅</span>
                  <span className="example-chip-text">Build a time-blocked daily plan</span>
                  <span className="example-chip-badge">Productivity</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                {/* Creative */}
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Draft a short professional bio based on my recent projects")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">✍️</span>
                  <span className="example-chip-text">Draft a professional bio for me</span>
                  <span className="example-chip-badge">Creative</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Brainstorm 5 creative side-project ideas that combine AI with everyday problems")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">💡</span>
                  <span className="example-chip-text">Brainstorm creative side-project ideas</span>
                  <span className="example-chip-badge">Creative</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                {/* Knowledge */}
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("What connections exist in my knowledge graph and what patterns do you see?")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">🔮</span>
                  <span className="example-chip-text">Analyze my knowledge graph patterns</span>
                  <span className="example-chip-badge">Knowledge</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Explain the key concepts of retrieval-augmented generation (RAG) and how it improves AI accuracy")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">🧠</span>
                  <span className="example-chip-text">Explain RAG and how it improves AI</span>
                  <span className="example-chip-badge">Knowledge</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                {/* Planning */}
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Help me create a 30-day learning roadmap for Rust programming with milestones")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">🗺️</span>
                  <span className="example-chip-text">Create a 30-day learning roadmap</span>
                  <span className="example-chip-badge">Planning</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Review my recent work and suggest areas where I can improve my workflow efficiency")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">📊</span>
                  <span className="example-chip-text">Review &amp; improve my workflow efficiency</span>
                  <span className="example-chip-badge">Planning</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            </div>

            <div className="welcome-features">
              <div className="feature-card">
                <div className="feature-card-icon">🧠</div>
                <h3>Refractive Core</h3>
                <p>
                  Multi-agent orchestration with 5 specialized AI agents working
                  in concert
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon">🌈</div>
                <h3>Spectrum Graph</h3>
                <p>
                  Persistent knowledge graph with SQLite + vector layers for
                  memory
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon">🔒</div>
                <h3>Sandbox Prisms</h3>
                <p>
                  WASM-based sandboxed execution with cryptographic auto-rollback
                </p>
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <Fragment key={msg.id}>
              <div className={`message message-${msg.role}`}>
                <div className="message-bubble">
                  {msg.content.split("\n").map((line, i) => (
                    <span key={i}>
                      {line}
                      {i < msg.content.split("\n").length - 1 && <br />}
                    </span>
                  ))}
                </div>
                <div className="message-meta">
                  {msg.role === "ai" ? <><img src={prismosIcon} alt="" className="msg-icon" /> {msg.agent ? `PrismOS-AI · ${msg.agent}` : "PrismOS-AI"}</> : "You"} ·{" "}
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
              {msg.role === "ai" && messageSuggestions[msg.id]?.length > 0 && (
                <div className="inline-suggestions">
                  <div className="inline-suggestions__label">💡 Suggested next steps</div>
                  <div className="inline-suggestions__cards">
                    <AnimatePresence>
                      {messageSuggestions[msg.id].map((sug, i) => (
                        <SuggestionCard
                          key={sug.id}
                          suggestion={sug}
                          variant="inline"
                          index={i}
                          onSelect={(s) => {
                            // Auto-fill intent box (not auto-execute) so user can review
                            setPendingIntent(s.action_intent);
                          }}
                          onDismiss={(id) => {
                            setMessageSuggestions(prev => {
                              const current = prev[msg.id] ?? [];
                              const filtered = current.filter(s => s.id !== id);
                              if (filtered.length === 0) {
                                const next = { ...prev };
                                delete next[msg.id];
                                return next;
                              }
                              return { ...prev, [msg.id]: filtered };
                            });
                          }}
                      />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </Fragment>
          ))
        )}
        {isProcessing && (
          <div className="message message-ai" role="status" aria-label="Processing your intent">
            <div className="message-bubble processing-bubble">
              <div className="processing-indicator">
                <div className="processing-spinner" aria-hidden="true">
                  <span /><span /><span />
                </div>
                <div className="processing-text">
                  <span className="processing-label">Refracting your intent…</span>
                  <span className="processing-detail">
                    {liveAgentSteps.length > 0
                      ? liveAgentSteps[liveAgentSteps.length - 1].action
                      : "Agents collaborating · Graph context loading"}
                  </span>
                </div>
              </div>

              {/* ── Phase 2: Live Agent Debate Log ── */}
              {liveAgentSteps.length > 0 && (
                <div className="live-debate-log" role="log" aria-label="Agent collaboration log">
                  <AnimatePresence>
                    {liveAgentSteps.map((step, i) => (
                      <motion.div
                        key={`step-${i}-${step.agent}-${step.action}`}
                        className={`live-step live-step-${step.status} live-phase-${step.phase}`}
                        initial={{ opacity: 0, x: -16, height: 0 }}
                        animate={{ opacity: 1, x: 0, height: "auto" }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={{ duration: 0.22, delay: i * 0.04, ease: "easeOut" }}
                        layout
                      >
                        <span className={`live-step-dot ${step.status === "completed" ? "dot-done" : "dot-active"}`} />
                        <span className="live-step-agent">{step.agent}</span>
                        <span className="live-step-action">{step.action}</span>
                        {step.status === "completed" && <span className="live-step-check">✓</span>}
                        {step.status === "thinking" && <span className="live-step-pulse">…</span>}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Proactive Daily Assistance — Greeting Card + Clickable Suggestions ── */}
      {proactiveSuggestions.length > 0 && !isProcessing && (
        <div className="proactive-suggestions">
          <div className="proactive-header">
            <span className="proactive-label">🧠 {messages.length === 0 ? `${dailyGreeting} — here's what your graph noticed` : 'Graph Insights'}</span>
            <button
              className="proactive-dismiss-all"
              onClick={() => setProactiveSuggestions([])}
              title="Dismiss all suggestions"
            >
              ✕
            </button>
          </div>
          <div className="proactive-cards">
            <AnimatePresence>
              {proactiveSuggestions.slice(0, 3).map((sug, i) => (
                <SuggestionCard
                  key={sug.id}
                  suggestion={sug}
                  variant="inline"
                  index={i}
                  onSelect={(s) => setPendingIntent(s.action_intent)}
                  onDismiss={(id) => setProactiveSuggestions(prev => prev.filter(s => s.id !== id))}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Voice output indicator */}
      {voiceOutput.isSpeaking && (
        <div className="voice-speaking-bar">
          <span className="voice-speaking-icon">🔊</span>
          <span className="voice-speaking-text">Speaking response...</span>
          <button
            className="voice-stop-btn"
            onClick={voiceOutput.stopSpeaking}
            title="Stop speaking"
          >
            ⏹ Stop
          </button>
        </div>
      )}

      <IntentInput
        onSubmit={handleIntent}
        isProcessing={isProcessing}
        voiceEnabled={settings.voiceInputEnabled ?? false}
        pendingIntent={pendingIntent}
        onPendingConsumed={() => setPendingIntent("")}
      />

      {/* ── First-Time Setup Wizard Modal (shows once) ── */}
      {showFirstTimeWizard && (
        <div className="ftw-overlay" onClick={dismissFirstTimeWizard}>
          <div className="ftw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ftw-header">
              <img src={prismosLogo} alt="PrismOS-AI" className="ftw-logo" />
              <h2 className="ftw-title">Welcome to PrismOS-AI!</h2>
              <p className="ftw-subtitle">Your local-first AI assistant. Let's get you set up in under 2 minutes.</p>
            </div>

            <div className="ftw-steps">
              <div className="ftw-step">
                <div className="ftw-step-number">1</div>
                <div className="ftw-step-body">
                  <h3>Install Ollama</h3>
                  <p>Ollama runs AI models on your computer — no cloud, no data sharing. It's free and takes seconds to install.</p>
                  <button className="ftw-link-btn" onClick={() => shellOpen("https://ollama.com")}>🌐 Open ollama.com</button>
                </div>
              </div>
              <div className="ftw-step">
                <div className="ftw-step-number">2</div>
                <div className="ftw-step-body">
                  <h3>Start Ollama</h3>
                  <p>After installing, just open the Ollama app. It runs quietly in the background — no setup needed.</p>
                  <div className="ftw-code-hint">Or run <code>ollama serve</code> in a terminal</div>
                </div>
              </div>
              <div className="ftw-step">
                <div className="ftw-step-number">3</div>
                <div className="ftw-step-body">
                  <h3>Pull a Model</h3>
                  <p>Download an AI model to use. We recommend starting small — it'll download automatically when you first chat.</p>
                  <div className="ftw-code-hint">Or run <code>ollama pull llama3.2</code> in a terminal</div>
                </div>
              </div>
            </div>

            <div className="ftw-footer">
              <div className="ftw-privacy-note">
                🔒 Everything runs locally. Your data never leaves your device.
              </div>
              <button className="ftw-dismiss-btn" onClick={dismissFirstTimeWizard}>
                Got it, let's go! →
              </button>
            </div>
          </div>
        </div>
      )}

      <UserGuide open={showGuide} onClose={() => setShowGuide(false)} />
    </>
  );
}
