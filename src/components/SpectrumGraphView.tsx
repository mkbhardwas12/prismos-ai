import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GraphSnapshot, PredictedEdge } from "../types";
import {
  buildKnowledgeGraph,
  connectedNeighborhood,
  findKnowledgePath,
  searchKnowledgeNodes,
  type KnowledgeNode,
} from "../lib/knowledgeGraph";
import KnowledgeGraphScene from "./KnowledgeGraphScene";
import "./SpectrumGraphView.css";

const MAX_RENDERED_NODES = 1200;
const PREFERENCES_KEY = "prismos-knowledge-view-v1";
const EMPTY_NODES: GraphSnapshot["nodes"] = [];
const EMPTY_EDGES: GraphSnapshot["edges"] = [];
type ConnectionScope = "connected" | "unconnected" | "all";

function preferences(): { mode: "2d" | "3d"; labels: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return {
      mode: value?.mode === "2d" ? "2d" : "3d",
      labels: value?.labels === true,
    };
  } catch {
    return { mode: "3d", labels: false };
  }
}

function reviewReasons(node: KnowledgeNode): string[] {
  const reasons: string[] = [];
  const date = Date.parse(node.updated_at);
  if (!Number.isFinite(date) || date > Date.now())
    reasons.push("Update date unknown");
  else if (Date.now() - date >= 90 * 86400000)
    reasons.push("Not updated in 90+ days");
  if (!node.degree) reasons.push("No recorded connections");
  return reasons;
}

function updatedLabel(value: string): string {
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= Date.now()
    ? new Date(date).toLocaleDateString()
    : "Unknown";
}

