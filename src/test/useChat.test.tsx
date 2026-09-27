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

  it("runs the contradiction check only after indexing and only when enabled, then attaches the report", async () => {
    const report = { source: "notes.md", chunks_checked: 1, candidates_considered: 1, judgements: 1, skipped_reason: null,
      conflicts: [{ new_node_id: "docsrc-x-chunk-0", new_excerpt: "Budget is 5M", existing_node_id: "n-old", existing_label: "📄 plan.pdf [chunk 2/4]", existing_excerpt: "Budget is 3M", similarity: 0.81, claim_new: "The budget is 5M.", claim_existing: "The budget is 3M.", explanation: "Different totals for the same budget.", confidence: 0.92, edge_recorded: true }] };
    call.mockImplementation(async (command) => {
      if (command === "check_ollama_status") return true;
      if (command === "rag_query") return JSON.stringify({ context: "Budget is 5M", chunks_used: 1, total_chunks: 1, source: "notes.md", rag_used: false });
      if (command === "query_ollama") return "The budget is five million.";
      if (command === "index_document_chunks") return JSON.stringify(["docsrc-x-chunk-0"]);
      if (command === "check_knowledge_drift") return JSON.stringify(report);
      return "[]";
    });
    const {result} = renderHook(() => useChat({ ...options(), settings: { ...DEFAULT_SETTINGS, driftAlertsEnabled: true } }));
    await act(async () => { await result.current.handleIntent("What is the budget?", undefined, "[File: notes.md]\nBudget is 5M"); });
    await waitFor(() => expect(result.current.messages[result.current.messages.length - 1]?.conflicts?.conflicts).toHaveLength(1));
    const order = call.mock.calls.map(([command]) => command);
    expect(order.indexOf("check_knowledge_drift")).toBeGreaterThan(order.indexOf("index_document_chunks"));
    expect(order.indexOf("index_document_chunks")).toBeGreaterThan(order.indexOf("query_ollama"));
    expect(call).toHaveBeenCalledWith("check_knowledge_drift", { text: "[File: notes.md]\nBudget is 5M", source: "notes.md", model: DEFAULT_SETTINGS.defaultModel });

    call.mockClear();
    const off = renderHook(() => useChat(options()));
    await act(async () => { await off.result.current.handleIntent("What is the budget?", undefined, "[File: notes.md]\nBudget is 5M"); });
    await waitFor(() => expect(call).toHaveBeenCalledWith("index_document_chunks", expect.anything()));
    expect(call.mock.calls.some(([command]) => command === "check_knowledge_drift")).toBe(false);
  });

  it("routes a CSV attachment through the data lane: profile → analysis → validated chart → html artifact, no RAG", async () => {
    const csv = "[File: sales.csv]\nregion,amount\nEMEA,1200\nAPAC,800\n";
    const profile = { name: "sales.csv", sheet: null, row_count: 2, column_count: 2, truncated: false, sample: [],
      columns: [{ name: "region", kind: "text", non_empty: 2, unique: 2, numeric: null, top_values: [["EMEA", 1], ["APAC", 1]], example: "EMEA" },
                { name: "amount", kind: "number", non_empty: 2, unique: 2, numeric: { min: 800, max: 1200, mean: 1000, median: 1000, sum: 2000 }, top_values: [], example: "1200" }] };
    call.mockImplementation(async (command, args) => {
      if (command === "check_ollama_status") return true;
      if (command === "profile_table") return JSON.stringify(profile);
      if (command === "query_ollama") {
        const a = args as { format?: unknown; prompt: string };
        if (a.format) return JSON.stringify({ type: "bar", x: "region", y: "amount", agg: "sum", title: "Amount by region" });
        expect(a.prompt).toContain("DATA to reason over");
        expect(a.prompt).not.toContain("EMEA,1200"); // raw rows never reach the model
        return "EMEA leads with 1,200 of the 2,000 total.";
      }
      if (command === "aggregate_table") {
        expect(JSON.parse((args as { specJson: string }).specJson)).toEqual({ x: "region", y: "amount", agg: "sum", limit: 12, sort_by_label: false });
        return JSON.stringify({ x_label: "region", y_label: "sum(amount)", points: [["EMEA", 1200], ["APAC", 800]], groups_total: 2, skipped_rows: 0 });
      }
      if (command === "create_text_file") {
        const a = args as { title: string; ext: string; content: string };
        expect(a.ext).toBe("html");
        expect(a.content).not.toMatch(/<script/i);
        return JSON.stringify({ path: "/tmp/sales-bar-chart.html", filename: "sales-bar-chart.html", kind: "html" });
      }
      if (command === "index_document_chunks") {
        expect((args as { text: string }).text).toContain("Dataset: sales.csv");
        return "[]";
      }
      return "[]";
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Plot total amount by region", undefined, csv); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Data Analyst");
    expect(last.content).toContain("EMEA leads");
    expect(last.content).toContain("📈 bar chart");
    expect(last.attachment?.filename).toBe("sales-bar-chart.html");
    const cmds = call.mock.calls.map(([c]) => c);
    expect(cmds).not.toContain("rag_query");
    expect(cmds).not.toContain("refract_intent");
    expect(cmds.indexOf("profile_table")).toBeLessThan(cmds.indexOf("aggregate_table"));
    await waitFor(() => expect(cmds.includes("index_document_chunks") || call.mock.calls.some(([c]) => c === "index_document_chunks")).toBe(true));
  });
  it("answers a plain question about a spreadsheet without producing a chart", async () => {
    call.mockImplementation(async (command) => {
      if (command === "check_ollama_status") return true;
      if (command === "profile_table") return JSON.stringify({ name: "q.xlsx", sheet: "Data", row_count: 9, column_count: 1, truncated: false, sample: [], columns: [{ name: "item", kind: "text", non_empty: 9, unique: 3, numeric: null, top_values: [], example: "A" }] });
      if (command === "query_ollama") return "There are 3 distinct items.";
      return "[]";
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("How many distinct items?", undefined, "[Document: q.xlsx | Type: XLSX | 1 sheets | 9 rows]\n\n── Sheet: Data ──\nitem\nA\n"); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.content).toContain("3 distinct items");
    expect(last.content).toContain("q.xlsx · Data · 9 rows × 1 cols");
    expect(last.attachment).toBeUndefined();
    expect(call.mock.calls.some(([c]) => c === "aggregate_table" || c === "create_text_file")).toBe(false);
  });
});
