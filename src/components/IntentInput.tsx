// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Intent Input — Natural Language Input with Voice Support
//
// Supports both typed and voice input via Web Speech API.
// All voice processing uses the browser's built-in speech recognition —
// no cloud transcription. Your voice data never leaves your device.

import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVoice } from "../hooks/useVoice";
import "./IntentInput.css";

interface IntentInputProps {
  onSubmit: (input: string) => void;
  isProcessing: boolean;
  voiceEnabled?: boolean;
  pendingIntent?: string;
  onPendingConsumed?: () => void;
}

export default function IntentInput({
  onSubmit,
  isProcessing,
  voiceEnabled = true,
  pendingIntent,
  onPendingConsumed,
}: IntentInputProps) {
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFileName, setDroppedFileName] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-fill input when a pending intent arrives (from example chips)
  useEffect(() => {
    if (pendingIntent) {
      setInput(pendingIntent);
      onPendingConsumed?.();
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
      }, 50);
    }
  }, [pendingIntent, onPendingConsumed]);

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

  // ── Drag & Drop File Ingest (Phase 5) ──
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const fileName = file.name;
    setDroppedFileName(fileName);

    try {
      // For Tauri, we need the full file path — use the webkitRelativePath or
      // fall back to reading via FileReader for browser environments
      // In Tauri desktop, dropped files have path in the dataTransfer
      const filePath = (file as File & { path?: string }).path;

      if (filePath) {
        // Tauri desktop: extract text via Rust backend
        const text: string = await invoke("extract_file_text", { path: filePath });
        const currentInput = input.trim();
        const newInput = currentInput
          ? `${currentInput}\n\n${text}`
          : text;
        setInput(newInput);
        autoResize();
      } else {
        // Fallback: read as text in browser
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const prefixed = `[File: ${fileName}]\n${text}`;
          const currentInput = input.trim();
          const newInput = currentInput
            ? `${currentInput}\n\n${prefixed}`
            : prefixed;
          setInput(newInput);
          autoResize();
        };
        reader.readAsText(file);
      }
    } catch (err) {
      console.error("File drop error:", err);
      setDroppedFileName(null);
    }

    // Clear the file name indicator after a few seconds
    setTimeout(() => setDroppedFileName(null), 4000);
  }, [input]);

  return (
    <div
      className={`intent-input-container ${isDragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay indicator */}
      {isDragOver && (
        <div className="drag-overlay" aria-hidden="true">
          <span className="drag-overlay-icon">📄</span>
          <span className="drag-overlay-text">Drop file to ingest</span>
        </div>
      )}

      {/* Dropped file indicator */}
      {droppedFileName && (
        <div className="dropped-file-badge" role="status">
          <span>📎 {droppedFileName}</span>
          <button onClick={() => setDroppedFileName(null)} aria-label="Remove file">×</button>
        </div>
      )}

      <div className="intent-input-wrapper">
        <textarea
          ref={textareaRef}
          className="intent-input"
          aria-label="Express your intent"
          placeholder={
            voice.isListening
              ? "🎙️ Listening… speak your intent"
              : "Ask me anything — I'll process it privately on your device…"
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
          aria-label="Send intent"
        >
          ▶
        </button>
      </div>

      {/* Voice listening indicator */}
      {voice.isListening && (
        <div className="voice-listening-bar" role="status" aria-live="polite">
          <span className="voice-listening-dot" />
          <span className="voice-listening-text">Listening...</span>
          {voice.interimTranscript && (
            <span className="voice-interim">"{voice.interimTranscript}"</span>
          )}
        </div>
      )}

      <div className="intent-hint">
        <span className="intent-hint-keys">Enter ↵ send · Shift+Enter ↵ newline</span>
        <span className="intent-hint-sep">·</span>
        <span>100% local · Patent Pending</span>
      </div>
    </div>
  );
}
