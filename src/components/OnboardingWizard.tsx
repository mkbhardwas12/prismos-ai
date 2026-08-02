// PrismOS-AI — First-Run Onboarding Wizard
//
// 3-step interactive wizard shown on first launch:
// Step 1: Check Ollama connection
// Step 2: Select/pull a model
// Step 3: Try your first intent
//
// Stores completion flag in localStorage so it only shows once.

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, OllamaModel } from "../types";
import { MODEL_REGISTRY, getDefaultModel } from "../lib/modelRegistry";
import prismosIcon from "../assets/prismos-icon.svg";
import "./OnboardingWizard.css";

interface OnboardingWizardProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onComplete: () => void;
}

// Build POPULAR_MODELS from the registry — show essential + recommended tiers
const POPULAR_MODELS = MODEL_REGISTRY
  .filter((m) => m.tier === "essential" || m.tier === "recommended")
  .sort((a, b) => a.priority - b.priority)
  .map((m) => ({
    name: m.name,
    desc: `${m.isDefault ? "🏆 Recommended — " : ""}${m.desc}`,
    size: m.size,
    capabilities: m.capabilities,
    suggestedRamGB: m.suggestedRamGB,
  }));

export default function OnboardingWizard({
  settings,
  onSettingsChange,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [ollamaOk, setOllamaOk] = useState(false);
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(settings.defaultModel || getDefaultModel(8).name);
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState("");
  const [sampleIntent, setSampleIntent] = useState("");

  // ── Step 1: Check Ollama ──
  const checkOllama = useCallback(async () => {
    setChecking(true);
    try {
      const ok = await invoke<boolean>("check_local_inference_status");
      setOllamaOk(ok);
      if (ok) {
        // Also load available models
        try {
          const result = await invoke<string>("list_local_inference_models");
          setModels(JSON.parse(result));
        } catch { /* ignore */ }
        setTimeout(() => setStep(2), 600);
      }
    } catch {
      setOllamaOk(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Auto-check on mount
    checkOllama();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 2: Pull model ──
  const handlePullModel = useCallback(async () => {
    setPulling(true);
    setPullProgress("Starting download…");
    try {
      const result = await invoke<string>("pull_ollama_model", {
        model: selectedModel,
      });
      const listResult = await invoke<string>("list_local_inference_models");
      const localModels: OllamaModel[] = JSON.parse(listResult);
      setModels(localModels);
      const installed = localModels.find((item) => item.name === selectedModel || item.name === `${selectedModel}:latest`);
      if (!installed) throw new Error("Downloaded model is not present on the private local inference endpoint.");
      onSettingsChange({ ...settings, defaultModel: installed.name });
      setPullProgress(`✅ ${result}`);
      setTimeout(() => setStep(3), 800);
    } catch (e) {
      setPullProgress(`❌ Failed: ${e}`);
    } finally {
      setPulling(false);
    }
  }, [selectedModel, settings, onSettingsChange]);

  const installedSelection = models.find((model) =>
    model.name === selectedModel || model.name === `${selectedModel}:latest`
  );
  const hasModel = Boolean(installedSelection);

  const handleFinish = useCallback(() => {
    localStorage.setItem("prismos-onboarding-done", "true");
    onComplete();
  }, [onComplete]);

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        {/* Header */}
        <div className="onboarding-header">
          <img src={prismosIcon} alt="" className="onboarding-logo" />
          <h1>Welcome to PrismOS-AI</h1>
          <p>Let's get you set up in under a minute</p>
        </div>

        {/* Progress dots */}
        <div className="onboarding-progress">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`onboarding-dot ${step === s ? "active" : ""} ${step > s ? "done" : ""}`}
            />
          ))}
        </div>

        {/* Step 1: Ollama Check */}
        {step === 1 && (
          <div className="onboarding-step">
            <div className="onboarding-step-icon">🔌</div>
            <h2>Step 1 — Connect to Ollama</h2>
            <p>
              PrismOS-AI uses <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> for
              private inference through a fixed <code>http://localhost:11434</code> client route.
              This setup check does not use the editable model-management URL.
            </p>

            <div className="onboarding-url-row">
              <label htmlFor="onboarding-private-inference-url">Private inference URL</label>
              <input
                id="onboarding-private-inference-url"
                type="text"
                value="http://localhost:11434"
                className="onboarding-input"
                readOnly
              />
            </div>

            <div className="onboarding-url-row">
              <label htmlFor="onboarding-management-url">Model management URL</label>
              <input
                id="onboarding-management-url"
                type="text"
                value={settings.ollamaUrl}
                onChange={(e) => onSettingsChange({ ...settings, ollamaUrl: e.target.value })}
                className="onboarding-input"
              />
            </div>
            <p>
              The management URL is saved for explicit status and model-management operations only;
              it cannot redirect chat, document, image, or Project Knowledge prompts. A non-loopback
              management origin also requires the documented environment opt-in and HTTPS.
            </p>

            <div className="onboarding-status">
              {checking ? (
                <span className="status-checking">🔄 Checking connection…</span>
              ) : ollamaOk ? (
                <span className="status-ok">✅ Fixed-loopback Ollama is running!</span>
              ) : (
                <span className="status-fail">❌ Fixed-loopback Ollama not detected — make sure it is running locally</span>
              )}
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-btn secondary" onClick={checkOllama} disabled={checking}>
                {checking ? "Checking…" : "Retry Connection"}
              </button>
              {ollamaOk && (
                <button className="onboarding-btn primary" onClick={() => setStep(2)}>
                  Next →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Model Selection */}
        {step === 2 && (
          <div className="onboarding-step">
            <div className="onboarding-step-icon">🧠</div>
            <h2>Step 2 — Choose Your Model</h2>
            <p>Pick an AI model. If you already have one installed, select it. Otherwise we'll download it for you.</p>

            {models.length > 0 && (
              <div className="onboarding-installed">
                <div className="onboarding-section-label">Installed Models</div>
                <div className="onboarding-model-grid">
                  {models.map((m) => (
                    <button
                      key={m.name}
                      className={`onboarding-model-chip ${selectedModel === m.name ? "selected" : ""}`}
                      onClick={() => setSelectedModel(m.name)}
                    >
                      <span className="model-chip-name">{m.name}</span>
                      {m.size && <span className="model-chip-size">{(m.size / 1e9).toFixed(1)} GB</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="onboarding-popular">
              <div className="onboarding-section-label">Recommended Models</div>
              <p className="onboarding-model-note">
                Static Ollama catalog suggestions with heuristic memory budgets; verify the tag,
                license, runtime version, and performance on your hardware before sensitive use.
              </p>
              <div className="onboarding-model-grid">
                {POPULAR_MODELS.map((m) => (
                  <button
                    key={m.name}
                    className={`onboarding-model-chip ${selectedModel === m.name ? "selected" : ""}`}
                    onClick={() => setSelectedModel(m.name)}
                  >
                    <span className="model-chip-name">{m.name}</span>
                    <span className="model-chip-desc">{m.desc}</span>
                    <span className="model-chip-size">{m.size}</span>
                    {m.capabilities && m.capabilities.length > 0 && (
                      <span className="model-chip-badges">
                        {m.capabilities.map((cap) => (
                          <span key={cap} className={`model-badge model-badge--${cap}`}>{cap}</span>
                        ))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {pullProgress && (
              <div className={`onboarding-pull-status ${pullProgress.startsWith("✅") ? "ok" : pullProgress.startsWith("❌") ? "err" : ""}`}>
                {pullProgress}
              </div>
            )}

            <div className="onboarding-actions">
              <button className="onboarding-btn secondary" onClick={() => setStep(1)}>
                ← Back
              </button>
              {hasModel ? (
                <button
                  className="onboarding-btn primary"
                  onClick={() => {
                    onSettingsChange({ ...settings, defaultModel: installedSelection!.name });
                    setStep(3);
                  }}
                >
                  Use {selectedModel} →
                </button>
              ) : (
                <button className="onboarding-btn primary" onClick={handlePullModel} disabled={pulling}>
                  {pulling ? "Downloading…" : `📦 Pull ${selectedModel}`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: First Intent */}
        {step === 3 && (
          <div className="onboarding-step">
            <div className="onboarding-step-icon">🚀</div>
            <h2>Step 3 — Try Your First Intent</h2>
            <p>
              PrismOS-AI turns an <strong>intent</strong> into one or more bounded, sequential
              model calls—such as plan, build, judge, and optional refine. Try one of these or write your own:
            </p>

            <div className="onboarding-intent-chips">
              {[
                { icon: "📋", text: "Summarize what I should focus on today" },
                { icon: "💡", text: "Give me 3 creative project ideas" },
                { icon: "🔍", text: "Explain how a knowledge graph works" },
                { icon: "✍️", text: "Draft a short professional bio for me" },
              ].map((intent) => (
                <button
                  key={intent.text}
                  className={`onboarding-intent-chip ${sampleIntent === intent.text ? "selected" : ""}`}
                  onClick={() => setSampleIntent(intent.text)}
                >
                  <span>{intent.icon}</span>
                  <span>{intent.text}</span>
                </button>
              ))}
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-btn secondary" onClick={() => setStep(2)}>
                ← Back
              </button>
              <button className="onboarding-btn primary glow" onClick={handleFinish}>
                🎉 Start Using PrismOS-AI
              </button>
            </div>
          </div>
        )}

        {/* Skip button */}
        <button className="onboarding-skip" onClick={handleFinish}>
          Skip setup
        </button>
      </div>
    </div>
  );
}
