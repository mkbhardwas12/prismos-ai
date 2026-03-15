// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — Model Registry Unit Tests

import { describe, it, expect } from "vitest";
import {
  MODEL_REGISTRY,
  getModelsForHardware,
  getDefaultModel,
  getModelsByCapability,
  getBestModelFor,
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
      expect(typeof spec.ramMin).toBe("number");
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
});

// ─── Helper Functions ────────────────────────────────────────────────────────────

describe("getModelsForHardware", () => {
  it("returns only models that fit in the given RAM", () => {
    const models = getModelsForHardware(4);
    for (const m of models) {
      expect(m.ramMin).toBeLessThanOrEqual(4);
    }
  });

  it("returns more models for higher RAM", () => {
    const low = getModelsForHardware(4);
    const high = getModelsForHardware(32);
    expect(high.length).toBeGreaterThanOrEqual(low.length);
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
    expect(model.ramMin).toBeLessThanOrEqual(4);
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
      expect(model.ramMin).toBeLessThanOrEqual(8);
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

  it("each entry has name, label, desc, size, and tier", () => {
    const recommended = toRecommendedFormat();
    for (const r of recommended) {
      expect(r.name).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.desc).toBeTruthy();
      expect(r.size).toBeTruthy();
      expect(r.tier).toBeTruthy();
    }
  });

  it("entries are sorted (same order as MODEL_REGISTRY sorted by priority)", () => {
    const recommended = toRecommendedFormat();
    const sorted = [...MODEL_REGISTRY].sort((a, b) => a.priority - b.priority);
    // Names should match the sorted registry order
    expect(recommended.map(r => r.name)).toEqual(sorted.map(s => s.name));
  });
});
