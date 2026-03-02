// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS Main View — Intent Console + Conversation

import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import prismosLogo from "../assets/prismos-logo.svg";
import prismosIcon from "../assets/prismos-icon.svg";
import IntentInput from "./IntentInput";
import { useVoice } from "../hooks/useVoice";
import type { AppSettings, Message, RefractiveResult, CollaborationSummary, DebateSummary } from "../types";

interface MainViewProps {
  ollamaConnected: boolean;
  settings: AppSettings;
  onIntentProcessed: (agentUsed?: string, collaboration?: CollaborationSummary, debate?: DebateSummary | null) => void;
}

export default function MainView({
  ollamaConnected,
  settings,
  onIntentProcessed,
}: MainViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingIntent, setPendingIntent] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);

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

  async function handleIntent(input: string) {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    try {
      // Use full Refractive Core pipeline (Patent [application number])
      const resultJson = await invoke<string>("refract_intent", { input });
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

      onIntentProcessed(result.agent_used, result.collaboration ?? undefined, result.collaboration?.debate ?? null); // Refresh sidebar + graph + agent status
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
          <div className="ollama-status">
            <span
              className={`status-dot ${ollamaConnected ? "connected" : ""}`}
            />
            {ollamaConnected
              ? `Ollama · ${settings.defaultModel}`
              : "Ollama Offline"}
          </div>
        </div>
      </div>

      <div className="conversation-area" ref={conversationRef} role="log" aria-label="Conversation history" aria-live="polite">
        {messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-icon"><img src={prismosLogo} alt="PrismOS" className="welcome-logo-img" /></div>
            <h1>Welcome to PrismOS</h1>
            <p>
              Your local-first agentic AI operating system. All processing
              happens on your device — your data never leaves.
            </p>

            {/* Ollama offline banner */}
            {!ollamaConnected && (
              <div className="ollama-offline-banner" role="alert">
                <div className="ollama-offline-icon">⚡</div>
                <div className="ollama-offline-content">
                  <strong>Ollama is not running</strong>
                  <span>PrismOS needs Ollama for local AI inference. Start it to unlock all features.</span>
                </div>
                <div className="ollama-offline-actions">
                  <button
                    className="ollama-start-btn"
                    onClick={() => {
                      // Try to open terminal with ollama serve command
                      try {
                        navigator.clipboard.writeText("ollama serve");
                      } catch { /* ignore */ }
                      window.open("https://ollama.com", "_blank");
                    }}
                    title="Visit ollama.com to download, then run 'ollama serve'"
                  >
                    🚀 Get Ollama
                  </button>
                  <div className="ollama-offline-hint">
                    Run <code>ollama serve</code> in your terminal
                  </div>
                </div>
              </div>
            )}

            {/* Quick-start example intents — auto-fill input box */}
            <div className="welcome-examples">
              <div className="welcome-examples-label">Click an example to try it</div>
              <div className="welcome-example-chips">
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Summarize what I worked on this week and suggest priorities for tomorrow")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">📋</span>
                  <span className="example-chip-text">Summarize my week &amp; suggest priorities</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("Draft a short professional bio based on my recent projects")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">✍️</span>
                  <span className="example-chip-text">Draft a professional bio for me</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="example-chip"
                  onClick={() => setPendingIntent("What connections exist in my knowledge graph and what patterns do you see?")}
                  disabled={isProcessing}
                >
                  <span className="example-chip-icon">🔮</span>
                  <span className="example-chip-text">Analyze my knowledge graph patterns</span>
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
            <div key={msg.id} className={`message message-${msg.role}`}>
              <div className="message-bubble">
                {msg.content.split("\n").map((line, i) => (
                  <span key={i}>
                    {line}
                    {i < msg.content.split("\n").length - 1 && <br />}
                  </span>
                ))}
              </div>
              <div className="message-meta">
                {msg.role === "ai" ? <><img src={prismosIcon} alt="" className="msg-icon" /> {msg.agent ? `PrismOS · ${msg.agent}` : "PrismOS"}</> : "You"} ·{" "}
                {msg.timestamp.toLocaleTimeString()}
              </div>
            </div>
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
                  <span className="processing-detail">Agents collaborating · Graph context loading</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

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
    </>
  );
}
