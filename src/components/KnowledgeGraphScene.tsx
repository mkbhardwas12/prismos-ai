import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { KnowledgeNode, KnowledgeGroup } from "../lib/knowledgeGraph";
import type { SpectrumEdge } from "../types";

// The WebGL renderer is loaded only when 3D is requested. Both views use the
// same local nodes and recorded edges; layout never creates knowledge links.
const Scene3D = lazy(() => import("./KnowledgeGraphScene3D"));
export interface SceneNode extends KnowledgeNode {
  color: string;
  radius: number;
  landmark: boolean;
  /** A label sample for a sparse group; this does not imply connectivity. */
  representative?: boolean;
  labelSide?: 1 | -1;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  anchor: { x: number; y: number; z: number };
}
export interface SceneLink extends SpectrumEdge {
  source: string | SceneNode;
  target: string | SceneNode;
}
export interface SceneData {
  nodes: SceneNode[];
  links: SceneLink[];
  /** Appearance updates repaint without replacing graphData or reheating. */
  revision: number;
}
export interface SceneProps {
  data: SceneData;
  width: number;
  height: number;
  selectedId: string | null;
  focusIds: Set<string> | null;
  pathEdges: Set<string>;
  showLabels: boolean;
  fitKey: number;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}
export const endpointId = (value: string | SceneNode) =>
  typeof value === "string" ? value : value.id;
export const shortLabel = (label: string) =>
  label.length > 35 ? `${label.slice(0, 34)}…` : label;

export function linkEmphasis(
  link: SceneLink,
  selectedId: string | null,
  focusIds: Set<string> | null,
  pathEdges: Set<string>,
): "path" | "direct" | "nearby" | "muted" | "base" {
  if (pathEdges.has(link.id)) return "path";
  const source = endpointId(link.source);
  const target = endpointId(link.target);
  if (selectedId && (source === selectedId || target === selectedId))
    return "direct";
  if (focusIds)
    return focusIds.has(source) && focusIds.has(target) ? "nearby" : "muted";
  return selectedId || pathEdges.size ? "muted" : "base";
}

const LINK_STYLES_2D = {
  path: { color: "#f1cb74", width: 2.8, arrow: 4 },
  direct: { color: "#9cddebdd", width: 1.7, arrow: 3.2 },
  nearby: { color: "#739fb78c", width: 0.9, arrow: 0 },
  muted: { color: "#50607524", width: 0.55, arrow: 0 },
  base: { color: "#839fb96e", width: 0.85, arrow: 0 },
};

