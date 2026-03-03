// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS — Type & Settings Unit Tests
//
// Validates default settings values, type shapes, and data transformations
// used across the PrismOS frontend.

import { describe, it, expect } from "vitest";
import type { AppSettings, Agent, SpectrumNode, SpectrumEdge, Message } from "../types";

// ─── Default Settings ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  ollamaUrl: "http://localhost:11434",
  defaultModel: "llama3.2",
  theme: "dark",
  maxTokens: 2048,
  voiceInputEnabled: false,
  voiceOutputEnabled: false,
};

describe("AppSettings defaults", () => {
  it("uses localhost:11434 as the default Ollama URL", () => {
    expect(DEFAULT_SETTINGS.ollamaUrl).toBe("http://localhost:11434");
  });

  it("has a sensible default maxTokens", () => {
    expect(DEFAULT_SETTINGS.maxTokens).toBeGreaterThanOrEqual(256);
    expect(DEFAULT_SETTINGS.maxTokens).toBeLessThanOrEqual(32768);
  });

  it("defaults to dark theme", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("dark");
  });

  it("voice features are disabled by default", () => {
    expect(DEFAULT_SETTINGS.voiceInputEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.voiceOutputEnabled).toBe(false);
  });
});

// ─── Type Shape Tests ──────────────────────────────────────────────────────────

describe("Type shapes", () => {
  it("Agent has required fields", () => {
    const agent: Agent = {
      id: "reasoner",
      name: "Reasoner",
      role: "Analysis & inference",
      status: "Idle",
      description: "Handles queries and analysis",
    };
    expect(agent.id).toBe("reasoner");
    expect(agent.status).toBe("Idle");
    expect(["Idle", "Processing", "Waiting", "Error"]).toContain(agent.status);
  });

  it("SpectrumNode has graph-specific fields", () => {
    const node: SpectrumNode = {
      id: "n-1",
      label: "Test Node",
      content: "Some content",
      node_type: "concept",
      layer: "core",
      access_count: 5,
      last_accessed: "2024-01-01T00:00:00Z",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      connections: ["n-2"],
    };
    expect(node.layer).toBe("core");
    expect(["core", "context", "ephemeral"]).toContain(node.layer);
    expect(node.connections).toHaveLength(1);
  });

  it("SpectrumEdge has weight and momentum", () => {
    const edge: SpectrumEdge = {
      id: "e-1",
      source_id: "n-1",
      target_id: "n-2",
      relation: "related_to",
      weight: 0.8,
      momentum: 0.1,
      reinforcements: 3,
      last_reinforced: "2024-01-01T00:00:00Z",
      created_at: "2024-01-01T00:00:00Z",
    };
    expect(edge.weight).toBeGreaterThanOrEqual(0);
    expect(edge.weight).toBeLessThanOrEqual(1);
    expect(edge.reinforcements).toBeGreaterThanOrEqual(0);
  });

  it("Message has role discrimination", () => {
    const userMsg: Message = {
      id: "m-1",
      role: "user",
      content: "Hello",
      timestamp: new Date(),
    };
    const aiMsg: Message = {
      id: "m-2",
      role: "ai",
      content: "Hi there",
      timestamp: new Date(),
      agent: "reasoner",
    };
    expect(userMsg.role).toBe("user");
    expect(aiMsg.role).toBe("ai");
    expect(aiMsg.agent).toBe("reasoner");
    expect(userMsg.agent).toBeUndefined();
  });
});

// ─── Settings Serialization ────────────────────────────────────────────────────

describe("Settings persistence", () => {
  it("round-trips through JSON serialization", () => {
    const json = JSON.stringify(DEFAULT_SETTINGS);
    const parsed = JSON.parse(json) as AppSettings;
    expect(parsed.ollamaUrl).toBe(DEFAULT_SETTINGS.ollamaUrl);
    expect(parsed.maxTokens).toBe(DEFAULT_SETTINGS.maxTokens);
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it("handles missing fields with defaults", () => {
    // Simulate loading partial saved settings (user upgraded from older version)
    const partial = { theme: "light" as const, defaultModel: "phi3" };
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...partial,
    };
    expect(merged.theme).toBe("light");
    expect(merged.defaultModel).toBe("phi3");
    // Should still have defaults for fields not in partial
    expect(merged.ollamaUrl).toBe("http://localhost:11434");
    expect(merged.maxTokens).toBe(2048);
  });

  it("validates ollamaUrl is a valid URL pattern", () => {
    const url = DEFAULT_SETTINGS.ollamaUrl;
    expect(url).toMatch(/^https?:\/\/.+/);
  });
});
