// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — Main Application Shell

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import MainView from "./components/MainView";
import SettingsPanel from "./components/SettingsPanel";
import SpectrumExplorer from "./components/SpectrumExplorer";
import SpectrumGraphView from "./components/SpectrumGraphView";
import SandboxPanel from "./components/SandboxPanel";
import SpectralTimeline from "./components/SpectralTimeline";
import ErrorBoundary from "./components/ErrorBoundary";
import prismosIcon from "./assets/prismos-icon.svg";
import type { Agent, SpectrumNode, AppSettings, GraphStats, CollaborationSummary, DebateSummary, HandoffResult, AgentActivity, ProactiveSuggestion } from "./types";

type View = "chat" | "settings" | "spectrum" | "sandbox" | "graph" | "timeline";

/** Time-aware daily greeting based on hour of day */
function getDailyGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "🌙 Burning the midnight oil?";
  if (h < 12) return "☀️ Good morning";
  if (h < 17) return "🌤️ Good afternoon";
  if (h < 21) return "🌆 Good evening";
  return "🌙 Working late?";
}

function App() {
  const [ready, setReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");

  // ─── Multi-window: detect route hash to open a specific view ──
  const initialView = (() => {
    const hash = window.location.hash.replace("#", "");
    const validViews: View[] = ["chat", "settings", "spectrum", "sandbox", "graph", "timeline"];
    if (validViews.includes(hash as View)) return hash as View;
    return "chat" as View;
  })();

  const [view, setView] = useState<View>(initialView);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [nodes, setNodes] = useState<SpectrumNode[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats>({ nodes: 0, edges: 0 });
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [lastActiveAgent, setLastActiveAgent] = useState<string | null>(null);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [lastCollaboration, setLastCollaboration] = useState<CollaborationSummary | null>(null);
  const [lastDebate, setLastDebate] = useState<DebateSummary | null>(null);
  const [liveAgentSteps, setLiveAgentSteps] = useState<AgentActivity[]>([]);
  const [toast, setToast] = useState<{ message: string; visible: boolean } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [startupSuggestions, setStartupSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [dailyGreeting] = useState(getDailyGreeting);

  // ── Settings: load from localStorage (persists across restarts) ──
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem("prismos-settings");
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AppSettings>;
        const merged = {
          ollamaUrl: parsed.ollamaUrl ?? "http://localhost:11434",
          defaultModel: parsed.defaultModel ?? "mistral",
          theme: parsed.theme ?? "dark",
          maxTokens: parsed.maxTokens ?? 2048,
          voiceInputEnabled: parsed.voiceInputEnabled ?? false,
          voiceOutputEnabled: parsed.voiceOutputEnabled ?? false,
        };
        // Apply saved theme immediately
        document.documentElement.setAttribute("data-theme", merged.theme);
        return merged;
      }
    } catch { /* ignore corrupt data */ }
    return {
      ollamaUrl: "http://localhost:11434",
      defaultModel: "mistral",
      theme: "dark",
      maxTokens: 2048,
      voiceInputEnabled: false,
      voiceOutputEnabled: false,
    };
  });

  // Persist settings whenever they change
  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem("prismos-settings", JSON.stringify(newSettings));
    } catch { /* storage full — ignore */ }
    // Apply theme change immediately
    document.documentElement.setAttribute("data-theme", newSettings.theme);
  }, []);

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
      const connected = await invoke<boolean>("check_ollama_status", { ollamaUrl: settings.ollamaUrl });
      setOllamaConnected(connected);
    } catch {
      setOllamaConnected(false);
    }
  }, [settings.ollamaUrl]);

  // P1+P2: Fetch proactive suggestions from the Spectrum Graph (startup + periodic)
  const fetchProactiveSuggestions = useCallback(async () => {
    try {
      const sugJson = await invoke<string>("get_proactive_suggestions");
      const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
      if (sug.length > 0) setStartupSuggestions(sug);
    } catch { /* non-critical */ }
  }, []);

  // Called after every intent is processed — refreshes all live data
  const onIntentProcessed = useCallback((agentUsed?: string, collaboration?: CollaborationSummary, debate?: DebateSummary | null) => {
    // Store latest collaboration trace for sidebar display
    if (collaboration) {
      setLastCollaboration(collaboration);
    }
    // Store latest debate summary
    if (debate !== undefined) {
      setLastDebate(debate);
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
    // Phase 2: keep live steps visible briefly, then clear
    setTimeout(() => setLiveAgentSteps([]), 4000);
  }, [loadAgents, loadNodes, loadGraphStats]);

  useEffect(() => {
    // ── Startup sequence with loading screen ──
    (async () => {
      try {
        setLoadingStatus("Loading agents...");
        await loadAgents();

        setLoadingStatus("Loading Spectrum Graph...");
        await loadNodes();
        await loadGraphStats();

        setLoadingStatus("Checking Ollama...");
        await checkOllama();

        // ── You-Port: Auto-restore previous session ──
        setLoadingStatus("Checking saved state...");
        try {
          const hasSaved = await invoke<boolean>("has_saved_state");
          if (hasSaved) {
            setLoadingStatus("Restoring session...");
            const resultJson = await invoke<string>("load_state");
            const result: HandoffResult = JSON.parse(resultJson);
            if (result.success) {
              setToast({
                message: `🔐 Restored from last session — ${result.nodes_count} nodes, ${result.edges_count} edges`,
                visible: true,
              });
              await loadNodes();
              await loadGraphStats();
              setGraphRefreshKey((k) => k + 1);
            }
          }
        } catch (e) {
          console.error("You-Port restore failed:", e);
        }

        setLoadingStatus("Ready!");

        // P1: Fetch proactive suggestions on startup (non-blocking)
        fetchProactiveSuggestions();
      } catch (e) {
        console.error("Startup error:", e);
        setErrorBanner(`Startup warning: ${e}`);
      } finally {
        // Small delay for loading animation smoothness
        setTimeout(() => setReady(true), 400);
      }
    })();

    // ── You-Port: Auto-save state on app close ──
    const handleBeforeUnload = () => {
      invoke("save_state").catch((e: unknown) =>
        console.error("You-Port save failed:", e)
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const ollamaInterval = setInterval(checkOllama, 30000);
    // P2: Background proactive refresh every 5 minutes (daily proactive mode)
    const proactiveInterval = setInterval(fetchProactiveSuggestions, 5 * 60 * 1000);
    return () => {
      clearInterval(ollamaInterval);
      clearInterval(proactiveInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [loadAgents, loadNodes, loadGraphStats, checkOllama, fetchProactiveSuggestions]);

  // Auto-hide toast after 5 seconds
  useEffect(() => {
    if (toast?.visible) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ── Phase 2: Listen for real-time agent-activity events from Rust backend ──
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    listen<AgentActivity>("agent-activity", (event) => {
      setLiveAgentSteps((prev) => [...prev, event.payload]);
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Callback for MainView to clear live steps when starting a new intent
  const clearLiveSteps = useCallback(() => {
    setLiveAgentSteps([]);
  }, []);

  function renderView() {
    switch (view) {
      case "chat":
        return (
          <MainView
            ollamaConnected={ollamaConnected}
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onIntentProcessed={onIntentProcessed}
            liveAgentSteps={liveAgentSteps}
            clearLiveSteps={clearLiveSteps}
            startupSuggestions={startupSuggestions}
            dailyGreeting={dailyGreeting}
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
            onSettingsChange={handleSettingsChange}
            ollamaConnected={ollamaConnected}
            graphStats={graphStats}
            onGraphCleared={() => { loadNodes(); loadGraphStats(); setGraphRefreshKey((k) => k + 1); }}
            showToast={(msg) => setToast({ message: msg, visible: true })}
          />
        );
      case "timeline":
        return <SpectralTimeline refreshKey={graphRefreshKey} />;
    }
  }

  // ── Loading screen ──
  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-label="Loading PrismOS-AI" aria-live="polite">
        <img src={prismosIcon} alt="PrismOS-AI" className="app-loading-logo" />
        <div className="app-loading-text" aria-hidden="true">PrismOS-AI</div>
        <div className="app-loading-bar" role="progressbar" aria-label="Loading progress">
          <div className="app-loading-bar-fill" />
        </div>
        <div className="app-loading-status">{loadingStatus}</div>
      </div>
    );
  }

  return (
    <div className="app-layout" role="application" aria-label="PrismOS-AI">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        agents={agents}
        nodes={nodes}
        graphStats={graphStats}
        collaboration={lastCollaboration}
        debateSummary={lastDebate}
        liveAgentSteps={liveAgentSteps}
        proactiveSuggestions={startupSuggestions}
        dailyGreeting={dailyGreeting}
      />
      <main className="main-content" id="main-content" role="main" aria-label="Main content">
        {/* Global error banner */}
        {errorBanner && (
          <div className="error-banner" role="alert" aria-live="assertive">
            <span className="error-banner-icon" aria-hidden="true">⚠️</span>
            <span className="error-banner-text">{errorBanner}</span>
            <button className="error-banner-close" onClick={() => setErrorBanner(null)} aria-label="Dismiss error">×</button>
          </div>
        )}
        <ErrorBoundary fallbackView={view}>
          {renderView()}
        </ErrorBoundary>
      </main>

      {/* You-Port session restore toast */}
      {toast?.visible && (
        <div className="youport-toast" role="status" aria-live="polite">
          <span className="youport-toast-icon" aria-hidden="true">🔒</span>
          <span className="youport-toast-msg">{toast.message}</span>
          <button
            className="youport-toast-close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
