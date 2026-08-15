// errors — user-facing error cards for chat failures.
//
// Kept as a pure module (no Tauri imports) so it is unit-testable. The rules
// here encode one principle: blame the thing that actually failed. An Ollama
// 404 names the exact model in its body; a screen-capture failure is a macOS
// permission problem, not a model problem. Rendering "Model X not available"
// for either of those sends the user chasing the wrong fix.

import type { AppSettings, Message } from "../types";

export function buildErrorMessage(err: unknown, settings: AppSettings): Message {
  const errorStr = String(err);

  // Screen-capture failures (read_screen lane). Checked first — they are the
  // most specific, and on macOS the fix is a privacy toggle, not a model pull.
  const isCaptureError =
    errorStr.includes("Screen capture failed") ||
    errorStr.includes("No monitor found") ||
    errorStr.includes("Failed to enumerate monitors");

  const isOllamaError = errorStr.includes("connection") || errorStr.includes("refused") || errorStr.includes("timeout") || errorStr.includes("error sending request") || errorStr.includes("fetch");

  // Ollama 404s name the exact model: `model 'llama3.2-vision' not found`.
  // Blame that model — never assume it was the user's default (auto-routing
  // may have selected a different one).
  const namedModel = errorStr.match(/model '([^']+)' not found/)?.[1];

  const isModelError = errorStr.includes("model") || errorStr.includes("not found");

  let content: string;
  if (isCaptureError) {
    content = `⚠️ Couldn't capture your screen.\n\nThis is a capture-permission or display problem, not a model problem:\n  • macOS: System Settings → Privacy & Security → Screen Recording → enable PrismOS-AI, then relaunch the app\n  • Windows/Linux: check the app has screen-capture permission and a display is connected (headless sessions can't capture)\n\nDetails: ${errorStr}`;
  } else if (isOllamaError) {
    content = `⚠️ Cannot connect to Ollama.\n\nPlease ensure Ollama is running:\n  1. Install from https://ollama.com\n  2. ollama pull ${settings.defaultModel}\n  3. ollama serve\n\nIf Ollama is running, check that it's accessible at:\n  ${settings.ollamaUrl}\n\nThen try your intent again.`;
  } else if (namedModel) {
    content = `⚠️ Model "${namedModel}" is not installed.\n\nTo fix this:\n  1. ollama pull ${namedModel}\n  2. Or switch to a different model in Settings\n\nAvailable models can be listed with:\n  ollama list`;
  } else if (isModelError) {
    content = `⚠️ Model "${settings.defaultModel}" not available.\n\nTo fix this:\n  1. ollama pull ${settings.defaultModel}\n  2. Or switch to a different model in Settings\n\nAvailable models can be listed with:\n  ollama list`;
  } else {
    content = `⚠️ Unable to process your intent.\n\nError: ${errorStr}\n\nTroubleshooting:\n  • Check that Ollama is running: ollama serve\n  • Verify your model is downloaded: ollama list\n  • Check Settings for the correct Ollama URL\n  • Try a simpler intent to test the connection`;
  }

  return {
    id: crypto.randomUUID(),
    role: "system",
    content,
    timestamp: new Date(),
  };
}
