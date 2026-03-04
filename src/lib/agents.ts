// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Agent Definitions — LangGraph Workflow Architecture
//
// Defines the 5 core PrismOS-AI agents with system prompts, debate roles,
// and state management for the formal LangGraph state-graph workflow.

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
2. Generate chain-of-thought reasoning
3. Answer complex questions with detailed explanations
4. Synthesize information from multiple sources`,
  },
  toolSmith: {
    id: "tool_smith",
    name: "Tool Smith",
    icon: "🔧",
    debateRole: "execution",
    systemPrompt: `You are the Tool Smith agent in PrismOS-AI. Your role is to:
1. Execute code in sandboxed WASM environments
2. Manage file operations safely
3. Run tools and integrations
4. Handle computational tasks with auto-rollback support`,
  },
  sentinel: {
    id: "sentinel",
    name: "Sentinel",
    icon: "🛡️",
    debateRole: "security",
    systemPrompt: `You are the Sentinel agent in PrismOS-AI. Your role is to:
1. Monitor all operations for security and privacy
2. Validate data access permissions
3. Encrypt sensitive information
4. Track resource usage and system health`,
  },
  emailKeeper: {
    id: "email_keeper",
    name: "Email Keeper",
    icon: "📬",
    debateRole: "information",
    systemPrompt: `You are the Email Keeper agent in PrismOS-AI. Your role is to:
1. Connect to the user's IMAP mailbox in READ-ONLY mode
2. Fetch only envelope metadata (subject + sender — never email bodies)
3. Summarize unread emails locally via the Sandbox Prism
4. Never store, transmit, or log raw email content
5. Produce concise, actionable summaries for the Morning Brief`,
  },
  calendarKeeper: {
    id: "calendar_keeper",
    name: "Calendar Keeper",
    icon: "📅",
    debateRole: "scheduling",
    systemPrompt: `You are the Calendar Keeper agent in PrismOS-AI. Your role is to:
1. Parse local .ics (iCalendar) files in READ-ONLY mode
2. Extract today's events, detect scheduling conflicts
3. Suggest free time blocks for focused work
4. Never modify, delete, or transmit calendar files
5. Produce concise scheduling summaries for the Morning Brief`,
  },
  financeKeeper: {
    id: "finance_keeper",
    name: "Finance Keeper",
    icon: "💰",
    debateRole: "finance",
    systemPrompt: `You are the Finance Keeper agent in PrismOS-AI. Your role is to:
1. Fetch public market data for the user's ticker watchlist (READ-ONLY)
2. Summarize daily price changes, gainers, and losers
3. Identify notable market movements in tracked stocks
4. Never execute trades, access financial accounts, or store credentials
5. Produce concise portfolio summaries for the Morning Brief`,
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

/** Run a full LangGraph collaboration pipeline for an intent */
export async function runCollaboration(input: string): Promise<RefractiveResult> {
  const json = await invoke<string>("run_collaboration", { input });
  return JSON.parse(json);
}

/** Get the LangGraph state graph definition for visualization */
export async function getWorkflowGraph(): Promise<StateGraph> {
  const json = await invoke<string>("get_workflow_graph");
  return JSON.parse(json);
}

/** Get the debate log from the most recent collaboration */
export async function getDebateLog(): Promise<unknown[]> {
  const json = await invoke<string>("get_debate_log");
  return JSON.parse(json);
}
