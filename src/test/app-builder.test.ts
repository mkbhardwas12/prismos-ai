// app-builder — detection tests for the multi-file app lane.
//
// The lane sits between documents (which keep priority via useChat ordering)
// and single-file generation, so the detector itself must refuse doc-ish and
// read-ish phrasings outright.

import { describe, it, expect } from "vitest";
import { detectAppRequest, detectDocRequest, detectFileRequest } from "../lib/docGen";

describe("detectAppRequest", () => {
  it("fires on build-an-app phrasings", () => {
    expect(detectAppRequest("build me a todo app")).toBe(true);
    expect(detectAppRequest("create a website for my bakery")).toBe(true);
    expect(detectAppRequest("make a snake game")).toBe(true);
    expect(detectAppRequest("build an e-commerce storefront with a cart")).toBe(true);
    expect(detectAppRequest("create a landing page for PrismOS")).toBe(true);
    expect(detectAppRequest("make a calculator tool")).toBe(true);
  });

  it("treats polite and purpose-laden build requests as build orders (Codex P2)", () => {
    expect(detectAppRequest("can you build me a todo app?")).toBe(true);
    expect(detectAppRequest("could you make a website for my portfolio")).toBe(true);
    expect(detectAppRequest("build an app to analyze my expenses")).toBe(true);
  });

  it("stays quiet on documents and presentations about apps", () => {
    expect(detectAppRequest("create a presentation about my app")).toBe(false);
    expect(detectAppRequest("write a report on website performance")).toBe(false);
    expect(detectAppRequest("make a word doc describing the app")).toBe(false);
  });

  it("stays quiet on questions and read requests", () => {
    expect(detectAppRequest("what is a web app")).toBe(false);
    expect(detectAppRequest("how do I build an app")).toBe(false);
    expect(detectAppRequest("review my website")).toBe(false);
    expect(detectAppRequest("open my app")).toBe(false);
  });

  it("keeps single-file html requests in the file lane, not the app lane", () => {
    const input = "create an html page with a big red button";
    expect(detectAppRequest(input)).toBe(false);
    expect(detectFileRequest(input)).toBe("html");
  });

  it("doc detection keeps priority for deck-about-an-app requests", () => {
    const input = "build a slide deck about our new app";
    expect(detectDocRequest(input)).toBe("pptx");
    expect(detectAppRequest(input)).toBe(false);
  });
});
