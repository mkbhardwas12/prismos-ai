// Research lane: several sources in, one cited synthesis out, on this machine.
//
// Attach two or more documents (or one, and ask for citations), or start a
// message with "research", and PrismOS:
//   1. splits the attachments into sources, or gathers matching passages from
//      the local library (indexed documents and knowledge packs);
//   2. ranks passages in every source against the question with BM25, so each
//      relevant source gets a voice instead of the longest one winning;
//   3. asks the local model for a synthesis in which every fact cites a
//      passage tag such as [S2.1];
//   4. checks the answer: unknown tags, factual sentences with no citation,
//      and numbers that don't appear in the passages a sentence cites.
// Nothing is fetched from the network; the sources are what you gave it.

export interface ResearchSource {
  /** S1, S2, ... in the order the sources were given. */
  id: string;
  name: string;
  text: string;
  origin: "attachment" | "library";
}

export interface Passage {
  /** S2.3: source 2, passage 3 of that source in reading order. */
  tag: string;
  sourceId: string;
  text: string;
  score: number;
}

export interface CitationCheck {
  /** Factual sentences outside the open-questions part. */
  sentences: number;
  cited: number;
  unknownTags: string[];
  uncited: string[];
  unsupportedNumbers: { number: string; sentence: string }[];
}

export type SourceResearchMode = "attachments" | "library";

/**
 * Split attached text into sources at each [Document: …], [File: …] or
 * [Audio: …] header line. A plain line scan (no backtracking regex), so a
 * huge or malformed attachment can't stall the chat.
 */
export function splitSources(documentText: string | undefined): { name: string; text: string }[] {
  if (!documentText?.trim()) return [];
  const lines = documentText.split("\n");
  const heads: { at: number; name: string }[] = [];
  lines.forEach((raw, at) => {
    if (!raw.startsWith("[")) return;
    const line = raw.trimEnd();
    const kind = /^\[(?:Document|File|Audio):/.exec(line);
    if (!kind || !line.endsWith("]")) return;
    const inner = line.slice(kind[0].length, -1);
    const bar = inner.indexOf("|");
    const name = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    if (name && !name.includes("]")) heads.push({ at, name });
  });
  if (!heads.length) return [{ name: "attached document", text: documentText.trim() }];
  const out: { name: string; text: string }[] = [];
  const lead = lines.slice(0, heads[0].at).join("\n").trim();
  if (lead) out.push({ name: "attached text", text: lead });
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].at : lines.length;
    const text = lines.slice(h.at + 1, end).join("\n").trim();
    if (text) out.push({ name: h.name, text });
  });
  return out;
}

/**
 * Give an attachment a header the splitter can always parse: the file name
 * loses "[", "]", "|" and line breaks, and anything after the name in the
 * original header ("| Type: PDF | 5 pages") is kept.
 */
