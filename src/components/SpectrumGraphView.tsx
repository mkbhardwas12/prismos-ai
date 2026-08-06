// PrismOS-AI Spectrum Graph View — Force-Directed Knowledge Graph Visualization
//
// Renders the multi-layered Spectrum Graph using react-force-graph-2d.
//
// Organized as CLUSTERS: nodes are grouped into knowledge families (You,
// PrismOS, Projects, Chats, Documents, Insights, and Knowledge).
// Collapsed clusters render as one hub bubble — click a hub to expand its
// members in place; click again (or use the legend / toolbar) to collapse.
// Clicking a member focuses it: neighbors stay lit, everything else dims.
// Custom collision + cluster-anchor forces keep groups apart so labels stay
// readable instead of piling on top of each other.

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ForceGraph2D from "react-force-graph-2d";
import type {
  GraphSnapshot,
  SpectrumNode,
  SpectrumEdge,
  GraphMetrics,
  GraphViewMetadata,
  GraphAnswerTrace,
  AnticipatedNeed,
  PredictedEdge,
} from "../types";
import prismosLogo from "../assets/prismos-logo.svg";
import "./SpectrumGraphView.css";

// ─── Facet Color Palette ───────────────────────────────────────────────────────

const FACET_COLORS: Record<string, string> = {
  work: "#4fc3f7",
  health: "#81c784",
  finance: "#ffb74d",
  social: "#ce93d8",
  learning: "#64b5f6",
  memory: "#90a4ae",
  task: "#e57373",
  note: "#aed581",
  conversation: "#78909c",
  meta: "#b0bec5",
  personal: "#f48fb1",
  document: "#aed581",
  doc_chunk: "#9ccc65",
  project: "#4fc3f7",
  project_chunk: "#29b6f6",
  research: "#ff8f6b",
  reference: "#9ccc65",
  entity: "#81c784",
  knowledge: "#66bb6a",
  suggestion: "#ce93d8",
  drift_pattern: "#ba68c8",
  thought_current: "#ab47bc",
  refraction: "#9575cd",
};

const LAYER_SIZES: Record<string, number> = {
  core: 10,
  context: 6,
  knowledge: 6,
  ephemeral: 4,
};

// ─── Knowledge Clusters ────────────────────────────────────────────────────────
// First match wins. The final entry is the catch-all bucket.

interface ClusterDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  match: (id: string, nodeType: string) => boolean;
}

const CLUSTER_DEFS: ClusterDef[] = [
  { id: "you", name: "You", icon: "👤", color: "#f48fb1", match: (id, t) => id.startsWith("user-") || t === "personal" },
  { id: "prismos", name: "PrismOS", icon: "🔮", color: "#64b5f6", match: (id) => id.startsWith("pos-") || id === "proj-prismos" },
  { id: "projects", name: "Projects", icon: "🗂️", color: "#4fc3f7", match: (id, t) => id.startsWith("proj-") || id.startsWith("project-") || t === "project" || t === "project_chunk" },
  { id: "research", name: "Research (web)", icon: "🌐", color: "#ff8f6b", match: (id, t) => id.startsWith("research-") || t === "research" },
  { id: "chats", name: "Chats", icon: "💬", color: "#78909c", match: (_id, t) => t === "conversation" },
  { id: "documents", name: "Documents", icon: "📄", color: "#aed581", match: (_id, t) => t === "document" || t === "doc_chunk" },
  { id: "insights", name: "Insights", icon: "✨", color: "#ce93d8", match: (_id, t) => ["suggestion", "drift_pattern", "thought_current", "refraction", "meta"].includes(t) },
  { id: "knowledge", name: "Knowledge", icon: "🧠", color: "#81c784", match: () => true },
];

function clusterOf(id: string, nodeType: string): ClusterDef {
  return CLUSTER_DEFS.find((c) => c.match(id, nodeType)) ?? CLUSTER_DEFS[CLUSTER_DEFS.length - 1];
}

// Versioned so older "expand all" state cannot reopen a large graph as an
// unreadable cloud after this overview-first redesign.
const EXPANDED_STORE_KEY = "prismos-graph-expanded-v2";
const MAX_VISIBLE_CLUSTER_MEMBERS = 120;

// ─── Force Graph Data Types ────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  node_type: string;
  layer: string;
  access_count: number;
  content: string;
  last_accessed: string;
  created_at: string;
  updated_at: string;
  connections: string[];
  color: string;
  val: number;
  cluster: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  // Cluster-hub extras
  isHub?: boolean;
  count?: number;
  icon?: string;
  isOverflow?: boolean;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  weight: number;
  momentum: number;
  edge_id: string;
  reinforcements: number;
  last_reinforced: string | null;
  created_at: string | null;
  predicted?: boolean;
  aggregated?: number; // >1 when this link bundles many collapsed connections
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const linkEndId = (end: GraphLink["source"]): string =>
  typeof end === "string" ? end : (end as unknown as GraphNode).id;

function nodeOrigin(node: GraphNode): string {
  if (node.cluster === "projects") return "Local, explicitly indexed project knowledge";
  if (node.cluster === "research") return "Consented web research; untrusted until verified";
  if (node.cluster === "chats") return "Local conversation memory saved by PrismOS";
  if (node.cluster === "insights") return "Derived graph suggestion or pattern; not source evidence";
  if (node.cluster === "you") return "Local personal memory; scoped to explicit profile requests";
  if (node.cluster === "prismos") return "PrismOS system knowledge";
  if (node.cluster === "documents") return "Local document knowledge";
  return "Local knowledge graph memory";
}

function nodeUsage(node: GraphNode): string {
  if (node.node_type === "project_chunk") {
    return "Eligible when you explicitly ask about the related project or knowledge base.";
  }
  if (node.cluster === "research") {
    return "Can support a response only as reference context; important claims still require verification.";
  }
  if (node.cluster === "insights") {
    return "May prompt a suggestion, but should not be treated as factual evidence.";
  }
  if (node.cluster === "you") {
    return "Eligible for explicit identity, preference, or personal-profile requests.";
  }
  return "May be retrieved when its text and stored relationships match your request.";
}

function formatGraphDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface SpectrumGraphViewProps {
  refreshKey?: number;
  lastAnswerTrace?: GraphAnswerTrace | null;
}

