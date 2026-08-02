// PrismOS-AI Configuration — Centralized constants and defaults
//
// All configurable values should be defined here so they can be changed
// in a single place. Components import from this module instead of
// hardcoding values.

import { MODEL_REGISTRY } from "./modelRegistry";

/** Default Ollama API base URL. Used when no user-configured URL is available. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Default AI model for fresh settings, derived from the reviewed registry. */
export const DEFAULT_MODEL =
  MODEL_REGISTRY.find((model) => model.isDefault)?.name ?? "qwen3:4b";

/** True if a saved model name refers to the same model as an installed one,
 *  tolerating the implicit `:latest` tag (Ollama lists `llama3.2:latest` but a
 *  saved/pulled name may be the bare `llama3.2`). */
export function modelMatches(saved: string, installed: string): boolean {
  if (saved === installed) return true;
  const withTag = (n: string) => (n.includes(":") ? n : `${n}:latest`);
  return withTag(saved) === withTag(installed);
}

/** True when a model tag is represented by the reviewed built-in catalog. */
export function isReviewedModel(name: string | undefined): boolean {
  const candidate = name?.trim();
  return !!candidate && MODEL_REGISTRY.some((model) => modelMatches(candidate, model.name));
}

/**
 * Select a canonical installed text-capable model after the active model is
 * removed. Only catalog-reviewed capabilities are used here: an arbitrary
 * `/api/tags` entry is not treated as generative without stronger metadata.
 */
export function chooseModelAfterRemoval(
  installed: string[],
): string {
  const preferredMatch = installed.find((model) => modelMatches(DEFAULT_MODEL, model));
  if (preferredMatch) return preferredMatch;

  const reviewedTextModels = [...MODEL_REGISTRY]
    .filter((model) => model.capabilities.includes("text"))
    .sort((a, b) => a.priority - b.priority);

  for (const reviewed of reviewedTextModels) {
    const installedMatch = installed.find((model) => modelMatches(reviewed.name, model));
    if (installedMatch) return installedMatch;
  }

  return DEFAULT_MODEL;
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
