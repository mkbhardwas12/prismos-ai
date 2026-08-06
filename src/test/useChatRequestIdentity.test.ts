import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/config";
import {
  MAX_REFRACT_REQUEST_ID_BYTES,
  refractIntentWithRetry,
  useChat,
  type RefractCommandFailure,
  type RefractCommandInvoker,
  type RefractFailureKind,
} from "../hooks/useChat";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("refractIntentWithRetry request identity", () => {
  it("uses an explicit activity task ID as the backend request identity", async () => {
    const requestIdFactory = vi.fn(() => "unused-request");
    const invokeCommand = vi.fn<RefractCommandInvoker>(async (_command, args) => args.requestId);

    await expect(
      refractIntentWithRetry("hello", "mistral", invokeCommand, {
        requestId: "activity-task-123",
        requestIdFactory,
        retries: 0,
      }),
    ).resolves.toBe("activity-task-123");

    expect(requestIdFactory).not.toHaveBeenCalled();
    expect(invokeCommand).toHaveBeenCalledWith("refract_intent", {
      input: "hello",
      model: "mistral",
      requestId: "activity-task-123",
    });
  });

  it("creates one request ID and reuses it for every retry attempt", async () => {
    const attempts: Array<{ command: string; requestId: string }> = [];
    const requestIdFactory = vi.fn(() => "retry-request-123");
    const invokeCommand: RefractCommandInvoker = async (command, args) => {
      attempts.push({ command, requestId: args.requestId });
      if (attempts.length < 3) {
        throw {
          schema_version: 1,
          kind: "transport",
          backend: "ollama",
          request_id: args.requestId,
          retryable: true,
          message: "transport failed before dispatch",
        } satisfies RefractCommandFailure;
      }
      return "success";
    };

    await expect(
      refractIntentWithRetry("hello", "mistral", invokeCommand, {
        requestIdFactory,
        retries: 2,
        retryDelayMs: 0,
      }),
    ).resolves.toBe("success");

    expect(requestIdFactory).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([
      { command: "refract_intent", requestId: "retry-request-123" },
      { command: "refract_intent", requestId: "retry-request-123" },
      { command: "refract_intent", requestId: "retry-request-123" },
    ]);
  });

  it.each([
    "",
    "-starts-with-punctuation",
    "contains/slash",
    "contains space",
    "trailing-newline\n",
    "unicode-λ",
    "a".repeat(MAX_REFRACT_REQUEST_ID_BYTES + 1),
  ])("rejects invalid request ID %j before the first attempt", async (requestId) => {
    const invokeCommand = vi.fn<RefractCommandInvoker>();

    await expect(
      refractIntentWithRetry("hello", "mistral", invokeCommand, {
        requestIdFactory: () => requestId,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow("Invalid request ID");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each<RefractFailureKind>([
    "policy",
    "integrity",
    "unavailable",
    "cancelled",
  ])("native %s failure is not retried or routed to a legacy/Ollama command", async (kind) => {
    const commands: string[] = [];
    const legacyProcessIntent = vi.fn();
    const ollamaCommand = vi.fn();
    const failure: RefractCommandFailure = {
      schema_version: 1,
      kind,
      backend: "aivm_loopback",
      request_id: `native-${kind}`,
      // Even a malformed future producer cannot make a native semantic
      // failure retryable; backend + kind are both checked by the client.
      retryable: true,
      message: `native ${kind} stopped`,
    };
    const invokeCommand: RefractCommandInvoker = async (command) => {
      const observedCommand: string = command;
      commands.push(observedCommand);
      if (observedCommand === "process_intent") legacyProcessIntent();
      if (observedCommand.includes("ollama")) ollamaCommand();
      throw failure;
    };

    await expect(
      refractIntentWithRetry("hello", "exact-native-model", invokeCommand, {
        requestIdFactory: () => failure.request_id,
        retries: 5,
        retryDelayMs: 0,
      }),
    ).rejects.toEqual(failure);

    expect(commands).toEqual(["refract_intent"]);
    expect(legacyProcessIntent).not.toHaveBeenCalled();
    expect(ollamaCommand).not.toHaveBeenCalled();
  });
});

describe("useChat native activation safety", () => {
  it("routes plain PPT wording to file generation and never to refract_intent", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "check_local_inference_status") return true;
      if (command === "generate_document_spec") {
        return JSON.stringify({
          title: "SAP PI upgrade planning deck",
          subtitle: "NetWeaver 7.5 SP27 to SP34 — verification-first draft",
          slides: [
            { title: "Required inputs and assumptions", bullets: ["Confirm the actual landscape."] },
            { title: "Official-source verification gates", bullets: ["Verify in SAP Maintenance Planner and the current SUM guide."] },
            { title: "Regression test matrix", bullets: ["Test the inventoried interfaces after rehearsal."] },
            { title: "Rollback and recovery", bullets: ["Define and rehearse the restore decision."] },
          ],
          decision_record: ["Version-specific facts require independent verification against approved official sources."],
        });
      }
      if (command === "create_powerpoint") {
        return JSON.stringify({
          path: "/mock/Downloads/SAP-PI-upgrade.pptx",
          filename: "SAP-PI-upgrade.pptx",
          kind: "pptx",
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { result, unmount } = renderHook(() => useChat({
      settings: { ...DEFAULT_SETTINGS },
      onIntentProcessed: vi.fn(),
      clearLiveSteps: vi.fn(),
      voiceEnabled: false,
      voiceSpeak: vi.fn(),
      refreshSuggestions: vi.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.handleIntent(
        "Create a PPT for SAP PI upgrade from netweaver 7.5 SP27 to SP34",
      );
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toContain("generate_document_spec");
    expect(commands).toContain("create_powerpoint");
    expect(commands).not.toContain("refract_intent");
    expect(result.current.messages[result.current.messages.length - 1]?.attachment?.filename).toBe(
      "SAP-PI-upgrade.pptx",
    );

    unmount();
  });

  it("does not speak, reinforce, suggest from, or refract an unvalidated response", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "refract_intent") {
        return JSON.stringify({
          response: "I stopped this draft because it did not pass the quality release gate.",
          intent: { raw: "SAP upgrade runbook", intent_type: "Create", entities: [], confidence: 1 },
          agent_used: "orchestrator",
          context_nodes: [],
          edges_reinforced: [],
          anticipations: [],
          processing_time_ms: 10,
          simd_accelerated: false,
          collaboration: {
            session_id: "session",
            phase: "completed",
            pipeline_trace: [],
            consensus_approved: false,
            consensus_summary: "Quality gate rejected",
            vote_count: 5,
            approve_count: 3,
            reject_count: 2,
            message_count: 1,
            debate: null,
          },
          conversation_id: null,
          validated: false,
          judge_graded: true,
          iterations_used: 2,
          max_iterations: 3,
          judge_score: 0.6,
          judge_summary: "needs work",
          deficiencies: ["Missing authoritative sources"],
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const voiceSpeak = vi.fn();
    const refreshSuggestions = vi.fn(async () => undefined);
    const onIntentProcessed = vi.fn();
    const { result, unmount } = renderHook(() => useChat({
      settings: { ...DEFAULT_SETTINGS },
      onIntentProcessed,
      clearLiveSteps: vi.fn(),
      voiceEnabled: true,
      voiceSpeak,
      refreshSuggestions,
    }));

    await act(async () => {
      await result.current.handleIntent("SAP upgrade runbook");
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("strengthen_related_edges");
    expect(commands).not.toContain("generate_refraction_alternative");
    expect(voiceSpeak).not.toHaveBeenCalled();
    expect(refreshSuggestions).not.toHaveBeenCalled();
    expect(onIntentProcessed).toHaveBeenCalledWith(
      "orchestrator",
      expect.any(Object),
      null,
      expect.objectContaining({
        context_node_ids: [],
        reinforced_edge_ids: [],
        validated: false,
      }),
    );
    expect(result.current.messages[result.current.messages.length - 1]?.content).toContain(
      "quality release gate",
    );

    unmount();
  });

  it("releases the composer before optional post-response enrichment finishes", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "strengthen_related_edges") return undefined;
      if (command === "generate_refraction_alternative") {
        return JSON.stringify({
          band: "blue",
          band_label: "Analytical",
          band_emoji: "🔵",
          response: "Another perspective",
        });
      }
      if (command === "refract_intent") {
        return JSON.stringify({
          response: "Released answer",
          intent: { raw: "hello", intent_type: "Query", entities: [], confidence: 1 },
          agent_used: "reasoner",
          context_nodes: [],
          edges_reinforced: [],
          anticipations: [],
          processing_time_ms: 20,
          simd_accelerated: false,
          collaboration: {
            session_id: "session",
            phase: "completed",
            pipeline_trace: [],
            consensus_approved: true,
            consensus_summary: "approved",
            vote_count: 5,
            approve_count: 5,
            reject_count: 0,
            message_count: 1,
            debate: null,
          },
          conversation_id: "conversation",
          validated: true,
          judge_graded: true,
          iterations_used: 1,
          max_iterations: 2,
          judge_score: 0.95,
          judge_summary: "accepted",
          deficiencies: [],
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    let releaseSuggestions!: () => void;
    const refreshSuggestions = vi.fn(
      () => new Promise<void>((resolve) => { releaseSuggestions = resolve; }),
    );
    const { result, unmount } = renderHook(() => useChat({
      settings: { ...DEFAULT_SETTINGS },
      onIntentProcessed: vi.fn(),
      clearLiveSteps: vi.fn(),
      voiceEnabled: false,
      voiceSpeak: vi.fn(),
      refreshSuggestions,
    }));

    await act(async () => {
      await result.current.handleIntent("hello");
    });

    expect(result.current.messages.at(-1)?.content).toContain("Released answer");
    expect(result.current.isProcessing).toBe(false);
    expect(refreshSuggestions).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseSuggestions();
      await Promise.resolve();
    });
    unmount();
  });

  it("keeps one-off document analysis ephemeral and never invokes graph persistence", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "check_local_inference_status") return true;
      if (command === "rag_query") {
        return JSON.stringify({
          context: "bounded private meeting context",
          chunks_used: 1,
          total_chunks: 2,
          source: "meeting.txt",
          rag_used: true,
        });
      }
      if (command === "analyze_document_context") return "Ephemeral summary";
      throw new Error(`unexpected command: ${command}`);
    });

    const onIntentProcessed = vi.fn();
    const { result, unmount } = renderHook(() => useChat({
      settings: { ...DEFAULT_SETTINGS },
      onIntentProcessed,
      clearLiveSteps: vi.fn(),
      voiceEnabled: false,
      voiceSpeak: vi.fn(),
      refreshSuggestions: vi.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.handleIntent(
        "Summarize the decisions",
        undefined,
        "[File: meeting.txt]\nprivate trend data",
      );
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toContain("rag_query");
    expect(commands).toContain("analyze_document_context");
    expect(commands).not.toContain("index_document_chunks");
    expect(commands).not.toContain("add_spectrum_node");
    expect(commands).not.toContain("persist_graph");
    expect(commands).not.toContain("save_state");
    expect(result.current.messages[result.current.messages.length - 1]?.content).toContain(
      "ephemeral attachment",
    );
    expect(onIntentProcessed).toHaveBeenCalledWith("Document Analyst");

    unmount();
  });

  it("fails closed before image bytes are sent when no installed vision model is available", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "check_local_inference_status") return true;
      if (command === "smart_route_model") {
        return JSON.stringify({
          model: DEFAULT_SETTINGS.defaultModel,
          auto_swapped: false,
          original_model: DEFAULT_SETTINGS.defaultModel,
          reason: "No installed vision-capable model is available.",
          is_vision: false,
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { result, unmount } = renderHook(() => useChat({
      settings: { ...DEFAULT_SETTINGS },
      onIntentProcessed: vi.fn(),
      clearLiveSteps: vi.fn(),
      voiceEnabled: false,
      voiceSpeak: vi.fn(),
      refreshSuggestions: vi.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.handleIntent("Describe this image", "aW1hZ2U=");
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toContain("smart_route_model");
    expect(commands).not.toContain("query_ollama_vision");
    expect(result.current.messages[result.current.messages.length - 1]?.content).toContain(
      "No installed vision-capable model",
    );

    unmount();
  });

  it.each<RefractFailureKind>([
    "policy",
    "integrity",
    "unavailable",
    "cancelled",
  ])("native %s failure stops at the Tauri command boundary", async (kind) => {
    const failure: RefractCommandFailure = {
      schema_version: 1,
      kind,
      backend: "aivm_loopback",
      request_id: `native-${kind}`,
      retryable: true,
      message: `native ${kind} stopped`,
    };
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "search_spectrum_nodes") return "[]";
      if (command === "refract_intent") throw JSON.stringify(failure);
      throw new Error(`unexpected command: ${command}`);
    });

    const { result, unmount } = renderHook(() => useChat({
      settings: { ...DEFAULT_SETTINGS },
      onIntentProcessed: vi.fn(),
      clearLiveSteps: vi.fn(),
      voiceEnabled: false,
      voiceSpeak: vi.fn(),
      refreshSuggestions: vi.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.handleIntent("hello");
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands.filter((command) => command === "refract_intent")).toHaveLength(1);
    expect(commands).not.toContain("process_intent");
    expect(commands).not.toContain("process_intent_full");
    expect(commands.some((command) => String(command).includes("ollama"))).toBe(false);
    expect(result.current.messages[result.current.messages.length - 1]?.content).toContain(
      "No second legacy or Ollama text-inference attempt",
    );
    expect(result.current.messages[result.current.messages.length - 1]?.content).toContain(
      "Earlier embedding or retrieval work may already have used",
    );

    unmount();
  });
});
