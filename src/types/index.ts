// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — Type Definitions

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "Idle" | "Processing" | "Waiting" | "Error";
  description: string;
}

// ─── Live Agent Activity Event (Phase 2 — Collaborative Agents) ────────────────

/** Real-time event emitted from the Rust backend during LangGraph workflow execution */
export interface AgentActivity {
  agent: string;
  action: string;
  /** "started" | "thinking" | "completed" */
  status: string;
  /** "orchestrate" | "analyze" | "debate" | "review" | "vote" | "execute" */
  phase: string;
}

export interface SpectrumNode {
  id: string;
  label: string;
  content: string;
  node_type: string;
  layer: string;        // core | context | ephemeral
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
  connections: string[];
}

export interface SpectrumEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  momentum: number;
  reinforcements: number;
  last_reinforced: string;
  created_at: string;
}

export interface GraphStats {
  nodes: number;
  edges: number;
}

export interface GraphMetrics {
  node_count: number;
  edge_count: number;
  avg_edge_weight: number;
  strongest_edge_weight: number;
  facet_distribution: Record<string, number>;
  most_connected_node: string | null;
  graph_density: number;
}

export interface GraphSnapshot {
  nodes: SpectrumNode[];
  edges: SpectrumEdge[];
  stats: GraphMetrics;
}

export interface IntentQueryResult {
  node: SpectrumNode;
  relevance_score: number;
  path_strength: number;
  temporal_boost: number;
}

export interface AnticipatedNeed {
  suggestion: string;
  facet: string;
  confidence: number;
  related_nodes: string[];
  reasoning: string;
}

// ─── Proactive Suggestions (Phase 3 — Proactive Spectrum Graph) ────────────

/** A rich proactive suggestion card returned from the Spectrum Graph engine */
export interface ProactiveSuggestion {
  id: string;
  /** Short human-readable description of what was detected */
  text: string;
  /** Full intent string sent when the user clicks the card */
  action_intent: string;
  /** Emoji icon for the card */
  icon: string;
  /** Category: "momentum" | "patterns" | "connections" | "habits" */
  category: string;
  /** 0.0–1.0 confidence score */
  confidence: number;
}

export interface RefractiveResult {
  response: string;
  intent: ParsedIntent;
  agent_used: string;
  context_nodes: string[];
  edges_reinforced: string[];
  anticipations: string[];
  processing_time_ms: number;
  npu_accelerated: boolean;
  collaboration?: CollaborationSummary;
  conversation_id?: string;
}

// ─── LangGraph Multi-Agent Collaboration Types ─────────────────────────────────

export interface CollaborationSummary {
  session_id: string;
  phase: string;
  pipeline_trace: TraceSummary[];
  consensus_approved: boolean;
  consensus_summary: string;
  vote_count: number;
  approve_count: number;
  reject_count: number;
  message_count: number;
  debate: DebateSummary | null;
}

export interface TraceSummary {
  agent: string;
  action: string;
  status: string;
}

// ─── LangGraph Workflow & Debate Types ─────────────────────────────────────────

export interface WorkflowSummary {
  workflow_id: string;
  status: string;
  current_node: string;
  transitions: TransitionSummary[];
  debate_summary: DebateSummary | null;
  consensus_approved: boolean;
  consensus_summary: string;
  vote_count: number;
  approve_count: number;
  reject_count: number;
  message_count: number;
  total_arguments: number;
  agreement_score: number;
}

export interface TransitionSummary {
  from: string;
  to: string;
  label: string;
  duration_ms: number;
}

export interface DebateSummary {
  rounds: number;
  total_arguments: number;
  positions: number;
  challenges: number;
  rebuttals: number;
  supports: number;
  agreement_score: number;
  resolved: boolean;
  arguments: ArgumentSummary[];
}

export interface ArgumentSummary {
  agent: string;
  argument_type: string;
  target: string | null;
  content: string;
  confidence: number;
}

export interface StateGraphNode {
  id: string;
  node_type: string;
  agent: string | null;
  description: string;
}

export interface StateGraphEdge {
  from: string;
  to: string;
  condition: string | null;
  label: string;
}

export interface StateGraph {
  id: string;
  name: string;
  nodes: StateGraphNode[];
  edges: StateGraphEdge[];
  entry_node: string;
}

