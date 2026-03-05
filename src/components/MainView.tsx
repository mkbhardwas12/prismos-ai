// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Main View — Intent Console + Conversation
// Refactored: logic extracted into useOllama, useChat, useSuggestions hooks

import { useState, Fragment } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import prismosLogo from "../assets/prismos-logo.svg";
import prismosIcon from "../assets/prismos-icon.svg";
import IntentInput from "./IntentInput";
import DailyBrief from "./DailyBrief";
import UserGuide from "./UserGuide";
import SuggestionCard from "./SuggestionCard";
import { useVoice } from "../hooks/useVoice";
import { useOllama, RECOMMENDED_MODELS } from "../hooks/useOllama";
import { useChat } from "../hooks/useChat";
import { useSuggestions } from "../hooks/useSuggestions";
import type { AppSettings, CollaborationSummary, DebateSummary, AgentActivity, ProactiveSuggestion } from "../types";
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
  const [showGuide, setShowGuide] = useState(false);

  // Voice output (TTS)
  const voiceOutput = useVoice(() => {}, settings.voiceOutputEnabled ?? false);

  // ── Custom Hooks ──
  const ollama = useOllama({ ollamaConnected, settings, onSettingsChange });

  const suggestions = useSuggestions({
    startupSuggestions,
    hasMessages: false, // seed check is internal to the hook
  });

  const chat = useChat({
    settings,
    onIntentProcessed,
    clearLiveSteps,
    voiceEnabled: settings.voiceOutputEnabled ?? false,
    voiceSpeak: voiceOutput.speak,
    refreshSuggestions: suggestions.refreshSuggestions,
  });

  return (
    <>
      <div className="main-header">
        <h2><img src={prismosIcon} alt="" className="header-icon" /> Intent Console</h2>
        <div className="header-actions">
          {chat.messages.length > 0 && (
            <button
              className="toolbar-btn"
              onClick={chat.clearConversation}
              title="Clear conversation"
            >
              🗑️ Clear
            </button>
          )}
          <div className="ollama-status" ref={ollama.modelDropdownRef}>
            <button
              className="model-selector-btn"
              onClick={() => ollamaConnected && ollama.setModelDropdownOpen(v => !v)}
              title={ollamaConnected ? "Click to change model" : "Ollama is offline"}
            >
              <span className={`status-dot ${ollamaConnected ? "connected" : ""}`} />
              {ollamaConnected
                ? <><span className="model-selector-label">Ollama ·</span> <strong>{settings.defaultModel}</strong> <span className="model-selector-caret">{ollama.modelDropdownOpen ? "▲" : "▼"}</span></>
                : "Ollama Offline"}
            </button>
            {ollama.modelDropdownOpen && (
              <div className="model-dropdown">
                {/* ── Installed Models ── */}
                <div className="model-dropdown-header">Installed Models</div>
                {ollama.availableModels.length === 0 ? (
                  <div className="model-dropdown-empty">Loading…</div>
                ) : (
                  ollama.availableModels.map(m => (
                    <button
                      key={m.name}
                      className={`model-dropdown-item ${settings.defaultModel === m.name ? "active" : ""}`}
                      onClick={() => ollama.selectModel(m.name)}
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
                {ollama.pullingModel && (
                  <div className="model-pull-status">
                    <div className="model-pull-text">
                      <span className="model-pull-spinner">⏳</span> {ollama.pullProgress}
                    </div>
                    {ollama.pullPercent > 0 && (
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${ollama.pullPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Tiered model sections */}
                {(["text", "vision", "power"] as const).map(tier => {
                  const tierModels = RECOMMENDED_MODELS
                    .filter(r => r.tier === tier && !ollama.availableModels.some(m => m.name.startsWith(r.name)));
                  if (tierModels.length === 0) return null;
                  return (
                    <div key={tier}>
                      <div className="model-dropdown-tier">
                        {tier === "text" ? "📝 Text & Reasoning" : tier === "vision" ? "👁️ Vision & Image" : "⚡ Power User"}
                      </div>
                      {tierModels.map(r => (
                        <button
                          key={r.name}
                          className="model-dropdown-item model-download-item"
                          onClick={() => ollama.pullModelFromDropdown(r.name)}
                          disabled={ollama.pullingModel !== null}
                        >
                          <div className="model-download-info">
                            <span className="model-dropdown-name">{r.label}</span>
                            <span className="model-download-desc">{r.desc}</span>
                          </div>
                          <span className="model-dropdown-size">{r.size}</span>
                          <span className="model-download-btn">{ollama.pullingModel === r.name ? "⏳" : "⬇"}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                {RECOMMENDED_MODELS.filter(r => !ollama.availableModels.some(m => m.name.startsWith(r.name))).length === 0 && (
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

      <div className="conversation-area" ref={chat.conversationRef} role="log" aria-label="Conversation history" aria-live="polite">
        {/* ── Morning Brief / Evening Recap ── */}
        <DailyBrief onSuggestionClick={chat.handleIntent} />

        {chat.messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-icon"><img src={prismosLogo} alt="PrismOS-AI" className="welcome-logo-img" /></div>
            <h1>Welcome to PrismOS-AI</h1>
            <p>
              Your local-first agentic AI operating system. All processing
              happens on your device — your data never leaves.
            </p>

            {/* ── Ollama Setup Wizard ── */}
            {ollama.getSetupStep() !== "ready" && (
              <div className={`ollama-setup-wizard ${ollama.wizardExpanded ? "wizard-expanded" : "wizard-collapsed"}`} role="alert">
                <div className="setup-wizard-header" onClick={() => ollama.setWizardExpanded(v => !v)} style={{ cursor: "pointer" }}>
                  <span className="setup-wizard-icon">🚀</span>
                  <div style={{ flex: 1 }}>
                    <strong className="setup-wizard-title">Quick Setup</strong>
                    <span className="setup-wizard-subtitle">
                      {ollama.wizardExpanded
                        ? "Get PrismOS-AI running in 3 steps"
                        : `Step ${ollama.getSetupStep() === "start" ? "2" : "3"} — ${ollama.getSetupStep() === "start" ? "Start Ollama to continue" : "Pull a model to get started"}`
                      }
                    </span>
                  </div>
                  <span className="wizard-toggle-icon">{ollama.wizardExpanded ? "▲" : "▼"}</span>
                </div>

                {ollama.wizardExpanded && (
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
                  <div className={`setup-step ${ollamaConnected ? "step-done" : ollama.getSetupStep() === "start" ? "step-active" : "step-pending"}`}>
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
                            onClick={ollama.handleStartOllama}
                            disabled={ollama.isLaunching}
                          >
                            {ollama.isLaunching ? (
                              <><span className="btn-spinner" /> Starting…</>
                            ) : (
                              "▶️ Start Ollama"
                            )}
                          </button>
                          <button
                            className="step-action-btn step-action-secondary"
                            onClick={ollama.handleRetryConnection}
                            disabled={ollama.isRetrying}
                          >
                            {ollama.isRetrying ? "Checking…" : "🔄 Retry Connection"}
                          </button>
                        </div>
                      )}
                      {ollama.launchStatus && (
                        <div className={`step-status ${ollama.launchStatus.startsWith("✅") ? "step-status-ok" : ollama.launchStatus.startsWith("❌") ? "step-status-err" : "step-status-info"}`}>
                          {ollama.launchStatus}
                        </div>
                      )}
                      {!ollamaConnected && !ollama.isLaunching && (
                        <div className="step-hint">
                          Or run <code>ollama serve</code> in your terminal
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Pull a model */}
                  <div className={`setup-step ${ollama.hasModels ? "step-done" : ollamaConnected ? "step-active" : "step-pending"}`}>
                    <div className="step-indicator">
                      {ollama.hasModels ? (
                        <span className="step-check">✓</span>
                      ) : (
                        <span className="step-number">3</span>
                      )}
                    </div>
                    <div className="step-content">
                      <div className="step-label">Pull a Model</div>
                      <div className="step-desc">
                        {ollama.hasModels
                          ? `Model ready — ${settings.defaultModel}`
                          : `Download an AI model to use locally`}
                      </div>
                      {ollamaConnected && !ollama.hasModels && (
                        <div className="step-actions">
                          <button
                            className="step-action-btn step-action-primary"
                            onClick={ollama.handlePullModel}
                            disabled={ollama.isPulling}
                          >
                            {ollama.isPulling ? (
                              <><span className="btn-spinner" /> Pulling…</>
                            ) : (
                              `📦 Pull ${settings.defaultModel || "llama3.2"}`
                            )}
                          </button>
                        </div>
                      )}
                      {ollama.pullStatus && (
                        <div className={`step-status ${ollama.pullStatus.startsWith("✅") ? "step-status-ok" : ollama.pullStatus.startsWith("❌") ? "step-status-err" : "step-status-info"}`}>
                          {ollama.pullStatus}
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
            {ollama.getSetupStep() === "ready" && (
              <div className="ollama-ready-banner">
                <span className="ready-icon">✅</span>
                <span className="ready-text">Ollama connected · <strong>{settings.defaultModel}</strong> ready — start typing below!</span>
              </div>
            )}

            {/* Quick-start example intents */}
            <div className="welcome-examples">
              <div className="welcome-examples-label">Quick-start templates — click to try</div>
              <div className="welcome-example-chips">
                <button className="example-chip" onClick={() => chat.setPendingIntent("Summarize what I worked on this week and suggest priorities for tomorrow")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">📋</span>
                  <span className="example-chip-text">Summarize my week &amp; suggest priorities</span>
                  <span className="example-chip-badge">Productivity</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("Create a structured daily plan with time blocks for deep work, meetings, and breaks")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">📅</span>
                  <span className="example-chip-text">Build a time-blocked daily plan</span>
                  <span className="example-chip-badge">Productivity</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("Draft a short professional bio based on my recent projects")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">✍️</span>
                  <span className="example-chip-text">Draft a professional bio for me</span>
                  <span className="example-chip-badge">Creative</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("Brainstorm 5 creative side-project ideas that combine AI with everyday problems")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">💡</span>
                  <span className="example-chip-text">Brainstorm creative side-project ideas</span>
                  <span className="example-chip-badge">Creative</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("What connections exist in my knowledge graph and what patterns do you see?")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">🔮</span>
                  <span className="example-chip-text">Analyze my knowledge graph patterns</span>
                  <span className="example-chip-badge">Knowledge</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("Explain the key concepts of retrieval-augmented generation (RAG) and how it improves AI accuracy")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">🧠</span>
                  <span className="example-chip-text">Explain RAG and how it improves AI</span>
                  <span className="example-chip-badge">Knowledge</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("Help me create a 30-day learning roadmap for Rust programming with milestones")} disabled={chat.isProcessing}>
                  <span className="example-chip-icon">🗺️</span>
                  <span className="example-chip-text">Create a 30-day learning roadmap</span>
                  <span className="example-chip-badge">Planning</span>
                  <span className="example-chip-arrow" aria-hidden="true">→</span>
                </button>
                <button className="example-chip" onClick={() => chat.setPendingIntent("Review my recent work and suggest areas where I can improve my workflow efficiency")} disabled={chat.isProcessing}>
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
                <p>Multi-agent orchestration with 5 specialized AI agents working in concert</p>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon">🌈</div>
                <h3>Spectrum Graph</h3>
                <p>Persistent knowledge graph with SQLite + vector layers for memory</p>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon">🔒</div>
                <h3>Sandbox Prisms</h3>
                <p>WASM-based sandboxed execution with cryptographic auto-rollback</p>
              </div>
            </div>
          </div>
        ) : (
          chat.messages.map((msg) => (
            <Fragment key={msg.id}>
              <div className={`message message-${msg.role}`}>
                <div className="message-bubble">
                  {msg.role === "ai" ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    msg.content.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < msg.content.split("\n").length - 1 && <br />}
                      </span>
                    ))
                  )}
                </div>
                <div className="message-meta">
                  {msg.role === "ai" ? <><img src={prismosIcon} alt="" className="msg-icon" /> {msg.agent ? `PrismOS-AI · ${msg.agent}` : "PrismOS-AI"}</> : "You"} ·{" "}
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
              {msg.role === "ai" && suggestions.messageSuggestions[msg.id]?.length > 0 && (
                <div className="inline-suggestions">
                  <div className="inline-suggestions__label">💡 Suggested next steps</div>
                  <div className="inline-suggestions__cards">
                    <AnimatePresence>
                      {suggestions.messageSuggestions[msg.id].map((sug, i) => (
                        <SuggestionCard
                          key={sug.id}
                          suggestion={sug}
                          variant="inline"
                          index={i}
                          onSelect={(s) => chat.setPendingIntent(s.action_intent)}
                          onDismiss={(id) => suggestions.dismissSuggestion(msg.id, id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </Fragment>
          ))
        )}
        {chat.isProcessing && (
          <div className="message message-ai" role="status" aria-label="Processing your intent">
            <div className="message-bubble processing-bubble">
              <div className="processing-indicator">
                <div className="processing-spinner" aria-hidden="true">
                  <span /><span /><span />
                </div>
                <div className="processing-text">
                  <span className="processing-label">{chat.processingPhase || "Refracting your intent…"}</span>
                  <span className="processing-detail">
                    {liveAgentSteps.length > 0
                      ? liveAgentSteps[liveAgentSteps.length - 1].action
                      : chat.processingPhase ? "Processing locally · 100% private" : "Agents collaborating · Graph context loading"}
                  </span>
                </div>
              </div>

              {/* Phase 2: Live Agent Debate Log */}
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

      {/* ── Proactive Daily Assistance ── */}
      {suggestions.proactiveSuggestions.length > 0 && !chat.isProcessing && (
        <div className="proactive-suggestions">
          <div className="proactive-header">
            <span className="proactive-label">🧠 {chat.messages.length === 0 ? `${dailyGreeting} — here's what your graph noticed` : 'Graph Insights'}</span>
            <button
              className="proactive-dismiss-all"
              onClick={() => suggestions.setProactiveSuggestions([])}
              title="Dismiss all suggestions"
            >
              ✕
            </button>
          </div>
          <div className="proactive-cards">
            <AnimatePresence>
              {suggestions.proactiveSuggestions.slice(0, 3).map((sug, i) => (
                <SuggestionCard
                  key={sug.id}
                  suggestion={sug}
                  variant="inline"
                  index={i}
                  onSelect={(s) => chat.setPendingIntent(s.action_intent)}
                  onDismiss={(id) => suggestions.setProactiveSuggestions(prev => prev.filter(s => s.id !== id))}
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
          <button className="voice-stop-btn" onClick={voiceOutput.stopSpeaking} title="Stop speaking">
            ⏹ Stop
          </button>
        </div>
      )}

      <IntentInput
        onSubmit={chat.handleIntent}
        isProcessing={chat.isProcessing}
        voiceEnabled={settings.voiceInputEnabled ?? false}
        pendingIntent={chat.pendingIntent}
        onPendingConsumed={() => chat.setPendingIntent("")}
        onScreenRead={chat.handleScreenRead}
      />

      {/* ── First-Time Setup Wizard Modal ── */}
      {ollama.showFirstTimeWizard && (
        <div className="ftw-overlay" onClick={ollama.dismissFirstTimeWizard}>
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
              <button className="ftw-dismiss-btn" onClick={ollama.dismissFirstTimeWizard}>
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
