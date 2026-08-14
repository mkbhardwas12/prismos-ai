// PrismOS-AI Configuration — Centralized constants and defaults
//
// All configurable values should be defined here so they can be changed
// in a single place. Components import from this module instead of
// hardcoding values.

/** Default Ollama API base URL. Used when no user-configured URL is available. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Default AI model to use if none is configured in settings.
 *  qwen3.8:27b (Aug 2026) is the newest-generation dense flagship — 256K
 *  context, strong text/code/reasoning on 64GB-class unified memory. Requires
 *  a current Ollama build; resolveDefaultModel falls back gracefully (e.g. to
 *  an installed qwen3.5:27b) on machines that don't have it pulled, and the
 *  smart router still swaps to specialists per task. */
export const DEFAULT_MODEL = "qwen3.8:27b";

/** True if a saved model name refers to the same model as an installed one,
 *  tolerating the implicit `:latest` tag (Ollama lists `llama3.2:latest` but a
 *  saved/pulled name may be the bare `llama3.2`). */
export function modelMatches(saved: string, installed: string): boolean {
  if (saved === installed) return true;
  const withTag = (n: string) => (n.includes(":") ? n : `${n}:latest`);
  return withTag(saved) === withTag(installed);
}

/**
 * Resolve which model the app should actually run, given the user's saved choice
 * and the models currently installed in Ollama. Self-heals a stale/uninstalled
 * setting (e.g. a `deepseek-v3:16b` that was never pulled) so PrismOS never tries
 * to run a model that isn't there and then shows a misleading "Ollama is down".
 *
 * - saved model is installed        → return its canonical installed name, fellBack=false
 * - saved model is NOT installed     → return DEFAULT_MODEL if installed, else the first
 *                                       installed model, fellBack=true
 * - nothing installed at all         → model=null (caller should prompt a pull)
 */
export function resolveDefaultModel(
  saved: string | undefined,
  installed: string[],
  preferred: string = DEFAULT_MODEL,
): { model: string | null; fellBack: boolean } {
  if (installed.length === 0) return { model: null, fellBack: !!saved };
  const match = saved ? installed.find((m) => modelMatches(saved, m)) : undefined;
  if (match) return { model: match, fellBack: false };
  const pref = installed.find((m) => modelMatches(preferred, m));
  // fellBack is true only when a model WAS saved but isn't installed (a stale
  // setting worth warning about); an unset saved model is just a fresh default.
  return { model: pref ?? installed[0], fellBack: !!saved };
}

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
