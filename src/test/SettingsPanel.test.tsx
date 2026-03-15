// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — SettingsPanel Component Tests (Accordion Behavior)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SettingsPanel from "../components/SettingsPanel";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, GraphStats } from "../types";
import { DEFAULT_SETTINGS } from "../lib/config";

const mockSettings: AppSettings = { ...DEFAULT_SETTINGS };

const defaultProps = {
  settings: mockSettings,
  onSettingsChange: vi.fn(),
  ollamaConnected: true,
  graphStats: { nodes: 10, edges: 5 } as GraphStats,
  onGraphCleared: vi.fn(),
  showToast: vi.fn(),
};

async function renderSettings(overrides = {}) {
  await act(async () => {
    render(<SettingsPanel {...defaultProps} {...overrides} />);
  });
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock invoke to return proper types
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_ollama_models") return JSON.stringify([]);
      if (cmd === "check_ollama_status") return true;
      if (cmd === "get_security_status") return JSON.stringify({ enclave: { backend: "mock", hardware_available: false, key_fingerprint: "", platform: "test", details: "" }, audit_chain: { valid: true, entries: 0, message: "" }, sandbox_active: false, hmac_signing: false, wasm_isolation: false, auto_rollback: false, encrypted_storage: false, local_only: true });
      if (cmd === "get_domain_profile") return JSON.stringify({ primary_domain: "General", confidence: 0, total_queries: 0, domain_counts: {} });
      return "{}";
    });
  });

  it("renders the Settings header", async () => {
    await renderSettings();
    expect(screen.getByText("⚙️ Settings")).toBeInTheDocument();
  });

  it("renders all accordion section headers", async () => {
    await renderSettings();
    expect(screen.getByText(/Ollama Configuration/)).toBeInTheDocument();
    expect(screen.getByText(/Model Hub/)).toBeInTheDocument();
    expect(screen.getByText(/Domain Intelligence/)).toBeInTheDocument();
    expect(screen.getByText(/Spectrum Graph/)).toBeInTheDocument();
    expect(screen.getByText(/Multi-Device Sync/)).toBeInTheDocument();
    expect(screen.getByText(/Appearance/)).toBeInTheDocument();
    expect(screen.getByText(/Voice Input/)).toBeInTheDocument();
    expect(screen.getByText(/Email Summary/)).toBeInTheDocument();
    expect(screen.getByText(/Calendar Integration/)).toBeInTheDocument();
    expect(screen.getByText(/Finance Keeper/)).toBeInTheDocument();
    expect(screen.getByText(/Security Status/)).toBeInTheDocument();
    expect(screen.getByText(/System Information/)).toBeInTheDocument();
    expect(screen.getByText(/About PrismOS-AI/)).toBeInTheDocument();
  });

  it("Ollama and Hub sections are expanded by default", async () => {
    await renderSettings();
    // Ollama URL input should be visible (section expanded)
    expect(screen.getByDisplayValue(mockSettings.ollamaUrl)).toBeInTheDocument();
  });

  it("collapsed sections hide their content", async () => {
    await renderSettings();
    // Appearance section is collapsed by default, so theme buttons should NOT be visible
    // (unless we look at query results carefully)
    const themeButtons = screen.queryAllByText("🌙 Dark");
    // Appearance is collapsed so the theme button should not exist
    expect(themeButtons.length).toBe(0);
  });

  it("clicking a collapsed section header expands it", async () => {
    await renderSettings();
    // Appearance is collapsed — click to expand
    const header = screen.getByText(/Appearance/);
    fireEvent.click(header);
    // Now the Dark/Light buttons should appear
    expect(screen.getByText("🌙 Dark")).toBeInTheDocument();
    expect(screen.getByText("☀️ Light")).toBeInTheDocument();
  });

  it("clicking an expanded section header collapses it", async () => {
    await renderSettings();
    // Ollama section is expanded — click to collapse
    const header = screen.getByText(/Ollama Configuration/);
    fireEvent.click(header);
    // Ollama URL input should be gone
    expect(screen.queryByDisplayValue(mockSettings.ollamaUrl)).not.toBeInTheDocument();
  });

  it("shows connection status", async () => {
    await renderSettings();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows Offline when not connected", async () => {
    await renderSettings({ ollamaConnected: false });
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });
});
