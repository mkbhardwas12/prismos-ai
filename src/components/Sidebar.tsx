// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Sidebar — Navigation, Spectrum Graph Mini View, Active Agents

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent, SpectrumNode, GraphStats, CollaborationSummary, DebateSummary, AgentActivity } from "../types";
import ActiveAgents from "./ActiveAgents";
import prismosIcon from "../assets/prismos-icon.svg";
import "./Sidebar.css";

type View = "chat" | "settings" | "spectrum" | "sandbox" | "graph" | "timeline";

interface SidebarProps {
  currentView: string;
  onNavigate: (view: View) => void;
  agents: Agent[];
  nodes: SpectrumNode[];
  graphStats: GraphStats;
  collaboration?: CollaborationSummary | null;
  debateSummary?: DebateSummary | null;
  liveAgentSteps?: AgentActivity[];
}

export default function Sidebar({
  currentView,
  onNavigate,
  agents,
  nodes,
  graphStats,
  collaboration,
  debateSummary,
  liveAgentSteps,
}: SidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  const handleNavigate = useCallback((view: View) => {
    onNavigate(view);
    setSidebarOpen(false);
  }, [onNavigate]);

  // Keyboard shortcuts: Ctrl+1-6 for views, Escape to close sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Escape closes sidebar on mobile
      if (e.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      // Ctrl+number shortcuts for navigation
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const viewMap: Record<string, View> = {
          "1": "chat",
          "2": "graph",
          "3": "spectrum",
          "4": "sandbox",
          "5": "timeline",
          "6": "settings",
        };
        const view = viewMap[e.key];
        if (view) {
          e.preventDefault();
          handleNavigate(view);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen, handleNavigate]);

  const openWindow = (label: string, title: string, route: string) => {
    invoke("open_graph_window", { label, title, route }).catch(console.error);
  };

  return (
    <>
      {/* Hamburger button for mobile */}
      <button
        className="sidebar-collapse-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>

      {/* Overlay for mobile sidebar */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <div className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} role="complementary" aria-label="Sidebar navigation">
        <div className="sidebar-header">
          <span className="sidebar-logo"><img src={prismosIcon} alt="PrismOS" className="sidebar-logo-img" /> PrismOS</span>
          <span className="sidebar-version">v0.2.0</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {/* Navigation */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">Navigation</div>
            <button
              className={`sidebar-item ${currentView === "chat" ? "active" : ""}`}
              onClick={() => handleNavigate("chat")}
              aria-current={currentView === "chat" ? "page" : undefined}
              title="Chat with your AI agents — send intents and get intelligent responses"
            >
              <span className="sidebar-item-icon" aria-hidden="true">💬</span>
              Intent Console
              <span className="kbd" aria-hidden="true">⌃1</span>
            </button>

            {/* Graph — uses sibling layout instead of nested button */}
            <div className="sidebar-item-row">
              <button
                className={`sidebar-item sidebar-item-grow ${currentView === "graph" ? "active" : ""}`}
                onClick={() => handleNavigate("graph")}
                aria-current={currentView === "graph" ? "page" : undefined}
                title="Interactive force-directed visualization of your knowledge connections"
              >
                <span className="sidebar-item-icon" aria-hidden="true">🕸️</span>
                Spectrum Graph
                <span className="kbd" aria-hidden="true">⌃2</span>
              </button>
              <button
                className="sidebar-item-window-btn"
                title="Open Spectrum Graph in new window"
                aria-label="Open Spectrum Graph in new window"
                onClick={() => openWindow("spectrum-graph-window", "PrismOS — Spectrum Graph", "graph")}
              >
                ↗
              </button>
            </div>

            <button
              className={`sidebar-item ${currentView === "spectrum" ? "active" : ""}`}
              onClick={() => handleNavigate("spectrum")}
              aria-current={currentView === "spectrum" ? "page" : undefined}
              title="Browse, search, and manage all nodes in your knowledge graph"
            >
              <span className="sidebar-item-icon" aria-hidden="true">🌈</span>
              Spectrum Explorer
              <span className="kbd" aria-hidden="true">⌃3</span>
            </button>
            <button
              className={`sidebar-item ${currentView === "sandbox" ? "active" : ""}`}
              onClick={() => handleNavigate("sandbox")}
              aria-current={currentView === "sandbox" ? "page" : undefined}
              title="Execute AI actions in isolated sandboxes with cryptographic rollback"
            >
              <span className="sidebar-item-icon" aria-hidden="true">🔒</span>
              Sandbox Prisms
              <span className="kbd" aria-hidden="true">⌃4</span>
            </button>

            {/* Timeline — uses sibling layout instead of nested button */}
            <div className="sidebar-item-row">
              <button
                className={`sidebar-item sidebar-item-grow ${currentView === "timeline" ? "active" : ""}`}
                onClick={() => handleNavigate("timeline")}
                aria-current={currentView === "timeline" ? "page" : undefined}
                title="Time-based history of all knowledge graph events and changes"
              >
                <span className="sidebar-item-icon" aria-hidden="true">📅</span>
                Spectral Timeline
                <span className="kbd" aria-hidden="true">⌃5</span>
              </button>
              <button
                className="sidebar-item-window-btn"
                title="Open Spectral Timeline in new window"
                aria-label="Open Spectral Timeline in new window"
                onClick={() => openWindow("spectral-timeline-window", "PrismOS — Spectral Timeline", "timeline")}
              >
                ↗
              </button>
            </div>

            <button
              className={`sidebar-item ${currentView === "settings" ? "active" : ""}`}
              onClick={() => handleNavigate("settings")}
              aria-current={currentView === "settings" ? "page" : undefined}
              title="Configure Ollama, themes, graph sync, export/import, and security"
            >
              <span className="sidebar-item-icon" aria-hidden="true">⚙️</span>
              Settings
              <span className="kbd" aria-hidden="true">⌃6</span>
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
              {(() => {
                // Filter out placeholder / seed nodes with generic labels
                const realNodes = nodes.filter(
                  (n) => !/^(chat|how do you work|test|placeholder)/i.test(n.label.trim())
                );
                if (realNodes.length === 0) {
                  return (
                    <div className="spectrum-empty">
                      <div className="spectrum-growing-pulse" />
                      <span className="spectrum-growing-text">🌱 Memory is growing…</span>
                      <span>Send an intent to start building your knowledge graph.</span>
                    </div>
                  );
                }
                return (
                  <>
                    <ul className="spectrum-node-list">
                      {realNodes.slice(0, 10).map((node) => (
                        <li
                          key={node.id}
                          className="spectrum-node-item"
                          title={`${node.node_type}: ${node.content.slice(0, 100)}`}
                        >
                          <span className={`spectrum-node-dot type-${node.node_type}`} />
                          <span className="spectrum-node-label">{node.label}</span>
                          <span className="spectrum-node-type-tag">{node.node_type}</span>
                        </li>
                      ))}
                    </ul>
                    {realNodes.length > 10 && (
                      <button
                        className="sidebar-more-btn"
                        onClick={() => handleNavigate("graph")}
                      >
                        View all {realNodes.length} nodes →
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Active Agents */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">Active Agents</div>
            <ActiveAgents agents={agents} collaboration={collaboration} debateSummary={debateSummary} liveAgentSteps={liveAgentSteps} />
          </div>
        </nav>

        <div className="sidebar-footer">
          Patent Pending
          <br />
          Local-First AI · Feb 2026
        </div>
      </div>
    </>
  );
}
