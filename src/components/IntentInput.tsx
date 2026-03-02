// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS Intent Input — Natural Language Input with Voice Support
//
// Supports both typed and voice input via Web Speech API.
// All voice processing uses the browser's built-in speech recognition —
// no cloud transcription. Your voice data never leaves your device.

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { useVoice } from "../hooks/useVoice";

interface IntentInputProps {
  onSubmit: (input: string) => void;
  isProcessing: boolean;
  voiceEnabled?: boolean;
}

export default function IntentInput({
  onSubmit,
  isProcessing,
  voiceEnabled = true,
}: IntentInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice transcript callback — auto-submits when speech is final
  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      if (transcript.trim() && !isProcessing) {
        setInput(transcript);
        onSubmit(transcript.trim());
        setInput("");
      }
    },
    [onSubmit, isProcessing]
  );

  const voice = useVoice(handleVoiceTranscript, voiceEnabled);

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
          placeholder={
            voice.isListening
              ? "🎙️ Listening... speak your intent"
              : "Express your intent... (Enter to send, Shift+Enter for newline)"
          }
          value={voice.isListening && voice.interimTranscript ? voice.interimTranscript : input}
          onChange={(e) => {
            setInput(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isProcessing || voice.isListening}
        />

        {/* Voice input button */}
        {voiceEnabled && voice.sttSupported && (
          <button
            className={`intent-voice-btn ${voice.isListening ? "voice-active" : ""}`}
            onClick={voice.toggleListening}
            disabled={isProcessing}
            title={voice.isListening ? "Stop listening" : "Voice input"}
            type="button"
          >
            {voice.isListening ? (
              <span className="voice-pulse">⏹</span>
            ) : (
              "🎙️"
            )}
          </button>
        )}

        <button
          className="intent-send-btn"
          onClick={handleSubmit}
          disabled={!input.trim() || isProcessing}
          title="Send intent"
        >
          ▶
        </button>
      </div>

      {/* Voice listening indicator */}
      {voice.isListening && (
        <div className="voice-listening-bar">
          <span className="voice-listening-dot" />
          <span className="voice-listening-text">Listening...</span>
          {voice.interimTranscript && (
            <span className="voice-interim">"{voice.interimTranscript}"</span>
          )}
        </div>
      )}

      <div className="intent-hint">
        {voiceEnabled && voice.sttSupported
          ? "Type or 🎙️ speak your intent · 100% local · Patent Pending US [application number]"
          : "PrismOS processes all intents locally via Ollama · 100% private · Patent Pending US [application number]"}
      </div>
    </div>
  );
}
