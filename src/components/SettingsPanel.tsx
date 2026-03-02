// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Settings Panel — Full Configuration, Export/Import, Theme, About

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, GraphStats, OllamaModel } from "../types";
import prismosIcon from "../assets/prismos-icon.svg";

interface SettingsPanelProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  ollamaConnected: boolean;
  graphStats: GraphStats;
  onGraphCleared?: () => void;
  showToast?: (message: string) => void;
}

export default function SettingsPanel({
  settings,
  onSettingsChange,
  ollamaConnected,
  graphStats,
  onGraphCleared,
  showToast,
}: SettingsPanelProps) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  function update(key: keyof AppSettings, value: string | number | boolean) {
    onSettingsChange({ ...settings, [key]: value });
  }

  const showStatus = useCallback((text: string, type: "success" | "error" | "info" = "info") => {
    setStatusMessage({ text, type });
    if (showToast) showToast(text);
    setTimeout(() => setStatusMessage(null), 5000);
  }, [showToast]);

  // ── Load available Ollama models ──
  const loadModels = useCallback(async () => {
    try {
      const result = await invoke<string>("list_ollama_models");
      const parsed: OllamaModel[] = JSON.parse(result);
      setModels(parsed);
      setModelsLoaded(true);
    } catch {
      setModels([]);
      setModelsLoaded(true);
    }
  }, []);

  // ── Export Graph (encrypted) ──
  const handleExportGraph = useCallback(async () => {
    setExporting(true);
    try {
      const encrypted = await invoke<string>("export_graph");
      // Create a downloadable file
      const blob = new Blob([encrypted], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prismos-graph-${new Date().toISOString().slice(0, 10)}.prismos`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus("✅ Spectrum Graph exported (encrypted)", "success");
    } catch (e) {
      showStatus(`❌ Export failed: ${e}`, "error");
    } finally {
      setExporting(false);
    }
  }, [showStatus]);

  // ── Import Graph (encrypted) ──
  const handleImportGraph = useCallback(async () => {
    setImporting(true);
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".prismos,.json";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) { setImporting(false); return; }
        try {
          const text = await file.text();
          const result = await invoke<string>("import_graph", { packageJson: text });
          const parsed = JSON.parse(result);
          if (parsed.success) {
            showStatus(`✅ ${parsed.message}`, "success");
            if (onGraphCleared) onGraphCleared(); // refresh data
          } else {
            showStatus(`⚠️ Import returned no data`, "error");
          }
        } catch (err) {
          showStatus(`❌ Import failed: ${err}`, "error");
        } finally {
          setImporting(false);
        }
      };
      input.oncancel = () => setImporting(false);
      input.click();
    } catch (e) {
      showStatus(`❌ Import error: ${e}`, "error");
      setImporting(false);
    }
  }, [showStatus, onGraphCleared]);

  // ── Clear Graph ──
  const handleClearGraph = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 5000);
      return;
    }
    setClearing(true);
    try {
      const result = await invoke<string>("clear_graph");
      const parsed = JSON.parse(result);
      showStatus(`🗑️ ${parsed.message}`, "success");
      setConfirmClear(false);
      if (onGraphCleared) onGraphCleared();
    } catch (e) {
      showStatus(`❌ Clear failed: ${e}`, "error");
    } finally {
      setClearing(false);
    }
  }, [confirmClear, showStatus, onGraphCleared]);

  // ── Theme toggle ──
  const toggleTheme = useCallback(() => {
    const next = settings.theme === "dark" ? "light" : "dark";
    update("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }, [settings.theme]);

  return (
    <>
      <div className="main-header">
        <h2>⚙️ Settings</h2>
        <div className="ollama-status">
          <span className={`status-dot ${ollamaConnected ? "connected" : ""}`} />
          {ollamaConnected ? "Connected" : "Offline"}
        </div>
      </div>

      <div className="settings-panel">
        {/* Status Banner */}
        {statusMessage && (
          <div className={`settings-status settings-status-${statusMessage.type}`}>
            {statusMessage.text}
          </div>
        )}

        {/* ── Ollama Configuration ── */}
        <div className="settings-group">
          <h3>🤖 Ollama Configuration</h3>
          <div className="settings-item">
            <label>Ollama URL</label>
            <input
              className="settings-input"
              value={settings.ollamaUrl}
              onChange={(e) => update("ollamaUrl", e.target.value)}
            />
          </div>
          <div className="settings-item">
            <label>Default Model</label>
            <div className="settings-model-row">
              <input
                className="settings-input"
                value={settings.defaultModel}
                onChange={(e) => update("defaultModel", e.target.value)}
                placeholder="mistral, llama3, phi3, gemma2..."
              />
              <button className="settings-btn settings-btn-sm" onClick={loadModels}>
                {modelsLoaded ? "↻ Refresh" : "Load Models"}
              </button>
            </div>
            {modelsLoaded && models.length > 0 && (
              <div className="settings-model-list">
                {models.map((m) => (
                  <button
                    key={m.name}
                    className={`settings-model-tag ${settings.defaultModel === m.name ? "active" : ""}`}
                    onClick={() => update("defaultModel", m.name)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            {modelsLoaded && models.length === 0 && (
              <div className="settings-hint">No models found. Run: ollama pull mistral</div>
            )}
          </div>
          <div className="settings-item">
            <label>Max Tokens</label>
            <input
              className="settings-input"
              type="number"
              value={settings.maxTokens}
              onChange={(e) => update("maxTokens", parseInt(e.target.value) || 2048)}
            />
          </div>
        </div>

        {/* ── Spectrum Graph Management ── */}
        <div className="settings-group">
          <h3>🌈 Spectrum Graph</h3>
          <div className="settings-item">
            <label>Current Size</label>
            <input
              className="settings-input"
              value={`${graphStats.nodes} nodes · ${graphStats.edges} edges`}
              readOnly
            />
          </div>
          <div className="settings-actions">
            <button
              className="settings-btn settings-btn-primary"
              onClick={handleExportGraph}
              disabled={exporting || graphStats.nodes === 0}
            >
              {exporting ? "⏳ Exporting..." : "📤 Export Graph (Encrypted)"}
            </button>
            <button
              className="settings-btn settings-btn-secondary"
              onClick={handleImportGraph}
              disabled={importing}
            >
              {importing ? "⏳ Importing..." : "📥 Import Graph"}
            </button>
            <button
              className={`settings-btn ${confirmClear ? "settings-btn-danger-confirm" : "settings-btn-danger"}`}
              onClick={handleClearGraph}
              disabled={clearing || graphStats.nodes === 0}
            >
              {clearing ? "⏳ Clearing..." : confirmClear ? "⚠️ Click again to confirm" : "🗑️ Clear Graph"}
            </button>
          </div>
          <div className="settings-hint">
            Export uses You-Port end-to-end encryption (HMAC-SHA256 + XOR stream cipher).
            Files are device-bound and cannot be read on other devices.
          </div>
        </div>

        {/* ── Appearance ── */}
        <div className="settings-group">
          <h3>🎨 Appearance</h3>
          <div className="settings-item">
            <label>Theme</label>
            <div className="settings-theme-toggle">
              <button
                className={`settings-theme-btn ${settings.theme === "dark" ? "active" : ""}`}
                onClick={() => { update("theme", "dark"); document.documentElement.setAttribute("data-theme", "dark"); }}
              >
                🌙 Dark
              </button>
              <button
                className={`settings-theme-btn ${settings.theme === "light" ? "active" : ""}`}
                onClick={toggleTheme}
              >
                ☀️ Light
              </button>
            </div>
          </div>
        </div>

        {/* ── Voice I/O (Patent 63/993,589) ── */}
        <div className="settings-group">
          <h3>🎙️ Voice Input / Output</h3>
          <div className="settings-item">
            <label>Voice Input (Speech-to-Text)</label>
            <div className="settings-theme-toggle">
              <button
                className={`settings-theme-btn ${settings.voiceInputEnabled ? "active" : ""}`}
                onClick={() => update("voiceInputEnabled", !settings.voiceInputEnabled)}
              >
                {settings.voiceInputEnabled ? "✅ Enabled" : "Off"}
              </button>
            </div>
          </div>
          <div className="settings-item">
            <label>Voice Output (Text-to-Speech)</label>
            <div className="settings-theme-toggle">
              <button
                className={`settings-theme-btn ${settings.voiceOutputEnabled ? "active" : ""}`}
                onClick={() => update("voiceOutputEnabled", !settings.voiceOutputEnabled)}
              >
                {settings.voiceOutputEnabled ? "✅ Enabled" : "Off"}
              </button>
            </div>
          </div>
          <div className="settings-hint">
            Voice uses Web Speech API — all processing stays in your browser.
            No audio is sent to any server. Patent Pending US 63/993,589.
          </div>
        </div>

        {/* ── System Info ── */}
        <div className="settings-group">
          <h3>📊 System Information</h3>
          <div className="settings-version-banner">
            <img src={prismosIcon} alt="" className="settings-version-icon" />
            <div className="settings-version-info">
              <span className="settings-version-name">PrismOS</span>
              <span className="settings-version-number">v0.1.0-alpha</span>
            </div>
            <div className="settings-version-badges">
              <span className="settings-badge-patent">Patent Pending</span>
              <span className="settings-badge-local">100% Local</span>
            </div>
          </div>
          <div className="settings-item">
            <label>Architecture</label>
            <input className="settings-input" value="Tauri 2.0 + React 18 + Rust · Local-First" readOnly />
          </div>
          <div className="settings-item">
            <label>Ollama Status</label>
            <input
              className="settings-input"
              value={ollamaConnected ? "✅ Connected" : "❌ Offline — run: ollama serve"}
              readOnly
            />
          </div>
          <div className="settings-item">
            <label>Agent Pipeline</label>
            <input
              className="settings-input"
              value="Orchestrator → Memory Keeper → Reasoner → Tool Smith → Sentinel"
              readOnly
            />
          </div>
          <div className="settings-item">
            <label>Encryption</label>
            <input className="settings-input" value="You-Port — HMAC-SHA256 + XOR Stream Cipher (Device-Bound)" readOnly />
          </div>
        </div>

        {/* ── About + Patent Notice ── */}
        <div className="settings-group settings-about">
          <h3><img src={prismosIcon} alt="" className="header-icon" /> About PrismOS</h3>
          <p className="settings-about-text">
            PrismOS is a local-first agentic personal AI operating system. All
            data stays on your device. Powered by Ollama for local LLM
            inference and a multi-agent Refractive Core architecture with
            persistent Spectrum Graph memory.
          </p>
          <div className="settings-patent-notice">
            <div className="settings-patent-badge">⚖️ PATENT PENDING</div>
            <p>
              <strong>US Provisional Patent Application No. 63/993,589</strong><br />
              Filed: February 28, 2026<br />
              Title: "Local-First Agentic Personal AI Operating System with
              Persistent Spectrum Graph Memory and Multi-Agent Refractive Core"
            </p>
            <p className="settings-patent-legal">
              This software and its architecture — including the Spectrum Graph,
              Refractive Core, Sandbox Prisms, You-Port Handoff, and Intent Lens —
              are protected under US Patent Law. Unauthorized reproduction or
              distribution of the patented methods is prohibited.
            </p>
            <p className="settings-patent-legal">
              © 2026 PrismOS Contributors. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
