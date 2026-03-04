// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// DailyBrief — Morning Brief & Evening Recap (Patent Pending)
//
// Morning (before noon): Prominent "Good morning" card with 3-4 personalized
// items from the Spectrum Graph — today's priorities, yesterday's recap, quick actions.
//
// Evening (after 6 PM): "Good evening" recap with what you accomplished,
// lessons learned (graph growth), and tomorrow prep.
//
// Uses existing proactive suggestion logic. Each item has a one-click
// "Act on this" button that fills the intent input box.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import SuggestionCard from "./SuggestionCard";
import { generateGraphSuggestions } from "../lib/suggestions";
import type { ProactiveSuggestion, SpectrumNode } from "../types";
import "./DailyBrief.css";

interface DailyBriefData {
  time_period: "morning" | "afternoon" | "evening";
  is_morning: boolean;
  is_evening: boolean;
  intents_today: number;
  nodes_created: number;
  nodes_updated: number;
  edges_strengthened: number;
  total_nodes: number;
  total_edges: number;
  top_facets: Record<string, number>;
  intent_types: Record<string, number>;
  highlights: { icon: string; text: string }[];
  yesterday_intents: number;
  yesterday_nodes: number;
  pending_topics: { label: string; node_type: string }[];
  tomorrow_priorities: { label: string; node_type: string; weight: number }[];
  new_connections_today: number;
  growth_streak: number;
}

/** Email summary data from the Email Keeper agent (read-only IMAP) */
interface EmailSummaryData {
  unread_count: number;
  recent_unread: { from: string; subject: string; date: string }[];
  ai_summary: string | null;
  categories: Record<string, number>;
  success: boolean;
  error: string | null;
}

interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location: string;
  description: string;
  all_day: boolean;
}

interface TimeConflict {
  event_a: string;
  event_b: string;
  overlap_description: string;
}

interface FreeBlock {
  start: string;
  end: string;
  duration_minutes: number;
}

interface CalendarSummaryData {
  event_count: number;
  events: CalendarEvent[];
  conflicts: TimeConflict[];
  free_blocks: FreeBlock[];
  ai_summary: string | null;
  success: boolean;
  error: string | null;
  files_scanned: number;
}

interface TickerQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  high: number;
  low: number;
  volume: string;
  market_cap: string;
  fetch_error: string | null;
}

interface FinanceSummaryData {
  ticker_count: number;
  quotes: TickerQuote[];
  gainers: string[];
  losers: string[];
  ai_summary: string | null;
  success: boolean;
  error: string | null;
  fetched_at: string;
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
  const [emailSummary, setEmailSummary] = useState<EmailSummaryData | null>(null);
  const [calendarSummary, setCalendarSummary] = useState<CalendarSummaryData | null>(null);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummaryData | null>(null);

  const { emoji, greeting, period } = getGreeting();
  const isMorning = period === "morning" || period === "night";
  const isEvening = period === "evening";

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

      // Fetch email summary if enabled in settings (credentials from localStorage)
      try {
        const settingsRaw = localStorage.getItem("prismos-settings");
        if (settingsRaw) {
          const s = JSON.parse(settingsRaw);
          if (s.emailSummaryEnabled && s.emailImapServer && s.emailUsername && s.emailPassword) {
            const emailJson = await invoke<string>("fetch_email_summary", {
              imapServer: s.emailImapServer,
              imapPort: s.emailImapPort || 993,
              username: s.emailUsername,
              password: s.emailPassword,
              useTls: s.emailUseTls !== false,
              ollamaUrl: s.ollamaUrl,
            });
            setEmailSummary(JSON.parse(emailJson));
          }
        }
      } catch (e) {
        console.warn("Email summary fetch failed (non-critical):", e);
      }

      // Fetch calendar summary if enabled in settings
      try {
        const settingsRaw = localStorage.getItem("prismos-settings");
        if (settingsRaw) {
          const s = JSON.parse(settingsRaw);
          if (s.calendarEnabled && s.calendarPath) {
            const calJson = await invoke<string>("fetch_calendar_summary", {
              calendarPath: s.calendarPath,
              ollamaUrl: s.ollamaUrl,
            });
            setCalendarSummary(JSON.parse(calJson));
          }
        }
      } catch (e) {
        console.warn("Calendar summary fetch failed (non-critical):", e);
      }

