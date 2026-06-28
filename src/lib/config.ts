// PrismOS-AI Configuration — Centralized constants and defaults
//
// All configurable values should be defined here so they can be changed
// in a single place. Components import from this module instead of
// hardcoding values.

/** Default Ollama API base URL. Used when no user-configured URL is available. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Default AI model to use if none is configured in settings.
 *  qwen3:30b-a3b is an MoE model (~3B active params/token) — Claude-class quality
 *  for everyday use while staying fast on Apple-silicon unified memory. The smart
 *  router auto-swaps to a code/vision/reasoning specialist per task when relevant. */
export const DEFAULT_MODEL = "qwen3:30b-a3b";

/** Default settings for a fresh PrismOS-AI install. */
export const DEFAULT_SETTINGS = {
  ollamaUrl: DEFAULT_OLLAMA_URL,
  defaultModel: DEFAULT_MODEL,
  theme: "dark" as const,
  maxTokens: 2048,
  voiceInputEnabled: false,
  voiceOutputEnabled: false,
  emailSummaryEnabled: false,
  calendarEnabled: false,
  financeEnabled: false,
  defaultView: "chat",
};
