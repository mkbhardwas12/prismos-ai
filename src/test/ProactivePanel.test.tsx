// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — ProactivePanel Component Tests

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ProactivePanel from "../components/ProactivePanel";
import type { SpectrumNode } from "../types";

// Mock tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("[]")),
}));

const mockNodes: SpectrumNode[] = [
  {
    id: "n-1", label: "React patterns", content: "Advanced React hooks usage", node_type: "concept",
    layer: "core", access_count: 5, last_accessed: "", created_at: "", updated_at: "", connections: [],
  },
  {
    id: "n-2", label: "TypeScript generics", content: "Generic type constraints", node_type: "concept",
    layer: "core", access_count: 3, last_accessed: "", created_at: "", updated_at: "", connections: [],
  },
];

const defaultProps = {
  nodes: mockNodes,
  dailyGreeting: "Good morning! ☀️",
  onSuggestionSelect: vi.fn(),
};

/** Render inside act() so async useEffects settle */
async function renderPanel(overrides = {}) {
  await act(async () => {
    render(<ProactivePanel {...defaultProps} {...overrides} />);
  });
}

describe("ProactivePanel", () => {
  let origGetItem: typeof Storage.prototype.getItem;

  beforeEach(() => {
    vi.clearAllMocks();
    origGetItem = Storage.prototype.getItem;
    // Default: no features enabled
    Storage.prototype.getItem = vi.fn(() => JSON.stringify({}));
  });

  afterEach(() => {
    Storage.prototype.getItem = origGetItem;
  });

  it("renders the panel header with title", async () => {
    await renderPanel();
    expect(screen.getByText(/today.s suggestions/i)).toBeInTheDocument();
  });

  it("renders as an accessible region", async () => {
    await renderPanel();
    const region = document.querySelector('[role="region"][aria-label="Today\'s Suggestions"]');
    expect(region).toBeTruthy();
  });

  it("displays the daily greeting when provided", async () => {
    await renderPanel({ dailyGreeting: "Good afternoon! 🌤️" });
    expect(screen.getByText("Good afternoon! 🌤️")).toBeInTheDocument();
  });

  it("collapses and expands when header is clicked", async () => {
    await renderPanel();
    const header = screen.getByRole("button", { name: /today.s suggestions/i });
    // Initially expanded
    expect(header.getAttribute("aria-expanded")).toBe("true");
    // Click to collapse
    await act(async () => { fireEvent.click(header); });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // Click to expand again
    await act(async () => { fireEvent.click(header); });
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows graph insight when nodes are provided", async () => {
    await renderPanel();
    expect(screen.getByText(/2 nodes in your graph/)).toBeInTheDocument();
  });

  it("shows no graph insight when nodes are empty", async () => {
    await renderPanel({ nodes: [] });
    expect(screen.queryByText(/nodes in your graph/)).not.toBeInTheDocument();
  });

  it("has a refresh button", async () => {
    await renderPanel();
    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it("calls onSuggestionSelect when graph insight is clicked", async () => {
    const onSelect = vi.fn();
    await renderPanel({ onSuggestionSelect: onSelect });
    const graphBtn = screen.getByText(/2 nodes in your graph/);
    await act(async () => { fireEvent.click(graphBtn.closest("button")!); });
    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/knowledge graph/));
  });

  it("hides the body content when collapsed", async () => {
    await renderPanel();
    const header = screen.getByRole("button", { name: /today.s suggestions/i });
    await act(async () => { fireEvent.click(header); });
    // The body div should not render when collapsed
    expect(document.getElementById("proactive-panel-body")).toBeNull();
  });
});
