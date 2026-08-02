// PrismOS-AI Settings Panel — Full Configuration, Export/Import, Theme, About

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, GraphStats, OllamaModel, CrossDeviceMergeResult, MergeDiff } from "../types";
import DomainInsights from "./DomainInsights";
import prismosIcon from "../assets/prismos-icon.svg";
import { chooseModelAfterRemoval, DEFAULT_MODEL, modelMatches } from "../lib/config";
import { getConservativeRamSuggestion, MODEL_REGISTRY } from "../lib/modelRegistry";
import "./SettingsPanel.css";

const MAX_PORTABLE_PACKAGE_BYTES = 128 * 1024 * 1024;
const QUICK_PULL_MODELS = [...MODEL_REGISTRY]
  .filter((model) => model.capabilities.includes("text") && model.tier !== "power")
  .sort((a, b) => a.priority - b.priority)
  .slice(0, 6);

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
  private_inference_client_fixed_loopback?: boolean;
}

interface KnowledgeScanPreview {
  scan_id: string;
  source_id: string;
  project_name: string;
  root_path: string;
  total_files_seen: number;
  candidate_files: number;
  candidate_paths: string[];
  total_candidate_bytes: number;
  skipped_sensitive_files: number;
  skipped_dirs: string[];
  truncated: boolean;
}

interface KnowledgeSource {
  id: string;
  name: string;
  root_path: string;
  file_count: number;
  chunk_count: number;
  bytes_indexed: number;
  skipped_files: number;
  error_count: number;
  status: string;
  last_indexed: string;
}

function formatKnowledgeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseModelList(raw: string): OllamaModel[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value as OllamaModel[] : [];
  } catch {
    return [];
  }
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
  // Models on the editable management endpoint (list/pull/delete only).
  const [models, setModels] = useState<OllamaModel[]>([]);
  // Models on fixed loopback; only these may be selected for private inference.
  const [localInferenceModels, setLocalInferenceModels] = useState<OllamaModel[]>([]);
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

  // ── Full private-vault disaster recovery (kept in memory only) ──
  const [vaultPath, setVaultPath] = useState("");
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState("");
  const [vaultRestoreConfirmation, setVaultRestoreConfirmation] = useState("");
  const [vaultBusy, setVaultBusy] = useState<"export" | "restore" | null>(null);

  // ── Security status (live from backend) ──
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState(false);
  const [modelVerification, setModelVerification] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["ollama", "hub", "knowledge"]));

  // ── Approved project knowledge sources ──
  const [knowledgePath, setKnowledgePath] = useState("");
  const [knowledgePreview, setKnowledgePreview] = useState<KnowledgeScanPreview | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [knowledgeBusy, setKnowledgeBusy] = useState<"scan" | "index" | "forget" | null>(null);
  const [forgetKnowledgeId, setForgetKnowledgeId] = useState<string | null>(null);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    (async () => {
      setSecurityLoading(true);
      try {
        const result = await invoke<string>("get_security_status");
        setSecurityStatus(JSON.parse(result));
        setSecurityError(false);
      } catch {
        setSecurityStatus(null);
        setSecurityError(true);
      } finally {
        setSecurityLoading(false);
      }
    })();
  }, []);

  const handleInspectModelMetadata = useCallback(async () => {
    const model = settings.defaultModel || DEFAULT_MODEL;
    setModelVerification("Classifying self-reported model metadata heuristically...");
    try {
      const result = await invoke<string>("inspect_model_metadata", { model });
      const parsed = JSON.parse(result);
      setModelVerification(`${parsed.status === "Mismatch" ? "⚠️" : "ℹ️"} ${parsed.details}`);
    } catch (e) {
      setModelVerification(`❌ Metadata inspection failed: ${e}`);
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

  const loadKnowledgeSources = useCallback(async () => {
    try {
      const raw = await invoke<string>("list_project_knowledge_sources");
      const parsed: unknown = JSON.parse(raw);
      setKnowledgeSources(Array.isArray(parsed) ? parsed as KnowledgeSource[] : []);
    } catch {
      setKnowledgeSources([]);
    }
  }, []);

  useEffect(() => {
    loadKnowledgeSources();
  }, [loadKnowledgeSources]);

  const scanKnowledgePath = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setKnowledgeBusy("scan");
    try {
      if (knowledgePreview) {
        await invoke("cancel_project_knowledge_scan", { scanId: knowledgePreview.scan_id });
        setKnowledgePreview(null);
      }
      const raw = await invoke<string>("scan_project_knowledge", { path: path.trim() });
      const parsed = JSON.parse(raw) as Partial<KnowledgeScanPreview>;
      if (
        typeof parsed.scan_id !== "string" ||
        typeof parsed.source_id !== "string" ||
        typeof parsed.project_name !== "string" ||
        typeof parsed.root_path !== "string"
      ) {
        throw new Error("Backend returned an invalid knowledge preview");
      }
      const preview: KnowledgeScanPreview = {
        scan_id: parsed.scan_id,
        source_id: parsed.source_id,
        project_name: parsed.project_name,
        root_path: parsed.root_path,
        total_files_seen: Number(parsed.total_files_seen) || 0,
        candidate_files: Number(parsed.candidate_files) || 0,
        candidate_paths: Array.isArray(parsed.candidate_paths)
          ? parsed.candidate_paths.filter((path): path is string => typeof path === "string")
          : [],
        total_candidate_bytes: Number(parsed.total_candidate_bytes) || 0,
        skipped_sensitive_files: Number(parsed.skipped_sensitive_files) || 0,
        skipped_dirs: Array.isArray(parsed.skipped_dirs)
          ? parsed.skipped_dirs.filter((path): path is string => typeof path === "string")
          : [],
        truncated: parsed.truncated === true,
      };
      setKnowledgePreview(preview);
      setKnowledgePath(preview.root_path);
      showStatus(`Metadata scan ready: ${preview.candidate_files} candidate text files. Review the paths before approval.`, "info");
    } catch (e) {
      showStatus(`Project scan failed: ${e}`, "error");
    } finally {
      setKnowledgeBusy(null);
    }
  }, [knowledgePreview, showStatus]);

  const handleApproveKnowledge = useCallback(async () => {
    if (!knowledgePreview) return;
    setKnowledgeBusy("index");
    try {
      const raw = await invoke<string>("index_project_knowledge", {
        scanId: knowledgePreview.scan_id,
      });
      const result = JSON.parse(raw) as { source?: KnowledgeSource; errors?: string[] };
      const source = result.source;
      showStatus(
        source
          ? `Indexed ${source.file_count} files into ${source.chunk_count} cited knowledge chunks.`
          : "Project knowledge indexed.",
        "success",
      );
      setKnowledgePreview(null);
      await loadKnowledgeSources();
      onGraphCleared?.();
    } catch (e) {
      // Approval tokens are one-time and are consumed before file reads begin.
      setKnowledgePreview(null);
      showStatus(`Knowledge indexing failed: ${e}`, "error");
    } finally {
      setKnowledgeBusy(null);
    }
  }, [knowledgePreview, loadKnowledgeSources, onGraphCleared, showStatus]);

  const handleCancelKnowledge = useCallback(async () => {
    if (!knowledgePreview) return;
    try {
      await invoke("cancel_project_knowledge_scan", { scanId: knowledgePreview.scan_id });
    } catch { /* one-time scan state will expire with the app */ }
    setKnowledgePreview(null);
  }, [knowledgePreview]);

  const handleForgetKnowledge = useCallback(async (source: KnowledgeSource) => {
    if (forgetKnowledgeId !== source.id) {
      setForgetKnowledgeId(source.id);
      return;
    }
    setKnowledgeBusy("forget");
    try {
      await invoke<string>("forget_project_knowledge_source", {
        sourceId: source.id,
        confirmation: `FORGET:${source.id}`,
      });
      setForgetKnowledgeId(null);
      showStatus(`Forgot ${source.name} and its owned knowledge chunks. Source files were untouched.`, "success");
      await loadKnowledgeSources();
      onGraphCleared?.();
    } catch (e) {
      showStatus(`Could not forget source: ${e}`, "error");
    } finally {
      setKnowledgeBusy(null);
    }
  }, [forgetKnowledgeId, loadKnowledgeSources, onGraphCleared, showStatus]);

  // ── Load available Ollama models ──
  const loadModels = useCallback(async () => {
    const [managementResult, localResult] = await Promise.allSettled([
      invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl }),
      invoke<string>("list_local_inference_models"),
    ]);
    const managementModels = managementResult.status === "fulfilled"
      ? parseModelList(managementResult.value)
      : [];
    const localModels = localResult.status === "fulfilled"
      ? parseModelList(localResult.value)
      : [];
    setModels(managementModels);
    setLocalInferenceModels(localModels);
    setModelsLoaded(true);
    return { managementModels, localModels };
  }, [settings.ollamaUrl]);

  useEffect(() => {
    setModelsLoaded(false);
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
        model: name,
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
      const { localModels } = await loadModels();
      const removedActiveModel = modelMatches(settings.defaultModel, name)
        && !localModels.some((model) => modelMatches(settings.defaultModel, model.name));
      if (removedActiveModel) {
        const nextModel = chooseModelAfterRemoval(localModels.map((model) => model.name));
        onSettingsChange({ ...settings, defaultModel: nextModel });
        showStatus(`🗑️ ${result} Selected "${nextModel}" for local inference.`, "success");
      } else {
        showStatus(`🗑️ ${result}`, "success");
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
          if (file.size > MAX_PORTABLE_PACKAGE_BYTES) {
            throw new Error(`Package exceeds the ${MAX_PORTABLE_PACKAGE_BYTES}-byte import limit`);
          }
          const text = await file.text();
          if (text.length > MAX_PORTABLE_PACKAGE_BYTES) {
            throw new Error(`Package exceeds the ${MAX_PORTABLE_PACKAGE_BYTES}-byte import limit`);
          }
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
      showStatus(
        `${parsed.success ? "🗑️" : "⚠️"} ${parsed.message}`,
        parsed.success ? "success" : "error",
      );
      setConfirmClear(false);
      if (onGraphCleared) onGraphCleared();
    } catch (e) {
      showStatus(`❌ Clear failed: ${e}`, "error");
    } finally {
      setClearing(false);
    }
  }, [confirmClear, showStatus, onGraphCleared]);

  const handleExportPrivateVault = useCallback(async () => {
    if (!vaultPath.trim()) {
      showStatus("⚠️ Enter a full destination path outside every Git repository", "error");
      return;
    }
    if (vaultPassphrase.length < 16) {
      showStatus("⚠️ Private-vault passphrases must contain at least 16 characters", "error");
      return;
    }
    if (vaultPassphrase !== vaultPassphraseConfirm) {
      showStatus("⚠️ Private-vault passphrases do not match", "error");
      return;
    }
    setVaultBusy("export");
    try {
      const raw = await invoke<string>("export_private_vault", {
        destination: vaultPath.trim(),
        passphrase: vaultPassphrase,
      });
      const result = JSON.parse(raw) as { message: string; package_bytes: number };
      showStatus(
        `✅ ${result.message} (${formatKnowledgeBytes(result.package_bytes)})`,
        "success",
      );
      setVaultPassphrase("");
      setVaultPassphraseConfirm("");
    } catch (error) {
      showStatus(`❌ Private-vault export failed: ${error}`, "error");
    } finally {
      setVaultBusy(null);
    }
  }, [vaultPath, vaultPassphrase, vaultPassphraseConfirm, showStatus]);

  const handleStagePrivateVaultRestore = useCallback(async () => {
    if (!vaultPath.trim()) {
      showStatus("⚠️ Enter the full path to a .prismos-vault file", "error");
      return;
    }
    if (vaultPassphrase.length < 16) {
      showStatus("⚠️ Enter the 16+ character passphrase used for this vault", "error");
      return;
    }
    if (vaultRestoreConfirmation !== "RESTORE MY PRIVATE PRISMOS VAULT") {
      showStatus("⚠️ Type the exact restore confirmation phrase", "error");
      return;
    }
    setVaultBusy("restore");
    try {
      const raw = await invoke<string>("stage_private_vault_restore", {
        packagePath: vaultPath.trim(),
        passphrase: vaultPassphrase,
        confirmation: vaultRestoreConfirmation,
      });
      const result = JSON.parse(raw) as { message: string; restart_required: boolean };
      showStatus(
        `✅ ${result.message}${result.restart_required ? " Quit and reopen PrismOS to apply it." : ""}`,
        "success",
      );
      setVaultPassphrase("");
      setVaultPassphraseConfirm("");
      setVaultRestoreConfirmation("");
    } catch (error) {
      showStatus(`❌ Private-vault restore was not staged: ${error}`, "error");
    } finally {
      setVaultBusy(null);
    }
  }, [vaultPath, vaultPassphrase, vaultRestoreConfirmation, showStatus]);

  // ── Export Sync Package (passphrase-encrypted, portable) ──
  const handleExportSync = useCallback(async () => {
    if (!syncPassphrase || syncPassphrase.length < 12) {
      showStatus("⚠️ Enter a passphrase with at least 12 characters for sync encryption", "error");
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
        if (file.size > MAX_PORTABLE_PACKAGE_BYTES) {
          throw new Error(`Package exceeds the ${MAX_PORTABLE_PACKAGE_BYTES}-byte import limit`);
        }
        const text = await file.text();
        if (text.length > MAX_PORTABLE_PACKAGE_BYTES) {
          throw new Error(`Package exceeds the ${MAX_PORTABLE_PACKAGE_BYTES}-byte import limit`);
        }
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
    if (!syncPassphrase || syncPassphrase.length < 12) {
      showStatus("⚠️ Enter the 12+ character passphrase used to encrypt this file", "error");
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
    if (!syncPassphrase || syncPassphrase.length < 12) {
      showStatus("⚠️ Enter the 12+ character passphrase", "error");
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

  const selectedLocalModelName = localInferenceModels.find((model) =>
    modelMatches(settings.defaultModel, model.name)
  )?.name ?? "";

  return (
    <>
      <div className="main-header">
        <h2>⚙️ Settings</h2>
        <div className="ollama-status">
          <span className={`status-dot ${ollamaConnected ? "connected" : ""}`} />
          {ollamaConnected ? "Local inference connected" : "Local inference offline"}
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
          <h3 className="settings-group-toggle" onClick={() => toggleSection("ollama")}>
            🤖 Ollama Configuration
            <span className={`settings-group-chevron${expandedSections.has("ollama") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("ollama") && (<>
          <div className="settings-item">
            <label>Ollama Management URL</label>
            <input
              className="settings-input"
              value={settings.ollamaUrl}
              maxLength={2048}
              onChange={(e) => update("ollamaUrl", e.target.value)}
            />
          </div>
          <div className="settings-hint">
            Used only for explicit management list/pull/delete actions. Chat, Project
            Knowledge, documents, and images always use the fixed loopback inference
            boundary. Remote management also requires
            PRISMOS_ALLOW_REMOTE_OLLAMA=1.
          </div>
          <div className="settings-item">
            <label>Default Local Inference Model</label>
            <div className="settings-model-row">
              <select
                className="settings-input"
                value={selectedLocalModelName}
                onChange={(e) => update("defaultModel", e.target.value)}
                disabled={localInferenceModels.length === 0}
              >
                <option value="" disabled>Select a model installed on loopback</option>
                {localInferenceModels.map((model) => (
                  <option key={model.name} value={model.name}>{model.name}</option>
                ))}
              </select>
              <button className="settings-btn settings-btn-sm" onClick={loadModels}>
                {modelsLoaded ? "↻ Refresh" : "Load Models"}
              </button>
            </div>
            {modelsLoaded && localInferenceModels.length > 0 && (
              <div className="settings-model-list">
                {localInferenceModels.map((m) => (
                  <button
                    key={m.name}
                    className={`settings-model-tag ${modelMatches(settings.defaultModel, m.name) ? "active" : ""}`}
                    onClick={() => update("defaultModel", m.name)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            {modelsLoaded && localInferenceModels.length === 0 && (
              <div className="settings-hint">No chat-capable completion model found on fixed loopback. Run: ollama pull {DEFAULT_MODEL}</div>
            )}
          </div>
          <div className="settings-item">
            <label>Document &amp; Vision Output Limit</label>
            <input
              className="settings-input"
              type="number"
              value={settings.maxTokens}
              onChange={(e) => update("maxTokens", parseInt(e.target.value) || 2048)}
            />
            <div className="settings-hint">Applies to direct document, image, and generated-artifact calls. Normal chat uses bounded workflow budgets.</div>
          </div>
          </>)}
        </div>

        {/* ── Model Hub — Download, Manage, Delete Models ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("hub")}>
            📦 Model Hub
            <span className={`settings-group-chevron${expandedSections.has("hub") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("hub") && (<>
          <div className="settings-hint" style={{ marginBottom: "0.75rem" }}>
            Browse, download, and manage models through the selected Ollama management endpoint.
            Only models also present on fixed loopback can be selected for private inference.
            PrismOS does not attest where a separately configured management daemon executes.
          </div>

          {/* Installed models */}
          {models.length > 0 && (
            <div className="settings-model-hub-list">
              <div className="settings-model-hub-label">Installed Models</div>
              {models.map((m) => {
                const localMatch = localInferenceModels.find((local) => modelMatches(local.name, m.name));
                const availableLocally = !!localMatch;
                const isActive = !!localMatch && modelMatches(settings.defaultModel, localMatch.name);
                return (
                <div key={m.name} className={`settings-model-hub-item ${isActive ? "active" : ""}`}>
                  <div className="model-hub-item-info">
                    <span className="model-hub-item-name">{m.name}</span>
                    {m.size && <span className="model-hub-item-size">{(m.size / 1e9).toFixed(1)} GB</span>}
                    {m.modified_at && <span className="model-hub-item-date">{new Date(m.modified_at).toLocaleDateString()}</span>}
                  </div>
                  <div className="model-hub-item-actions">
                    <button
                      className={`settings-btn settings-btn-sm ${isActive ? "settings-btn-primary" : ""}`}
                      onClick={() => localMatch && update("defaultModel", localMatch.name)}
                      disabled={!availableLocally}
                      title={availableLocally ? "Set as the fixed-loopback inference model" : "This model exists only on the management endpoint"}
                    >
                      {availableLocally ? (isActive ? "✅ Active" : "Use locally") : "Management only"}
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
              );})}
            </div>
          )}

          {/* Pull new model */}
          <div className="settings-item">
            <label>Pull New Model</label>
            <div className="settings-model-row">
              <input
                className="settings-input"
                value={modelToPull}
                maxLength={200}
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
              {QUICK_PULL_MODELS.map((model) => {
                const isInstalled = models.some((installed) => modelMatches(model.name, installed.name));
                const prerequisite = model.minOllamaVersion
                  ? ` Catalog prerequisite: Ollama ${model.minOllamaVersion}+; installed version is not checked.`
                  : "";
                return (
                  <button
                    key={model.name}
                    className={`settings-model-quick-chip ${isInstalled ? "installed" : ""}`}
                    onClick={() => !isInstalled && handlePullModel(model.name)}
                    disabled={!!pullingModel || isInstalled}
                    title={`${isInstalled ? "Already installed." : `Pull ${model.name}.`}${prerequisite}`}
                  >
                    {isInstalled ? "✅" : "📥"} {model.name}
                    {model.minOllamaVersion && (
                      <small> · requires Ollama {model.minOllamaVersion}+ (version not checked)</small>
                    )}
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
          </>)}
        </div>

        {/* ── Query-topic mix + heuristic model suggestion ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("domain")}>
            🧭 Query Topic Mix
            <span className={`settings-group-chevron${expandedSections.has("domain") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("domain") && (<>
          <DomainInsights />
          <div style={{ marginTop: "0.75rem" }}>
            <button
              className="settings-btn settings-btn-secondary"
              onClick={async () => {
                try {
                  const infoRaw = await invoke<string>("get_system_info");
                  const info = JSON.parse(infoRaw);
                  const recRaw = await invoke<string>("get_model_recommendations");
                  const recs = JSON.parse(recRaw);
                  if (recs.length > 0) {
                    const rec = recs[0];
                    showToast?.(
                      `Heuristic suggestion from ${rec.sample_count} local samples: ${rec.recommended_model} ` +
                      `(${Math.round(rec.satisfaction_rate * 100)}% recorded positive feedback, ${Math.round(rec.avg_latency_ms)} ms average). Verify on your workload.`
                    );
                  } else {
                    // Fallback: a static RAM fit, not a quality benchmark.
                    const ram = info.total_ram_gb || 8;
                    const rec = getConservativeRamSuggestion(ram);
                    showToast?.(`Heuristic RAM fit for ${ram.toFixed(0)}GB: try ${rec.name}, then verify quality and latency on your workload.`);
                  }
                } catch {
                  showToast?.("No heuristic model suggestion is available yet.");
                }
              }}
            >
              🎯 Suggest a Model (Heuristic)
            </button>
          </div>
          </>)}
        </div>

        {/* ── Project Knowledge — approved, cited local sources ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("knowledge")}>
            🧠 Project Knowledge
            <span className={`settings-group-chevron${expandedSections.has("knowledge") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("knowledge") && (<>
            <div className="settings-hint" style={{ marginBottom: "0.75rem" }}>
              Add an approved project or projects folder. PrismOS skips common secret/key files,
              vendor/build folders, binaries, symlinks, and oversized files; applies heuristic,
              best-effort literal-credential redaction; stores source-tagged chunks in the local
              SQLite graph; and replaces stale chunks on refresh. Redaction cannot guarantee that
              every secret or regulated value is detected.
            </div>
            <div className="settings-item">
              <label>Project Folder</label>
              <div className="settings-model-row">
                <input
                  className="settings-input"
                  value={knowledgePath}
                  onChange={(e) => setKnowledgePath(e.target.value)}
                  placeholder="/Users/you/Documents/my-project"
                  disabled={knowledgeBusy !== null || knowledgePreview !== null}
                />
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={() => scanKnowledgePath(knowledgePath)}
                  disabled={!knowledgePath.trim() || knowledgeBusy !== null}
                >
                  {knowledgeBusy === "scan" ? "Scanning metadata…" : "Scan"}
                </button>
              </div>
            </div>

            {knowledgePreview && (
              <div className="knowledge-preview">
                <div className="knowledge-preview-title">Approval required · {knowledgePreview.project_name}</div>
                <div className="knowledge-preview-root" title={knowledgePreview.root_path}>
                  Approved root: {knowledgePreview.root_path}
                </div>
                <div className="knowledge-preview-grid">
                  <span>{knowledgePreview.candidate_files} candidate text files</span>
                  <span>{formatKnowledgeBytes(knowledgePreview.total_candidate_bytes)}</span>
                  <span>{knowledgePreview.skipped_sensitive_files} sensitive excluded</span>
                  <span>{knowledgePreview.skipped_dirs.length} ignored folders</span>
                </div>
                <div className="settings-hint">
                  Metadata only so far—no file content has been read. Approving reads this bounded set in read-only mode,
                  redacts likely literal credentials on a best-effort basis, and writes source-tagged chunks to the
                  account-private local graph. The live graph is not encrypted at rest by PrismOS, and later answers can
                  send retrieved excerpts to the fixed-loopback Ollama daemon.
                  {knowledgePreview.truncated && " The source exceeded a safety budget. Choose a narrower root; incomplete scans cannot replace existing knowledge."}
                </div>
                <details className="knowledge-candidates">
                  <summary>
                    Review candidate paths ({Math.min(knowledgePreview.candidate_paths.length, 100)} shown)
                  </summary>
                  <ul>
                    {knowledgePreview.candidate_paths.map((path) => <li key={path}>{path}</li>)}
                  </ul>
                </details>
                <div className="settings-actions">
                  <button
                    className="settings-btn settings-btn-primary"
                    onClick={handleApproveKnowledge}
                    disabled={knowledgeBusy !== null || knowledgePreview.truncated}
                  >
                    {knowledgeBusy === "index" ? "Indexing…" : "Approve & Index"}
                  </button>
                  <button className="settings-btn" onClick={handleCancelKnowledge} disabled={knowledgeBusy !== null}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="knowledge-sources">
              <div className="settings-model-hub-label">
                Active Sources · {knowledgeSources.length}
              </div>
              {knowledgeSources.length === 0 ? (
                <div className="settings-hint">No project sources indexed yet.</div>
              ) : knowledgeSources.map((source) => (
                <div className="knowledge-source" key={source.id}>
                  <div className="knowledge-source-main">
                    <strong>{source.name}</strong>
                    <span title={source.root_path}>{source.root_path}</span>
                    <small>
                      {source.file_count} files · {source.chunk_count} chunks · {formatKnowledgeBytes(source.bytes_indexed)}
                      {source.error_count > 0 ? ` · ${source.error_count} read errors` : ""}
                    </small>
                  </div>
                  <div className="knowledge-source-actions">
                    <button
                      className="settings-btn settings-btn-sm"
                      onClick={() => { setKnowledgePath(source.root_path); scanKnowledgePath(source.root_path); }}
                      disabled={knowledgeBusy !== null || knowledgePreview !== null}
                    >
                      Refresh
                    </button>
                    <button
                      className={`settings-btn settings-btn-sm ${forgetKnowledgeId === source.id ? "settings-btn-danger-confirm" : "settings-btn-danger"}`}
                      onClick={() => handleForgetKnowledge(source)}
                      disabled={knowledgeBusy !== null || knowledgePreview !== null}
                      title="Removes only PrismOS-owned chunks; source files are never touched"
                    >
                      {forgetKnowledgeId === source.id ? "Confirm Forget" : "Forget"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>)}
        </div>

        {/* ── Spectrum Graph Management ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("graph")}>
            🌈 Spectrum Graph
            <span className={`settings-group-chevron${expandedSections.has("graph") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("graph") && (<>
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
              disabled={clearing}
            >
              {clearing ? "⏳ Clearing..." : confirmClear ? "⚠️ Permanently clear all learned data" : "🗑️ Clear All Data"}
            </button>
          </div>
          <div className="settings-hint">
            Export uses You-Port AES-256-GCM authenticated file encryption.
            Device-bound exports omit regenerable Project Knowledge excerpts and source
            approvals; re-approve and index those roots on the restored device.
            Clear All Data also removes stored prompts, response feedback, profiles, learned state,
            pending in-app restores, pending scans, and any legacy plaintext graph export. It cannot
            delete encrypted exports or Private Vault files you saved elsewhere, nor your original projects.
          </div>
          </>)}
        </div>

        {/* ── Encrypted full-database recovery candidate ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("vault")}>
            🔐 Private Vault Backup & Restore
            <span className={`settings-group-chevron${expandedSections.has("vault") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("vault") && (<>
          <div className="settings-hint" style={{ marginBottom: "0.75rem" }}>
            A Private Vault is designed as a full-database recovery copy: it includes managed
            Project Knowledge and the audit log when present. It is passphrase-encrypted, but the backend still
            refuses to create it inside any Git worktree. Create it on a separate encrypted
            drive; if you later copy only the ciphertext into a private backup repository,
            verify that repository is private first and never store the passphrase beside it.
            Complete a clean-profile restore drill before relying on any vault as recovery media,
            and keep an independent backup until that drill passes.
          </div>
          <div className="settings-item">
            <label>Vault File Path</label>
            <input
              className="settings-input"
              value={vaultPath}
              onChange={(event) => setVaultPath(event.target.value)}
              placeholder="Full path ending in .prismos-vault"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="settings-item">
            <label>Vault Passphrase</label>
            <input
              className="settings-input"
              type="password"
              value={vaultPassphrase}
              onChange={(event) => setVaultPassphrase(event.target.value)}
              placeholder="At least 16 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="settings-item">
            <label>Repeat Passphrase (export)</label>
            <input
              className="settings-input"
              type="password"
              value={vaultPassphraseConfirm}
              onChange={(event) => setVaultPassphraseConfirm(event.target.value)}
              placeholder="Repeat before creating a new vault"
              autoComplete="new-password"
            />
          </div>
          <div className="settings-actions">
            <button
              className="settings-btn settings-btn-primary"
              onClick={handleExportPrivateVault}
              disabled={vaultBusy !== null}
            >
              {vaultBusy === "export" ? "⏳ Creating Vault…" : "🔐 Create Full Vault"}
            </button>
          </div>
          <div className="settings-item">
            <label>Exact Confirmation (restore only)</label>
            <input
              className="settings-input"
              value={vaultRestoreConfirmation}
              onChange={(event) => setVaultRestoreConfirmation(event.target.value)}
              placeholder="RESTORE MY PRIVATE PRISMOS VAULT"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="settings-actions">
            <button
              className="settings-btn settings-btn-danger"
              onClick={handleStagePrivateVaultRestore}
              disabled={vaultBusy !== null}
            >
              {vaultBusy === "restore" ? "⏳ Validating Vault…" : "Stage Full Restore"}
            </button>
          </div>
          <div className="settings-hint">
            Restore decrypts and validates the complete database first, then stages an atomic
            startup swap. It does not change the running graph. After staging, quit and reopen
            PrismOS; startup fails closed if the protected swap cannot be completed safely.
          </div>
          </>)}
        </div>

        {/* ── Multi-Device Sync (Graph Merge/Diff) ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("sync")}>
            🔄 Multi-Device Sync
            <span className={`settings-group-chevron${expandedSections.has("sync") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("sync") && (<>
          <div className="settings-hint" style={{ marginBottom: "0.75rem" }}>
            Transfer an encrypted Spectrum Graph file between devices, then preview and apply
            a merge locally. The same passphrase must be entered on both devices.
          </div>

          {/* Passphrase */}
          <div className="settings-item">
            <label>Sync Passphrase</label>
            <input
              className="settings-input"
              type="password"
              placeholder="Shared passphrase (min 12 chars)…"
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
              disabled={syncExporting || graphStats.nodes === 0 || syncPassphrase.length < 12}
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
                  disabled={syncPreviewing || syncPassphrase.length < 12}
                >
                  {syncPreviewing ? "⏳ Analyzing..." : "🔍 Preview Merge"}
                </button>
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={handleApplyMerge}
                  disabled={syncImporting || syncPassphrase.length < 12}
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
            Use "Preview Merge" to see conflicts before applying.
          </div>
          </>)}
        </div>

        {/* ── Appearance ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("appearance")}>
            🎨 Appearance
            <span className={`settings-group-chevron${expandedSections.has("appearance") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("appearance") && (<>
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
                onClick={() => { update("theme", "light"); document.documentElement.setAttribute("data-theme", "light"); }}
              >
                ☀️ Light
              </button>
            </div>
          </div>
          <div className="settings-item">
            <label>Startup View</label>
            <select
              className="settings-select"
              value={settings.defaultView || "chat"}
              onChange={(e) => update("defaultView", e.target.value)}
            >
              <option value="chat">💬 Intent Console</option>
              <option value="dashboard">🏠 Daily Dashboard</option>
              <option value="graph">🕸️ Spectrum Graph</option>
              <option value="spectrum">🌈 Spectrum Explorer</option>
              <option value="timeline">📅 Spectral Timeline</option>
            </select>
            <div className="settings-hint">Choose which view PrismOS opens to on startup.</div>
          </div>
          </>)}
        </div>

        {/* ── Voice I/O ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("voice")}>
            🎙️ Voice Input / Output
            <span className={`settings-group-chevron${expandedSections.has("voice") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("voice") && (<>
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
            Voice input can use the browser-provided Web Speech API. Its privacy
            behavior depends on the operating system/browser. Local Whisper
            transcription is not implemented in this build, so disable voice input
            when audio must remain strictly on-device.
          </div>
          </>)}
        </div>

        {/* ── Email Summary ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("email")}>
            📬 Email Summary
            <span className={`settings-group-chevron${expandedSections.has("email") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("email") && (<>
          <div className="settings-item">
            <label>Allow Email Summary</label>
            <div className="settings-theme-toggle">
              <button
                className="settings-theme-btn"
                disabled
                aria-disabled="true"
              >
                Unavailable in this build
              </button>
            </div>
          </div>
          <div className="settings-hint">
            Disabled until PrismOS has OS-keychain credential storage and an explicit model-endpoint
            disclosure. Legacy WebView-stored IMAP credentials are removed during startup migration.
          </div>
          </>)}
        </div>

        {/* ── Calendar Integration ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("calendar")}>
            📅 Calendar Integration
            <span className={`settings-group-chevron${expandedSections.has("calendar") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("calendar") && (<>
          <div className="settings-item">
            <label>Allow Calendar Summary</label>
            <div className="settings-theme-toggle">
              <button
                className="settings-theme-btn"
                disabled
                aria-disabled="true"
              >
                Unavailable in this build
              </button>
            </div>
          </div>
          <div className="settings-hint">
            Disabled until calendar roots use the same explicit, one-time approval and path-binding
            protections as Project Knowledge. No calendar path is read from localStorage.
          </div>
          </>)}
        </div>

        {/* ── Finance Keeper ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("finance")}>
            💰 Finance Keeper
            <span className={`settings-group-chevron${expandedSections.has("finance") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("finance") && (<>
          <div className="settings-item">
            <label>Allow Portfolio Tracking</label>
            <div className="settings-theme-toggle">
              <button
                className="settings-theme-btn"
                disabled
                aria-disabled="true"
              >
                Unavailable in this build
              </button>
            </div>
          </div>
          <div className="settings-hint">
            Disabled until the ticker watchlist has an explicit private storage and network-consent
            workflow. No market-data network command is exposed in the current build.
          </div>
          </>)}
        </div>

        {/* ── Security Status (live from backend) ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("security")}>
            🛡️ Security Status
            <span className={`settings-group-chevron${expandedSections.has("security") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("security") && (<>
          {securityLoading ? (
            <div className="settings-hint">Loading security status…</div>
          ) : (
          <>
          {securityError && (
            <div className="settings-hint settings-warning">
              Live security status is unavailable. Protections below are shown as unverified.
            </div>
          )}
          <div className="security-status-grid">
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.local_only === true ? "✅" : "⚠️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Local Processing</span>
                <span className="security-check-desc">
                  {securityStatus?.local_only === true
                    ? "Inference is restricted to loopback Ollama endpoints; proxies and redirects are disabled"
                    : securityStatus?.local_only === false
                    ? "The fixed loopback inference policy could not be confirmed; stop before sending private prompts"
                    : "Live endpoint policy could not be verified"}
                </span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.sandbox_active === true ? "✅" : "⚠️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Action Policy</span>
                <span className="security-check-desc">{securityStatus?.sandbox_active === true ? "Supported action descriptions use allow-lists, risk tiers, anomaly checks, and bounded records; arbitrary code is not executed" : "Action-policy status is inactive or unverified"}</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.hmac_signing === true ? "✅" : "⚠️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">HMAC Action Records</span>
                <span className="security-check-desc">{securityStatus?.hmac_signing === true ? "Ephemeral sandbox records use a process-local HMAC; this is not code signing or hardware attestation" : "Action-record authentication is inactive or unverified"}</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.auto_rollback === true ? "✅" : "ℹ️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Rollback Boundary</span>
                <span className="security-check-desc">{securityStatus?.auto_rollback === true ? "Verified rollback is active" : "Rejected guarded actions are marked in Prism bookkeeping; filesystem, network, and arbitrary database side effects are not generically undone"}</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.encrypted_storage ? "✅" : "⚠️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Storage Protection</span>
                <span className="security-check-desc">
                  {securityStatus?.encrypted_storage
                    ? "Graph data is encrypted at rest"
                    : securityStatus?.encrypted_storage === false
                    ? "Graph files are account-private but not encrypted at rest; exported You-Port packages use AES-256-GCM"
                    : "Storage protection status could not be verified"}
                </span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.private_inference_client_fixed_loopback === true ? "✅" : "⚠️"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Private Inference Client Route</span>
                <span className="security-check-desc">Chat/document/vision requests are fixed to loopback; PrismOS does not attest the separately installed daemon's identity, execution location, or later egress</span>
              </div>
            </div>
            <div className="security-check">
              <span className="security-check-icon">{securityStatus?.enclave?.hardware_available ? "🔐" : "🔑"}</span>
              <div className="security-check-info">
                <span className="security-check-label">Key Derivation</span>
                <span className="security-check-desc">
                  {securityStatus?.enclave
                    ? `${securityStatus.enclave.hardware_available ? "Platform hardware indicator detected; software-derived key" : "Software-derived machine key"}: ${securityStatus.enclave.backend.replace(/([A-Z])/g, ' $1').trim()} · Fingerprint: ${securityStatus.enclave.key_fingerprint}`
                    : "Key derivation status could not be verified"}
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
                    : "Audit-chain status could not be verified"}
                </span>
              </div>
            </div>
          </div>
          </>
          )}
          {/* Heuristic model metadata inspection */}
          <div className="settings-item" style={{ marginTop: "0.75rem" }}>
            <label>Heuristic Model Metadata Compatibility</label>
            <div className="settings-model-row">
              <button className="settings-btn settings-btn-sm" onClick={handleInspectModelMetadata} disabled={!ollamaConnected}>
                🔍 Inspect {settings.defaultModel || DEFAULT_MODEL}
              </button>
            </div>
            {modelVerification && (
              <div className="settings-hint" style={{ marginTop: "0.5rem" }}>{modelVerification}</div>
            )}
            <div className="settings-hint" style={{ marginTop: "0.5rem" }}>
              This classifies metadata reported by the local Ollama daemon. It does not hash model
              bytes, verify a publisher signature, attest the daemon, or establish model safety.
            </div>
          </div>
          <div className="settings-hint">
            Core protections are enabled by default. Review warnings above before enabling
            a remote Ollama management endpoint or an integration that uses the network.
          </div>
          </>)}
        </div>

        {/* ── System Info ── */}
        <div className="settings-group">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("system")}>
            📊 System Information
            <span className={`settings-group-chevron${expandedSections.has("system") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("system") && (<>
          <div className="settings-version-banner">
            <img src={prismosIcon} alt="" className="settings-version-icon" />
            <div className="settings-version-info">
              <span className="settings-version-name">PrismOS-AI</span>
              <span className="settings-version-number">v0.5.2</span>
            </div>
            <div className="settings-version-badges">
              <span className="settings-badge-local">Local-First</span>
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
            <label>Reasoning Workflow</label>
            <input
              className="settings-input"
              value="Route → plan → build → judge → optional refine (bounded, sequential)"
              readOnly
            />
            <div className="settings-hint">Named workflow roles and heuristic votes are trace labels, not five independently running AI agents.</div>
          </div>
          <div className="settings-item">
            <label>Encryption</label>
            <input className="settings-input" value="You-Port — AES-256-GCM Authenticated Encryption (Device-Bound)" readOnly />
          </div>
          </>)}
        </div>

        {/* ── About ── */}
        <div className="settings-group settings-about">
          <h3 className="settings-group-toggle" onClick={() => toggleSection("about")}>
            <img src={prismosIcon} alt="" className="header-icon" /> About PrismOS-AI
            <span className={`settings-group-chevron${expandedSections.has("about") ? " settings-group-chevron--open" : ""}`}>▸</span>
          </h3>
          {expandedSections.has("about") && (<>
          <p className="settings-about-text">
            PrismOS-AI is a local-first desktop assistant with bounded sequential workflows.
            Core inference uses a fixed loopback Ollama client route and graph memory stays
            in local app data; optional network integrations and explicitly enabled remote
            Ollama management endpoints have different privacy boundaries. Powered
            by Ollama and a Refractive Core pipeline with persistent Spectrum Graph memory.
          </p>
          <p className="settings-about-legal">
            © 2026 PrismOS-AI Contributors. Released under the MIT License.
          </p>
          </>)}
        </div>
      </div>
    </>
  );
}
