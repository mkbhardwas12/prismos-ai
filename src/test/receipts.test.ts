import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { answerTextOf, exportAnswerReceipt, issueAnswerReceipt, shortReceiptId, verifyAnswerReceipt } from "../lib/receipts";

const call = vi.mocked(invoke);

describe("answer receipts helpers", () => {
  beforeEach(() => { call.mockReset(); });

  it("strips only the UI footer when recovering the signed answer text", () => {
    expect(answerTextOf("Paris.\n\n───\n1.2s · local inference · factual claims not independently verified")).toBe("Paris.");
    expect(answerTextOf("Two\n\n───\nsections\n\n───\n📄 Document Analysis · x.pdf")).toBe("Two\n\n───\nsections");
    expect(answerTextOf("No footer at all")).toBe("No footer at all");
    expect(answerTextOf("Dashes ─── inline stay")).toBe("Dashes ─── inline stay");
  });

  it("serialises the receipt input for the backend and parses the signed receipt", async () => {
    const receipt = { id: "11111111-2222-3333-4444-555555555555", model: "qwen3:4b", sources: [], context_node_ids: [], signature: "ab" };
    call.mockResolvedValueOnce(JSON.stringify(receipt));
    const out = await issueAnswerReceipt({ question: "q", answer: "a", model: "qwen3:4b", agent: "Reasoner", sources: ["x.pdf"] });
    expect(out.id).toBe(receipt.id);
    expect(call).toHaveBeenCalledWith("issue_answer_receipt", {
      input: JSON.stringify({ question: "q", answer: "a", model: "qwen3:4b", agent: "Reasoner", sources: ["x.pdf"] }),
    });
    expect(shortReceiptId(out.id)).toBe("11111111");
  });

  it("passes the answer text through to verification and null when absent", async () => {
    call.mockResolvedValue(JSON.stringify({ valid: true, message: "ok" }));
    await verifyAnswerReceipt("id-1", "Paris.");
    expect(call).toHaveBeenLastCalledWith("verify_answer_receipt", { id: "id-1", answer: "Paris." });
    await verifyAnswerReceipt("id-1");
    expect(call).toHaveBeenLastCalledWith("verify_answer_receipt", { id: "id-1", answer: null });
  });

  it("export returns the written file record", async () => {
    call.mockResolvedValueOnce(JSON.stringify({ path: "/tmp/r.json", filename: "r.json", kind: "json" }));
    expect((await exportAnswerReceipt("id-1")).filename).toBe("r.json");
    expect(call).toHaveBeenCalledWith("export_answer_receipt", { id: "id-1" });
  });
});
