import { describe, expect, it } from "vitest";
import type { SpectrumEdge, SpectrumNode } from "../types";
import {
  buildKnowledgeGraph,
  connectedNeighborhood,
  findKnowledgePath,
  searchKnowledgeNodes,
} from "../lib/knowledgeGraph";

function node(
  id: string,
  node_type = "note",
  content = "",
  label = id,
): SpectrumNode {
  return {
    id,
    label,
    content,
    node_type,
    layer: "context",
    access_count: 0,
    last_accessed: "",
    created_at: "",
    updated_at: "",
    connections: [],
  };
}

function edge(
  id: string,
  source_id: string,
  target_id: string,
  relation = "related_to",
): SpectrumEdge {
  return {
    id,
    source_id,
    target_id,
    relation,
    weight: 1,
    momentum: 0,
    reinforcements: 0,
    last_reinforced: "",
    created_at: "",
  };
}

describe("knowledge graph projection", () => {
  it("identifies stored entities as concepts without inferring relationships or rewriting records", () => {
    const inputs = [
      node(
        "entity",
        "entity",
        "Mentioned in a conversation",
        "Release planning",
      ),
      node("concept", "concept"),
      node("topic", "topic"),
      node("unknown", "custom_record"),
    ];
    const original = JSON.stringify(inputs);
    const graph = buildKnowledgeGraph(inputs, []);
    expect(
      graph.groups.find((group) => group.id === "kind:concepts"),
    ).toMatchObject({ label: "Concepts", kind: "concepts", count: 3 });
    expect(graph.nodes.find((item) => item.id === "entity")).toMatchObject({
      node_type: "entity",
      groupId: "kind:concepts",
      degree: 0,
    });
    expect(graph.nodes.find((item) => item.id === "unknown")?.groupId).toBe(
      "kind:general",
    );
    expect(graph.edges).toEqual([]);
    expect(JSON.stringify(inputs)).toBe(original);
  });

  it("uses distinct palette colors for small source maps, independent of input order", () => {
    const inputs = [
      node("chat", "conversation"),
      node("meeting", "meeting"),
      node("note", "note"),
      ...Array.from({ length: 5 }, (_, i) =>
        node(
          `file-${i}`,
          "document",
          `Local file: source-${i}.md\nPath: /samples/source-${i}.md\n\nContent`,
        ),
      ),
    ];
    const graph = buildKnowledgeGraph(inputs, []);
    expect(new Set(graph.groups.map((group) => group.color)).size).toBe(
      graph.groups.length,
    );
    expect(buildKnowledgeGraph([...inputs].reverse(), []).groups).toEqual(
      graph.groups,
    );
  });

  it("groups indexed documents and chunks by stored source without conflating same-named files", () => {
    const graph = buildKnowledgeGraph(
      [
        node(
          "doc",
          "document",
          "Local file: README.md\nPath: /projects/alpha/README.md\nSize: 200 bytes\n\npreview",
        ),
        node(
          "chunk1",
          "doc_chunk",
          "Source: /projects/alpha/README.md\nChunk: 1/2\nChars: 0-100\n\ncontent",
        ),
        node(
          "chunk2",
          "doc_chunk",
          "Source: /projects/beta/README.md\nChunk: 1/1\nChars: 0-100\n\ncontent",
        ),
        node(
          "plain",
          "note",
          "My example:\n\nSource: /projects/alpha/README.md\nChunk: 1/2",
        ),
      ],
      [],
    );
    const byId = new Map(graph.nodes.map((item) => [item.id, item]));
    expect(byId.get("doc")?.groupId).toBe(byId.get("chunk1")?.groupId);
    expect(byId.get("chunk2")?.groupId).not.toBe(byId.get("chunk1")?.groupId);
    expect(byId.get("plain")?.groupId).toBe("kind:notes");
    expect(
      graph.groups.find(
        (group) => group.id === "source:/projects/alpha/README.md",
      )?.count,
    ).toBe(2);
    expect(new Set(graph.groups.map((group) => group.label)).size).toBe(
      graph.groups.length,
    );
  });

  it("uses explicit project membership without converting mentions or ambiguous ownership into provenance", () => {
    const graph = buildKnowledgeGraph(
      [
        node("p1", "project", "", "Project Atlas"),
        node("p2", "repository", "", "Project Comet"),
        node("member"),
        node("mentioned"),
        node("shared"),
      ],
      [
        edge("e1", "member", "p1", "belongs_to"),
        edge("e2", "mentioned", "p1", "mentions"),
        edge("e3", "p1", "shared", "contains"),
        edge("e4", "p2", "shared", "contains"),
      ],
    );
    const byId = new Map(graph.nodes.map((item) => [item.id, item]));
    expect(byId.get("member")?.groupId).toBe("project:p1");
    expect(byId.get("p1")?.groupId).toBe("project:p1");
    expect(byId.get("mentioned")?.groupId).toBe("kind:notes");
    expect(byId.get("shared")?.groupId).toBe("kind:notes");
    expect(graph.groups.find((group) => group.id === "project:p1")?.label).toBe(
      "Project Atlas",
    );
  });

  it("keeps chunks with their project when file provenance agrees", () => {
    const nodes = [
      node("project", "project"),
      node(
        "file",
        "document",
        "Local file: notes.md\nPath: /atlas/notes.md\nSize: 10 bytes\n\ntext",
      ),
      node(
        "chunk",
        "doc_chunk",
        "Source: /atlas/notes.md\nChunk: 1/1\nChars: 0-10\n\ntext",
      ),
    ];
    const graph = buildKnowledgeGraph(nodes, [
      edge("membership", "project", "file", "has_file"),
    ]);
    expect(graph.groups).toHaveLength(1);
    expect(graph.groups[0]).toMatchObject({ id: "project:project", count: 3 });
    expect(graph.nodes.find((item) => item.id === "chunk")?.degree).toBe(0);
    // Group membership does not create any relationship that was absent.
    expect(graph.edges).toHaveLength(1);
  });

  it("preserves distinct relation and direction, diagnoses bad links, and leaves inputs untouched", () => {
    const nodes = [node("a"), node("b"), node("alone")];
    const edges = [
      edge("e1", "a", "b"),
      edge("e2", "b", "a"),
      edge("e3", "a", "b", "supports"),
      edge("e4", "a", "b"),
      edge("missing", "a", "gone"),
    ];
    const original = JSON.stringify({ nodes, edges });
    const graph = buildKnowledgeGraph(nodes, edges);
    expect(graph.edges.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
    expect(graph.diagnostics).toEqual({
      danglingEdges: 1,
      duplicateEdges: 1,
      isolatedNodes: 1,
    });
    expect(graph.nodes.find((item) => item.id === "a")?.degree).toBe(1);
    expect(graph.nodes.find((item) => item.id === "a")?.connections).toEqual([
      "b",
    ]);
    expect(JSON.stringify({ nodes, edges })).toBe(original);
    expect(
      buildKnowledgeGraph([...nodes].reverse(), [...edges].reverse()),
    ).toEqual(graph);
  });

  it("sanitizes non-finite graph metrics and does not count self-links as neighbors", () => {
    const graph = buildKnowledgeGraph(
      [{ ...node("a"), access_count: Infinity }],
      [
        {
          ...edge("self", "a", "a"),
          weight: NaN,
          momentum: Infinity,
          reinforcements: -2,
        },
      ],
    );
    expect(graph.nodes[0].access_count).toBe(0);
    expect(graph.nodes[0].degree).toBe(0);
    expect(graph.edges[0]).toMatchObject({
      weight: 0,
      momentum: 0,
      reinforcements: 0,
    });
  });
});

describe("local knowledge exploration", () => {
  it("ranks label matches ahead of content, supports multiple terms and provenance, and caps results", () => {
    const graph = buildKnowledgeGraph(
      [
        node(
          "content",
          "note",
          "The release includes a migration plan",
          "Release",
        ),
        node("exact", "note", "", "Migration plan"),
        node(
          "chunk",
          "doc_chunk",
          "Source: /projects/atlas/runbook.md\nChunk: 1/1\nChars: 0-100\n\nRelease process",
          "Runbook",
        ),
        ...Array.from({ length: 100 }, (_, i) =>
          node(`bulk-${i}`, "note", "shared keyword"),
        ),
      ],
      [],
    );
    expect(
      searchKnowledgeNodes(graph.nodes, "MIGRATION PLAN").map(
        (item) => item.id,
      ),
    ).toEqual(["exact", "content"]);
    expect(
      searchKnowledgeNodes(graph.nodes, "atlas release").map((item) => item.id),
    ).toEqual(["chunk"]);
    expect(searchKnowledgeNodes(graph.nodes, "shared")).toHaveLength(80);
    expect(searchKnowledgeNodes(graph.nodes, "")).toHaveLength(80);
    expect(searchKnowledgeNodes(graph.nodes, "not present")).toEqual([]);
  });

  it("finds a deterministic shortest route in either direction without inventing edges", () => {
    const edges = [
      edge("ac", "a", "c"),
      edge("cd", "c", "d"),
      edge("ab", "a", "b"),
      edge("bd", "b", "d"),
    ];
    expect(findKnowledgePath(edges, "a", "d")).toEqual({
      nodeIds: ["a", "b", "d"],
      edgeIds: ["ab", "bd"],
    });
    expect(findKnowledgePath(edges, "d", "a")).toEqual({
      nodeIds: ["d", "b", "a"],
      edgeIds: ["bd", "ab"],
    });
    expect(findKnowledgePath(edges, "a", "missing")).toBeNull();
    expect(findKnowledgePath([], "a", "a")).toEqual({
      nodeIds: ["a"],
      edgeIds: [],
    });
    expect(findKnowledgePath(edges, "", "a")).toBeNull();
  });

  it("bounds neighborhood traversal by hops and terminates on cycles", () => {
    const edges = [
      edge("ab", "a", "b"),
      edge("bc", "b", "c"),
      edge("cd", "c", "d"),
      edge("db", "d", "b"),
    ];
    expect(connectedNeighborhood(edges, "a")).toEqual(new Set(["a", "b"]));
    expect(connectedNeighborhood(edges, "a", 2)).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
    expect(connectedNeighborhood(edges, "a", 0)).toEqual(new Set(["a"]));
    expect(connectedNeighborhood(edges, "a", 100)).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
    expect(connectedNeighborhood(edges, "a", NaN)).toEqual(new Set(["a", "b"]));
  });
});