export function cleanHeader(text: string, name: string, kind: "Document" | "File" | "Audio" = "File"): string {
  const safe = name.replace(/[[\]|\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "attachment";
  const nl = text.indexOf("\n");
  const first = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? "" : text.slice(nl);
  const head = first.match(/^\[(Document|File|Audio):\s*/);
  if (head && first.trimEnd().endsWith("]")) {
    const inner = first.trimEnd().slice(head[0].length, -1);
    const tail = inner.startsWith(name) ? inner.slice(name.length) : "";
    return `[${head[1]}: ${safe}${tail.replace(/[\]\r\n]/g, " ")}]${rest}`;
  }
  return `[${kind}: ${safe}]\n${text}`;
}

/** Join one more attachment onto what is already attached, keeping each header. */
export function combineSources(existing: string | null | undefined, next: string): string {
  return existing?.trim() ? `${existing.trimEnd()}\n\n${next.trimStart()}` : next;
}

const SOURCE_NOUNS = "(?:sources|documents|docs|papers|reports|files|articles|notes|transcripts|logs|configs)";
/**
 * Asking for a cited synthesis in so many words. Single words such as "cite",
 * "citations" or "research" are not enough: "which author has the most
 * citations?" is a data question, "summarise this research paper" a summary.
 */
const RESEARCH_WORDS = new RegExp(
  `\\b(?:with (?:citations|sources|references)|cite (?:your |the |its |their |all |each |every )?(?:sources|passages|documents|them|it)|literature review|(?:compare|synthesi[sz]e) (?:these|the|both|all|my) ${SOURCE_NOUNS}|what do (?:these|the|both|all|my) ${SOURCE_NOUNS} say|according to (?:these|the|both|all|my) ${SOURCE_NOUNS})\\b`,
  "i",
);
const TABULAR = /\.(?:csv|tsv|xlsx|xls)$/i;
/** "research: …", "/research …", "research how …", "what does my library say about …" */
const RESEARCH_START =
  /^\s*(?:\/research\b|research\s*[:,-]|research\s+(?:on|into|about|what|how|why|whether|which|who|when|where|the|this|these|my|our)\b|what (?:does|do) my (?:library|documents|docs|notes|knowledge) say about\b)/i;

/** The user asked for research in so many words (wins over the security lane). */
export function explicitResearch(input: string): boolean {
  return RESEARCH_WORDS.test(input) || RESEARCH_START.test(input);
}

/**
 * Route a request to the research lane. Two or more attached sources always
 * qualify (a document-generation request is routed earlier, and logs or
 * configs go to the security lane unless research is asked for by name); one
 * source needs research words such as "cite" or "synthesise"; with nothing
 * attached, the message has to start with "research …" or "/research".
 */
export function detectSourceResearch(input: string, documentText?: string): SourceResearchMode | null {
  const sources = splitSources(documentText);
  if (sources.length >= 2) return "attachments";
  if (sources.length === 1) {
    // One spreadsheet belongs to the data lane unless research is asked for by name.
    if (TABULAR.test(sources[0].name) && !RESEARCH_START.test(input)) return null;
    return explicitResearch(input) ? "attachments" : null;
  }
  return RESEARCH_START.test(input) ? "library" : null;
}

/** The question without a leading "research:", "/research" or "what does my library say about". */
export function researchQuestion(input: string): string {
  return (
    input
      .replace(/^\s*(?:\/research\b|research\b\s*[:,-]?)\s*/i, "")
      .replace(/^\s*what (?:does|do) my (?:library|documents|docs|notes|knowledge) say about\s*/i, "")
      .trim() || input.trim()
  );
}

const STOP = new Set(
  ("a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me might more most my no not " +
    "of on or our should so than that the their them then there these they this those to too us was we were what when where which who why will " +
    "with would you your about after again also any because before between both each few here just like many much new now only other over same " +
    "some such tell than through under until very while yet say says said according sources source documents document papers paper reports " +
    "report files file attached these research cite citations compare synthesise synthesize summary summarise summarize please give " +
    "agree agrees agreed agreement differ differs different difference differences disagree disagreement")
    .split(" "),
);

/** Lowercase terms for ranking; keeps identifiers such as rsau/enable, 2.0 or CVE-2025-31324 whole. */
export function terms(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._/-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Paragraph-aware chunks of roughly `size` characters. */
export function chunkPassages(text: string, size = 900): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= size) {
      pieces.push(p);
      continue;
    }
    // Long paragraph: break at sentence ends, then hard-wrap what is left.
    let buf = "";
    for (const sentence of p.split(/(?<=[.!?])\s+/)) {
      if (buf && buf.length + sentence.length + 1 > size) {
        pieces.push(buf);
        buf = "";
      }
      if (sentence.length > size) {
        for (let i = 0; i < sentence.length; i += size) pieces.push(sentence.slice(i, i + size));
      } else {
        buf = buf ? `${buf} ${sentence}` : sentence;
      }
    }
    if (buf) pieces.push(buf);
  }
  // Merge small neighbours so a passage carries enough context.
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + piece.length + 2 <= size && (last.length < size / 3 || piece.length < size / 3)) out[out.length - 1] = `${last}\n\n${piece}`;
    else out.push(piece);
  }
  return out;
}

/**
 * Rank every source's passages against the question (BM25 over all of them)
 * and pick up to `perSource` from each and `total` overall. Every source keeps
 * its best passage (its opening one if nothing in it matches). With no usable
 * terms in the question ("summarise these"), each source's opening passages
 * are used.
 */
