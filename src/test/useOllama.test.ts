import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useOllama } from "../hooks/useOllama";
import { DEFAULT_MODEL, DEFAULT_SETTINGS } from "../lib/config";
import type { AppSettings, OllamaModel } from "../types";

function settingsWith(defaultModel: string): AppSettings {
  return { ...DEFAULT_SETTINGS, defaultModel };
}

function localModel(name: string): OllamaModel {
  return { name, size: 2_500_000_000, modified_at: "2026-08-01T00:00:00Z" };
}

describe("useOllama model-state healing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets an unregistered saved tag before an empty-inventory pull", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_local_inference_models") return JSON.stringify([]);
      return "{}";
    });
    const onSettingsChange = vi.fn();

    const { result } = renderHook(() => useOllama({
      ollamaConnected: true,
      settings: settingsWith("deepseek-v3:16b"),
      onSettingsChange,
    }));

    await waitFor(() => expect(result.current.hasModels).toBe(false));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: DEFAULT_MODEL,
    }));
    expect(result.current.modelWarning).toContain("not in the reviewed model catalog");
  });

  it("preserves a reviewed catalog model as the empty-inventory pull target", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_local_inference_models") return JSON.stringify([]);
      return "{}";
    });
    const onSettingsChange = vi.fn();

    const { result } = renderHook(() => useOllama({
      ollamaConnected: true,
      settings: settingsWith("llama3.2"),
      onSettingsChange,
    }));

    await waitFor(() => expect(result.current.hasModels).toBe(false));
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(result.current.modelWarning).toBeNull();
  });

  it("guards the setup pull against a stale unregistered tag", async () => {
    let inventoryReads = 0;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_local_inference_models") {
        inventoryReads += 1;
        return inventoryReads === 1
          ? JSON.stringify([])
          : JSON.stringify([localModel(DEFAULT_MODEL)]);
      }
      if (command === "pull_ollama_model") return `pulled ${DEFAULT_MODEL}`;
      return "{}";
    });
    const onSettingsChange = vi.fn();

    const { result } = renderHook(() => useOllama({
      ollamaConnected: true,
      settings: settingsWith("deepseek-v3:16b"),
      onSettingsChange,
    }));
    await waitFor(() => expect(result.current.hasModels).toBe(false));

    await act(async () => {
      await result.current.handlePullModel();
    });

    expect(invoke).toHaveBeenCalledWith("pull_ollama_model", { model: DEFAULT_MODEL });
    expect(result.current.hasModels).toBe(true);
  });

  it("normalizes a reviewed bare tag to the canonical installed name", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_local_inference_models") {
        return JSON.stringify([localModel("llama3.2:latest")]);
      }
      return "{}";
    });
    const onSettingsChange = vi.fn();

    const { result } = renderHook(() => useOllama({
      ollamaConnected: true,
      settings: settingsWith("llama3.2"),
      onSettingsChange,
    }));

    await waitFor(() => expect(result.current.hasModels).toBe(true));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: "llama3.2:latest",
    }));
    expect(result.current.modelWarning).toBeNull();
  });

  it("does not recommend blindly pulling an invalid stale tag after fallback", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_local_inference_models") {
        return JSON.stringify([localModel(DEFAULT_MODEL)]);
      }
      return "{}";
    });

    const { result } = renderHook(() => useOllama({
      ollamaConnected: true,
      settings: settingsWith("deepseek-v3:16b"),
      onSettingsChange: vi.fn(),
    }));

    await waitFor(() => expect(result.current.modelWarning).not.toBeNull());
    expect(result.current.modelWarning).not.toContain("ollama pull");
  });
});
