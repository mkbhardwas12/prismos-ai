// PrismOS-AI — Main Application Shell

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "./components/Sidebar";
import MainView from "./components/MainView";
import SettingsPanel from "./components/SettingsPanel";
import SpectrumExplorer from "./components/SpectrumExplorer";
import SpectrumGraphView from "./components/SpectrumGraphView";
import SandboxPanel from "./components/SandboxPanel";
import ResearchPanel from "./components/ResearchPanel";
import SpectralTimeline from "./components/SpectralTimeline";
import DailyDashboard from "./components/DailyDashboard";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingWizard from "./components/OnboardingWizard";
import SpotlightOverlay from "./components/SpotlightOverlay";
import BrainWrapped from "./components/BrainWrapped";
import { DEFAULT_SETTINGS } from "./lib/config";
import { normalizeAgentActivity } from "./lib/agentActivity";
import prismosIcon from "./assets/prismos-icon.svg";
import type { Agent, SpectrumNode, AppSettings, GraphStats, CollaborationSummary, DebateSummary, AgentActivity, ProactiveSuggestion, GraphAnswerTrace } from "./types";

type View = "chat" | "settings" | "spectrum" | "sandbox" | "graph" | "timeline" | "dashboard" | "research";

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
    const validViews: View[] = ["chat", "settings", "spectrum", "sandbox", "graph", "timeline", "dashboard", "research"];
    if (validViews.includes(hash as View)) return hash as View;
    // Check for defaultView from settings
    try {
      const saved = localStorage.getItem("prismos-settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.defaultView && validViews.includes(parsed.defaultView)) {
          return parsed.defaultView as View;
        }
      }
    } catch { /* ignore */ }
    return "chat" as View;
  })();

  const [view, setView] = useState<View>(initialView);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [nodes, setNodes] = useState<SpectrumNode[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats>({ nodes: 0, edges: 0 });
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [lastActiveAgent, setLastActiveAgent] = useState<string | null>(null);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [lastGraphTrace, setLastGraphTrace] = useState<GraphAnswerTrace | null>(null);
  const [lastCollaboration, setLastCollaboration] = useState<CollaborationSummary | null>(null);
  const [lastDebate, setLastDebate] = useState<DebateSummary | null>(null);
  const [liveAgentSteps, setLiveAgentSteps] = useState<AgentActivity[]>([]);
  const activeActivityTaskRef = useRef<string | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [startupSuggestions, setStartupSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [dailyGreeting] = useState(getDailyGreeting);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem("prismos-onboarding-done")
  );
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [brainWrappedOpen, setBrainWrappedOpen] = useState(false);

  // ── Brain Wrapped: open via custom event from Sidebar / Spotlight ──
  useEffect(() => {
    const open = () => setBrainWrappedOpen(true);
    window.addEventListener("prismos:open-brain-wrapped", open);
    return () => window.removeEventListener("prismos:open-brain-wrapped", open);
  }, []);

  // ── Settings: load from localStorage (persists across restarts) ──
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem("prismos-settings");
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AppSettings>;
        const merged = {
          ollamaUrl: parsed.ollamaUrl ?? DEFAULT_SETTINGS.ollamaUrl,
          defaultModel: parsed.defaultModel ?? DEFAULT_SETTINGS.defaultModel,
          theme: parsed.theme ?? DEFAULT_SETTINGS.theme,
          maxTokens: parsed.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
          voiceInputEnabled: parsed.voiceInputEnabled ?? DEFAULT_SETTINGS.voiceInputEnabled,
          voiceOutputEnabled: parsed.voiceOutputEnabled ?? DEFAULT_SETTINGS.voiceOutputEnabled,
          // These integrations are intentionally disabled until their secrets,
          // approved paths, and network disclosures have a non-WebView store.
          // Rewriting the safe shape below also removes legacy plaintext IMAP
          // credentials from localStorage during upgrade.
          emailSummaryEnabled: false,
          calendarEnabled: false,
          financeEnabled: false,
          defaultView: parsed.defaultView ?? DEFAULT_SETTINGS.defaultView,
        };
        localStorage.setItem("prismos-settings", JSON.stringify(merged));
        // Apply saved theme immediately
        document.documentElement.setAttribute("data-theme", merged.theme);
        return merged;
      }
    } catch { /* ignore corrupt data */ }
    return { ...DEFAULT_SETTINGS };
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
      const connected = await invoke<boolean>("check_local_inference_status");
      setOllamaConnected(connected);
    } catch {
      setOllamaConnected(false);
    }
  }, []);

  // Fast reconnect probe while offline: the 30s baseline poll leaves the badge
  // saying "Offline" long after `ollama serve` comes up. While disconnected,
  // probe every 8s so the UI flips to online by itself shortly after Ollama
  // starts — no restart or manual refresh needed.
  useEffect(() => {
    if (ollamaConnected) return;
    const iv = setInterval(checkOllama, 8000);
    return () => clearInterval(iv);
  }, [ollamaConnected, checkOllama]);

  // P1+P2: Fetch proactive suggestions from the Spectrum Graph (startup + periodic)
  const fetchProactiveSuggestions = useCallback(async () => {
    try {
      const sugJson = await invoke<string>("get_proactive_suggestions");
      const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
      if (sug.length > 0) setStartupSuggestions(sug);
    } catch { /* non-critical */ }
  }, []);

  // Called after every intent is processed — refreshes all live data
  const onIntentProcessed = useCallback((agentUsed?: string, collaboration?: CollaborationSummary, debate?: DebateSummary | null, graphTrace?: GraphAnswerTrace) => {
    // Store latest collaboration trace for sidebar display
    if (collaboration) {
      setLastCollaboration(collaboration);
    }
    // Store latest debate summary
    if (debate !== undefined) {
      setLastDebate(debate);
    }
    if (graphTrace !== undefined) {
      setLastGraphTrace(graphTrace);
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
    // Keep the completed decision trace in memory for inspection. Starting a
    // new request, clearing the conversation, or dismissing the trace clears it.
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

    const ollamaInterval = setInterval(checkOllama, 30000);
    // P2: Background proactive refresh every 5 minutes (daily proactive mode)
    const proactiveInterval = setInterval(fetchProactiveSuggestions, 5 * 60 * 1000);
    return () => {
      clearInterval(ollamaInterval);
      clearInterval(proactiveInterval);
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
    let disposed = false;
    listen<unknown>("agent-activity", (event) => {
      const activity = normalizeAgentActivity(event.payload);
      if (!activity || activity.task_id !== activeActivityTaskRef.current) return;
      // Keep a bounded event history. The activity feed coalesces these events
      // into one live row per role and labels the retained count explicitly.
      setLiveAgentSteps((prev) => [...prev, activity].slice(-120));
    }).then((fn) => {
      if (disposed) fn();
      else unlistenFn = fn;
    });
    return () => {
      disposed = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Callback for MainView to clear live steps when starting a new intent
  const clearLiveSteps = useCallback((taskId?: string) => {
    activeActivityTaskRef.current = taskId ?? null;
    setLiveAgentSteps([]);
  }, []);

  // ── Dynamic Spectrum Theming: change accent hue based on active view ──
  useEffect(() => {
    document.documentElement.setAttribute("data-spectrum", view);
  }, [view]);

  // ── Global Hotkey: Ctrl+Space AND Alt+Space — Background Omnipresence ──
  // Alt+Space summons PrismOS over any app (always-on-top, focused, ready to go)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");

        const bringToFront = async () => {
          const win = getCurrentWindow();
          try {
            await win.setAlwaysOnTop(true);
            await win.unminimize();
            await win.show();
            await win.setFocus();
            // Release always-on-top after a short delay so it doesn't stay pinned
            setTimeout(async () => {
              try { await win.setAlwaysOnTop(false); } catch { /* ignore */ }
            }, 500);
          } catch { /* window API not available */ }
        };

        // Register Ctrl+Space (legacy shortcut)
        await register("CommandOrControl+Space", (event) => {
          if (event.state === "Pressed") {
            setSpotlightOpen((prev) => !prev);
            bringToFront();
          }
        });

        // Register Alt+Space — Background Omnipresence shortcut
        await register("Alt+Space", (event) => {
          if (event.state === "Pressed") {
            setSpotlightOpen((prev) => !prev);
            bringToFront();
          }
        });

        cleanup = () => {
          unregister("CommandOrControl+Space").catch(() => {});
          unregister("Alt+Space").catch(() => {});
        };
      } catch (e) {
        console.warn("Global shortcut registration failed (non-critical):", e);
      }
    })();
    return () => { if (cleanup) cleanup(); };
  }, []);

  // ── Listen for Spotlight navigation events ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const validViews: View[] = ["chat", "settings", "spectrum", "sandbox", "graph", "timeline", "dashboard", "research"];
      if (validViews.includes(detail as View)) {
        setView(detail as View);
      }
    };
    window.addEventListener("prismos:navigate", handler);
    return () => window.removeEventListener("prismos:navigate", handler);
  }, []);

  // ── Handle spotlight intent submission ──
  const handleSpotlightSubmit = useCallback((intent: string) => {
    setView("chat");
    // Fill the intent input via custom event
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("prismos:fill-intent", { detail: intent }));
    }, 100);
  }, []);

  function renderView() {
    switch (view) {
      case "chat":
        // MainView is always mounted (rendered below, outside AnimatePresence)
        // to prevent tab switches from killing in-flight AI processing.
        return null;
      case "graph":
        return <SpectrumGraphView refreshKey={graphRefreshKey} lastAnswerTrace={lastGraphTrace} />;
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
      case "research":
        return <ResearchPanel />;
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
      case "dashboard":
        return (
          <DailyDashboard
            nodes={nodes}
            graphStats={graphStats}
            dailyGreeting={dailyGreeting}
            onNavigate={(v) => setView(v as View)}
            onSuggestionClick={(intent) => {
              setView("chat");
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent("prismos:fill-intent", { detail: intent }));
              }, 100);
            }}
          />
        );
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
      <div className="app-body">
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
          {/* MainView is always mounted so AI processing survives tab switches.
              Hidden via CSS when another view is active — no unmount, no lost state. */}
          <div style={{ display: view === "chat" ? "contents" : "none" }}>
            <MainView
              ollamaConnected={ollamaConnected}
              onRetryConnection={checkOllama}
              settings={settings}
              onSettingsChange={handleSettingsChange}
              onIntentProcessed={onIntentProcessed}
              liveAgentSteps={liveAgentSteps}
              clearLiveSteps={clearLiveSteps}
              startupSuggestions={startupSuggestions}
              dailyGreeting={dailyGreeting}
            />
          </div>
          {view !== "chat" && (
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                style={{ display: "contents" }}
              >
                {renderView()}
              </motion.div>
            </AnimatePresence>
          )}
        </ErrorBoundary>
      </main>

      {/* First-run onboarding wizard */}
      {showOnboarding && (
        <OnboardingWizard
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Spotlight overlay — global command palette (Ctrl+Space / Alt+Space) — Background Omnipresence */}
      <SpotlightOverlay
        visible={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onSubmit={handleSpotlightSubmit}
        suggestions={startupSuggestions}
      />

      {/* Brain Wrapped™ — shareable cognitive story */}
      {brainWrappedOpen && (
        <BrainWrapped onClose={() => setBrainWrappedOpen(false)} />
      )}

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
      </div>{/* end app-body */}
    </div>
  );
}

export default App;
