// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — Type & Settings Unit Tests
//
// Validates default settings values, type shapes, and data transformations
// used across the PrismOS-AI frontend.

import { describe, it, expect } from "vitest";
import type { AppSettings, Agent, SpectrumNode, SpectrumEdge, Message } from "../types";
import { DEFAULT_OLLAMA_URL, DEFAULT_SETTINGS } from "../lib/config";

// ─── Default Settings ──────────────────────────────────────────────────────────

const TEST_SETTINGS: AppSettings = { ...DEFAULT_SETTINGS };

describe("AppSettings defaults", () => {
  it("uses localhost:11434 as the default Ollama URL", () => {
    expect(TEST_SETTINGS.ollamaUrl).toBe(DEFAULT_OLLAMA_URL);
  });

  it("has a sensible default maxTokens", () => {
    expect(TEST_SETTINGS.maxTokens).toBeGreaterThanOrEqual(256);
    expect(TEST_SETTINGS.maxTokens).toBeLessThanOrEqual(32768);
  });

  it("defaults to dark theme", () => {
    expect(TEST_SETTINGS.theme).toBe("dark");
  });

  it("voice features are disabled by default", () => {
    expect(TEST_SETTINGS.voiceInputEnabled).toBe(false);
    expect(TEST_SETTINGS.voiceOutputEnabled).toBe(false);
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
    const json = JSON.stringify(TEST_SETTINGS);
    const parsed = JSON.parse(json) as AppSettings;
    expect(parsed.ollamaUrl).toBe(TEST_SETTINGS.ollamaUrl);
    expect(parsed.maxTokens).toBe(TEST_SETTINGS.maxTokens);
    expect(parsed.theme).toBe(TEST_SETTINGS.theme);
  });

  it("handles missing fields with defaults", () => {
    // Simulate loading partial saved settings (user upgraded from older version)
    const partial = { theme: "light" as const, defaultModel: "phi3" };
    const merged: AppSettings = {
      ...TEST_SETTINGS,
      ...partial,
    };
    expect(merged.theme).toBe("light");
    expect(merged.defaultModel).toBe("phi3");
    // Should still have defaults for fields not in partial
    expect(merged.ollamaUrl).toBe(DEFAULT_OLLAMA_URL);
    expect(merged.maxTokens).toBe(2048);
  });

  it("validates ollamaUrl is a valid URL pattern", () => {
    const url = TEST_SETTINGS.ollamaUrl;
    expect(url).toMatch(/^https?:\/\/.+/);
  });
});
