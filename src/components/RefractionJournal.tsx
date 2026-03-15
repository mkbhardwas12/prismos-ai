// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// RefractionJournal — Shows how the refraction engine adapts to the user's preferences

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RefractionInsights } from "../types";
import "./RefractionJournal.css";

const BAND_COLORS: Record<string, string> = {
  Direct: "#ef4444",
  Analytical: "#3b82f6",
  Creative: "#f59e0b",
  Exploratory: "#8b5cf6",
};

export default function RefractionJournal() {
  const [insights, setInsights] = useState<RefractionInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await invoke<string>("get_refraction_insights");
        setInsights(JSON.parse(raw));
      } catch {
        // No data yet
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return null;

  if (!insights || insights.total_refractions === 0) {
    return (
      <div className="refraction-journal">
        <h3>🔮 Refraction Journal</h3>
        <div className="refraction-empty">
          <p>Try the different response styles (Direct, Analytical, Creative, Exploratory) to see your refraction profile build here.</p>
        </div>
      </div>
    );
  }

  const totalBandCount = Object.values(insights.band_distribution).reduce((a, b) => a + b, 0);

  return (
    <div className="refraction-journal">
      <h3>🔮 Refraction Journal</h3>

      <div className="refraction-stats">
        <div className="refraction-stat">
          <div className="refraction-stat-value">{insights.total_refractions}</div>
          <div className="refraction-stat-label">Total Refractions</div>
        </div>
        <div className="refraction-stat">
          <div className="refraction-stat-value">
            {Math.round(insights.growth_score * 100)}%
          </div>
          <div className="refraction-stat-label">Growth Score</div>
        </div>
      </div>

      <div className="refraction-bands">
        {Object.entries(insights.band_distribution)
          .sort(([, a], [, b]) => b - a)
          .map(([band, count]) => (
            <div key={band} className="refraction-band-row">
              <span className="refraction-band-name">{band}</span>
              <div className="refraction-band-bar">
                <div
                  className="refraction-band-fill"
                  style={{
                    width: `${totalBandCount > 0 ? (count / totalBandCount) * 100 : 0}%`,
                    background: BAND_COLORS[band] || "#6b7280",
                  }}
                />
              </div>
              <span className="refraction-band-count">{Math.round(count)}</span>
            </div>
          ))}
      </div>

      {insights.insights.length > 0 && (
        <div className="refraction-shift">
          {insights.insights[0]}
        </div>
      )}
    </div>
  );
}
