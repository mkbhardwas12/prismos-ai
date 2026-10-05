import { describe, expect, it } from "vitest";
import {
  checkCitations,
  chunkPassages,
  cleanHeader,
  citationSummary,
  combineSources,
  detectSourceResearch,
  explicitResearch,
  libraryQueries,
  librarySources,
  prettySourceName,
  rankPassages,
  renderResearchMarkdown,
  researchPrompt,
  researchQuestion,
  splitSources,
  terms,
  type ResearchSource,
} from "../lib/researchLane";

const para = (topic: string, n = 380) => `${topic} `.repeat(Math.ceil(n / (topic.length + 1))).trim();

const OVENS = [
  `The deck ovens run at 220 degrees for sourdough and stay there for the whole morning bake. ${para("Crust colour depends on steam in the first ten minutes.")}`,
  `Deliveries of flour arrive on Mondays and Thursdays. ${para("The van parks at the back door and the driver signs the sheet.")}`,
  `Cleaning happens after the last bake. ${para("Racks are scrubbed and the floor is mopped before close.")}`,
].join("\n\n");
const PROOF = `The cold proof takes 12 hours in the walk-in room at 4 degrees. ${para("Dough is shaped the evening before and baked at dawn.")}`;
const UNRELATED = `Staff rota for the weekend. ${para("Two people open and one person closes on Sundays.")}`;

const SOURCES: ResearchSource[] = [
  { id: "S1", name: "ovens.md", text: OVENS, origin: "attachment" },
  { id: "S2", name: "proofing.pdf", text: PROOF, origin: "attachment" },
  { id: "S3", name: "rota.txt", text: UNRELATED, origin: "attachment" },
];

