// PrismOS-AI — SpectrumGraphView Component Tests (Edge Prophecy + Intro Overlay)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import SpectrumGraphView from "../components/SpectrumGraphView";
import { invoke } from "@tauri-apps/api/core";

// Mock react-force-graph-2d (canvas component can't render in jsdom)
vi.mock("react-force-graph-2d", () => ({
  default: vi.fn(() => null),
}));

const mockGraphSnapshot = {
  nodes: [
    { id: "n1", label: "Node A", content: "Content A", node_type: "work", layer: "core", access_count: 2 },
    { id: "n2", label: "Node B", content: "Content B", node_type: "learning", layer: "context", access_count: 1 },
  ],
  edges: [
    { id: "e1", source_id: "n1", target_id: "n2", relation: "related_to", weight: 0.5, momentum: 0.1, reinforcements: 0, last_reinforced: null },
  ],
  stats: { node_count: 2, edge_count: 1, avg_edge_weight: 0.5, graph_density: 0.5, most_connected_node: "Node A" },
};

const mockPredictions = [
  { source_id: "n1", target_id: "n2", source_label: "Node A", target_label: "Node B", probability: 0.85, reason: "Same domain", evidence_type: "facet" },
];

const mockAnticipations = [
  { suggestion: "Review ML notes", facet: "learning", confidence: 0.7 },
];

function setupMocks(opts: { hasNodes?: boolean; hasPredictions?: boolean } = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_spectrum_graph") {
      if (opts.hasNodes === false) {
        return JSON.stringify({ nodes: [], edges: [], stats: { node_count: 0, edge_count: 0, avg_edge_weight: 0, graph_density: 0, most_connected_node: null } });
      }
      return JSON.stringify(mockGraphSnapshot);
    }
    if (cmd === "anticipate_needs") {
      return JSON.stringify(mockAnticipations);
    }
    if (cmd === "predict_edges") {
      return JSON.stringify(opts.hasPredictions !== false ? mockPredictions : []);
    }
    if (cmd === "confirm_predicted_edge") return "{}";
    if (cmd === "dismiss_predicted_edge") return;
    return "{}";
  });
}

describe("SpectrumGraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("calls get_spectrum_graph, anticipate_needs, and predict_edges on mount", async () => {
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_spectrum_graph");
      expect(invoke).toHaveBeenCalledWith("anticipate_needs");
      expect(invoke).toHaveBeenCalledWith("predict_edges", { limit: 10 });
    });
  });

  it("shows empty state when no nodes exist", async () => {
    setupMocks({ hasNodes: false });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Memory is growing/)).toBeInTheDocument();
    });
  });

  it("shows graph intro overlay on first visit", async () => {
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Welcome to Your Spectrum Graph/)).toBeInTheDocument();
    });
  });

  it("dismisses graph intro and saves to localStorage", async () => {
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Welcome to Your Spectrum Graph/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Got it!/));
    expect(screen.queryByText(/Welcome to Your Spectrum Graph/)).not.toBeInTheDocument();
    expect(localStorage.getItem("prismos-graph-intro-seen")).toBe("1");
  });

  it("does not show intro overlay if already dismissed", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_spectrum_graph");
    });
    expect(screen.queryByText(/Welcome to Your Spectrum Graph/)).not.toBeInTheDocument();
  });

  it("renders Edge Prophecy panel with predictions", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: true });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Edge Prophecy/)).toBeInTheDocument();
      expect(screen.getAllByText("Node A").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Node B").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Same domain")).toBeInTheDocument();
    });
  });

  it("calls confirm_predicted_edge when Confirm button is clicked", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: true });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Confirm/)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Confirm/));
    });
    expect(invoke).toHaveBeenCalledWith("confirm_predicted_edge", {
      sourceId: "n1",
      targetId: "n2",
    });
  });

  it("calls dismiss_predicted_edge when dismiss button is clicked", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: true });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText("✕")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("✕"));
    });
    expect(invoke).toHaveBeenCalledWith("dismiss_predicted_edge", {
      sourceId: "n1",
      targetId: "n2",
    });
  });

  it("renders metrics bar with node/edge counts", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      // "2" appears in the metrics bar (node_count) and may also appear in
      // the cluster legend count badge — both are correct.
      expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("nodes")).toBeInTheDocument();
    });
  });

  it("renders the cluster legend and toggles expansion on click", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    // Both mock nodes (work + learning types) fall into the Knowledge bucket
    await waitFor(() => {
      expect(screen.getByText(/Knowledge/)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Knowledge/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded") || "[]")).toContain("knowledge");
    await act(async () => {
      fireEvent.click(screen.getByText(/Knowledge/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded") || "[]")).not.toContain("knowledge");
  });

  it("expand all / collapse all toolbar buttons update the expanded set", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Expand all/)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Expand all/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded") || "[]").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getByText(/Collapse all/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded") || "[]")).toEqual([]);
  });

  it("hides Edge Prophecy panel when no predictions", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: false });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("predict_edges", { limit: 10 });
    });
    expect(screen.queryByText(/Edge Prophecy/)).not.toBeInTheDocument();
  });
});
