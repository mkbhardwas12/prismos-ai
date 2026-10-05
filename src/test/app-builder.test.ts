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

describe("web design director's notes and the secure-by-default pass", () => {
  it("fills in what this kind of site always has", async () => {
    const { webDirectorNotes } = await import("../lib/docGen");
    expect(webDirectorNotes("build a website for my restaurant").join(" | ")).toMatch(/reservation form/);
    expect(webDirectorNotes("make an online store for sneakers").join(" | ")).toMatch(/checkout form with validation/);
    expect(webDirectorNotes("create a habit tracker app").join(" | ")).toMatch(/localStorage/);
    expect(webDirectorNotes("build me something")).toEqual([]);
  });

  it("fixes target=_blank links and flags risky patterns without touching good code", async () => {
    const { secureWebFiles } = await import("../lib/docGen");
    const r = secureWebFiles([
      { path: "index.html", content: '<a href="https://x.example" target="_blank">x</a><a href="/y" target="_blank" rel="noopener">y</a><a href="/z" target="_blank" rel="external">z</a><button onclick="go()">Go</button>' },
      { path: "app.js", content: "list.innerHTML = `<li>${name}</li>`;\nconst ok = el.textContent = name;\nlocalStorage.setItem('authToken', t);\neval(code);" },
      { path: "styles.css", content: "a { color: red }" },
    ]);
    expect(r.fixed).toBe(2);
    expect(r.files[0].content).toContain('<a href="https://x.example" target="_blank" rel="noopener noreferrer">');
    expect(r.files[0].content).toContain('rel="noopener"');
    expect(r.files[0].content).toContain('rel="external noopener noreferrer"');
    expect(r.warnings.join(" | ")).toMatch(/index\.html: 1 inline event handler/);
    expect(r.warnings.join(" | ")).toMatch(/app\.js: 1 innerHTML built from variables/);
    expect(r.warnings.join(" | ")).toMatch(/eval/);
    expect(r.warnings.join(" | ")).toMatch(/password or token in localStorage/);
    expect(r.files[2].content).toBe("a { color: red }");
  });
});
