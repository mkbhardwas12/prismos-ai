// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// useOllama — Ollama connection, model management, setup wizard state

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, OllamaModel } from "../types";
import { MODEL_REGISTRY, toRecommendedFormat } from "../lib/modelRegistry";

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

  // Setup wizard state
  const [hasModels, setHasModels] = useState<boolean | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [wizardExpanded, setWizardExpanded] = useState(false);

  // First-time setup wizard modal
  const [showFirstTimeWizard, setShowFirstTimeWizard] = useState(
    () => !localStorage.getItem("prismos-setup-done")
  );

  const dismissFirstTimeWizard = useCallback(() => {
    localStorage.setItem("prismos-setup-done", "1");
    setShowFirstTimeWizard(false);
  }, []);

  // Determine which setup step the user is on
  const getSetupStep = useCallback((): SetupStep => {
    if (ollamaConnected && hasModels) return "ready";
    if (ollamaConnected && hasModels === false) return "model";
    if (ollamaConnected) return "model";
    return "start";
  }, [ollamaConnected, hasModels]);

  // Check if Ollama has models when it connects
  useEffect(() => {
    if (ollamaConnected) {
      (async () => {
        try {
          const result = await invoke<string>("list_ollama_models", { ollamaUrl: settings.ollamaUrl });
          const models = JSON.parse(result);
          setHasModels(Array.isArray(models) && models.length > 0);
        } catch {
          setHasModels(false);
        }
      })();
    } else {
      setHasModels(null);
    }
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
    // Wizard
    hasModels,
    isLaunching,
    launchStatus,
    isPulling,
    pullStatus,
    isRetrying,
    wizardExpanded,
    setWizardExpanded,
    showFirstTimeWizard,
    dismissFirstTimeWizard,
    getSetupStep,
    handleStartOllama,
    handleRetryConnection,
    handlePullModel,
  };
}
