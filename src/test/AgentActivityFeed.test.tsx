import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AgentActivityFeed from "../components/AgentActivityFeed";
import {
  normalizeAgentActivity,
  safeActivityText,
  summarizeAgentActivities,
} from "../lib/agentActivity";
import type { AgentActivity } from "../types";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      layout: _layout,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const activity = (overrides: Partial<AgentActivity>): AgentActivity => ({
  schema_version: 1,
  task_id: "task-123",
  agent: "Orchestrator",
  action: "Coordinating the request…",
  status: "thinking",
  phase: "orchestrate",
  iteration: 0,
  elapsed_ms: 1_500,
  ...overrides,
});

describe("AgentActivityFeed", () => {
  it("updates one stable row per role instead of rendering duplicate transitions", () => {
    const steps = [
      activity({ action: "Decomposing intent into work units…" }),
      activity({ action: "Prepared 3 workflow-role inputs", status: "completed" }),
      activity({ agent: "Tool Smith", action: "Checking action-policy needs…", phase: "analyze" }),
      activity({ agent: "Tool Smith", action: "Tool evaluation complete", phase: "analyze", status: "completed" }),
    ];

    render(<AgentActivityFeed steps={steps} />);

    expect(screen.getAllByText("Orchestrator")).toHaveLength(1);
    expect(screen.getAllByText("Tool Smith")).toHaveLength(1);
    expect(screen.queryByText("Decomposing intent into work units…")).not.toBeInTheDocument();
    expect(screen.getByText("Prepared 3 workflow-role inputs")).toBeInTheDocument();
    expect(screen.getByText("Tool evaluation complete")).toBeInTheDocument();
    expect(screen.getByText(/Workflow finishing · 2 done/)).toBeInTheDocument();
  });

  it("keeps earlier role exchanges in an accessible expandable decision record", () => {
    render(
      <AgentActivityFeed
        steps={[
          activity({ action: "Decomposing intent into work units…", elapsed_ms: 100 }),
          activity({
            action: "Prepared 3 workflow-role inputs",
            status: "completed",
            elapsed_ms: 800,
            decision: {
              kind: "work_plan",
              query_type: "create",
              unit_count: 3,
              roles: ["reasoner", "tool_smith", "memory_keeper"],
              context_count: 4,
            },
          }),
        ]}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Details (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Decomposing intent into work units…")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Orchestrator decision record" })).toBeInTheDocument();
    expect(screen.getByText("Decomposing intent into work units…")).toBeInTheDocument();
    expect(screen.getByText("Roles selected")).toBeInTheDocument();
    expect(screen.getByText("Reasoner, Tool Smith, Memory Keeper")).toBeInTheDocument();
    expect(screen.getByText("4 nodes")).toBeInTheDocument();
  });

  it("expands every role and renders typed votes without free-form private fields", () => {
    const canary = "PRIVATE-PROMPT-CANARY";
    render(
      <AgentActivityFeed
        steps={[
          activity({
            agent: "Reasoner",
            action: "Approve vote recorded",
            phase: "vote",
            status: "completed",
            decision: {
              kind: "vote",
              role: "reasoner",
              approved: true,
              confidence_pct: 91,
              basis: "critic_accepted",
            },
          }),
          activity({ agent: "Sentinel", action: "Policy checks passed", phase: "review", status: "completed" }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand all details" }));

    expect(screen.getByRole("region", { name: "Reasoner decision record" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sentinel decision record" })).toBeInTheDocument();
    expect(screen.getByText("Bounded Critic accepted the answer")).toBeInTheDocument();
    expect(screen.queryByText(canary)).not.toBeInTheDocument();
    expect(normalizeAgentActivity({
      ...activity({ agent: "Reasoner", action: "Unsafe" }),
      decision: {
        kind: "vote",
        role: "reasoner",
        approved: true,
        confidence_pct: 91,
        basis: "critic_accepted",
        prompt: canary,
      },
    })).toBeNull();
  });

  it("shows the current activity, phase, attempt, and explicit working state", () => {
    render(
      <AgentActivityFeed
        steps={[
          activity({
            agent: "Reasoner",
            action: "Refining answer (attempt 2/3)…",
            phase: "refine",
            iteration: 2,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Reasoner")).toBeInTheDocument();
    expect(screen.getByText("Refinement")).toBeInTheDocument();
    expect(screen.getByText("Refining answer (attempt 2/3)…")).toBeInTheDocument();
    expect(screen.getByText("Attempt 2")).toBeInTheDocument();
    expect(screen.getByText("T+1s")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("1 working")).toBeInTheDocument();
  });

  it("normalizes equivalent role names and keeps the newest status", () => {
    const rows = summarizeAgentActivities([
      activity({ agent: "Memory Keeper", action: "Querying graph" }),
      activity({ agent: " memory keeper ", action: "Graph context processed", status: "completed" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent: "Memory Keeper",
      action: "Graph context processed",
      status: "completed",
      statusLabel: "Done",
      updateCount: 2,
    });
  });

  it("bounds malformed activity text and removes control characters", () => {
    const result = safeActivityText(`  Checking\n\t${"x".repeat(220)}  `, "review");

    expect(result).not.toContain("\n");
    expect(result).not.toContain("\t");
    expect(Array.from(result).length).toBeLessThanOrEqual(180);
    expect(result.endsWith("…")).toBe(true);
    expect(safeActivityText("\n\t", "review")).toBe("Safety review in progress");
  });

  it("rejects malformed IPC events before they enter the trace", () => {
    expect(normalizeAgentActivity({ schema_version: 1, task_id: "task", agent: "Unknown", action: "x", status: "thinking", phase: "build", elapsed_ms: 1 })).toBeNull();
    expect(normalizeAgentActivity({ schema_version: 1, task_id: "task", agent: "Reasoner", action: "x", status: "thinking", phase: "private_prompt", elapsed_ms: 1 })).toBeNull();
    expect(normalizeAgentActivity({ schema_version: 2, task_id: "task", agent: "Reasoner", action: "x", status: "thinking", phase: "build", elapsed_ms: 1 })).toBeNull();
  });
});
