// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Sidebar — Navigation, Spectrum Graph, Active Agents

import type { Agent, SpectrumNode, GraphStats } from "../types";
import ActiveAgents from "./ActiveAgents";
import SpectrumGraphView from "./SpectrumGraphView";

interface SidebarProps {
  currentView: string;
  onNavigate: (view: "chat" | "settings" | "spectrum" | "sandbox") => void;
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
        <span className="sidebar-logo">◈ PrismOS</span>
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

        {/* Spectrum Graph Summary */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            Spectrum Graph
            <span className="sidebar-badge">
              {graphStats.nodes}N · {graphStats.edges}E
            </span>
          </div>
          <SpectrumGraphView nodes={nodes} />
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
