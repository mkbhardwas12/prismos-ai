// PrismOS-AI — Model Registry Unit Tests

import { describe, it, expect } from "vitest";
import {
  MODEL_REGISTRY,
  getModelsForHardware,
  getDefaultModel,
  getModelsByCapability,
  getBestModelFor,
  getConservativeRamSuggestion,
  toLegacyFormat,
  toRecommendedFormat,
} from "../lib/modelRegistry";
import type { ModelSpec, ModelCapability } from "../lib/modelRegistry";

// ─── MODEL_REGISTRY Structure ───────────────────────────────────────────────────

describe("MODEL_REGISTRY", () => {
  it("is a non-empty array of ModelSpec objects", () => {
    expect(Array.isArray(MODEL_REGISTRY)).toBe(true);
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every entry has required fields", () => {
    for (const spec of MODEL_REGISTRY) {
      expect(spec.name).toBeTruthy();
      expect(spec.desc).toBeTruthy();
      expect(spec.size).toBeTruthy();
      expect(typeof spec.suggestedRamGB).toBe("number");
      expect(typeof spec.suggestedVramGB).toBe("number");
      expect(spec.sourceUrl).toMatch(/^https:\/\/ollama\.com\/library\//);
      expect(typeof spec.priority).toBe("number");
      expect(Array.isArray(spec.capabilities)).toBe(true);
      expect(spec.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("has exactly one default model", () => {
    const defaults = MODEL_REGISTRY.filter((m) => m.isDefault);
    expect(defaults.length).toBe(1);
  });

  it("models are sorted by priority (ascending)", () => {
    for (let i = 1; i < MODEL_REGISTRY.length; i++) {
      expect(MODEL_REGISTRY[i].priority).toBeGreaterThanOrEqual(MODEL_REGISTRY[i - 1].priority);
    }
  });

  it("uses neutral, directly scoped capability descriptions", () => {
    const unsupportedComparisons = /\b(?:gpt|best|better than|surpass(?:es|ed)?|superior|2x)\b/i;
    for (const spec of MODEL_REGISTRY) {
      expect(spec.capabilities).not.toContain("agentic");
      expect(spec.desc).not.toMatch(unsupportedComparisons);
    }
  });

  it("derives the long-context hint consistently from the listed context", () => {
    for (const spec of MODEL_REGISTRY) {
      expect(spec.capabilities.includes("long-context")).toBe(spec.context >= 32768);
    }
  });

  it("includes the reviewed Qwen 3 MoE deep-work option", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.name === "qwen3:30b-a3b");
    expect(model).toMatchObject({
      size: "~19 GB",
      context: 262144,
      releaseYear: 2025,
      tier: "power",
    });
    expect(model?.capabilities).toEqual(expect.arrayContaining(["text", "reasoning", "code"]));
  });
});

// ─── Helper Functions ────────────────────────────────────────────────────────────

describe("getModelsForHardware", () => {
  it("returns only models that fit in the given RAM", () => {
    const models = getModelsForHardware(4);
    for (const m of models) {
      expect(m.suggestedRamGB).toBeLessThanOrEqual(4);
    }
  });

  it("returns more models for higher RAM", () => {
    const low = getModelsForHardware(4);
    const high = getModelsForHardware(32);
    expect(high.length).toBeGreaterThanOrEqual(low.length);
  });

  it("does not treat zero discrete VRAM as a CPU incompatibility", () => {
    const cpuOnly = getModelsForHardware(32, 0);
    expect(cpuOnly.some((model) => model.name === "qwen3:32b")).toBe(true);
  });
});

describe("getDefaultModel", () => {
  it("returns a ModelSpec", () => {
    const model = getDefaultModel(8);
    expect(model).toBeDefined();
    expect(model.name).toBeTruthy();
  });

  it("returns a model that fits in the given RAM", () => {
    const model = getDefaultModel(4);
    expect(model.suggestedRamGB).toBeLessThanOrEqual(4);
  });
});

describe("getConservativeRamSuggestion", () => {
  it("derives the former RAM tiers from reviewed registry metadata", () => {
    expect(getConservativeRamSuggestion(8).name).toBe("qwen3:4b");
    expect(getConservativeRamSuggestion(16).name).toBe("qwen3:8b");
    expect(getConservativeRamSuggestion(32).name).toBe("qwen3:14b");
  });

  it("always returns a reviewed text-capable model", () => {
    const model = getConservativeRamSuggestion(64);
    expect(MODEL_REGISTRY).toContain(model);
    expect(model.capabilities).toContain("text");
  });
});

describe("getModelsByCapability", () => {
  it("filters by capability", () => {
    const visionModels = getModelsByCapability("vision");
    for (const m of visionModels) {
      expect(m.capabilities).toContain("vision");
    }
  });

  it("returns at least one code model", () => {
    const codeModels = getModelsByCapability("code");
    expect(codeModels.length).toBeGreaterThan(0);
  });
});

describe("getBestModelFor", () => {
  it("returns a model with the requested capability within RAM constraints", () => {
    const model = getBestModelFor("text", 8);
    if (model) {
      expect(model.capabilities).toContain("text");
      expect(model.suggestedRamGB).toBeLessThanOrEqual(8);
    }
  });
});

// ─── Format Converters ───────────────────────────────────────────────────────────

describe("toLegacyFormat", () => {
  it("converts a ModelSpec to legacy format", () => {
    const spec = MODEL_REGISTRY[0];
    const legacy = toLegacyFormat(spec);
    expect(legacy.name).toBe(spec.name);
    expect(legacy.desc).toBe(spec.desc);
    expect(legacy.size).toBe(spec.size);
    // toLegacyFormat only returns { name, desc, size }
    expect(Object.keys(legacy)).toEqual(["name", "desc", "size"]);
  });
});

describe("toRecommendedFormat", () => {
  it("returns an array derived from the full registry", () => {
    const recommended = toRecommendedFormat();
    expect(Array.isArray(recommended)).toBe(true);
    expect(recommended.length).toBeGreaterThan(0);
  });

  it("each entry carries catalog display metadata", () => {
    const recommended = toRecommendedFormat();
    for (const r of recommended) {
      expect(r.name).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.desc).toBeTruthy();
      expect(r.size).toBeTruthy();
      expect(r.tier).toBeTruthy();
    }
  });

  it("carries reviewed minimum-version prerequisites into catalog suggestions", () => {
    const recommended = toRecommendedFormat();
    expect(recommended.find((model) => model.name === "phi4-mini")?.minOllamaVersion).toBe("0.5.13");
    expect(recommended.find((model) => model.name === "gemma3:4b")?.minOllamaVersion).toBe("0.6.0");
    expect(recommended.find((model) => model.name === "qwen2.5vl:7b")?.minOllamaVersion).toBe("0.7.0");
  });

  it("entries are sorted (same order as MODEL_REGISTRY sorted by priority)", () => {
    const recommended = toRecommendedFormat();
    const sorted = [...MODEL_REGISTRY].sort((a, b) => a.priority - b.priority);
    // Names should match the sorted registry order
    expect(recommended.map(r => r.name)).toEqual(sorted.map(s => s.name));
  });
});
