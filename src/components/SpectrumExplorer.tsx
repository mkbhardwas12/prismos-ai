// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Spectrum Explorer — Full Knowledge Graph Browser

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SpectrumNode, SpectrumEdge, GraphStats } from "../types";
import "./SpectrumExplorer.css";

interface SpectrumExplorerProps {
  nodes: SpectrumNode[];
  stats: GraphStats;
  onDataChanged: () => void;
}

export default function SpectrumExplorer({
  nodes,
  stats,
  onDataChanged,
}: SpectrumExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpectrumNode[] | null>(null);
  const [selectedNode, setSelectedNode] = useState<SpectrumNode | null>(null);
  const [connections, setConnections] = useState<SpectrumEdge[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState("");
  const [newNodeContent, setNewNodeContent] = useState("");
  const [newNodeType, setNewNodeType] = useState("note");
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    try {
      const result = await invoke<string>("search_spectrum_nodes", {
        query: searchQuery,
      });
      setSearchResults(JSON.parse(result));
    } catch (e) {
      console.error("Search failed:", e);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const handleSelectNode = useCallback(async (node: SpectrumNode) => {
    setSelectedNode(node);
    try {
      const result = await invoke<string>("get_node_connections", {
        nodeId: node.id,
      });
      setConnections(JSON.parse(result));
    } catch {
      setConnections([]);
    }
  }, []);

  const handleDeleteNode = useCallback(
    async (id: string) => {
      if (confirmDeleteId !== id) {
        setConfirmDeleteId(id);
        setTimeout(() => setConfirmDeleteId(null), 5000);
        return;
      }
      try {
        await invoke("delete_spectrum_node", { id });
        setSelectedNode(null);
        setSearchResults(null);
        setConfirmDeleteId(null);
        onDataChanged();
      } catch (e) {
        console.error("Delete failed:", e);
      }
    },
    [onDataChanged, confirmDeleteId]
  );

  const handleAddNode = useCallback(async () => {
    if (!newNodeLabel.trim() || !newNodeContent.trim()) return;
    try {
      await invoke("add_spectrum_node", {
        label: newNodeLabel,
        content: newNodeContent,
        nodeType: newNodeType,
      });
      setNewNodeLabel("");
      setNewNodeContent("");
      setShowAddForm(false);
      onDataChanged();
    } catch (e) {
      console.error("Add node failed:", e);
    }
  }, [newNodeLabel, newNodeContent, newNodeType, onDataChanged]);

  const displayNodes = searchResults ?? nodes;

  return (
    <>
      <div className="main-header">
        <h2>🌈 Spectrum Explorer</h2>
        <div className="graph-stats">
          <span className="stat-badge">{stats.nodes} nodes</span>
          <span className="stat-badge">{stats.edges} edges</span>
        </div>
      </div>

      <div className="explorer-container">
        {/* Search + Actions Bar */}
        <div className="explorer-toolbar">
          <div className="search-bar">
            <label htmlFor="spectrum-search" className="sr-only">Search knowledge graph</label>
            <input
              id="spectrum-search"
              type="text"
              className="search-input"
              placeholder="Search knowledge graph..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              className="toolbar-btn"
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? "..." : "🔍"}
            </button>
            {searchResults && (
              <button
                className="toolbar-btn"
                onClick={() => {
                  setSearchResults(null);
                  setSearchQuery("");
                }}
              >
                ✕
              </button>
            )}
          </div>
          <button
            className="toolbar-btn primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? "Cancel" : "+ New Node"}
          </button>
        </div>

        {/* Add Node Form */}
        {showAddForm && (
          <div className="add-node-form" role="form" aria-label="Add new node">
            <label htmlFor="node-label" className="sr-only">Node label</label>
            <input
              id="node-label"
              className="form-input"
              placeholder="Node label..."
              value={newNodeLabel}
              onChange={(e) => setNewNodeLabel(e.target.value)}
            />
            <label htmlFor="node-content" className="sr-only">Node content</label>
            <textarea
              id="node-content"
              className="form-textarea"
              placeholder="Node content..."
              value={newNodeContent}
              onChange={(e) => setNewNodeContent(e.target.value)}
              rows={3}
            />
            <div className="form-row">
              <label htmlFor="node-type" className="sr-only">Node type</label>
              <select
                id="node-type"
                className="form-select"
                value={newNodeType}
                onChange={(e) => setNewNodeType(e.target.value)}
              >
                <option value="note">📝 Note</option>
                <option value="conversation">💬 Conversation</option>
                <option value="memory">🧠 Memory</option>
                <option value="task">✅ Task</option>
              </select>
              <button className="toolbar-btn primary" onClick={handleAddNode}>
                Add Node
              </button>
            </div>
          </div>
        )}

        {searchResults && (
          <div className="search-info">
            Found {searchResults.length} result
            {searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
          </div>
        )}

        {/* Content Area */}
        <div className="explorer-content">
          {/* Node List */}
          <div className="node-list-panel">
            {displayNodes.length === 0 ? (
              <div className="explorer-empty">
                {searchResults
                  ? "No nodes match your search."
                  : "No knowledge nodes yet. Start a conversation or add a note!"}
              </div>
            ) : (
              displayNodes.map((node) => (
                <div
                  key={node.id}
                  className={`explorer-node-card ${selectedNode?.id === node.id ? "selected" : ""}`}
                  onClick={() => handleSelectNode(node)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectNode(node); } }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedNode?.id === node.id}
                >
                  <div className="node-card-header">
                    <span className={`node-type-badge type-${node.node_type}`}>
                      {node.node_type}
                    </span>
                    <span className="node-date">
                      {new Date(node.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="node-card-label">{node.label}</div>
                  <div className="node-card-preview">
                    {node.content.slice(0, 120)}
                    {node.content.length > 120 ? "..." : ""}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Node Detail Panel */}
          <div className="node-detail-panel">
            {selectedNode ? (
              <>
                <div className="detail-header">
                  <h3>{selectedNode.label}</h3>
                  <button
                    className={`toolbar-btn ${confirmDeleteId === selectedNode.id ? "danger-confirm" : "danger"}`}
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    title={confirmDeleteId === selectedNode.id ? "Click again to confirm deletion" : "Delete node"}
                    aria-label={confirmDeleteId === selectedNode.id ? "Confirm delete" : "Delete node"}
                  >
                    {confirmDeleteId === selectedNode.id ? "⚠️ Confirm?" : "🗑️"}
                  </button>
                </div>
                <div className="detail-meta">
                  <span className={`node-type-badge type-${selectedNode.node_type}`}>
                    {selectedNode.node_type}
                  </span>
                  <span>
                    Created: {new Date(selectedNode.created_at).toLocaleString()}
                  </span>
                  <span>
                    Updated: {new Date(selectedNode.updated_at).toLocaleString()}
                  </span>
                </div>
                <div className="detail-content">
                  <pre>{selectedNode.content}</pre>
                </div>
                {connections.length > 0 && (
                  <div className="detail-connections">
                    <h4>Connections ({connections.length})</h4>
                    {connections.map((edge) => (
                      <div key={edge.id} className="connection-item">
                        <span className="connection-relation">
                          {edge.relation}
                        </span>
                        <span className="connection-weight">
                          w: {edge.weight.toFixed(2)}
                        </span>
                        <span className="connection-target">
                          → {edge.source_id === selectedNode.id
                            ? edge.target_id.slice(0, 8)
                            : edge.source_id.slice(0, 8)}...
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="detail-id">ID: {selectedNode.id}</div>
              </>
            ) : (
              <div className="detail-empty">
                <div className="detail-empty-icon">🌈</div>
                <p>Select a node to view its details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