export function rankPassages(question: string, sources: ResearchSource[], perSource = 3, total = 12): Passage[] {
  // A single source may use the whole budget.
  const per = sources.length === 1 ? total : perSource;
  const all: Passage[] = [];
  for (const s of sources) {
    chunkPassages(s.text).forEach((text, i) => all.push({ tag: `${s.id}.${i + 1}`, sourceId: s.id, text, score: 0 }));
  }
  if (!all.length) return [];
  const q = [...new Set(terms(question))];
  const docs = all.map((p) => terms(p.text));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  all.forEach((p, i) => {
    const d = docs[i];
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (all.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    p.score = Number(score.toFixed(4));
  });

  const order = (a: Passage, z: Passage) => z.score - a.score;
  const matched = all.some((p) => p.score > 0);
  const chosen: Passage[] = [];
  for (const s of sources) {
    const mine = all.filter((p) => p.sourceId === s.id);
    const hits = matched ? mine.filter((p) => p.score > 0).sort(order) : [];
    // A source with no matching passage still contributes its opening passage,
    // so a comparison hears from every source and can say which one is silent.
    const pick = hits.length ? hits.slice(0, per) : mine.slice(0, matched ? 1 : per);
    chosen.push(...pick);
  }
  // Keep each source's best passage, then the strongest of the rest.
  const firsts = sources.map((s) => chosen.find((p) => p.sourceId === s.id)).filter((p): p is Passage => Boolean(p));
  const rest = chosen.filter((p) => !firsts.includes(p)).sort(order);
  const picked = [...firsts, ...rest].slice(0, Math.max(total, firsts.length));
  // Present them in source order, then reading order, so the model reads each source as a whole.
  const rank = (p: Passage) => [Number(p.sourceId.slice(1)), Number(p.tag.split(".")[1])];
  return picked.sort((a, z) => {
    const [sa, pa] = rank(a);
    const [sz, pz] = rank(z);
    return sa - sz || pa - pz;
  });
}

/** knowledge-pack://sap-and-security/sap-hana.md → "sap-hana.md (knowledge pack sap-and-security)". */
export function prettySourceName(name: string): string {
  const pack = name.match(/^knowledge-pack:\/\/([^/]+)\/(.+)$/);
  return pack ? `${pack[2]} (knowledge pack ${pack[1]})` : name;
}

export interface LibraryNode {
  id: string;
  label: string;
  content: string;
  node_type: string;
}

/**
 * Group library hits into sources: document chunks of the same document are
 * joined in chunk order. Only indexed documents count as sources, never
 * conversation notes or the model's own earlier answers.
 */
export function librarySources(nodes: LibraryNode[], maxSources = 6): ResearchSource[] {
  const usable = nodes.filter((n) => typeof n.content === "string" && n.content.trim() && ["doc_chunk", "document", "file", "web_page"].includes(n.node_type));
  const chunks = usable.filter((n) => n.node_type === "doc_chunk");
  const pool = chunks.length ? chunks : usable;
  const groups = new Map<string, { parts: Map<number, string>; hits: number }>();
  const seen = new Set<string>();
  for (const n of pool) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const m = n.label.match(/^(?:📄\s*)?(.*?)(?:\s*\[chunk\s+(\d+)\/\d+\])?\s*$/u);
    const name = (m?.[1] || n.label).trim();
    const index = m?.[2] ? Number(m[2]) : 0;
    const g = groups.get(name) ?? { parts: new Map<number, string>(), hits: 0 };
    g.hits++;
    // Indexed chunks start with "Source: …\nChunk: i/n\nChars: a-b"; keep only the text.
    const body = n.content.replace(/^Source: [^\n]*\nChunk: \d+\/\d+\nChars: \d+-\d+\n+/, "").trim();
    if (body && !g.parts.has(index)) g.parts.set(index, body);
    groups.set(name, g);
  }
  return [...groups.entries()]
    .sort((a, z) => z[1].hits - a[1].hits)
    .slice(0, maxSources)
    .map(([name, g], i) => ({
      id: `S${i + 1}`,
      name: prettySourceName(name),
      text: [...g.parts.entries()].sort((a, z) => a[0] - z[0]).map(([, t]) => t).join("\n\n"),
      origin: "library" as const,
    }));
}

/** Words to look up in the library for a question. */
export function libraryQueries(question: string): string[] {
  return [...new Set(terms(question).filter((t) => t.length > 2))].sort((a, z) => z.length - a.length).slice(0, 6);
}

/** The model's brief: write from these passages only, cite every fact. */
export function researchPrompt(question: string, sources: ResearchSource[], passages: Passage[]): string {
  const names = new Map(sources.map((s) => [s.id, s.name]));
  return [
    `You are a careful research assistant. Answer the question using only the passages below, which PrismOS selected from ${sources.length} source${sources.length === 1 ? "" : "s"} on this machine.`,
    "",
    "Rules:",
    "- End every sentence that states a fact with the tag of the passage or passages it comes from, before the full stop, like this [S1.2] or this [S1.2][S3.1].",
    "- Use only these passages. If they don't answer part of the question, say so plainly instead of filling the gap.",
    "- Say where the sources agree, and where they disagree or give different numbers.",
    "- Copy numbers, dates, versions and names exactly as they appear in the passages.",
    "- Never cite a tag that is not listed below.",
    "",
    `Question: ${question}`,
    "",
    "Sources:",
    ...sources.map((s) => `${s.id}: ${s.name}${s.origin === "attachment" ? " (attached)" : " (local library)"}`),
    "",
    "Passages:",
    ...passages.map((p) => `[${p.tag}] (from ${names.get(p.sourceId) ?? p.sourceId})\n${p.text}`),
    "",
    "Write: a direct answer in two to four sentences, then the key findings as short bullet points, then a line 'Open questions:' with what the sources leave unresolved. Under 350 words.",
  ].join("\n");
}

