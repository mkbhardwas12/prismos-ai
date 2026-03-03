// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — DailySuggestions — Permanent sidebar section
//
// Always-visible sidebar panel that shows proactive, graph-aware daily
// suggestions. Updates automatically as the Spectrum Graph grows.
// Clicking a suggestion auto-fills the intent input box.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import SuggestionCard from "./SuggestionCard";
import { generateGraphSuggestions } from "../lib/suggestions";
import type { ProactiveSuggestion, SpectrumNode } from "../types";
import "./DailySuggestions.css";

interface DailySuggestionsProps {
  nodes: SpectrumNode[];
  dailyGreeting: string;
  /** Navigate to chat view and fill intent box */
  onSuggestionSelect: (intent: string) => void;
}

export default function DailySuggestions({
  nodes,
  dailyGreeting,
  onSuggestionSelect,
}: DailySuggestionsProps) {
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  /** Fetch from backend + blend with graph-aware engine */
  const refreshSuggestions = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let backendSuggestions: ProactiveSuggestion[] = [];
      try {
        const sugJson = await invoke<string>("get_proactive_suggestions");
        backendSuggestions = JSON.parse(sugJson);
      } catch { /* Backend may not have suggestions yet */ }

      const blended = generateGraphSuggestions(nodes, backendSuggestions);
      setSuggestions(blended);
      setDismissed(new Set()); // Reset dismissals on refresh
      setLastRefresh(new Date());
    } catch {
      // If all fails, use graph-only suggestions
      const fallback = generateGraphSuggestions(nodes, []);
      setSuggestions(fallback);
    } finally {
      setIsRefreshing(false);
    }
  }, [nodes]);

  // Initial load + refresh when graph nodes change
  useEffect(() => {
    refreshSuggestions();
  }, [refreshSuggestions]);

  // Auto-refresh every 10 minutes
  useEffect(() => {
    const interval = setInterval(refreshSuggestions, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshSuggestions]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const handleSelect = useCallback((sug: ProactiveSuggestion) => {
    onSuggestionSelect(sug.action_intent);
  }, [onSuggestionSelect]);

  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(s.id));

  return (
    <div className="daily-suggestions" role="region" aria-label="Daily Suggestions">
      <div className="daily-suggestions__header">
        <div className="daily-suggestions__title-row">
          <span className="daily-suggestions__icon" aria-hidden="true">💡</span>
          <span className="daily-suggestions__title">Daily Suggestions</span>
        </div>
        <button
          className={`daily-suggestions__refresh ${isRefreshing ? "spinning" : ""}`}
          onClick={refreshSuggestions}
          disabled={isRefreshing}
          title="Refresh suggestions"
          aria-label="Refresh daily suggestions"
        >
          ↻
        </button>
      </div>

      {dailyGreeting && (
        <div className="daily-suggestions__greeting">{dailyGreeting}</div>
      )}

      <div className="daily-suggestions__cards">
        {visibleSuggestions.length > 0 ? (
          visibleSuggestions.map((sug) => (
            <SuggestionCard
              key={sug.id}
              suggestion={sug}
              variant="sidebar"
              onSelect={handleSelect}
              onDismiss={handleDismiss}
            />
          ))
        ) : (
          <div className="daily-suggestions__empty">
            <span className="daily-suggestions__empty-icon">🌱</span>
            <span className="daily-suggestions__empty-text">
              {suggestions.length > 0
                ? "All suggestions dismissed"
                : "Building your suggestions…"}
            </span>
            {suggestions.length > 0 && (
              <button
                className="daily-suggestions__reset"
                onClick={() => setDismissed(new Set())}
              >
                Show again
              </button>
            )}
          </div>
        )}
      </div>

      {lastRefresh && (
        <div className="daily-suggestions__meta">
          Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {nodes.length > 0 && <> · {nodes.length} nodes</>}
        </div>
      )}
    </div>
  );
}
