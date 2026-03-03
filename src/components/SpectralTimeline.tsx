// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Spectral Timeline — Time-Based History of Spectrum Graph Events
//
// Renders a vertical timeline showing node creation, updates, edge creation,
// and edge reinforcement events sorted by time. Groups events by date.
// Supports filtering by event type and facet type.

import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SpectralTimeline.css";

// ─── Facet Color Palette (shared with SpectrumGraphView) ───────────────────────

const FACET_COLORS: Record<string, string> = {
  work: "#4fc3f7",
  health: "#81c784",
  finance: "#ffb74d",
  social: "#ce93d8",
  learning: "#64b5f6",
  memory: "#90a4ae",
  task: "#e57373",
  note: "#aed581",
  conversation: "#78909c",
  meta: "#b0bec5",
};

const EVENT_ICONS: Record<string, string> = {
  node_created: "🌟",
  node_updated: "✏️",
  edge_created: "🔗",
  edge_reinforced: "⚡",
};

const EVENT_LABELS: Record<string, string> = {
  node_created: "Node Created",
  node_updated: "Node Updated",
  edge_created: "Edge Created",
  edge_reinforced: "Edge Reinforced",
};

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  event_type: string;
  label: string;
  description: string;
  node_type: string;
  layer: string;
  timestamp: string;
  access_count: number;
}

