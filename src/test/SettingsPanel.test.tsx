// PrismOS-AI — SettingsPanel Component Tests (Accordion Behavior)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import SettingsPanel from "../components/SettingsPanel";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, GraphStats } from "../types";
import { DEFAULT_MODEL, DEFAULT_SETTINGS } from "../lib/config";

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
      if (cmd === "list_ollama_models" || cmd === "list_local_inference_models") return JSON.stringify([]);
      if (cmd === "check_local_inference_status") return true;
      if (cmd === "get_security_status") return JSON.stringify({ enclave: { backend: "mock", hardware_available: false, key_fingerprint: "", platform: "test", details: "" }, audit_chain: { valid: true, entries: 0, message: "" }, sandbox_active: false, hmac_signing: false, wasm_isolation: false, auto_rollback: false, encrypted_storage: false, local_only: false, private_inference_client_fixed_loopback: true });
      if (cmd === "get_domain_profile") return JSON.stringify({ primary_domain: "General", confidence: 0, total_queries: 0, domain_counts: {} });
      if (cmd === "list_project_knowledge_sources") return JSON.stringify([]);
      if (cmd === "export_private_vault") return JSON.stringify({ message: "Private vault created", package_bytes: 4096 });
      if (cmd === "stage_private_vault_restore") return JSON.stringify({ message: "Private vault restore staged", restart_required: true });
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
    expect(screen.getByText(/Query Topic Mix/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Project Knowledge/ })).toBeInTheDocument();
    expect(screen.getByText(/Private Vault Backup & Restore/)).toBeInTheDocument();
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
    expect(screen.getByText("Local inference connected")).toBeInTheDocument();
  });

  it("shows Offline when not connected", async () => {
    await renderSettings({ ollamaConnected: false });
    expect(screen.getByText("Local inference offline")).toBeInTheDocument();
  });

  it("labels heuristic redaction, model metadata, and unproven recovery boundaries", async () => {
    await renderSettings();
    expect(screen.getByText(/Redaction cannot guarantee that every secret or regulated value is detected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Private Vault Backup & Restore/));
    expect(screen.getByText(/Complete a clean-profile restore drill before relying on any vault/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Security Status/));
    expect(screen.getByText("Heuristic Model Metadata Compatibility")).toBeInTheDocument();
    expect(screen.getByText(/does not hash model bytes, verify a publisher signature, attest the daemon, or establish model safety/i)).toBeInTheDocument();
  });

  it("requires a metadata preview before project contents are indexed", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_security_status") return JSON.stringify({ enclave: { backend: "mock", hardware_available: false, key_fingerprint: "", platform: "test", details: "" }, audit_chain: { valid: true, entries: 0, message: "" }, sandbox_active: false, hmac_signing: false, wasm_isolation: false, auto_rollback: false, encrypted_storage: false, local_only: false, private_inference_client_fixed_loopback: true });
      if (cmd === "get_domain_profile") return JSON.stringify({ primary_domain: "General", confidence: 0, total_queries: 0, domain_counts: {} });
      if (cmd === "list_ollama_models" || cmd === "list_local_inference_models" || cmd === "list_project_knowledge_sources") return JSON.stringify([]);
      if (cmd === "scan_project_knowledge") return JSON.stringify({
        scan_id: "scan-1", source_id: "source-1", project_name: "demo", root_path: "/tmp/demo",
        total_files_seen: 12, candidate_files: 8, total_candidate_bytes: 4096,
        skipped_sensitive_files: 2, skipped_dirs: [".git", "node_modules"], truncated: false,
      });
      if (cmd === "index_project_knowledge") return JSON.stringify({
        source: { id: "source-1", name: "demo", root_path: "/tmp/demo", file_count: 8,
          chunk_count: 16, bytes_indexed: 4096, skipped_files: 2, error_count: 0,
          status: "ready", last_indexed: "2026-01-01T00:00:00Z" }, errors: [],
      });
      return "{}";
    });

    await renderSettings();
    fireEvent.change(screen.getByPlaceholderText("/Users/you/Documents/my-project"), {
      target: { value: "/tmp/demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText(/Approval required · demo/)).toBeInTheDocument();
    expect(screen.getByText("Approved root: /tmp/demo")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("/Users/you/Documents/my-project")).toBeDisabled();
    expect(screen.getByText(/no file content has been read/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve & Index" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("index_project_knowledge", { scanId: "scan-1" });
    });
  });

  it("creates a full private vault without persisting its path or passphrase", async () => {
    const storageWrite = vi.spyOn(window.localStorage, "setItem");
    const vaultPath = "/Volumes/Private Backup/prismos-2026.prismos-vault";
    const passphrase = "correct horse battery staple";

    await renderSettings();
    fireEvent.click(screen.getByText(/Private Vault Backup & Restore/));
    fireEvent.change(screen.getByPlaceholderText("Full path ending in .prismos-vault"), {
      target: { value: vaultPath },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 16 characters"), {
      target: { value: passphrase },
    });
    fireEvent.change(screen.getByPlaceholderText("Repeat before creating a new vault"), {
      target: { value: passphrase },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Full Vault/ }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("export_private_vault", {
        destination: vaultPath,
        passphrase,
      });
    });
    expect(storageWrite.mock.calls.flat().join(" ")).not.toContain(vaultPath);
    expect(storageWrite.mock.calls.flat().join(" ")).not.toContain(passphrase);
  });

  it("stages a full restore only with the exact destructive confirmation", async () => {
    const vaultPath = "/Volumes/Private Backup/prismos-2026.prismos-vault";
    const passphrase = "correct horse battery staple";

    await renderSettings();
    fireEvent.click(screen.getByText(/Private Vault Backup & Restore/));
    fireEvent.change(screen.getByPlaceholderText("Full path ending in .prismos-vault"), {
      target: { value: vaultPath },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 16 characters"), {
      target: { value: passphrase },
    });
    fireEvent.change(screen.getByPlaceholderText("RESTORE MY PRIVATE PRISMOS VAULT"), {
      target: { value: "RESTORE MY PRIVATE PRISMOS VAULT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage Full Restore" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("stage_private_vault_restore", {
        packagePath: vaultPath,
        passphrase,
        confirmation: "RESTORE MY PRIVATE PRISMOS VAULT",
      });
    });
  });

  it("blocks private-vault export when the passphrases do not match", async () => {
    await renderSettings();
    fireEvent.click(screen.getByText(/Private Vault Backup & Restore/));
    fireEvent.change(screen.getByPlaceholderText("Full path ending in .prismos-vault"), {
      target: { value: "/Volumes/Private Backup/prismos.prismos-vault" },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 16 characters"), {
      target: { value: "first passphrase is long" },
    });
    fireEvent.change(screen.getByPlaceholderText("Repeat before creating a new vault"), {
      target: { value: "different passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Full Vault/ }));

    expect(await screen.findByText(/passphrases do not match/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("export_private_vault", expect.anything());
  });

  it("treats unavailable live security status as unverified", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_security_status") throw new Error("backend unavailable");
      if (cmd === "get_domain_profile") return JSON.stringify({ primary_domain: "General", confidence: 0, total_queries: 0, domain_counts: {} });
      if (cmd === "list_ollama_models" || cmd === "list_local_inference_models" || cmd === "list_project_knowledge_sources") return JSON.stringify([]);
      return "{}";
    });

    await renderSettings();
    fireEvent.click(screen.getByText(/Security Status/));
    expect(await screen.findByText(/Live security status is unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Live endpoint policy could not be verified")).toBeInTheDocument();
    expect(screen.getByText("Action-record authentication is inactive or unverified")).toBeInTheDocument();
  });

  it("uses normalized model matching for the active fixed-loopback selection", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_ollama_models" || cmd === "list_local_inference_models") {
        return JSON.stringify([{ name: "llama3.2:latest", size: 2_000_000_000 }]);
      }
      if (cmd === "get_security_status") return JSON.stringify({ enclave: { backend: "mock", hardware_available: false, key_fingerprint: "", platform: "test", details: "" }, audit_chain: { valid: true, entries: 0, message: "" }, sandbox_active: false, hmac_signing: false, wasm_isolation: false, auto_rollback: false, encrypted_storage: false, local_only: false, private_inference_client_fixed_loopback: true });
      if (cmd === "get_domain_profile") return JSON.stringify({ primary_domain: "General", confidence: 0, total_queries: 0, domain_counts: {} });
      if (cmd === "list_project_knowledge_sources") return JSON.stringify([]);
      return "{}";
    });

    await renderSettings({
      settings: { ...mockSettings, defaultModel: "llama3.2" },
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveValue("llama3.2:latest");
    });
    expect(screen.getByRole("button", { name: "✅ Active" })).toBeInTheDocument();
  });

  it("selects an installed reviewed text model after deleting the active model", async () => {
    let deleted = false;
    const active = { name: DEFAULT_MODEL, size: 2_500_000_000 };
    const fallback = { name: "llama3.2:latest", size: 2_000_000_000 };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "delete_ollama_model") {
        deleted = true;
        return `deleted ${DEFAULT_MODEL}`;
      }
      if (cmd === "list_ollama_models" || cmd === "list_local_inference_models") {
        return JSON.stringify(deleted ? [fallback] : [active, fallback]);
      }
      if (cmd === "get_security_status") return JSON.stringify({ enclave: { backend: "mock", hardware_available: false, key_fingerprint: "", platform: "test", details: "" }, audit_chain: { valid: true, entries: 0, message: "" }, sandbox_active: false, hmac_signing: false, wasm_isolation: false, auto_rollback: false, encrypted_storage: false, local_only: false, private_inference_client_fixed_loopback: true });
      if (cmd === "get_domain_profile") return JSON.stringify({ primary_domain: "General", confidence: 0, total_queries: 0, domain_counts: {} });
      if (cmd === "list_project_knowledge_sources") return JSON.stringify([]);
      return "{}";
    });
    const onSettingsChange = vi.fn();

    await renderSettings({ onSettingsChange });
    const activeName = await screen.findByText(DEFAULT_MODEL, { selector: ".model-hub-item-name" });
    const activeRow = activeName.closest(".settings-model-hub-item");
    expect(activeRow).not.toBeNull();
    fireEvent.click(within(activeRow as HTMLElement).getByTitle("Delete this model"));

    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
        defaultModel: "llama3.2:latest",
      }));
    });
  });

  it("uses the central default in empty-state guidance and labels catalog prerequisites", async () => {
    await renderSettings();

    expect(await screen.findByText(`No chat-capable completion model found on fixed loopback. Run: ollama pull ${DEFAULT_MODEL}`))
      .toBeInTheDocument();
    expect(screen.getByText(/requires Ollama 0\.5\.13\+ \(version not checked\)/))
      .toBeInTheDocument();
  });
});