describe("research lane: sources", () => {
  it("splits attachments at their headers and keeps text before the first header", () => {
    const text = "notes typed first\n\n[File: a.md]\nAlpha\n\n[Document: b.pdf | Type: PDF | 3 pages]\nBeta\n\n[Audio: c.m4a | 61s | transcribed offline by whisper.cpp]\n\nGamma";
    expect(splitSources(text)).toEqual([
      { name: "attached text", text: "notes typed first" },
      { name: "a.md", text: "Alpha" },
      { name: "b.pdf", text: "Beta" },
      { name: "c.m4a", text: "Gamma" },
    ]);
    expect(splitSources("just text")).toEqual([{ name: "attached document", text: "just text" }]);
    expect(splitSources(undefined)).toEqual([]);
    expect(splitSources(combineSources("[File: a.md]\nAlpha", "[File: b.md]\nBeta")).map((s) => s.name)).toEqual(["a.md", "b.md"]);
  });

  it("cleans file names in headers so every source can be told apart", () => {
    const plan = cleanHeader("[Document: Plan.pdf | Type: PDF | 2 pages]\nPlan text", "Plan.pdf");
    const budget = cleanHeader("[Document: Budget [final].pdf | Type: PDF | 3 pages]\nBudget text", "Budget [final].pdf");
    expect(budget.split("\n")[0]).toBe("[Document: Budget final .pdf | Type: PDF | 3 pages]");
    expect(cleanHeader("raw text", "notes|v2.txt")).toBe("[File: notes v2.txt]\nraw text");
    expect(splitSources(`${plan}\n\n${budget}`).map((s) => [s.name, s.text])).toEqual([["Plan.pdf", "Plan text"], ["Budget final .pdf", "Budget text"]]);
  });

  it("splits long unusual attachments quickly", () => {
    const started = Date.now();
    splitSources(`[File: broken${" ".repeat(60_000)}x\n${"y ".repeat(30_000)}`);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("routes several attachments, cited single attachments and 'research …' questions", () => {
    const two = "[File: a.md]\nAlpha\n\n[Document: b.pdf | Type: PDF]\nBeta";
    const one = "[File: a.md]\nAlpha";
    expect(detectSourceResearch("What changed?", two)).toBe("attachments");
    expect(detectSourceResearch("Summarize this with citations", one)).toBe("attachments");
    expect(detectSourceResearch("What do these documents say about rye?", one)).toBe("attachments");
    expect(detectSourceResearch("Summarize this research paper", one)).toBeNull();
    expect(detectSourceResearch("What is the budget?", one)).toBeNull();
    expect(detectSourceResearch("research: HANA audit settings")).toBe("library");
    expect(detectSourceResearch("/research hana auditing")).toBe("library");
    expect(detectSourceResearch("Research how the cold proof works")).toBe("library");
    expect(detectSourceResearch("What does my library say about proofing?")).toBe("library");
    expect(detectSourceResearch("I did some research yesterday")).toBeNull();
    expect(detectSourceResearch("What is research?")).toBeNull();
    expect(explicitResearch("compare these files and cite the differences")).toBe(true);
    expect(explicitResearch("investigate these logs")).toBe(false);
    expect(researchQuestion("research: how hot are the ovens?")).toBe("how hot are the ovens?");
    expect(researchQuestion("/research ovens")).toBe("ovens");
    expect(researchQuestion("Researchers disagree on dosage")).toBe("Researchers disagree on dosage");
    expect(researchQuestion("What does my library say about kerberos?")).toBe("kerberos?");
    expect(detectSourceResearch("Which author has the most citations?", "[File: publications.csv]\nauthor,citations\nA,3")).toBeNull();
    expect(detectSourceResearch("research: who is cited most?", "[File: publications.csv]\nauthor,citations\nA,3")).toBe("attachments");
    expect(detectSourceResearch("Synthesize this into 5 bullets", "[Document: report.pdf | Type: PDF]\nText")).toBeNull();
    expect(detectSourceResearch("Summarize this with citations", "[Document: report.pdf | Type: PDF]\nText")).toBe("attachments");
  });

  it("keeps identifiers whole when tokenising", () => {
    expect(terms("Is rsau/enable = 1 on CVE-2025-31324 with OAuth 2.0?")).toEqual(expect.arrayContaining(["rsau/enable", "cve-2025-31324", "oauth", "2.0"]));
    expect(libraryQueries("how do I harden the SAP HANA SYSTEM user")).toEqual(expect.arrayContaining(["harden", "system", "hana", "sap"]));
  });
});

describe("research lane: passages", () => {
  it("chunks by paragraph, splits long paragraphs and merges tiny neighbours", () => {
    const chunks = chunkPassages(OVENS, 900);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 900)).toBe(true);
    expect(chunkPassages("one\n\ntwo\n\nthree")).toEqual(["one\n\ntwo\n\nthree"]);
    const long = chunkPassages(`${"A sentence about ovens. ".repeat(100)}`, 300);
    expect(long.length).toBeGreaterThan(5);
    expect(long.every((c) => c.length <= 300)).toBe(true);
  });

  it("gives every source a voice: matching passages first, the opening passage of a silent source", () => {
    const passages = rankPassages("How hot are the ovens, and how long is the cold proof?", SOURCES);
    expect(passages.find((p) => p.sourceId === "S1")!.text).toContain("220 degrees");
    expect(passages.some((p) => p.sourceId === "S2" && p.score > 0)).toBe(true);
    expect(passages.filter((p) => p.sourceId === "S3").map((p) => [p.tag, p.score])).toEqual([["S3.1", 0]]);
    expect(passages.map((p) => p.tag)).toEqual([...passages.map((p) => p.tag)].sort());
    expect(passages.every((p) => /^S\d+\.\d+$/.test(p.tag))).toBe(true);
  });

  it("does not let comparison words decide which sources are heard", () => {
    const contract: ResearchSource = { id: "S3", name: "contract.docx", text: "Both parties agree to the delivery terms.", origin: "attachment" };
    const passages = rankPassages("Compare these sources: where do they agree and where do they differ?", [SOURCES[0], SOURCES[1], contract]);
    expect(new Set(passages.map((p) => p.sourceId))).toEqual(new Set(["S1", "S2", "S3"]));
  });

  it("lets a single source use the whole passage budget", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Section ${i} about ovens. ${para("Ovens need care and steady heat every day.")}`).join("\n\n");
    const passages = rankPassages("ovens", [{ id: "S1", name: "manual.pdf", text: long, origin: "attachment" }]);
    expect(passages.length).toBe(12);
  });

  it("falls back to each source's opening passages when the question has no usable words", () => {
    const passages = rankPassages("Summarize these", SOURCES, 1);
    expect(passages.map((p) => p.tag)).toEqual(["S1.1", "S2.1", "S3.1"]);
  });

  it("turns library hits into sources: chunks joined in order, headers stripped, notes ignored", () => {
    const chunk = (id: string, file: string, i: number, n: number, body: string) => ({
      id,
      label: `📄 knowledge-pack://sap-and-security/${file} [chunk ${i}/${n}]`,
      content: `Source: knowledge-pack://sap-and-security/${file}\nChunk: ${i}/${n}\nChars: 0-10\n\n${body}`,
      node_type: "doc_chunk",
    });
    const sources = librarySources([
      chunk("h2", "sap-hana.md", 2, 2, "Second part."),
      chunk("h1", "sap-hana.md", 1, 2, "First part."),
      chunk("h1", "sap-hana.md", 1, 2, "First part."),
      { id: "n1", label: "📄 notes.md [chunk 1/1]", content: "Source: notes.md\nChunk: 1/1\nChars: 0-5\n\nNotes.", node_type: "doc_chunk" },
      { id: "c1", label: "conversation", content: "Q: hi\n\nA: hello", node_type: "conversation" },
    ]);
    expect(sources).toEqual([
      { id: "S1", name: "sap-hana.md (knowledge pack sap-and-security)", text: "First part.\n\nSecond part.", origin: "library" },
      { id: "S2", name: "notes.md", text: "Notes.", origin: "library" },
    ]);
    expect(prettySourceName("plain.pdf")).toBe("plain.pdf");
  });
});

