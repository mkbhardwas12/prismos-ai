// error-messages — buildErrorMessage must blame the thing that actually failed.
//
// Regression suite for the E2E-found bug where a screen-read failure rendered
// as `Model "qwen3.8:27b" not available` — the model was fine; the router had
// requested a model that wasn't installed, and before that a macOS permission
// denial produced the same misleading card.

import { describe, it, expect } from "vitest";
import { buildErrorMessage } from "../lib/errors";
import type { AppSettings } from "../types";

const settings = {
  defaultModel: "qwen3.8:27b",
  ollamaUrl: "http://localhost:11434",
} as AppSettings;

describe("buildErrorMessage", () => {
  it("blames the exact model named in an Ollama 404, not the default", () => {
    const msg = buildErrorMessage(
      `Vision analysis failed: {"error":"model 'llama3.2-vision' not found"}`,
      settings,
    );
    expect(msg.content).toContain('"llama3.2-vision" is not installed');
    expect(msg.content).toContain("ollama pull llama3.2-vision");
    expect(msg.content).not.toContain('"qwen3.8:27b" not available');
  });

  it("maps screen-capture failures to Screen Recording guidance, not a model card", () => {
    const msg = buildErrorMessage(
      "Screen capture failed: CGDisplayStream access denied",
      settings,
    );
    expect(msg.content).toContain("Screen Recording");
    expect(msg.content).not.toContain("not available");
    expect(msg.content).not.toContain("ollama pull");
  });

  it("maps monitor-enumeration failures to the capture card too", () => {
    const msg = buildErrorMessage("No monitor found for screen capture", settings);
    expect(msg.content).toContain("Screen Recording");
  });

  it("keeps the connection card for transport errors", () => {
    const msg = buildErrorMessage(
      "error sending request for url (http://localhost:11434/api/generate)",
      settings,
    );
    expect(msg.content).toContain("Cannot connect to Ollama");
  });

  it("falls back to the default-model card when a model error names nothing", () => {
    const msg = buildErrorMessage("some model error without a name", settings);
    expect(msg.content).toContain('"qwen3.8:27b" not available');
  });

  it("keeps the generic card for unrecognized errors", () => {
    const msg = buildErrorMessage("something entirely different broke", settings);
    expect(msg.content).toContain("Unable to process your intent");
  });
});
