// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// DailyDashboard — Your personal command center for the day.
//
// Combines Morning Brief, Proactive Suggestions, Quick Links,
// and live feeds into one beautiful dashboard view.
// Can be set as the default startup view in Settings.

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { generateGraphSuggestions } from "../lib/suggestions";
import SuggestionCard from "./SuggestionCard";
import type { ProactiveSuggestion, SpectrumNode, GraphStats } from "../types";
import "./DailyDashboard.css";

// ── Data interfaces (aligned with DailyBrief & ProactivePanel) ──

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

interface DailyDashboardProps {
  nodes: SpectrumNode[];
  graphStats: GraphStats;
  dailyGreeting: string;
  onNavigate: (view: string) => void;
  onSuggestionClick: (intent: string) => void;
}

/** Time-aware greeting with emoji */
function getGreeting(): { emoji: string; greeting: string; period: string } {
  const h = new Date().getHours();
  if (h < 6) return { emoji: "🌙", greeting: "Late night session", period: "night" };
  if (h < 12) return { emoji: "☀️", greeting: "Good morning", period: "morning" };
  if (h < 17) return { emoji: "🌤️", greeting: "Good afternoon", period: "afternoon" };
  if (h < 21) return { emoji: "🌆", greeting: "Good evening", period: "evening" };
  return { emoji: "🌙", greeting: "Working late", period: "night" };
}

