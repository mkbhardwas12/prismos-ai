// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// ThoughtCurrentsCard — Shows temporal patterns discovered in user intent history

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ThoughtCurrent } from "../types";
import "./ThoughtCurrentsCard.css";

const PATTERN_ICONS: Record<string, string> = {
  recurring_cycle: "🔄",
  seasonal: "📅",
  thought_chain: "🔗",
  missing_connection: "💡",
};

export default function ThoughtCurrentsCard() {
  const [currents, setCurrents] = useState<ThoughtCurrent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await invoke<string>("get_thought_currents");
        setCurrents(JSON.parse(raw));
      } catch {
        // No data yet
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return null;

  if (currents.length === 0) {
    return (
      <div className="thought-currents-card">
        <h3>🌊 Thought Currents</h3>
        <div className="currents-empty">
          <p>Your thinking patterns will appear here as you use PrismOS more.</p>
          <span className="empty-action">Try asking a few questions to get started →</span>
        </div>
      </div>
    );
  }

  return (
    <div className="thought-currents-card">
      <h3>🌊 Thought Currents</h3>
      <div className="currents-list">
        {currents.slice(0, 5).map((current, i) => (
          <div key={i} className="current-item">
            <span className="current-icon">
              {PATTERN_ICONS[current.pattern_type] || "🌀"}
            </span>
            <div className="current-content">
              <div className="current-type">{current.pattern_type.replace("_", " ")}</div>
              <div className="current-desc">{current.description}</div>
              <div className="current-confidence">
                {Math.round(current.confidence * 100)}% confidence
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
