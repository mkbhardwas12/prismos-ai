// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// DailyBrief — Morning Brief, Evening Recap & "What PrismOS did today"

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./DailyBrief.css";

interface DailyBriefData {
  time_period: "morning" | "afternoon" | "evening";
  is_morning: boolean;
  intents_today: number;
  nodes_created: number;
  nodes_updated: number;
  edges_strengthened: number;
  total_nodes: number;
  total_edges: number;
  top_facets: Record<string, number>;
  intent_types: Record<string, number>;
  highlights: { icon: string; text: string }[];
}

interface DailyBriefProps {
  onSuggestionClick?: (intent: string) => void;
}

export default function DailyBrief({ onSuggestionClick }: DailyBriefProps) {
  const [brief, setBrief] = useState<DailyBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState(false);

  const loadBrief = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<string>("get_daily_brief");
      setBrief(JSON.parse(result));
    } catch (e) {
      console.error("Failed to load daily brief:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBrief();
    // Refresh every 10 minutes
    const interval = setInterval(loadBrief, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadBrief]);

  if (dismissed || error) return null;
  if (loading || !brief) return null;

  const hasActivity = brief.intents_today > 0 || brief.nodes_created > 0 || brief.edges_strengthened > 0;
  const isMorning = brief.is_morning;

  // Morning Brief: show graph overview + what to explore
  // Evening Recap: show what you accomplished + summary
  const title = isMorning
    ? "☀️ Morning Brief"
    : brief.time_period === "afternoon"
    ? "🌤️ Afternoon Check-in"
    : "🌙 Evening Recap";

  const subtitle = isMorning
    ? "Here's what your Spectrum Graph has been up to"
    : hasActivity
    ? "Here's what PrismOS did for you today"
    : "Your graph is ready — start an intent to build knowledge";

  // Quick action suggestions based on time of day
  const quickActions = isMorning
    ? [
        { icon: "📊", text: "Show my graph overview", intent: "Show me an overview of my knowledge graph" },
        { icon: "🔍", text: "What's trending?", intent: "What topics have I been focusing on recently?" },
        { icon: "💡", text: "Surprise me", intent: "Suggest something interesting I haven't explored yet" },
      ]
    : [
        { icon: "📝", text: "Summarize my day", intent: "Summarize what I worked on today" },
        { icon: "🔗", text: "Find connections", intent: "What new connections formed in my graph today?" },
        { icon: "🎯", text: "Plan tomorrow", intent: "Based on my graph, what should I focus on tomorrow?" },
      ];

  return (
    <div className="daily-brief">
      <div className="daily-brief-header">
        <div className="daily-brief-title-row">
          <h3 className="daily-brief-title">{title}</h3>
          <button
            className="daily-brief-dismiss"
            onClick={() => setDismissed(true)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
        <p className="daily-brief-subtitle">{subtitle}</p>
      </div>

      {/* Stats strip */}
      {hasActivity && (
        <div className="daily-brief-stats">
          <div className="brief-stat">
            <span className="brief-stat-value">{brief.intents_today}</span>
            <span className="brief-stat-label">intents</span>
          </div>
          <div className="brief-stat">
            <span className="brief-stat-value">{brief.nodes_created}</span>
            <span className="brief-stat-label">new nodes</span>
          </div>
          <div className="brief-stat">
            <span className="brief-stat-value">{brief.edges_strengthened}</span>
            <span className="brief-stat-label">edges strengthened</span>
          </div>
          <div className="brief-stat">
            <span className="brief-stat-value">{brief.total_nodes}</span>
            <span className="brief-stat-label">total knowledge</span>
          </div>
        </div>
      )}

      {/* Highlights */}
      {brief.highlights.length > 0 && (
        <div className="daily-brief-highlights">
          {brief.highlights.map((h, i) => (
            <div key={i} className="brief-highlight">
              <span className="brief-highlight-icon">{h.icon}</span>
              <span className="brief-highlight-text">{h.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top facets */}
      {Object.keys(brief.top_facets).length > 0 && (
        <div className="daily-brief-facets">
          <span className="brief-facets-label">Active areas:</span>
          {Object.entries(brief.top_facets).slice(0, 4).map(([facet, count]) => (
            <span key={facet} className={`brief-facet-tag type-${facet}`}>
              {facet} ({count})
            </span>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="daily-brief-actions">
        {quickActions.map((action, i) => (
          <button
            key={i}
            className="brief-action-btn"
            onClick={() => onSuggestionClick?.(action.intent)}
          >
            <span className="brief-action-icon">{action.icon}</span>
            <span className="brief-action-text">{action.text}</span>
            <span className="brief-action-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
