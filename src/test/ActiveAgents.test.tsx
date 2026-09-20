import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ActiveAgents from "../components/ActiveAgents";
import type { Agent, CollaborationSummary, DebateSummary } from "../types";

const agents: Agent[] = [{
  id: "reasoner",
  name: "Reasoner",
  role: "Drafting",
  status: "Idle",
  description: "Local model drafting",
}];

// Even a legacy payload claiming perfect consensus must not be presented as
// factual validation. Current backend emits only deterministic check records.
const checks: DebateSummary = {
  rounds: 1,
  total_arguments: 1,
  positions: 1,
  challenges: 0,
  rebuttals: 0,
  supports: 0,
  agreement_score: 1,
  resolved: true,
  arguments: [{
    agent: "Reasoner",
    argument_type: "Position",
    target: null,
    content: "Model draft received. Factual accuracy is unvalidated.",
    confidence: 1,
  }],
};

const collaboration: CollaborationSummary = {
  session_id: "test-session",
  phase: "Completed",
  pipeline_trace: [],
  consensus_approved: true,
  consensus_summary: "Policy gate passed; facts unvalidated",
  vote_count: 5,
  approve_count: 5,
  reject_count: 0,
  message_count: 4,
  debate: checks,
};

describe("ActiveAgents workflow transparency", () => {
  it("separates deterministic checks from factual verification", () => {
    render(<ActiveAgents agents={agents} collaboration={collaboration} debateSummary={checks} />);
    expect(screen.getByText("Workflow checks")).toBeInTheDocument();
    expect(screen.getByText("Facts unvalidated")).toBeInTheDocument();
    expect(screen.getByText("Independent fact-check")).toBeInTheDocument();
    expect(screen.getByText("Not run")).toBeInTheDocument();
    expect(screen.getByText(/These records are not model conversations/)).toBeInTheDocument();
    expect(screen.getByText("✓ Policy gate passed")).toBeInTheDocument();
    expect(screen.queryByText("Agent Debate")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText("✓ Resolved")).not.toBeInTheDocument();
  });

  it("does not claim every role or model runs in WASM", () => {
    render(<ActiveAgents agents={agents} />);
    expect(screen.getByText("WASM executor available")).toBeInTheDocument();
    expect(screen.getByText("Isolation applies only to tasks actually run there")).toBeInTheDocument();
    expect(screen.queryByText("WASM Isolated")).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto-Rollback/)).not.toBeInTheDocument();
  });

  it("labels live legacy debate and vote phases as workflow policy checks", () => {
    const { rerender } = render(<ActiveAgents agents={agents} liveAgentSteps={[{
      agent: "Workflow checks", action: "Recording role checks", status: "thinking", phase: "debate",
    }]} />);
    expect(screen.getByText("⚖️ Workflow checks")).toBeInTheDocument();
    rerender(<ActiveAgents agents={agents} liveAgentSteps={[{
      agent: "Consensus", action: "Applying policy checks", status: "thinking", phase: "vote",
    }]} />);
    expect(screen.getByText("🗳️ Policy gate")).toBeInTheDocument();
    expect(screen.queryByText(/Debating|Voting/)).not.toBeInTheDocument();
  });
});
