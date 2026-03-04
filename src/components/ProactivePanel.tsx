// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — ProactivePanel — Permanent collapsible sidebar panel
//
// The most visible, helpful part of the UI. Pulls live data from:
// - Spectrum Graph (recent nodes, knowledge hubs)
// - Calendar Keeper (today's events, conflicts)
// - Email Keeper (unread summary)
// - Finance Keeper (portfolio movers)
// - Time-aware contextual suggestions
//
// Updates throughout the day. Collapsible to save sidebar space.

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { generateGraphSuggestions } from "../lib/suggestions";
import type { ProactiveSuggestion, SpectrumNode } from "../types";
import "./ProactivePanel.css";

// ── Lightweight data interfaces for live feeds ──

interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
}

interface CalendarFeed {
  event_count: number;
  events: CalendarEvent[];
  conflicts: { event_a: string; event_b: string; overlap_description: string }[];
  success: boolean;
}

interface EmailFeed {
  unread_count: number;
  recent_unread: { from: string; subject: string }[];
  success: boolean;
}

interface TickerQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  fetch_error: string | null;
}

interface FinanceFeed {
  ticker_count: number;
  quotes: TickerQuote[];
  success: boolean;
}

interface ProactivePanelProps {
  nodes: SpectrumNode[];
  dailyGreeting: string;
  onSuggestionSelect: (intent: string) => void;
}

