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

export type ResearchMode = "web" | "screen" | "open";

export interface ResearchRequest {
  mode: ResearchMode;
  urls: string[];
  /** Follow the best links found on the seed pages (second parallel wave). */
  explore: boolean;
}

export interface PageLink {
  url: string;
  text: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  links: PageLink[];
}

export interface ResearchResult {
  answer: string;
  pages: FetchedPage[];
  failures: string[];
  /** Pages fetched by following links discovered on the seed pages. */
  explored: number;
  /** Chunks indexed into the Spectrum Graph for future retrieval. */
  learnedChunks: number;
}

/** Most user-named seed URLs per request. */
export const MAX_RESEARCH_URLS = 3;

/** Most discovered links followed in the explore wave. */
export const MAX_EXPLORE_LINKS = 4;

/** Hard ceiling on pages per research run (seeds + explored). */
const TOTAL_PAGE_CAP = 7;

/** Per-source excerpt cap inside the synthesis prompt (~2k tokens each). */
const PER_SOURCE_CHARS = 8000;

/** Total source-text budget across ALL pages — keeps the synthesis prompt
 *  inside the local model's context window even at 7 sources. */
const TOTAL_PROMPT_CHARS = 24000;

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

/** Screen phrasing — requires EXPLICIT intent to inspect on-screen content.
 *  Merely mentioning the screen ("explain why my screen is flickering") must
 *  never trigger a capture: the verb has to target the screen itself, or the
 *  request has to be about what is ON the screen. */
