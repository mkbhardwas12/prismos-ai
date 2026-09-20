import type { SpectrumEdge, SpectrumNode } from "../types";

export type KnowledgeKind =
  | "projects"
  | "files"
  | "conversations"
  | "concepts"
  | "notes"
  | "people"
  | "skills"
  | "agents"
  | "meetings"
  | "insights"
  | "general";

export interface KnowledgeNode extends SpectrumNode {
  groupId: string;
  /** Number of distinct adjacent nodes, excluding self-links. */
  degree: number;
}

export interface KnowledgeGroup {
  id: string;
  label: string;
  color: string;
  kind: KnowledgeKind;
  count: number;
}

const KINDS: Record<KnowledgeKind, { label: string; color: string }> = {
  projects: { label: "Projects", color: "#63a9ff" },
  files: { label: "Files & documents", color: "#8ecf81" },
  conversations: { label: "Conversations", color: "#b195f0" },
  concepts: { label: "Concepts", color: "#73c3df" },
  notes: { label: "Notes & memories", color: "#efd084" },
  people: { label: "People", color: "#f197bb" },
  skills: { label: "Skills & learning", color: "#66cec5" },
  agents: { label: "Agents & workflows", color: "#ffac72" },
  meetings: { label: "Meetings & events", color: "#a6a0ff" },
  insights: { label: "Insights", color: "#d098df" },
  general: { label: "General knowledge", color: "#9caec1" },
};

const GROUP_COLORS = [
  "#63a9ff",
  "#8ecf81",
  "#b195f0",
  "#efd084",
  "#f197bb",
  "#66cec5",
  "#ffac72",
  "#a6a0ff",
  "#d098df",
  "#73c3df",
  "#c3cd73",
  "#e39b88",
];

function groupColor(id: string, kind: KnowledgeKind): string {
  if (id.startsWith("kind:")) return KINDS[kind].color;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++)
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const count = (value: number) => Math.max(0, Math.trunc(finite(value)));
const validId = (id: string) => typeof id === "string" && id.trim().length > 0;

function kindOf(node: SpectrumNode): KnowledgeKind {
  const type = node.node_type.toLowerCase().replace(/[ -]+/g, "_");
  if (
    ["project", "repository", "repo", "codebase"].includes(type) ||
    node.id.startsWith("proj-")
  )
    return "projects";
  if (["document", "doc_chunk", "file", "source", "attachment"].includes(type))
    return "files";
  if (["conversation", "chat", "message"].includes(type))
    return "conversations";
  if (["entity", "concept", "topic"].includes(type)) return "concepts";
  if (
    ["person", "people", "contact", "profile", "user", "personal"].includes(
      type,
    ) ||
    node.id.startsWith("user-")
  )
    return "people";
  if (["skill", "learning", "course", "technology"].includes(type))
    return "skills";
  if (["agent", "workflow", "tool", "automation"].includes(type))
    return "agents";
  if (["meeting", "event", "calendar"].includes(type)) return "meetings";
  if (
    [
      "suggestion",
      "insight",
      "drift_pattern",
      "thought_current",
      "refraction",
      "meta",
    ].includes(type)
  )
    return "insights";
  if (["note", "memory", "task"].includes(type)) return "notes";
  return "general";
}

/** Read only the provenance envelope written by doc_chunker/file_indexer.
 * Content below the first blank line is document text, not metadata. */
function storedSource(node: SpectrumNode): string | null {
  const header = node.content.split(/\r?\n\s*\r?\n/, 1)[0];
  let source: string | undefined;
  if (
    node.node_type === "doc_chunk" &&
    /^Source: /m.test(header) &&
    /^Chunk: \d+\/\d+$/m.test(header)
  ) {
    source = /^Source: (.+)$/m.exec(header)?.[1];
  } else if (
    ["document", "file"].includes(node.node_type) &&
    /^Local file: /m.test(header)
  ) {
    source = /^Path: (.+)$/m.exec(header)?.[1];
  }
  if (!source?.trim()) return null;
  // This is a display identity only; never resolve, open, or transmit the path.
  return source.trim().replace(/\\/g, "/");
}

function sourceLabel(source: string): string {
  return source.replace(/\/+$/, "").split("/").pop() || source;
}

function adjacency(
  edges: SpectrumEdge[],
): Map<string, { nodeId: string; edgeId: string }[]> {
  const result = new Map<string, { nodeId: string; edgeId: string }[]>();
  for (const edge of edges) {
    if (!validId(edge.source_id) || !validId(edge.target_id)) continue;
    const add = (from: string, to: string) => {
      const neighbors = result.get(from) ?? [];
      neighbors.push({ nodeId: to, edgeId: edge.id });
      result.set(from, neighbors);
    };
    add(edge.source_id, edge.target_id);
    if (edge.source_id !== edge.target_id) add(edge.target_id, edge.source_id);
  }
  for (const neighbors of result.values()) {
    neighbors.sort(
      (a, b) => compare(a.nodeId, b.nodeId) || compare(a.edgeId, b.edgeId),
    );
  }
  return result;
}

