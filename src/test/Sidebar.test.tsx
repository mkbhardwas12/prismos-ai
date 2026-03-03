// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS — Sidebar Component Tests

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "../components/Sidebar";
import type { Agent, SpectrumNode, GraphStats } from "../types";

const mockAgents: Agent[] = [
  { id: "orchestrator", name: "Orchestrator", role: "coordinator", status: "Idle", description: "Routes tasks" },
  { id: "reasoner", name: "Reasoner", role: "analysis", status: "Processing", description: "Analyzes" },
];

const mockNodes: SpectrumNode[] = [
  {
    id: "n-1", label: "Test Node", content: "content", node_type: "concept",
    layer: "core", access_count: 1, last_accessed: "", created_at: "", updated_at: "", connections: [],
  },
];

const mockStats: GraphStats = {
  nodes: 10,
  edges: 5,
};

const defaultProps = {
  currentView: "chat" as const,
  onNavigate: vi.fn(),
  agents: mockAgents,
  nodes: mockNodes,
  graphStats: mockStats,
};

describe("Sidebar", () => {
  it("renders the PrismOS logo/icon", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByAltText(/prism/i)).toBeInTheDocument();
  });

  it("renders navigation items", () => {
    render(<Sidebar {...defaultProps} />);
    // Should have navigation buttons for chat, graph, settings, etc.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("calls onNavigate when a nav item is clicked", () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...defaultProps} onNavigate={onNavigate} />);
    // First button is the hamburger menu — skip it; click a sidebar-item nav button
    const navButtons = document.querySelectorAll<HTMLButtonElement>(".sidebar-item");
    expect(navButtons.length).toBeGreaterThan(0);
    fireEvent.click(navButtons[1]); // Click the second nav item (not the already-active one)
    expect(onNavigate).toHaveBeenCalled();
  });

  it("highlights the current view", () => {
    render(<Sidebar {...defaultProps} currentView="chat" />);
    // The active nav item should have an active class or aria-current
    const activeItem = document.querySelector(".active, .nav-active, [aria-current]");
    expect(activeItem).toBeTruthy();
  });

  it("displays graph stats in the sidebar", () => {
    render(<Sidebar {...defaultProps} />);
    // Stats are rendered somewhere — check for nodes or edges text
    const statsSection = document.querySelector(".sidebar");
    expect(statsSection).toBeTruthy();
    expect(statsSection!.textContent).toMatch(/node|edge|knowledge/i);
  });

  it("shows agent activity indicators", () => {
    render(<Sidebar {...defaultProps} />);
    // Multiple agents may match — use getAllByText
    const agents = screen.getAllByText(/Orchestrator|Reasoner/);
    expect(agents.length).toBeGreaterThan(0);
  });
});
