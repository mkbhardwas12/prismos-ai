// research unit tests — detection (web vs screen vs none), URL extraction,
// and the synthesis prompt contract.
//
// The stakes: PrismOS is offline-first. Web-lane detection must fire ONLY on
// explicit go-online intent or pasted links — never on ordinary chat, error
// pastes that happen to contain a URL, or local-file requests.

import { describe, it, expect } from "vitest";
import {
  detectResearchRequest,
  extractUrls,
  synthesisPrompt,
  MAX_RESEARCH_URLS,
  type FetchedPage,
} from "../lib/research";

describe("detectResearchRequest — web lane", () => {
  it("fires on explicit go-online phrasing", () => {
    expect(detectResearchRequest("gather the latest info from the internet about qwen3.8")?.mode).toBe("web");
    expect(detectResearchRequest("research this online and conclude")?.mode).toBe("web");
    expect(detectResearchRequest("look up the current news on the web")?.mode).toBe("web");
    expect(detectResearchRequest("search the web for updated ollama benchmarks")?.mode).toBe("web");
  });

  it("fires when the user pastes links with an ask", () => {
    const r = detectResearchRequest("summarize https://ollama.com/library/qwen3.8 and conclude");
    expect(r?.mode).toBe("web");
    expect(r?.urls).toEqual(["https://ollama.com/library/qwen3.8"]);
  });

  it("fires on a short bare-link message", () => {
    const r = detectResearchRequest("https://example.com/article");
    expect(r?.mode).toBe("web");
    expect(r?.urls).toEqual(["https://example.com/article"]);
  });

  it("does NOT fire on a long error paste that merely contains a URL", () => {
    const errorPaste = [
      "I ran the installer and got this output, not sure what to do with it —",
      "Error: couldn't pull model manifest: 412:",
      "The model you are attempting to pull requires a newer version of Ollama.",
      "Please download the latest version at: https://ollama.com/download",
      "then it exited with code 1 after retrying twice and printing the same thing again",
    ].join("\n");
    expect(detectResearchRequest(errorPaste)).toBeNull();
  });

  it("still fires on a LONG message when a strong fetch verb names the link", () => {
    const long =
      "please fetch https://example.com/article and then walk through every claim it makes, " +
      "compare each one against what we discussed earlier about local model licensing today, " +
      "and finish with a clear conclusion on whether the article's take actually holds up";
    expect(detectResearchRequest(long)?.mode).toBe("web");
  });

  it("does NOT fire on ordinary offline chat", () => {
    expect(detectResearchRequest("research transformers")).toBeNull();
    expect(detectResearchRequest("what is the internet")).toBeNull();
    expect(detectResearchRequest("search my documents for the report")).toBeNull();
    expect(detectResearchRequest("explain how websites work")).toBeNull();
    expect(detectResearchRequest("what's the latest in the file I uploaded")).toBeNull();
  });
});

describe("detectResearchRequest — screen lane", () => {
  it("fires on screen phrasings", () => {
    expect(detectResearchRequest("read my screen and conclude")?.mode).toBe("screen");
    expect(detectResearchRequest("research what's on my screen")?.mode).toBe("screen");
    expect(detectResearchRequest("summarize what I'm looking at")?.mode).toBe("screen");
  });

  it("screen wins over web wording when both appear", () => {
    expect(
      detectResearchRequest("read my screen and gather the latest info from the internet")?.mode,
    ).toBe("screen");
  });

  it("does not fire without a research-ish verb", () => {
    expect(detectResearchRequest("my screen is flickering")).toBeNull();
  });
});

describe("extractUrls", () => {
  it("dedupes, strips trailing punctuation, and upgrades http", () => {
    expect(
      extractUrls("see (https://a.com/x). and http://a.com/x, plus https://b.com/y?z=1"),
    ).toEqual(["https://a.com/x", "https://b.com/y?z=1"]);
  });

  it(`caps at ${MAX_RESEARCH_URLS}`, () => {
    const many = ["https://a.com", "https://b.com", "https://c.com", "https://d.com"].join(" ");
    expect(extractUrls(many)).toHaveLength(MAX_RESEARCH_URLS);
  });
});

describe("synthesisPrompt", () => {
  const page = (over: Partial<FetchedPage> = {}): FetchedPage => ({
    url: "https://a.com/x",
    title: "Title A",
    text: "Body text about qwen.",
    truncated: false,
    ...over,
  });

  it("numbers sources and demands a cited conclusion", () => {
    const p = synthesisPrompt("what changed in qwen3.8?", [page(), page({ url: "https://b.com", title: "B" })]);
    expect(p).toContain('[1] Title A — https://a.com/x');
    expect(p).toContain('[2] B — https://b.com');
    expect(p).toContain('"Conclusion:"');
    expect(p).toContain("what changed in qwen3.8?");
  });

  it("truncates oversized source text", () => {
    const big = page({ text: "x".repeat(50_000) });
    const p = synthesisPrompt("q", [big]);
    expect(p.length).toBeLessThan(20_000);
    expect(p).toContain("…");
  });
});
