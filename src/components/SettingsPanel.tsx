// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Settings Panel — Configuration UI

import type { AppSettings } from "../types";

interface SettingsPanelProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  ollamaConnected: boolean;
}

export default function SettingsPanel({
  settings,
  onSettingsChange,
  ollamaConnected,
}: SettingsPanelProps) {
  function update(key: keyof AppSettings, value: string | number) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <>
      <div className="main-header">
        <h2>⚙️ Settings</h2>
        <div className="ollama-status">
          <span
            className={`status-dot ${ollamaConnected ? "connected" : ""}`}
          />
          {ollamaConnected ? "Connected" : "Offline"}
        </div>
      </div>

      <div className="settings-panel">
        {/* Ollama Configuration */}
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
            <input
              className="settings-input"
              value={settings.defaultModel}
              onChange={(e) => update("defaultModel", e.target.value)}
              placeholder="mistral, llama3, phi3, gemma2..."
            />
          </div>
          <div className="settings-item">
            <label>Max Tokens</label>
            <input
              className="settings-input"
              type="number"
              value={settings.maxTokens}
              onChange={(e) =>
                update("maxTokens", parseInt(e.target.value) || 2048)
              }
            />
          </div>
        </div>

        {/* System Info */}
        <div className="settings-group">
          <h3>📊 System Information</h3>
          <div className="settings-item">
            <label>Version</label>
            <input
              className="settings-input"
              value="0.1.0-alpha (MVP)"
              readOnly
            />
          </div>
          <div className="settings-item">
            <label>Architecture</label>
            <input
              className="settings-input"
              value="Tauri 2.0 + React + Rust · Local-First"
              readOnly
            />
          </div>
          <div className="settings-item">
            <label>Patent</label>
            <input
              className="settings-input"
              value="US 63/993,589 (Feb 28, 2026) — Pending"
              readOnly
            />
          </div>
          <div className="settings-item">
            <label>Ollama Status</label>
            <input
              className="settings-input"
              value={ollamaConnected ? "✅ Connected" : "❌ Offline — run: ollama serve"}
              readOnly
            />
          </div>
        </div>

        {/* Core Agents */}
        <div className="settings-group">
          <h3>🧠 Refractive Core Agents</h3>
          <div className="settings-item">
            <label>Agent Pipeline</label>
            <input
              className="settings-input"
              value="Orchestrator → Memory Keeper → Reasoner → Tool Smith → Sentinel"
              readOnly
            />
          </div>
          <div className="settings-item">
            <label>Orchestration Engine</label>
            <input
              className="settings-input"
              value="LangGraph (Python sidecar ready)"
              readOnly
            />
          </div>
        </div>

        {/* About */}
        <div className="settings-group">
          <h3>◈ About PrismOS</h3>
          <p
            style={{
              fontSize: "13px",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            PrismOS is a local-first agentic personal AI operating system. All
            data stays on your device. Powered by Ollama for local LLM
            inference and a multi-agent Refractive Core architecture with
            persistent Spectrum Graph memory.
          </p>
        </div>
      </div>
    </>
  );
}
