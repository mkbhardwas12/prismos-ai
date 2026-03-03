// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// SpotlightOverlay — Global hotkey-activated command palette / quick-launch bar
//
// Activated by Alt+Space (or Cmd+/ on macOS). Provides instant access to
// PrismOS-AI from anywhere on the desktop — like macOS Spotlight but for AI.

import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import type { ProactiveSuggestion } from "../types";
import "./SpotlightOverlay.css";

interface SpotlightOverlayProps {
  visible: boolean;
  onClose: () => void;
  /** Called when user submits an intent from the spotlight */
  onSubmit: (intent: string) => void;
  /** Quick action suggestions to show below the input */
  suggestions?: ProactiveSuggestion[];
}

/** Quick action commands available in spotlight */
const QUICK_COMMANDS = [
  { icon: "💬", label: "Chat", hint: "Open conversation", action: "view:chat" },
  { icon: "📊", label: "Spectrum Graph", hint: "Visualize knowledge", action: "view:graph" },
  { icon: "🧪", label: "Sandbox", hint: "Run isolated code", action: "view:sandbox" },
  { icon: "⚙️", label: "Settings", hint: "Configure PrismOS-AI", action: "view:settings" },
  { icon: "📈", label: "Timeline", hint: "View activity timeline", action: "view:timeline" },
  { icon: "🔍", label: "Explorer", hint: "Browse Spectrum nodes", action: "view:spectrum" },
];

export default function SpotlightOverlay({
  visible,
  onClose,
  onSubmit,
  suggestions = [],
}: SpotlightOverlayProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when overlay becomes visible
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIndex(0);
      // Small delay to let animation start
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [visible]);

  // Filter commands based on query
  const filteredCommands = query.trim()
    ? QUICK_COMMANDS.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(query.toLowerCase()) ||
          cmd.hint.toLowerCase().includes(query.toLowerCase())
      )
    : QUICK_COMMANDS;

  // Filter suggestions based on query
  const filteredSuggestions = query.trim()
    ? suggestions.filter(
        (s) =>
          s.text.toLowerCase().includes(query.toLowerCase()) ||
          s.action_intent.toLowerCase().includes(query.toLowerCase())
      )
    : suggestions.slice(0, 3);

  const totalItems = filteredCommands.length + filteredSuggestions.length + (query.trim() ? 1 : 0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          handleSelect(selectedIndex);
          break;
      }
    },
    [selectedIndex, totalItems, query, filteredCommands, filteredSuggestions]
  );

  const handleSelect = (index: number) => {
    // First: "Ask PrismOS" row (only when query is non-empty)
    if (query.trim()) {
      if (index === 0) {
        onSubmit(query.trim());
        onClose();
        return;
      }
      // Offset by 1 for the "Ask PrismOS" row
      const cmdIndex = index - 1;
      if (cmdIndex < filteredCommands.length) {
        const cmd = filteredCommands[cmdIndex];
        if (cmd.action.startsWith("view:")) {
          // Navigate to view
          window.dispatchEvent(
            new CustomEvent("prismos:navigate", { detail: cmd.action.replace("view:", "") })
          );
        }
        onClose();
        return;
      }
      const sugIndex = cmdIndex - filteredCommands.length;
      if (sugIndex < filteredSuggestions.length) {
        onSubmit(filteredSuggestions[sugIndex].action_intent);
        onClose();
        return;
      }
    } else {
      // No query — commands only
      if (index < filteredCommands.length) {
        const cmd = filteredCommands[index];
        if (cmd.action.startsWith("view:")) {
          window.dispatchEvent(
            new CustomEvent("prismos:navigate", { detail: cmd.action.replace("view:", "") })
          );
        }
        onClose();
        return;
      }
      const sugIndex = index - filteredCommands.length;
      if (sugIndex < filteredSuggestions.length) {
        onSubmit(filteredSuggestions[sugIndex].action_intent);
        onClose();
        return;
      }
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            className="spotlight-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Spotlight panel */}
          <motion.div
            className="spotlight-panel"
            initial={{ opacity: 0, y: -30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-label="PrismOS-AI Spotlight"
            aria-modal="true"
          >
            {/* Search input */}
            <div className="spotlight-input-row">
              <span className="spotlight-icon" aria-hidden="true">◈</span>
              <input
                ref={inputRef}
                type="text"
                className="spotlight-input"
                placeholder="Ask PrismOS-AI anything, or jump to a view…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                aria-label="Spotlight search"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="spotlight-kbd">ESC</kbd>
            </div>

            {/* Results */}
            <div className="spotlight-results">
              {/* "Ask PrismOS" option — only when there's text */}
              {query.trim() && (
                <button
                  className={`spotlight-result spotlight-result--ask ${selectedIndex === 0 ? "spotlight-result--active" : ""}`}
                  onClick={() => handleSelect(0)}
                  onMouseEnter={() => setSelectedIndex(0)}
                >
                  <span className="spotlight-result-icon">🧠</span>
                  <div className="spotlight-result-text">
                    <span className="spotlight-result-label">Ask PrismOS-AI</span>
                    <span className="spotlight-result-hint">"{query.trim()}"</span>
                  </div>
                  <kbd className="spotlight-result-kbd">↵</kbd>
                </button>
              )}

              {/* Quick commands */}
              {filteredCommands.length > 0 && (
                <div className="spotlight-section">
                  <span className="spotlight-section-label">Quick Actions</span>
                  {filteredCommands.map((cmd, i) => {
                    const idx = query.trim() ? i + 1 : i;
                    return (
                      <button
                        key={cmd.action}
                        className={`spotlight-result ${selectedIndex === idx ? "spotlight-result--active" : ""}`}
                        onClick={() => handleSelect(idx)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span className="spotlight-result-icon">{cmd.icon}</span>
                        <div className="spotlight-result-text">
                          <span className="spotlight-result-label">{cmd.label}</span>
                          <span className="spotlight-result-hint">{cmd.hint}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Graph suggestions */}
              {filteredSuggestions.length > 0 && (
                <div className="spotlight-section">
                  <span className="spotlight-section-label">Graph Suggestions</span>
                  {filteredSuggestions.map((sug, i) => {
                    const idx =
                      (query.trim() ? 1 : 0) + filteredCommands.length + i;
                    return (
                      <button
                        key={sug.id}
                        className={`spotlight-result ${selectedIndex === idx ? "spotlight-result--active" : ""}`}
                        onClick={() => handleSelect(idx)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span className="spotlight-result-icon">{sug.icon}</span>
                        <div className="spotlight-result-text">
                          <span className="spotlight-result-label">{sug.text}</span>
                          <span className="spotlight-result-hint">{sug.category} · {Math.round(sug.confidence * 100)}% confidence</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Empty state */}
              {query.trim() && filteredCommands.length === 0 && filteredSuggestions.length === 0 && (
                <div className="spotlight-empty">
                  No matching commands. Press Enter to ask PrismOS-AI.
                </div>
              )}
            </div>

            <div className="spotlight-footer">
              <span>◈ PrismOS-AI Spotlight</span>
              <span>
                <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> close
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
