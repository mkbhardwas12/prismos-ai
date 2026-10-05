// PrismOS-AI Sidebar — calm, chat-first navigation.
//
// Five plain destinations up top, two quiet ones below, and everything that
// used to compete for attention (suggestions, graph overview, agents) folded
// into one Insights drawer that remembers whether you left it open.

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent, SpectrumNode, GraphStats, CollaborationSummary, DebateSummary, AgentActivity, ProactiveSuggestion } from "../types";
import ActiveAgents from "./ActiveAgents";
import ProactivePanel from "./ProactivePanel";
import PrismosMark from "./PrismosMark";
import { APP_VERSION } from "../lib/appVersion";
import "./Sidebar.css";

type View = "chat" | "settings" | "spectrum" | "sandbox" | "graph" | "timeline" | "dashboard";

interface SidebarProps {
  currentView: string;
  onNavigate: (view: View) => void;
  agents: Agent[];
  nodes: SpectrumNode[];
  graphStats: GraphStats;
  collaboration?: CollaborationSummary | null;
  debateSummary?: DebateSummary | null;
  liveAgentSteps?: AgentActivity[];
  proactiveSuggestions?: ProactiveSuggestion[];
  dailyGreeting?: string;
}

// ── Line icons (currentColor, 18px) ────────────────────────────────────────────
const Icon = ({ children }: { children: ReactNode }) => (
  <svg className="sb-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IconChat = () => <Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></Icon>;
const IconToday = () => <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
const IconMemory = () => <Icon><circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="12" cy="17" r="2.2" /><path d="M8 8l2.8 7M16.4 7.6 13.3 15M8.2 6.8l7.6-.6" /></Icon>;
const IconLibrary = () => <Icon><path d="M4 5h16M4 12h16M4 19h10" /></Icon>;
const IconTimeline = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
const IconSandbox = () => <Icon><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /></Icon>;
const IconSettings = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Icon>;
const IconPopout = () => <Icon><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>;
const IconLock = () => <Icon><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></Icon>;
const IconChevron = ({ open }: { open: boolean }) => (
  <svg className={`sb-chevron ${open ? "open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
);

interface NavEntry {
  view: View;
  label: string;
  hint: string;
  shortcut: string;
  icon: ReactNode;
  popout?: { label: string; title: string; route: string };
}

const PRIMARY: NavEntry[] = [
  { view: "chat", label: "Chat", hint: "Ask anything, attach a file, or describe what to build", shortcut: "⌃1", icon: <IconChat /> },
  { view: "dashboard", label: "Today", hint: "Your morning brief and what changed since yesterday", shortcut: "⌃7", icon: <IconToday /> },
  { view: "graph", label: "Memory", hint: "How the things you've worked on connect", shortcut: "⌃2", icon: <IconMemory />, popout: { label: "spectrum-graph-window", title: "PrismOS-AI — Memory", route: "graph" } },
  { view: "spectrum", label: "Library", hint: "Browse, search and tidy everything PrismOS remembers", shortcut: "⌃3", icon: <IconLibrary /> },
  { view: "timeline", label: "Timeline", hint: "Everything that happened, in order", shortcut: "⌃5", icon: <IconTimeline />, popout: { label: "spectral-timeline-window", title: "PrismOS-AI — Timeline", route: "timeline" } },
];

const SECONDARY: NavEntry[] = [
  { view: "sandbox", label: "Sandbox", hint: "Run actions in isolation, with automatic rollback", shortcut: "⌃4", icon: <IconSandbox /> },
  { view: "settings", label: "Settings", hint: "Model, theme, privacy, export and import", shortcut: "⌃6", icon: <IconSettings /> },
];

const INSIGHTS_KEY = "prismos.sidebar.insightsOpen";

function readInsightsOpen(): boolean {
  try {
    return localStorage.getItem(INSIGHTS_KEY) === "1";
  } catch {
    return false;
  }
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
  dailyGreeting = "",
}: SidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(readInsightsOpen);

  // Close the sidebar on navigation (narrow windows)
  const handleNavigate = useCallback((view: View) => {
    onNavigate(view);
    setSidebarOpen(false);
  }, [onNavigate]);

  const toggleInsights = () => {
    setInsightsOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(INSIGHTS_KEY, next ? "1" : "0");
      } catch {
        /* private mode or blocked storage: the drawer still works for this session */
      }
      return next;
    });
  };

  // Keyboard shortcuts: Ctrl+1-7 for views, Escape closes the narrow-window sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const viewMap: Record<string, View> = {
          "1": "chat",
          "2": "graph",
          "3": "spectrum",
          "4": "sandbox",
          "5": "timeline",
          "6": "settings",
          "7": "dashboard",
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

  // Seed / placeholder nodes don't count as memories
  const realNodes = nodes.filter((n) => !/^(chat|how do you work|test|placeholder)/i.test(n.label.trim()));
  const busyAgents = agents.filter((a) => a.status && a.status !== "Idle").length;

  const renderEntry = (entry: NavEntry) => {
    const active = currentView === entry.view;
    const button = (
      <button
        key={entry.view}
        className={`sidebar-item ${entry.popout ? "sidebar-item-grow" : ""} ${active ? "active" : ""}`}
        onClick={() => handleNavigate(entry.view)}
        aria-current={active ? "page" : undefined}
        title={entry.hint}
      >
        <span className="sidebar-item-icon">{entry.icon}</span>
        <span className="sidebar-item-text">{entry.label}</span>
        <span className="kbd" aria-hidden="true">{entry.shortcut}</span>
      </button>
    );
    if (!entry.popout) return button;
    const popout = entry.popout;
    return (
      <div className="sidebar-item-row" key={entry.view}>
        {button}
        <button
          className="sidebar-item-window-btn"
          title={`Open ${entry.label} in a new window`}
          aria-label={`Open ${entry.label} in a new window`}
          onClick={() => openWindow(popout.label, popout.title, popout.route)}
        >
          <IconPopout />
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Menu button for narrow windows */}
      <button
        className="sidebar-collapse-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>

      <div
        className={`sidebar-overlay ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <div className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} role="complementary" aria-label="Sidebar navigation">
        <div className="sidebar-header">
          <span className="sidebar-logo">
            <PrismosMark className="sidebar-logo-img" title="PrismOS" />
            <span className="sidebar-wordmark">PrismOS</span>
          </span>
          <span className="sidebar-version" title={`PrismOS-AI ${APP_VERSION}`}>v{APP_VERSION}</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="sidebar-section">
            {PRIMARY.map(renderEntry)}
          </div>

          <div className="sidebar-section sidebar-section--quiet">
            {SECONDARY.map(renderEntry)}
            <button
              className="sidebar-link"
              onClick={() => window.dispatchEvent(new CustomEvent("prismos:open-brain-wrapped"))}
              title="A shareable look back at what you've been thinking about"
            >
              Your year in thinking
            </button>
          </div>

          {/* ── Insights drawer: suggestions, memory overview, agents ── */}
          <section className={`sidebar-insights ${insightsOpen ? "is-open" : ""}`} aria-label="Insights">
            <button
              className="sidebar-insights-toggle"
              onClick={toggleInsights}
              aria-expanded={insightsOpen}
              aria-controls="sidebar-insights-body"
            >
              <IconChevron open={insightsOpen} />
              <span className="sidebar-insights-title">Insights</span>
              <span className="sidebar-insights-meta">
                {graphStats.nodes.toLocaleString()} nodes{busyAgents > 0 ? ` · ${busyAgents} working` : ""}
              </span>
            </button>

            {insightsOpen && (
              <div id="sidebar-insights-body" className="sidebar-insights-body">
                <ProactivePanel
                  nodes={nodes}
                  dailyGreeting={dailyGreeting}
                  onSuggestionSelect={(intent) => {
                    handleNavigate("chat");
                    window.dispatchEvent(new CustomEvent("prismos:fill-intent", { detail: intent }));
                  }}
                />

                <div className="sidebar-subsection">
                  <div className="sidebar-section-title">
                    Recent memories
                    <span className="sidebar-badge">{graphStats.edges.toLocaleString()} links</span>
                  </div>
                  {realNodes.length === 0 ? (
                    <div className="spectrum-empty">
                      <span className="spectrum-growing-text">Nothing remembered yet.</span>
                      <span>Ask something or attach a file and it starts here.</span>
                    </div>
                  ) : (
                    <>
                      <ul className="spectrum-node-list">
                        {realNodes.slice(0, 8).map((node) => (
                          <li key={node.id} className="spectrum-node-item" title={`${node.node_type}: ${node.content.slice(0, 100)}`}>
                            <span className={`spectrum-node-dot type-${node.node_type}`} />
                            <span className="spectrum-node-label">{node.label}</span>
                          </li>
                        ))}
                      </ul>
                      {realNodes.length > 8 && (
                        <button className="sidebar-more-btn" onClick={() => handleNavigate("graph")}>
                          See all {realNodes.length.toLocaleString()} in Memory
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="sidebar-subsection">
                  <div className="sidebar-section-title">Agents</div>
                  <ActiveAgents agents={agents} collaboration={collaboration} debateSummary={debateSummary} liveAgentSteps={liveAgentSteps} />
                </div>
              </div>
            )}
          </section>
        </nav>

        <div className="sidebar-footer" title="The model runs on this computer. Nothing you type or attach is uploaded.">
          <IconLock />
          <span>On this computer · nothing uploaded</span>
        </div>
      </div>
    </>
  );
}
