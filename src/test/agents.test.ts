// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — Agent Definitions Unit Tests

import { describe, it, expect } from "vitest";
import { CORE_AGENTS, createInitialState } from "../lib/agents";

// ─── Agent Definitions ─────────────────────────────────────────────────────────

describe("CORE_AGENTS", () => {
  const agentKeys = Object.keys(CORE_AGENTS) as Array<keyof typeof CORE_AGENTS>;

  it("defines exactly 8 agents", () => {
    expect(agentKeys).toHaveLength(8);
  });

  it("includes all required agents", () => {
    const ids = agentKeys.map(k => CORE_AGENTS[k].id);
    expect(ids).toContain("orchestrator");
    expect(ids).toContain("memory_keeper");
    expect(ids).toContain("reasoner");
    expect(ids).toContain("tool_smith");
    expect(ids).toContain("sentinel");
    expect(ids).toContain("email_keeper");
    expect(ids).toContain("calendar_keeper");
    expect(ids).toContain("finance_keeper");
  });

  it.each(agentKeys)("agent '%s' has required fields", (key) => {
    const agent = CORE_AGENTS[key];
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBeTruthy();
    expect(agent.icon).toBeTruthy();
    expect(agent.debateRole).toBeTruthy();
    expect(agent.systemPrompt).toBeTruthy();
    expect(agent.systemPrompt.length).toBeGreaterThan(50);
  });

  it.each(agentKeys)("agent '%s' has a unique debate role", (key) => {
    const agent = CORE_AGENTS[key];
    const otherRoles = agentKeys
      .filter(k => k !== key)
      .map(k => CORE_AGENTS[k].debateRole);
    expect(otherRoles).not.toContain(agent.debateRole);
  });

  it.each(agentKeys)("agent '%s' icon is a single emoji", (key) => {
    const agent = CORE_AGENTS[key];
    // Emoji is 1-2 code points, displayed as 1 grapheme
    expect(agent.icon.length).toBeLessThanOrEqual(4);
    expect(agent.icon.length).toBeGreaterThan(0);
  });
});

// ─── Initial State Factory ──────────────────────────────────────────────────────

describe("createInitialState", () => {
  it("creates state with user message", () => {
    const state = createInitialState("What is Rust?");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].content).toBe("What is Rust?");
  });

  it("starts with orchestrator as current agent", () => {
    const state = createInitialState("test");
    expect(state.currentAgent).toBe("orchestrator");
  });

  it("has empty task queue", () => {
    const state = createInitialState("test");
    expect(state.taskQueue).toEqual([]);
  });

  it("starts at iteration 0 with maxIterations > 0", () => {
    const state = createInitialState("test");
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBeGreaterThan(0);
  });

  it("has an empty context object", () => {
    const state = createInitialState("test");
    expect(state.context).toEqual({});
  });
});
