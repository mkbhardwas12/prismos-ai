import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeGraphScene from "../components/KnowledgeGraphScene";
import KnowledgeGraphScene3D from "../components/KnowledgeGraphScene3D";
import type { SceneData } from "../components/KnowledgeGraphScene";
import { buildKnowledgeGraph } from "../lib/knowledgeGraph";
import type { SpectrumNode, SpectrumEdge } from "../types";

const renderer = vi.hoisted(() => ({
  props2d: null as any,
  props3d: null as any,
  api2d: {
    zoomToFit: vi.fn(),
    d3ReheatSimulation: vi.fn(),
    d3Force: vi.fn(() => ({ strength: vi.fn(), distance: vi.fn() })),
  },
  api3d: {
    zoomToFit: vi.fn(),
    d3ReheatSimulation: vi.fn(),
    d3Force: vi.fn(() => ({ strength: vi.fn(), distance: vi.fn() })),
    pauseAnimation: vi.fn(),
    resumeAnimation: vi.fn(),
  },
}));

vi.mock("react-force-graph-2d", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((props: any, ref) => {
      renderer.props2d = props;
      React.useImperativeHandle(ref, () => renderer.api2d);
      return <div data-testid="2d-renderer" />;
    }),
  };
});

vi.mock("react-force-graph-3d", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((props: any, ref) => {
      renderer.props3d = props;
      React.useImperativeHandle(ref, () => renderer.api3d);
      return <div data-testid="3d-renderer" />;
    }),
  };
});

vi.mock("three-spritetext", () => ({
  default: class {
    position = { y: 0 };
  },
}));

function note(id: string): SpectrumNode {
  return {
    id,
    label: `Note ${id}`,
    content: `Content ${id}`,
    node_type: "note",
    layer: "context",
    access_count: 1,
    last_accessed: "",
    created_at: "",
    updated_at: "",
    connections: [],
  };
}
const storedEdge: SpectrumEdge = {
  id: "ab",
  source_id: "a",
  target_id: "b",
  relation: "supports",
  weight: 1,
  momentum: 0,
  reinforcements: 0,
  last_reinforced: "",
  created_at: "",
};
const graph = buildKnowledgeGraph([note("a"), note("b")], [storedEdge]);
const controls = {
  width: 900,
  height: 600,
  selectedId: null as string | null,
  focusIds: null as Set<string> | null,
  pathEdges: new Set<string>(),
  showLabels: false,
  fitKey: 0,
  onSelect: vi.fn(),
  onHover: vi.fn(),
  onFallback: vi.fn(),
};

