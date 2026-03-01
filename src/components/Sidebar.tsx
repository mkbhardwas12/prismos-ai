// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS Sidebar — Navigation, Spectrum Graph, Active Agents

import type { Agent, SpectrumNode } from "../types";
import ActiveAgents from "./ActiveAgents";
import SpectrumGraphView from "./SpectrumGraphView";

interface SidebarProps {
  currentView: string;
  onNavigate: (view: "chat" | "settings") => void;
  agents: Agent[];
  nodes: SpectrumNode[];
}

export default function Sidebar({
  currentView,
  onNavigate,
  agents,
  nodes,
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
            className={`sidebar-item ${currentView === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <span className="sidebar-item-icon">⚙️</span>
            Settings
          </button>
        </div>

        {/* Spectrum Graph */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            Spectrum Graph ({nodes.length})
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
        Patent Pending — US [application number]
        <br />
        Feb 28, 2026 · Local-First AI
      </div>
    </div>
  );
}
