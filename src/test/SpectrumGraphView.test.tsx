import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import SpectrumGraphView from "../components/SpectrumGraphView";
import type { KnowledgeNode } from "../lib/knowledgeGraph";
import type { GraphSnapshot, SpectrumEdge, SpectrumNode } from "../types";

interface MockSceneProps {
  nodes: KnowledgeNode[];
  edges: SpectrumEdge[];
  mode: "2d" | "3d";
  selectedId: string | null;
  focusIds: Set<string> | null;
  pathEdges: Set<string>;
  onSelect: (id: string) => void;
}

const scene = vi.hoisted(() => ({ current: null as MockSceneProps | null }));
vi.mock("../components/KnowledgeGraphScene", () => ({
  default: (props: MockSceneProps) => {
    scene.current = props;
    return (
      <div data-testid="knowledge-scene" data-mode={props.mode}>
        {props.nodes.map((node) => (
          <button key={node.id} onClick={() => props.onSelect(node.id)}>
            Select {node.label} in graph
          </button>
        ))}
      </div>
    );
  },
}));

function node(
  id: string,
  label: string,
  content = "",
  node_type = "note",
): SpectrumNode {
  return {
    id,
    label,
    content,
    node_type,
    layer: "context",
    access_count: 1,
    last_accessed: "2026-09-01T12:00:00Z",
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    connections: [],
  };
}

function edge(
  id: string,
  source_id: string,
  target_id: string,
  relation: string,
): SpectrumEdge {
  return {
    id,
    source_id,
    target_id,
    relation,
    weight: 0.8,
    momentum: 0,
    reinforcements: 0,
    last_reinforced: "",
    created_at: "2026-09-01T12:00:00Z",
  };
}

const snapshot: GraphSnapshot = {
  nodes: [
    node("a", "Release brief", "A brief describing the next release."),
    node(
      "b",
      "Implementation guide",
      "Source: /projects/atlas/guide.md\nChunk: 1/1\nChars: 0-200\n\nDeployment instructions.",
      "doc_chunk",
    ),
    node(
      "c",
      "Review conversation",
      "Discussed the release and review outcome.",
      "conversation",
    ),
    node("d", "Unconnected research", "Independent research note."),
  ],
  edges: [
    edge("ab", "a", "b", "derived_from"),
    edge("bc", "b", "c", "discussed_in"),
  ],
  stats: {
    node_count: 4,
    edge_count: 2,
    avg_edge_weight: 0.8,
    strongest_edge_weight: 0.8,
    facet_distribution: { note: 2, doc_chunk: 1, conversation: 1 },
    most_connected_node: "Implementation guide",
    graph_density: 1 / 3,
  },
};

const prediction = {
  source_id: "a",
  target_id: "d",
  source_label: "Release brief",
  target_label: "Unconnected research",
  probability: 0.42,
  reason: "Shared release topic",
  evidence_type: "keyword_overlap",
};

function setup(data = snapshot) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_spectrum_graph") return JSON.stringify(data);
    if (command === "predict_edges") return JSON.stringify([prediction]);
    return "{}";
  });
}

async function openGraph() {
  render(<SpectrumGraphView refreshKey={0} />);
  await screen.findByTestId("knowledge-scene");
}

function selectInGraph(label: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `Select ${label} in graph` }),
  );
}

