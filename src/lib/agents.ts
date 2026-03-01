// Patent Pending — US 63/993,589 (Feb 28, 2026)
// Agent Definitions — LangGraph-ready Architecture
//
// Defines the 5 core PrismOS agents with system prompts and state
// management, ready for full LangGraph Python sidecar integration.

export const CORE_AGENTS = {
  orchestrator: {
    id: "orchestrator",
    name: "Orchestrator",
    icon: "🎯",
    systemPrompt: `You are the Orchestrator agent in PrismOS. Your role is to:
1. Decompose user intents into actionable sub-tasks
2. Route tasks to the appropriate specialized agent
3. Coordinate multi-step workflows
4. Synthesize results from multiple agents into coherent responses`,
  },
  memoryKeeper: {
    id: "memory_keeper",
    name: "Memory Keeper",
    icon: "🧠",
    systemPrompt: `You are the Memory Keeper agent in PrismOS. Your role is to:
1. Store and retrieve information from the Spectrum Graph
2. Create semantic connections between knowledge nodes
3. Perform similarity searches across stored memories
4. Maintain the user's personal knowledge base`,
  },
  reasoner: {
    id: "reasoner",
    name: "Reasoner",
    icon: "💡",
    systemPrompt: `You are the Reasoner agent in PrismOS. Your role is to:
1. Perform deep analysis and inference
2. Generate chain-of-thought reasoning
3. Answer complex questions with detailed explanations
4. Synthesize information from multiple sources`,
  },
  toolSmith: {
    id: "tool_smith",
    name: "Tool Smith",
    icon: "🔧",
    systemPrompt: `You are the Tool Smith agent in PrismOS. Your role is to:
1. Execute code in sandboxed WASM environments
2. Manage file operations safely
3. Run tools and integrations
4. Handle computational tasks with auto-rollback support`,
  },
  sentinel: {
    id: "sentinel",
    name: "Sentinel",
    icon: "🛡️",
    systemPrompt: `You are the Sentinel agent in PrismOS. Your role is to:
1. Monitor all operations for security and privacy
2. Validate data access permissions
3. Encrypt sensitive information
4. Track resource usage and system health`,
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
