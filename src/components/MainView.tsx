// PrismOS-AI Main View — Intent Console + Conversation
// Refactored: logic extracted into useOllama, useChat, useSuggestions hooks

import { useState, Fragment } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes } from "../lib/projectReview";
import { answerTextOf, exportAnswerReceipt, shortReceiptId, verifyAnswerReceipt } from "../lib/receipts";
import type { Message, ReceiptVerification } from "../types";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import prismosIcon from "../assets/prismos-icon.svg";
import IntentInput from "./IntentInput";
import DailyBrief from "./DailyBrief";
import UserGuide from "./UserGuide";
import SuggestionCard from "./SuggestionCard";
import { useVoice } from "../hooks/useVoice";
import { useOllama, RECOMMENDED_MODELS } from "../hooks/useOllama";
import { useChat } from "../hooks/useChat";
import { useSuggestions } from "../hooks/useSuggestions";
import type { AppSettings, CollaborationSummary, DebateSummary, AgentActivity, ProactiveSuggestion, RefractionAlternative } from "../types";
import "./MainView.css";

/** The welcome screen's starters: one per lane, each a real one-line prompt. */
const STARTERS = [
  { icon: "🌊", title: "Build a 3D scene from one line", desc: "A voxel lighthouse in a storm, as one file that works offline.", intent: "/scene a voxel lighthouse on a rocky island in a storm at night" },
  { icon: "🔎", title: "Investigate a log file", desc: "Attach the logs with + and ask what happened. You get a timeline and next steps.", intent: "Something happened on my server last night. What happened, and what do I do now?" },
  { icon: "🛡️", title: "Harden a server, step by step", desc: "A plan you can follow for Linux, nginx, Docker, Postgres and more.", intent: "Harden my Linux server: give me a step-by-step plan" },
  { icon: "🧁", title: "Build a website from one line", desc: "Menu, hours and a pickup form for a bakery, written as plain files.", intent: "Build a website for a neighborhood bakery: menu, opening hours and pickup orders" },
];

const MORE_IDEAS = [
  { label: "Summarize my week", intent: "Summarize what I worked on this week and suggest priorities for tomorrow" },
  { label: "Plan my day in time blocks", intent: "Create a structured daily plan with time blocks for deep work, meetings, and breaks" },
  { label: "Brainstorm side projects", intent: "Brainstorm 5 creative side-project ideas that combine AI with everyday problems" },
];

