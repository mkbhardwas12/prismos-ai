// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Voice Engine — Web Speech API Integration
//
// Provides voice input (Speech-to-Text) and voice output (Text-to-Speech)
// using the browser's built-in Web Speech API. All processing stays local
// when available — no cloud transcription required.

import { useState, useCallback, useRef, useEffect } from "react";

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

// ─── Voice State ───────────────────────────────────────────────────────────────

export interface VoiceState {
  /** Whether the browser supports speech recognition */
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
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useVoice(
  onTranscript: (transcript: string) => void,
  voiceEnabled: boolean = true
): VoiceState {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Check browser support
  const sttSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const ttsSupported =
    typeof window !== "undefined" && !!window.speechSynthesis;

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

  const startListening = useCallback(() => {
    if (!sttSupported || !voiceEnabled) return;

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
  };
}
