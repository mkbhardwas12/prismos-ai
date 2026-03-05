// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// useSuggestions — Proactive suggestion management & follow-up generation

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { generateFollowUpSuggestions } from "../lib/suggestions";
import type { ProactiveSuggestion } from "../types";

interface UseSuggestionsOptions {
  startupSuggestions: ProactiveSuggestion[];
  hasMessages: boolean;
}

export function useSuggestions({ startupSuggestions, hasMessages }: UseSuggestionsOptions) {
  const [proactiveSuggestions, setProactiveSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [messageSuggestions, setMessageSuggestions] = useState<Record<string, ProactiveSuggestion[]>>({});

  // Seed proactive suggestions from startup (before user's first intent)
  useEffect(() => {
    if (startupSuggestions.length > 0 && proactiveSuggestions.length === 0 && !hasMessages) {
      setProactiveSuggestions(startupSuggestions);
    }
  }, [startupSuggestions]);

  // Generate follow-up suggestions after any AI response — replaces 6 duplicated try/catch blocks
  const refreshSuggestions = useCallback(async (input: string, msgId: string) => {
    try {
      const sugJson = await invoke<string>("get_proactive_suggestions");
      const sug: ProactiveSuggestion[] = JSON.parse(sugJson);
      const enriched = generateFollowUpSuggestions(input, sug);
      // Clear the bottom "Graph Insights" panel once conversation starts —
      // inline suggestions under each message are the primary UX now.
      setProactiveSuggestions([]);
      setMessageSuggestions(prev => ({ ...prev, [msgId]: enriched.slice(0, 3) }));
    } catch {
      const fallback = generateFollowUpSuggestions(input, []);
      setProactiveSuggestions([]);
      setMessageSuggestions(prev => ({ ...prev, [msgId]: fallback.slice(0, 3) }));
    }
  }, []);

  // Dismiss a single suggestion from a message's inline cards
  const dismissSuggestion = useCallback((msgId: string, sugId: string) => {
    setMessageSuggestions(prev => {
      const current = prev[msgId] ?? [];
      const filtered = current.filter(s => s.id !== sugId);
      if (filtered.length === 0) {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }
      return { ...prev, [msgId]: filtered };
    });
  }, []);

  return {
    proactiveSuggestions,
    setProactiveSuggestions,
    messageSuggestions,
    refreshSuggestions,
    dismissSuggestion,
  };
}
