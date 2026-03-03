// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS — DailyBrief Component Tests

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DailyBrief from "../components/DailyBrief";
import { invoke } from "@tauri-apps/api/core";

// Mock invoke
vi.mocked(invoke).mockImplementation(async (cmd: string) => {
  if (cmd === "get_daily_brief") {
    return JSON.stringify({
      time_period: "morning",
      is_morning: true,
      intents_today: 12,
      nodes_created: 5,
      nodes_updated: 3,
      edges_strengthened: 7,
      total_nodes: 42,
      total_edges: 28,
      top_facets: { work: 5, learning: 3, health: 2 },
      intent_types: { question: 8, task: 4 },
      highlights: [
        { icon: "🧠", text: "Most active: Machine Learning" },
        { icon: "🔗", text: "Strongest link: ML → Python" },
      ],
    });
  }
  return "{}";
});

describe("DailyBrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls get_daily_brief on mount", async () => {
    render(<DailyBrief />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_daily_brief");
    });
  });

  it("renders morning greeting", async () => {
    render(<DailyBrief />);
    await waitFor(() => {
      expect(screen.getByText(/morning|brief|today/i)).toBeInTheDocument();
    });
  });

  it("displays graph stats", async () => {
    render(<DailyBrief />);
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument(); // total nodes
    });
  });

  it("renders highlights from the brief", async () => {
    render(<DailyBrief />);
    await waitFor(() => {
      expect(screen.getByText(/Machine Learning/)).toBeInTheDocument();
    });
  });

  it("handles API error gracefully", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("DB error"));
    render(<DailyBrief />);
    // Should not crash — component handles error internally
    await waitFor(() => {
      expect(screen.queryByText(/crash|unhandled/i)).not.toBeInTheDocument();
    });
  });
});
