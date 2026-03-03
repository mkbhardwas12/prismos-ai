// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// DailyBrief — Morning Brief, Evening Recap & Daily Summary
//
// On startup: shows a prominent, non-intrusive greeting card with personalized
// graph-aware suggestions. Includes a "Daily Summary" button that triggers
// a full recap intent. Dismissible with easy re-open.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import SuggestionCard from "./SuggestionCard";
import { generateGraphSuggestions } from "../lib/suggestions";
import type { ProactiveSuggestion, SpectrumNode } from "../types";
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

/** Time-aware greeting with appropriate emoji */
function getGreeting(): { emoji: string; greeting: string; period: string } {
  const h = new Date().getHours();
  if (h < 6) return { emoji: "🌙", greeting: "Late night session", period: "night" };
  if (h < 12) return { emoji: "☀️", greeting: "Good morning", period: "morning" };
  if (h < 17) return { emoji: "🌤️", greeting: "Good afternoon", period: "afternoon" };
  if (h < 21) return { emoji: "🌆", greeting: "Good evening", period: "evening" };
  return { emoji: "🌙", greeting: "Working late", period: "night" };
}

export default function DailyBrief({ onSuggestionClick }: DailyBriefProps) {
  const [brief, setBrief] = useState<DailyBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState(false);
  const [graphSuggestions, setGraphSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);

  const { emoji, greeting, period } = getGreeting();

  const loadBrief = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<string>("get_daily_brief");
      const data: DailyBriefData = JSON.parse(result);
      setBrief(data);

      // Fetch graph-aware suggestions to blend with the brief
      try {
        const sugJson = await invoke<string>("get_proactive_suggestions");
        const backendSugs: ProactiveSuggestion[] = JSON.parse(sugJson);
        let nodes: SpectrumNode[] = [];
        try {
          const nodesJson = await invoke<string>("get_spectrum_nodes");
          nodes = JSON.parse(nodesJson);
        } catch { /* no nodes yet */ }
        const enriched = generateGraphSuggestions(nodes, backendSugs);
        setGraphSuggestions(enriched);
      } catch {
        setGraphSuggestions(generateGraphSuggestions([], []));
      }
    } catch (e) {
      console.error("Failed to load daily brief:", e);
      setError(true);
      setGraphSuggestions(generateGraphSuggestions([], []));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBrief();
    const interval = setInterval(loadBrief, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadBrief]);

  const handleSuggestionSelect = useCallback((sug: ProactiveSuggestion) => {
    onSuggestionClick?.(sug.action_intent);
  }, [onSuggestionClick]);

  const handleDailySummary = useCallback(() => {
    const summaryIntent = period === "morning" || period === "night"
      ? "Give me a full morning brief: summarize yesterday's activity, show knowledge graph changes, and suggest my priorities for today"
      : "Give me a daily summary: what did I accomplish today, what new knowledge was added to my graph, and what should I focus on next?";
    onSuggestionClick?.(summaryIntent);
    setShowSummaryPanel(false);
  }, [onSuggestionClick, period]);

  const hasActivity = brief && (brief.intents_today > 0 || brief.nodes_created > 0 || brief.edges_strengthened > 0);

  // ── Daily Summary button (always visible, even when brief is dismissed) ──
  const summaryButton = (
    <div className="daily-summary-trigger">
      <button
        className="daily-summary-btn"
        onClick={() => {
          if (dismissed) {
            setDismissed(false);
          } else {
            setShowSummaryPanel(v => !v);
          }
        }}
        title={dismissed ? "Show today's brief" : "Daily Summary"}
        aria-label="Daily Summary"
      >
        <span className="daily-summary-btn-icon">📋</span>
        <span className="daily-summary-btn-text">Daily Summary</span>
      </button>

      {/* Quick summary dropdown panel */}
      {showSummaryPanel && !dismissed && (
        <div className="daily-summary-panel" role="dialog" aria-label="Daily Summary">
          <div className="daily-summary-panel-header">
            <span className="daily-summary-panel-title">📊 Today at a Glance</span>
            <button
              className="daily-summary-panel-close"
              onClick={() => setShowSummaryPanel(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {brief && (
            <div className="daily-summary-panel-stats">
              <div className="dsps-stat">
                <span className="dsps-value">{brief.intents_today}</span>
                <span className="dsps-label">intents</span>
              </div>
              <div className="dsps-stat">
                <span className="dsps-value">{brief.nodes_created}</span>
                <span className="dsps-label">new nodes</span>
              </div>
              <div className="dsps-stat">
                <span className="dsps-value">{brief.edges_strengthened}</span>
                <span className="dsps-label">edges</span>
              </div>
              <div className="dsps-stat">
                <span className="dsps-value">{brief.total_nodes}</span>
                <span className="dsps-label">total</span>
              </div>
            </div>
          )}
          {brief && brief.highlights.length > 0 && (
            <div className="daily-summary-panel-highlights">
              {brief.highlights.slice(0, 3).map((h, i) => (
                <div key={i} className="dsps-highlight">
                  <span>{h.icon}</span> <span>{h.text}</span>
                </div>
              ))}
            </div>
          )}
          <button className="daily-summary-full-btn" onClick={handleDailySummary}>
            <span>🧠</span> Get Full AI Summary
            <span className="daily-summary-full-arrow">→</span>
          </button>
        </div>
      )}
    </div>
  );

  // ── Error state — still show greeting with time-based suggestions ──
  if (error && !dismissed) {
    return (
      <div className="daily-brief">
        {summaryButton}
        <div className="daily-brief-greeting-card">
          <div className="daily-brief-header">
            <div className="daily-brief-title-row">
              <h3 className="daily-brief-title">
                <span className="daily-brief-emoji">{emoji}</span> {greeting}
              </h3>
              <button className="daily-brief-dismiss" onClick={() => setDismissed(true)} title="Dismiss">✕</button>
            </div>
            <p className="daily-brief-subtitle">Your graph is ready — here are some suggestions to get started</p>
          </div>
          {graphSuggestions.length > 0 && (
            <div className="daily-brief-suggestion-cards">
              {graphSuggestions.map((sug) => (
                <SuggestionCard key={sug.id} suggestion={sug} variant="inline" onSelect={handleSuggestionSelect} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Dismissed — just the re-open button ──
  if (dismissed) {
    return <div className="daily-brief daily-brief--collapsed">{summaryButton}</div>;
  }

  // ── Loading ──
  if (loading || !brief) return null;

  // ── Full greeting + brief card ──
  return (
    <div className="daily-brief">
      {summaryButton}
      <div className="daily-brief-greeting-card">
        <div className="daily-brief-header">
          <div className="daily-brief-title-row">
            <h3 className="daily-brief-title">
              <span className="daily-brief-emoji">{emoji}</span> {greeting}
            </h3>
            <button className="daily-brief-dismiss" onClick={() => setDismissed(true)} title="Dismiss brief">✕</button>
          </div>
          <p className="daily-brief-subtitle">
            {brief.is_morning
              ? "Here's what your Spectrum Graph has been up to"
              : hasActivity
              ? "Here's what PrismOS-AI did for you today"
              : "Your graph is ready — start an intent to build knowledge"}
          </p>
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
              <span className="brief-stat-label">edges</span>
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

        {/* Graph-personalized suggestion cards (2-3) */}
        {graphSuggestions.length > 0 && (
          <div className="daily-brief-suggestion-cards">
            {graphSuggestions.map((sug) => (
              <SuggestionCard key={sug.id} suggestion={sug} variant="inline" onSelect={handleSuggestionSelect} />
            ))}
          </div>
        )}

        {/* Fallback quick actions when no graph suggestions */}
        {graphSuggestions.length === 0 && (
          <div className="daily-brief-actions">
            {(brief.is_morning
              ? [
                  { icon: "📊", text: "Show my graph overview", intent: "Show me an overview of my knowledge graph" },
                  { icon: "💡", text: "Surprise me", intent: "Suggest something interesting I haven't explored yet" },
                ]
              : [
                  { icon: "📝", text: "Summarize my day", intent: "Summarize what I worked on today" },
                  { icon: "🎯", text: "Plan tomorrow", intent: "Based on my graph, what should I focus on tomorrow?" },
                ]
            ).map((action, i) => (
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
        )}
      </div>
    </div>
  );
}
