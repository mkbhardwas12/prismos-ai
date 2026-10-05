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
  it("investigates attached logs offline: evidence first, model second, report saved", async () => {
    const log = Array.from({ length: 12 }, (_, i) => `Oct  4 03:10:${String(i).padStart(2, "0")} web01 sshd[1]: Failed password for root from 203.0.113.50 port 5${i} ssh2`)
      .concat(["Oct  4 03:11:00 web01 sshd[1]: Accepted password for root from 203.0.113.50 port 6000 ssh2"]).join("\n");
    call.mockImplementation(async (command) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "check_ollama_status") return true;
      if (command === "query_ollama") return "## What happened\nThe attacker guessed root's password.";
      if (command === "create_text_file") return JSON.stringify({ path: "/tmp/investigation-auth-log.md", filename: "investigation-auth-log.md", kind: "md" });
      return "[]";
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("investigate this", undefined, `[File: auth.log]\n${log}`); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Incident Investigator");
    expect(last.attachment?.filename).toBe("investigation-auth-log.md");
    expect(last.content).toContain("Login succeeded from a source that was guessing passwords");
    const sent = call.mock.calls.find(([command]) => command === "query_ollama")![1] as { prompt: string };
    expect(sent.prompt).toContain("203.0.113[.]50");
    expect(sent.prompt).not.toContain("Failed password for root from 203.0.113.50 port 50"); // the model gets the analysis, not the raw log
    expect(call.mock.calls.some(([command]) => command === "rag_query")).toBe(false);
  });

  it("answers 'harden my postgres' with a grounded plan and no attachment needed", async () => {
    call.mockImplementation(async (command) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "check_ollama_status") return true;
      if (command === "query_ollama") return "Do today: switch pg_hba.conf to scram-sha-256.";
      return "[]";
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("how do I harden my postgres server?"); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Hardening Advisor");
    const sent = call.mock.calls.find(([command]) => command === "query_ollama")![1] as { prompt: string };
    expect(sent.prompt).toContain("pg_hba.conf: scram-sha-256");
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

  it("treats a transcript attachment like a document, credited to the Meeting Scribe", async () => {
    call.mockImplementation(async (command, args) => {
      if (command === "check_ollama_status") return true;
      if (command === "rag_query") {
        expect((args as { source: string }).source).toBe("standup.m4a | 61s | transcribed offline by whisper.cpp (local sidecar)");
        return JSON.stringify({ context: "We ship Friday.", chunks_used: 1, total_chunks: 1, source: "x", rag_used: false });
      }
      if (command === "query_ollama") return "Decision: ship Friday. Action: Ana writes release notes.";
      return "[]";
    });
    const {result} = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("What was decided?", undefined, "[Audio: standup.m4a | 61s | transcribed offline by whisper.cpp (local sidecar)]\n\nWe ship Friday."); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Meeting Scribe");
    expect(last.content).toContain("🎙️ Recording Analysis · standup.m4a");
    expect(call).toHaveBeenCalledWith("index_document_chunks", expect.objectContaining({ source: expect.stringContaining("standup.m4a") }));
  });
});

