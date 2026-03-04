// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — DailyDashboard Component Tests

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DailyDashboard from "../components/DailyDashboard";
import type { SpectrumNode, GraphStats } from "../types";

// Mock tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("{}")),
}));

const mockNodes: SpectrumNode[] = [
  {
    id: "n-1", label: "React patterns", content: "React hooks best practices", node_type: "concept",
    layer: "core", access_count: 5, last_accessed: "", created_at: "", updated_at: "", connections: [],
  },
  {
    id: "n-2", label: "TypeScript generics", content: "Generics in TS", node_type: "concept",
    layer: "core", access_count: 3, last_accessed: "", created_at: "", updated_at: "", connections: [],
  },
];

const mockStats: GraphStats = { nodes: 42, edges: 18 };

const defaultProps = {
  nodes: mockNodes,
  graphStats: mockStats,
  dailyGreeting: "Good morning! ☀️",
  onNavigate: vi.fn(),
  onSuggestionClick: vi.fn(),
};

async function renderDashboard(overrides = {}) {
  await act(async () => {
    render(<DailyDashboard {...defaultProps} {...overrides} />);
  });
}

describe("DailyDashboard", () => {
  let origGetItem: typeof Storage.prototype.getItem;

  beforeEach(() => {
    vi.clearAllMocks();
    origGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => JSON.stringify({}));
  });

  afterEach(() => {
    Storage.prototype.getItem = origGetItem;
  });

  it("renders as a main region with correct label", async () => {
    await renderDashboard();
    const region = document.querySelector('[role="main"][aria-label="Daily Dashboard"]');
    expect(region).toBeTruthy();
  });

  it("displays a time-appropriate greeting", async () => {
    await renderDashboard();
    // Should render a greeting heading (Good morning/afternoon/evening)
    const heading = document.querySelector(".dd-hero__title");
    expect(heading).toBeTruthy();
    expect(heading!.textContent).toMatch(/good|late|working/i);
  });

  it("shows the current date", async () => {
    await renderDashboard();
    const sub = document.querySelector(".dd-hero__subtitle");
    expect(sub).toBeTruthy();
    // Should contain current month name
    const monthName = new Date().toLocaleDateString("en-US", { month: "long" });
    expect(sub!.textContent).toContain(monthName);
  });

  it("has a refresh button", async () => {
    await renderDashboard();
    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it("renders quick links section with 6 navigation links", async () => {
    await renderDashboard();
    const quickLinks = document.querySelectorAll(".dd-quicklink");
    expect(quickLinks.length).toBe(6);
  });

  it("navigates when a quick link is clicked", async () => {
    const onNavigate = vi.fn();
    await renderDashboard({ onNavigate });
    const quickLinks = document.querySelectorAll(".dd-quicklink");
    await act(async () => { fireEvent.click(quickLinks[0]); });
    expect(onNavigate).toHaveBeenCalled();
  });

  it("renders the quick links title", async () => {
    await renderDashboard();
    expect(screen.getByText("Quick Links")).toBeInTheDocument();
  });

  it("does not crash with empty nodes", async () => {
    await renderDashboard({ nodes: [], graphStats: { nodes: 0, edges: 0 } });
    const region = document.querySelector('[aria-label="Daily Dashboard"]');
    expect(region).toBeTruthy();
  });
});