export interface ParsedIntent {
  raw: string;
  intent_type: string;
  entities: string[];
  confidence: number;
}

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface Message {
  id: string;
  role: "user" | "ai" | "system";
  content: string;
  timestamp: Date;
  agent?: string;
  /** User feedback: 'good' (👍) or 'bad' (👎) */
  feedback?: "good" | "bad";
  /** Context node IDs used for this response (for feedback linkage) */
  contextNodes?: string[];
  /** Conversation ID from Spectrum Graph (for feedback linkage) */
  conversationId?: string;
  /** Original user question that triggered this response */
  userQuestion?: string;
  /** Refraction alternative — a different perspective on the same question */
  refractionAlternative?: RefractionAlternative;
}

/** A refraction alternative — a different reasoning perspective on the same question */
export interface RefractionAlternative {
  band: string;
  band_label: string;
  band_emoji: string;
  response: string;
}

/** Cognitive profile — how the AI adapts to your thinking style */
export interface CognitiveProfile {
  depth: number;
  creativity: number;
  formality: number;
  technical_level: number;
  example_preference: number;
  interaction_count: number;
  last_updated: string;
}

export interface AppSettings {
  ollamaUrl: string;
  defaultModel: string;
  theme: "dark" | "light";
  maxTokens: number;
  voiceInputEnabled: boolean;
  voiceOutputEnabled: boolean;
  emailSummaryEnabled: boolean;
  calendarEnabled: boolean;
  financeEnabled: boolean;
  defaultView: string;
}

export interface Prism {
  id: string;
  name: string;
  status: string;
  created_at: string;
  checkpoints: Checkpoint[];
  side_effects: SideEffect[];
  action_log: SignedAction[];
  agent_id: string;
  wasm_config: WasmIsolationConfig | null;
}

export interface WasmIsolationConfig {
  max_memory_pages: number;
  max_fuel: number;
  max_execution_time_ms: number;
  risk_tier: number;
}

export interface Checkpoint {
  id: string;
  prism_id: string;
  state_hash: string;
  created_at: string;
}

export interface SideEffect {
  effect_type: string;
  description: string;
  reversible: boolean;
}

export interface SignedAction {
  action_id: string;
  agent_id: string;
  action: string;
  operation: string;
  risk_tier: number;
  hmac_signature: string;
  timestamp: string;
  verdict: "Approved" | "Denied" | "RolledBack";
}

export interface PrismResult {
  success: boolean;
  output: string;
  side_effects: SideEffect[];
  sandbox_protected: boolean;
  action_signature: string;
  rollback_explanation: string | null;
  wasm_isolated: boolean;
  wasm_fuel_consumed: number | null;
  wasm_memory_limit_bytes: number | null;
}

export interface SandboxVerdict {
  allowed: boolean;
  operation: string | null;
  risk_tier: number;
  signature: string;
  explanation: string;
}

export interface YouPortPackage {
  id: string;
  created_at: string;
  payload: string;
  checksum: string;
  version: string;
  format: string;
}

// ─── You-Port Encrypted Handoff Types ──────────────────────────────────────────

export interface HandoffResult {
  success: boolean;
  message: string;
  nodes_count: number;
  edges_count: number;
  timestamp: string;
}

export interface AgentState {
  agent_id: string;
  agent_name: string;
  status: string;
  last_active: string | null;
}

// ─── Graph Merge/Diff Types (Patent Pending — Multi-Device Sync) ───────────

export interface MergeConflict {
  entity_type: string;
  entity_id: string;
  field: string;
  local_value: string;
  remote_value: string;
  resolution: string;
  resolved_value: string;
}

export interface MergeDiff {
  nodes_only_local: number;
  nodes_only_remote: number;
  nodes_both: number;
  nodes_conflicted: number;
  edges_only_local: number;
  edges_only_remote: number;
  edges_both: number;
  edges_conflicted: number;
  conflicts: MergeConflict[];
}

export interface MergeResult {
  success: boolean;
  strategy: string;
  nodes_added: number;
  nodes_updated: number;
  nodes_skipped: number;
  edges_added: number;
  edges_updated: number;
  edges_skipped: number;
  conflicts_resolved: number;
  diff: MergeDiff;
  message: string;
}

export interface CrossDeviceMergeResult {
  success: boolean;
  message: string;
  merge_result: MergeResult;
  source_device: string;
  source_timestamp: string;
}