const TAG_GROUP = /\[(S\d+(?:\.\d+)?(?:\s*[,;]\s*S\d+(?:\.\d+)?)*)\]/g;

/** Numbers worth checking: two or more digits, or a decimal. Commas dropped. */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, "")).filter((n) => n.length >= 2 || n.includes("."));
}

/**
 * Check the model's answer against the passages it was given. A factual
 * sentence is cited when it carries at least one known tag; a number in a
 * cited sentence must appear in one of the passages that sentence cites.
 * Everything after "Open questions" is exempt: it lists gaps, not facts.
 */
export function checkCitations(answer: string, passages: Passage[], sources: ResearchSource[]): CitationCheck {
  const byTag = new Map(passages.map((p) => [p.tag, p]));
  const sourceIds = new Set(sources.map((s) => s.id));
  const result: CitationCheck = { sentences: 0, cited: 0, unknownTags: [], uncited: [], unsupportedNumbers: [] };
  const unknown = new Set<string>();
  const openAt = answer.search(/^\s*(?:#+\s*|\*\*)?open questions\b/im);
  const body = openAt >= 0 ? answer.slice(0, openAt) : answer;
  const lines = body.split(/\n+/).map((l) => l.trim()).filter((l) => l && !/^#{1,6}\s/.test(l));
  for (const line of lines) {
    // A tag written after the full stop ("... in 2025. [S1.1]") belongs to the sentence before it.
    const clean = line
      .replace(/^([-*•]|\d+[.)])\s+/, "")
      .replace(/([.!?])((?:\s*\[S\d+(?:\.\d+)?(?:\s*[,;]\s*S\d+(?:\.\d+)?)*\])+)/g, "$2$1");
    for (const sentence of clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(\[])/)) {
      const tags = [...sentence.matchAll(TAG_GROUP)].flatMap((m) => m[1].split(/\s*[,;]\s*/));
      const text = sentence.replace(TAG_GROUP, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
      if (text.replace(/[^\p{L}]/gu, "").length < 12) continue;
      result.sentences++;
      const valid = tags.filter((t) => byTag.has(t) || sourceIds.has(t));
      for (const t of tags) if (!byTag.has(t) && !sourceIds.has(t)) unknown.add(t);
      if (!valid.length) {
        result.uncited.push(text);
        continue;
      }
      result.cited++;
      const cited = valid.flatMap((t) => (byTag.has(t) ? [byTag.get(t)!] : passages.filter((p) => p.sourceId === t)));
      const haystack = cited.map((p) => p.text.replace(/,(?=\d)/g, "")).join("\n");
      for (const n of numbersIn(text)) {
        if (!haystack.includes(n)) result.unsupportedNumbers.push({ number: n, sentence: text });
      }
    }
  }
  result.unknownTags = [...unknown];
  return result;
}

/** One line for the chat card: how well the answer is grounded. */
export function citationSummary(check: CitationCheck): string {
  const parts = [`${check.cited} of ${check.sentences} factual sentence${check.sentences === 1 ? " cites" : "s cite"} a passage`];
  if (check.unknownTags.length) parts.push(`unknown citations: ${check.unknownTags.join(", ")}`);
  if (check.unsupportedNumbers.length) parts.push(`${check.unsupportedNumbers.length} number${check.unsupportedNumbers.length === 1 ? "" : "s"} not found in the cited passages (${[...new Set(check.unsupportedNumbers.map((u) => u.number))].slice(0, 5).join(", ")})`);
  return parts.join(" · ");
}

/** The saved report: answer, checks, sources and the exact passages used. */
export function renderResearchMarkdown(question: string, answer: string, sources: ResearchSource[], passages: Passage[], check: CitationCheck, model: string): string {
  const used = (id: string) => passages.filter((p) => p.sourceId === id).map((p) => p.tag);
  return [
    `# Research: ${question}`,
    "",
    `${sources.length} source${sources.length === 1 ? "" : "s"} · ${passages.length} passages · written on this machine by PrismOS + ${model}`,
    "",
    answer.trim(),
    "",
    "## Checks",
    `- ${citationSummary(check)}`,
    ...(check.uncited.length ? ["- Sentences without a citation:", ...check.uncited.slice(0, 10).map((s) => `  - ${s}`)] : []),
    ...(check.unsupportedNumbers.length ? ["- Numbers to verify by hand:", ...check.unsupportedNumbers.slice(0, 10).map((u) => `  - ${u.number}: ${u.sentence}`)] : []),
    "",
    "## Sources",
    ...sources.map((s) => `- **${s.id}** ${s.name}${s.origin === "attachment" ? " (attached)" : " (local library)"}: passages ${used(s.id).join(", ") || "none used"}`),
    "",
    "## Passages used",
    ...passages.map((p) => `**[${p.tag}]**\n\n${p.text}\n`),
  ].join("\n");
}
