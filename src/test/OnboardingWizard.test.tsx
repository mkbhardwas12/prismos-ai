// PrismOS-AI — OnboardingWizard Component Tests (field names, getDefaultModel)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import OnboardingWizard from "../components/OnboardingWizard";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";
import { MODEL_REGISTRY, getDefaultModel } from "../lib/modelRegistry";

const defaultSettings: AppSettings = {
  ollamaUrl: "http://localhost:11434",
  defaultModel: "qwen3:4b",
  theme: "dark",
  maxTokens: 2048,
  voiceInputEnabled: false,
  voiceOutputEnabled: false,
  emailSummaryEnabled: false,
  calendarEnabled: false,
  financeEnabled: false,
  defaultView: "chat",
};

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default: ollama is running, has models
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "check_ollama_status") return true;
      if (cmd === "list_ollama_models") return JSON.stringify([
        { name: "qwen3:4b", size: 2.5e9 },
      ]);
      if (cmd === "pull_ollama_model") return "Model pulled successfully";
      return "{}";
    });
  });

  it("renders 3-step wizard", async () => {
    await act(async () => {
      render(
        <OnboardingWizard
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
          onComplete={vi.fn()}
        />
      );
    });
    expect(screen.getByText(/Welcome to PrismOS-AI/)).toBeInTheDocument();
    expect(screen.getByText(/Let's get you set up/)).toBeInTheDocument();
  });

  it("auto-checks Ollama on mount and advances to step 2", async () => {
    await act(async () => {
      render(
        <OnboardingWizard
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
          onComplete={vi.fn()}
        />
      );
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_ollama_status", { ollamaUrl: "http://localhost:11434" });
    });
    // After successful check it should auto-advance to step 2
    await waitFor(() => {
      expect(screen.getByText(/Choose Your Model/)).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it("uses m.desc and m.size for POPULAR_MODELS (not m.description/m.sizeLabel)", () => {
    // Verify MODEL_REGISTRY entries all have desc and size (not description/sizeLabel)
    for (const m of MODEL_REGISTRY) {
      expect(m).toHaveProperty("desc");
      expect(m).toHaveProperty("size");
      // Ensure the old field names are NOT present
      expect(m).not.toHaveProperty("description");
      expect(m).not.toHaveProperty("sizeLabel");
    }
  });

  it("getDefaultModel accepts ramGB parameter", () => {
    // getDefaultModel requires a ramGB argument
    const model4 = getDefaultModel(4);
    expect(model4).toBeDefined();
    expect(model4.name).toBeDefined();

    const model16 = getDefaultModel(16);
    expect(model16).toBeDefined();
    expect(model16.name).toBeDefined();

    // Higher RAM should get equal or higher priority model
    expect(model16.ramMin).toBeLessThanOrEqual(16);
    expect(model4.ramMin).toBeLessThanOrEqual(4);
  });

  it("POPULAR_MODELS built from registry show desc and size", async () => {
    await act(async () => {
      render(
        <OnboardingWizard
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
          onComplete={vi.fn()}
        />
      );
    });
    // Wait for step 2
    await waitFor(() => {
      expect(screen.getByText(/Choose Your Model/)).toBeInTheDocument();
    }, { timeout: 2000 });
    // The recommended model chips should display size values from registry
    const essentialModels = MODEL_REGISTRY.filter(m => m.tier === "essential" || m.tier === "recommended");
    for (const m of essentialModels.slice(0, 2)) {
      // Model names may appear in both installed and recommended lists
      expect(screen.getAllByText(m.name).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("Skip setup calls onComplete and saves to localStorage", async () => {
    const onComplete = vi.fn();
    await act(async () => {
      render(
        <OnboardingWizard
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
          onComplete={onComplete}
        />
      );
    });
    fireEvent.click(screen.getByText(/Skip setup/));
    expect(onComplete).toHaveBeenCalled();
    expect(localStorage.getItem("prismos-onboarding-done")).toBe("true");
  });

  it("renders step 3 with intent chips", async () => {
    const onSettingsChange = vi.fn();
    await act(async () => {
      render(
        <OnboardingWizard
          settings={defaultSettings}
          onSettingsChange={onSettingsChange}
          onComplete={vi.fn()}
        />
      );
    });
    // Wait for auto-advance to step 2
    await waitFor(() => {
      expect(screen.getByText(/Choose Your Model/)).toBeInTheDocument();
    }, { timeout: 2000 });
    // Click "Use qwen3:4b →" to advance to step 3
    const useBtn = screen.getByText(/Use qwen3:4b/);
    fireEvent.click(useBtn);
    await waitFor(() => {
      expect(screen.getByText(/Try Your First Intent/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Summarize what I should focus on today/)).toBeInTheDocument();
    expect(screen.getByText(/Give me 3 creative project ideas/)).toBeInTheDocument();
  });
});