class SceneBoundary extends Component<
  { children: ReactNode; onFallback: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="kg-scene-message" role="alert">
        <p>The 3D view is unavailable on this device.</p>
        <button onClick={this.props.onFallback}>Open the 2D map</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Scene2D(props: SceneProps) {
  const {
    data,
    width,
    height,
    selectedId,
    focusIds,
    pathEdges,
    showLabels,
    fitKey,
    onSelect,
    onHover,
  } = props;
  const ref = useRef<any>(null);
  const labelBounds = useRef<
    { left: number; right: number; top: number; bottom: number }[]
  >([]);
  const resetLabelBounds = useCallback(() => {
    labelBounds.current = [];
  }, []);
  const finalFitPending = useRef(false);
  const lastViewport = useRef({
    data: null as SceneData | null,
    fitKey,
    width,
    height,
  });
  // Leave room for custom node radii, labels and the bottom map caption.
  const fit = useCallback(() => ref.current?.zoomToFit(450, 100), []);
  const fitSettledLayout = useCallback(() => {
    if (!finalFitPending.current || !ref.current) return;
    finalFitPending.current = false;
    fit();
  }, [fit]);
  useEffect(() => {
    const structural = lastViewport.current.data !== data;
    const requested =
      lastViewport.current.fitKey !== fitKey ||
      lastViewport.current.width !== width ||
      lastViewport.current.height !== height;
    lastViewport.current = { data, fitKey, width, height };
    if (!structural && !requested) return;
    if (structural) finalFitPending.current = true;
    // Show the initial positions promptly, then fit the actual settled bounds.
    // Resize/manual fits do not make a later styling update recenter the map.
    const timer = setTimeout(() => {
      if (!structural || finalFitPending.current) fit();
    }, 120);
    return () => clearTimeout(timer);
  }, [fitKey, data, width, height, fit]);
  useEffect(() => {
    const graph = ref.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-45);
    graph.d3Force("link")?.distance(45);
    const force = (alpha: number) =>
      data.nodes.forEach((n) => {
        n.vx = (n.vx ?? 0) + (n.anchor.x - (n.x ?? 0)) * alpha * 0.035;
        n.vy = (n.vy ?? 0) + (n.anchor.y - (n.y ?? 0)) * alpha * 0.035;
      });
    graph.d3Force("groups", force);
    // graphData updates initialize and reheat the library's simulation. Do
    // not start it here before its asynchronous initialization has finished.
  }, [data]);
  const paint = useCallback(
    (node: SceneNode, ctx: CanvasRenderingContext2D, zoom: number) => {
      const active = !focusIds || focusIds.has(node.id);
      const selected = selectedId === node.id;
      const r = node.radius;
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.16;
      if (node.landmark || selected) {
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, r + 5, 0, Math.PI * 2);
        ctx.fillStyle = `${node.color}19`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
      if (
        active &&
        (showLabels ||
          node.landmark ||
          node.representative ||
          selected ||
          (focusIds && zoom > 0.6))
      ) {
        const size = 11 / zoom;
        const label = shortLabel(node.label);
        ctx.font = `${selected ? 600 : 450} ${size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(label).width;
        const side = selected ? 1 : (node.labelSide ?? 1);
        const y = (node.y ?? 0) + side * (r + 10 / zoom);
        const bounds = {
          left: (node.x ?? 0) - textWidth / 2 - 5 / zoom,
          right: (node.x ?? 0) + textWidth / 2 + 5 / zoom,
          top: y - size * 0.8,
          bottom: y + size * 0.8,
        };
        const overlaps = (other: typeof bounds) =>
          bounds.left < other.right &&
          bounds.right > other.left &&
          bounds.top < other.bottom &&
          bounds.bottom > other.top;
        const selectedNode =
          !selected && selectedId
            ? data.nodes.find((candidate) => candidate.id === selectedId)
            : undefined;
        // Reserve the selected title before paint order is known, so automatic
        // labels cannot cover it. Explicit "all labels" remains user-controlled.
        const selectedWidth = selectedNode
          ? ctx.measureText(shortLabel(selectedNode.label)).width * 1.15
          : 0;
        const selectedY = selectedNode
          ? (selectedNode.y ?? 0) + selectedNode.radius + 10 / zoom
          : 0;
        const selectedBounds = selectedNode
          ? {
              left: (selectedNode.x ?? 0) - selectedWidth / 2 - 5 / zoom,
              right: (selectedNode.x ?? 0) + selectedWidth / 2 + 5 / zoom,
              top: selectedY - size * 0.8,
              bottom: selectedY + size * 0.8,
            }
          : null;
        const covered =
          !showLabels &&
          !selected &&
          (labelBounds.current.some(overlaps) ||
            (selectedBounds && overlaps(selectedBounds)));
        if (!covered) {
          labelBounds.current.push(bounds);
          ctx.fillStyle = "#070c16e8";
          ctx.fillRect(
            bounds.left + 2 / zoom,
            y - size * 0.7,
            textWidth + 6 / zoom,
            size * 1.4,
          );
          ctx.fillStyle = "#e5edf6";
          ctx.fillText(label, node.x ?? 0, y);
        }
      }
      ctx.restore();
    },
    [focusIds, selectedId, showLabels, data, data.revision],
  );
  return (
    <ForceGraph2D
      ref={ref}
      graphData={data as never}
      width={width}
      height={height}
      nodeCanvasObject={paint as never}
      onRenderFramePre={resetLabelBounds}
      nodeLabel={() => ""}
      linkLabel={() => ""}
      nodePointerAreaPaint={
        ((n: SceneNode, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, n.radius + 5, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }) as never
      }
      linkColor={
        ((link: SceneLink) =>
          LINK_STYLES_2D[linkEmphasis(link, selectedId, focusIds, pathEdges)]
            .color) as never
      }
      linkWidth={
        ((link: SceneLink) =>
          LINK_STYLES_2D[linkEmphasis(link, selectedId, focusIds, pathEdges)]
            .width) as never
      }
      linkDirectionalArrowLength={
        ((link: SceneLink) =>
          LINK_STYLES_2D[linkEmphasis(link, selectedId, focusIds, pathEdges)]
            .arrow) as never
      }
      linkDirectionalArrowRelPos={0.9}
      onNodeClick={((n: SceneNode) => onSelect(n.id)) as never}
      onNodeHover={((n: SceneNode | null) => onHover(n?.id ?? null)) as never}
      cooldownTicks={100}
      d3AlphaDecay={0.035}
      d3VelocityDecay={0.35}
      onEngineStop={fitSettledLayout}
      backgroundColor="#070b13"
    />
  );
}

export default function KnowledgeGraphScene({
  nodes,
  edges,
  groups,
  mode,
  onFallback,
  ...props
}: Omit<SceneProps, "data"> & {
  nodes: KnowledgeNode[];
  edges: SpectrumEdge[];
  groups: KnowledgeGroup[];
  mode: "2d" | "3d";
  onFallback: () => void;
}) {
  // Keep mutable renderer objects separate from the immutable knowledge model.
  // A stable ID keeps its settled position when content or selection changes.
  const cache = useRef({
    nodes: new Map<string, SceneNode>(),
    links: new Map<string, SceneLink>(),
    nodeVersions: new Map<string, string>(),
    linkVersions: new Map<string, string>(),
    topology: "",
    data: null as SceneData | null,
  });
  const data = useMemo<SceneData>(() => {
    const current = cache.current;
    const orderedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    const orderedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    const topology = JSON.stringify([
      mode,
      orderedNodes.map((n) => [n.id, n.groupId]),
      orderedEdges.map((e) => [e.id, e.source_id, e.target_id]),
    ]);
    const structuralChange = topology !== current.topology;
    const groupMap = new Map(
      [...groups]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((g, i) => [g.id, { group: g, index: i }]),
    );
    const ranks = new Map<string, number>();
    const ranked = [...nodes].sort(
      (a, b) => b.degree - a.degree || a.id.localeCompare(b.id),
    );
    const landmarkThreshold = Math.max(2, (ranked[0]?.degree ?? 0) * 0.2);
    const landmarks = new Set(
      ranked
        .filter((node) => node.degree >= landmarkThreshold)
        .slice(0, 10)
        .map((n) => n.id),
    );
    // Sparse groups still need readable examples. Sample existing records,
    // never manufacture a hub or add a relationship to make the map look full.
    const groupMembers = new Map<string, KnowledgeNode[]>();
    for (const node of orderedNodes) {
      const members = groupMembers.get(node.groupId) ?? [];
      members.push(node);
      groupMembers.set(node.groupId, members);
    }
    const sparseGroups = [...groupMembers.entries()]
      .filter(([, members]) => !members.some((node) => landmarks.has(node.id)))
      .sort(
        ([idA, a], [idB, b]) => b.length - a.length || idA.localeCompare(idB),
      )
      .map(([, members]) => {
        const unconnected = members.filter((node) => node.degree === 0);
        const candidates = unconnected.length ? unconnected : members;
        const first = candidates[0];
        const last = [...candidates]
          .reverse()
          .find(
            (node) =>
              node.label.trim().toLowerCase() !==
              first.label.trim().toLowerCase(),
          );
        return last ? [first, last] : [first];
      });
    const representatives = new Map<string, 1 | -1>();
    const representativeBudget = Math.max(0, 12 - landmarks.size);
    for (let round = 0; round < 2; round++) {
      for (const candidates of sparseGroups) {
        if (representatives.size >= representativeBudget) break;
        const candidate = candidates[round];
        if (candidate) representatives.set(candidate.id, round === 0 ? 1 : -1);
      }
    }
    let appearanceChanged = false;
    const rendererNodes = orderedNodes.map((n) => {
      const group = groupMap.get(n.groupId);
      const index = group?.index ?? 0;
      const rank = ranks.get(n.groupId) ?? 0;
      ranks.set(n.groupId, rank + 1);
      const angle = (index / Math.max(1, groups.length)) * Math.PI * 2;
      const spread = Math.min(260, 95 + Math.sqrt(nodes.length) * 6);
      const anchor = {
        x: Math.cos(angle) * spread,
        y: Math.sin(angle) * spread * 0.74,
        z: mode === "3d" ? Math.sin(index * 2.4) * 120 : 0,
      };
      const offset = Math.sqrt(rank + 1) * 14;
      const attributes = {
        ...n,
        color: group?.group.color ?? "#94a3b8",
        radius: Math.min(12, 2.7 + Math.sqrt(n.degree) * 1.4),
        landmark: landmarks.has(n.id) && n.degree > 0,
        representative: representatives.has(n.id),
        labelSide: representatives.get(n.id) ?? 1,
      };
      const version = JSON.stringify(attributes);
      let rendererNode = current.nodes.get(n.id);
      if (!rendererNode) {
        rendererNode = {
          ...attributes,
          connections: [...n.connections],
          anchor,
          x: anchor.x + Math.cos(rank * 2.39996) * offset,
          y: anchor.y + Math.sin(rank * 2.39996) * offset,
          z: mode === "3d" ? anchor.z + Math.sin(rank * 1.618) * offset : 0,
        };
        current.nodes.set(n.id, rendererNode);
      } else if (current.nodeVersions.get(n.id) !== version) {
        Object.assign(rendererNode, attributes, {
          connections: [...n.connections],
        });
      }
      if (structuralChange) rendererNode.anchor = anchor;
      if (current.nodeVersions.get(n.id) !== version) appearanceChanged = true;
      current.nodeVersions.set(n.id, version);
      return rendererNode;
    });
    const rendererLinks = orderedEdges.map((edge) => {
      let rendererLink = current.links.get(edge.id);
      const version = JSON.stringify(edge);
      if (!rendererLink) {
        rendererLink = {
          ...edge,
          source: edge.source_id,
          target: edge.target_id,
        };
        current.links.set(edge.id, rendererLink);
      } else if (current.linkVersions.get(edge.id) !== version) {
        // Keep endpoints that force-graph has resolved to node objects. An
        // actual endpoint change is structural and needs a new resolution.
        if (rendererLink.source_id !== edge.source_id)
          rendererLink.source = edge.source_id;
        if (rendererLink.target_id !== edge.target_id)
          rendererLink.target = edge.target_id;
        Object.assign(rendererLink, edge);
      }
      if (current.linkVersions.get(edge.id) !== version)
        appearanceChanged = true;
      current.linkVersions.set(edge.id, version);
      return rendererLink;
    });
    const retainedNodes = new Set(nodes.map((node) => node.id));
    const retainedLinks = new Set(edges.map((edge) => edge.id));
    for (const id of current.nodes.keys())
      if (!retainedNodes.has(id)) {
        current.nodes.delete(id);
        current.nodeVersions.delete(id);
      }
    for (const id of current.links.keys())
      if (!retainedLinks.has(id)) {
        current.links.delete(id);
        current.linkVersions.delete(id);
      }
    const revision =
      (current.data?.revision ?? 0) + (appearanceChanged ? 1 : 0);
    if (structuralChange || !current.data)
      current.data = { nodes: rendererNodes, links: rendererLinks, revision };
    else current.data.revision = revision;
    current.topology = topology;
    return current.data;
  }, [nodes, edges, groups, mode]);
  return (
    <SceneBoundary key={mode} onFallback={onFallback}>
      <Suspense
        fallback={<div className="kg-scene-message">Opening the 3D map…</div>}
      >
        {mode === "3d" ? (
          <Scene3D {...props} data={data} />
        ) : (
          <Scene2D {...props} data={data} />
        )}
      </Suspense>
    </SceneBoundary>
  );
}
