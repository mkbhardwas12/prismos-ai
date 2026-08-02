// PrismOS-AI Action Policy Panel — bounded evaluation and bookkeeping UI

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
  const [nextKey, setNextKey] = useState(0);

  const handleCreatePrism = useCallback(async () => {
    if (!prismName.trim()) return;
    try {
      const result = await invoke<string>("create_sandbox", {
        name: prismName,
      });
      const prism: Prism = JSON.parse(result);
      setActivePrisms((prev) => [...prev, prism]);
    } catch (e) {
      console.error("Failed to create prism:", e);
    }
  }, [prismName]);

  const handleExecute = useCallback(async () => {
    if (!prismName.trim() || !task.trim()) return;
    setIsExecuting(true);
    try {
      const responseJson = await invoke<string>("execute_in_sandbox", {
        action: task,
        name: prismName,
      });
      const response: { result: PrismResult; prism: Prism } = JSON.parse(responseJson);
      const prismResult = response.result;
      setActivePrisms((prev) =>
        prev.map((prism) => (prism.id === response.prism.id ? response.prism : prism)),
      );
      setResults((prev) => [...prev, { ...prismResult, _key: nextKey }]);
      setNextKey((k) => k + 1);
      setTask("");
    } catch (e) {
      console.error("Action policy evaluation failed:", e);
      setResults((prev) => [
        ...prev,
        {
          success: false,
          output: `Evaluation error: ${e}`,
          side_effects: [],
          sandbox_protected: false,
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
      const response: { checkpoint: { state_hash?: string }; prism: Prism } = JSON.parse(result);
      setActivePrisms((prev) =>
        prev.map((prism) => (prism.id === response.prism.id ? response.prism : prism)),
      );
      setResults((prev) => [
        ...prev,
        {
          success: true,
          output: `Prism bookkeeping marked rolled back. No generic host-state undo was performed. Checkpoint record: ${response.checkpoint?.state_hash?.slice(0, 16) ?? "none"}...`,
          side_effects: [],
          sandbox_protected: false,
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

  const selectedPrismExists = activePrisms.some(
    (prism) => prism.name === prismName.trim(),
  );

  return (
    <>
      <div className="main-header">
        <h2>🔒 Action Policies</h2>
        <div className="graph-stats">
          <span className="stat-badge">{activePrisms.length} policy records</span>
        </div>
      </div>

      <div className="sandbox-container">
        {/* P4: First-time guidance */}
        {activePrisms.length === 0 && results.length === 0 && (
          <div className="sandbox-guidance">
            <div className="sandbox-guidance-icon">🛡️</div>
            <h3>What are Action Policies?</h3>
            <p>Action Policies run supported action descriptions through <strong>bounded allow-list, risk, and anomaly checks</strong>. Checkpoints record policy state; they are not a generic undo system.</p>
            <div className="sandbox-guidance-steps">
              <div className="sandbox-guidance-step">
                <span className="sandbox-step-num">1</span>
                <span>Name your prism (e.g., "data-cleanup")</span>
              </div>
              <div className="sandbox-guidance-step">
                <span className="sandbox-step-num">2</span>
                <span>Describe an action for the policy simulator</span>
              </div>
              <div className="sandbox-guidance-step">
                <span className="sandbox-step-num">3</span>
                <span>Click Evaluate — a rollback marks Prism bookkeeping only</span>
              </div>
            </div>
          </div>
        )}

        {/* Prism Controls */}
        <div className="sandbox-section">
          <h3><img src={prismosIcon} alt="" className="header-icon" /> Action Policy Simulator</h3>
          <p className="section-desc">
            Bounded policy checks with process-local authenticated records
            and checkpoint bookkeeping. No arbitrary code runner or generic undo.
          </p>

          <div className="sandbox-form" role="form" aria-label="Action policy evaluation">
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
              placeholder="Action description to evaluate..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
            />
            <div className="sandbox-actions">
              <button
                className="toolbar-btn primary"
                onClick={handleCreatePrism}
                disabled={!prismName.trim() || selectedPrismExists}
              >
                Create Prism
              </button>
              <button
                className="toolbar-btn primary"
                onClick={handleExecute}
                disabled={isExecuting || !task.trim() || !selectedPrismExists}
              >
                {isExecuting ? "Evaluating..." : "▶ Evaluate"}
              </button>
              <button
                className="toolbar-btn"
                onClick={handleRollback}
                disabled={!selectedPrismExists}
              >
                ⏪ Mark Rolled Back
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="sandbox-section">
            <h3>Policy Results</h3>
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

      </div>
    </>
  );
})
