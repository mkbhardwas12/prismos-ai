// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS — Main Application Shell

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import MainView from "./components/MainView";
import SettingsPanel from "./components/SettingsPanel";
import type { Agent, SpectrumNode, AppSettings } from "./types";

type View = "chat" | "settings";

function App() {
  const [view, setView] = useState<View>("chat");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [nodes, setNodes] = useState<SpectrumNode[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    ollamaUrl: "http://localhost:11434",
    defaultModel: "mistral",
    theme: "dark",
    maxTokens: 2048,
  });

  const loadAgents = useCallback(async () => {
    try {
      const result = await invoke<string>("get_active_agents");
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

  const checkOllama = useCallback(async () => {
    try {
      const connected = await invoke<boolean>("check_ollama_status");
      setOllamaConnected(connected);
    } catch {
      setOllamaConnected(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadNodes();
    checkOllama();

    const interval = setInterval(checkOllama, 30000);
    return () => clearInterval(interval);
  }, [loadAgents, loadNodes, checkOllama]);

  return (
    <div className="app-layout">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        agents={agents}
        nodes={nodes}
      />
      <div className="main-content">
        {view === "chat" ? (
          <MainView
            ollamaConnected={ollamaConnected}
            settings={settings}
            onNodeAdded={loadNodes}
          />
        ) : (
          <SettingsPanel
            settings={settings}
            onSettingsChange={setSettings}
            ollamaConnected={ollamaConnected}
          />
        )}
      </div>
    </div>
  );
}

export default App;
