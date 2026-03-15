// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// CognitiveDriftCard — Visualizes how the user's cognitive profile evolves over time

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CognitiveDrift } from "../types";
import "./CognitiveDriftCard.css";

const DIMENSIONS = [
  { key: "depth", label: "Depth", color: "#8b5cf6" },
  { key: "creativity", label: "Creativity", color: "#f59e0b" },
  { key: "formality", label: "Formality", color: "#3b82f6" },
  { key: "technical", label: "Technical", color: "#10b981" },
  { key: "example", label: "Examples", color: "#ec4899" },
];

export default function CognitiveDriftCard() {
  const [drift, setDrift] = useState<CognitiveDrift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await invoke<string>("get_cognitive_drift", { weeks: 12 });
        setDrift(JSON.parse(raw));
      } catch {
        // No data yet — that's OK
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return null;

  if (!drift || drift.weeks_compared === 0) {
    return (
      <div className="cognitive-drift-card">
        <h3>🧬 Cognitive Drift</h3>
        <div className="drift-empty">
          <p>Keep chatting — your cognitive profile will start tracking after a week of use.</p>
        </div>
      </div>
    );
  }

  const profile = drift.current;

  return (
    <div className="cognitive-drift-card">
      <h3>
        🧬 Cognitive Drift
        <span className={`drift-trend ${drift.summary}`}>
          {drift.summary === "stable" && "⚡ Stable"}
          {drift.summary === "shifting" && "🔄 Shifting"}
          {drift.summary === "evolving" && "🚀 Evolving"}
          {drift.summary === "insufficient_data" && "📊 Building..."}
        </span>
      </h3>

      <div className="drift-bars">
        {DIMENSIONS.map((dim) => {
          const value = (profile as unknown as Record<string, number>)[dim.key === "technical" ? "technical_level" : dim.key === "example" ? "example_preference" : dim.key] ?? 0.5;
          const pct = Math.round(value * 100);
          const deltaKey = dim.key === "technical" ? "technical_level" : dim.key === "example" ? "example_preference" : dim.key;
          const delta = (drift.deltas as unknown as Record<string, number>)[deltaKey] ?? 0;

          return (
            <div key={dim.key} className="drift-bar-row">
              <span className="drift-bar-label">{dim.label}</span>
              <div className="drift-bar-track">
                <div
                  className="drift-bar-fill"
                  style={{ width: `${pct}%`, background: dim.color, left: 0 }}
                />
              </div>
              <span className="drift-bar-value">
                {pct}%
                {delta !== 0 && (
                  <span style={{ color: delta > 0 ? "#22c55e" : "#ef4444", marginLeft: 2 }}>
                    {delta > 0 ? "↑" : "↓"}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
