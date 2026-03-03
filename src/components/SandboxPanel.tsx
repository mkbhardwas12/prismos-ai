// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Sandbox Panel — Prism Execution & Rollback UI

import { useState, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Prism, PrismResult } from "../types";
import prismosIcon from "../assets/prismos-icon.svg";
import "./SandboxPanel.css";

export default memo(function SandboxPanel() {
  const [prismName, setPrismName] = useState("");
  const [task, setTask] = useState("");
  const [activePrisms, setActivePrisms] = useState<Prism[]>([]);
  const [results, setResults] = useState<(PrismResult & { _key: number })[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [exportData, setExportData] = useState("");
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(0);

  const handleCreatePrism = useCallback(async () => {
    if (!prismName.trim()) return;
    try {
      const result = await invoke<string>("create_sandbox", {
        name: prismName,
      });
      const prism: Prism = JSON.parse(result);
      setActivePrisms((prev) => [...prev, prism]);
      setPrismName("");
    } catch (e) {
      console.error("Failed to create prism:", e);
    }
  }, [prismName]);

  const handleExecute = useCallback(async () => {
    if (!prismName.trim() || !task.trim()) return;
    setIsExecuting(true);
    try {
      const result = await invoke<string>("execute_in_sandbox", {
        action: task,
        agentId: prismName || "default",
      });
      const prismResult: PrismResult = JSON.parse(result);
      setResults((prev) => [...prev, { ...prismResult, _key: nextKey }]);
      setNextKey((k) => k + 1);
      setTask("");
    } catch (e) {
      console.error("Sandbox execution failed:", e);
      setResults((prev) => [
        ...prev,
        {
          success: false,
          output: `Execution error: ${e}`,
          side_effects: [],
          sandbox_protected: true,
          action_signature: "",
          rollback_explanation: null,
          wasm_isolated: false,
          wasm_fuel_consumed: null,
          wasm_memory_limit_bytes: null,
          _key: nextKey,
        },
      ]);
      setNextKey((k) => k + 1);
    } finally {
      setIsExecuting(false);
    }
  }, [prismName, task]);

  const handleRollback = useCallback(async () => {
    if (!prismName.trim()) return;
    try {
      const result = await invoke<string>("rollback_sandbox", {
        name: prismName,
      });
      const checkpoint = JSON.parse(result);
      setResults((prev) => [
        ...prev,
        {
          success: true,
          output: `Rolled back. Checkpoint: ${checkpoint?.state_hash?.slice(0, 16) ?? "none"}...`,
          side_effects: [],
          sandbox_protected: true,
          action_signature: "",
          rollback_explanation: null,
          wasm_isolated: false,
          wasm_fuel_consumed: null,
          wasm_memory_limit_bytes: null,
          _key: nextKey,
        },
      ]);
      setNextKey((k) => k + 1);
    } catch (e) {
      console.error("Rollback failed:", e);
    }
  }, [prismName]);

  const handleExport = useCallback(async () => {
    if (!exportData.trim()) return;
    try {
      const result = await invoke<string>("export_you_port", {
        data: exportData,
      });
      setExportResult(result);
    } catch (e) {
      console.error("Export failed:", e);
    }
  }, [exportData]);

  return (
    <>
      <div className="main-header">
        <h2>🔒 Sandbox Prisms</h2>
        <div className="graph-stats">
          <span className="stat-badge">{activePrisms.length} prisms</span>
        </div>
      </div>

      <div className="sandbox-container">
        {/* P4: First-time guidance */}
        {activePrisms.length === 0 && results.length === 0 && (
          <div className="sandbox-guidance">
            <div className="sandbox-guidance-icon">🛡️</div>
            <h3>What are Sandbox Prisms?</h3>
            <p>Sandbox Prisms let AI agents execute actions in <strong>isolated environments</strong> with automatic cryptographic checkpoints. If anything goes wrong, changes are instantly rolled back.</p>
            <div className="sandbox-guidance-steps">
              <div className="sandbox-guidance-step">
                <span className="sandbox-step-num">1</span>
                <span>Name your prism (e.g., "data-cleanup")</span>
              </div>
              <div className="sandbox-guidance-step">
                <span className="sandbox-step-num">2</span>
                <span>Describe a task to execute safely</span>
              </div>
              <div className="sandbox-guidance-step">
                <span className="sandbox-step-num">3</span>
                <span>Click Execute — if it fails, Rollback undoes everything</span>
              </div>
            </div>
          </div>
        )}

        {/* Prism Controls */}
        <div className="sandbox-section">
          <h3><img src={prismosIcon} alt="" className="header-icon" /> Execution Sandbox</h3>
          <p className="section-desc">
            Sandboxed execution environments with cryptographic checkpoints and
            automatic rollback on failure.
          </p>

          <div className="sandbox-form" role="form" aria-label="Sandbox execution">
            <label htmlFor="prism-name" className="sr-only">Prism name</label>
            <input
              id="prism-name"
              className="form-input"
              placeholder="Prism name (e.g., analysis-task)"
              value={prismName}
              onChange={(e) => setPrismName(e.target.value)}
            />
            <label htmlFor="sandbox-task" className="sr-only">Task to execute</label>
            <textarea
              id="sandbox-task"
              className="form-textarea"
              placeholder="Task to execute in sandbox..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
            />
            <div className="sandbox-actions">
              <button
                className="toolbar-btn primary"
                onClick={handleCreatePrism}
                disabled={!prismName.trim()}
              >
                Create Prism
              </button>
              <button
                className="toolbar-btn primary"
                onClick={handleExecute}
                disabled={isExecuting || !task.trim()}
              >
                {isExecuting ? "Executing..." : "▶ Execute"}
              </button>
              <button
                className="toolbar-btn"
                onClick={handleRollback}
                disabled={!prismName.trim()}
              >
                ⏪ Rollback
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="sandbox-section">
            <h3>Execution Results</h3>
            <div className="results-list">
              {results.map((r) => (
                <div
                  key={r._key}
                  className={`result-card ${r.success ? "success" : "failure"}`}
                >
                  <div className="result-header">
                    <span className="result-status">
                      {r.success ? "✅ Success" : "❌ Failed"}
                    </span>
                  </div>
                  <div className="result-output">{r.output}</div>
                  {r.side_effects.length > 0 && (
                    <div className="result-effects">
                      {r.side_effects.map((se, j) => (
                        <span key={j} className="effect-badge">
                          {se.reversible ? "↩" : "⚠"} {se.effect_type}:{" "}
                          {se.description}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Prisms */}
        {activePrisms.length > 0 && (
          <div className="sandbox-section">
            <h3>Active Prisms</h3>
            <div className="prism-list">
              {activePrisms.map((prism) => (
                <div key={prism.id} className="prism-card">
                  <div className="prism-name">{prism.name}</div>
                  <div className="prism-meta">
                    Status: {prism.status} ·{" "}
                    Checkpoints: {prism.checkpoints.length} ·{" "}
                    {new Date(prism.created_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* You-Port Export */}
        <div className="sandbox-section">
          <h3>📦 You-Port Export</h3>
          <p className="section-desc">
            Securely export data with SHA-256 integrity verification for
            device-to-device handoff.
          </p>
          <label htmlFor="youport-data" className="sr-only">Data to export</label>
          <textarea
            id="youport-data"
            className="form-textarea"
            placeholder="Data to export..."
            value={exportData}
            onChange={(e) => setExportData(e.target.value)}
            rows={3}
          />
          <button
            className="toolbar-btn primary"
            onClick={handleExport}
            disabled={!exportData.trim()}
            style={{ marginTop: 8 }}
          >
            Export Package
          </button>
          {exportResult && (
            <div className="result-card success" style={{ marginTop: 12 }}>
              <div className="result-header">
                <span className="result-status">✅ Package Created</span>
              </div>
              <div className="result-output" style={{ fontSize: 11 }}>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {exportResult}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
})