interface MainViewProps {
  ollamaConnected: boolean;
  /** Re-run the Ollama health check now (clicking the offline badge). */
  onRetryConnection?: () => void | Promise<void>;
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
  onRetryConnection,
  settings,
  onSettingsChange,
  onIntentProcessed,
  liveAgentSteps,
  clearLiveSteps,
  startupSuggestions,
  dailyGreeting,
}: MainViewProps) {
  const [showGuide, setShowGuide] = useState(false);
  const [checkingConn, setCheckingConn] = useState(false);
  const [expandedRefractions, setExpandedRefractions] = useState<Set<string>>(new Set());
  const [expandedTransparencies, setExpandedTransparencies] = useState<Set<string>>(new Set());
  const [receiptChecks, setReceiptChecks] = useState<Record<string, ReceiptVerification | "checking">>({});
  // Memory's ideas stay one quiet line above the input until asked for
  const [ideasOpen, setIdeasOpen] = useState(false);

  const verifyReceipt = (msg: Message) => {
    if (!msg.receipt) return;
    setReceiptChecks((prev) => ({ ...prev, [msg.id]: "checking" }));
    verifyAnswerReceipt(msg.receipt.id, answerTextOf(msg.content))
      .then((v) => setReceiptChecks((prev) => ({ ...prev, [msg.id]: v })))
      .catch((e) => setReceiptChecks((prev) => ({
        ...prev,
        [msg.id]: { valid: false, receipt_found: false, signature_valid: false, key_matches_device: false, audit_entry_found: false, audit_hash_matches: false, answer_matches: null, message: String(e), receipt: null },
      })));
  };
  const exportReceipt = (id: string) => {
    exportAnswerReceipt(id)
      .then((file) => invoke("open_generated_file", { path: file.path, reveal: true }))
      .catch(() => { /* surfaced by the missing file — nothing else to do */ });
  };

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
        <h2><img src={prismosIcon} alt="" className="header-icon" /> Chat</h2>
        <div className="header-actions">
          {chat.messages.length > 0 && (
            <button
              className="toolbar-btn"
              onClick={chat.clearConversation}
              title="Clear conversation"
            >
              Clear
            </button>
          )}
          <div className="ollama-status" ref={ollama.modelDropdownRef}>
            <button
              className={`model-selector-btn ${!ollamaConnected ? "offline" : ""}`}
              onClick={async () => {
                if (ollamaConnected) {
                  ollama.setModelDropdownOpen(v => !v);
                  return;
                }
                // Offline → clicking retries the connection right now instead
                // of waiting for the next background poll.
                if (checkingConn) return;
                setCheckingConn(true);
                try {
                  await onRetryConnection?.();
                } finally {
                  // Brief hold so "Checking…" is visible even on instant results
                  setTimeout(() => setCheckingConn(false), 400);
                }
              }}
              title={
                ollamaConnected
                  ? "Click to change model"
                  : "Click to retry the connection — if it stays offline, start Ollama with `ollama serve`"
              }
            >
              <span className={`status-dot ${ollamaConnected ? "connected" : ""} ${checkingConn ? "checking" : ""}`} />
              {ollamaConnected
                ? <><span className="model-selector-label">Ollama ·</span> <strong>{settings.defaultModel}</strong> <span className="model-selector-caret">{ollama.modelDropdownOpen ? "▲" : "▼"}</span></>
                : checkingConn
                  ? "Checking…"
                  : <>Ollama Offline <span className="retry-icon">↻</span></>}
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
            Guide
          </button>
        </div>
      </div>

      {ollama.modelWarning && (
        <div className="model-warning-banner" role="status">
          <span className="model-warning-icon">⚠️</span>
          <span className="model-warning-text">{ollama.modelWarning}</span>
          <button
            className="model-warning-dismiss"
            onClick={ollama.dismissModelWarning}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="conversation-area" ref={chat.conversationRef} role="log" aria-label="Conversation history" aria-live="polite">
        {/* ── Morning Brief / Evening Recap ── */}
        {/* The full brief lives on Today; in Chat it stays a one-line pill until opened */}
        <DailyBrief onSuggestionClick={chat.handleIntent} compact />

        {chat.messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-icon"><img src={prismosIcon} alt="PrismOS-AI" className="welcome-logo-img" /></div>
            <h1 className="welcome-title">Ask anything. Attach anything.</h1>
            <p className="welcome-sub">
              It all stays on this computer: the model runs here, and nothing
              you type or attach is uploaded.
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
                <span className="ready-text"><strong>{settings.defaultModel}</strong> is ready on this computer</span>
              </div>
            )}

            {/* Four things PrismOS does well, each one line away */}
            <div className="starter-grid" role="list" aria-label="Things to try">
              {STARTERS.map((st) => (
                <button
                  key={st.title}
                  role="listitem"
                  className="starter-card"
                  onClick={() => chat.setPendingIntent(st.intent)}
                  disabled={chat.isProcessing}
                >
                  <span className="starter-icon" aria-hidden="true">{st.icon}</span>
                  <span className="starter-title">{st.title}</span>
                  <span className="starter-desc">{st.desc}</span>
                </button>
              ))}
            </div>

            <div className="welcome-more">
              <span className="welcome-more-label">More to try</span>
              {MORE_IDEAS.map((m) => (
                <button key={m.label} className="welcome-more-chip" onClick={() => chat.setPendingIntent(m.intent)} disabled={chat.isProcessing}>
                  {m.label}
                </button>
              ))}
            </div>

            <ul className="welcome-trust" aria-label="Privacy">
              <li>Runs on your machine</li>
              <li>Your files never leave it</li>
              <li>Open source, MIT</li>
            </ul>
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
                {msg.role === "ai" && msg.truncated && (
                  <div className="message-truncated-notice" role="status">
                    ⚠️ Response hit the length limit — raise Max Tokens in Settings or ask for a shorter answer.
                  </div>
                )}
                {msg.reviewRequest && (
                  <div className="review-gate-card">
                    <div className="review-gate-header">
                      🛡️ Review Gate — approval required
                      {msg.reviewRequest.status === "approved" && <span className="review-gate-status review-gate-status--ok">✓ Approved</span>}
                      {msg.reviewRequest.status === "declined" && <span className="review-gate-status review-gate-status--no">✗ Declined</span>}
                    </div>
                    <div className="review-gate-stats">
                      <span title="Project root">📁 {msg.reviewRequest.root}</span>
                      <span>{msg.reviewRequest.totalFiles} files found</span>
                      <span>{msg.reviewRequest.candidateFiles} reviewable ({formatBytes(msg.reviewRequest.totalCandidateBytes)})</span>
                      <span>{msg.reviewRequest.llmFiles} deep-review candidates</span>
                      {msg.reviewRequest.skippedDirs.length > 0 && (
                        <span>skipping: {msg.reviewRequest.skippedDirs.join(", ")}</span>
                      )}
                      {msg.reviewRequest.truncated && <span>⚠️ large project — scan capped</span>}
                    </div>
                    <div className="review-gate-note">
                      Read-only: nothing in the project will be modified, created or deleted. Only a report is written (to Downloads).
                    </div>
                    {msg.reviewRequest.status === "pending" && (
                      <div className="review-gate-actions">
                        <button
                          className="attachment-btn"
                          disabled={chat.isProcessing}
                          onClick={() => chat.approveProjectReview(msg.id)}
                        >
                          ✓ Approve & start review
                        </button>
                        <button
                          className="attachment-btn attachment-btn--secondary"
                          disabled={chat.isProcessing}
                          onClick={() => chat.declineProjectReview(msg.id)}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {msg.attachment && (
                  <div className="attachment-actions">
                    <span className="attachment-chip">
                      {msg.attachment.kind === "pptx" ? "📊" : msg.attachment.kind === "html" ? "📈" : "📄"} {msg.attachment.filename}
                    </span>
                    <button
                      className="attachment-btn"
                      onClick={() => invoke("open_generated_file", { path: msg.attachment!.path, reveal: false })}
                    >
                      Open
                    </button>
                    <button
                      className="attachment-btn attachment-btn--secondary"
                      onClick={() => invoke("open_generated_file", { path: msg.attachment!.path, reveal: true })}
                    >
                      Reveal in Finder
                    </button>
                  </div>
                )}
                {msg.role === "ai" && msg.receipt && (() => {
                  const check = receiptChecks[msg.id];
                  const r = msg.receipt;
                  return (
                    <div className="receipt-row" data-testid="answer-receipt">
                      <span
                        className="receipt-chip"
                        title={`Receipt ${r.id}\nIssued ${r.issued_at}\nDevice key ${r.key_fingerprint}\nAudit entry #${r.audit_index}`}
                      >
                        🧾 Receipt {shortReceiptId(r.id)} · {r.model}
                        {r.sources.length > 0 && ` · ${r.sources.length} source${r.sources.length === 1 ? "" : "s"}`}
                        {r.context_node_ids.length > 0 && ` · ${r.context_node_ids.length} graph node${r.context_node_ids.length === 1 ? "" : "s"}`}
                      </span>
                      <button
                        className="attachment-btn attachment-btn--secondary"
                        disabled={check === "checking"}
                        onClick={() => verifyReceipt(msg)}
                        title="Re-check the signature, device key and audit-chain link on this device"
                      >
                        {check === "checking" ? "Verifying…" : "Verify"}
                      </button>
                      <button
                        className="attachment-btn attachment-btn--secondary"
                        onClick={() => exportReceipt(r.id)}
                        title="Save the receipt (digests only, never your text) to Downloads"
                      >
                        Export
                      </button>
                      {check && check !== "checking" && (
                        <span className={`receipt-status ${check.valid ? "receipt-status--ok" : "receipt-status--no"}`} title={check.message}>
                          {check.valid ? "✓ Verified on this device" : `✗ ${check.message}`}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {msg.role === "ai" && msg.conflicts && (msg.conflicts.conflicts.length > 0 || msg.conflicts.skipped_reason) && (
                  <div className="conflict-card" data-testid="knowledge-conflicts">
                    {msg.conflicts.conflicts.length > 0 ? (
                      <>
                        <div className="conflict-header">
                          ⚠️ {msg.conflicts.conflicts.length === 1 ? "Knowledge conflict" : `${msg.conflicts.conflicts.length} knowledge conflicts`} — this document disagrees with what you already know
                        </div>
                        {msg.conflicts.conflicts.map((c) => (
                          <div className="conflict-item" key={`${c.new_node_id}→${c.existing_node_id}`}>
                            <div className="conflict-side">
                              <span className="conflict-tag conflict-tag--new">New · {msg.conflicts!.source}</span>
                              <p>{c.claim_new || c.new_excerpt}</p>
                            </div>
                            <div className="conflict-side">
                              <span className="conflict-tag conflict-tag--old">Existing · {c.existing_label}</span>
                              <p>{c.claim_existing || c.existing_excerpt}</p>
                            </div>
                            <div className="conflict-why">
                              {c.explanation} · similarity {(c.similarity * 100).toFixed(0)}% · confidence {(c.confidence * 100).toFixed(0)}%
                            </div>
                          </div>
                        ))}
                        <div className="conflict-note">
                          Recorded as a <code>contradicts</code> link in your Spectrum Graph. Nothing was deleted or overwritten — you decide which side is right.
                        </div>
                      </>
                    ) : (
                      <div className="conflict-skipped">Conflict check skipped: {msg.conflicts.skipped_reason}</div>
                    )}
                  </div>
                )}
                <div className="message-meta">
                  {msg.role === "ai" ? <><img src={prismosIcon} alt="" className="msg-icon" /> {msg.agent ? `PrismOS-AI · ${msg.agent}` : "PrismOS-AI"}</> : "You"} ·{" "}
                  {msg.timestamp.toLocaleTimeString()}
                  {msg.role === "ai" && (
                    <span className="feedback-buttons">
                      <button
                        className={`feedback-btn${msg.feedback === "good" ? " feedback-active" : ""}`}
                        onClick={() => chat.submitFeedback(msg.id, "good")}
                        disabled={!!msg.feedback}
                        title="Good response"
                        aria-label="Thumbs up"
                      >
                        👍
                      </button>
                      <button
                        className={`feedback-btn${msg.feedback === "bad" ? " feedback-active" : ""}`}
                        onClick={() => chat.submitFeedback(msg.id, "bad")}
                        disabled={!!msg.feedback}
                        title="Poor response"
                        aria-label="Thumbs down"
                      >
                        👎
                      </button>
                      {msg.feedback && (
                        <span className="feedback-thanks">
                          {msg.feedback === "good" ? "Thanks!" : "I'll improve"}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              {/* ── Intent Transparency Bar (collapsible) ── */}
              {msg.role === "ai" && msg.transparency && (
                <div className="transparency-section">
                  <button
                    className={`transparency-toggle${expandedTransparencies.has(msg.id) ? " transparency-toggle--open" : ""}`}
                    onClick={() => {
                      setExpandedTransparencies((prev) => {
                        const next = new Set(prev);
                        if (next.has(msg.id)) next.delete(msg.id);
                        else next.add(msg.id);
                        return next;
                      });
                    }}
                    aria-expanded={expandedTransparencies.has(msg.id)}
                  >
                    🔍 Why this response?
                    <span className={`transparency-toggle__chevron${expandedTransparencies.has(msg.id) ? " transparency-toggle__chevron--open" : ""}`}>▸</span>
                  </button>
                  {expandedTransparencies.has(msg.id) && (
                    <div className="transparency-bar">
                      <span className="transparency-chip" title="Query classification">
                        🏷️ {msg.transparency.query_type}
                      </span>
                      <span className="transparency-chip" title="Cognitive band used">
                        🌈 {msg.transparency.applied_band}
                      </span>
                      {msg.transparency.context_nodes_used > 0 && (
                        <span className="transparency-chip" title="Graph nodes used for context">
                          🔗 {msg.transparency.context_nodes_used} nodes
                        </span>
                      )}
                      <span className="transparency-chip" title="Model used">
                        🤖 {msg.transparency.model_used}
                      </span>
                      {msg.transparency.domain_detected && msg.transparency.domain_detected !== "General" && (
                        <span className="transparency-chip transparency-chip--domain" title="Detected professional domain">
                          🎯 {msg.transparency.domain_detected}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* ── Prism Refraction: alternative perspective ── */}
              {msg.role === "ai" && msg.refractionAlternative && (
                <div className="refraction-section">
                  <button
                    className={`refraction-toggle${expandedRefractions.has(msg.id) ? " refraction-toggle--open" : ""}`}
                    onClick={() => {
                      setExpandedRefractions((prev) => {
                        const next = new Set(prev);
                        if (next.has(msg.id)) next.delete(msg.id);
                        else next.add(msg.id);
                        return next;
                      });
                    }}
                    aria-expanded={expandedRefractions.has(msg.id)}
                  >
                    <span className="refraction-toggle__icon">🔮</span>
                    <span className="refraction-toggle__label">
                      See another perspective — {msg.refractionAlternative.band_emoji} {msg.refractionAlternative.band_label}
                    </span>
                    <span className={`refraction-toggle__chevron${expandedRefractions.has(msg.id) ? " refraction-toggle__chevron--open" : ""}`}>▸</span>
                  </button>
                  <AnimatePresence>
                    {expandedRefractions.has(msg.id) && (
                      <motion.div
                        className="refraction-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                      >
                        <div className="refraction-content__header">
                          <span className="refraction-content__band">
                            {msg.refractionAlternative.band_emoji} {msg.refractionAlternative.band_label} Perspective
                          </span>
                          <button
                            className="refraction-prefer-btn"
                            onClick={() => chat.selectRefractionPreference(msg.refractionAlternative!.band)}
                            title="Prefer this reasoning style for future responses"
                          >
                            ✨ Prefer this style
                          </button>
                        </div>
                        <div className="refraction-content__body">
                          <ReactMarkdown>{msg.refractionAlternative.response}</ReactMarkdown>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
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
                  {chat.processingElapsed > 0 && (
                    <span className="processing-timer">{chat.processingElapsed}s</span>
                  )}
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
        <div className={`proactive-suggestions ${ideasOpen ? "is-open" : "is-folded"}`}>
          <div className="proactive-header">
            <button
              className="proactive-toggle"
              onClick={() => setIdeasOpen((v) => !v)}
              aria-expanded={ideasOpen}
            >
              <span className="proactive-label">
                {Math.min(suggestions.proactiveSuggestions.length, 3)} {suggestions.proactiveSuggestions.length === 1 ? "idea" : "ideas"} from your memory
              </span>
              <span className="proactive-toggle-hint">{ideasOpen ? "Hide" : "Show"}</span>
            </button>
            <button
              className="proactive-dismiss-all"
              onClick={() => suggestions.setProactiveSuggestions([])}
              title="Dismiss all suggestions"
              aria-label="Dismiss all suggestions"
            >
              ✕
            </button>
          </div>
          {ideasOpen && <div className="proactive-cards">
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
          </div>}
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

      <UserGuide open={showGuide} onClose={() => setShowGuide(false)} />
    </>
  );
}