export default function SpectrumGraphView({ refreshKey, lastAnswerTrace }: SpectrumGraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [metrics, setMetrics] = useState<GraphMetrics | null>(null);
  const [viewMetadata, setViewMetadata] = useState<GraphViewMetadata | null>(null);
  const [anticipations, setAnticipations] = useState<AnticipatedNeed[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [traceLastAnswer, setTraceLastAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const didInitialFit = useRef(false);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  // Glow phase is animated in a ref + throttled tick (~10 fps) to avoid
  // pegging the JS thread by re-rendering the entire force-graph every
  // animation frame (was ~60 fps → 100% CPU + frozen UI).
  const glowRef = useRef<number>(0);
  const [glowTick, setGlowTick] = useState(0);
  const [recentEdges, setRecentEdges] = useState<Set<string>>(new Set());
  const [predictions, setPredictions] = useState<PredictedEdge[]>([]);
  const [showIntro, setShowIntro] = useState(
    () => !localStorage.getItem("prismos-graph-intro-seen")
  );
  // Which clusters are expanded. Default: all collapsed → a calm, readable
  // constellation of hubs. Persisted so the view reopens the way you left it.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(EXPANDED_STORE_KEY);
      return new Set<string>(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  const persistExpanded = useCallback((next: Set<string>) => {
    setExpanded(next);
    try {
      localStorage.setItem(EXPANDED_STORE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage full/unavailable — view still works */
    }
  }, []);

  // Animate only when a visible edge needs it, and respect reduced motion.
  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hasAnimatedEdge = recentEdges.size > 0 || graphData.links.some((link) => link.momentum > 0.1);
    if (reducedMotion || !hasAnimatedEdge) return;
    const iv = setInterval(() => {
      glowRef.current += 0.18;
      setGlowTick((t) => (t + 1) % 1_000_000);
    }, 100);
    return () => clearInterval(iv);
  }, [recentEdges, graphData.links]);

  // ─── Load full graph snapshot ──────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<string>("get_spectrum_graph");
      const snapshot: GraphSnapshot = JSON.parse(result);

      const nodes: GraphNode[] = snapshot.nodes.map((n: SpectrumNode) => {
        const cluster = clusterOf(n.id, n.node_type);
        return {
          id: n.id,
          label: n.label,
          node_type: n.node_type,
          layer: n.layer || "context",
          access_count: n.access_count || 0,
          content: n.content,
          last_accessed: n.last_accessed || "",
          created_at: n.created_at || "",
          updated_at: n.updated_at || "",
          connections: n.connections || [],
          // Color now means one thing everywhere: knowledge family. Shape and
          // border carry node kind and lifecycle so color is never the only cue.
          color: cluster.color || FACET_COLORS[n.node_type] || "#b0bec5",
          val: LAYER_SIZES[n.layer || "context"] || 6,
          cluster: cluster.id,
        };
      });

      const nodeIds = new Set(nodes.map((n) => n.id));
      const links: GraphLink[] = snapshot.edges
        .filter((e: SpectrumEdge) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
        .map((e: SpectrumEdge) => ({
          source: e.source_id,
          target: e.target_id,
          relation: e.relation,
          weight: e.weight,
          momentum: e.momentum || 0,
          edge_id: e.id,
          reinforcements: e.reinforcements || 0,
          last_reinforced: e.last_reinforced || null,
          created_at: e.created_at || null,
        }));

      // Compute recently strengthened edges (reinforced within last 5 minutes)
      const recentCutoff = Date.now() - 5 * 60 * 1000;
      const recent = new Set<string>();
      for (const link of links) {
        if (link.reinforcements > 0 && link.last_reinforced) {
          const ts = new Date(link.last_reinforced).getTime();
          if (ts > recentCutoff) recent.add(link.edge_id);
        }
      }
      setRecentEdges(recent);

      setGraphData({ nodes, links });
      setMetrics(snapshot.stats);
      setViewMetadata(snapshot.view ?? null);
    } catch (e) {
      console.error("Failed to load spectrum graph:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Load anticipatory needs ───────────────────────────────────────────

  const loadAnticipations = useCallback(async () => {
    try {
      const result = await invoke<string>("anticipate_needs");
      setAnticipations(JSON.parse(result));
    } catch (e) {
      console.error("Failed to load anticipations:", e);
    }
  }, []);

  // ─── Load heuristic candidate links (legacy prediction API) ────────────

  const loadPredictions = useCallback(async () => {
    try {
      const result = await invoke<string>("predict_edges", { limit: 10 });
      setPredictions(JSON.parse(result));
    } catch (e) {
      console.error("Failed to load edge predictions:", e);
    }
  }, []);

  const confirmPrediction = useCallback(async (sourceId: string, targetId: string) => {
    try {
      await invoke("confirm_predicted_edge", { sourceId, targetId });
      loadGraph();
      loadPredictions();
    } catch (e) {
      console.error("Failed to confirm predicted edge:", e);
    }
  }, [loadGraph, loadPredictions]);

  const dismissPrediction = useCallback(async (sourceId: string, targetId: string) => {
    try {
      await invoke("dismiss_predicted_edge", { sourceId, targetId });
      loadPredictions();
    } catch (e) {
      console.error("Failed to dismiss predicted edge:", e);
    }
  }, [loadPredictions]);

  useEffect(() => {
    loadGraph();
    loadAnticipations();
    loadPredictions();
  }, [loadGraph, loadAnticipations, loadPredictions, refreshKey]);

  // ─── Resize handling (measure canvas area, not full container) ────────

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      setDimensions({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // ─── Cluster membership & displayed (collapsed/expanded) graph ────────

  const clusterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graphData.nodes) {
      counts.set(n.cluster, (counts.get(n.cluster) ?? 0) + 1);
    }
    return counts;
  }, [graphData.nodes]);

  const activeClusters = useMemo(
    () => CLUSTER_DEFS.filter((c) => (clusterCounts.get(c.id) ?? 0) > 0),
    [clusterCounts]
  );

  const nodeById = useMemo(
    () => new Map(graphData.nodes.map((node) => [node.id, node])),
    [graphData.nodes]
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!normalizedSearch) return [];
    return graphData.nodes
      .filter((node) =>
        `${node.label}\n${node.node_type}\n${node.content}`.toLowerCase().includes(normalizedSearch)
      )
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(normalizedSearch) ? 1 : 0;
        const bStarts = b.label.toLowerCase().startsWith(normalizedSearch) ? 1 : 0;
        return bStarts - aStarts || b.connections.length - a.connections.length || b.access_count - a.access_count;
      });
  }, [graphData.nodes, normalizedSearch]);

  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((node) => node.id)),
    [searchMatches]
  );

  const answerTraceIds = useMemo(
    () => new Set(lastAnswerTrace?.context_node_ids ?? []),
    [lastAnswerTrace]
  );

  const answerReinforcedEdgeIds = useMemo(
    () => new Set(lastAnswerTrace?.reinforced_edge_ids ?? []),
    [lastAnswerTrace]
  );

  const answerTraceOrder = useMemo(
    () => new Map((lastAnswerTrace?.context_node_ids ?? []).map((id, index) => [id, index + 1])),
    [lastAnswerTrace]
  );

  const effectiveExpanded = useMemo(() => {
    if (traceLastAnswer && answerTraceIds.size > 0) {
      return new Set(
        graphData.nodes
          .filter((node) => answerTraceIds.has(node.id))
          .map((node) => node.cluster)
      );
    }
    if (normalizedSearch) {
      return new Set(searchMatches.map((node) => node.cluster));
    }
    return expanded;
  }, [traceLastAnswer, answerTraceIds, graphData.nodes, normalizedSearch, searchMatches, expanded]);

  const displayed: GraphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const visibleMemberIds = new Set<string>();

    // Hub bubble per collapsed cluster; member nodes for expanded clusters.
    for (const c of activeClusters) {
      const count = clusterCounts.get(c.id) ?? 0;
      if (!effectiveExpanded.has(c.id)) {
        nodes.push({
          id: `cluster:${c.id}`,
          label: c.name,
          node_type: "cluster",
          layer: "core",
          access_count: 0,
          content: `${count} items`,
          last_accessed: "",
          created_at: "",
          updated_at: "",
          connections: [],
          color: c.color,
          val: 14 + Math.sqrt(count) * 3,
          cluster: c.id,
          isHub: true,
          count,
          icon: c.icon,
        });
        continue;
      }

      const members = graphData.nodes
        .filter((node) => node.cluster === c.id)
        .sort((a, b) => {
          const aPriority = (selectedNode?.id === a.id ? 8 : 0) + (answerTraceIds.has(a.id) ? 4 : 0) + (searchMatchIds.has(a.id) ? 2 : 0);
          const bPriority = (selectedNode?.id === b.id ? 8 : 0) + (answerTraceIds.has(b.id) ? 4 : 0) + (searchMatchIds.has(b.id) ? 2 : 0);
          return bPriority - aPriority || b.connections.length - a.connections.length || b.access_count - a.access_count || b.updated_at.localeCompare(a.updated_at);
        });
      const visibleMembers = members.slice(0, MAX_VISIBLE_CLUSTER_MEMBERS);
      for (const member of visibleMembers) {
        nodes.push(member);
        visibleMemberIds.add(member.id);
      }
      const hiddenCount = members.length - visibleMembers.length;
      if (hiddenCount > 0) {
        nodes.push({
          id: `cluster:${c.id}:more`,
          label: `${hiddenCount} more`,
          node_type: "cluster_overflow",
          layer: "context",
          access_count: 0,
          content: `Use search to reveal any of the ${hiddenCount} additional ${c.name.toLowerCase()} items.`,
          last_accessed: "",
          created_at: "",
          updated_at: "",
          connections: [],
          color: c.color,
          val: 11 + Math.sqrt(hiddenCount),
          cluster: c.id,
          isHub: true,
          isOverflow: true,
          count: hiddenCount,
          icon: "＋",
        });
      }
    }

    // Remap links to whichever endpoint is displayed (member or its hub),
    // bundling everything that lands on the same displayed pair.
    const displayId = (rawId: string): string => {
      const n = nodeById.get(rawId);
      if (!n) return rawId;
      if (!effectiveExpanded.has(n.cluster)) return `cluster:${n.cluster}`;
      return visibleMemberIds.has(n.id) ? n.id : `cluster:${n.cluster}:more`;
    };

    const allRaw: GraphLink[] = [
      ...graphData.links,
      ...predictions
        .filter((p) => nodeById.has(p.source_id) && nodeById.has(p.target_id))
        .map((p) => ({
          source: p.source_id,
          target: p.target_id,
          relation: p.reason,
          weight: p.probability,
          momentum: 0,
          edge_id: `predicted-${p.source_id}-${p.target_id}`,
          reinforcements: 0,
          last_reinforced: null,
          created_at: null,
          predicted: true,
        })),
    ];

    const bundled = new Map<string, GraphLink>();
    for (const l of allRaw) {
      const s = displayId(linkEndId(l.source));
      const t = displayId(linkEndId(l.target));
      if (s === t) continue; // interior to a collapsed cluster
      const bothMembers = !s.startsWith("cluster:") && !t.startsWith("cluster:");
      if (bothMembers) {
        // Real edge between two visible nodes — keep it intact (reinforce
        // buttons, glow, prophecy dashes all rely on the real edge identity).
        bundled.set(l.edge_id, { ...l, source: s, target: t });
        continue;
      }
      const key = s < t ? `${s}→${t}` : `${t}→${s}`;
      const prev = bundled.get(key);
      if (prev) {
        prev.aggregated = (prev.aggregated ?? 1) + 1;
        prev.weight = Math.max(prev.weight, l.weight);
        prev.momentum = Math.max(prev.momentum, l.momentum);
        prev.relation = `${prev.aggregated} connections`;
        prev.predicted = prev.predicted && l.predicted;
      } else {
        bundled.set(key, {
          ...l,
          source: s,
          target: t,
          edge_id: `agg:${key}`,
          relation: l.predicted ? l.relation : "1 connection",
          aggregated: 1,
        });
      }
    }

    return { nodes, links: [...bundled.values()] };
  }, [
    graphData,
    predictions,
    effectiveExpanded,
    activeClusters,
    clusterCounts,
    nodeById,
    selectedNode,
    answerTraceIds,
    searchMatchIds,
  ]);

  // ─── Focus set: selected member + its displayed neighbors ─────────────

  const focusIds = useMemo(() => {
    if (traceLastAnswer && answerTraceIds.size > 0) return answerTraceIds;
    if ((!selectedNode || selectedNode.isHub) && searchMatchIds.size > 0) return searchMatchIds;
    if (!selectedNode || selectedNode.isHub) return null;
    const set = new Set<string>([selectedNode.id]);
    for (const l of displayed.links) {
      const s = linkEndId(l.source);
      const t = linkEndId(l.target);
      if (s === selectedNode.id) set.add(t);
      if (t === selectedNode.id) set.add(s);
    }
    return set;
  }, [traceLastAnswer, answerTraceIds, searchMatchIds, selectedNode, displayed.links]);

  const selectedConnections = useMemo(() => {
    if (!selectedNode || selectedNode.isHub) return [];
    return graphData.links
      .filter((link) => {
        const sourceId = linkEndId(link.source);
        const targetId = linkEndId(link.target);
        return sourceId === selectedNode.id || targetId === selectedNode.id;
      })
      .map((link) => {
        const sourceId = linkEndId(link.source);
        const outgoing = sourceId === selectedNode.id;
        const neighborId = outgoing ? linkEndId(link.target) : sourceId;
        return { link, outgoing, neighbor: nodeById.get(neighborId) ?? null };
      })
      .filter((item): item is { link: GraphLink; outgoing: boolean; neighbor: GraphNode } => item.neighbor !== null)
      .sort((a, b) => b.link.weight - a.link.weight || b.link.reinforcements - a.link.reinforcements);
  }, [selectedNode, graphData.links, nodeById]);

  const answerTraceNodes = useMemo(
    () => (lastAnswerTrace?.context_node_ids ?? [])
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node)),
    [lastAnswerTrace, nodeById]
  );

  // ─── Layout forces: cluster anchors + collision (no overlap) ───────────

  const anchors = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const n = activeClusters.length || 1;
    // Push cluster centres further apart so knowledge / chat / project each get
    // their own island instead of piling into one blob.
    const radius = n <= 2 ? 240 : 200 + n * 58;
    activeClusters.forEach((c, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      map.set(c.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    return map;
  }, [activeClusters]);

  const nodeRadius = (n: GraphNode) => (n.isHub ? n.val : (n.val || 6)) as number;

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || displayed.nodes.length === 0) return;

    // Pull every node gently toward its cluster's anchor — hubs harder, so
    // collapsed bubbles sit in a clean ring; members swarm their own anchor.
    const clusterForce = () => {
      let nodes: GraphNode[] = [];
      const force = (alpha: number) => {
        for (const node of nodes) {
          const a = anchors.get(node.cluster);
          if (!a) continue;
          // Hold members near their own cluster so stronger repulsion spreads
          // them WITHIN the island instead of scattering across other clusters.
          const k = (node.isHub ? 0.3 : 0.12) * alpha;
          node.vx = (node.vx ?? 0) + (a.x - (node.x ?? 0)) * k;
          node.vy = (node.vy ?? 0) + (a.y - (node.y ?? 0)) * k;
        }
      };
      force.initialize = (ns: GraphNode[]) => {
        nodes = ns;
      };
      return force;
    };

    // Pairwise collision keeps circles (and their labels) from stacking.
    // O(n²) per tick is fine at this graph's scale (≤ a few hundred shown).
    const collideForce = () => {
      let nodes: GraphNode[] = [];
      const force = () => {
        const pad = 16;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const dx = (b.x ?? 0) - (a.x ?? 0);
            const dy = (b.y ?? 0) - (a.y ?? 0);
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const min = nodeRadius(a) + nodeRadius(b) + pad;
            if (dist < min) {
              const push = ((min - dist) / dist) * 0.5;
              const px = dx * push;
              const py = dy * push;
              a.x = (a.x ?? 0) - px * 0.5;
              a.y = (a.y ?? 0) - py * 0.5;
              b.x = (b.x ?? 0) + px * 0.5;
              b.y = (b.y ?? 0) + py * 0.5;
            }
          }
        }
      };
      force.initialize = (ns: GraphNode[]) => {
        nodes = ns;
      };
      return force;
    };

    fg.d3Force("center", null);
    fg.d3Force("cluster", clusterForce());
    fg.d3Force("collide", collideForce());
    const charge = fg.d3Force("charge");
    // Stronger repulsion opens the blob into a legible web; distanceMax stops far
    // nodes from flinging apart so the graph stays framed and calm.
    if (charge?.strength) charge.strength(-120);
    if (charge?.distanceMax) charge.distanceMax(440);
    const link = fg.d3Force("link");
    if (link?.distance) {
      link.distance((l: GraphLink) => {
        const s = linkEndId(l.source);
        const t = linkEndId(l.target);
        const sn = displayed.nodes.find((n) => n.id === s);
        const tn = displayed.nodes.find((n) => n.id === t);
        return sn && tn && sn.cluster === tn.cluster ? 70 : 210;
      });
    }
    // Gentle links let repulsion do the spreading instead of yanking nodes tight.
    if (link?.strength) link.strength(0.14);
    fg.d3ReheatSimulation();
  }, [displayed, anchors]);

  const fitView = useCallback((ms = 500) => {
    fgRef.current?.zoomToFit(ms, 70);
  }, []);

  // First layout settle → frame everything once.
  const handleEngineStop = useCallback(() => {
    if (!didInitialFit.current) {
      didInitialFit.current = true;
      fitView(600);
    }
  }, [fitView]);

  // ─── Expand / collapse ─────────────────────────────────────────────────

  const toggleCluster = useCallback(
    (clusterId: string) => {
      setSearchQuery("");
      setTraceLastAnswer(false);
      const next = new Set<string>();
      if (expanded.has(clusterId)) {
        if (selectedNode && !selectedNode.isHub && selectedNode.cluster === clusterId) {
          setSelectedNode(null);
        }
      } else {
        next.add(clusterId);
      }
      persistExpanded(next);
      setTimeout(() => fitView(500), 350);
    },
    [expanded, persistExpanded, selectedNode, fitView]
  );

  const collapseAll = useCallback(() => {
    persistExpanded(new Set());
    setSelectedNode(null);
    setSearchQuery("");
    setTraceLastAnswer(false);
    setTimeout(() => fitView(500), 350);
  }, [persistExpanded, fitView]);

  const revealNode = useCallback((node: GraphNode) => {
    persistExpanded(new Set([node.cluster]));
    setSearchQuery("");
    setTraceLastAnswer(false);
    setSelectedNode(node);
    setTimeout(() => {
      if (typeof node.x === "number" && typeof node.y === "number") {
        fgRef.current?.centerAt(node.x, node.y, 450);
      } else {
        fitView(450);
      }
    }, 300);
  }, [persistExpanded, fitView]);

  // ─── Node click: hubs expand, members focus ────────────────────────────

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.isHub) {
        if (node.isOverflow) return;
        toggleCluster(node.cluster);
        return;
      }
      revealNode(node);
    },
    [toggleCluster, revealNode]
  );

  const handleBackgroundClick = useCallback(() => setSelectedNode(null), []);

  // ─── Reinforce edge (closed-loop feedback from UI) ────────────────────

  const reinforceEdge = useCallback(
    async (edgeId: string, signal: number) => {
      try {
        await invoke("update_edge_weight", {
          edgeId,
          feedbackSignal: signal,
        });
        loadGraph(); // Refresh
      } catch (e) {
        console.error("Failed to reinforce edge:", e);
      }
    },
    [loadGraph]
  );

  // ─── Custom node rendering ────────────────────────────────────────────

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const dimmed = focusIds ? !focusIds.has(node.id) && !node.isHub : false;
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.14;

      if (node.isHub) {
        // ── Cluster hub bubble ──
        const r = node.val;
        const grad = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        grad.addColorStop(0, node.color);
        grad.addColorStop(1, node.color + "55");
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();

        // Icon + name + count — hubs are the map's landmarks, always labeled.
        const iconSize = Math.max(10, r * 0.9);
        ctx.font = `${iconSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.icon ?? "●", x, y);

        const nameSize = Math.max(4, 13 / globalScale);
        ctx.font = `600 ${nameSize}px Inter, sans-serif`;
        const name = node.label;
        const countText = `${node.count}`;
        const nameW = ctx.measureText(name).width;
        const labelY = y + r + 4 / globalScale;
        ctx.fillStyle = "rgba(8,10,16,0.72)";
        const padX = 5 / globalScale;
        const lineH = nameSize * 1.25;
        ctx.beginPath();
        ctx.roundRect(x - nameW / 2 - padX, labelY, nameW + padX * 2, lineH * 2, 4 / globalScale);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.textBaseline = "top";
        ctx.fillText(name, x, labelY + lineH * 0.12);
        ctx.font = `${nameSize * 0.85}px Inter, sans-serif`;
        ctx.fillStyle = node.color;
        ctx.fillText(`${countText} items`, x, labelY + lineH);
        ctx.restore();
        return;
      }

      // ── Member node ── color = family, shape = kind, border = lifecycle.
      const nodeSize = (node.val || 6) / Math.max(globalScale * 0.55, 1);
      const beginMemberPath = () => {
        ctx.beginPath();
        if (node.cluster === "research") {
          ctx.moveTo(x, y - nodeSize * 1.25);
          ctx.lineTo(x + nodeSize * 1.05, y);
          ctx.lineTo(x, y + nodeSize * 1.25);
          ctx.lineTo(x - nodeSize * 1.05, y);
          ctx.closePath();
        } else if (node.cluster === "projects" || node.cluster === "documents") {
          ctx.roundRect(x - nodeSize, y - nodeSize, nodeSize * 2, nodeSize * 2, nodeSize * 0.3);
        } else if (node.cluster === "chats") {
          ctx.roundRect(x - nodeSize * 1.15, y - nodeSize * 0.85, nodeSize * 2.3, nodeSize * 1.7, nodeSize * 0.65);
        } else if (node.cluster === "insights" || node.node_type === "entity") {
          for (let i = 0; i < 6; i += 1) {
            const angle = Math.PI / 3 * i - Math.PI / 2;
            const px = x + Math.cos(angle) * nodeSize * 1.12;
            const py = y + Math.sin(angle) * nodeSize * 1.12;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else {
          ctx.arc(x, y, nodeSize, 0, 2 * Math.PI);
        }
      };

      ctx.shadowColor = node.color;
      ctx.shadowBlur = 8 / globalScale;
      beginMemberPath();
      ctx.fillStyle = node.color;
      const previousAlpha = ctx.globalAlpha;
      if (node.layer === "ephemeral") ctx.globalAlpha *= 0.48;
      else if (node.layer === "knowledge") ctx.globalAlpha *= 0.82;
      ctx.fill();
      ctx.globalAlpha = previousAlpha;
      ctx.shadowBlur = 0; // keep the rings/labels below crisp

      beginMemberPath();
      ctx.strokeStyle = node.layer === "ephemeral" ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.28)";
      ctx.lineWidth = (node.layer === "core" ? 1.8 : 1) / globalScale;
      if (node.layer === "ephemeral") ctx.setLineDash([1.5 / globalScale, 2.5 / globalScale]);
      else if (node.layer === "knowledge") ctx.setLineDash([4 / globalScale, 2 / globalScale]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (node.layer === "core") {
        ctx.beginPath();
        ctx.arc(x, y, nodeSize + 2.4 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      // Highlight selected
      if (selectedNode?.id === node.id) {
        beginMemberPath();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Access count ring (closed-loop feedback indicator)
      if (node.access_count > 3) {
        ctx.beginPath();
        ctx.arc(x, y, nodeSize + 2 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      const traceStep = traceLastAnswer ? answerTraceOrder.get(node.id) : undefined;
      if (traceStep !== undefined) {
        const badgeRadius = 4.8 / globalScale;
        const badgeX = x + nodeSize * 0.85;
        const badgeY = y - nodeSize * 0.85;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = "#f8fafc";
        ctx.fill();
        ctx.fillStyle = "#0b1220";
        ctx.font = `700 ${Math.max(3, 7 / globalScale)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(traceStep), badgeX, badgeY);
      }

      // Label only when it can actually be read — this is what kills the pile-up:
      //  • always for hovered / focused / selected nodes,
      //  • at deep zoom (>3.2) show everything in view,
      //  • at mid zoom (>1.9) show only "significant" nodes (bigger or well-used),
      // so a normal view stays a clean web and detail reveals as you lean in.
      const inFocus = focusIds?.has(node.id) ?? false;
      const isHovered = hoverNode?.id === node.id;
      const significant = (node.val ?? 6) > 7 || node.access_count > 3;
      const showLabel =
        !dimmed &&
        (isHovered ||
          inFocus ||
          selectedNode?.id === node.id ||
          globalScale > 3.2 ||
          (globalScale > 1.9 && significant));
      if (showLabel) {
        const fontSize = Math.max(3.5, 11 / globalScale);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        const text = node.label.length > 26 ? node.label.slice(0, 26) + "…" : node.label;
        const w = ctx.measureText(text).width;
        const ly = y + nodeSize + 2.5 / globalScale;
        ctx.fillStyle = "rgba(8,10,16,0.82)";
        ctx.beginPath();
        ctx.roundRect(x - w / 2 - 3 / globalScale, ly, w + 6 / globalScale, fontSize * 1.35, 3 / globalScale);
        ctx.fill();
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(text, x, ly + fontSize * 0.15);
      }
      ctx.restore();
    },
    [selectedNode, hoverNode, focusIds, traceLastAnswer, answerTraceOrder]
  );

  // ─── Custom link rendering ────────────────────────────────────────────

  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as unknown as { x: number; y: number; id?: string };
      const target = link.target as unknown as { x: number; y: number; id?: string };
      if (!source || !target) return;

      const sx = source.x, sy = source.y, tx = target.x, ty = target.y;
      // Skip until both endpoints have real positions. createLinearGradient()
      // throws on a non-finite coordinate (unlike moveTo/lineTo), so guard it —
      // this is what crashed the view on the first frame / after a data swap.
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
        return;
      }
      const sId = linkEndId(link.source);
      const tId = linkEndId(link.target);

      // ── Curved edge ── the key de-tangler: crossing edges bow apart instead of
      // overlapping into a hairball. Curvature sign is stable per pair so A↔B and
      // B↔A don't sit on top of each other, and it reads as a clean arc to trace.
      const curvature = (sId < tId ? 1 : -1) * 0.16;
      const mx = (sx + tx) / 2, my = (sy + ty) / 2;
      const cx = mx - (ty - sy) * curvature;
      const cy = my + (tx - sx) * curvature;
      const arc = () => {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(cx, cy, tx, ty);
      };

      const dimmed = focusIds ? !(focusIds.has(sId) && focusIds.has(tId)) : false;
      const focused = !dimmed && focusIds ? focusIds.has(sId) && focusIds.has(tId) : false;
      ctx.save();
      ctx.lineCap = "round";
      if (dimmed) ctx.globalAlpha = 0.05;

      // Predicted edges → dashed violet arc.
      if (link.predicted) {
        ctx.setLineDash([7 / globalScale, 5 / globalScale]);
        arc();
        ctx.strokeStyle = "rgba(180, 140, 255, 0.45)";
        ctx.lineWidth = 1.4 / globalScale;
        ctx.stroke();
        ctx.restore();
        return;
      }

      // Bundled hub links: soft gradient arc, width scales with connections carried.
      if ((link.aggregated ?? 0) > 0 && link.edge_id.startsWith("agg:")) {
        const w = Math.min(4, 0.6 + (link.aggregated ?? 1) * 0.25) / globalScale;
        const g = ctx.createLinearGradient(sx, sy, tx, ty);
        g.addColorStop(0, "rgba(150, 170, 210, 0.08)");
        g.addColorStop(1, "rgba(150, 170, 210, 0.30)");
        arc();
        ctx.strokeStyle = g;
        ctx.lineWidth = w;
        ctx.stroke();
        ctx.restore();
        return;
      }

      const width = Math.max(0.5, link.weight * 1.5) / globalScale;

      // Base hue by momentum (blue = strengthening, red = weakening, slate = neutral),
      // drawn as a source→target alpha gradient so flow direction reads without any
      // arrowhead clutter. Brighter when the edge is inside the focused neighborhood.
      let r = 120, g = 135, b = 160;
      if (link.momentum > 0.05) { r = 100; g = 180; b = 255; }
      else if (link.momentum < -0.05) { r = 255; g = 120; b = 120; }
      const aHi = focused ? 0.9 : 0.5;
      const aLo = focused ? 0.3 : 0.1;
      const grad = ctx.createLinearGradient(sx, sy, tx, ty);
      grad.addColorStop(0, `rgba(${r},${g},${b},${aLo})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},${aHi})`);

      // Golden pulse for newly strengthened edges (follows the arc).
      const phase = glowRef.current;
      if (recentEdges.has(link.edge_id)) {
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(phase * 1.5 + link.weight * 3));
        ctx.save();
        ctx.shadowColor = `rgba(255, 200, 60, ${0.6 * pulse})`;
        ctx.shadowBlur = (6 + 4 * pulse) / globalScale;
        arc();
        ctx.strokeStyle = `rgba(255, 210, 80, ${0.4 + 0.25 * pulse})`;
        ctx.lineWidth = width * 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Blue pulse for high-momentum edges (Alive Graph).
      if (link.momentum > 0.1) {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(phase * 2 + link.weight));
        ctx.save();
        ctx.shadowColor = `rgba(100, 200, 255, ${0.8 * pulse})`;
        ctx.shadowBlur = (8 + 6 * pulse) / globalScale;
        arc();
        ctx.strokeStyle = `rgba(120, 200, 255, ${0.5 + 0.3 * pulse})`;
        ctx.lineWidth = width * 1.8;
        ctx.stroke();
        ctx.restore();
      }

      arc();
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.stroke();

      if (traceLastAnswer && answerReinforcedEdgeIds.has(link.edge_id)) {
        arc();
        ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
        ctx.lineWidth = Math.max(width * 1.8, 2 / globalScale);
        ctx.stroke();
      }

      // Direction appears only on a focused trace so the overview stays calm.
      if (focused) {
        const t = 0.72;
        const oneMinusT = 1 - t;
        const px = oneMinusT * oneMinusT * sx + 2 * oneMinusT * t * cx + t * t * tx;
        const py = oneMinusT * oneMinusT * sy + 2 * oneMinusT * t * cy + t * t * ty;
        const dx = 2 * oneMinusT * (cx - sx) + 2 * t * (tx - cx);
        const dy = 2 * oneMinusT * (cy - sy) + 2 * t * (ty - cy);
        const angle = Math.atan2(dy, dx);
        const arrowSize = 4.5 / globalScale;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - Math.cos(angle - Math.PI / 6) * arrowSize, py - Math.sin(angle - Math.PI / 6) * arrowSize);
        ctx.lineTo(px - Math.cos(angle + Math.PI / 6) * arrowSize, py - Math.sin(angle + Math.PI / 6) * arrowSize);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
        ctx.fill();
      }
      ctx.restore();
    },
    [glowTick, recentEdges, focusIds, traceLastAnswer, answerReinforcedEdgeIds]
  );

  // ─── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="spectrum-graph-view">
        <div className="sg-loading">
          <span className="sg-spinner" />
          Loading Spectrum Graph…
        </div>
      </div>
    );
  }

  return (
    <div className="spectrum-graph-view" ref={containerRef}>
      {/* ── Graph Canvas ── */}
      <div className="sg-canvas" ref={canvasRef}>
        {graphData.nodes.length === 0 ? (
          <div className="sg-empty">
            <div className="sg-empty-icon"><img src={prismosLogo} alt="PrismOS-AI" className="sg-empty-logo" /></div>
            <div className="sg-growing-pulse" />
            <h3>🌱 Local memory is ready</h3>
            <p>Successful chats can add local conversation nodes and links. Explicit feedback can adjust which stored context is retrieved later.</p>
            <p className="sg-empty-hint">Try sending an intent like <em>"Summarize my week"</em> to get started.</p>
          </div>
        ) : (
          <>
            <div className="sg-toolbar">
              <div className="sg-search" role="search">
                <span aria-hidden="true">⌕</span>
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setTraceLastAnswer(false);
                    setSelectedNode(null);
                  }}
                  placeholder="Find a node…"
                  aria-label="Search graph nodes"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear graph search">×</button>
                )}
              </div>
              <button className="sg-tool-btn" onClick={collapseAll} title="Return to the labeled cluster map">
                ◉ Overview
              </button>
              <button className="sg-tool-btn" onClick={() => fitView(500)} title="Frame the whole graph">
                ⌖ Fit
              </button>
              {(lastAnswerTrace?.context_node_ids.length ?? 0) > 0 && (
                <button
                  className={`sg-tool-btn sg-trace-btn ${traceLastAnswer ? "active" : ""}`}
                  onClick={() => {
                    setTraceLastAnswer((value) => !value);
                    setSearchQuery("");
                    setSelectedNode(null);
                    setTimeout(() => fitView(450), 250);
                  }}
                  aria-pressed={traceLastAnswer}
                  title="Show the recorded context supplied to the most recent answer"
                >
                  ◎ Trace last answer · {lastAnswerTrace?.context_node_ids.length}
                </button>
              )}
              {selectedNode && !selectedNode.isHub && (
                <button className="sg-tool-btn sg-tool-focus" onClick={() => setSelectedNode(null)} title="Clear focus">
                  ✕ Unfocus
                </button>
              )}
            </div>
            <ForceGraph2D
              ref={fgRef as never}
              graphData={displayed as never}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={paintNode as never}
              nodePointerAreaPaint={((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 4, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }) as never}
              linkCanvasObject={paintLink as never}
              onNodeClick={handleNodeClick as never}
              onNodeHover={((node: GraphNode | null) => setHoverNode(node)) as never}
              onBackgroundClick={handleBackgroundClick}
              onEngineStop={handleEngineStop}
              nodeLabel={(node: GraphNode) =>
                node.isHub
                  ? node.isOverflow
                    ? `${node.label}\nUse search to reveal a specific item.`
                    : `${node.icon} ${node.label} — ${node.count} items\nClick to ${effectiveExpanded.has(node.cluster) ? "collapse" : "explore"}`
                  : `${node.label}\n${clusterOf(node.id, node.node_type).name} · ${node.node_type} · ${node.layer}\n${nodeOrigin(node)}\nUsed ${node.access_count} times`
              }
              linkLabel={(link: GraphLink) =>
                link.edge_id.startsWith("agg:")
                  ? `${link.aggregated} connection${(link.aggregated ?? 1) > 1 ? "s" : ""} between groups`
                  : `${nodeById.get(linkEndId(link.source))?.label ?? "Node"} → ${link.relation} → ${nodeById.get(linkEndId(link.target))?.label ?? "Node"}\nStrength ${link.weight.toFixed(2)} · trend ${link.momentum.toFixed(2)}`
              }
              cooldownTicks={220}
              warmupTicks={60}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              linkDirectionalArrowLength={0}
              backgroundColor="transparent"
            />
          </>
        )}
      </div>

      {/* ── Metrics Bar ── */}
      {metrics && (
        <div className="sg-metrics-bar">
          <span className="sg-metric">
            <strong>{metrics.node_count}</strong> shown nodes
          </span>
          <span className="sg-metric">
            <strong>{metrics.edge_count}</strong> edges
          </span>
          <span className="sg-metric">
            avg strength: <strong>{metrics.avg_edge_weight.toFixed(2)}</strong>
          </span>
          <span className="sg-metric">
            density: <strong>{(metrics.graph_density * 100).toFixed(1)}%</strong>
          </span>
          {metrics.most_connected_node && (
            <span className="sg-metric">
              hub: <strong>{metrics.most_connected_node}</strong>
            </span>
          )}
          {viewMetadata && viewMetadata.summarized_suggestion_count > 0 && (
            <span className="sg-metric sg-metric-summary" title="Generated suggestion cards are summarized so they cannot crowd durable knowledge out of the map.">
              <strong>{viewMetadata.summarized_suggestion_count}</strong> suggestions summarized
            </span>
          )}
          {viewMetadata && viewMetadata.omitted_due_to_limit > 0 && (
            <span className="sg-metric sg-metric-summary">
              <strong>{viewMetadata.omitted_due_to_limit}</strong> more available by search
            </span>
          )}
          <button className="sg-refresh-btn" onClick={loadGraph}>
            ↻ Refresh
          </button>
        </div>
      )}

      {/* ── Graph Intro Overlay ── */}
      {showIntro && graphData.nodes.length > 0 && (
        <div className="sg-intro-overlay" role="dialog" aria-modal="true" aria-labelledby="sg-intro-title">
          <div className="sg-intro-card">
            <h3 id="sg-intro-title">🌈 Your memory map</h3>
            <p>Start with labeled families, then open one family and follow a selected node’s named connections.</p>
            <ul>
              <li><strong>Color</strong> = knowledge family</li>
              <li><strong>Shape</strong> = memory kind; <strong>border</strong> = lifecycle</li>
              <li><strong>Click a node</strong> = lock its one-hop trace and inspect named relations</li>
              <li><strong>Trace last answer</strong> = context PrismOS recorded as supplied—not hidden reasoning</li>
            </ul>
            <button className="sg-intro-dismiss" onClick={() => { localStorage.setItem("prismos-graph-intro-seen", "1"); setShowIntro(false); }}>
              Got it! →
            </button>
          </div>
        </div>
      )}

      {/* ── Side Panel ── */}
      <div className="sg-side-panel">
        <section className="sg-map-summary" aria-labelledby="sg-map-title">
          <div className="sg-panel-eyebrow">LOCAL MEMORY MAP</div>
          <h3 id="sg-map-title">Know where everything lives</h3>
          <p>{metrics?.node_count ?? graphData.nodes.length} meaningful nodes are shown as labeled families. Generated suggestion history is summarized, not mixed into durable knowledge.</p>
          <details className="sg-how-to-read">
            <summary>How to read this graph</summary>
            <div className="sg-visual-key">
              <div><span className="sg-key-symbol sg-key-color" /> <strong>Color</strong><span>knowledge family</span></div>
              <div><span className="sg-key-symbol sg-key-shape" /> <strong>Shape</strong><span>memory kind</span></div>
              <div><span className="sg-key-symbol sg-key-ring" /> <strong>Border</strong><span>core, context, knowledge, or ephemeral lifecycle</span></div>
              <div><span className="sg-key-symbol sg-key-line" /> <strong>Line</strong><span>stored relationship; width is strength</span></div>
              <div><span className="sg-key-symbol sg-key-dash" /> <strong>Dashed</strong><span>unconfirmed candidate link</span></div>
              <div><span className="sg-key-symbol sg-key-gold" /> <strong>Gold</strong><span>memory changed by the traced answer</span></div>
            </div>
            <p className="sg-safety-note">Trace shows recorded context and relationship changes. It does not expose private model chain-of-thought.</p>
          </details>
        </section>

        {normalizedSearch && (
          <section className="sg-search-results" aria-live="polite" aria-label="Graph search results">
            <div className="sg-section-heading">
              <h4>Search results</h4>
              <span>{searchMatches.length}</span>
            </div>
            {searchMatches.length === 0 ? (
              <p className="sg-panel-empty">No local nodes match “{searchQuery.trim()}”.</p>
            ) : (
              searchMatches.slice(0, 12).map((node) => (
                <button key={node.id} className="sg-node-result" onClick={() => revealNode(node)}>
                  <span className="sg-dot" style={{ background: node.color }} />
                  <span className="sg-node-result-copy">
                    <strong>{node.label}</strong>
                    <small>{clusterOf(node.id, node.node_type).name} · {node.node_type}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))
            )}
            {searchMatches.length > 12 && <p className="sg-panel-footnote">Showing the 12 strongest matches. Refine the search to narrow it.</p>}
          </section>
        )}

        {traceLastAnswer && lastAnswerTrace && (
          <section className="sg-answer-trace" aria-labelledby="sg-answer-trace-title">
            <div className="sg-section-heading">
              <h4 id="sg-answer-trace-title">◎ Last answer trace</h4>
              <span className={lastAnswerTrace.validated ? "sg-trace-status valid" : "sg-trace-status limited"}>
                {lastAnswerTrace.validated ? "validated" : "not released"}
              </span>
            </div>
            <p>Context recorded as supplied to the response, in retrieval order.</p>
            <ol className="sg-trace-list">
              {answerTraceNodes.map((node) => (
                <li key={node.id}>
                  <button onClick={() => setSelectedNode(node)}>
                    <span className="sg-dot" style={{ background: node.color }} />
                    <span>{node.label}</span>
                  </button>
                </li>
              ))}
            </ol>
            {answerTraceNodes.length < lastAnswerTrace.context_node_ids.length && (
              <p className="sg-panel-footnote">{lastAnswerTrace.context_node_ids.length - answerTraceNodes.length} recorded context node(s) are outside this bounded map snapshot.</p>
            )}
            <div className="sg-trace-change-count">
              <strong>{lastAnswerTrace.reinforced_edge_ids.length}</strong> recorded relationship changes
            </div>
            <p className="sg-safety-note">This is an audit trail of inputs and memory changes—not the model’s hidden reasoning.</p>
          </section>
        )}

        {/* Selected Node Detail */}
        {selectedNode && !selectedNode.isHub && (
          <div className="sg-node-detail">
            <h4>
              <span
                className="sg-dot"
                style={{ background: selectedNode.color }}
              />
              {selectedNode.label}
            </h4>
            <div className="sg-detail-meta">
              <span className="sg-tag">{clusterOf(selectedNode.id, selectedNode.node_type).name}</span>
              <span className="sg-tag">{selectedNode.node_type}</span>
              <span className="sg-tag">{selectedNode.layer}</span>
              <span className="sg-tag">used {selectedNode.access_count}×</span>
            </div>
            <div className="sg-provenance-block">
              <span>ORIGIN</span>
              <strong>{nodeOrigin(selectedNode)}</strong>
            </div>
            <div className="sg-provenance-block">
              <span>HOW PRISMOS MAY USE IT</span>
              <strong>{nodeUsage(selectedNode)}</strong>
            </div>
            <dl className="sg-node-timestamps">
              <div><dt>Updated</dt><dd>{formatGraphDate(selectedNode.updated_at)}</dd></div>
              <div><dt>Last used</dt><dd>{formatGraphDate(selectedNode.last_accessed)}</dd></div>
            </dl>
            <details className="sg-content-reveal">
              <summary>Reveal stored content</summary>
              <p className="sg-detail-content">{selectedNode.content}</p>
            </details>

            {/* Show connected edges with reinforce buttons */}
            <div className="sg-connected-edges">
              <div className="sg-section-heading">
                <h5>Connections</h5>
                <span>{selectedConnections.length}</span>
              </div>
              {selectedConnections.length === 0 && (
                <p className="sg-panel-empty">No stored relationships for this node yet.</p>
              )}
              {selectedConnections.slice(0, 12).map(({ link, outgoing, neighbor }) => (
                  <div key={link.edge_id} className="sg-edge-item">
                    <button className="sg-edge-path" onClick={() => revealNode(neighbor)} title={`Inspect ${neighbor.label}`}>
                      <span className="sg-edge-direction">{outgoing ? "OUT" : "IN"}</span>
                      <span className="sg-edge-path-copy">
                        <strong>{outgoing ? "→" : "←"} {link.relation}</strong>
                        <span>{neighbor.label}</span>
                      </span>
                    </button>
                    <div className="sg-edge-facts">
                      <span>strength {link.weight.toFixed(2)}</span>
                      <span>trend {link.momentum > 0.05 ? "rising" : link.momentum < -0.05 ? "falling" : "steady"}</span>
                      <span>{link.reinforcements} reinforcements</span>
                    </div>
                    <div className="sg-edge-actions">
                    <button
                      className="sg-reinforce-btn positive"
                      onClick={() => reinforceEdge(link.edge_id, 1.0)}
                      title={`Strengthen relationship with ${neighbor.label}`}
                    >
                      +
                    </button>
                    <button
                      className="sg-reinforce-btn negative"
                      onClick={() => reinforceEdge(link.edge_id, -0.5)}
                      title={`Weaken relationship with ${neighbor.label}`}
                    >
                      −
                    </button>
                    </div>
                  </div>
                ))}
              {selectedConnections.length > 12 && <p className="sg-panel-footnote">Showing 12 strongest connections.</p>}
            </div>

            <button
              className="sg-close-btn"
              onClick={() => setSelectedNode(null)}
            >
              Close
            </button>
          </div>
        )}

        {/* Heuristic need suggestions */}
        {anticipations.length > 0 && (
          <div className="sg-anticipations">
            <h4>🧭 Heuristic Need Suggestions</h4>
            {anticipations.map((need, i) => (
              <div key={i} className="sg-anticipation-item">
                <p className="sg-anticipation-suggestion">{need.suggestion}</p>
                <div className="sg-anticipation-meta">
                  <span className="sg-tag">{need.facet}</span>
                  <span className="sg-confidence">
                    {(need.confidence * 100).toFixed(0)}% heuristic score
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Heuristic candidate links */}
        {predictions.length > 0 && (
          <div className="sg-prophecy">
            <h4>✨ Candidate Links</h4>
            <p className="sg-prophecy-desc">Heuristic link suggestions between your ideas</p>
            {predictions.slice(0, 5).map((pred, i) => (
              <div key={i} className="sg-prophecy-item">
                <div className="sg-prophecy-labels">
                  <span className="sg-prophecy-source">{pred.source_label}</span>
                  <span className="sg-prophecy-arrow">↔</span>
                  <span className="sg-prophecy-target">{pred.target_label}</span>
                </div>
                <div className="sg-prophecy-reason">{pred.reason}</div>
                <div className="sg-prophecy-meta">
                  <span className="sg-confidence">{(pred.probability * 100).toFixed(0)}% heuristic score</span>
                  <div className="sg-prophecy-actions">
                    <button
                      className="sg-prophecy-btn sg-prophecy-confirm"
                      onClick={() => confirmPrediction(pred.source_id, pred.target_id)}
                      title="Confirm this connection"
                    >
                      ✓ Confirm
                    </button>
                    <button
                      className="sg-prophecy-btn sg-prophecy-dismiss"
                      onClick={() => dismissPrediction(pred.source_id, pred.target_id)}
                      title="Dismiss this suggestion"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cluster Legend — click to expand/collapse a knowledge family */}
        <div className="sg-legend">
          <h5>Clusters</h5>
          {activeClusters.map((c) => (
            <button
              key={c.id}
              className={`sg-legend-item sg-cluster-item ${effectiveExpanded.has(c.id) ? "expanded" : ""}`}
              onClick={() => toggleCluster(c.id)}
              title={expanded.has(c.id) ? "Return to overview" : `Explore ${c.name}`}
              aria-expanded={effectiveExpanded.has(c.id)}
            >
              <span className="sg-dot" style={{ background: c.color }} />
              <span className="sg-cluster-name">{c.icon} {c.name}</span>
              <span className="sg-cluster-count">{clusterCounts.get(c.id) ?? 0}</span>
              <span className="sg-cluster-state">{effectiveExpanded.has(c.id) ? "−" : "+"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
