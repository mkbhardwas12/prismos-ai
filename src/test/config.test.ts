// PrismOS-AI — config resolver unit tests
//
// Covers the stale/uninstalled default-model self-heal: the app must never try to
// run a model that isn't installed (root cause of the misleading "Ollama is down"
// error a user hit with a saved `deepseek-v3:16b` that was never pulled).

import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL, modelMatches, resolveDefaultModel } from "../lib/config";

describe("modelMatches", () => {
  it("matches identical names", () => {
    expect(modelMatches("qwen3:30b-a3b", "qwen3:30b-a3b")).toBe(true);
  });

  it("tolerates the implicit :latest tag in either direction", () => {
    expect(modelMatches("llama3.2", "llama3.2:latest")).toBe(true);
    expect(modelMatches("llama3.2:latest", "llama3.2")).toBe(true);
  });

  it("does not match different models or different tags", () => {
    expect(modelMatches("qwen3:30b-a3b", "qwen3:4b")).toBe(false);
    expect(modelMatches("llama3.2", "llama3.1")).toBe(false);
    expect(modelMatches("llama3.2", "llama3.2:1b")).toBe(false);
  });
});

describe("resolveDefaultModel", () => {
  const installed = ["qwen3.5:27b", "qwen3:30b-a3b", "qwen2.5-coder:7b", "llama3.1:8b"];

  it("keeps the saved model when it is installed (no fallback)", () => {
    const r = resolveDefaultModel("qwen2.5-coder:7b", installed);
    expect(r).toEqual({ model: "qwen2.5-coder:7b", fellBack: false });
  });

  it("falls back to DEFAULT_MODEL when the saved model is NOT installed", () => {
    // The exact bug: a saved deepseek-v3:16b that was never pulled.
    const r = resolveDefaultModel("deepseek-v3:16b", installed);
    expect(r.fellBack).toBe(true);
    expect(r.model).toBe(DEFAULT_MODEL); // qwen3.5:27b is installed
  });

  it("falls back to the first installed model when DEFAULT_MODEL is also absent", () => {
    const noDefault = ["llama3.1:8b", "gemma2:9b"];
    const r = resolveDefaultModel("deepseek-v3:16b", noDefault);
    expect(r).toEqual({ model: "llama3.1:8b", fellBack: true });
  });

  it("returns the canonical installed name for a bare saved model that maps to :latest (silent heal)", () => {
    // `llama3.2` implicitly means `llama3.2:latest` — same model, just the tag.
    const r = resolveDefaultModel("llama3.2", ["llama3.2:latest"]);
    expect(r).toEqual({ model: "llama3.2:latest", fellBack: false });
  });

  it("treats a bare name as a DIFFERENT model from a sized tag (genuine fallback)", () => {
    // `llama3.1` (→ :latest) is not the same as `llama3.1:8b`; nothing else installed.
    const r = resolveDefaultModel("llama3.1", ["llama3.1:8b"]);
    expect(r).toEqual({ model: "llama3.1:8b", fellBack: true });
  });

  it("returns model=null when nothing is installed", () => {
    const r = resolveDefaultModel("qwen3:30b-a3b", []);
    expect(r).toEqual({ model: null, fellBack: true });
  });

  it("handles an undefined saved model by choosing the preferred default", () => {
    const r = resolveDefaultModel(undefined, installed);
    expect(r).toEqual({ model: DEFAULT_MODEL, fellBack: false });
  });
});