interface DateGroup {
  date: string;
  events: TimelineEvent[];
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface SpectralTimelineProps {
  refreshKey?: number;
}

export default function SpectralTimeline({ refreshKey }: SpectralTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [facetFilter, setFacetFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadTimeline = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<string>("get_timeline_data");
      const parsed: TimelineEvent[] = JSON.parse(result);
      setEvents(parsed);
    } catch (e) {
      console.error("Failed to load timeline data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline, refreshKey]);

  // ─── Filtering ───────────────────────────────────────────────────────

  const filteredEvents = events.filter((ev) => {
    if (filter !== "all" && ev.event_type !== filter) return false;
    if (facetFilter !== "all" && ev.node_type !== facetFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        ev.label.toLowerCase().includes(q) ||
        ev.description.toLowerCase().includes(q) ||
        ev.node_type.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ─── Group by Date ───────────────────────────────────────────────────

  const dateGroups: DateGroup[] = [];
  const groupMap = new Map<string, TimelineEvent[]>();

  for (const ev of filteredEvents) {
    const dateStr = ev.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!groupMap.has(dateStr)) {
      groupMap.set(dateStr, []);
    }
    groupMap.get(dateStr)!.push(ev);
  }

  for (const [date, evts] of groupMap) {
    dateGroups.push({ date, events: evts });
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  const totalNodes = events.filter((e) => e.event_type === "node_created").length;
  const totalEdges = events.filter((e) => e.event_type === "edge_created").length;
  const totalUpdates = events.filter(
    (e) => e.event_type === "node_updated" || e.event_type === "edge_reinforced"
  ).length;

  // ─── Get unique facet types from events ──────────────────────────────

  const facetTypes = Array.from(new Set(events.map((e) => e.node_type))).sort();

  // ─── Format helpers ──────────────────────────────────────────────────

  function formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  function formatTime(timestamp: string): string {
    try {
      const d = new Date(timestamp);
      return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function relativeDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      return `${Math.floor(diffDays / 30)} months ago`;
    } catch {
      return "";
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="timeline-loading">
        <div className="timeline-loading-spinner" />
        <p>Loading Spectral Timeline…</p>
      </div>
    );
  }

  return (
    <div className="spectral-timeline">
      {/* Header */}
      <div className="timeline-header">
        <div className="timeline-header-title">
          <span className="timeline-header-icon">📅</span>
          <h2>Spectral Timeline</h2>
          <span className="timeline-header-badge">
            {filteredEvents.length} events
          </span>
        </div>
        <p className="timeline-header-subtitle">
          Time-based history of your Spectrum Graph — nodes, edges, and reinforcements
        </p>
      </div>

      {/* Stats Bar */}
      <div className="timeline-stats">
        <div className="timeline-stat">
          <span className="timeline-stat-value">{totalNodes}</span>
          <span className="timeline-stat-label">Nodes</span>
        </div>
        <div className="timeline-stat">
          <span className="timeline-stat-value">{totalEdges}</span>
          <span className="timeline-stat-label">Edges</span>
        </div>
        <div className="timeline-stat">
          <span className="timeline-stat-value">{totalUpdates}</span>
          <span className="timeline-stat-label">Updates</span>
        </div>
        <div className="timeline-stat">
          <span className="timeline-stat-value">{dateGroups.length}</span>
          <span className="timeline-stat-label">Days</span>
        </div>
      </div>

      {/* Filters */}
      <div className="timeline-filters">
        <input
          className="timeline-search"
          type="text"
          placeholder="Search events…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="timeline-filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All Events</option>
          <option value="node_created">🌟 Nodes Created</option>
          <option value="node_updated">✏️ Nodes Updated</option>
          <option value="edge_created">🔗 Edges Created</option>
          <option value="edge_reinforced">⚡ Edges Reinforced</option>
        </select>
        <select
          className="timeline-filter-select"
          value={facetFilter}
          onChange={(e) => setFacetFilter(e.target.value)}
        >
          <option value="all">All Facets</option>
          {facetTypes.map((ft) => (
            <option key={ft} value={ft}>
              {ft.charAt(0).toUpperCase() + ft.slice(1)}
            </option>
          ))}
        </select>
        <button className="timeline-refresh-btn" onClick={loadTimeline} title="Refresh timeline">
          🔄
        </button>
      </div>

      {/* Timeline Body */}
      {filteredEvents.length === 0 ? (
        <div className="timeline-empty">
          <span className="timeline-empty-icon">🕐</span>
          <p>No events yet. Start a conversation to build your Spectrum Graph timeline.</p>
        </div>
      ) : (
        <div className="timeline-body">
          {dateGroups.map((group) => (
            <div key={group.date} className="timeline-date-group">
              {/* Date Header */}
              <div className="timeline-date-header">
                <span className="timeline-date-dot" />
                <span className="timeline-date-text">
                  {formatDate(group.date)}
                </span>
                <span className="timeline-date-relative">
                  {relativeDate(group.date)}
                </span>
                <span className="timeline-date-count">
                  {group.events.length} event{group.events.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Events in this date */}
              <div className="timeline-events">
                {group.events.map((ev) => (
                  <div
                    key={ev.id}
                    className={`timeline-event timeline-event-${ev.event_type}`}
                  >
                    <div className="timeline-event-connector">
                      <div
                        className="timeline-event-dot"
                        style={{
                          backgroundColor:
                            FACET_COLORS[ev.node_type] || "#b0bec5",
                        }}
                      />
                      <div className="timeline-event-line" />
                    </div>
                    <div className="timeline-event-card">
                      <div className="timeline-event-header">
                        <span className="timeline-event-icon">
                          {EVENT_ICONS[ev.event_type] || "📌"}
                        </span>
                        <span className="timeline-event-label">{ev.label}</span>
                        <span
                          className="timeline-event-badge"
                          style={{
                            backgroundColor:
                              FACET_COLORS[ev.node_type] || "#b0bec5",
                          }}
                        >
                          {ev.node_type}
                        </span>
                        <span className="timeline-event-layer">{ev.layer}</span>
                      </div>
                      <p className="timeline-event-desc">{ev.description}</p>
                      <div className="timeline-event-meta">
                        <span className="timeline-event-time">
                          {formatTime(ev.timestamp)}
                        </span>
                        <span className="timeline-event-type">
                          {EVENT_LABELS[ev.event_type] || ev.event_type}
                        </span>
                        {ev.access_count > 0 && (
                          <span className="timeline-event-access">
                            👁 {ev.access_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