/** Pure view projection. It never consolidates or edits the stored graph. */
export function buildKnowledgeGraph(
  inputNodes: SpectrumNode[],
  inputEdges: SpectrumEdge[],
) {
  const nodeById = new Map<string, SpectrumNode>();
  for (const node of [...inputNodes].sort(
    (a, b) => compare(a.id, b.id) || compare(a.label, b.label),
  )) {
    if (validId(node.id) && !nodeById.has(node.id)) nodeById.set(node.id, node);
  }

  let danglingEdges = 0;
  let duplicateEdges = 0;
  const seenIds = new Set<string>();
  const seenRelations = new Set<string>();
  const edges: SpectrumEdge[] = [];
  for (const edge of [...inputEdges].sort(
    (a, b) =>
      compare(a.id, b.id) ||
      compare(a.source_id, b.source_id) ||
      compare(a.target_id, b.target_id) ||
      compare(a.relation, b.relation),
  )) {
    if (!nodeById.has(edge.source_id) || !nodeById.has(edge.target_id)) {
      danglingEdges++;
      continue;
    }
    // JSON tuple avoids accidental collisions when identifiers contain separators.
    const key = JSON.stringify([edge.source_id, edge.target_id, edge.relation]);
    if (seenIds.has(edge.id) || seenRelations.has(key)) {
      duplicateEdges++;
      continue;
    }
    seenIds.add(edge.id);
    seenRelations.add(key);
    edges.push({
      ...edge,
      weight: Math.max(0, finite(edge.weight)),
      momentum: finite(edge.momentum),
      reinforcements: count(edge.reinforcements),
    });
  }

  const groupById = new Map<string, KnowledgeGroup>();
  const assignment = new Map<string, string>();
  const ensureGroup = (id: string, label: string, kind: KnowledgeKind) => {
    if (!groupById.has(id))
      groupById.set(id, {
        id,
        label,
        color: groupColor(id, kind),
        kind,
        count: 0,
      });
    return id;
  };
  const projects = [...nodeById.values()].filter(
    (node) => kindOf(node) === "projects",
  );
  for (const project of projects) {
    assignment.set(
      project.id,
      ensureGroup(`project:${project.id}`, project.label, "projects"),
    );
  }

  // Only explicit membership relations assign a project. A mention or inferred
  // similarity is not proof that a document belongs to that project.
  const projectIds = new Set(projects.map((node) => node.id));
  const memberships = new Map<string, Set<string>>();
  for (const edge of edges) {
    let projectId: string | undefined;
    let memberId: string | undefined;
    if (
      ["contains", "has_file", "has_document", "has_member"].includes(
        edge.relation,
      ) &&
      projectIds.has(edge.source_id)
    ) {
      projectId = edge.source_id;
      memberId = edge.target_id;
    } else if (
      ["belongs_to", "part_of", "in_project"].includes(edge.relation) &&
      projectIds.has(edge.target_id)
    ) {
      projectId = edge.target_id;
      memberId = edge.source_id;
    }
    if (projectId && memberId && !projectIds.has(memberId)) {
      const candidates = memberships.get(memberId) ?? new Set<string>();
      candidates.add(projectId);
      memberships.set(memberId, candidates);
    }
  }
  for (const [memberId, candidates] of memberships) {
    // Ambiguous ownership stays in its own source/type group.
    if (candidates.size === 1)
      assignment.set(memberId, `project:${[...candidates][0]}`);
  }

  // A file and its chunks share an explicit stored source. Transfer project
  // membership only when all membership evidence for that source agrees.
  const sourceProjects = new Map<string, Set<string>>();
  for (const [memberId, candidates] of memberships) {
    const member = nodeById.get(memberId);
    const source = member ? storedSource(member) : null;
    if (!source) continue;
    const known = sourceProjects.get(source) ?? new Set<string>();
    for (const projectId of candidates) known.add(projectId);
    sourceProjects.set(source, known);
  }

  for (const node of nodeById.values()) {
    if (assignment.has(node.id)) continue;
    const kind = kindOf(node);
    const source = storedSource(node);
    const owners = source ? sourceProjects.get(source) : undefined;
    if (owners?.size === 1) {
      assignment.set(node.id, `project:${[...owners][0]}`);
      continue;
    }
    assignment.set(
      node.id,
      source
        ? ensureGroup(`source:${source}`, sourceLabel(source), "files")
        : ensureGroup(`kind:${kind}`, KINDS[kind].label, kind),
    );
  }

  // Same-named files in different directories must remain distinguishable.
  const sourceGroups = [...groupById.values()].filter((group) =>
    group.id.startsWith("source:"),
  );
  const sourceLabelCounts = new Map<string, number>();
  for (const group of sourceGroups)
    sourceLabelCounts.set(
      group.label,
      (sourceLabelCounts.get(group.label) ?? 0) + 1,
    );
  for (const group of sourceGroups) {
    if ((sourceLabelCounts.get(group.label) ?? 0) > 1) {
      const source = group.id.slice("source:".length);
      group.label = source;
    }
  }

  const neighbors = adjacency(edges);
  const nodes: KnowledgeNode[] = [...nodeById.values()]
    .map((node) => {
      const groupId = assignment.get(node.id)!;
      groupById.get(groupId)!.count++;
      const connections = [
        ...new Set(
          (neighbors.get(node.id) ?? [])
            .map((item) => item.nodeId)
            .filter((id) => id !== node.id),
        ),
      ];
      return {
        ...node,
        access_count: count(node.access_count),
        connections,
        groupId,
        degree: connections.length,
      };
    })
    .sort(
      (a, b) =>
        compare(a.label.toLowerCase(), b.label.toLowerCase()) ||
        compare(a.id, b.id),
    );

  const groups = [...groupById.values()]
    .filter((group) => group.count > 0)
    .sort(
      (a, b) =>
        compare(a.label.toLowerCase(), b.label.toLowerCase()) ||
        compare(a.id, b.id),
    );
  // Reserve semantic category colors first. Source hashes can collide with one
  // another or a category: use an unused palette color when one is available.
  // Labels remain the identity cue when a graph has more groups than colors.
  const usedColors = new Set<string>();
  for (const group of [...groups].sort(
    (a, b) =>
      Number(b.id.startsWith("kind:")) - Number(a.id.startsWith("kind:")) ||
      compare(a.id, b.id),
  )) {
    if (usedColors.has(group.color))
      group.color =
        GROUP_COLORS.find((color) => !usedColors.has(color)) ?? group.color;
    usedColors.add(group.color);
  }
  return {
    nodes,
    edges,
    groups,
    diagnostics: {
      danglingEdges,
      duplicateEdges,
      isolatedNodes: nodes.filter((node) => node.degree === 0).length,
    },
  };
}