function looksLikeScreenRequest(t: string): boolean {
  // "read/scan/analyze/describe… my screen", "screen share"
  if (
    /\b(read|scan|capture|look\s+at|analy[sz]e|summari[sz]e|describe|see|watch)\b[^.?!\n]{0,30}\b(my|the|this)\s+screen\b/.test(t) ||
    /\bscreen\s?share\b/.test(t)
  ) {
    return true;
  }
  // "what's on my screen", "what am I looking at"
  if (/\bwhat(?:'s|\s+is)?\s+(?:on\s+(?:my|the)\s+screen|i'?\s?a?m\s+looking\s+at)\b/.test(t)) {
    return true;
  }
  // "research/gather/conclude … on/from my screen" — content sourced FROM the screen
  return (
    /\b(?:on|from)\s+(?:my|the)\s+screen\b/.test(t) &&
    /\b(read|research|analy[sz]e|summari[sz]e|gather|explore|conclude|describe|review)\b/.test(t)
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
/** "explore / dig deeper / thorough / multithreaded" → follow the best links
 *  discovered on the seed pages in a second parallel wave. */
function wantsExplore(t: string): boolean {
  return /\b(explore|exploring|deep|deeper|deep[\s-]?dive|thorough|thoroughly|dig\s+(?:in|into|deeper)|comprehensive|comprehensively|multi[\s-]?threaded)\b/.test(t);
}

export function detectResearchRequest(input: string): ResearchRequest | null {
  const t = input.toLowerCase().trim();
  if (!t) return null;

  if (looksLikeScreenRequest(t)) {
    return { mode: "screen", urls: [], explore: false };
  }

  const urls = extractUrls(input);
  const explore = wantsExplore(t);

  // Open lane: "open https://… (in browser)" → pop it in the real browser.
  if (
    urls.length > 0 &&
    (/^\s*(?:please\s+)?open\s+https?:\/\//i.test(input) ||
      (/\bopen\b/.test(t) && /\bin\s+(?:my\s+|the\s+|a\s+)?browser\b/.test(t)))
  ) {
    return { mode: "open", urls, explore: false };
  }

  if (looksLikeWebRequest(t)) {
    return { mode: "web", urls, explore };
  }
  if (urls.length > 0) {
    // Short message with a link → the link is the point. Long messages (e.g.
    // a pasted error log that happens to contain a URL) need an unambiguous
    // fetch verb — generic words like "what"/"check" appear in every paste.
    const short = input.trim().length <= 220;
    const strongFetchVerb = /\b(fetch|visit|browse|crawl|scrape)\b/.test(t);
    if (short || strongFetchVerb) {
      return { mode: "web", urls, explore };
    }
  }
  return null;
}

/** Rank links discovered on fetched pages by keyword overlap with the
 *  question; already-fetched URLs are excluded. Exported for tests. */
export function rankLinks(
  question: string,
  pages: FetchedPage[],
  max: number = MAX_EXPLORE_LINKS,
): PageLink[] {
  const stop = new Set([
    "this", "that", "with", "from", "about", "what", "when", "where", "which",
    "have", "will", "your", "then", "them", "these", "those", "please",
    "https", "http", "conclude", "research", "explore", "latest", "info",
    "information", "internet", "online",
  ]);
  const kws = new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((w) => w.length >= 4 && !stop.has(w)),
  );
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const seen = new Set(pages.map((p) => norm(p.url)));
  const scored: { link: PageLink; score: number; order: number }[] = [];
  let order = 0;
  for (const p of pages) {
    for (const l of p.links ?? []) {
      const key = norm(l.url);
      if (seen.has(key)) continue;
      seen.add(key);
      const hay = `${l.text} ${l.url}`.toLowerCase();
      let score = 0;
      for (const k of kws) {
        if (hay.includes(k)) score++;
      }
      if (score > 0) scored.push({ link: l, score, order: order++ });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, max).map((s) => s.link);
}

/** Build the local-model prompt that synthesizes fetched sources into a
 *  cited answer with an explicit conclusion. */
export function synthesisPrompt(question: string, pages: FetchedPage[]): string {
  // Scale the per-source excerpt so the whole prompt stays inside the local
  // model's context window even when the explore wave adds pages.
  const per = Math.min(
    PER_SOURCE_CHARS,
    Math.max(2000, Math.floor(TOTAL_PROMPT_CHARS / Math.max(1, pages.length))),
  );
  const sources = pages
    .map((p, i) => {
      const excerpt = p.text.length > per ? `${p.text.slice(0, per)}…` : p.text;
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
  /** Follow the best discovered links in a second parallel wave. */
  explore?: boolean;
  onPhase?: (phase: string) => void;
}

/** One gated fetch; failures become data instead of exceptions so a bad link
 *  never sinks the whole parallel wave. */
async function fetchOne(url: string): Promise<{ page?: FetchedPage; failure?: string }> {
  try {
    const pageJson = await invoke<string>("research_fetch_url", { url });
    return { page: JSON.parse(pageJson) as FetchedPage };
  } catch (e) {
    return { failure: `${url} — ${String(e)}` };
  }
}

/**
 * Web-lane research end-to-end:
 *   1. fetch the user-named seeds IN PARALLEL (each invoke runs on the Rust
 *      tokio thread pool, so downloads genuinely overlap),
 *   2. optionally EXPLORE — rank the links found on those pages against the
 *      question and fetch the best few, also in parallel,
 *   3. synthesize a cited answer that ends with a conclusion,
 *   4. LEARN — index every fetched page into the Spectrum Graph so future
 *      questions can retrieve this data (the local, honest version of
 *      "keeping the model up to date": weights never change, knowledge does).
 */
export async function runWebResearch(
  question: string,
  urls: string[],
  opts: ResearchOptions,
): Promise<ResearchResult> {
  const seeds = urls.slice(0, MAX_RESEARCH_URLS);
  opts.onPhase?.(
    `Fetching ${seeds.length} page${seeds.length > 1 ? "s in parallel" : ""}…`,
  );
  const wave1 = await Promise.all(seeds.map((u) => fetchOne(u)));
  const pages: FetchedPage[] = [];
  const failures: string[] = [];
  for (const r of wave1) {
    if (r.page) pages.push(r.page);
    else if (r.failure) failures.push(r.failure);
  }

  let explored = 0;
  if (opts.explore && pages.length > 0) {
    const followCap = Math.min(MAX_EXPLORE_LINKS, TOTAL_PAGE_CAP - pages.length);
    const follow = followCap > 0 ? rankLinks(question, pages, followCap) : [];
    if (follow.length > 0) {
      opts.onPhase?.(
        `Exploring ${follow.length} linked page${follow.length > 1 ? "s in parallel" : ""}…`,
      );
      const wave2 = await Promise.all(follow.map((l) => fetchOne(l.url)));
      for (const r of wave2) {
        if (r.page) {
          pages.push(r.page);
          explored++;
        } else if (r.failure) {
          failures.push(r.failure);
        }
      }
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

  // Learn: chunk + index each page into the Spectrum Graph (best-effort —
  // a graph hiccup must never lose the answer). Sequential on purpose: the
  // graph sits behind a mutex, so parallel calls would only contend.
  let learnedChunks = 0;
  opts.onPhase?.("Indexing sources into the Spectrum Graph…");
  for (const p of pages) {
    try {
      const idsJson = await invoke<string>("index_document_chunks", {
        text: p.text,
        source: p.url,
      });
      const ids = JSON.parse(idsJson);
      if (Array.isArray(ids)) learnedChunks += ids.length;
    } catch {
      /* learning is best-effort */
    }
  }

  return { answer, pages, failures, explored, learnedChunks };
}
