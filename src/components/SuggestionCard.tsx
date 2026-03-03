// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — SuggestionCard — Reusable proactive suggestion card
//
// A highly visible, clickable card used both inline (after AI responses)
// and in the sidebar's Daily Suggestions section. Clicking auto-fills
// the intent input box for user review before sending.

import type { ProactiveSuggestion } from "../types";
import "./SuggestionCard.css";

interface SuggestionCardProps {
  suggestion: ProactiveSuggestion;
  /** "inline" renders after AI messages; "sidebar" renders in Daily Suggestions panel */
  variant?: "inline" | "sidebar";
  /** Called when the card is clicked — should fill intent box */
  onSelect: (suggestion: ProactiveSuggestion) => void;
  /** Optional: show dismiss button */
  onDismiss?: (id: string) => void;
}

export default function SuggestionCard({
  suggestion,
  variant = "inline",
  onSelect,
  onDismiss,
}: SuggestionCardProps) {
  return (
    <button
      className={`suggestion-card suggestion-card--${variant} proactive-cat-${suggestion.category}`}
      onClick={() => onSelect(suggestion)}
      title={`Click to try: "${suggestion.action_intent}"`}
      aria-label={`Suggestion: ${suggestion.text}. Click to fill intent box.`}
    >
      {onDismiss && (
        <span
          className="suggestion-card__dismiss"
          role="button"
          tabIndex={0}
          aria-label="Dismiss suggestion"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(suggestion.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onDismiss(suggestion.id);
            }
          }}
        >
          ×
        </span>
      )}
      <div className="suggestion-card__header">
        <span className="suggestion-card__icon">{suggestion.icon}</span>
        <span className="suggestion-card__badge">{suggestion.category}</span>
      </div>
      <span className="suggestion-card__text">{suggestion.text}</span>
      <div className="suggestion-card__footer">
        <div className="suggestion-card__confidence">
          <div
            className="suggestion-card__confidence-fill"
            style={{ width: `${Math.round(suggestion.confidence * 100)}%` }}
          />
        </div>
        <span className="suggestion-card__cta">Try it →</span>
      </div>
    </button>
  );
}