      // Fetch finance summary if enabled in settings
      try {
        const settingsRaw = localStorage.getItem("prismos-settings");
        if (settingsRaw) {
          const s = JSON.parse(settingsRaw);
          if (s.financeEnabled && s.financeTickers && s.financeTickers.length > 0) {
            const finJson = await invoke<string>("fetch_finance_summary", {
              tickers: s.financeTickers,
              ollamaUrl: s.ollamaUrl,
            });
            setFinanceSummary(JSON.parse(finJson));
          }
        }
      } catch (e) {
        console.warn("Finance summary fetch failed (non-critical):", e);
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
    const summaryIntent = isMorning
      ? "Give me a full morning brief: summarize yesterday's activity, show knowledge graph changes, and suggest my priorities for today"
      : "Give me a daily summary: what did I accomplish today, what new knowledge was added to my graph, and what should I focus on next?";
    onSuggestionClick?.(summaryIntent);
    setShowSummaryPanel(false);
  }, [onSuggestionClick, isMorning]);

  /** One-click "Act on this" handler */
  const actOn = useCallback((intent: string) => {
    onSuggestionClick?.(intent);
  }, [onSuggestionClick]);

  const hasActivity = brief && (brief.intents_today > 0 || brief.nodes_created > 0 || brief.edges_strengthened > 0);

  // ── Daily Summary floating button (always visible) ──
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

  // ── Error / loading / dismissed states ──
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
  if (dismissed) {
    return <div className="daily-brief daily-brief--collapsed">{summaryButton}</div>;
  }
  if (loading || !brief) return null;

  // ═══════════════════════════════════════════════════════════════════════
  //  MORNING BRIEF — "Good morning" with priorities + yesterday recap
  // ═══════════════════════════════════════════════════════════════════════
  if (isMorning) {
    return (
      <div className="daily-brief" data-mode="morning">
        {summaryButton}
        <div className="daily-brief-greeting-card daily-brief--morning">
          <div className="daily-brief-header">
            <div className="daily-brief-title-row">
              <h3 className="daily-brief-title">
                <span className="daily-brief-emoji">{emoji}</span> {greeting}
              </h3>
              <button className="daily-brief-dismiss" onClick={() => setDismissed(true)} title="Dismiss brief">✕</button>
            </div>
            <p className="daily-brief-subtitle">
              Here's your morning brief from the Spectrum Graph
              {brief.growth_streak > 1 && <span className="brief-streak"> · 🔥 {brief.growth_streak}-day streak</span>}
            </p>
          </div>

          {/* ── Yesterday's Recap ── */}
          {(brief.yesterday_intents > 0 || brief.yesterday_nodes > 0) && (
            <div className="brief-section">
              <h4 className="brief-section-title">📋 Yesterday's Recap</h4>
              <div className="brief-section-stats">
                <span className="brief-mini-stat">{brief.yesterday_intents} intents</span>
                <span className="brief-mini-stat">{brief.yesterday_nodes} nodes added</span>
              </div>
            </div>
          )}

          {/* ── Email Summary (Email Keeper agent — read-only, sandboxed) ── */}
          {emailSummary && emailSummary.success && emailSummary.unread_count > 0 && (
            <div className="brief-section brief-section--email">
              <h4 className="brief-section-title">📬 Email Summary</h4>
              {emailSummary.ai_summary && (
                <p className="brief-email-summary">{emailSummary.ai_summary}</p>
              )}
              <div className="brief-section-stats">
                <span className="brief-mini-stat">{emailSummary.unread_count} unread</span>
                {Object.entries(emailSummary.categories).slice(0, 3).map(([cat, count]) => (
                  <span key={cat} className="brief-mini-stat">{count} {cat}</span>
                ))}
              </div>
              {emailSummary.recent_unread.length > 0 && (
                <div className="brief-action-items">
                  {emailSummary.recent_unread.slice(0, 2).map((e, i) => (
                    <button
                      key={i}
                      className="brief-action-item brief-action-item--email"
                      onClick={() => actOn(`Help me draft a reply to the email from ${e.from} about "${e.subject}"`)}
                    >
                      <span className="brief-action-item-icon">✉️</span>
                      <span className="brief-action-item-label">{e.subject} — {e.from}</span>
                      <span className="brief-action-item-cta">Act on this →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Calendar Summary (Calendar Keeper agent — read-only, sandboxed) ── */}
          {calendarSummary && calendarSummary.success && calendarSummary.event_count > 0 && (
            <div className="brief-section brief-section--calendar">
              <h4 className="brief-section-title">📅 Today's Schedule</h4>
              {calendarSummary.ai_summary && (
                <p className="brief-calendar-summary">{calendarSummary.ai_summary}</p>
              )}
              <div className="brief-section-stats">
                <span className="brief-mini-stat">{calendarSummary.event_count} event{calendarSummary.event_count !== 1 ? "s" : ""}</span>
                {calendarSummary.conflicts.length > 0 && (
                  <span className="brief-mini-stat brief-mini-stat--warning">⚠️ {calendarSummary.conflicts.length} conflict{calendarSummary.conflicts.length !== 1 ? "s" : ""}</span>
                )}
                {calendarSummary.free_blocks.length > 0 && (
                  <span className="brief-mini-stat">🟢 {calendarSummary.free_blocks.length} free block{calendarSummary.free_blocks.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              {calendarSummary.events.length > 0 && (
                <div className="brief-action-items">
                  {calendarSummary.events.slice(0, 4).map((evt, i) => (
                    <button
                      key={i}
                      className="brief-action-item brief-action-item--calendar"
                      onClick={() => actOn(`Help me prepare for my ${evt.all_day ? "all-day " : ""}event: "${evt.summary}"${evt.location ? ` at ${evt.location}` : ""}`)}
                    >
                      <span className="brief-action-item-icon">{evt.all_day ? "📌" : "🕐"}</span>
                      <span className="brief-action-item-label">
                        {evt.all_day ? "All day" : `${evt.start} – ${evt.end}`}: {evt.summary}
                        {evt.location ? ` · ${evt.location}` : ""}
                      </span>
                      <span className="brief-action-item-cta">Prepare →</span>
                    </button>
                  ))}
                </div>
              )}
              {calendarSummary.conflicts.length > 0 && (
                <div className="brief-action-items" style={{ marginTop: "0.4rem" }}>
                  {calendarSummary.conflicts.map((c, i) => (
                    <button
                      key={`conflict-${i}`}
                      className="brief-action-item brief-action-item--conflict"
                      onClick={() => actOn(`I have a scheduling conflict: "${c.event_a}" overlaps with "${c.event_b}". ${c.overlap_description}. Help me resolve it.`)}
                    >
                      <span className="brief-action-item-icon">⚠️</span>
                      <span className="brief-action-item-label">{c.overlap_description}</span>
                      <span className="brief-action-item-cta">Resolve →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Finance Summary (Finance Keeper agent — read-only, sandboxed) ── */}
          {financeSummary && financeSummary.success && financeSummary.ticker_count > 0 && (
            <div className="brief-section brief-section--finance">
              <h4 className="brief-section-title">💰 Portfolio Watch</h4>
              {financeSummary.ai_summary && (
                <p className="brief-finance-summary">{financeSummary.ai_summary}</p>
              )}
              <div className="brief-section-stats">
                <span className="brief-mini-stat">{financeSummary.ticker_count} ticker{financeSummary.ticker_count !== 1 ? "s" : ""}</span>
                {financeSummary.gainers.length > 0 && (
                  <span className="brief-mini-stat brief-mini-stat--gain">📈 {financeSummary.gainers.length} up</span>
                )}
                {financeSummary.losers.length > 0 && (
                  <span className="brief-mini-stat brief-mini-stat--loss">📉 {financeSummary.losers.length} down</span>
                )}
              </div>
              {financeSummary.quotes.filter(q => !q.fetch_error).length > 0 && (
                <div className="brief-action-items">
                  {financeSummary.quotes.filter(q => !q.fetch_error).slice(0, 5).map((q, i) => (
                    <button
                      key={i}
                      className={`brief-action-item brief-action-item--finance ${q.change >= 0 ? "brief-action-item--gain" : "brief-action-item--loss"}`}
                      onClick={() => actOn(`Tell me more about ${q.symbol} (${q.name}). Current price: $${q.price}, change: ${q.change >= 0 ? "+" : ""}${q.change_percent}%. What's driving this movement?`)}
                    >
                      <span className="brief-action-item-icon">{q.change >= 0 ? "📈" : "📉"}</span>
                      <span className="brief-action-item-label">
                        {q.symbol} ${q.price.toFixed(2)} ({q.change >= 0 ? "+" : ""}{q.change_percent.toFixed(1)}%)
                      </span>
                      <span className="brief-action-item-cta">Tell me more →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Today's Priorities — from highest-weight graph nodes ── */}
          {brief.tomorrow_priorities.length > 0 && (
            <div className="brief-section">
              <h4 className="brief-section-title">🎯 Today's Priorities</h4>
              <div className="brief-action-items">
                {brief.tomorrow_priorities.slice(0, 3).map((p, i) => (
                  <button
                    key={i}
                    className="brief-action-item"
                    onClick={() => actOn(`Continue working on "${p.label}" — summarize progress and suggest next steps`)}
                  >
                    <span className="brief-action-item-icon">
                      {p.node_type === "task" ? "✅" : p.node_type === "work" ? "💼" : p.node_type === "learning" ? "📚" : "📌"}
                    </span>
                    <span className="brief-action-item-label">{p.label}</span>
                    <span className="brief-action-item-cta">Act on this →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Pending Topics — things you started but didn't finish ── */}
          {brief.pending_topics.length > 0 && (
            <div className="brief-section">
              <h4 className="brief-section-title">💭 Pick up where you left off</h4>
              <div className="brief-action-items">
                {brief.pending_topics.slice(0, 2).map((t, i) => (
                  <button
                    key={i}
                    className="brief-action-item brief-action-item--pending"
                    onClick={() => actOn(`Tell me more about "${t.label}" and show related connections in my graph`)}
                  >
                    <span className="brief-action-item-icon">🔍</span>
                    <span className="brief-action-item-label">{t.label}</span>
                    <span className="brief-action-item-cta">Act on this →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Quick Actions ── */}
          <div className="brief-section">
            <h4 className="brief-section-title">⚡ Quick Actions</h4>
            <div className="brief-quick-actions">
              <button className="brief-quick-btn" onClick={() => actOn("Help me plan today — suggest a prioritized schedule based on my recent Spectrum Graph activity")}>
                📝 Plan my day
              </button>
              <button className="brief-quick-btn" onClick={() => actOn("Show me how my knowledge graph has grown this week — any new connections?")}>
                🌱 Graph insights
              </button>
              <button className="brief-quick-btn" onClick={() => actOn("What patterns or insights have emerged in my knowledge graph since yesterday?")}>
                🔗 New patterns
              </button>
            </div>
          </div>

          {/* ── Graph-personalized suggestion cards ── */}
          {graphSuggestions.length > 0 && (
            <div className="daily-brief-suggestion-cards">
              {graphSuggestions.map((sug) => (
                <SuggestionCard key={sug.id} suggestion={sug} variant="inline" onSelect={handleSuggestionSelect} />
              ))}
            </div>
          )}

          {/* Stats strip */}
          <div className="daily-brief-stats">
            <div className="brief-stat">
              <span className="brief-stat-value">{brief.total_nodes}</span>
              <span className="brief-stat-label">total nodes</span>
            </div>
            <div className="brief-stat">
              <span className="brief-stat-value">{brief.total_edges}</span>
              <span className="brief-stat-label">connections</span>
            </div>
            <div className="brief-stat">
              <span className="brief-stat-value">{brief.growth_streak}</span>
              <span className="brief-stat-label">day streak</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EVENING RECAP — "Good evening" with accomplishments + lessons + prep
  // ═══════════════════════════════════════════════════════════════════════
  if (isEvening) {
    return (
      <div className="daily-brief" data-mode="evening">
        {summaryButton}
        <div className="daily-brief-greeting-card daily-brief--evening">
          <div className="daily-brief-header">
            <div className="daily-brief-title-row">
              <h3 className="daily-brief-title">
                <span className="daily-brief-emoji">{emoji}</span> {greeting}
              </h3>
              <button className="daily-brief-dismiss" onClick={() => setDismissed(true)} title="Dismiss recap">✕</button>
            </div>
            <p className="daily-brief-subtitle">
              {hasActivity
                ? "Here's what PrismOS-AI accomplished for you today"
                : "Your graph is ready — here's your evening overview"}
            </p>
          </div>

          {/* ── What You Accomplished ── */}
          {hasActivity && (
            <div className="brief-section">
              <h4 className="brief-section-title">✅ What You Accomplished</h4>
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
                  <span className="brief-stat-value">{brief.new_connections_today}</span>
                  <span className="brief-stat-label">new links</span>
                </div>
              </div>
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
            </div>
          )}

          {/* ── Lessons Learned — graph growth patterns ── */}
          {(brief.new_connections_today > 0 || brief.nodes_created > 0 || Object.keys(brief.top_facets).length > 0) && (
            <div className="brief-section">
              <h4 className="brief-section-title">🧠 Lessons & Growth</h4>
              <div className="brief-lessons">
                {brief.new_connections_today > 0 && (
                  <div className="brief-lesson-item">
                    <span className="brief-lesson-icon">🔗</span>
                    <span>Discovered {brief.new_connections_today} new connection{brief.new_connections_today !== 1 ? "s" : ""} in your knowledge graph</span>
                  </div>
                )}
                {brief.nodes_created > 0 && (
                  <div className="brief-lesson-item">
                    <span className="brief-lesson-icon">✨</span>
                    <span>Added {brief.nodes_created} new knowledge node{brief.nodes_created !== 1 ? "s" : ""} to your graph</span>
                  </div>
                )}
                {Object.keys(brief.top_facets).length > 0 && (
                  <div className="brief-lesson-item">
                    <span className="brief-lesson-icon">📊</span>
                    <span>Most active areas: {Object.entries(brief.top_facets).slice(0, 3).map(([f, c]) => `${f} (${c})`).join(", ")}</span>
                  </div>
                )}
                {brief.growth_streak > 1 && (
                  <div className="brief-lesson-item">
                    <span className="brief-lesson-icon">🔥</span>
                    <span>{brief.growth_streak}-day graph growth streak — keep it going!</span>
                  </div>
                )}
              </div>
              <button
                className="brief-lesson-act"
                onClick={() => actOn("Review today's knowledge graph growth — what patterns emerged and what should I reinforce?")}
              >
                🔎 Analyze today's patterns →
              </button>
            </div>
          )}

          {/* ── Tomorrow Prep ── */}
          {brief.tomorrow_priorities.length > 0 && (
            <div className="brief-section">
              <h4 className="brief-section-title">📅 Prepare for Tomorrow</h4>
              <div className="brief-action-items">
                {brief.tomorrow_priorities.slice(0, 3).map((p, i) => (
                  <button
                    key={i}
                    className="brief-action-item brief-action-item--tomorrow"
                    onClick={() => actOn(`Prepare a plan for "${p.label}" — what should I focus on tomorrow?`)}
                  >
                    <span className="brief-action-item-icon">
                      {p.node_type === "task" ? "✅" : p.node_type === "work" ? "💼" : "📌"}
                    </span>
                    <span className="brief-action-item-label">{p.label}</span>
                    <span className="brief-action-item-cta">Act on this →</span>
                  </button>
                ))}
              </div>
              <div className="brief-quick-actions">
                <button className="brief-quick-btn" onClick={() => actOn("Prepare a draft schedule for tomorrow based on today's patterns and pending tasks")}>
                  📅 Plan tomorrow
                </button>
                <button className="brief-quick-btn" onClick={() => actOn("Let me do a quick brain dump — capture my current thoughts and ideas for tomorrow")}>
                  💭 Brain dump
                </button>
              </div>
            </div>
          )}

          {/* ── Graph-personalized suggestion cards ── */}
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

  // ═══════════════════════════════════════════════════════════════════════
  //  AFTERNOON — Generic brief (existing behavior preserved)
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="daily-brief" data-mode="afternoon">
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
            {hasActivity
              ? "Here's what PrismOS-AI did for you today"
              : "Your graph is ready — start an intent to build knowledge"}
          </p>
        </div>

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
              <span className="brief-stat-label">total</span>
            </div>
          </div>
        )}

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

        {graphSuggestions.length > 0 && (
          <div className="daily-brief-suggestion-cards">
            {graphSuggestions.map((sug) => (
              <SuggestionCard key={sug.id} suggestion={sug} variant="inline" onSelect={handleSuggestionSelect} />
            ))}
          </div>
        )}

        {graphSuggestions.length === 0 && (
          <div className="daily-brief-actions">
            {[
              { icon: "📊", text: "Quick progress check", intent: "Summarize what I've accomplished today and what's still pending" },
              { icon: "🔗", text: "Discover connections", intent: "What unexpected connections exist between my recent topics?" },
            ].map((action, i) => (
              <button
                key={i}
                className="brief-action-btn"
                onClick={() => actOn(action.intent)}
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