describe("SpectrumGraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    scene.current = null;
    setup();
  });

  it("loads recorded knowledge without requesting predictions or writing to the graph", async () => {
    await openGraph();
    expect(scene.current?.nodes).toHaveLength(4);
    expect(scene.current?.edges.map((item) => item.id)).toEqual(["ab", "bc"]);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "get_spectrum_graph",
    ]);
    expect(
      screen.getByRole("textbox", { name: /search notes/i }),
    ).toBeInTheDocument();
  });

  it("shows a recoverable loading error and reloads on retry", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error("Storage temporarily unavailable"),
    );
    render(<SpectrumGraphView refreshKey={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /storage temporarily unavailable/i,
    );
    expect(screen.queryByTestId("knowledge-scene")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByTestId("knowledge-scene");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("immediately highlights a selected note's recorded neighborhood without replacing the map", async () => {
    await openGraph();
    const nodes = scene.current?.nodes;
    const edges = scene.current?.edges;
    selectInGraph("Release brief");
    expect(scene.current?.focusIds).toEqual(new Set(["a", "b"]));
    expect(scene.current?.nodes).toBe(nodes);
    expect(scene.current?.edges).toBe(edges);
    expect(
      screen.getByRole("status", { name: "Visible connections" }),
    ).toHaveTextContent("1 of 1 recorded relationships visible");
    expect(screen.getByText("Selected note’s links")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close note details" }));
    expect(scene.current?.focusIds).toBeNull();
    expect(scene.current?.nodes).toBe(nodes);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "get_spectrum_graph",
    ]);
  });

  it("explains when a selected note's recorded relationships are hidden by source filters", async () => {
    await openGraph();
    const sources = within(
      screen.getByRole("complementary", { name: /sources and filters/i }),
    );
    fireEvent.click(sources.getByRole("button", { name: /guide.md/i }));
    selectInGraph("Release brief");
    const summary = screen.getByRole("status", { name: "Visible connections" });
    expect(summary).toHaveTextContent("0 of 1 recorded relationships visible");
    expect(summary).toHaveTextContent(/outside the current filters/);
    expect(scene.current?.edges).toHaveLength(0);
    expect(scene.current?.focusIds).toEqual(new Set(["a", "b"]));
  });

  it("searches stored source metadata and selects matching notes", async () => {
    await openGraph();
    fireEvent.change(screen.getByRole("textbox", { name: /search notes/i }), {
      target: { value: "atlas" },
    });
    // The source name is absent from the note label; it comes from provenance.
    const matches = await screen.findAllByRole("button", {
      name: /implementation guide/i,
    });
    fireEvent.click(
      matches.find((button) => !button.textContent?.startsWith("Select ")) ??
        matches[0],
    );
    expect(scene.current?.selectedId).toBe("b");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "get_spectrum_graph"),
    ).toBe(true);
    const preferences = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.getItem(localStorage.key(index)!),
    ).join("\n");
    expect(preferences).not.toMatch(/atlas|guide\.md|implementation guide/i);
  });

  it("filters source groups with pressed buttons and provides a keyboard-accessible browse list", async () => {
    await openGraph();
    const sources = within(
      screen.getByRole("complementary", { name: /sources and filters/i }),
    );
    const notes = sources.getByRole("button", { name: /notes & memories/i });
    expect(notes).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(notes);
    expect(notes).toHaveAttribute("aria-pressed", "false");
    expect(new Set(scene.current?.nodes.map((item) => item.id))).toEqual(
      new Set(["b", "c"]),
    );
    const browse = sources.getByText(/browse notes/i).closest("details")!;
    fireEvent.click(within(browse).getByText(/browse notes/i));
    fireEvent.click(
      within(browse).getByRole("button", { name: /implementation guide/i }),
    );
    expect(scene.current?.selectedId).toBe("b");
    expect(notes).toHaveAttribute("aria-pressed", "false");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "get_spectrum_graph"),
    ).toBe(true);
  });

  it("lets a connected-note button navigate to the stored neighbor", async () => {
    await openGraph();
    selectInGraph("Release brief");
    const details = within(
      screen.getByRole("complementary", { name: /note details/i }),
    );
    const neighbor = details.getByRole("button", {
      name: /implementation guide/i,
    });
    expect(neighbor).toHaveTextContent(/derived from/i);
    fireEvent.click(neighbor);
    expect(scene.current?.selectedId).toBe("b");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "get_spectrum_graph"),
    ).toBe(true);
  });

  it("updates relationship weight only through explicit feedback controls", async () => {
    await openGraph();
    selectInGraph("Release brief");
    const details = within(
      screen.getByRole("complementary", { name: /note details/i }),
    );
    fireEvent.click(details.getByText(/relationship details/i));
    expect(invoke).not.toHaveBeenCalledWith(
      "update_edge_weight",
      expect.anything(),
    );
    fireEvent.click(details.getByRole("button", { name: /strengthen link/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_edge_weight", {
        edgeId: "ab",
        feedbackSignal: 1,
      }),
    );
    await waitFor(() =>
      expect(
        details.getByRole("button", { name: /weaken link/i }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(details.getByRole("button", { name: /weaken link/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_edge_weight", {
        edgeId: "ab",
        feedbackSignal: -0.5,
      }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === "get_spectrum_graph"),
      ).toHaveLength(3),
    );
  });

  it("exposes the active map dimension with accessible pressed buttons", async () => {
    await openGraph();
    fireEvent.click(screen.getByRole("button", { name: /^2D$/ }));
    expect(screen.getByRole("button", { name: /^2D$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(scene.current?.mode).toBe("2d");
    fireEvent.click(screen.getByRole("button", { name: /^3D$/ }));
    expect(screen.getByRole("button", { name: /^3D$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(scene.current?.mode).toBe("3d");
  });

  it("focuses recorded neighbors and traces a route without changing stored knowledge", async () => {
    await openGraph();
    selectInGraph("Release brief");
    fireEvent.click(screen.getByRole("button", { name: /focus connections/i }));
    expect(scene.current?.focusIds).toEqual(new Set(["a", "b"]));
    fireEvent.click(screen.getByRole("button", { name: /show entire map/i }));
    fireEvent.click(screen.getByRole("button", { name: /start path here/i }));
    selectInGraph("Review conversation");
    fireEvent.click(
      screen.getByRole("button", { name: /trace to this note/i }),
    );
    expect(scene.current?.pathEdges).toEqual(new Set(["ab", "bc"]));
    fireEvent.click(screen.getByRole("button", { name: /clear path/i }));
    expect(scene.current?.pathEdges.size).toBe(0);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "get_spectrum_graph"),
    ).toBe(true);
  });

  it("loads suggestions only on review and never draws them as recorded relationships", async () => {
    await openGraph();
    fireEvent.click(
      screen.getByRole("button", { name: /review connections/i }),
    );
    await screen.findByRole("button", { name: /record connection/i });
    expect(invoke).toHaveBeenCalledWith("predict_edges", expect.any(Object));
    expect(scene.current?.edges.map((item) => item.id)).toEqual(["ab", "bc"]);
    expect(invoke).not.toHaveBeenCalledWith(
      "confirm_predicted_edge",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: /record connection/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("confirm_predicted_edge", {
        sourceId: "a",
        targetId: "d",
      }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === "get_spectrum_graph"),
      ).toHaveLength(2),
    );
  });

  it("reports when no recorded path exists without adding a connection", async () => {
    await openGraph();
    selectInGraph("Release brief");
    fireEvent.click(screen.getByRole("button", { name: /start path here/i }));
    selectInGraph("Unconnected research");
    fireEvent.click(
      screen.getByRole("button", { name: /trace to this note/i }),
    );
    expect(
      screen.getByRole("status", { name: "Path result" }),
    ).toHaveTextContent(/no recorded path/i);
    expect(scene.current?.pathEdges.size).toBe(0);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "get_spectrum_graph"),
    ).toBe(true);
  });

  it("dismisses a suggested relationship only after explicit action", async () => {
    await openGraph();
    fireEvent.click(
      screen.getByRole("button", { name: /review connections/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /dismiss suggestion/i }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("dismiss_predicted_edge", {
        sourceId: "a",
        targetId: "d",
      }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "confirm_predicted_edge",
      expect.anything(),
    );
  });

  it("keeps an in-flight suggestion request usable when a new graph refresh arrives", async () => {
    let finish!: (value: string) => void;
    const request = new Promise<string>((resolve) => {
      finish = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_spectrum_graph") return JSON.stringify(snapshot);
      if (command === "predict_edges") return request;
      return "{}";
    });
    const view = render(<SpectrumGraphView refreshKey={0} />);
    await screen.findByTestId("knowledge-scene");
    fireEvent.click(
      screen.getByRole("button", { name: /review connections/i }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/finding candidates/i);
    view.rerender(<SpectrumGraphView refreshKey={1} />);
    await act(async () => {
      finish(JSON.stringify([prediction]));
    });
    await screen.findByRole("button", { name: /record connection/i });
    expect(screen.queryByText(/finding candidates/i)).not.toBeInTheDocument();
  });

  it("searches beyond the rendering limit without truncating the stored snapshot", async () => {
    setup({
      ...snapshot,
      nodes: Array.from({ length: 1201 }, (_, i) =>
        node(`item-${i}`, `Sample ${String(i).padStart(4, "0")}`),
      ),
      edges: [],
    });
    await openGraph();
    expect(scene.current?.nodes).toHaveLength(1200);
    expect(scene.current?.nodes.some((item) => item.id === "item-1200")).toBe(
      false,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /search notes/i }), {
      target: { value: "Sample 1200" },
    });
    const result = screen.getByRole("button", { name: /Sample 1200/ });
    fireEvent.click(result);
    expect(scene.current?.selectedId).toBe("item-1200");
    expect(scene.current?.nodes.some((item) => item.id === "item-1200")).toBe(
      true,
    );
    expect(screen.getByText(/1,200 of 1,201 notes/)).toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "get_spectrum_graph",
    ]);
  }, 20_000); // 1,201-node render is ~6 s on the CI runner

  it("expands a long note on request and can return to the excerpt", async () => {
    setup({
      ...snapshot,
      nodes: [
        node(
          "long",
          "Long note",
          `${"Opening context. ".repeat(140)}Unique closing sentence.`,
        ),
      ],
      edges: [],
    });
    await openGraph();
    selectInGraph("Long note");
    fireEvent.click(screen.getByRole("button", { name: /read full note/i }));
    expect(screen.getByText(/unique closing sentence/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show less/i }));
    expect(
      screen.getByRole("button", { name: /read full note/i }),
    ).toBeInTheDocument();
  });

  it("opens a suggestion-heavy graph on real connected knowledge without deleting records", async () => {
    setup({
      ...snapshot,
      nodes: [
        ...snapshot.nodes,
        ...Array.from({ length: 70 }, (_, i) =>
          node(
            `legacy-${i}`,
            `Old card ${i}`,
            "Automatic card, not a fact",
            "suggestion",
          ),
        ),
      ],
    });
    await openGraph();
    expect(
      screen.getByRole("button", { name: /^Connected 3$/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(scene.current?.nodes.map((item) => item.id).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(scene.current?.edges).toHaveLength(2);
    expect(
      screen.getByText(/70 unconnected records are automatic suggestions/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All records 74$/ }));
    expect(scene.current?.nodes).toHaveLength(74);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "get_spectrum_graph",
    ]);
  });

  it("explains unconnected records and reveals a linked search result from that scope", async () => {
    await openGraph();
    fireEvent.click(screen.getByRole("button", { name: /^Unconnected 1$/ }));
    expect(scene.current?.nodes.map((item) => item.id)).toEqual(["d"]);
    expect(scene.current?.edges).toHaveLength(0);
    expect(screen.getByText(/No links in this view/)).toBeInTheDocument();
    const list = screen.getByText(/Browse notes/i).closest("details")!;
    expect(list).toHaveAttribute("open");
    selectInGraph("Unconnected research");
    expect(
      screen.getByRole("button", { name: "Focus connections" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Start path here" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Search notes" }), {
      target: { value: "Release brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Release brief/ }));
    expect(
      screen.getByRole("button", { name: /^Connected 3$/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(scene.current?.selectedId).toBe("a");
    expect(scene.current?.edges).toHaveLength(2);
  });

  it("recovers from an empty connection scope with Show entire map", async () => {
    setup({ ...snapshot, edges: [] });
    await openGraph();
    fireEvent.click(screen.getByRole("button", { name: /^Connected 0$/ }));
    expect(screen.queryByTestId("knowledge-scene")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Show entire map$/ }));
    await screen.findByTestId("knowledge-scene");
    expect(
      screen.getByRole("button", { name: /^All records 4$/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(scene.current?.nodes).toHaveLength(4);
    expect(scene.current?.edges).toHaveLength(0);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "get_spectrum_graph",
    ]);
  });

  it("counts review suggestions within the active connection scope", async () => {
    const now = new Date().toISOString();
    setup({
      ...snapshot,
      nodes: snapshot.nodes.map((item) => ({
        ...item,
        updated_at: item.id === "a" ? "2000-01-01T00:00:00Z" : now,
      })),
    });
    await openGraph();
    const reviewLabel = () =>
      screen
        .getByRole("checkbox", { name: /^Review suggested/ })
        .closest("label")!;
    expect(reviewLabel()).toHaveTextContent(/Review suggested\s*2/);
    fireEvent.click(screen.getByRole("button", { name: /^Connected 3$/ }));
    expect(reviewLabel()).toHaveTextContent(/Review suggested\s*1/);
    fireEvent.click(screen.getByRole("button", { name: /^Unconnected 1$/ }));
    expect(reviewLabel()).toHaveTextContent(/Review suggested\s*1/);
    fireEvent.click(screen.getByRole("button", { name: /^All records 4$/ }));
    expect(reviewLabel()).toHaveTextContent(/Review suggested\s*2/);
  });

  it("reveals newly linked endpoints after recording a suggestion from Unconnected", async () => {
    const additional = node(
      "e",
      "Additional research",
      "A separate research record.",
    );
    const nodes = [...snapshot.nodes, additional];
    const recorded = edge("de", "d", "e", "predicted_confirmed");
    let confirmed = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_spectrum_graph")
        return JSON.stringify({
          ...snapshot,
          nodes,
          edges: confirmed ? [...snapshot.edges, recorded] : snapshot.edges,
        });
      if (command === "predict_edges")
        return JSON.stringify([
          {
            ...prediction,
            source_id: "d",
            target_id: "e",
            source_label: "Unconnected research",
            target_label: "Additional research",
          },
        ]);
      if (command === "confirm_predicted_edge") {
        confirmed = true;
        return JSON.stringify(recorded);
      }
      return "{}";
    });
    await openGraph();
    fireEvent.click(screen.getByRole("button", { name: /^Unconnected 2$/ }));
    selectInGraph("Unconnected research");
    expect(scene.current?.edges).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: /^Review connections$/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^Record connection$/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Connected 5$/ }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(invoke).toHaveBeenCalledWith("confirm_predicted_edge", {
      sourceId: "d",
      targetId: "e",
    });
    expect(scene.current?.nodes.map((item) => item.id)).toEqual(
      expect.arrayContaining(["d", "e"]),
    );
    expect(scene.current?.edges.map((item) => item.id)).toContain("de");
  });

  it("distinguishes same-title search results with their evidence excerpts", async () => {
    setup({
      ...snapshot,
      nodes: [
        node(
          "first",
          "Migration notes",
          "Evidence from the preparation review.",
        ),
        node(
          "second",
          "Migration notes",
          "Evidence from the post-change review.",
        ),
      ],
      edges: [],
    });
    await openGraph();
    fireEvent.change(screen.getByRole("textbox", { name: "Search notes" }), {
      target: { value: "Migration notes" },
    });
    expect(
      screen.getByText(/Evidence from the preparation review/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Evidence from the post-change review/),
    ).toBeInTheDocument();
  });
});