export default function DailyDashboard({
  nodes,
  graphStats,
  dailyGreeting,
  onNavigate,
  onSuggestionClick,
}: DailyDashboardProps) {
  const [brief, setBrief] = useState<DailyBriefData | null>(null);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [calendarFeed, setCalendarFeed] = useState<CalendarFeed | null>(null);
  const [emailFeed, setEmailFeed] = useState<EmailFeed | null>(null);
  const [financeFeed, setFinanceFeed] = useState<FinanceFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { emoji, greeting, period } = getGreeting();

  // ── Fetch all dashboard data ──
  const loadDashboard = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    // 1. Daily Brief from backend
    try {
      const json = await invoke<string>("get_daily_brief");
      if (mountedRef.current) setBrief(JSON.parse(json));
    } catch { /* non-critical */ }

    // 2. Suggestions
    try {
      let backend: ProactiveSuggestion[] = [];
      try {
        const sugJson = await invoke<string>("get_proactive_suggestions");
        backend = JSON.parse(sugJson);
      } catch { /* */ }
      const blended = generateGraphSuggestions(nodes, backend);
      if (mountedRef.current) setSuggestions(blended);
    } catch { /* */ }

    // 3. Calendar
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
    } catch { /* */ }

    // 4. Email
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
    } catch { /* */ }

    // 5. Finance
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
    } catch { /* */ }

    if (mountedRef.current) {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, [nodes]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Auto-refresh every 10 minutes
  useEffect(() => {
    const iv = setInterval(loadDashboard, 10 * 60 * 1000);
    return () => clearInterval(iv);
  }, [loadDashboard]);

  const act = useCallback((intent: string) => {
    onSuggestionClick(intent);
  }, [onSuggestionClick]);

  // Quick link definitions
  const quickLinks = [
    { icon: "💬", label: "Intent Console", view: "chat", desc: "Chat with AI agents" },
    { icon: "🕸️", label: "Spectrum Graph", view: "graph", desc: "Visualize knowledge" },
    { icon: "🌈", label: "Explorer", view: "spectrum", desc: "Browse all nodes" },
    { icon: "📅", label: "Timeline", view: "timeline", desc: "View history" },
    { icon: "🔒", label: "Sandbox", view: "sandbox", desc: "Safe execution" },
    { icon: "⚙️", label: "Settings", view: "settings", desc: "Configure PrismOS" },
  ];

  return (
    <div className="daily-dashboard" role="main" aria-label="Daily Dashboard">

      {/* ═══ Hero greeting ═══ */}
      <header className="dd-hero">
        <div className="dd-hero__greeting">
          <span className="dd-hero__emoji">{emoji}</span>
          <div>
            <h1 className="dd-hero__title">{greeting}</h1>
            <p className="dd-hero__subtitle">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {brief && ` · ${brief.intents_today} intent${brief.intents_today !== 1 ? "s" : ""} today`}
            </p>
          </div>
        </div>
        <button
          className="dd-hero__refresh"
          onClick={loadDashboard}
          disabled={loading}
          aria-label="Refresh dashboard"
        >
          {loading ? "⏳" : "↻"} Refresh
        </button>
      </header>

      {/* ═══ Stats strip ═══ */}
      {brief && (
        <div className="dd-stats">
          <div className="dd-stat" title="Intents processed today">
            <span className="dd-stat__value">{brief.intents_today}</span>
            <span className="dd-stat__label">Intents</span>
          </div>
          <div className="dd-stat" title="Knowledge nodes in graph">
            <span className="dd-stat__value">{graphStats.nodes}</span>
            <span className="dd-stat__label">Nodes</span>
          </div>
          <div className="dd-stat" title="Graph connections">
            <span className="dd-stat__value">{graphStats.edges}</span>
            <span className="dd-stat__label">Edges</span>
          </div>
          <div className="dd-stat" title="New connections today">
            <span className="dd-stat__value">{brief.new_connections_today}</span>
            <span className="dd-stat__label">New Links</span>
          </div>
          {brief.growth_streak > 1 && (
            <div className="dd-stat dd-stat--streak" title="Days in a row with graph growth">
              <span className="dd-stat__value">🔥 {brief.growth_streak}</span>
              <span className="dd-stat__label">Day Streak</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ Main grid ═══ */}
      <div className="dd-grid">

        {/* ── Calendar card ── */}
        {calendarFeed?.success && calendarFeed.event_count > 0 && (
          <section className="dd-card dd-card--calendar" aria-label="Today's Calendar">
            <div className="dd-card__header">
              <span className="dd-card__icon">📅</span>
              <h2 className="dd-card__title">Today&apos;s Schedule</h2>
              <span className="dd-card__badge">{calendarFeed.event_count}</span>
            </div>
            {calendarFeed.conflicts.length > 0 && (
              <div className="dd-card__alert">
                ⚠️ {calendarFeed.conflicts.length} scheduling conflict{calendarFeed.conflicts.length !== 1 ? "s" : ""}
              </div>
            )}
            <ul className="dd-card__list">
              {calendarFeed.events.slice(0, 5).map((evt, i) => (
                <li key={`cal-${i}`} className="dd-card__list-item">
                  <button
                    className="dd-card__list-btn"
                    onClick={() => act(`Help me prepare for "${evt.summary}"${evt.location ? ` at ${evt.location}` : ""}`)}
                  >
                    <span className="dd-card__list-time">{evt.all_day ? "All day" : evt.start}</span>
                    <span className="dd-card__list-text">{evt.summary}</span>
                    {evt.location && <span className="dd-card__list-meta">📍 {evt.location}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Email card ── */}
        {emailFeed?.success && emailFeed.unread_count > 0 && (
          <section className="dd-card dd-card--email" aria-label="Unread Emails">
            <div className="dd-card__header">
              <span className="dd-card__icon">📬</span>
              <h2 className="dd-card__title">Inbox</h2>
              <span className="dd-card__badge">{emailFeed.unread_count}</span>
            </div>
            <ul className="dd-card__list">
              {emailFeed.recent_unread.slice(0, 4).map((e, i) => (
                <li key={`em-${i}`} className="dd-card__list-item">
                  <button
                    className="dd-card__list-btn"
                    onClick={() => act(`Help me draft a reply to ${e.from} about "${e.subject}"`)}
                  >
                    <span className="dd-card__list-text">{e.subject}</span>
                    <span className="dd-card__list-meta">{e.from}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Finance card ── */}
        {financeFeed?.success && financeFeed.ticker_count > 0 && (
          <section className="dd-card dd-card--finance" aria-label="Portfolio">
            <div className="dd-card__header">
              <span className="dd-card__icon">💰</span>
              <h2 className="dd-card__title">Portfolio</h2>
            </div>
            <div className="dd-tickers">
              {financeFeed.quotes.filter(q => !q.fetch_error).slice(0, 6).map((q, i) => (
                <button
                  key={`fin-${i}`}
                  className={`dd-ticker ${q.change >= 0 ? "dd-ticker--up" : "dd-ticker--down"}`}
                  onClick={() => act(`Analyze ${q.symbol} (${q.name}). Price: $${q.price.toFixed(2)}, change: ${q.change >= 0 ? "+" : ""}${q.change_percent.toFixed(1)}%`)}
                  title={`${q.name} — $${q.price.toFixed(2)}`}
                >
                  <span className="dd-ticker__symbol">{q.symbol}</span>
                  <span className="dd-ticker__price">${q.price.toFixed(2)}</span>
                  <span className={`dd-ticker__change ${q.change >= 0 ? "up" : "down"}`}>
                    {q.change >= 0 ? "▲" : "▼"} {Math.abs(q.change_percent).toFixed(1)}%
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Highlights card ── */}
        {brief && brief.highlights?.length > 0 && (
          <section className="dd-card dd-card--highlights" aria-label="Today's Highlights">
            <div className="dd-card__header">
              <span className="dd-card__icon">✨</span>
              <h2 className="dd-card__title">Highlights</h2>
            </div>
            <ul className="dd-card__list">
              {brief.highlights.slice(0, 4).map((h, i) => (
                <li key={`hl-${i}`} className="dd-card__list-item dd-card__list-item--highlight">
                  <span className="dd-card__list-icon">{h.icon}</span>
                  <span className="dd-card__list-text">{h.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Pending Topics card ── */}
        {brief && brief.pending_topics?.length > 0 && (
          <section className="dd-card dd-card--pending" aria-label="Pending Topics">
            <div className="dd-card__header">
              <span className="dd-card__icon">📋</span>
              <h2 className="dd-card__title">Pick Up Where You Left Off</h2>
            </div>
            <ul className="dd-card__list">
              {brief.pending_topics.slice(0, 4).map((t, i) => (
                <li key={`pt-${i}`} className="dd-card__list-item">
                  <button
                    className="dd-card__list-btn"
                    onClick={() => act(`Continue exploring the topic: "${t.label}"`)}
                  >
                    <span className="dd-card__list-text">{t.label}</span>
                    <span className="dd-card__list-tag">{t.node_type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Proactive suggestions card ── */}
        {suggestions.length > 0 && (
          <section className="dd-card dd-card--suggestions" aria-label="Suggestions">
            <div className="dd-card__header">
              <span className="dd-card__icon">💡</span>
              <h2 className="dd-card__title">
                {period === "morning" ? "Start Your Day" : period === "evening" ? "Wrap Up" : "Suggested Actions"}
              </h2>
            </div>
            <div className="dd-suggestions">
              {suggestions.map(sug => (
                <SuggestionCard
                  key={sug.id}
                  suggestion={sug}
                  variant="inline"
                  onSelect={() => act(sug.action_intent)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ═══ Quick Links ═══ */}
      <section className="dd-quicklinks" aria-label="Quick Links">
        <h2 className="dd-quicklinks__title">Quick Links</h2>
        <div className="dd-quicklinks__grid">
          {quickLinks.map(link => (
            <button
              key={link.view}
              className="dd-quicklink"
              onClick={() => onNavigate(link.view)}
            >
              <span className="dd-quicklink__icon">{link.icon}</span>
              <span className="dd-quicklink__label">{link.label}</span>
              <span className="dd-quicklink__desc">{link.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ═══ Footer meta ═══ */}
      {lastRefresh && (
        <div className="dd-footer">
          Last updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {brief && ` · ${brief.total_nodes} nodes · ${brief.total_edges} edges`}
        </div>
      )}
    </div>
  );
}
