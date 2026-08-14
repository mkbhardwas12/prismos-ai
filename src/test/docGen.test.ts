// docGen unit tests — detection, JSON extraction, truncation repair.
//
// Regression coverage for the field failure: "create a word document on this"
// → model outline truncated at the 2048-token chat cap → raw
// `SyntaxError: JSON Parse error: Expected ']'` surfaced to the user.

import { describe, it, expect } from "vitest";
import { detectDocRequest, extractJson, repairJson } from "../lib/docGen";

describe("detectDocRequest", () => {
  it("detects classic phrasings", () => {
    expect(detectDocRequest("create a presentation about AI")).toBe("pptx");
    expect(detectDocRequest("make me a PowerPoint on sales")).toBe("pptx");
    expect(detectDocRequest("generate slides for standup")).toBe("pptx");
    expect(detectDocRequest("create a word document on this")).toBe("docx");
    expect(detectDocRequest("write a report about Q3")).toBe("docx");
  });

  it("detects the short forms people actually type (ppt / doc)", () => {
    expect(detectDocRequest("create a ppt about sales")).toBe("pptx");
    expect(detectDocRequest("make a ppt")).toBe("pptx");
    expect(detectDocRequest("create a doc about the roadmap")).toBe("docx");
  });

  it("requires a creation verb", () => {
    expect(detectDocRequest("what is a powerpoint?")).toBeNull();
    expect(detectDocRequest("the document says otherwise")).toBeNull();
  });

  it("ignores unrelated requests", () => {
    expect(detectDocRequest("create a shopping list")).toBeNull();
    expect(detectDocRequest("how do you work")).toBeNull();
  });
});

describe("extractJson", () => {
  it("strips code fences and surrounding prose", () => {
    const raw = 'Here you go:\n```json\n{"title":"T","slides":[]}\n```';
    expect(JSON.parse(extractJson(raw))).toEqual({ title: "T", slides: [] });
  });

  it("returns the tail for repair when the closing brace is missing", () => {
    const raw = '{"title":"T","slides":[{"title":"S1","bullets":["a","b"';
    expect(extractJson(raw)).toBe(raw);
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("Sorry, I cannot do that.")).toThrow();
  });
});

describe("repairJson", () => {
  it("closes a spec truncated mid-array (the field failure shape)", () => {
    const truncated =
      '{"title":"Report","subtitle":"S","sections":[{"heading":"H1","paragraphs":["p1","p2"],"bullets":["b1","b2"';
    const fixed = repairJson(truncated);
    expect(fixed).not.toBeNull();
    const obj = JSON.parse(fixed!);
    expect(obj.sections[0].bullets).toEqual(["b1", "b2"]);
  });

  it("drops an unterminated trailing string", () => {
    const truncated = '{"title":"T","slides":[{"title":"S1","bullets":["complete","cut off mid sente';
    const fixed = repairJson(truncated);
    expect(fixed).not.toBeNull();
    const obj = JSON.parse(fixed!);
    expect(obj.slides[0].bullets[0]).toBe("complete");
  });

  it("drops a dangling key fragment", () => {
    const truncated = '{"title":"T","slides":[{"title":"S1","bullets":["a"]},{"title":';
    const fixed = repairJson(truncated);
    expect(fixed).not.toBeNull();
    const obj = JSON.parse(fixed!);
    expect(obj.slides.length).toBeGreaterThanOrEqual(1);
    expect(obj.slides[0].bullets).toEqual(["a"]);
  });

  it("keeps already-valid JSON semantically intact", () => {
    const ok = '{"title":"T","slides":[{"title":"S","bullets":["x"]}]}';
    const fixed = repairJson(ok);
    expect(fixed).not.toBeNull();
    expect(JSON.parse(fixed!)).toEqual(JSON.parse(ok));
  });

  it("returns null for hopeless input", () => {
    expect(repairJson("not json at all")).toBeNull();
  });
});
