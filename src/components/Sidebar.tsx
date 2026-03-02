// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Sidebar — Navigation, Spectrum Graph Mini View, Active Agents

import type { Agent, SpectrumNode, GraphStats } from "../types";
import ActiveAgents from "./ActiveAgents";
import prismosIcon from "../assets/prismos-icon.svg";

interface SidebarProps {
  currentView: string;
  onNavigate: (view: "chat" | "settings" | "spectrum" | "sandbox" | "graph") => void;
  agents: Agent[];
  nodes: SpectrumNode[];
  graphStats: GraphStats;
}

export default function Sidebar({
  currentView,
  onNavigate,
  agents,
  nodes,
  graphStats,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo"><img src={prismosIcon} alt="PrismOS" className="sidebar-logo-img" /> PrismOS</span>
        <span className="sidebar-version">v0.1.0</span>
      </div>

      <nav className="sidebar-nav">
        {/* Navigation */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Navigation</div>
          <button
            className={`sidebar-item ${currentView === "chat" ? "active" : ""}`}
            onClick={() => onNavigate("chat")}
          >
            <span className="sidebar-item-icon">💬</span>
            Intent Console
          </button>
          <button
            className={`sidebar-item ${currentView === "graph" ? "active" : ""}`}
            onClick={() => onNavigate("graph")}
          >
            <span className="sidebar-item-icon">🕸️</span>
            Spectrum Graph
          </button>
          <button
            className={`sidebar-item ${currentView === "spectrum" ? "active" : ""}`}
            onClick={() => onNavigate("spectrum")}
          >
            <span className="sidebar-item-icon">🌈</span>
            Spectrum Explorer
          </button>
          <button
            className={`sidebar-item ${currentView === "sandbox" ? "active" : ""}`}
            onClick={() => onNavigate("sandbox")}
          >
            <span className="sidebar-item-icon">🔒</span>
            Sandbox Prisms
          </button>
          <button
            className={`sidebar-item ${currentView === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <span className="sidebar-item-icon">⚙️</span>
            Settings
          </button>
        </div>

        {/* Spectrum Graph Mini Summary */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            Graph Overview
            <span className="sidebar-badge">
              {graphStats.nodes}N · {graphStats.edges}E
            </span>
          </div>
          <div className="spectrum-view">
            {nodes.length === 0 ? (
              <div className="spectrum-empty">
                No nodes yet. Start a conversation to build your graph.
              </div>
            ) : (
              <ul className="spectrum-node-list">
                {nodes.slice(0, 12).map((node) => (
                  <li
                    key={node.id}
                    className="spectrum-node-item"
                    title={`${node.node_type}: ${node.content.slice(0, 100)}`}
                  >
                    <span className={`spectrum-node-dot type-${node.node_type}`} />
                    <span>{node.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {nodes.length > 12 && (
              <button
                className="sidebar-item"
                onClick={() => onNavigate("graph")}
                style={{ fontSize: "0.75rem", opacity: 0.7 }}
              >
                View all {nodes.length} nodes →
              </button>
            )}
          </div>
        </div>

        {/* Active Agents */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Active Agents</div>
          <ActiveAgents agents={agents} />
        </div>
      </nav>

      <div className="sidebar-footer">
        Patent Pending — US 63/993,589
        <br />
        Feb 28, 2026 · Local-First AI
      </div>
    </div>
  );
}