/** Local graph browser. View operations never create or infer stored edges. */
export default function SpectrumGraphView({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const initialPreferences = useMemo(preferences, []);
  const [mode, setMode] = useState<"2d" | "3d">(initialPreferences.mode);
  const [showLabels, setShowLabels] = useState(initialPreferences.labels);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [attention, setAttention] = useState(false);
  const [connectionScope, setConnectionScope] = useState<
    ConnectionScope | "auto"
  >("auto");
  const [showGuide, setShowGuide] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [fullNote, setFullNote] = useState(false);
  const [neighborLimit, setNeighborLimit] = useState(20);
  const [browseLimit, setBrowseLimit] = useState(30);
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [size, setSize] = useState({ width: 640, height: 600 });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<PredictedEdge[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(
    null,
  );
  const [pendingEdge, setPendingEdge] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState("");
  const canvasContainer = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const suggestionRequest = useRef(0);
  const mounted = useRef(true);
  const suggestionBusy = useRef(false);
  const edgeBusy = useRef(false);

  const loadGraph = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    setLoadError("");
    try {
      const raw = await invoke<string>("get_spectrum_graph");
      const graph = JSON.parse(raw) as GraphSnapshot;
      if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
        throw new Error("Invalid graph snapshot received");
      if (mounted.current && request === requestNumber.current)
        setSnapshot(graph);
    } catch (error) {
      if (mounted.current && request === requestNumber.current)
        setLoadError(String(error));
    } finally {
      if (mounted.current && request === requestNumber.current)
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestNumber.current++;
      suggestionRequest.current++;
    };
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph, refreshKey]);

  useEffect(() => {
    // Persist display preferences only, never note text, source paths, or searches.
    try {
      localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ mode, labels: showLabels }),
      );
    } catch {
      /* Storage is optional. */
    }
  }, [mode, showLabels]);

  useEffect(() => {
    const host = canvasContainer.current;
    if (!host) return;
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0)
        setSize({ width: bounds.width, height: bounds.height });
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
      )
        return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const graph = useMemo(
    () =>
      buildKnowledgeGraph(
        snapshot?.nodes ?? EMPTY_NODES,
        snapshot?.edges ?? EMPTY_EDGES,
      ),
    [snapshot],
  );
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph],
  );
  const groupById = useMemo(
    () => new Map(graph.groups.map((group) => [group.id, group])),
    [graph],
  );
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const hovered = hoveredId ? nodeById.get(hoveredId) : undefined;
  const searchResults = useMemo(
    () => (query.trim() ? searchKnowledgeNodes(graph.nodes, query) : []),
    [graph.nodes, query],
  );
  const selectedNeighborhood = useMemo(
    () => (selected ? connectedNeighborhood(graph.edges, selected.id) : null),
    [selected, graph.edges],
  );
  // Selecting highlights the neighborhood without filtering or moving it.
  // Only the explicit Focus action removes the surrounding map from view.
  const focusIds = focus ? selectedNeighborhood : null;
  const path = useMemo(
    () =>
      pathFrom && pathTo
        ? findKnowledgePath(graph.edges, pathFrom, pathTo)
        : null,
    [graph.edges, pathFrom, pathTo],
  );
  const pathEdgeIds = useMemo(() => new Set(path?.edgeIds ?? []), [path]);
  const pathNodeIds = useMemo(() => new Set(path?.nodeIds ?? []), [path]);
  const connectedCount = graph.nodes.length - graph.diagnostics.isolatedNodes;
  const activeScope: ConnectionScope =
    connectionScope === "auto"
      ? connectedCount > 0 && graph.diagnostics.isolatedNodes > connectedCount
        ? "connected"
        : "all"
      : connectionScope;
  const isolatedSuggestionCount = useMemo(
    () =>
      graph.nodes.filter(
        (node) => node.node_type === "suggestion" && node.degree === 0,
      ).length,
    [graph.nodes],
  );
  const scopedNodes = useMemo(
    () =>
      graph.nodes
        .filter(
          (node) =>
            activeScope === "all" ||
            (activeScope === "connected" ? node.degree > 0 : node.degree === 0),
        )
        .sort(
          (a, b) =>
            Number(a.node_type === "suggestion") -
            Number(b.node_type === "suggestion"),
        ),
    [graph.nodes, activeScope],
  );
  const scopedGroupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of scopedNodes)
      counts.set(node.groupId, (counts.get(node.groupId) ?? 0) + 1);
    return counts;
  }, [scopedNodes]);
  const reviewCount = useMemo(
    () => scopedNodes.filter((node) => reviewReasons(node).length > 0).length,
    [scopedNodes],
  );
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes)
      counts.set(node.label, (counts.get(node.label) ?? 0) + 1);
    return new Set(
      [...counts].filter(([, count]) => count > 1).map(([label]) => label),
    );
  }, [graph.nodes]);
  const filteredNodes = useMemo(
    () =>
      scopedNodes.filter(
        (node) =>
          !hiddenGroups.has(node.groupId) &&
          (!attention || reviewReasons(node).length > 0) &&
          (!focusIds || focusIds.has(node.id)),
      ),
    [scopedNodes, hiddenGroups, attention, focusIds],
  );
  const renderedNodes = useMemo(
    () =>
      filteredNodes.length <= MAX_RENDERED_NODES
        ? filteredNodes
        : [...filteredNodes]
            .sort((a, b) => {
              const priority = (node: KnowledgeNode) =>
                (node.id === selectedId ? 4 : 0) +
                (pathNodeIds.has(node.id) ? 2 : 0);
              return (
                priority(b) - priority(a) ||
                b.degree - a.degree ||
                Number(a.node_type === "suggestion") -
                  Number(b.node_type === "suggestion") ||
                a.label.localeCompare(b.label) ||
                a.id.localeCompare(b.id)
              );
            })
            .slice(0, MAX_RENDERED_NODES),
    [filteredNodes, selectedId, pathNodeIds],
  );
  const renderedEdges = useMemo(() => {
    const ids = new Set(renderedNodes.map((node) => node.id));
    return graph.edges.filter(
      (edge) => ids.has(edge.source_id) && ids.has(edge.target_id),
    );
  }, [renderedNodes, graph.edges]);
  const neighbors = useMemo(
    () =>
      selected
        ? graph.edges
            .filter(
              (edge) =>
                edge.source_id === selected.id ||
                edge.target_id === selected.id,
            )
            .map((edge) => ({
              edge,
              outgoing: edge.source_id === selected.id,
              node: nodeById.get(
                edge.source_id === selected.id
                  ? edge.target_id
                  : edge.source_id,
              )!,
            }))
            .sort(
              (a, b) =>
                a.node.label.localeCompare(b.node.label) ||
                a.edge.relation.localeCompare(b.edge.relation),
            )
        : [],
    [selected, graph.edges, nodeById],
  );
  const visibleSelectedLinks = useMemo(
    () =>
      selected
        ? renderedEdges.filter(
            (edge) =>
              edge.source_id === selected.id || edge.target_id === selected.id,
          ).length
        : 0,
    [selected, renderedEdges],
  );

  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) {
      setSelectedId(null);
      setFocus(false);
    }
    if (
      (pathFrom && !nodeById.has(pathFrom)) ||
      (pathTo && !nodeById.has(pathTo))
    ) {
      setPathFrom(null);
      setPathTo(null);
    }
  }, [nodeById, selectedId, pathFrom, pathTo]);

  const selectNode = useCallback(
    (id: string) => {
      const node = nodeById.get(id);
      if (!node) return;
      setSelectedId(id);
      if (
        activeScope !== "all" &&
        (activeScope === "connected") !== node.degree > 0
      ) {
        setConnectionScope(node.degree > 0 ? "connected" : "unconnected");
        setFocus(false);
      }
      setHiddenGroups((current) => {
        if (!current.has(node.groupId)) return current;
        const next = new Set(current);
        next.delete(node.groupId);
        return next;
      });
      if (!reviewReasons(node).length) setAttention(false);
      setFullNote(false);
      setNeighborLimit(20);
      setQuery("");
      setShowSuggestions(false);
      setShowGuide(false);
      setEdgeError("");
    },
    [nodeById, activeScope],
  );

  const changeScope = (scope: ConnectionScope) => {
    if (activeScope === scope) return;
    setConnectionScope(scope);
    setHiddenGroups(new Set());
    setAttention(false);
    setFocus(false);
    setQuery("");
    setPathFrom(null);
    setPathTo(null);
    setSelectedId(null);
    setBrowseLimit(30);
    setFitKey((key) => key + 1);
  };

  const showAll = () => {
    setHiddenGroups((current) => (current.size ? new Set() : current));
    setAttention(false);
    setFocus(false);
    setQuery("");
    setFitKey((key) => key + 1);
  };

  const feedbackEdge = async (edgeId: string, feedbackSignal: number) => {
    if (edgeBusy.current) return;
    edgeBusy.current = true;
    setPendingEdge(edgeId);
    setEdgeError("");
    try {
      await invoke("update_edge_weight", { edgeId, feedbackSignal });
      if (mounted.current) await loadGraph();
    } catch (error) {
      if (mounted.current) setEdgeError(String(error));
    } finally {
      edgeBusy.current = false;
      if (mounted.current) setPendingEdge(null);
    }
  };

  const loadSuggestions = async () => {
    setShowSuggestions(true);
    setSuggestionError("");
    setSuggestionsLoading(true);
    const request = ++suggestionRequest.current;
    try {
      const result = JSON.parse(
        await invoke<string>("predict_edges", { limit: 10 }),
      ) as PredictedEdge[];
      if (!Array.isArray(result))
        throw new Error("Invalid connection suggestions received");
      if (mounted.current && request === suggestionRequest.current)
        setSuggestions(
          result.filter(
            (item) =>
              nodeById.has(item.source_id) && nodeById.has(item.target_id),
          ),
        );
    } catch (error) {
      if (mounted.current && request === suggestionRequest.current)
        setSuggestionError(String(error));
    } finally {
      if (mounted.current && request === suggestionRequest.current)
        setSuggestionsLoading(false);
    }
  };

  const resolveSuggestion = async (item: PredictedEdge, confirm: boolean) => {
    if (suggestionBusy.current) return;
    suggestionBusy.current = true;
    setPendingSuggestion(`${item.source_id}:${item.target_id}`);
    setSuggestionError("");
    try {
      await invoke(
        confirm ? "confirm_predicted_edge" : "dismiss_predicted_edge",
        { sourceId: item.source_id, targetId: item.target_id },
      );
      if (!mounted.current) return;
      setSuggestions((items) =>
        items.filter(
          (candidate) =>
            candidate.source_id !== item.source_id ||
            candidate.target_id !== item.target_id,
        ),
      );
      if (confirm) {
        await loadGraph();
        if (!mounted.current) return;
        // The accepted endpoints are no longer unconnected. Reveal their
        // recorded relationship instead of leaving a hidden selection behind.
        setConnectionScope("connected");
        showAll();
        setPathFrom(null);
        setPathTo(null);
        setSelectedId(item.source_id);
        setFullNote(false);
        setNeighborLimit(20);
        setShowSuggestions(false);
        setShowGuide(false);
      }
    } catch (error) {
      if (mounted.current) setSuggestionError(String(error));
    } finally {
      suggestionBusy.current = false;
      if (mounted.current) setPendingSuggestion(null);
    }
  };

  return (
    <section
      className="spectrum-graph-view kg-view"
      aria-label="Knowledge graph"
    >
      <header className="kg-topbar">
        <div className="kg-brand">
          <span className="kg-brand-icon" aria-hidden="true">
            ✳
          </span>
          <div>
            <strong>Spectrum Graph</strong>
            <span
              title={`Built ${import.meta.env.VITE_PRISMOS_BUILD || "in development"}`}
            >
              Knowledge atlas 2 ·{" "}
              {import.meta.env.VITE_PRISMOS_BUILD?.slice(0, 10) ||
                "development"}
            </span>
          </div>
        </div>
        <div className="kg-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchInput}
            aria-label="Search notes"
            placeholder="Search titles, content, sources…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {query ? (
            <button onClick={() => setQuery("")} aria-label="Clear search">
              ×
            </button>
          ) : (
            <kbd>/</kbd>
          )}
          {query.trim() && (
            <div className="kg-search-results" aria-label="Search results">
              <div className="kg-eyebrow">
                {searchResults.length
                  ? `${searchResults.length}${searchResults.length === 80 ? "+" : ""} matches · all sources`
                  : "No matching notes"}
              </div>
              {searchResults.map((node) => (
                <button key={node.id} onClick={() => selectNode(node.id)}>
                  <i
                    style={{ background: groupById.get(node.groupId)?.color }}
                  />
                  <span>
                    {node.label}
                    <small>
                      {groupById.get(node.groupId)?.label} · {node.degree}{" "}
                      connections
                    </small>
                    {duplicateTitles.has(node.label) && (
                      <small className="kg-search-evidence">
                        {updatedLabel(node.updated_at)} ·{" "}
                        {node.content.replace(/\s+/g, " ").slice(0, 110) ||
                          "No content recorded"}
                      </small>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span
          className="kg-private"
          title="This view reads your local database. No knowledge is uploaded by this view."
        >
          <span aria-hidden="true">◉</span> Local knowledge
        </span>
      </header>

      <div className="kg-connection-scope" aria-label="Connection coverage">
        <div className="kg-scope-tabs" aria-label="Connection scope">
          {(
            [
              ["connected", "Connected", connectedCount],
              ["unconnected", "Unconnected", graph.diagnostics.isolatedNodes],
              ["all", "All records", graph.nodes.length],
            ] as const
          ).map(([scope, label, count]) => (
            <button
              key={scope}
              aria-label={`${label} ${count.toLocaleString()}`}
              aria-pressed={activeScope === scope}
              onClick={() => changeScope(scope)}
            >
              <span>{label}</span>
              <strong>{count.toLocaleString()}</strong>
            </button>
          ))}
        </div>
        <p>
          {activeScope === "connected"
            ? "Showing notes with recorded relationships."
            : activeScope === "unconnected"
              ? "These records have no recorded relationships yet."
              : "All stored records, including unconnected notes."}
          {isolatedSuggestionCount > 0 && (
            <span>
              {isolatedSuggestionCount.toLocaleString()} unconnected records are
              automatic suggestions. Nothing has been deleted.
            </span>
          )}
        </p>
      </div>

      <div className="kg-workspace">
        <aside className="kg-sources" aria-label="Sources and filters">
          <div className="kg-intro">
            <div className="kg-eyebrow">YOUR KNOWLEDGE MAP</div>
            <h2>
              Knowledge.
              <br />
              <em>In context.</em>
            </h2>
            <p>
              Follow the links between your projects, documents and
              conversations.
            </p>
          </div>
          <div className="kg-stats">
            <div>
              <strong>{graph.nodes.length.toLocaleString()}</strong>
              <span>notes</span>
            </div>
            <div>
              <strong>{graph.groups.length}</strong>
              <span>groups</span>
            </div>
            <div>
              <strong>{graph.edges.length.toLocaleString()}</strong>
              <span>links</span>
            </div>
          </div>
          <div className="kg-section-heading">
            <h3>Sources & groups</h3>
            <button onClick={showAll}>Reset</button>
          </div>
          <div className="kg-source-list">
            {graph.groups
              .filter((group) => scopedGroupCounts.has(group.id))
              .map((group) => (
                <button
                  className="kg-source"
                  key={group.id}
                  aria-pressed={!hiddenGroups.has(group.id)}
                  onClick={() => {
                    setHiddenGroups((hidden) => {
                      const next = new Set(hidden);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
                    setFocus(false);
                  }}
                  title={`${group.label} · ${group.kind} · ${scopedGroupCounts.get(group.id)} in this scope, ${group.count} total`}
                >
                  <i style={{ background: group.color }} />
                  <span>{group.label}</span>
                  <small>{scopedGroupCounts.get(group.id)}</small>
                </button>
              ))}
          </div>
          <label className="kg-check">
            <input
              type="checkbox"
              checked={attention}
              onChange={(event) => {
                setAttention(event.target.checked);
                setFocus(false);
              }}
            />
            <span>Review suggested</span>
            <small>{reviewCount}</small>
          </label>
          <p className="kg-fineprint">
            90+ days without an update, unknown date, or no links. A review
            signal—not a correctness rating.
          </p>
          <label className="kg-check">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => setShowLabels(event.target.checked)}
            />
            <span>Show all labels</span>
          </label>
          <button
            className="kg-outline-button"
            onClick={() => void loadSuggestions()}
          >
            Review connections
          </button>
          <details
            className="kg-browse"
            key={activeScope}
            open={activeScope === "unconnected" ? true : undefined}
          >
            <summary>
              Browse notes <span>{filteredNodes.length}</span>
            </summary>
            <p className="kg-fineprint">
              {activeScope === "unconnected"
                ? "No links are recorded for these notes. Read them or review connection suggestions; proximity on the map is not a relationship."
                : "Keyboard-accessible list of the filtered map."}
            </p>
            {filteredNodes.slice(0, browseLimit).map((node) => (
              <button key={node.id} onClick={() => selectNode(node.id)}>
                <i style={{ background: groupById.get(node.groupId)?.color }} />
                <span>{node.label}</span>
              </button>
            ))}
            {filteredNodes.length > browseLimit && (
              <button onClick={() => setBrowseLimit((limit) => limit + 50)}>
                Show more notes
              </button>
            )}
          </details>
        </aside>

        <main
          className="kg-map"
          ref={canvasContainer}
          aria-label="Interactive knowledge map"
        >
          <div className="kg-map-toolbar">
            <div className="kg-segment" aria-label="Map dimension">
              <button
                aria-pressed={mode === "3d"}
                onClick={() => setMode("3d")}
              >
                3D
              </button>
              <button
                aria-pressed={mode === "2d"}
                onClick={() => setMode("2d")}
              >
                2D
              </button>
            </div>
            <button onClick={() => setFitKey((key) => key + 1)}>
              Center map
            </button>
            <button disabled={loading} onClick={() => void loadGraph()}>
              {loading && snapshot ? "Refreshing…" : "Refresh"}
            </button>
            <button
              aria-pressed={showGuide}
              onClick={() => {
                setShowGuide((value) => !value);
                setSelectedId(null);
                setFocus(false);
                setShowSuggestions(false);
              }}
            >
              Guide
            </button>
          </div>
          {loadError && (
            <div className="kg-map-alert" role="alert">
              <strong>Could not load your knowledge graph.</strong>
              <p>{loadError}</p>
              <button onClick={() => void loadGraph()}>Retry</button>
              {snapshot && (
                <small>Showing the last successfully loaded snapshot.</small>
              )}
            </div>
          )}
          {loading && !snapshot ? (
            <div className="kg-map-empty" role="status">
              Loading local knowledge…
            </div>
          ) : !graph.nodes.length ? (
            <div className="kg-map-empty">
              <span aria-hidden="true">✳</span>
              <h3>Your knowledge starts here</h3>
              <p>
                Add notes or import documents through PrismOS.
                <br />
                Only stored knowledge appears on this map.
              </p>
            </div>
          ) : !renderedNodes.length ? (
            <div className="kg-map-empty">
              <h3>No notes in this view</h3>
              <button
                onClick={() => {
                  setConnectionScope("all");
                  showAll();
                }}
              >
                Show entire map
              </button>
            </div>
          ) : (
            <KnowledgeGraphScene
              nodes={renderedNodes}
              edges={renderedEdges}
              groups={graph.groups}
              mode={mode}
              onFallback={() => setMode("2d")}
              width={size.width}
              height={size.height}
              selectedId={selectedId}
              focusIds={path ? pathNodeIds : (focusIds ?? selectedNeighborhood)}
              pathEdges={pathEdgeIds}
              showLabels={showLabels}
              fitKey={fitKey}
              onSelect={selectNode}
              onHover={setHoveredId}
            />
          )}
          {hovered && (
            <div className="kg-hover" role="status">
              <i
                style={{ background: groupById.get(hovered.groupId)?.color }}
              />
              <strong>{hovered.label}</strong>
              <span>
                {groupById.get(hovered.groupId)?.label} · {hovered.degree}{" "}
                connections
              </span>
            </div>
          )}
          <div className="kg-map-caption">
            {renderedEdges.length > 0 && (
              <div className="kg-map-key" aria-label="Relationship legend">
                <span>
                  <i aria-hidden="true" />
                  Recorded relationship
                </span>
                {selected && (
                  <span>
                    <i className="is-selected" aria-hidden="true" />
                    Selected note’s links
                  </span>
                )}
                {path && (
                  <span>
                    <i className="is-path" aria-hidden="true" />
                    Traced path
                  </span>
                )}
              </div>
            )}
            {renderedNodes.length > 0 && renderedEdges.length === 0 && (
              <strong className="kg-no-links">
                No links in this view.
                {connectedCount > 0
                  ? " Choose Connected above to explore recorded relationships."
                  : " Import related context or review suggestions to build connections."}
              </strong>
            )}
            <span>
              <i className="kg-live-dot" />
              {renderedNodes.length.toLocaleString()} of{" "}
              {graph.nodes.length.toLocaleString()} notes ·{" "}
              {renderedEdges.length.toLocaleString()} recorded links
            </span>
            <span>
              {mode === "3d"
                ? "Drag to orbit · scroll to zoom · right-drag to pan"
                : "Drag to pan · scroll to zoom"}{" "}
              · select a note to highlight its links
            </span>
            {filteredNodes.length > MAX_RENDERED_NODES && (
              <strong>
                Rendering the {MAX_RENDERED_NODES.toLocaleString()} most
                connected notes in this filter. Search any note or narrow a
                source to reach the rest.
              </strong>
            )}
          </div>
        </main>

        <aside
          className={`kg-inspector${!selected && !showSuggestions && !showGuide ? " kg-inspector-collapsed" : ""}`}
          aria-label={
            showSuggestions ? "Connection suggestions" : "Note details"
          }
        >
          {showSuggestions ? (
            <>
              <div className="kg-section-heading">
                <h3>Suggested connections</h3>
                <button onClick={() => setShowSuggestions(false)}>Close</button>
              </div>
              <p className="kg-fineprint">
                Heuristic suggestions, not established facts. They appear on the
                map only after you record them.
              </p>
              {suggestionsLoading && <p role="status">Finding candidates…</p>}
              {suggestionError && (
                <p role="alert" className="kg-error">
                  {suggestionError}
                </p>
              )}
              {!suggestionsLoading &&
                !suggestionError &&
                !suggestions.length && (
                  <p>No connection suggestions right now.</p>
                )}
              {!suggestionsLoading &&
                suggestions.map((item) => (
                  <article
                    className="kg-suggestion"
                    key={`${item.source_id}:${item.target_id}`}
                  >
                    <h4>
                      {nodeById.get(item.source_id)?.label}{" "}
                      <span aria-hidden="true">↔</span>{" "}
                      {nodeById.get(item.target_id)?.label}
                    </h4>
                    <p>{item.reason}</p>
                    <small>Evidence: {item.evidence_type}</small>
                    <div>
                      <button
                        disabled={!!pendingSuggestion}
                        onClick={() => void resolveSuggestion(item, true)}
                      >
                        Record connection
                      </button>
                      <button
                        disabled={!!pendingSuggestion}
                        onClick={() => void resolveSuggestion(item, false)}
                      >
                        Dismiss suggestion
                      </button>
                    </div>
                  </article>
                ))}
            </>
          ) : selected ? (
            <>
              <div className="kg-section-heading">
                <div className="kg-eyebrow">SELECTED NOTE</div>
                <button
                  aria-label="Close note details"
                  onClick={() => {
                    setSelectedId(null);
                    setFocus(false);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="kg-note-source">
                <i
                  style={{ background: groupById.get(selected.groupId)?.color }}
                />
                {groupById.get(selected.groupId)?.label}
              </div>
              <h2>{selected.label}</h2>
              <dl className="kg-metadata">
                <div>
                  <dt>Type</dt>
                  <dd>{selected.node_type}</dd>
                </div>
                <div>
                  <dt>Layer</dt>
                  <dd>{selected.layer}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{updatedLabel(selected.updated_at)}</dd>
                </div>
                <div>
                  <dt>Words</dt>
                  <dd>
                    {selected.content.trim()
                      ? selected.content
                          .trim()
                          .split(/\s+/)
                          .length.toLocaleString()
                      : 0}
                  </dd>
                </div>
                <div>
                  <dt>Connections</dt>
                  <dd>{selected.degree}</dd>
                </div>
              </dl>
              <div
                className="kg-selection-summary"
                role="status"
                aria-label="Visible connections"
              >
                <strong>
                  {visibleSelectedLinks.toLocaleString()} of{" "}
                  {neighbors.length.toLocaleString()} recorded relationships
                  visible
                </strong>
                <span>
                  {selected.degree === 0
                    ? "This note has no recorded relationships yet."
                    : visibleSelectedLinks < neighbors.length
                      ? "Some links are outside the current filters or display limit. Reset filters or focus connections to explore more."
                      : "Bright arrows follow stored relationship direction. Choose a connected note below to continue exploring."}
                </span>
              </div>
              {reviewReasons(selected).length > 0 && (
                <div className="kg-review-tags">
                  {reviewReasons(selected).map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              )}
              <div
                className={`kg-note-content ${fullNote ? "is-expanded" : ""}`}
              >
                {selected.content
                  ? fullNote
                    ? selected.content
                    : selected.content.slice(0, 700)
                  : "No note content recorded."}
                {!fullNote && selected.content.length > 700 ? "…" : ""}
              </div>
              {selected.content.length > 700 && (
                <button
                  className="kg-text-button"
                  onClick={() => setFullNote((value) => !value)}
                >
                  {fullNote ? "Show less" : "Read full note"}
                </button>
              )}
              <div className="kg-note-actions">
                <button
                  disabled={!selected.degree}
                  title={
                    !selected.degree
                      ? "This record has no connections yet"
                      : undefined
                  }
                  onClick={() => {
                    if (focus) showAll();
                    else {
                      setHiddenGroups(new Set());
                      setAttention(false);
                      setFocus(true);
                      setFitKey((key) => key + 1);
                    }
                  }}
                >
                  {focus ? "Show entire map" : "Focus connections"}
                </button>
                <button
                  disabled={!selected.degree}
                  title={
                    !selected.degree
                      ? "A path needs at least one recorded relationship"
                      : undefined
                  }
                  onClick={() => {
                    setPathFrom(selected.id);
                    setPathTo(null);
                    showAll();
                  }}
                >
                  Start path here
                </button>
                {pathFrom && pathFrom !== selected.id && (
                  <button
                    onClick={() => {
                      setPathTo(selected.id);
                      showAll();
                    }}
                  >
                    Trace to this note
                  </button>
                )}
              </div>
              <div className="kg-section-heading">
                <h3>Connected notes</h3>
                <span>{neighbors.length} relations</span>
              </div>
              <p className="kg-fineprint">
                Arrows show the stored relationship direction.
              </p>
              {edgeError && (
                <p className="kg-error" role="alert">
                  {edgeError}
                </p>
              )}
              <div className="kg-neighbors">
                {!neighbors.length && (
                  <p>
                    No recorded links yet. Review connection suggestions or add
                    context in chat.
                  </p>
                )}
                {neighbors
                  .slice(0, neighborLimit)
                  .map(({ edge, node, outgoing }) => (
                    <article key={edge.id}>
                      <button onClick={() => selectNode(node.id)}>
                        <i
                          style={{
                            background: groupById.get(node.groupId)?.color,
                          }}
                        />
                        <span>
                          {node.label}
                          <small>
                            {outgoing ? "→" : "←"}{" "}
                            {edge.relation.replace(/_/g, " ")} ·{" "}
                            {groupById.get(node.groupId)?.label}
                          </small>
                        </span>
                      </button>
                      <details>
                        <summary>Relationship details</summary>
                        <div className="kg-edge-feedback">
                          <span>
                            Weight {edge.weight.toFixed(2)} · momentum{" "}
                            {edge.momentum.toFixed(2)} · {edge.reinforcements}{" "}
                            reinforcements. Weight is a learning signal, not
                            verified confidence.
                          </span>
                          <button
                            disabled={!!pendingEdge}
                            onClick={() => void feedbackEdge(edge.id, 1)}
                          >
                            Strengthen link
                          </button>
                          <button
                            disabled={!!pendingEdge}
                            onClick={() => void feedbackEdge(edge.id, -0.5)}
                          >
                            Weaken link
                          </button>
                        </div>
                      </details>
                    </article>
                  ))}
                {neighbors.length > neighborLimit && (
                  <button
                    onClick={() => setNeighborLimit((limit) => limit + 30)}
                  >
                    Show more connections ({neighbors.length - neighborLimit})
                  </button>
                )}
              </div>
              <details className="kg-provenance">
                <summary>Record details</summary>
                <dl>
                  <dt>Note ID</dt>
                  <dd>{selected.id}</dd>
                  <dt>Created</dt>
                  <dd>{updatedLabel(selected.created_at)}</dd>
                  <dt>Grouping</dt>
                  <dd>
                    Stored source metadata, explicit project membership, or note
                    type. Grouping does not create relationships.
                  </dd>
                </dl>
              </details>
            </>
          ) : (
            <div className="kg-inspector-empty">
              <div className="kg-orbit-icon" aria-hidden="true">
                ◎
              </div>
              <div className="kg-eyebrow">FOLLOW YOUR CURIOSITY</div>
              <h2>Find the thread.</h2>
              <button
                className="kg-text-button"
                onClick={() => setShowGuide(false)}
              >
                Close guide
              </button>
              <p>
                Select a note to read its content and see what connects to it.
              </p>
              <ol>
                <li>
                  <strong>Discover</strong> Search or choose a source.
                </li>
                <li>
                  <strong>Explore</strong> Open a note and its neighbors.
                </li>
                <li>
                  <strong>Trace</strong> Pick two notes to reveal a path.
                </li>
              </ol>
              <div className="kg-key">
                <p>
                  <i /> Color identifies the source group.
                </p>
                <p>
                  <b>●</b> Bigger nodes connect to more notes.
                </p>
                <p>
                  <span>—</span> Lines are recorded relationships.
                </p>
              </div>
              <p className="kg-fineprint">
                This is a map of stored knowledge, not a live display of agents’
                internal reasoning.
              </p>
            </div>
          )}
        </aside>
      </div>

      {pathFrom && (
        <div className="kg-path" aria-label="Connection path">
          <div>
            <span className="kg-eyebrow">TRACE CONNECTIONS</span>
            <button
              onClick={() => {
                setPathFrom(null);
                setPathTo(null);
              }}
            >
              Clear path
            </button>
          </div>
          {!pathTo ? (
            <p>
              Starting at <strong>{nodeById.get(pathFrom)?.label}</strong>.
              Select another note, then choose “Trace to this note”.
            </p>
          ) : !path ? (
            <p role="status" aria-label="Path result">
              No recorded path between these notes. No relationship has been
              invented.
            </p>
          ) : (
            <>
              <div className="kg-path-steps">
                {path.nodeIds.map((id, index) => {
                  const edge = graph.edges.find(
                    (candidate) => candidate.id === path.edgeIds[index],
                  );
                  return (
                    <span key={id}>
                      <button onClick={() => selectNode(id)}>
                        {nodeById.get(id)?.label}
                      </button>
                      {edge && (
                        <small>
                          {edge.source_id === id ? "→" : "←"}{" "}
                          {edge.relation.replace(/_/g, " ")}
                        </small>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="kg-fineprint">
                {path.edgeIds.length} recorded{" "}
                {path.edgeIds.length === 1 ? "link" : "links"} · navigation
                follows relationships in either direction, not execution flow.
              </p>
            </>
          )}
        </div>
      )}
      {(graph.diagnostics.danglingEdges > 0 ||
        graph.diagnostics.duplicateEdges > 0) && (
        <div className="kg-diagnostics" role="status">
          View integrity: {graph.diagnostics.danglingEdges} links reference
          missing notes; {graph.diagnostics.duplicateEdges} repeated links
          hidden. Stored data has not been changed.
        </div>
      )}
    </section>
  );
}
