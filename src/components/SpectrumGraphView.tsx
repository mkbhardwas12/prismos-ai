// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Spectrum Graph View — Force-Directed Knowledge Graph Visualization
//
// Renders the multi-layered Spectrum Graph using react-force-graph-2d.
// Nodes are colored by facet type (life facets per patent).
// Edges are rendered with thickness proportional to intent weight.
// Supports click-to-select, hover tooltips, and zoom/pan.

import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphSnapshot, SpectrumNode, SpectrumEdge, GraphMetrics, AnticipatedNeed } from "../types";
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
};

const LAYER_SIZES: Record<string, number> = {
  core: 10,
  context: 6,
  ephemeral: 4,
};

// ─── Force Graph Data Types ────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  node_type: string;
  layer: string;
  access_count: number;
  content: string;
  color: string;
  val: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  weight: number;
  momentum: number;
  edge_id: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface SpectrumGraphViewProps {
  refreshKey?: number;
}

export default function SpectrumGraphView({ refreshKey }: SpectrumGraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [metrics, setMetrics] = useState<GraphMetrics | null>(null);
  const [anticipations, setAnticipations] = useState<AnticipatedNeed[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  // ─── Load full graph snapshot ──────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<string>("get_spectrum_graph");
      const snapshot: GraphSnapshot = JSON.parse(result);

      // Transform to force-graph format
      const nodes: GraphNode[] = snapshot.nodes.map((n: SpectrumNode) => ({
        id: n.id,
        label: n.label,
        node_type: n.node_type,
        layer: n.layer || "context",
        access_count: n.access_count || 0,
        content: n.content,
        color: FACET_COLORS[n.node_type] || "#b0bec5",
        val: LAYER_SIZES[n.layer || "context"] || 6,
      }));

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
        }));

      setGraphData({ nodes, links });
      setMetrics(snapshot.stats);
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

  useEffect(() => {
    loadGraph();
    loadAnticipations();
  }, [loadGraph, loadAnticipations, refreshKey]);

  // ─── Resize handling ──────────────────────────────────────────────────

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight - 40,
        });
      }
    };
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // ─── Node click handler ───────────────────────────────────────────────

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

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
      const fontSize = 10 / globalScale;
      const nodeSize = (node.val || 6) / globalScale;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, nodeSize, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Highlight selected
      if (selectedNode?.id === node.id) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Access count ring (closed-loop feedback indicator)
      if (node.access_count > 3) {
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, nodeSize + 2 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      // Label
      if (globalScale > 0.6) {
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(
          node.label.length > 20 ? node.label.slice(0, 20) + "…" : node.label,
          node.x ?? 0,
          (node.y ?? 0) + nodeSize + 2 / globalScale
        );
      }
    },
    [selectedNode]
  );

  // ─── Custom link rendering ────────────────────────────────────────────

  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as unknown as { x: number; y: number };
      const target = link.target as unknown as { x: number; y: number };
      if (!source || !target) return;

      // Width proportional to edge weight
      const width = Math.max(0.5, link.weight * 1.5) / globalScale;

      // Color: blue for positive momentum, red for negative, gray for neutral
      let color = "rgba(100, 100, 120, 0.4)";
      if (link.momentum > 0.05) color = "rgba(100, 180, 255, 0.6)";
      else if (link.momentum < -0.05) color = "rgba(255, 100, 100, 0.4)";

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    },
    []
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
      <div className="sg-canvas">
        {graphData.nodes.length === 0 ? (
          <div className="sg-empty">
            <div className="sg-empty-icon"><img src={prismosLogo} alt="PrismOS" className="sg-empty-logo" /></div>
            <h3>Spectrum Graph is empty</h3>
            <p>Start conversations or add nodes to build your knowledge graph.</p>
          </div>
        ) : (
          <ForceGraph2D
            graphData={graphData as never}
            width={dimensions.width}
            height={dimensions.height}
            nodeCanvasObject={paintNode as never}
            linkCanvasObject={paintLink as never}
            onNodeClick={handleNodeClick as never}
            nodeLabel={(node: GraphNode) =>
              `${node.label}\n[${node.node_type}] Layer: ${node.layer}\nAccessed: ${node.access_count}x`
            }
            linkLabel={(link: GraphLink) =>
              `${link.relation} (weight: ${link.weight.toFixed(2)}, momentum: ${link.momentum.toFixed(2)})`
            }
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            backgroundColor="transparent"
          />
        )}
      </div>

      {/* ── Metrics Bar ── */}
      {metrics && (
        <div className="sg-metrics-bar">
          <span className="sg-metric">
            <strong>{metrics.node_count}</strong> nodes
          </span>
          <span className="sg-metric">
            <strong>{metrics.edge_count}</strong> edges
          </span>
          <span className="sg-metric">
            avg w: <strong>{metrics.avg_edge_weight.toFixed(2)}</strong>
          </span>
          <span className="sg-metric">
            density: <strong>{(metrics.graph_density * 100).toFixed(1)}%</strong>
          </span>
          {metrics.most_connected_node && (
            <span className="sg-metric">
              hub: <strong>{metrics.most_connected_node}</strong>
            </span>
          )}
          <button className="sg-refresh-btn" onClick={loadGraph}>
            ↻ Refresh
          </button>
        </div>
      )}

      {/* ── Side Panel ── */}
      <div className="sg-side-panel">
        {/* Selected Node Detail */}
        {selectedNode && (
          <div className="sg-node-detail">
            <h4>
              <span
                className="sg-dot"
                style={{ background: selectedNode.color }}
              />
              {selectedNode.label}
            </h4>
            <div className="sg-detail-meta">
              <span className="sg-tag">{selectedNode.node_type}</span>
              <span className="sg-tag">{selectedNode.layer}</span>
              <span className="sg-tag">👁 {selectedNode.access_count}</span>
            </div>
            <p className="sg-detail-content">{selectedNode.content}</p>

            {/* Show connected edges with reinforce buttons */}
            <div className="sg-connected-edges">
              <h5>Connected Edges</h5>
              {graphData.links
                .filter(
                  (l) =>
                    (typeof l.source === "string"
                      ? l.source
                      : (l.source as unknown as GraphNode).id) === selectedNode.id ||
                    (typeof l.target === "string"
                      ? l.target
                      : (l.target as unknown as GraphNode).id) === selectedNode.id
                )
                .slice(0, 5)
                .map((l) => (
                  <div key={l.edge_id} className="sg-edge-item">
                    <span className="sg-edge-relation">{l.relation}</span>
                    <span className="sg-edge-weight">
                      w:{l.weight.toFixed(2)} m:{l.momentum.toFixed(2)}
                    </span>
                    <button
                      className="sg-reinforce-btn positive"
                      onClick={() => reinforceEdge(l.edge_id, 1.0)}
                      title="Reinforce (strengthen)"
                    >
                      +
                    </button>
                    <button
                      className="sg-reinforce-btn negative"
                      onClick={() => reinforceEdge(l.edge_id, -0.5)}
                      title="Weaken"
                    >
                      −
                    </button>
                  </div>
                ))}
            </div>

            <button
              className="sg-close-btn"
              onClick={() => setSelectedNode(null)}
            >
              Close
            </button>
          </div>
        )}

        {/* Anticipatory Needs */}
        {anticipations.length > 0 && (
          <div className="sg-anticipations">
            <h4>🔮 Anticipated Needs</h4>
            {anticipations.map((need, i) => (
              <div key={i} className="sg-anticipation-item">
                <p className="sg-anticipation-suggestion">{need.suggestion}</p>
                <div className="sg-anticipation-meta">
                  <span className="sg-tag">{need.facet}</span>
                  <span className="sg-confidence">
                    {(need.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Facet Legend */}
        <div className="sg-legend">
          <h5>Facet Types</h5>
          {Object.entries(FACET_COLORS).map(([type, color]) => (
            <div key={type} className="sg-legend-item">
              <span className="sg-dot" style={{ background: color }} />
              <span>{type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
