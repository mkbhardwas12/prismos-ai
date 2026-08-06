import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectDocRequest,
  generateDocument,
  validateDocumentSpecGrounding,
} from "../lib/docGen";

const invokeMock = vi.mocked(invoke);
const exactSapPrompt = "Create a PPT for executive to on SAP netweaver 7.5 SP27 to SP34 and landscapes are DEV, Test, Stage, Prod";

function safeSapDeck() {
  return {
    title: "Executive SAP NetWeaver upgrade planning deck",
    subtitle: "NetWeaver 7.5 SP27 to SP34 — DEV, Test, Stage, Prod — verification-first draft",
    slides: [
      {
        title: "Landscape assumptions and required inputs",
        bullets: ["Confirm the installed topology, operating system, database, adapters, add-ons, and availability design."],
      },
      {
        title: "Official-source verification gates",
        bullets: ["Verify the target in SAP Maintenance Planner and the current applicable SUM guide before execution."],
      },
      {
        title: "Rehearsal and regression test matrix",
        bullets: ["Build the test inventory from the actual interfaces and compare rehearsal results."],
      },
      {
        title: "Rollback and recovery decision",
        bullets: ["Define restore ownership, trigger criteria, and a tested recovery sequence."],
      },
      { title: "DEV rehearsal", bullets: ["Rehearse in DEV and retain evidence."] },
      { title: "Test assurance", bullets: ["Complete the approved Test inventory."] },
      { title: "Stage gate", bullets: ["Require Stage exit evidence before promotion."] },
      { title: "Prod go/no-go", bullets: ["Approve Prod only when every gate passes."] },
      { title: "Executive decisions", bullets: ["Confirm scope, ownership, evidence, and risk acceptance."] },
    ],
    decision_record: [
      "Version-specific facts require independent verification against approved official sources before execution.",
    ],
  };
}

describe("document routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("routes the exact plain-PPT request to the PowerPoint artifact path", () => {
    expect(detectDocRequest(exactSapPrompt)).toBe("pptx");
  });

  it.each([
    ["Create a Word document about the program", "docx"],
    ["Create an executive report as PDF", "pdf"],
    ["Create an Excel report for the landscapes", "xlsx"],
    ["Build a workbook for risk tracking", "xlsx"],
    ["Prepare a slide deck for leadership", "pptx"],
  ] as const)("routes %s to %s", (input, expected) => {
    expect(detectDocRequest(input)).toBe(expected);
  });

  it("creates a real PowerPoint attachment instead of falling through to chat", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "generate_document_spec") return JSON.stringify(safeSapDeck());
      if (command === "create_powerpoint") {
        return JSON.stringify({
          path: "/mock/Downloads/SAP-PI-upgrade.pptx",
          filename: "SAP-PI-upgrade.pptx",
          kind: "pptx",
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(generateDocument("pptx", exactSapPrompt, { model: "qwen3:32b" }))
      .resolves.toMatchObject({ filename: "SAP-PI-upgrade.pptx", kind: "pptx" });

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "generate_document_spec",
      "create_powerpoint",
    ]);
  });

  it("uses a validated safe deck when the model returns the reported missing bracket", async () => {
    let writtenSpec: Record<string, unknown> | undefined;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "generate_document_spec") {
        return '{"title":"Partial","slides":[{"title":"Scope","bullets":["A"]}';
      }
      if (command === "create_powerpoint") {
        writtenSpec = JSON.parse(
          String((args as Record<string, unknown> | undefined)?.specJson),
        ) as Record<string, unknown>;
        return JSON.stringify({
          path: "/mock/Downloads/executive-upgrade.pptx",
          filename: "executive-upgrade.pptx",
          kind: "pptx",
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const attachment = await generateDocument("pptx", exactSapPrompt, { model: "qwen3:32b" });
    expect(attachment.generationMode).toBe("safe_fallback");
    expect(attachment.generationNotice).toMatch(/malformed|validation/i);
    expect(writtenSpec?.slides).toHaveLength(11);
    const rendered = JSON.stringify(writtenSpec);
    for (const landscape of ["DEV", "Test", "Stage", "Prod"]) {
      expect(rendered).toContain(landscape);
    }
    expect(rendered).not.toContain("2934123");
  });

  it.each([
    ["docx", "Create a Word document about team planning", "create_word_document"],
    ["pdf", "Create a PDF about team planning", "create_pdf_document"],
    ["xlsx", "Create an Excel workbook about team planning", "create_excel_workbook"],
  ] as const)("creates %s through its real local writer", async (kind, input, writer) => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "generate_document_spec") return "{truncated";
      if (command === writer) {
        return JSON.stringify({
          path: `/mock/Downloads/artifact.${kind}`,
          filename: `artifact.${kind}`,
          kind,
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(generateDocument(kind, input, { model: "qwen3:4b" }))
      .resolves.toMatchObject({ kind, generationMode: "safe_fallback" });
    expect(invokeMock.mock.calls.map(([command]) => command)).toContain(writer);
  });
});

describe("artifact grounding gate", () => {
  it("accepts a verification-first SAP planning deck using only requested versions", () => {
    expect(() => validateDocumentSpecGrounding(exactSapPrompt, safeSapDeck())).not.toThrow();
  });

  it("rejects the fabricated note, command, dates, duration, and local sources from the incident", () => {
    const unsafe = safeSapDeck();
    unsafe.slides.push({
      title: "Execution",
      bullets: [
        "SAP Note 2934123 is the SP34 download guide.",
        "Run sapgenpfl -copy before the 6-8 hours production window.",
        "Use ~/PrivateOpsKit/scripts/upgrade-sum and plan SP38 in Q3 2025.",
      ],
    });

    expect(() => validateDocumentSpecGrounding(exactSapPrompt, unsafe)).toThrow(
      /Artifact quality gate stopped this draft/,
    );
  });
});
