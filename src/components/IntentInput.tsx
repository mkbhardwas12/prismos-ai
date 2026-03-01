// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS Intent Input — Natural Language Input Component

import { useState, useRef, type KeyboardEvent } from "react";

interface IntentInputProps {
  onSubmit: (input: string) => void;
  isProcessing: boolean;
}

export default function IntentInput({
  onSubmit,
  isProcessing,
}: IntentInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    onSubmit(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function autoResize() {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }

  return (
    <div className="intent-input-container">
      <div className="intent-input-wrapper">
        <textarea
          ref={textareaRef}
          className="intent-input"
          placeholder="Express your intent... (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isProcessing}
        />
        <button
          className="intent-send-btn"
          onClick={handleSubmit}
          disabled={!input.trim() || isProcessing}
          title="Send intent"
        >
          ▶
        </button>
      </div>
      <div className="intent-hint">
        PrismOS processes all intents locally via Ollama · 100% private ·
        Patent Pending US [application number]
      </div>
    </div>
  );
}
