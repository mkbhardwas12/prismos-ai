import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AgentActivityFeed, {
  safeActivityText,
  summarizeAgentActivities,
} from "../components/AgentActivityFeed";
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
      agent: "memory keeper",
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
});
