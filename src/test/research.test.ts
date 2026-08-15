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
  rankLinks,
  synthesisPrompt,
  MAX_RESEARCH_URLS,
  MAX_EXPLORE_LINKS,
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

  it("does NOT capture the screen for support questions that merely mention it", () => {
    // Regression (Codex review): "explain" + "my screen" used to satisfy the
    // old two-regex AND and silently trigger a screenshot.
    expect(detectResearchRequest("explain why my screen is flickering")).toBeNull();
    expect(detectResearchRequest("check why my screen keeps going black")).toBeNull();
    expect(detectResearchRequest("tell me how to clean my screen")).toBeNull();
  });

  it("still fires on explicit inspect-intent phrasings", () => {
    expect(detectResearchRequest("look at my screen and explain the error")?.mode).toBe("screen");
    expect(detectResearchRequest("gather the info from my screen and conclude")?.mode).toBe("screen");
  });
});

describe("detectResearchRequest — open lane + explore flag", () => {
  it("routes 'open <url>' to the browser-open lane", () => {
    expect(detectResearchRequest("open https://example.com/docs")?.mode).toBe("open");
    expect(detectResearchRequest("please open https://example.com in my browser")?.mode).toBe("open");
  });

  it("does not hijack open-requests without a URL", () => {
    expect(detectResearchRequest("open the csv file")).toBeNull();
  });

  it("plain summarize-a-link stays in the web lane", () => {
    expect(detectResearchRequest("summarize https://example.com/a and conclude")?.mode).toBe("web");
  });

  it("sets explore on 'explore'/'dig deeper'/'multithreaded' phrasings", () => {
    expect(detectResearchRequest("research https://a.com/x and explore deeper")?.explore).toBe(true);
    expect(detectResearchRequest("dig into https://a.com/x thoroughly")?.explore).toBe(true);
    expect(detectResearchRequest("multithreaded research on https://a.com/x")?.explore).toBe(true);
    expect(detectResearchRequest("summarize https://a.com/x and conclude")?.explore).toBe(false);
  });
});

describe("rankLinks", () => {
  const page = (url: string, links: { url: string; text: string }[]): FetchedPage => ({
    url,
    title: "T",
    text: "body",
    truncated: false,
    links,
  });

  it("ranks by keyword overlap with the question and skips fetched URLs", () => {
    const pages = [
      page("https://a.com/qwen", [
        { url: "https://a.com/qwen/benchmarks", text: "Qwen benchmark results" },
        { url: "https://a.com/about", text: "About us" },
        { url: "https://a.com/qwen", text: "Self link (already fetched)" },
        { url: "https://a.com/qwen/quantization", text: "Quantization notes for qwen" },
      ]),
    ];
    const ranked = rankLinks("qwen benchmark quantization results", pages);
    expect(ranked.map((l) => l.url)).toEqual([
      "https://a.com/qwen/benchmarks",
      "https://a.com/qwen/quantization",
    ]);
  });

  it(`caps at ${MAX_EXPLORE_LINKS} and dedupes across pages`, () => {
    const links = Array.from({ length: 10 }, (_, i) => ({
      url: `https://a.com/qwen/${i}`,
      text: `qwen article ${i}`,
    }));
    const pages = [page("https://a.com/1", links), page("https://a.com/2", links)];
    const ranked = rankLinks("qwen article", pages);
    expect(ranked).toHaveLength(MAX_EXPLORE_LINKS);
    expect(new Set(ranked.map((l) => l.url)).size).toBe(MAX_EXPLORE_LINKS);
  });

  it("returns nothing when no link relates to the question", () => {
    const pages = [page("https://a.com/x", [{ url: "https://a.com/careers", text: "Careers" }])];
    expect(rankLinks("qwen quantization accuracy", pages)).toHaveLength(0);
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
    links: [],
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

  it("scales the per-source budget so 7 sources still fit the context window", () => {
    const pages = Array.from({ length: 7 }, (_, i) =>
      page({ url: `https://a.com/${i}`, text: "y".repeat(20_000) }),
    );
    const p = synthesisPrompt("q", pages);
    expect(p.length).toBeLessThan(30_000);
    expect(p).toContain("[7]");
  });
});
