// useOllama — Ollama connection, model management, setup wizard state

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, OllamaModel } from "../types";
import { toRecommendedFormat } from "../lib/modelRegistry";
import { resolveDefaultModel } from "../lib/config";

// ── Tiered model catalog — derived from centralized Model Registry ──
export const RECOMMENDED_MODELS = toRecommendedFormat();

export type SetupStep = "install" | "start" | "model" | "ready";

interface UseOllamaOptions {
  ollamaConnected: boolean;
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
}

export function useOllama({ ollamaConnected, settings, onSettingsChange }: UseOllamaOptions) {
  // Model dropdown state
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string | null>(null);
  const [pullPercent, setPullPercent] = useState<number>(0);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Stale/uninstalled default-model banner (self-heal notice)
  const [modelWarning, setModelWarning] = useState<string | null>(null);

  // Setup wizard state
  const [hasModels, setHasModels] = useState<boolean | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [wizardExpanded, setWizardExpanded] = useState(false);

  // Determine which setup step the user is on
  const getSetupStep = useCallback((): SetupStep => {
    if (ollamaConnected && hasModels) return "ready";
    if (ollamaConnected && hasModels === false) return "model";
    if (ollamaConnected) return "model";
    return "start";
  }, [ollamaConnected, hasModels]);

  // On connect: load installed models, then self-heal a stale `defaultModel`.
  // If the saved model isn't installed (e.g. a `deepseek-v3:16b` that was never
  // pulled), fall back to an installed one and persist it — so the app can never
  // try to run a missing model and then surface a misleading "Ollama is down".
  useEffect(() => {
    if (!ollamaConnected) {
      setHasModels(null);
      return;
    }
    (async () => {
      try {
        const result = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
        const parsed = JSON.parse(result);
        const list: OllamaModel[] = Array.isArray(parsed) ? parsed : [];
        setAvailableModels(list);
        setHasModels(list.length > 0);

        const names = list.map((m) => m.name);
        const { model, fellBack } = resolveDefaultModel(settings.defaultModel, names);
        if (model && fellBack) {
          // Genuine stale setting — warn and switch to an installed model.
          setModelWarning(
            `"${settings.defaultModel}" isn't installed — switched to "${model}". ` +
            `Run \`ollama pull ${settings.defaultModel}\` or pick a model in Settings.`
          );
          onSettingsChange({ ...settings, defaultModel: model });
        } else if (model && model !== settings.defaultModel) {
          // Tag normalization only (e.g. llama3.2 → llama3.2:latest) — heal silently.
          setModelWarning(null);
          onSettingsChange({ ...settings, defaultModel: model });
        } else {
          setModelWarning(null);
        }
      } catch {
        setHasModels(false);
      }
    })();
    // Validation runs once per connect; intentionally not re-run on settings changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaConnected]);

  // Fetch available models when connected & dropdown opens
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

  // Close dropdown on outside click
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
      const listResult = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
      setAvailableModels(JSON.parse(listResult));
      onSettingsChange({ ...settings, defaultModel: modelName });
      setTimeout(() => { setPullingModel(null); setPullProgress(null); setPullPercent(0); }, 2000);
    } catch (e) {
      setPullProgress(`❌ ${String(e)}`);
      setTimeout(() => { setPullingModel(null); setPullProgress(null); setPullPercent(0); }, 4000);
    } finally {
      unlisten();
    }
  }, [settings, onSettingsChange]);

  const handleStartOllama = useCallback(async () => {
    setIsLaunching(true);
    setLaunchStatus(null);
    try {
      const result = await invoke<string>("launch_ollama");
      setLaunchStatus(result);
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

  const handleRetryConnection = useCallback(async () => {
    setIsRetrying(true);
    try {
      await invoke<boolean>("check_ollama_status", { ollamaUrl: settings.ollamaUrl });
    } catch { /* ignore */ }
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

  return {
    // Model dropdown
    availableModels,
    modelDropdownOpen,
    setModelDropdownOpen,
    pullingModel,
    pullProgress,
    pullPercent,
    modelDropdownRef,
    selectModel,
    pullModelFromDropdown,
    // Stale-model self-heal banner
    modelWarning,
    dismissModelWarning: () => setModelWarning(null),
    // Wizard
    hasModels,
    isLaunching,
    launchStatus,
    isPulling,
    pullStatus,
    isRetrying,
    wizardExpanded,
    setWizardExpanded,
    showFirstTimeWizard: false,
    dismissFirstTimeWizard: () => {},
    getSetupStep,
    handleStartOllama,
    handleRetryConnection,
    handlePullModel,
  };
}
