// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Voice Engine — Hybrid: Local Whisper (Tauri) + Web Speech API fallback
//
// Phase 4: First attempts local Whisper transcription via Tauri IPC
// (whisper.cpp running 100% on-device). Falls back to Web Speech API
// when Whisper model is not downloaded. No audio ever leaves the device
// when using the local engine.

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ─── TypeScript declarations for Web Speech API ────────────────────────────────

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

// ─── Whisper Transcription Result ──────────────────────────────────────────────

interface WhisperResult {
  text: string;
  language: string;
  duration_ms: number;
  segments: { start_ms: number; end_ms: number; text: string }[];
}

interface WhisperStatus {
  available: boolean;
  model_loaded: boolean;
  model_name: string | null;
  model_path: string | null;
  recording: boolean;
}

// ─── Voice State ───────────────────────────────────────────────────────────────

export interface VoiceState {
  /** Whether speech recognition is supported (Whisper or Web Speech API) */
  sttSupported: boolean;
  /** Whether the browser supports speech synthesis */
  ttsSupported: boolean;
  /** Whether we are currently listening for voice input */
  isListening: boolean;
  /** Whether we are currently speaking a response */
  isSpeaking: boolean;
  /** Interim transcript while user is speaking */
  interimTranscript: string;
  /** Start listening for voice input */
  startListening: () => void;
  /** Stop listening */
  stopListening: () => void;
  /** Toggle listening on/off */
  toggleListening: () => void;
  /** Speak text aloud using TTS */
  speak: (text: string) => void;
  /** Stop speaking */
  stopSpeaking: () => void;
  /** Whether local Whisper engine is available */
  whisperAvailable: boolean;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useVoice(
  onTranscript: (transcript: string) => void,
  voiceEnabled: boolean = true
): VoiceState {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [whisperAvailable, setWhisperAvailable] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Check browser support
  const webSpeechSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const sttSupported = webSpeechSupported || whisperAvailable;

  const ttsSupported =
    typeof window !== "undefined" && !!window.speechSynthesis;

  // Check Whisper availability on mount
  useEffect(() => {
    (async () => {
      try {
        const statusJson = await invoke<string>("whisper_status");
        const status: WhisperStatus = JSON.parse(statusJson);
        setWhisperAvailable(status.available && status.model_loaded);
      } catch {
        // Whisper not available (old backend, or command not registered)
        setWhisperAvailable(false);
      }
    })();
  }, []);

  // Initialize speech synthesis ref
  useEffect(() => {
    if (ttsSupported) {
      synthRef.current = window.speechSynthesis;
    }
  }, [ttsSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
      if (synthRef.current?.speaking) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // ── Local Whisper transcription path ──
  const startWhisperListening = useCallback(async () => {
    if (!voiceEnabled) return;

    setIsListening(true);
    setInterimTranscript("🎙️ Recording (local Whisper)…");

    try {
      // Quick transcribe for 5 seconds via Tauri
      const resultJson = await invoke<string>("quick_transcribe", { seconds: 5 });
      const result: WhisperResult = JSON.parse(resultJson);

      setInterimTranscript("");
      if (result.text.trim()) {
        onTranscript(result.text.trim());
      }
    } catch (e) {
      console.warn("[PrismOS-AI Voice] Whisper transcription failed, falling back:", e);
      setInterimTranscript("");
      // Fall back to Web Speech API
      if (webSpeechSupported) {
        startWebSpeechListening();
        return;
      }
    } finally {
      setIsListening(false);
    }
  }, [voiceEnabled, onTranscript, webSpeechSupported]);

  // ── Web Speech API path (fallback) ──
  const startWebSpeechListening = useCallback(() => {
    if (!webSpeechSupported || !voiceEnabled) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final_ = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final_ += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
      }

      if (final_) {
        setInterimTranscript("");
        onTranscript(final_.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[PrismOS-AI Voice] Recognition error:", event.error);
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (e) {
      console.error("[PrismOS-AI Voice] Failed to start recognition:", e);
      setIsListening(false);
    }
  }, [sttSupported, voiceEnabled, onTranscript]);

  // ── Smart routing: prefer Whisper, fall back to Web Speech ──
  const startListening = useCallback(() => {
    if (whisperAvailable) {
      startWhisperListening();
    } else if (webSpeechSupported) {
      startWebSpeechListening();
    }
  }, [whisperAvailable, webSpeechSupported, startWhisperListening, startWebSpeechListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { /* ignore */ }
    }
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || !voiceEnabled || !synthRef.current) return;

      // Cancel any ongoing speech
      synthRef.current.cancel();

      // Strip metadata footers and emoji for cleaner TTS
      const cleaned = text
        .replace(/───[\s\S]*$/, "")    // Remove metadata footer
        .replace(/🔮.*$/m, "")          // Remove anticipation hints
        .replace(/[🛡️✅🔗💬📡⚡🔮⚖️📌⚔️🔄🤝🔒🧠🌈]/g, "") // Strip emoji
        .replace(/\s{2,}/g, " ")       // Collapse whitespace
        .trim();

      if (!cleaned) return;

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 0.9;
      utterance.lang = "en-US";

      // Try to find a good voice
      const voices = synthRef.current.getVoices();
      const preferred = voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          (v.name.includes("Natural") ||
            v.name.includes("Enhanced") ||
            v.name.includes("Google"))
      );
      if (preferred) {
        utterance.voice = preferred;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      synthRef.current.speak(utterance);
    },
    [ttsSupported, voiceEnabled]
  );

  const stopSpeaking = useCallback(() => {
    if (synthRef.current?.speaking) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return {
    sttSupported,
    ttsSupported,
    isListening,
    isSpeaking,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    whisperAvailable,
  };
}
