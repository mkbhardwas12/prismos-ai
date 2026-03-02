// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS — Main Application Shell

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import MainView from "./components/MainView";
import SettingsPanel from "./components/SettingsPanel";
import SpectrumExplorer from "./components/SpectrumExplorer";
import SpectrumGraphView from "./components/SpectrumGraphView";
import SandboxPanel from "./components/SandboxPanel";
import type { Agent, SpectrumNode, AppSettings, GraphStats, CollaborationSummary, HandoffResult } from "./types";

type View = "chat" | "settings" | "spectrum" | "sandbox" | "graph";

function App() {
  const [view, setView] = useState<View>("chat");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [nodes, setNodes] = useState<SpectrumNode[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats>({ nodes: 0, edges: 0 });
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [lastActiveAgent, setLastActiveAgent] = useState<string | null>(null);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [lastCollaboration, setLastCollaboration] = useState<CollaborationSummary | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean } | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    ollamaUrl: "http://localhost:11434",
    defaultModel: "mistral",
    theme: "dark",
    maxTokens: 2048,
  });

  const loadAgents = useCallback(async (activeAgent?: string | null) => {
    try {
      const result = await invoke<string>("get_active_agents", {
        activeAgent: activeAgent ?? null,
      });
      setAgents(JSON.parse(result));
    } catch (e) {
      console.error("Failed to load agents:", e);
    }
  }, []);

  const loadNodes = useCallback(async () => {
    try {
      const result = await invoke<string>("get_spectrum_nodes");
      setNodes(JSON.parse(result));
    } catch (e) {
      console.error("Failed to load spectrum nodes:", e);
    }
  }, []);

  const loadGraphStats = useCallback(async () => {
    try {
      const result = await invoke<string>("get_graph_stats");
      setGraphStats(JSON.parse(result));
    } catch (e) {
      console.error("Failed to load graph stats:", e);
    }
  }, []);

  const checkOllama = useCallback(async () => {
    try {
      const connected = await invoke<boolean>("check_ollama_status");
      setOllamaConnected(connected);
    } catch {
      setOllamaConnected(false);
    }
  }, []);

  // Called after every intent is processed — refreshes all live data
  const onIntentProcessed = useCallback((agentUsed?: string, collaboration?: CollaborationSummary) => {
    // Store latest collaboration trace for sidebar display
    if (collaboration) {
      setLastCollaboration(collaboration);
    }
    // Flash the active agent in the sidebar
    if (agentUsed) {
      setLastActiveAgent(agentUsed);
      loadAgents(agentUsed);
      // Reset agent status after 3 seconds
      setTimeout(() => {
        setLastActiveAgent(null);
        loadAgents(null);
      }, 3000);
    }
    // Refresh graph data
    loadNodes();
    loadGraphStats();
    // Signal the SpectrumGraphView to re-fetch
    setGraphRefreshKey((k) => k + 1);
  }, [loadAgents, loadNodes, loadGraphStats]);

  useEffect(() => {
    loadAgents();
    loadNodes();
    loadGraphStats();
    checkOllama();

    // ── You-Port: Auto-restore previous session ──
    (async () => {
      try {
        const hasSaved = await invoke<boolean>("has_saved_state");
        if (hasSaved) {
          const resultJson = await invoke<string>("load_state");
          const result: HandoffResult = JSON.parse(resultJson);
          if (result.success) {
            setToast({
              message: `🔐 Restored from last session — ${result.nodes_count} nodes, ${result.edges_count} edges`,
              visible: true,
            });
            // Refresh all data after restore
            loadNodes();
            loadGraphStats();
            setGraphRefreshKey((k) => k + 1);
          }
        }
      } catch (e) {
        console.error("You-Port restore failed:", e);
      }
    })();

    // ── You-Port: Auto-save state on app close ──
    const handleBeforeUnload = () => {
      invoke("save_state").catch((e: unknown) =>
        console.error("You-Port save failed:", e)
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const interval = setInterval(checkOllama, 30000);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [loadAgents, loadNodes, loadGraphStats, checkOllama]);

  // Auto-hide toast after 5 seconds
  useEffect(() => {
    if (toast?.visible) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  function renderView() {
    switch (view) {
      case "chat":
        return (
          <MainView
            ollamaConnected={ollamaConnected}
            settings={settings}
            onIntentProcessed={onIntentProcessed}
          />
        );
      case "graph":
        return <SpectrumGraphView refreshKey={graphRefreshKey} />;
      case "spectrum":
        return (
          <SpectrumExplorer
            nodes={nodes}
            stats={graphStats}
            onDataChanged={() => { loadNodes(); loadGraphStats(); }}
          />
        );
      case "sandbox":
        return <SandboxPanel />;
      case "settings":
        return (
          <SettingsPanel
            settings={settings}
            onSettingsChange={setSettings}
            ollamaConnected={ollamaConnected}
            graphStats={graphStats}
          />
        );
    }
  }

  return (
    <div className="app-layout">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        agents={agents}
        nodes={nodes}
        graphStats={graphStats}
        collaboration={lastCollaboration}
      />
      <div className="main-content">{renderView()}</div>

      {/* You-Port session restore toast */}
      {toast?.visible && (
        <div className="youport-toast">
          <span className="youport-toast-icon">🔒</span>
          <span className="youport-toast-msg">{toast.message}</span>
          <button
            className="youport-toast-close"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
