// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS — Type Definitions

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "Idle" | "Processing" | "Waiting" | "Error";
  description: string;
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
}

export interface TraceSummary {
  agent: string;
  action: string;
  status: string;
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
}

export interface AppSettings {
  ollamaUrl: string;
  defaultModel: string;
  theme: "dark" | "light";
  maxTokens: number;
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
