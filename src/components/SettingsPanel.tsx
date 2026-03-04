// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Settings Panel — Full Configuration, Export/Import, Theme, About

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, GraphStats, OllamaModel, CrossDeviceMergeResult, MergeDiff } from "../types";
import prismosIcon from "../assets/prismos-icon.svg";
import "./SettingsPanel.css";

interface SecurityStatus {
  enclave: {
    backend: string;
    hardware_available: boolean;
    key_fingerprint: string;
    platform: string;
    details: string;
  };
  audit_chain: {
    valid: boolean;
    entries: number;
    message: string;
  };
  sandbox_active: boolean;
  hmac_signing: boolean;
  wasm_isolation: boolean;
  auto_rollback: boolean;
  encrypted_storage: boolean;
  local_only: boolean;
}

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

  // ── Model Hub state ──
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ status: string; percent: number } | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [modelToPull, setModelToPull] = useState("");

  // ── Multi-device sync state ──
  const [syncExporting, setSyncExporting] = useState(false);
  const [syncImporting, setSyncImporting] = useState(false);
  const [syncPreviewing, setSyncPreviewing] = useState(false);
  const [syncPassphrase, setSyncPassphrase] = useState("");
  const [syncStrategy, setSyncStrategy] = useState<"latest" | "theirs" | "ours">("latest");
  const [syncPreview, setSyncPreview] = useState<MergeDiff | null>(null);
  const [syncResult, setSyncResult] = useState<CrossDeviceMergeResult | null>(null);
  const [syncFileContent, setSyncFileContent] = useState<string | null>(null);

  // ── Security status (live from backend) ──
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [modelVerification, setModelVerification] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setSecurityLoading(true);
      try {
        const result = await invoke<string>("get_security_status");
        setSecurityStatus(JSON.parse(result));
      } catch {
        // Fallback — backend may not be ready yet
      } finally {
        setSecurityLoading(false);
      }
    })();
  }, []);

  const handleVerifyModel = useCallback(async () => {
    const model = settings.defaultModel || "llama3.2";
    setModelVerification("Verifying...");
    try {
      const result = await invoke<string>("verify_model", { model });
      const parsed = JSON.parse(result);
      setModelVerification(`${parsed.status === "Verified" ? "✅" : parsed.status === "Suspicious" ? "⚠️" : "ℹ️"} ${parsed.details}`);
    } catch (e) {
      setModelVerification(`❌ Verification failed: ${e}`);
    }
  }, [settings.defaultModel]);

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
      const result = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
      const parsed: OllamaModel[] = JSON.parse(result);
      setModels(parsed);
      setModelsLoaded(true);
    } catch {
      setModels([]);
      setModelsLoaded(true);
    }
  }, [settings.ollamaUrl]);

  // Auto-load models when Ollama is connected
  useEffect(() => {
    if (ollamaConnected && !modelsLoaded) {
      loadModels();
    }
  }, [ollamaConnected, modelsLoaded, loadModels]);

  // ── Pull a model from Ollama registry ──
  const handlePullModel = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setPullingModel(name);
    setPullProgress({ status: "Starting download…", percent: 0 });
    try {
      const result = await invoke<string>("pull_ollama_model", {
        modelName: name,
        ollamaUrl: settings.ollamaUrl,
      });
      showStatus(`✅ ${result}`, "success");
      await loadModels();
    } catch (e) {
      showStatus(`❌ Pull failed: ${e}`, "error");
    } finally {
      setPullingModel(null);
      setPullProgress(null);
    }
  }, [settings.ollamaUrl, showStatus, loadModels]);

  // ── Delete a model from Ollama ──
  const handleDeleteModel = useCallback(async (name: string) => {
    setDeletingModel(name);
    try {
      const result = await invoke<string>("delete_ollama_model", {
        modelName: name,
        ollamaUrl: settings.ollamaUrl,
      });
      showStatus(`🗑️ ${result}`, "success");
      await loadModels();
      // If deleted model was the default, clear it
      if (settings.defaultModel === name) {
        onSettingsChange({ ...settings, defaultModel: "" });
      }
    } catch (e) {
      showStatus(`❌ Delete failed: ${e}`, "error");
    } finally {
      setDeletingModel(null);
    }
  }, [settings, onSettingsChange, showStatus, loadModels]);

  // ── Listen for pull-progress events from Rust backend ──
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    listen<{ model: string; status: string; percent: number }>("pull-progress", (event) => {
      setPullProgress({ status: event.payload.status, percent: event.payload.percent });
    }).then((fn) => { unlistenFn = fn; });
    return () => { if (unlistenFn) unlistenFn(); };
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

  // ── Export Sync Package (passphrase-encrypted, portable) ──
  const handleExportSync = useCallback(async () => {
    if (!syncPassphrase || syncPassphrase.length < 4) {
      showStatus("⚠️ Enter a passphrase (min 4 characters) for sync encryption", "error");
      return;
    }
    setSyncExporting(true);
    try {
      const encrypted = await invoke<string>("export_sync_package", { passphrase: syncPassphrase });
      const blob = new Blob([encrypted], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prismos-sync-${new Date().toISOString().slice(0, 10)}.prismos-sync`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus("✅ Sync package exported (passphrase-encrypted, portable)", "success");
    } catch (e) {
      showStatus(`❌ Sync export failed: ${e}`, "error");
    } finally {
      setSyncExporting(false);
    }
  }, [syncPassphrase, showStatus]);

  // ── Load sync file for preview/import ──
  const handleLoadSyncFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".prismos-sync,.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        setSyncFileContent(text);
        setSyncPreview(null);
        setSyncResult(null);
        showStatus(`📁 Loaded sync file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, "info");
      } catch (err) {
        showStatus(`❌ Failed to read file: ${err}`, "error");
      }
    };
    input.click();
  }, [showStatus]);

  // ── Preview merge diff ──
  const handlePreviewMerge = useCallback(async () => {
    if (!syncFileContent) {
      showStatus("⚠️ Load a sync file first", "error");
      return;
    }
    if (!syncPassphrase || syncPassphrase.length < 4) {
      showStatus("⚠️ Enter the passphrase used to encrypt this file", "error");
      return;
    }
    setSyncPreviewing(true);
    try {
      const result = await invoke<string>("preview_sync_merge", {
        packageJson: syncFileContent,
        passphrase: syncPassphrase,
        strategy: syncStrategy,
      });
      const diff: MergeDiff = JSON.parse(result);
      setSyncPreview(diff);
      setSyncResult(null);
      showStatus("✅ Merge preview generated — review conflicts below", "success");
    } catch (e) {
      showStatus(`❌ Preview failed: ${e}`, "error");
    } finally {
      setSyncPreviewing(false);
    }
  }, [syncFileContent, syncPassphrase, syncStrategy, showStatus]);

  // ── Apply merge ──
  const handleApplyMerge = useCallback(async () => {
    if (!syncFileContent) {
      showStatus("⚠️ Load a sync file first", "error");
      return;
    }
    if (!syncPassphrase) {
      showStatus("⚠️ Enter the passphrase", "error");
      return;
    }
    setSyncImporting(true);
    try {
      const result = await invoke<string>("import_sync_package", {
        packageJson: syncFileContent,
        passphrase: syncPassphrase,
        strategy: syncStrategy,
      });
      const parsed: CrossDeviceMergeResult = JSON.parse(result);
      setSyncResult(parsed);
      setSyncPreview(parsed.merge_result.diff);
      showStatus(`✅ ${parsed.message}`, "success");
      if (onGraphCleared) onGraphCleared(); // refresh graph data
    } catch (e) {
      showStatus(`❌ Merge failed: ${e}`, "error");
    } finally {
      setSyncImporting(false);
    }
  }, [syncFileContent, syncPassphrase, syncStrategy, showStatus, onGraphCleared]);

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
                placeholder="llama3.2 (recommended), mistral, llava..."
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
              <div className="settings-hint">No models found. Run: ollama pull llama3.2</div>
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

        {/* ── Model Hub — Download, Manage, Delete Models ── */}
        <div className="settings-group">
          <h3>📦 Model Hub</h3>
          <div className="settings-hint" style={{ marginBottom: "0.75rem" }}>
            Browse, download, and manage your local AI models. All models run entirely on your machine.
          </div>

          {/* Installed models */}
          {models.length > 0 && (
            <div className="settings-model-hub-list">
              <div className="settings-model-hub-label">Installed Models</div>
              {models.map((m) => (
                <div key={m.name} className={`settings-model-hub-item ${settings.defaultModel === m.name ? "active" : ""}`}>
                  <div className="model-hub-item-info">
                    <span className="model-hub-item-name">{m.name}</span>
                    {m.size && <span className="model-hub-item-size">{(m.size / 1e9).toFixed(1)} GB</span>}
                    {m.modified_at && <span className="model-hub-item-date">{new Date(m.modified_at).toLocaleDateString()}</span>}
                  </div>
                  <div className="model-hub-item-actions">
                    <button
                      className={`settings-btn settings-btn-sm ${settings.defaultModel === m.name ? "settings-btn-primary" : ""}`}
                      onClick={() => update("defaultModel", m.name)}
                      title="Set as default model"
                    >
                      {settings.defaultModel === m.name ? "✅ Active" : "Use"}
                    </button>
                    <button
                      className="settings-btn settings-btn-sm settings-btn-danger"
                      onClick={() => handleDeleteModel(m.name)}
                      disabled={deletingModel === m.name}
                      title="Delete this model"
                    >
                      {deletingModel === m.name ? "⏳" : "🗑️"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pull new model */}
          <div className="settings-item">
            <label>Pull New Model</label>
            <div className="settings-model-row">
              <input
                className="settings-input"
                value={modelToPull}
                onChange={(e) => setModelToPull(e.target.value)}
                placeholder="e.g. llama3.2, mistral, codellama:7b"
                disabled={!!pullingModel}
              />
              <button
                className="settings-btn settings-btn-primary"
                onClick={() => handlePullModel(modelToPull)}
                disabled={!!pullingModel || !modelToPull.trim()}
              >
                {pullingModel ? "⏳ Pulling…" : "📥 Pull"}
              </button>
            </div>
          </div>

          {/* Pull progress */}
          {pullProgress && (
            <div className="settings-pull-progress">
              <div className="settings-pull-status">{pullProgress.status}</div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${pullProgress.percent}%` }} />
              </div>
              <div className="settings-pull-percent">{pullProgress.percent}%</div>
            </div>
          )}

          {/* Quick-pull popular models */}
          <div className="settings-model-hub-quick">
            <div className="settings-model-hub-label">Quick Pull</div>
            <div className="settings-model-hub-quick-chips">
              {["llama3.2", "llama3.2-vision", "mistral", "llava", "deepseek-r1:1.5b", "qwen2.5"].map((name) => {
                const isInstalled = models.some((m) => m.name.startsWith(name.split(":")[0]));
                return (
                  <button
                    key={name}
                    className={`settings-model-quick-chip ${isInstalled ? "installed" : ""}`}
                    onClick={() => !isInstalled && handlePullModel(name)}
                    disabled={!!pullingModel || isInstalled}
                    title={isInstalled ? "Already installed" : `Pull ${name}`}
                  >
                    {isInstalled ? "✅" : "📥"} {name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="settings-hint">
            Models are downloaded from the Ollama registry. Typical sizes: 1-8 GB.
            <button className="settings-btn settings-btn-sm" onClick={loadModels} style={{ marginLeft: "0.5rem" }}>
              ↻ Refresh
            </button>
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

        {/* ── Multi-Device Sync (Patent Pending — Graph Merge/Diff) ── */}
        <div className="settings-group">
          <h3>🔄 Multi-Device Sync</h3>
          <div className="settings-hint" style={{ marginBottom: "0.75rem" }}>
            Sync your Spectrum Graph between devices using a shared passphrase.
            Files are encrypted — the same passphrase must be used on both devices.
          </div>

          {/* Passphrase */}
          <div className="settings-item">
            <label>Sync Passphrase</label>
            <input
              className="settings-input"
              type="password"
              placeholder="Shared passphrase (min 4 chars)…"
              value={syncPassphrase}
              onChange={(e) => setSyncPassphrase(e.target.value)}
            />
          </div>

          {/* Strategy */}
          <div className="settings-item">
            <label>Merge Strategy</label>
            <div className="settings-sync-strategies">
              <button
                className={`settings-sync-strategy-btn ${syncStrategy === "latest" ? "active" : ""}`}
                onClick={() => setSyncStrategy("latest")}
                title="Most recently updated version wins on conflict"
              >
                🕐 Latest Wins
              </button>
              <button
                className={`settings-sync-strategy-btn ${syncStrategy === "theirs" ? "active" : ""}`}
                onClick={() => setSyncStrategy("theirs")}
                title="Incoming data always overwrites local on conflict"
              >
                📥 Theirs Wins
              </button>
              <button
                className={`settings-sync-strategy-btn ${syncStrategy === "ours" ? "active" : ""}`}
                onClick={() => setSyncStrategy("ours")}
                title="Local data is kept on conflict"
              >
                🏠 Ours Wins
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="settings-actions">
            <button
              className="settings-btn settings-btn-primary"
              onClick={handleExportSync}
              disabled={syncExporting || graphStats.nodes === 0 || syncPassphrase.length < 4}
            >
              {syncExporting ? "⏳ Exporting..." : "📤 Export Sync Package"}
            </button>
            <button
              className="settings-btn settings-btn-secondary"
              onClick={handleLoadSyncFile}
            >
              📁 Load Sync File
            </button>
          </div>

          {/* Loaded file actions */}
          {syncFileContent && (
            <div className="settings-sync-loaded">
              <div className="settings-sync-loaded-label">
                ✅ Sync file loaded
              </div>
              <div className="settings-actions">
                <button
                  className="settings-btn settings-btn-secondary"
                  onClick={handlePreviewMerge}
                  disabled={syncPreviewing || syncPassphrase.length < 4}
                >
                  {syncPreviewing ? "⏳ Analyzing..." : "🔍 Preview Merge"}
                </button>
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={handleApplyMerge}
                  disabled={syncImporting || syncPassphrase.length < 4}
                >
                  {syncImporting ? "⏳ Merging..." : "🔀 Apply Merge"}
                </button>
              </div>
            </div>
          )}

          {/* Merge Preview / Result */}
          {syncPreview && (
            <div className="settings-sync-preview">
              <div className="settings-sync-preview-title">
                {syncResult ? "✅ Merge Result" : "🔍 Merge Preview"}
              </div>
              <div className="settings-sync-stats">
                <div className="sync-stat">
                  <span className="sync-stat-value">{syncPreview.nodes_only_remote}</span>
                  <span className="sync-stat-label">New Nodes</span>
                </div>
                <div className="sync-stat">
                  <span className="sync-stat-value">{syncPreview.edges_only_remote}</span>
                  <span className="sync-stat-label">New Edges</span>
                </div>
                <div className="sync-stat">
                  <span className="sync-stat-value">{syncPreview.nodes_both}</span>
                  <span className="sync-stat-label">Shared Nodes</span>
                </div>
                <div className="sync-stat">
                  <span className="sync-stat-value">{syncPreview.nodes_conflicted + syncPreview.edges_conflicted}</span>
                  <span className="sync-stat-label">Conflicts</span>
                </div>
              </div>

              {/* Conflict details */}
              {syncPreview.conflicts.length > 0 && (
                <div className="settings-sync-conflicts">
                  <div className="sync-conflicts-header">
                    ⚠️ {syncPreview.conflicts.length} conflict{syncPreview.conflicts.length !== 1 ? "s" : ""} detected
                  </div>
                  <div className="sync-conflicts-list">
                    {syncPreview.conflicts.slice(0, 10).map((c, i) => (
                      <div key={i} className="sync-conflict-item">
                        <span className="sync-conflict-type">{c.entity_type}</span>
                        <span className="sync-conflict-field">{c.field}</span>
                        <div className="sync-conflict-values">
                          <span className="sync-conflict-local" title={c.local_value}>
                            🏠 {c.local_value.slice(0, 40)}{c.local_value.length > 40 ? "…" : ""}
                          </span>
                          <span className="sync-conflict-arrow">→</span>
                          <span className="sync-conflict-remote" title={c.remote_value}>
                            📥 {c.remote_value.slice(0, 40)}{c.remote_value.length > 40 ? "…" : ""}
                          </span>
                        </div>
                        <span className={`sync-conflict-resolution ${c.resolution}`}>
                          {c.resolution === "took_remote" ? "📥 Remote" : c.resolution === "kept_local" ? "🏠 Local" : "🕐 Latest"}
                        </span>
                      </div>
                    ))}
                    {syncPreview.conflicts.length > 10 && (
                      <div className="sync-conflicts-more">
                        +{syncPreview.conflicts.length - 10} more conflicts…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Merge result details */}
              {syncResult && (
                <div className="settings-sync-result-details">
                  <div className="sync-result-row">
                    <span>Strategy:</span>
                    <strong>{syncResult.merge_result.strategy}</strong>
                  </div>
                  <div className="sync-result-row">
                    <span>Nodes added / updated / skipped:</span>
                    <strong>{syncResult.merge_result.nodes_added} / {syncResult.merge_result.nodes_updated} / {syncResult.merge_result.nodes_skipped}</strong>
                  </div>
                  <div className="sync-result-row">
                    <span>Edges added / updated / skipped:</span>
                    <strong>{syncResult.merge_result.edges_added} / {syncResult.merge_result.edges_updated} / {syncResult.merge_result.edges_skipped}</strong>
                  </div>
                  <div className="sync-result-row">
                    <span>Source device:</span>
                    <strong title={syncResult.source_device}>{syncResult.source_device.slice(0, 16)}…</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="settings-hint">
            Sync uses passphrase-based encryption — portable across devices.
            Use "Preview Merge" to see conflicts before applying. Patent Pending.
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

        {/* ── Voice I/O (Patent Pending) ── */}
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
            No audio is sent to any server. Patent Pending.
          </div>
        </div>

        {/* ── Security Status (live from backend) ── */}
        <div className="settings-group">
          <h3>🛡️ Security Status</h3>
          {securityLoading ? (
            <div className="settings-hint">Loading security status…</div>
          ) : (
          <div className="security-status-grid">
            <div className="security-check">
              <span className="security-check-icon">✅</span>
              <div className="security-check-info">
                <span className="security-check-label">Local Processing</span>
                <span className="security-check-desc">All AI runs on your device via Ollama — nothing sent to the cloud</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">✅</span>
              <div className="security-check-info">
                <span className="security-check-label">WASM Sandbox</span>
                <span className="security-check-desc">Agent code runs in isolated WebAssembly containers with strict limits</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">✅</span>
              <div className="security-check-info">
                <span className="security-check-label">HMAC Code Signing</span>
                <span className="security-check-desc">Every agent action is cryptographically signed and verified</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">✅</span>
              <div className="security-check-info">
                <span className="security-check-label">Auto-Rollback</span>
                <span className="security-check-desc">Unsafe changes are automatically reversed with checkpoint recovery</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">✅</span>
              <div className="security-check-info">
                <span className="security-check-label">Encrypted Storage</span>
                <span className="security-check-desc">Graph data encrypted with HMAC-SHA256 + XOR stream cipher, device-bound</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">✅</span>
              <div className="security-check-info">
                <span className="security-check-label">Zero Cloud Dependency</span>
                <span className="security-check-desc">Works fully offline — no accounts, no telemetry, no external APIs</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.enclave?.hardware_available ? "🔐" : "🔑"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Secure Enclave</span>
                <span className="security-check-desc">
                  {securityStatus?.enclave
                    ? `${securityStatus.enclave.hardware_available ? "Hardware-backed" : "Software"}: ${securityStatus.enclave.backend.replace(/([A-Z])/g, ' $1').trim()} · Key: ${securityStatus.enclave.key_fingerprint}`
                    : "Initializing…"}
                </span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.audit_chain?.valid ? "✅" : "⚠️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Tamper-Evident Audit Log</span>
                <span className="security-check-desc">
                  {securityStatus?.audit_chain
                    ? `${securityStatus.audit_chain.entries} entries · Chain ${securityStatus.audit_chain.valid ? "verified ✓" : "BROKEN ✗"}`
                    : "Initializing…"}
                </span>
              </div>
            </div>
          </div>
          )}
          {/* Model Verification */}
          <div className="settings-item" style={{ marginTop: "0.75rem" }}>
            <label>Model Verification</label>
            <div className="settings-model-row">
              <button className="settings-btn settings-btn-sm" onClick={handleVerifyModel} disabled={!ollamaConnected}>
                🔍 Verify {settings.defaultModel || "model"}
              </button>
            </div>
            {modelVerification && (
              <div className="settings-hint" style={{ marginTop: "0.5rem" }}>{modelVerification}</div>
            )}
          </div>
          <div className="settings-hint">
            All protections are always active. PrismOS-AI is designed with security-by-default — no configuration needed.
          </div>
        </div>

        {/* ── System Info ── */}
        <div className="settings-group">
          <h3>📊 System Information</h3>
          <div className="settings-version-banner">
            <img src={prismosIcon} alt="" className="settings-version-icon" />
            <div className="settings-version-info">
              <span className="settings-version-name">PrismOS-AI</span>
              <span className="settings-version-number">v0.5.0</span>
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
          <h3><img src={prismosIcon} alt="" className="header-icon" /> About PrismOS-AI</h3>
          <p className="settings-about-text">
            PrismOS-AI is a local-first agentic personal AI operating system. All
            data stays on your device. Powered by Ollama for local LLM
            inference and a multi-agent Refractive Core architecture with
            persistent Spectrum Graph memory.
          </p>
          <div className="settings-patent-notice">
            <div className="settings-patent-badge">⚖️ PATENT PENDING</div>
            <p>
              <strong>US Provisional Patent Application</strong><br />
              Filed: February 2026
            </p>
            <p className="settings-patent-legal">
              This software and its core architectures are protected under US Patent Law.
            </p>
            <p className="settings-patent-legal">
              © 2026 PrismOS-AI Contributors. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
