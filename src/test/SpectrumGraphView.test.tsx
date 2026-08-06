// PrismOS-AI — SpectrumGraphView Component Tests (overview, trace, and links)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import SpectrumGraphView from "../components/SpectrumGraphView";
import { invoke } from "@tauri-apps/api/core";

// Mock react-force-graph-2d (canvas component can't render in jsdom)
const forceGraphState = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("react-force-graph-2d", () => ({
  default: vi.fn((props: Record<string, unknown>) => {
    forceGraphState.props = props;
    return null;
  }),
}));

const mockGraphSnapshot = {
  nodes: [
    { id: "n1", label: "Node A", content: "Content A", node_type: "work", layer: "core", access_count: 2, connections: ["n2"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", last_accessed: "2026-01-02T00:00:00Z" },
    { id: "n2", label: "Node B", content: "Content B", node_type: "learning", layer: "context", access_count: 1, connections: ["n1"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", last_accessed: "2026-01-02T00:00:00Z" },
  ],
  edges: [
    { id: "e1", source_id: "n1", target_id: "n2", relation: "related_to", weight: 0.5, momentum: 0.1, reinforcements: 0, last_reinforced: null },
  ],
  stats: { node_count: 2, edge_count: 1, avg_edge_weight: 0.5, graph_density: 0.5, most_connected_node: "Node A" },
  view: { total_node_count: 12, total_edge_count: 1, shown_node_count: 2, shown_edge_count: 1, summarized_suggestion_count: 10, omitted_due_to_limit: 0 },
};

const mockPredictions = [
  { source_id: "n1", target_id: "n2", source_label: "Node A", target_label: "Node B", probability: 0.85, reason: "Same domain", evidence_type: "facet" },
];

const mockAnticipations = [
  { suggestion: "Review ML notes", facet: "learning", confidence: 0.7 },
];

function setupMocks(opts: { hasNodes?: boolean; hasPredictions?: boolean; graphSnapshot?: unknown } = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_spectrum_graph") {
      if (opts.hasNodes === false) {
        return JSON.stringify({ nodes: [], edges: [], stats: { node_count: 0, edge_count: 0, avg_edge_weight: 0, graph_density: 0, most_connected_node: null } });
      }
      return JSON.stringify(opts.graphSnapshot ?? mockGraphSnapshot);
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
    forceGraphState.props = null;
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
      expect(screen.getByText(/Local memory is ready/)).toBeInTheDocument();
    });
  });

  it("shows graph intro overlay on first visit", async () => {
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Your memory map/)).toBeInTheDocument();
    });
  });

  it("dismisses graph intro and saves to localStorage", async () => {
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Your memory map/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Got it!/));
    expect(screen.queryByText(/Your memory map/)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/Your memory map/)).not.toBeInTheDocument();
  });

  it("renders heuristic candidate-link suggestions", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: true });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Candidate Links/)).toBeInTheDocument();
      expect(screen.getAllByText("Node A").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Node B").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Same domain")).toBeInTheDocument();
      expect(screen.getByText("85% heuristic score")).toBeInTheDocument();
      expect(screen.getByText(/Heuristic Need Suggestions/)).toBeInTheDocument();
      expect(screen.getByText("70% heuristic score")).toBeInTheDocument();
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
      expect(screen.getByText("shown nodes")).toBeInTheDocument();
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
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded-v2") || "[]")).toContain("knowledge");
    await act(async () => {
      fireEvent.click(screen.getByText(/Knowledge/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded-v2") || "[]")).not.toContain("knowledge");
  });

  it("overview clears expanded state and ignores the legacy expand-all key", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    localStorage.setItem("prismos-graph-expanded", JSON.stringify(["knowledge"]));
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Knowledge/)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Knowledge/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded-v2") || "[]")).toEqual(["knowledge"]);
    await act(async () => {
      fireEvent.click(screen.getByText(/Overview/));
    });
    expect(JSON.parse(localStorage.getItem("prismos-graph-expanded-v2") || "[]")).toEqual([]);
  });

  it("search reveals a node and names the direction and neighbor of each connection", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: false });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    const search = await screen.findByRole("textbox", { name: "Search graph nodes" });
    fireEvent.change(search, { target: { value: "Node A" } });
    const results = await screen.findByRole("region", { name: "Graph search results" });
    const resultButton = within(results).getByRole("button", { name: /Node A/ });
    await act(async () => {
      fireEvent.click(resultButton);
    });
    expect(screen.getByText("→ related_to")).toBeInTheDocument();
    expect(screen.getByText("Node B")).toBeInTheDocument();
    expect(screen.getByText(/strength 0.50/)).toBeInTheDocument();
    expect(screen.getByText(/Local knowledge graph memory/)).toBeInTheDocument();
  });

  it("routes managed project chunks into the Projects family", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    const projectSnapshot = {
      ...mockGraphSnapshot,
      nodes: [{
        ...mockGraphSnapshot.nodes[0],
        id: "knowledge-project-chunk",
        label: "Example project · src/main.rs",
        node_type: "project_chunk",
        layer: "knowledge",
        connections: [],
      }],
      edges: [],
      stats: { ...mockGraphSnapshot.stats, node_count: 1, edge_count: 0 },
      view: { ...mockGraphSnapshot.view, shown_node_count: 1, shown_edge_count: 0 },
    };
    setupMocks({ hasPredictions: false, graphSnapshot: projectSnapshot });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    expect(await screen.findByText(/Projects/)).toBeInTheDocument();
    expect(screen.queryByText("🧠 Knowledge")).not.toBeInTheDocument();
  });

  it("caps a large expanded family and renders a searchable overflow summary", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    localStorage.setItem("prismos-graph-expanded-v2", JSON.stringify(["knowledge"]));
    const manyNodes = Array.from({ length: 150 }, (_, index) => ({
      ...mockGraphSnapshot.nodes[1],
      id: `knowledge-${index}`,
      label: `Knowledge ${index}`,
      connections: [],
    }));
    setupMocks({
      hasPredictions: false,
      graphSnapshot: {
        ...mockGraphSnapshot,
        nodes: manyNodes,
        edges: [],
        stats: { ...mockGraphSnapshot.stats, node_count: manyNodes.length, edge_count: 0 },
        view: { ...mockGraphSnapshot.view, shown_node_count: manyNodes.length, shown_edge_count: 0 },
      },
    });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => expect(forceGraphState.props).not.toBeNull());
    const renderedData = forceGraphState.props?.graphData as { nodes: Array<{ isOverflow?: boolean; count?: number }> };
    expect(renderedData.nodes).toHaveLength(121);
    expect(renderedData.nodes.find((node) => node.isOverflow)?.count).toBe(30);
  });

  it("shows a bounded last-answer context trace without claiming chain-of-thought", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: false });
    await act(async () => {
      render(
        <SpectrumGraphView
          lastAnswerTrace={{
            context_node_ids: ["n1", "n2"],
            reinforced_edge_ids: ["e1"],
            recorded_at: "2026-01-03T00:00:00Z",
            validated: true,
          }}
        />
      );
    });
    const traceButton = await screen.findByRole("button", { name: /Trace last answer/ });
    await act(async () => {
      fireEvent.click(traceButton);
    });
    const trace = screen.getByRole("region", { name: /Last answer trace/ });
    expect(within(trace).getByText("Node A")).toBeInTheDocument();
    expect(within(trace).getByText("Node B")).toBeInTheDocument();
    expect(trace).toHaveTextContent(/1 recorded relationship changes/);
    expect(within(trace).getByText(/not the model’s hidden reasoning/)).toBeInTheDocument();
  });

  it("explains when generated suggestion history is summarized", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks();
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    expect(await screen.findByTitle(/Generated suggestion cards are summarized/)).toHaveTextContent("10 suggestions summarized");
  });

  it("hides candidate-link panel when no suggestions exist", async () => {
    localStorage.setItem("prismos-graph-intro-seen", "1");
    setupMocks({ hasPredictions: false });
    await act(async () => {
      render(<SpectrumGraphView />);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("predict_edges", { limit: 10 });
    });
    expect(screen.queryByText(/Candidate Links/)).not.toBeInTheDocument();
  });
});