/** Ranked local search, with a bounded result list for keyboard navigation. */
export function searchKnowledgeNodes(
  nodes: KnowledgeNode[],
  query: string,
): KnowledgeNode[] {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  return nodes
    .map((node) => {
      const label = node.label.toLowerCase();
      const content = node.content.toLowerCase();
      const group = node.groupId.toLowerCase();
      const matches = terms.every(
        (term) =>
          label.includes(term) ||
          content.includes(term) ||
          group.includes(term),
      );
      const score =
        (label === normalized ? 100 : label.startsWith(normalized) ? 40 : 0) +
        terms.reduce(
          (total, term) =>
            total +
            (label.includes(term) ? 10 : content.includes(term) ? 2 : 1),
          0,
        );
      return { node, matches, score };
    })
    .filter((item) => item.matches)
    .sort(
      (a, b) =>
        b.score - a.score ||
        compare(a.node.label.toLowerCase(), b.node.label.toLowerCase()) ||
        compare(a.node.id, b.node.id),
    )
    .slice(0, 80)
    .map((item) => item.node);
}

/** Shortest navigable path. Stored relationship arrows retain their direction. */
export function findKnowledgePath(
  edges: SpectrumEdge[],
  from: string,
  to: string,
): { nodeIds: string[]; edgeIds: string[] } | null {
  if (!validId(from) || !validId(to)) return null;
  if (from === to) return { nodeIds: [from], edgeIds: [] };
  const neighbors = adjacency(edges);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const visited = new Set<string>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const neighbor of neighbors.get(queue[i]) ?? []) {
      if (visited.has(neighbor.nodeId)) continue;
      visited.add(neighbor.nodeId);
      previous.set(neighbor.nodeId, {
        nodeId: queue[i],
        edgeId: neighbor.edgeId,
      });
      if (neighbor.nodeId === to) {
        const nodeIds = [to];
        const edgeIds: string[] = [];
        let cursor = to;
        while (cursor !== from) {
          const step = previous.get(cursor)!;
          edgeIds.push(step.edgeId);
          nodeIds.push(step.nodeId);
          cursor = step.nodeId;
        }
        return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse() };
      }
      queue.push(neighbor.nodeId);
    }
  }
  return null;
}

export function connectedNeighborhood(
  edges: SpectrumEdge[],
  id: string,
  hops = 1,
): Set<string> {
  if (!validId(id)) return new Set();
  const neighbors = adjacency(edges);
  const visited = new Set([id]);
  let frontier = [id];
  const depth = Number.isFinite(hops) ? Math.max(0, Math.trunc(hops)) : 1;
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbor of neighbors.get(nodeId) ?? []) {
        if (!visited.has(neighbor.nodeId)) {
          visited.add(neighbor.nodeId);
          next.push(neighbor.nodeId);
        }
      }
    }
    frontier = next;
  }
  return visited;
}