describe("knowledge graph renderer stability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    renderer.props2d = null;
    renderer.props3d = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["2d", "3d"] as const)(
    "makes incident %s links readable while keeping path priority and stable endpoints",
    (mode) => {
      const scenario = buildKnowledgeGraph(
        ["a", "b", "c", "d", "e"].map(note),
        [
          { ...storedEdge, id: "ab", source_id: "a", target_id: "b" },
          { ...storedEdge, id: "ca", source_id: "c", target_id: "a" },
          { ...storedEdge, id: "bc", source_id: "b", target_id: "c" },
          { ...storedEdge, id: "de", source_id: "d", target_id: "e" },
          { ...storedEdge, id: "ce", source_id: "c", target_id: "e" },
        ],
      );
      const scene3d: SceneData = {
        revision: 1,
        nodes: scenario.nodes.map((node) => ({
          ...node,
          color: "#73c3df",
          radius: 5,
          landmark: false,
          anchor: { x: 0, y: 0, z: 0 },
          x: 100,
          y: 50,
          z: 25,
        })),
        links: scenario.edges.map((edge) => ({
          ...edge,
          source: edge.source_id,
          target: edge.target_id,
        })),
      };
      const view = render(
        mode === "2d" ? (
          <KnowledgeGraphScene {...controls} {...scenario} mode="2d" />
        ) : (
          <KnowledgeGraphScene3D {...controls} data={scene3d} />
        ),
      );
      const props = () => (mode === "2d" ? renderer.props2d : renderer.props3d);
      const api = mode === "2d" ? renderer.api2d : renderer.api3d;
      act(() => {
        vi.advanceTimersByTime(250);
        props().onEngineStop();
      });
      const data: SceneData = props().graphData;
      const links = new Map(data.links.map((link) => [link.id, link]));
      const source = data.nodes.find((node) => node.id === "a")!;
      const target = data.nodes.find((node) => node.id === "b")!;
      links.get("ab")!.source = source;
      links.get("ab")!.target = target;
      const baselineColor = props().linkColor(links.get("ab"));
      const selection = {
        selectedId: "a",
        focusIds: new Set(["a", "b", "c"]),
        pathEdges: new Set(["ce"]),
      };
      view.rerender(
        mode === "2d" ? (
          <KnowledgeGraphScene
            {...controls}
            {...scenario}
            {...selection}
            mode="2d"
          />
        ) : (
          <KnowledgeGraphScene3D {...controls} {...selection} data={scene3d} />
        ),
      );
      const style = props();
      expect(style.linkWidth(links.get("ce"))).toBeGreaterThan(
        style.linkWidth(links.get("ab")),
      );
      expect(style.linkWidth(links.get("ab"))).toBeGreaterThan(
        style.linkWidth(links.get("bc")),
      );
      expect(style.linkColor(links.get("ce"))).toBe("#f1cb74");
      expect(style.linkColor(links.get("ab"))).toBe(
        style.linkColor(links.get("ca")),
      );
      expect(style.linkColor(links.get("ab"))).not.toBe(baselineColor);
      expect(style.linkColor(links.get("bc"))).not.toBe(
        style.linkColor(links.get("de")),
      );
      expect(style.linkColor(links.get("bc"))).not.toBe(
        style.linkColor(links.get("ab")),
      );
      expect(style.linkDirectionalArrowLength(links.get("ab"))).toBeGreaterThan(
        0,
      );
      expect(style.linkDirectionalArrowLength(links.get("ca"))).toBeGreaterThan(
        0,
      );
      expect(style.linkDirectionalArrowLength(links.get("ce"))).toBeGreaterThan(
        style.linkDirectionalArrowLength(links.get("ab")),
      );
      expect(style.linkDirectionalArrowLength(links.get("bc"))).toBe(0);
      expect(style.linkDirectionalArrowLength(links.get("de"))).toBe(0);
      expect(style.graphData).toBe(data);
      expect(links.get("ab")!.source).toBe(source);
      expect(links.get("ab")!.target).toBe(target);
      expect(style.graphData.links).toHaveLength(5);
      act(() => {
        vi.advanceTimersByTime(250);
        props().onEngineStop();
      });
      expect(api.zoomToFit).toHaveBeenCalledTimes(2);
      expect(api.d3ReheatSimulation).not.toHaveBeenCalled();
    },
  );

  it("labels bounded representatives across sparse groups without creating links or hubs", () => {
    const inputs = Array.from({ length: 8 }, (_, group) =>
      Array.from({ length: 4 }, (_, index) => ({
        ...note(`group-${group}-${index}`),
        node_type: "doc_chunk",
        content: `Source: /samples/document-${group}.md\nChunk: ${index + 1}/4\nChars: 0-20\n\nExample note`,
      })),
    ).flat();
    const sparse = buildKnowledgeGraph(inputs, []);
    const view = render(
      <KnowledgeGraphScene {...controls} {...sparse} mode="2d" />,
    );
    const data: SceneData = renderer.props2d.graphData;
    const representatives = data.nodes.filter((node) => node.representative);
    expect(representatives).toHaveLength(12);
    expect(new Set(representatives.map((node) => node.groupId)).size).toBe(8);
    for (const group of sparse.groups)
      expect(
        representatives.filter((node) => node.groupId === group.id).length,
      ).toBeLessThanOrEqual(2);
    expect(
      representatives.every(
        (node) => node.degree === 0 && !node.landmark && node.radius === 2.7,
      ),
    ).toBe(true);
    expect(data.links).toEqual([]);
    expect(data.nodes).toHaveLength(inputs.length);
    const ids = representatives.map((node) => node.id);
    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...sparse}
        nodes={[...sparse.nodes].reverse()}
        mode="2d"
      />,
    );
    expect(
      (renderer.props2d.graphData as SceneData).nodes
        .filter((node) => node.representative)
        .map((node) => node.id),
    ).toEqual(ids);
  });

  it("keeps automatic 2D labels from overlapping and gives the selected title priority", () => {
    const sparse = buildKnowledgeGraph([note("a"), note("b")], []);
    const view = render(
      <KnowledgeGraphScene {...controls} {...sparse} mode="2d" />,
    );
    const data: SceneData = renderer.props2d.graphData;
    for (const node of data.nodes) {
      node.x = 0;
      node.y = 0;
      node.labelSide = 1;
    }
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
    renderer.props2d.onRenderFramePre();
    data.nodes.forEach((node) =>
      renderer.props2d.nodeCanvasObject(node, context, 1),
    );
    expect(context.fillText).toHaveBeenCalledTimes(1);
    context.fillText.mockClear();
    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...sparse}
        mode="2d"
        selectedId="b"
      />,
    );
    renderer.props2d.onRenderFramePre();
    data.nodes.forEach((node) =>
      renderer.props2d.nodeCanvasObject(node, context, 1),
    );
    expect(context.fillText).toHaveBeenCalledTimes(1);
    expect(context.fillText).toHaveBeenCalledWith(
      "Note b",
      0,
      expect.any(Number),
    );
  });

  it("renders sparse 3D representative labels without treating them as connected landmarks", () => {
    const data: SceneData = {
      revision: 1,
      nodes: buildKnowledgeGraph([note("a")], []).nodes.map((node) => ({
        ...node,
        color: "#73c3df",
        radius: 2.7,
        landmark: false,
        representative: true,
        labelSide: -1 as const,
        anchor: { x: 0, y: 0, z: 0 },
      })),
      links: [],
    };
    render(<KnowledgeGraphScene3D {...controls} data={data} />);
    const label = renderer.props3d.nodeThreeObject(data.nodes[0]);
    expect(label).toBeDefined();
    expect(label.position.y).toBeLessThan(0);
    expect(renderer.props3d.graphData.links).toEqual([]);
  });

  it("preserves settled positions and resolved links during selection, tracing, and content updates", () => {
    const view = render(
      <KnowledgeGraphScene {...controls} {...graph} mode="2d" />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    const original: SceneData = renderer.props2d.graphData;
    const anchor = original.nodes.find((node) => node.id === "a")!;
    anchor.x = 725;
    anchor.y = -135;
    anchor.vx = 0.01;
    original.links[0].source = anchor;
    const firstPaint = renderer.props2d.nodeCanvasObject;

    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...graph}
        mode="2d"
        nodes={[...graph.nodes].reverse().map((node) => ({ ...node }))}
        edges={graph.edges.map((edge) => ({ ...edge }))}
        groups={graph.groups.map((group) => ({ ...group }))}
        selectedId="a"
        focusIds={new Set(["a", "b"])}
        pathEdges={new Set(["ab"])}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    expect(renderer.props2d.graphData).toBe(original);
    expect(
      renderer.props2d.graphData.nodes.find(
        (node: SpectrumNode) => node.id === "a",
      ),
    ).toBe(anchor);
    expect(anchor).toMatchObject({ x: 725, y: -135, vx: 0.01 });
    expect(original.links[0].source).toBe(anchor);
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(2);
    expect(renderer.api2d.d3ReheatSimulation).not.toHaveBeenCalled();

    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...graph}
        mode="2d"
        nodes={graph.nodes.map((node) =>
          node.id === "a"
            ? { ...node, label: "Updated note", content: "Updated content" }
            : node,
        )}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    expect(renderer.props2d.graphData).toBe(original);
    expect(anchor).toMatchObject({
      label: "Updated note",
      content: "Updated content",
      x: 725,
      y: -135,
    });
    expect(renderer.props2d.nodeCanvasObject).not.toBe(firstPaint);
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(2);
    expect(renderer.api2d.d3ReheatSimulation).not.toHaveBeenCalled();
    expect(renderer.props2d.nodeLabel(anchor)).toBe("");
    expect(renderer.props2d.linkLabel(original.links[0])).toBe("");
  });

  it("fits on explicit request or structural filtering and prunes objects removed from the view", () => {
    const view = render(
      <KnowledgeGraphScene {...controls} {...graph} mode="2d" />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(1); // initial preview
    act(() => {
      renderer.props2d.onEngineStop();
      renderer.props2d.onEngineStop();
    });
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(2); // settled bounds, once
    const original: SceneData = renderer.props2d.graphData;
    const nodeA = original.nodes.find((node) => node.id === "a")!;
    const nodeB = original.nodes.find((node) => node.id === "b")!;
    nodeA.x = 300;
    view.rerender(
      <KnowledgeGraphScene {...controls} {...graph} mode="2d" fitKey={1} />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(3);
    expect(renderer.api2d.d3ReheatSimulation).not.toHaveBeenCalled();

    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...graph}
        mode="2d"
        fitKey={1}
        nodes={graph.nodes.filter((node) => node.id === "a")}
        edges={[]}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(renderer.props2d.graphData.nodes).toEqual([nodeA]);
    expect(nodeA.x).toBe(300);
    expect(renderer.props2d.graphData.links).toHaveLength(0);
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(4);
    act(() => {
      renderer.props2d.onEngineStop();
      renderer.props2d.onEngineStop();
    });
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(5);
    expect(renderer.api2d.d3ReheatSimulation).not.toHaveBeenCalled();

    view.rerender(
      <KnowledgeGraphScene {...controls} {...graph} mode="2d" fitKey={1} />,
    );
    expect(
      renderer.props2d.graphData.nodes.find(
        (node: SpectrumNode) => node.id === "a",
      ),
    ).toBe(nodeA);
    expect(
      renderer.props2d.graphData.nodes.find(
        (node: SpectrumNode) => node.id === "b",
      ),
    ).not.toBe(nodeB);
    expect(renderer.props2d.graphData.links[0]).not.toBe(original.links[0]);
  });

  it("refits a resized 2D viewport once without arming a later selection fit", () => {
    const view = render(
      <KnowledgeGraphScene {...controls} {...graph} mode="2d" />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...graph}
        mode="2d"
        width={480}
        height={320}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(3);
    view.rerender(
      <KnowledgeGraphScene
        {...controls}
        {...graph}
        mode="2d"
        width={480}
        height={320}
        selectedId="b"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props2d.onEngineStop();
    });
    expect(renderer.api2d.zoomToFit).toHaveBeenCalledTimes(3);
    expect(renderer.api2d.d3ReheatSimulation).not.toHaveBeenCalled();
  });

  it("keeps the 3D camera settled during selection and appearance changes", () => {
    const data: SceneData = {
      revision: 1,
      nodes: graph.nodes.map((node) => ({
        ...node,
        color: "#63a9ff",
        radius: 5,
        landmark: true,
        anchor: { x: 0, y: 0, z: 0 },
        x: 100,
        y: 50,
        z: 25,
      })),
      links: graph.edges.map((edge) => ({
        ...edge,
        source: edge.source_id,
        target: edge.target_id,
      })),
    };
    const view = render(<KnowledgeGraphScene3D {...controls} data={data} />);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(renderer.api3d.zoomToFit).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.props3d.onEngineStop();
      renderer.props3d.onEngineStop();
    });
    expect(renderer.api3d.zoomToFit).toHaveBeenCalledTimes(2);
    view.rerender(
      <KnowledgeGraphScene3D
        {...controls}
        data={data}
        selectedId="a"
        pathEdges={new Set(["ab"])}
        focusIds={new Set(["a", "b"])}
      />,
    );
    data.revision++;
    view.rerender(
      <KnowledgeGraphScene3D
        {...controls}
        data={data}
        selectedId="b"
        showLabels
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props3d.onEngineStop();
    });
    expect(renderer.api3d.zoomToFit).toHaveBeenCalledTimes(2);
    expect(renderer.api3d.d3ReheatSimulation).not.toHaveBeenCalled();
    expect(renderer.props3d.nodeLabel(data.nodes[0])).toBe("");
    expect(renderer.props3d.linkLabel(data.links[0])).toBe("");
    view.rerender(
      <KnowledgeGraphScene3D {...controls} data={data} fitKey={1} />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props3d.onEngineStop();
    });
    expect(renderer.api3d.zoomToFit).toHaveBeenCalledTimes(3);
    view.rerender(
      <KnowledgeGraphScene3D
        {...controls}
        data={data}
        fitKey={1}
        width={480}
        height={320}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props3d.onEngineStop();
    });
    expect(renderer.api3d.zoomToFit).toHaveBeenCalledTimes(4);
    view.rerender(
      <KnowledgeGraphScene3D
        {...controls}
        data={data}
        fitKey={1}
        width={480}
        height={320}
        selectedId="a"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
      renderer.props3d.onEngineStop();
    });
    expect(renderer.api3d.zoomToFit).toHaveBeenCalledTimes(4);
    expect(renderer.api3d.d3ReheatSimulation).not.toHaveBeenCalled();
  });
});
