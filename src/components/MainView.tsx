// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Main View — Intent Console + Conversation

import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import prismosLogo from "../assets/prismos-logo.svg";
import prismosIcon from "../assets/prismos-icon.svg";
import IntentInput from "./IntentInput";
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
  const conversationRef = useRef<HTMLDivElement>(null);

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
      // Use full Refractive Core pipeline (Patent 63/993,589)
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

      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: result.response + metaLine + collabLine + hintLine,
        timestamp: new Date(),
        agent: result.agent_used,
      };
      setMessages((prev) => [...prev, aiMsg]);
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
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: "system",
          content: isOllamaError
            ? `⚠️ Cannot connect to Ollama.\n\nMake sure Ollama is running:\n  1. Install from https://ollama.com\n  2. ollama pull ${settings.defaultModel}\n  3. ollama serve\n\nThen try again.`
            : `⚠️ Unable to process intent.\n\n${errorStr}\n\nCheck that Ollama is running with:\n  ollama serve`,
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

      <div className="conversation-area" ref={conversationRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-icon"><img src={prismosLogo} alt="PrismOS" className="welcome-logo-img" /></div>
            <h1>Welcome to PrismOS</h1>
            <p>
              Your local-first agentic AI operating system. All processing
              happens on your device — your data never leaves. Express any
              intent below to get started.
            </p>
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
          <div className="message message-ai">
            <div className="message-bubble">
              <div className="loading-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>

      <IntentInput onSubmit={handleIntent} isProcessing={isProcessing} />
    </>
  );
}