describe("research lane: prompt and checks", () => {
  const passages = rankPassages("How hot are the ovens, and how long is the cold proof?", SOURCES);
  const s1 = passages.find((p) => p.sourceId === "S1")!.tag;
  const s2 = passages.find((p) => p.sourceId === "S2")!.tag;

  it("briefs the model to cite tags and use only the passages", () => {
    const prompt = researchPrompt("How hot are the ovens?", SOURCES, passages);
    expect(prompt).toContain(`[${s1}] (from ovens.md)`);
    expect(prompt).toContain("S2: proofing.pdf (attached)");
    expect(prompt).toContain("Never cite a tag that is not listed below.");
    expect(prompt).toContain("Open questions:");
  });

  it("counts cited sentences, flags unknown tags, uncited claims and numbers the passages don't contain", () => {
    const answer = [
      `The ovens run at 220 degrees for sourdough [${s1}]. The cold proof takes 12 hours [${s2}].`,
      `- Both sources describe an overnight rhythm [${s1}][${s2}].`,
      `- The bakery sells 300 loaves a day [${s1}].`,
      "- Rye is baked at a higher heat than sourdough.",
      "- Flour arrives on Mondays [S9.9].",
      "",
      "Open questions: neither source says how long the rye proofs, or what 400 grams refers to.",
    ].join("\n");
    const check = checkCitations(answer, passages, SOURCES);
    expect(check.sentences).toBe(6);
    expect(check.cited).toBe(4);
    expect(check.unknownTags).toEqual(["S9.9"]);
    expect(check.uncited).toEqual(["Rye is baked at a higher heat than sourdough.", "Flour arrives on Mondays."]);
    expect(check.unsupportedNumbers).toEqual([{ number: "300", sentence: "The bakery sells 300 loaves a day." }]);
    expect(citationSummary(check)).toBe("4 of 6 factual sentences cite a passage · unknown citations: S9.9 · 1 number not found in the cited passages (300)");
  });

  it("credits a tag written after the full stop to the sentence before it", () => {
    const sources: ResearchSource[] = [
      { id: "S1", name: "a.md", text: "Revenue was 1,200 in 2025.", origin: "attachment" },
      { id: "S2", name: "b.md", text: "Headcount reached 450 staff in March.", origin: "attachment" },
    ];
    const ps = rankPassages("revenue headcount", sources);
    const check = checkCitations("Revenue was 1,200 in 2025. [S1.1] Headcount reached 450 staff in March. [S2.1]", ps, sources);
    expect(check).toMatchObject({ sentences: 2, cited: 2, uncited: [], unsupportedNumbers: [] });
  });

  it("accepts grouped tags and whole-source tags", () => {
    const check = checkCitations(`Both agree on the overnight rhythm [${s1}, ${s2}]. The proof is cold [S2].`, passages, SOURCES);
    expect(check).toMatchObject({ sentences: 2, cited: 2, unknownTags: [], uncited: [], unsupportedNumbers: [] });
  });

  it("saves a report with the answer, checks, sources and exact passages, without em dashes", () => {
    const answer = `The ovens run at 220 degrees [${s1}].`;
    const md = renderResearchMarkdown("How hot are the ovens?", answer, SOURCES, passages, checkCitations(answer, passages, SOURCES), "qwen3:8b");
    expect(md).toContain("# Research: How hot are the ovens?");
    expect(md).toContain("## Checks");
    expect(md).toContain("**S3** rota.txt (attached): passages S3.1");
    expect(md).toContain(`**[${s1}]**`);
    expect(md).not.toContain("—");
  });
});
