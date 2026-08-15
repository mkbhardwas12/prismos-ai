// research — Explore live data and conclude, two ways:
//
//   • screen lane — zero network. Reuses Phase-7 Contextual Screen Awareness:
//     the user opens anything on their own screen and the local vision model
//     reads it. Always available.
//   • web lane — real HTTPS fetching of URLs the user explicitly names.
//     OFF by default; double-gated (Settings toggle + a Rust-side gate that
//     hard-refuses fetches), https-only, public hosts only, no search engine.
//
// The fetched pages are synthesized by the local model into a cited answer
// that ends with an explicit conclusion.

import { invoke } from "@tauri-apps/api/core";

export type ResearchMode = "web" | "screen";

export interface ResearchRequest {
  mode: ResearchMode;
  urls: string[];
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface ResearchResult {
  answer: string;
  pages: FetchedPage[];
  failures: string[];
}

/** Most URLs one request will fetch — keeps prompts inside local context. */
export const MAX_RESEARCH_URLS = 3;

/** Per-source excerpt cap inside the synthesis prompt (~2k tokens each). */
const PER_SOURCE_CHARS = 8000;

/** Synthesis needs room for citations + a conclusion. */
const MIN_SYNTHESIS_TOKENS = 4096;

/** Pull https/http URLs out of a message: deduped, trailing punctuation
 *  stripped, http upgraded to https (the backend is https-only), capped. */
export function extractUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?]+$/, "").replace(/^http:\/\//i, "https://");
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls.slice(0, MAX_RESEARCH_URLS);
}

/** Screen phrasing: "read my screen and conclude", "what I'm looking at"… */
function looksLikeScreenRequest(t: string): boolean {
  return (
    /\b(my|the|this)\s+screen\b|\bon\s+screen\b|\bwhat\s+i'?\s?a?m\s+looking\s+at\b|\bscreen\s?share\b/.test(t) &&
    /\b(read|research|analy[sz]e|summari[sz]e|check|look|gather|explore|explain|conclude|describe|review|tell)\b/.test(t)
  );
}

/** Explicit go-online phrasing (an offline-first app must never guess here). */
function looksLikeWebRequest(t: string): boolean {
  return (
    /\b(from|on|via|using|off|search(?:ing)?|browse|browsing)\s+the\s+(internet|web)\b/.test(t) ||
    /\b(search|browse|research|look\s*up|find|gather|get|fetch|pull|check|explore)\b[^.?!\n]{0,60}\bonline\b/.test(t) ||
    /\bonline\b[^.?!\n]{0,60}\b(search|research|info|information|sources?|news)\b/.test(t) ||
    /\b(latest|updated|current|up[\s-]?to[\s-]?date|recent|live)\b[^.?!\n]{0,60}\b(internet|web|online|news)\b/.test(t) ||
    /\b(internet|web|online)\b[^.?!\n]{0,60}\b(latest|updated|current|up[\s-]?to[\s-]?date|recent|info|information|data|news)\b/.test(t)
  );
}

/**
 * Detect a research request. Screen phrasing wins (it is the zero-network
 * lane); otherwise explicit web phrasing, or pasted links in a short message.
 * A long paste containing a URL (e.g. an error log that happens to mention
 * https://ollama.com) is NOT treated as a fetch request.
 */
export function detectResearchRequest(input: string): ResearchRequest | null {
  const t = input.toLowerCase().trim();
  if (!t) return null;

  if (looksLikeScreenRequest(t)) {
    return { mode: "screen", urls: [] };
  }

  const urls = extractUrls(input);
  if (looksLikeWebRequest(t)) {
    return { mode: "web", urls };
  }
  if (urls.length > 0) {
    // Short message with a link → the link is the point. Long messages (e.g.
    // a pasted error log that happens to contain a URL) need an unambiguous
    // fetch verb — generic words like "what"/"check" appear in every paste.
    const short = input.trim().length <= 220;
    const strongFetchVerb = /\b(fetch|visit|browse|crawl|scrape)\b/.test(t);
    if (short || strongFetchVerb) {
      return { mode: "web", urls };
    }
  }
  return null;
}

/** Build the local-model prompt that synthesizes fetched sources into a
 *  cited answer with an explicit conclusion. */
export function synthesisPrompt(question: string, pages: FetchedPage[]): string {
  const sources = pages
    .map((p, i) => {
      const excerpt =
        p.text.length > PER_SOURCE_CHARS ? `${p.text.slice(0, PER_SOURCE_CHARS)}…` : p.text;
      return `[${i + 1}] ${p.title} — ${p.url}\n${excerpt}`;
    })
    .join("\n\n");
  return [
    "You are a careful research analyst. Answer the user's request using ONLY the fetched web sources below.",
    "",
    `User request: "${question}"`,
    "",
    "Fetched sources:",
    sources,
    "",
    "Rules:",
    "- Base every claim on the sources and cite them inline like [1] or [2].",
    "- If sources disagree, say so explicitly.",
    "- If the sources do not contain the answer, say what is missing — do not invent facts.",
    '- End with a short paragraph starting exactly with "Conclusion:" giving your bottom line.',
  ].join("\n");
}

interface ResearchOptions {
  model: string;
  ollamaUrl?: string | null;
  maxTokens?: number;
  onPhase?: (phase: string) => void;
}

function shortHost(url: string): string {
  const m = url.match(/^https:\/\/([^/]+)/i);
  return m ? m[1] : url;
}

/**
 * Web-lane research end-to-end: fetch each user-named URL through the gated
 * Rust command, then synthesize a cited, concluded answer with the local model.
 */
export async function runWebResearch(
  question: string,
  urls: string[],
  opts: ResearchOptions,
): Promise<ResearchResult> {
  const pages: FetchedPage[] = [];
  const failures: string[] = [];

  for (const url of urls.slice(0, MAX_RESEARCH_URLS)) {
    opts.onPhase?.(`Fetching ${shortHost(url)}…`);
    try {
      const pageJson = await invoke<string>("research_fetch_url", { url });
      pages.push(JSON.parse(pageJson) as FetchedPage);
    } catch (e) {
      failures.push(`${url} — ${String(e)}`);
    }
  }

  if (pages.length === 0) {
    throw new Error(
      `None of the links could be fetched:\n${failures.map((f) => `• ${f}`).join("\n")}`,
    );
  }

  opts.onPhase?.(`Synthesizing across ${pages.length} source${pages.length > 1 ? "s" : ""}…`);
  const answer = await invoke<string>("query_ollama", {
    prompt: synthesisPrompt(question, pages),
    model: opts.model,
    ollamaUrl: opts.ollamaUrl ?? null,
    maxTokens: Math.max(opts.maxTokens ?? 0, MIN_SYNTHESIS_TOKENS),
  });

  return { answer, pages, failures };
}
