import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useChat } from "../hooks/useChat";
import { DEFAULT_SETTINGS } from "../lib/config";

const call = vi.mocked(invoke);
const options = () => ({settings: DEFAULT_SETTINGS, onIntentProcessed: vi.fn(), clearLiveSteps: vi.fn(), voiceEnabled: false, voiceSpeak: vi.fn(), refreshSuggestions: vi.fn().mockResolvedValue(undefined)});
describe("chat request routing", () => {
  beforeEach(() => { call.mockReset(); });
  it("creates a requested PPT using an attachment and local evidence instead of analyzing it only", async () => {
    call.mockImplementation(async (command) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "rag_query") return JSON.stringify({context:"DEV, Test, Stage, Prod"});
      if (command === "query_ollama") return JSON.stringify({title:"SAP",slides:[{title:"Scope",bullets:["DEV, Test, Stage, Prod"]}]});
      if (command === "create_powerpoint") return JSON.stringify({path:"/tmp/sap.pptx",filename:"sap.pptx",kind:"pptx"});
      throw new Error(`Unexpected ${command}`);
    });
    const {result} = renderHook(() => useChat(options()));
    await waitFor(() => expect(call).toHaveBeenCalledWith("search_spectrum_nodes", {query:"conversation"}));
    await act(async () => { await result.current.handleIntent("Create a PPT for SAP", undefined, "[Document: plan.md]\nDEV, Test, Stage, Prod"); });
    expect(result.current.messages[result.current.messages.length - 1]?.attachment?.filename).toBe("sap.pptx");
    expect(call).toHaveBeenCalledWith("query_ollama", expect.objectContaining({prompt: expect.stringContaining("[A1] User attachment: plan.md")}));
    expect(call.mock.calls.some(([command]) => command === "refract_intent")).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });
  it("does not automatically retry a failed mutating pipeline or switch to a hidden fallback model", async () => {
    call.mockImplementation(async (command) => {
      if (command === "search_spectrum_nodes") return "[]";
      throw new Error("Test pipeline failed");
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Hello there"); });
    expect(call.mock.calls.filter(([command]) => command === "refract_intent")).toHaveLength(1);
    expect(call.mock.calls.some(([command]) => command === "process_intent")).toBe(false);
    expect(result.current.messages[result.current.messages.length - 1]?.content).toContain("Test pipeline failed");
  });
  it("flags the AI message as truncated when the backend reports the token ceiling", async () => {
    const refracted = (truncated: boolean) => JSON.stringify({
      response: "Partial answer", truncated, agent_used: "reasoner", context_nodes: [], edges_reinforced: [],
      anticipations: [], processing_time_ms: 10, npu_accelerated: false,
      intent: { raw: "q", intent_type: "question", entities: [], confidence: 1 },
    });
    call.mockImplementation(async (command) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "refract_intent") return refracted(true);
      return "[]";
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Explain everything"); });
    expect(result.current.messages[result.current.messages.length - 1]?.truncated).toBe(true);

    call.mockImplementation(async (command) => command === "refract_intent" ? refracted(false) : "[]");
    await act(async () => { await result.current.handleIntent("Short one"); });
    expect(result.current.messages[result.current.messages.length - 1]?.truncated).toBe(false);
  });

  it("issues a receipt after the answer renders (opt-in) and reports the model that actually ran", async () => {
    const refracted = JSON.stringify({
      response: "Paris.", agent_used: "reasoner", model_used: "qwen3:30b-a3b", context_nodes: ["n1", "n2"], edges_reinforced: [],
      anticipations: [], processing_time_ms: 10, npu_accelerated: false,
      intent: { raw: "q", intent_type: "question", entities: [], confidence: 1 },
    });
    const receipt = { id: "aaaaaaaa-0000-0000-0000-000000000000", model: "qwen3:30b-a3b", sources: [], context_node_ids: ["n1", "n2"], signature: "ff" };
    call.mockImplementation(async (command) => {
      if (command === "refract_intent") return refracted;
      if (command === "issue_answer_receipt") return JSON.stringify(receipt);
      return "[]";
    });
    const opts = options();
    const {result} = renderHook(() => useChat({ ...opts, settings: { ...DEFAULT_SETTINGS, answerReceiptsEnabled: true } }));
    await act(async () => { await result.current.handleIntent("Capital of France?"); });
    await waitFor(() => expect(result.current.messages[result.current.messages.length - 1]?.receipt?.id).toBe(receipt.id));
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.transparency?.model_used).toBe("qwen3:30b-a3b");
    const issued = call.mock.calls.find(([command]) => command === "issue_answer_receipt");
    const input = JSON.parse((issued![1] as { input: string }).input);
    expect(input).toMatchObject({ question: "Capital of France?", answer: "Paris.", model: "qwen3:30b-a3b", agent: "reasoner", context_node_ids: ["n1", "n2"] });
    // The receipt request went out only after the message existed — never on the hot path.
    const order = call.mock.calls.map(([command]) => command);
    expect(order.indexOf("issue_answer_receipt")).toBeGreaterThan(order.indexOf("refract_intent"));
  });
  it("never contacts the receipt signer when the setting is off", async () => {
    call.mockImplementation(async (command) => command === "refract_intent"
      ? JSON.stringify({ response: "x", agent_used: "reasoner", context_nodes: [], edges_reinforced: [], anticipations: [], processing_time_ms: 1, npu_accelerated: false, intent: { raw: "q", intent_type: "question", entities: [], confidence: 1 } })
      : "[]");
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Hi"); });
    expect(call.mock.calls.some(([command]) => command === "issue_answer_receipt")).toBe(false);
    expect(result.current.messages[result.current.messages.length - 1]?.transparency?.model_used).toBe("local (routing not reported)");
  });
});
