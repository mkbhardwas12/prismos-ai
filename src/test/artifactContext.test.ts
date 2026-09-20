import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { artifactKeywords, collectArtifactContext } from "../lib/artifactContext";

const call = vi.mocked(invoke);
describe("local artifact evidence", () => {
  beforeEach(() => { call.mockReset(); });
  it("bounds and deduplicates topic queries", () => {
    expect(artifactKeywords("Create a PPT for executive SAP SAP NetWeaver SP10 to SP20 DEV Test Stage Prod")).toHaveLength(6);
    expect(artifactKeywords("create create slides SAP SAP")).toEqual(["sap"]);
  });
  it("deduplicates local records and excludes retired records and suggestions", async () => {
    call.mockResolvedValue(JSON.stringify([
      { id: "a", label: "SAP planning", content: "User requirement, not a verified vendor fact", node_type: "document", updated_at: "2026-09-08" },
      { id: "b", content: "noisy", node_type: "suggestion" },
      { id: "c", content: "obsolete", node_type: "doc_chunk_retired" },
    ]));
    const result = await collectArtifactContext("Create SAP NetWeaver slides");
    expect(result.match(/\[K\d+\]/g)).toHaveLength(1);
    expect(result).toContain("id=a");
    expect(result).not.toContain("noisy");
    expect(result).not.toContain("obsolete");
    expect(call.mock.calls.every(([command]) => command === "search_spectrum_nodes")).toBe(true);
  });
  it("uses attached source text through local RAG without starting indexing", async () => {
    call.mockImplementation(async (command) => command === "rag_query" ? JSON.stringify({context: "Source: landscape DEV, Test, Stage, Prod"}) : "[]");
    const result = await collectArtifactContext("Create SAP slides", "Earlier assistant draft", "[Document: landscape.md]\nDEV, Test, Stage, Prod");
    expect(result).toContain("[A1] User attachment: landscape.md");
    expect(result).toContain("not independently verified facts");
    expect(call).toHaveBeenCalledWith("rag_query", expect.objectContaining({source: "landscape.md"}));
    expect(call.mock.calls.some(([command]) => command === "index_document_chunks")).toBe(false);
  });
  it("fails visibly on unusable attachments instead of silently ignoring them", async () => {
    call.mockResolvedValue('{"context":""}');
    await expect(collectArtifactContext("Create slides", "", "attached data")).rejects.toThrow("usable source text");
  });
  it("does not manufacture evidence when retrieval fails", async () => {
    call.mockRejectedValue(new Error("database unavailable"));
    expect(await collectArtifactContext("Create SAP slides")).toContain("No supporting local knowledge was retrieved");
  });
  it("never turns response-derived entities or conversation history into K evidence", async () => {
    call.mockResolvedValue(JSON.stringify([{id:"old",label:"Old SAP answer",content:"SP20 is LTS",node_type:"entity"}]));
    const result = await collectArtifactContext("Create SAP slides");
    expect(result).not.toContain("[K1]");
    expect(result).toContain("UNVERIFIED CONTINUITY ONLY");
    expect(result).toContain("No supporting local knowledge was retrieved");
  });
});
