// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Main View — Intent Console + Conversation

import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import IntentInput from "./IntentInput";
import type { AppSettings, Message } from "../types";

interface MainViewProps {
  ollamaConnected: boolean;
  settings: AppSettings;
  onNodeAdded: () => void;
}

export default function MainView({
  ollamaConnected,
  settings,
  onNodeAdded,
}: MainViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

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
      const response = await invoke<string>("process_intent", { input });
      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);

      // Auto-save conversation to Spectrum Graph
      try {
        await invoke("add_spectrum_node", {
          label: input.length > 50 ? input.slice(0, 47) + "..." : input,
          content: `Q: ${input}\n\nA: ${response}`,
          nodeType: "conversation",
        });
        onNodeAdded();
      } catch {
        // Non-critical — don't block conversation
      }
    } catch (e) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: `⚠️ Unable to process intent: ${e}\n\nMake sure Ollama is running with a model installed:\n\n  ollama pull ${settings.defaultModel}\n  ollama serve`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <>
      <div className="main-header">
        <h2>◈ Intent Console</h2>
        <div className="ollama-status">
          <span
            className={`status-dot ${ollamaConnected ? "connected" : ""}`}
          />
          {ollamaConnected
            ? `Ollama · ${settings.defaultModel}`
            : "Ollama Offline"}
        </div>
      </div>

      <div className="conversation-area" ref={conversationRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-icon">◈</div>
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
              <div className="message-bubble">{msg.content}</div>
              <div className="message-meta">
                {msg.role === "ai" ? "◈ PrismOS" : "You"} ·{" "}
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
