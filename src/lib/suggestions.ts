// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — Proactive Suggestion Engine
//
// Generates context-aware, time-sensitive suggestions based on graph state,
// recent activity patterns, and time-of-day heuristics. Falls back to smart
// defaults when the backend Spectrum Graph has no data yet.

import type { ProactiveSuggestion, SpectrumNode } from "../types";

/** Time-of-day bucket for contextual suggestions */
type TimeBucket = "early_morning" | "morning" | "afternoon" | "evening" | "night";

function getTimeBucket(): TimeBucket {
  const h = new Date().getHours();
  if (h < 6) return "early_morning";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

/** Default contextual suggestions keyed by time-of-day */
const TIME_SUGGESTIONS: Record<TimeBucket, ProactiveSuggestion[]> = {
  early_morning: [
    { id: "def-em-1", text: "Plan your day before it starts?", action_intent: "Help me plan today — suggest a prioritized schedule based on my recent activity", icon: "📝", category: "habits", confidence: 0.82 },
    { id: "def-em-2", text: "Review overnight insights from your graph", action_intent: "What patterns or insights have emerged in my knowledge graph since yesterday?", icon: "🌙", category: "patterns", confidence: 0.75 },
    { id: "def-em-email", text: "Any overnight emails worth noting?", action_intent: "Fetch and summarize any unread emails that arrived overnight — flag anything urgent", icon: "📬", category: "habits", confidence: 0.73 },
    { id: "def-em-calendar", text: "What's on your schedule today?", action_intent: "Show me today's calendar events, flag any conflicts, and suggest time blocks for focused work", icon: "📅", category: "habits", confidence: 0.76 },
    { id: "def-em-finance", text: "How are your stocks doing?", action_intent: "Fetch my portfolio watchlist and summarize today's price changes — flag any big movers", icon: "💰", category: "habits", confidence: 0.71 },
    { id: "def-em-3", text: "Set focus time for deep work", action_intent: "Block 2 hours of focused deep work time for this morning and suggest what to work on", icon: "🎯", category: "momentum", confidence: 0.7 },
  ],
  morning: [
    { id: "def-m-1", text: "Shall I block focus time this morning?", action_intent: "Block 2 hours of focused deep work time for this morning and suggest what to work on", icon: "🎯", category: "habits", confidence: 0.85 },
    { id: "def-m-2", text: "Summarize what you were working on yesterday", action_intent: "Summarize what I worked on yesterday and suggest what to continue today", icon: "📋", category: "momentum", confidence: 0.8 },
    { id: "def-m-email", text: "Check your unread emails", action_intent: "Fetch and summarize my unread emails — highlight anything urgent or time-sensitive", icon: "📬", category: "habits", confidence: 0.78 },
    { id: "def-m-calendar", text: "Review today's schedule", action_intent: "Show me today's calendar events, detect any scheduling conflicts, and suggest free time blocks for deep work", icon: "📅", category: "habits", confidence: 0.80 },
    { id: "def-m-finance", text: "Check your portfolio", action_intent: "Fetch my stock watchlist and summarize today's market movements — highlight gainers and losers", icon: "💰", category: "habits", confidence: 0.74 },
    { id: "def-m-3", text: "Check your knowledge graph growth", action_intent: "Show me how my knowledge graph has grown this week — any new connections?", icon: "🌱", category: "connections", confidence: 0.72 },
  ],
  afternoon: [
    { id: "def-a-1", text: "Quick progress check — what have you accomplished?", action_intent: "Summarize what I've accomplished today and what's still pending", icon: "📊", category: "momentum", confidence: 0.83 },
    { id: "def-a-2", text: "Discover hidden connections in your graph", action_intent: "What unexpected connections exist between my recent topics? Find cross-domain insights", icon: "🔗", category: "connections", confidence: 0.78 },
    { id: "def-a-3", text: "Order your usual coffee?", action_intent: "Help me take a break — suggest a quick refresher activity based on my patterns", icon: "☕", category: "habits", confidence: 0.65 },
  ],
  evening: [
    { id: "def-e-1", text: "Wrap up your day — evening recap?", action_intent: "Give me an evening recap of today's activity and prepare tomorrow's priorities", icon: "🌆", category: "habits", confidence: 0.88 },
    { id: "def-e-2", text: "Review and organize today's graph entries", action_intent: "Review all the knowledge graph entries from today and suggest how to organize them", icon: "🗂️", category: "patterns", confidence: 0.76 },
    { id: "def-e-3", text: "Prepare tomorrow's schedule", action_intent: "Prepare a draft schedule for tomorrow based on today's patterns and pending tasks", icon: "📅", category: "momentum", confidence: 0.8 },
  ],
  night: [
    { id: "def-n-1", text: "Burning the midnight oil — set a reminder to rest?", action_intent: "Set a wind-down reminder and summarize what I accomplished tonight", icon: "🌙", category: "habits", confidence: 0.9 },
    { id: "def-n-2", text: "Quick brain dump before you sleep?", action_intent: "Let me do a quick brain dump — capture my current thoughts and ideas for tomorrow", icon: "💭", category: "patterns", confidence: 0.82 },
    { id: "def-n-3", text: "Review the week's graph evolution", action_intent: "Show me how my knowledge graph evolved this week — key patterns and growth areas", icon: "📈", category: "connections", confidence: 0.7 },
  ],
};

/**
 * Generate graph-aware suggestions by analyzing recent nodes.
 * Falls back to time-based defaults if graph is empty.
 */
export function generateGraphSuggestions(
  nodes: SpectrumNode[],
  backendSuggestions: ProactiveSuggestion[],
): ProactiveSuggestion[] {
  // If backend returned good suggestions, use those first (deduped)
  if (backendSuggestions.length >= 2) {
    return dedup(backendSuggestions).slice(0, 3);
  }

  const results: ProactiveSuggestion[] = [...backendSuggestions];
  const bucket = getTimeBucket();

  // If we have graph nodes, generate node-aware suggestions
  if (nodes.length > 0) {
    // Find recently accessed nodes
    const sorted = [...nodes].sort(
      (a, b) => new Date(b.last_accessed).getTime() - new Date(a.last_accessed).getTime()
    );
    const recent = sorted[0];
    if (recent) {
      results.push({
        id: `graph-recent-${recent.id}`,
        text: `Continue exploring "${recent.label}"?`,
        action_intent: `Tell me more about ${recent.label} and show related connections`,
        icon: "🔍",
        category: "momentum",
        confidence: 0.85,
      });
    }

    // Find high-connection nodes (knowledge hubs)
    const hubs = [...nodes].sort((a, b) => b.connections.length - a.connections.length);
    const topHub = hubs[0];
    if (topHub && topHub.connections.length >= 2 && topHub.id !== recent?.id) {
      results.push({
        id: `graph-hub-${topHub.id}`,
        text: `"${topHub.label}" has ${topHub.connections.length} connections — explore?`,
        action_intent: `Explore the topic "${topHub.label}" and its ${topHub.connections.length} connected concepts in depth`,
        icon: "🕸️",
        category: "connections",
        confidence: 0.78,
      });
    }
  }

  // Fill remaining slots with time-based defaults
  const defaults = TIME_SUGGESTIONS[bucket];
  for (const def of defaults) {
    if (results.length >= 3) break;
    // Avoid duplicates
    if (!results.some((r) => r.id === def.id)) {
      results.push(def);
    }
  }

  return dedup(results).slice(0, 3);
}

/**
 * Generate follow-up suggestion cards to show after each AI response.
 * Uses context from the user's query and the AI response.
 */
/** Remove suggestions with near-identical text (first 50 chars, case-insensitive) */
function dedup(suggestions: ProactiveSuggestion[]): ProactiveSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = s.text.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateFollowUpSuggestions(
  userQuery: string,
  backendSuggestions: ProactiveSuggestion[],
): ProactiveSuggestion[] {
  if (backendSuggestions.length >= 2) {
    return dedup(backendSuggestions).slice(0, 3);
  }

  const results: ProactiveSuggestion[] = [...backendSuggestions];
  const queryLower = userQuery.toLowerCase();

  // Smart follow-up based on query keywords
  if (queryLower.includes("summarize") || queryLower.includes("summary")) {
    results.push({
      id: `fu-detail-${Date.now()}`,
      text: "Go deeper on a specific point?",
      action_intent: `Expand on the most important point from my last summary with actionable details`,
      icon: "🔎",
      category: "momentum",
      confidence: 0.8,
    });
  }
  if (queryLower.includes("plan") || queryLower.includes("schedule") || queryLower.includes("priority")) {
    results.push({
      id: `fu-remind-${Date.now()}`,
      text: "Set reminders for your plan?",
      action_intent: `Create specific reminders and milestones for the plan we just discussed`,
      icon: "⏰",
      category: "habits",
      confidence: 0.82,
    });
  }
  if (queryLower.includes("graph") || queryLower.includes("connection") || queryLower.includes("pattern")) {
    results.push({
      id: `fu-visual-${Date.now()}`,
      text: "Visualize these connections?",
      action_intent: `Create a visual map of the connections and patterns we just discussed`,
      icon: "🗺️",
      category: "connections",
      confidence: 0.77,
    });
  }

  // Generic smart follow-ups
  const genericFollowUps: ProactiveSuggestion[] = [
    { id: `fu-save-${Date.now()}`, text: "Save this as a knowledge note?", action_intent: `Save the key insights from our last conversation as a knowledge node in my graph`, icon: "💾", category: "patterns", confidence: 0.75 },
    { id: `fu-related-${Date.now()}`, text: "Find related topics in your graph?", action_intent: `What related topics exist in my knowledge graph that connect to what we just discussed?`, icon: "🔗", category: "connections", confidence: 0.72 },
    { id: `fu-action-${Date.now()}`, text: "Turn this into action items?", action_intent: `Convert the key points from our last conversation into a prioritized action item list`, icon: "✅", category: "momentum", confidence: 0.79 },
  ];

  for (const g of genericFollowUps) {
    if (results.length >= 3) break;
    results.push(g);
  }

  return dedup(results).slice(0, 3);
}
