// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Configuration — Centralized constants and defaults
//
// All configurable values should be defined here so they can be changed
// in a single place. Components import from this module instead of
// hardcoding values.

/** Default Ollama API base URL. Used when no user-configured URL is available. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Default AI model to use if none is configured in settings. */
export const DEFAULT_MODEL = "llama3.2";

/** Default settings for a fresh PrismOS-AI install. */
export const DEFAULT_SETTINGS = {
  ollamaUrl: DEFAULT_OLLAMA_URL,
  defaultModel: DEFAULT_MODEL,
  theme: "dark" as const,
  maxTokens: 2048,
  voiceInputEnabled: false,
  voiceOutputEnabled: false,
};