describe("research lane routing", () => {
  beforeEach(() => { call.mockReset(); });
  const two = "[File: ovens.md]\nThe deck ovens run at 220 degrees for sourdough.\n\n[Document: proofing.pdf | Type: PDF | 1 pages]\nThe cold proof takes 12 hours at 4 degrees.";

  it("answers a question over several attachments with a cited synthesis, a saved report and no RAG", async () => {
    call.mockImplementation(async (command, args) => {
      if (command === "check_ollama_status") return true;
      if (command === "query_ollama") return "Sourdough bakes at 220 degrees [S1.1] after a 12 hour cold proof [S2.1].\n\nOpen questions: rye is not covered.";
      if (command === "create_text_file") {
        const a = args as { title: string; ext: string; content: string };
        expect(a.title).toBe("research-where-do-the-two-notes-differ");
        expect(a.content).toContain("## Passages used");
        return JSON.stringify({ path: "/tmp/research.md", filename: "research-where-do-the-two-notes-differ.md", kind: "md" });
      }
      return "[]";
    });
    const { result } = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Where do the two notes differ?", undefined, two); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Researcher");
    expect(last.attachment?.filename).toBe("research-where-do-the-two-notes-differ.md");
    expect(last.content).toContain("Sources: **S1** ovens.md · **S2** proofing.pdf");
    expect(last.content).toContain("🔎 Research · 2 sources · 1 of 1 factual sentence cites a passage");
    expect(result.current.messages[result.current.messages.length - 2]!.content).toContain("📄 [2 sources attached]");
    const sent = call.mock.calls.find(([command]) => command === "query_ollama")![1] as { prompt: string };
    expect(sent.prompt).toContain("[S1.1] (from ovens.md)");
    expect(sent.prompt).toContain("[S2.1] (from proofing.pdf)");
    const cmds = call.mock.calls.map(([c]) => c);
    expect(cmds).not.toContain("rag_query");
    expect(cmds).not.toContain("refract_intent");
    await waitFor(() => expect(call.mock.calls.filter(([c]) => c === "index_document_chunks")).toHaveLength(2));
  });

  it("researches the local library when asked to, and never indexes library hits again", async () => {
    const hit = { id: "h1", label: "📄 knowledge-pack://demo/ovens.md [chunk 1/1]", content: "Source: knowledge-pack://demo/ovens.md\nChunk: 1/1\nChars: 0-40\n\nThe deck ovens run at 220 degrees.", node_type: "doc_chunk" };
    call.mockImplementation(async (command, args) => {
      if (command === "search_library_passages") {
        expect(args).toEqual({ query: "how hot do the ovens run?", limit: 24 });
        return JSON.stringify([hit]);
      }
      if (command === "check_ollama_status") return true;
      if (command === "query_ollama") return "The ovens run at 220 degrees [S1.1].";
      if (command === "create_text_file") return JSON.stringify({ path: "/tmp/r.md", filename: "r.md", kind: "md" });
      return "[]";
    });
    const { result } = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("research: how hot do the ovens run?"); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Researcher");
    expect(last.content).toContain("**S1** ovens.md (knowledge pack demo)");
    const sent = call.mock.calls.find(([command]) => command === "query_ollama")![1] as { prompt: string };
    expect(sent.prompt).toContain("S1: ovens.md (knowledge pack demo) (local library)");
    expect(sent.prompt).toContain("Question: how hot do the ovens run?");
    expect(call.mock.calls.some(([c]) => c === "index_document_chunks")).toBe(false);
  });

  it("answers normally when the library holds nothing on the question", async () => {
    call.mockImplementation(async (command) => {
      if (command === "refract_intent") return JSON.stringify({ response: "Photosynthesis turns light into sugar.", agent_used: "reasoner", context_nodes: [], edges_reinforced: [], anticipations: [], processing_time_ms: 1, npu_accelerated: false, intent: { raw: "q", intent_type: "question", entities: [], confidence: 1 } });
      return "[]";
    });
    const { result } = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Research how photosynthesis works"); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).not.toBe("Researcher");
    expect(last.content).toContain("Photosynthesis turns light into sugar.");
    expect(call.mock.calls.some(([c]) => c === "search_library_passages")).toBe(true);
    expect(call.mock.calls.some(([c]) => c === "query_ollama")).toBe(false);
  });

  it("reviews several config files one by one instead of as one file", async () => {
    const prompts: string[] = [];
    call.mockImplementation(async (command, args) => {
      if (command === "check_ollama_status") return true;
      if (command === "query_ollama") {
        prompts.push((args as { prompt: string }).prompt);
        return `Notes ${prompts.length}.`;
      }
      if (command === "create_text_file") {
        expect((args as { title: string }).title).toBe("hardening-2-files");
        return JSON.stringify({ path: "/tmp/h.md", filename: "hardening-2-files.md", kind: "md" });
      }
      return "[]";
    });
    const { result } = renderHook(() => useChat(options()));
    const configs = "[File: web1_sshd_config]\nPermitRootLogin no\nPasswordAuthentication no\n\n[File: web2_sshd_config]\nPermitRootLogin yes\nPasswordAuthentication yes\n";
    await act(async () => { await result.current.handleIntent("review these configs", undefined, configs); });
    const last = result.current.messages[result.current.messages.length - 1]!;
    expect(last.agent).toBe("Hardening Advisor");
    expect(prompts).toHaveLength(2);
    expect(last.content).toContain("### web1_sshd_config");
    expect(last.content).toContain("### web2_sshd_config");
    expect(last.content).toContain("🛡️ Hardening Review · 2 files");
    expect(prompts[1]).toContain("PermitRootLogin");
    expect(prompts.join("\n")).not.toContain("[File: web2_sshd_config]");
  });

  it("keeps a single spreadsheet in the data lane even when the question mentions citations", async () => {
    call.mockImplementation(async (command) => {
      if (command === "check_ollama_status") return true;
      if (command === "profile_table") return JSON.stringify({ name: "publications.csv", sheet: null, row_count: 2, column_count: 2, truncated: false, sample: [], columns: [] });
      if (command === "query_ollama") return "Author A has the most citations.";
      return "[]";
    });
    const { result } = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("Which author has the most citations?", undefined, "[File: publications.csv]\nauthor,citations\nA,3\nB,1\n"); });
    expect(result.current.messages[result.current.messages.length - 1]!.agent).toBe("Data Analyst");
  });

  it("leaves 'research … online' to the web lane and logs to the security lane unless research is asked for", async () => {
    call.mockImplementation(async (command) => {
      if (command === "check_ollama_status") return true;
      if (command === "query_ollama") return "Notes.";
      if (command === "create_text_file") return JSON.stringify({ path: "/tmp/x.md", filename: "x.md", kind: "md" });
      return "[]";
    });
    const { result } = renderHook(() => useChat(options()));
    await act(async () => { await result.current.handleIntent("research online about sourdough ovens"); });
    expect(result.current.messages[result.current.messages.length - 1]!.agent).toBe("Web Researcher");

    const log = (host: string) => Array.from({ length: 12 }, (_, i) => `Oct  4 03:10:${String(i).padStart(2, "0")} ${host} sshd[1]: Failed password for root from 203.0.113.50 port 5${i} ssh2`).join("\n");
    const logs = `[File: web01.log]\n${log("web01")}\n\n[File: web02.log]\n${log("web02")}`;
    await act(async () => { await result.current.handleIntent("investigate these logs", undefined, logs); });
    expect(result.current.messages[result.current.messages.length - 1]!.agent).toBe("Incident Investigator");
    await act(async () => { await result.current.handleIntent("compare these files and cite the differences", undefined, logs); });
    expect(result.current.messages[result.current.messages.length - 1]!.agent).toBe("Researcher");
  });
});