/** Time-aware period label */
function getTimePeriod(): string {
  const h = new Date().getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

export default function ProactivePanel({
  nodes,
  dailyGreeting,
  onSuggestionSelect,
}: ProactivePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [calendarFeed, setCalendarFeed] = useState<CalendarFeed | null>(null);
  const [emailFeed, setEmailFeed] = useState<EmailFeed | null>(null);
  const [financeFeed, setFinanceFeed] = useState<FinanceFeed | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch all live feeds ──
  const refreshAll = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsRefreshing(true);

    // 1. Suggestions from backend + graph
    try {
      let backendSugs: ProactiveSuggestion[] = [];
      try {
        const sugJson = await invoke<string>("get_proactive_suggestions");
        backendSugs = JSON.parse(sugJson);
      } catch { /* no backend suggestions */ }
      const blended = generateGraphSuggestions(nodes, backendSugs);
      if (mountedRef.current) {
        setSuggestions(blended);
        setDismissed(new Set());
      }
    } catch { /* fallback to empty */ }

    // 2. Calendar feed (if enabled)
    try {
      const raw = localStorage.getItem("prismos-settings");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.calendarEnabled && s.calendarPath) {
          const json = await invoke<string>("fetch_calendar_summary", {
            calendarPath: s.calendarPath,
            ollamaUrl: s.ollamaUrl,
          });
          if (mountedRef.current) setCalendarFeed(JSON.parse(json));
        }
      }
    } catch { /* non-critical */ }

    // 3. Email feed (if enabled)
    try {
      const raw = localStorage.getItem("prismos-settings");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.emailSummaryEnabled && s.emailImapServer && s.emailUsername && s.emailPassword) {
          const json = await invoke<string>("fetch_email_summary", {
            imapServer: s.emailImapServer,
            imapPort: s.emailImapPort || 993,
            username: s.emailUsername,
            password: s.emailPassword,
            useTls: s.emailUseTls !== false,
            ollamaUrl: s.ollamaUrl,
          });
          if (mountedRef.current) setEmailFeed(JSON.parse(json));
        }
      }
    } catch { /* non-critical */ }

    // 4. Finance feed (if enabled)
    try {
      const raw = localStorage.getItem("prismos-settings");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.financeEnabled && s.financeTickers && s.financeTickers.length > 0) {
          const json = await invoke<string>("fetch_finance_summary", {
            tickers: s.financeTickers,
            ollamaUrl: s.ollamaUrl,
          });
          if (mountedRef.current) setFinanceFeed(JSON.parse(json));
        }
      }
    } catch { /* non-critical */ }

    if (mountedRef.current) {
      setLastRefresh(new Date());
      setIsRefreshing(false);
    }
  }, [nodes]);

  // Initial load + refresh on node changes
  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Auto-refresh every 10 minutes
  useEffect(() => {
    const iv = setInterval(refreshAll, 10 * 60 * 1000);
    return () => clearInterval(iv);
  }, [refreshAll]);

  const act = useCallback((intent: string) => {
    onSuggestionSelect(intent);
  }, [onSuggestionSelect]);

  const period = getTimePeriod();
  const visibleSugs = suggestions.filter(s => !dismissed.has(s.id));

  // Count active feeds for the badge
  const feedCount =
    (calendarFeed?.success && calendarFeed.event_count > 0 ? 1 : 0) +
    (emailFeed?.success && emailFeed.unread_count > 0 ? 1 : 0) +
    (financeFeed?.success && financeFeed.ticker_count > 0 ? 1 : 0) +
    visibleSugs.length;

  return (
    <div
      className={`proactive-panel ${collapsed ? "proactive-panel--collapsed" : ""}`}
      role="region"
      aria-label="Today's Suggestions"
    >
      {/* ── Header (always visible) ── */}
      <button
        className="proactive-panel__header"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-controls="proactive-panel-body"
      >
        <div className="proactive-panel__title-row">
          <span className="proactive-panel__pulse" aria-hidden="true" />
          <span className="proactive-panel__icon" aria-hidden="true">⚡</span>
          <span className="proactive-panel__title">Today&apos;s Suggestions</span>
          {feedCount > 0 && (
            <span className="proactive-panel__count">{feedCount}</span>
          )}
        </div>
        <span className={`proactive-panel__chevron ${collapsed ? "" : "proactive-panel__chevron--open"}`}>
          ›
        </span>
      </button>

      {/* ── Collapsible body ── */}
      {!collapsed && (
        <div className="proactive-panel__body" id="proactive-panel-body">
          {/* Period greeting */}
          {dailyGreeting && (
            <div className="proactive-panel__greeting">{dailyGreeting}</div>
          )}

          {/* ── Calendar feed ── */}
          {calendarFeed?.success && calendarFeed.event_count > 0 && (
            <div className="proactive-panel__feed proactive-panel__feed--calendar">
              <div className="proactive-panel__feed-header">
                <span className="proactive-panel__feed-icon">📅</span>
                <span className="proactive-panel__feed-label">
                  {calendarFeed.event_count} event{calendarFeed.event_count !== 1 ? "s" : ""} today
                </span>
                {calendarFeed.conflicts.length > 0 && (
                  <span className="proactive-panel__feed-alert">⚠️ {calendarFeed.conflicts.length}</span>
                )}
              </div>
              <div className="proactive-panel__feed-items">
                {calendarFeed.events.slice(0, 3).map((evt, i) => (
                  <button
                    key={`cal-${i}`}
                    className="proactive-panel__feed-item"
                    onClick={() => act(`Help me prepare for my ${evt.all_day ? "all-day " : ""}event: "${evt.summary}"${evt.location ? ` at ${evt.location}` : ""}`)}
                  >
                    <span className="proactive-panel__feed-item-time">
                      {evt.all_day ? "All day" : evt.start}
                    </span>
                    <span className="proactive-panel__feed-item-text">{evt.summary}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Email feed ── */}
          {emailFeed?.success && emailFeed.unread_count > 0 && (
            <div className="proactive-panel__feed proactive-panel__feed--email">
              <div className="proactive-panel__feed-header">
                <span className="proactive-panel__feed-icon">📬</span>
                <span className="proactive-panel__feed-label">
                  {emailFeed.unread_count} unread email{emailFeed.unread_count !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="proactive-panel__feed-items">
                {emailFeed.recent_unread.slice(0, 2).map((e, i) => (
                  <button
                    key={`em-${i}`}
                    className="proactive-panel__feed-item"
                    onClick={() => act(`Help me draft a reply to the email from ${e.from} about "${e.subject}"`)}
                  >
                    <span className="proactive-panel__feed-item-text">
                      {e.subject} — <em>{e.from}</em>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Finance feed ── */}
          {financeFeed?.success && financeFeed.ticker_count > 0 && (
            <div className="proactive-panel__feed proactive-panel__feed--finance">
              <div className="proactive-panel__feed-header">
                <span className="proactive-panel__feed-icon">💰</span>
                <span className="proactive-panel__feed-label">Portfolio</span>
              </div>
              <div className="proactive-panel__feed-items proactive-panel__feed-items--tickers">
                {financeFeed.quotes.filter(q => !q.fetch_error).slice(0, 4).map((q, i) => (
                  <button
                    key={`fin-${i}`}
                    className={`proactive-panel__ticker ${q.change >= 0 ? "proactive-panel__ticker--up" : "proactive-panel__ticker--down"}`}
                    onClick={() => act(`Tell me more about ${q.symbol} (${q.name}). Current price: $${q.price}, change: ${q.change >= 0 ? "+" : ""}${q.change_percent}%. What's driving this movement?`)}
                    title={`${q.name} — $${q.price.toFixed(2)} (${q.change >= 0 ? "+" : ""}${q.change_percent.toFixed(1)}%)`}
                  >
                    <span className="proactive-panel__ticker-symbol">{q.symbol}</span>
                    <span className={`proactive-panel__ticker-change ${q.change >= 0 ? "up" : "down"}`}>
                      {q.change >= 0 ? "▲" : "▼"} {Math.abs(q.change_percent).toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Smart suggestions (graph-aware + time-aware) ── */}
          {visibleSugs.length > 0 && (
            <div className="proactive-panel__suggestions">
              <div className="proactive-panel__feed-header">
                <span className="proactive-panel__feed-icon">💡</span>
                <span className="proactive-panel__feed-label">
                  {period === "morning" ? "Start your day" : period === "evening" ? "Wrap up" : "Suggestions"}
                </span>
              </div>
              <div className="proactive-panel__feed-items">
                {visibleSugs.map(sug => (
                  <button
                    key={sug.id}
                    className={`proactive-panel__sug-item proactive-panel__sug--${sug.category}`}
                    onClick={() => act(sug.action_intent)}
                  >
                    <span className="proactive-panel__sug-icon">{sug.icon}</span>
                    <span className="proactive-panel__sug-text">{sug.text}</span>
                    <span
                      className="proactive-panel__sug-dismiss"
                      role="button"
                      tabIndex={0}
                      aria-label="Dismiss"
                      onClick={(e) => { e.stopPropagation(); setDismissed(prev => new Set(prev).add(sug.id)); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); setDismissed(prev => new Set(prev).add(sug.id)); } }}
                    >×</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Graph insights ── */}
          {nodes.length > 0 && (
            <div className="proactive-panel__graph-insight">
              <button
                className="proactive-panel__feed-item"
                onClick={() => act(`What patterns or insights have emerged in my knowledge graph? I have ${nodes.length} nodes.`)}
              >
                <span className="proactive-panel__feed-item-text">
                  🕸️ {nodes.length} node{nodes.length !== 1 ? "s" : ""} in your graph — explore insights
                </span>
              </button>
            </div>
          )}

          {/* ── Footer ── */}
          <div className="proactive-panel__footer">
            <button
              className={`proactive-panel__refresh ${isRefreshing ? "proactive-panel__refresh--spinning" : ""}`}
              onClick={refreshAll}
              disabled={isRefreshing}
              title="Refresh all feeds"
              aria-label="Refresh suggestions"
            >
              ↻ Refresh
            </button>
            {lastRefresh && (
              <span className="proactive-panel__updated">
                {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
