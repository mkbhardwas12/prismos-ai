// Agent Definitions — LangGraph Workflow Architecture
//
// Defines five compatibility workflow roles used for deterministic trace and
// policy bookkeeping. Only explicitly routed Planner/Reasoner/Critic calls are
// model-backed; these role objects are not five independent parallel agents.

import { invoke } from "@tauri-apps/api/core";
import type { StateGraph, RefractiveResult } from "../types";

export const CORE_AGENTS = {
  orchestrator: {
    id: "orchestrator",
    name: "Orchestrator",
    icon: "🎯",
    debateRole: "coordinator",
    systemPrompt: `You are the Orchestrator agent in PrismOS-AI. Your role is to:
1. Decompose user intents into actionable sub-tasks
2. Route tasks to the appropriate specialized agent
3. Coordinate multi-step workflows
4. Synthesize results from multiple agents into coherent responses`,
  },
  memoryKeeper: {
    id: "memory_keeper",
    name: "Memory Keeper",
    icon: "🧠",
    debateRole: "evidence",
    systemPrompt: `You are the Memory Keeper agent in PrismOS-AI. Your role is to:
1. Store and retrieve information from the Spectrum Graph
2. Create semantic connections between knowledge nodes
3. Perform similarity searches across stored memories
4. Maintain the user's personal knowledge base`,
  },
  reasoner: {
    id: "reasoner",
    name: "Reasoner",
    icon: "💡",
    debateRole: "analysis",
    systemPrompt: `You are the Reasoner agent in PrismOS-AI. Your role is to:
1. Perform deep analysis and inference
2. Produce concise rationales, assumptions, and uncertainty—not hidden chain-of-thought
3. Answer complex questions with evidence-oriented explanations
4. Synthesize information from cited local sources`,
  },
  toolSmith: {
    id: "tool_smith",
    name: "Tool Smith",
    icon: "🔧",
    debateRole: "execution",
    systemPrompt: `You are the Tool Smith agent in PrismOS-AI. Your role is to:
1. Prepare bounded, schema-validated tool requests
2. Submit modeled actions to the per-agent allow-list policy
3. Describe intended and observed side effects honestly
4. Never claim arbitrary code isolation or generic rollback`,
  },
  sentinel: {
    id: "sentinel",
    name: "Sentinel",
    icon: "🛡️",
    debateRole: "security",
    systemPrompt: `You are the Sentinel agent in PrismOS-AI. Your role is to:
1. Monitor all operations for security and privacy
2. Validate data access permissions
3. Check declared local, network, and persistence boundaries
4. Track policy decisions and surface unresolved risk`,
  },
} as const;

// LangGraph-compatible state definition
export interface AgentState {
  messages: Array<{ role: string; content: string; agent?: string }>;
  currentAgent: string;
  taskQueue: string[];
  context: Record<string, unknown>;
  iteration: number;
  maxIterations: number;
}

export function createInitialState(userInput: string): AgentState {
  return {
    messages: [{ role: "user", content: userInput }],
    currentAgent: "orchestrator",
    taskQueue: [],
    context: {},
    iteration: 0,
    maxIterations: 10,
  };
}

// ─── LangGraph Workflow Bindings ───────────────────────────────────────────────

/** Run the bounded sequential workflow for an intent. */
export async function runCollaboration(input: string): Promise<RefractiveResult> {
  const json = await invoke<string>("run_collaboration", { input });
  return JSON.parse(json);
}

/** Get the LangGraph state graph definition for visualization */
export async function getWorkflowGraph(): Promise<StateGraph> {
  const json = await invoke<string>("get_workflow_graph");
  return JSON.parse(json);
}

/** Get the deterministic comparison trace from the most recent workflow. */
export async function getDebateLog(): Promise<unknown[]> {
  const json = await invoke<string>("get_debate_log");
  return JSON.parse(json);
}
