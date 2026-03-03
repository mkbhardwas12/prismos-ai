// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS — Ollama Client Unit Tests

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkOllamaHealth, listModels, generate } from "../lib/ollama";

// ─── Mock fetch globally ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Health Check ───────────────────────────────────────────────────────────────

describe("checkOllamaHealth", () => {
  it("returns true when Ollama responds 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await checkOllamaHealth();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns false when Ollama responds non-200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await checkOllamaHealth();
    expect(result).toBe(false);
  });

  it("returns false when fetch throws (Ollama not running)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await checkOllamaHealth();
    expect(result).toBe(false);
  });
});

// ─── List Models ────────────────────────────────────────────────────────────────

describe("listModels", () => {
  it("returns parsed model list on success", async () => {
    const mockModels = [
      { name: "mistral:latest", size: 4100000000, modified_at: "2024-01-01" },
      { name: "llama3.2:latest", size: 2000000000, modified_at: "2024-02-01" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: mockModels }),
    });

    const models = await listModels();
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe("mistral:latest");
    expect(models[1].name).toBe("llama3.2:latest");
  });

  it("returns empty array when Ollama is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const models = await listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when response has no models field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const models = await listModels();
    expect(models).toEqual([]);
  });
});

// ─── Generate ───────────────────────────────────────────────────────────────────

describe("generate", () => {
  it("sends correct request and returns response text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: "Hello, I am Mistral.", done: true }),
    });

    const result = await generate("mistral", "Hello");
    expect(result).toBe("Hello, I am Mistral.");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "mistral", prompt: "Hello", stream: false }),
      })
    );
  });

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(generate("nonexistent", "test")).rejects.toThrow("Ollama error: 404 Not Found");
  });
});
