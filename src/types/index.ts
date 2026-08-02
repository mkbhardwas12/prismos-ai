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
export type WorkflowRoleId =
  | "orchestrator"
  | "reasoner"
  | "tool_smith"
  | "memory_keeper"
  | "sentinel";

export type WorkflowLane = "general" | "reasoning" | "code";

export type WorkflowVoteBasis =
  | "workflow_complete"
  | "critic_accepted"
  | "best_available"
  | "single_pass"
  | "action_policy_clear"
  | "action_policy_blocked"
  | "context_available"
  | "fresh_context"
  | "safety_policy_clear"
  | "safety_policy_veto";

/**
 * Structured, presentation-safe decision facts. This union deliberately has no
 * prompt, candidate, message-content, path, identifier, or hidden-reasoning field.
 */
export type WorkflowDecision =
  | {
      kind: "work_plan";
      query_type: "query" | "create" | "analyze" | "connect" | "system";
      unit_count: number;
      roles: WorkflowRoleId[];
      context_count: number;
    }
  | {
      kind: "routing";
      lane: WorkflowLane;
      auto_swapped: boolean;
      reason_code: "configured_model" | "capability_match" | "requested_model_kept";
    }
  | {
      kind: "criteria";
      source: "model" | "deterministic";
      checks: string[];
    }
  | {
      kind: "judge";
      attempt: number;
      graded: boolean;
      passed: boolean;
      score_pct: number;
      limitations: string[];
    }
  | {
      kind: "review_summary";
      rounds: number;
      trace_items: number;
      resolved: boolean;
      agreement_pct: number;
    }
  | {
      kind: "policy_check";
      gate: "answer_candidate" | "final_review";
      passed: boolean;
      concern_count: number;
    }
  | {
      kind: "vote";
      role: WorkflowRoleId;
      approved: boolean;
      confidence_pct: number;
      basis: WorkflowVoteBasis;
    }
  | {
      kind: "consensus";
      approved: boolean;
      approve_count: number;
      reject_count: number;
      total: number;
      sentinel_required: true;
    }
  | {
      kind: "persistence";
      succeeded: boolean;
      edge_count: number;
      conversation_stored: boolean;
    }
  | {
      kind: "finalization";
      approved: boolean;
      validated: boolean;
      attempts_used: number;
      max_attempts: number;
    };

export interface AgentActivity {
  /** Versioned, presentation-safe activity envelope. */
  schema_version: 1;
  /** Opaque logical request/scan identity used to reject stale events. */
  task_id: string;
  agent: string;
  action: string;
  /** Legacy `thinking` and project-review `started` both mean active. */
  status: "started" | "thinking" | "completed" | "failed";
  /** "orchestrate" | "plan" | "analyze" | "build" | "judge" | "refine" | "debate" | "review" | "vote" | "execute" */
  phase: string;
  /** Goal-loop attempt this event belongs to (0 = not part of an iteration). */
  iteration?: number;
  /** Monotonic time since the logical task began. */
  elapsed_ms: number;
  /** Optional safe projection of the decision made at this update. */
  decision?: WorkflowDecision;
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
  simd_accelerated: boolean;
  collaboration?: CollaborationSummary;
  conversation_id?: string;
  /** Requested/reported Reasoner identity plus explicit attestation and receipt facts. */
  inference?: InferenceMetadata;
  // Intent Transparency
  query_type?: string;
  natural_band?: string;
  applied_band?: string;
  domain_detected?: string;
  // ── Goal-loop provenance (plan → build → judge → refine) ──
  /** How many BUILD→JUDGE attempts ran this turn. */
  iterations_used?: number;
  /** The iteration budget for this turn. */
  max_iterations?: number;
  /** True only when a real LLM judge accepted the final answer against the criteria. */
  validated?: boolean;
  /** Final judge score in [0,1]. */
  judge_score?: number;
  /** True only when a valid model-critic verdict produced the final grade. */
  judge_graded?: boolean;
  /** Bounded verdict/fallback summary; never hidden chain-of-thought. */
  judge_summary?: string;
  /** Legacy compatibility field; the current runtime intentionally does not populate hidden model reasoning. */
  reasoning_trace?: string;
  /** The acceptance criteria the answer was judged against. */
  acceptance_criteria?: string[];
  /** Remaining deficiencies when the loop ended unvalidated. */
  deficiencies?: string[];
}

export type TextBackend = "ollama" | "aivm_loopback";
export type InferenceClientRoute = "unverified_local_endpoint" | "verified_loopback" | "non_local";
export type InferenceExecutionRoute = "device_local" | "non_local";
export type InferenceFinishReason = "stop" | "length";

export interface InferenceTarget {
  backend: TextBackend;
  model_id: string;
}

export interface ExecutionIdentity {
  backend: TextBackend;
  engine_id: string;
  runtime_id?: string | null;
  model_id: string;
  identity_attested: boolean;
}

export interface InferenceReceipt {
  receipt_id: string;
  receipt_digest: string;
  request_id: string;
  engine_id: string;
  runtime_id: string;
  model_id: string;
  finish_reason: InferenceFinishReason;
  execution_route: InferenceExecutionRoute;
  local_only: boolean;
  egress_bytes: number;
  verified: boolean;
}

export interface InferenceMetadata {
  request_id: string;
  requested: InferenceTarget;
  actual: ExecutionIdentity;
  /** PrismOS-to-daemon hop only; loopback is not an offline attestation. */
  client_route: InferenceClientRoute;
  local_only_requested: boolean;
  backend_offline_attested: boolean;
  duration_ms: number;
  finish_reason?: InferenceFinishReason | null;
  receipt?: InferenceReceipt | null;
}

// ─── Sequential workflow compatibility types ───────────────────────────────────

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
  /** Intent transparency — what the system detected about this message */
  transparency?: IntentTransparency;
  /** Generated file (Word/PowerPoint) attached to this response */
  attachment?: GeneratedAttachment;
  /** Project review awaiting approval (Gate 1) — renders Approve/Decline card */
  reviewRequest?: ReviewRequest;
}

/** A pending project-review scan shown for human approval */
export interface ReviewRequest {
  scanId: string;
  root: string;
  projectName: string;
  totalFiles: number;
  candidateFiles: number;
  totalCandidateBytes: number;
  llmFiles: number;
  skippedDirs: string[];
  topExtensions: [string, number][];
  truncated: boolean;
  status: "pending" | "approved" | "declined";
}

/** A file generated locally (Word/PowerPoint) and saved to disk */
export interface GeneratedAttachment {
  path: string;
  filename: string;
  kind: "docx" | "pptx";
}

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
  /** Legacy name: policy checks ran; this does not attest process/WASM isolation. */
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

// ─── Graph Merge/Diff Types (Multi-Device Sync) ───────────

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

// ─── New Feature Types ─────────────────────────────────────

/** Intent Transparency — what the system detected about a user message */
export interface IntentTransparency {
  query_type: string;
  natural_band: string;
  applied_band: string;
  context_nodes_used: number;
  model_used: string;
  domain_detected: string;
}

/** Cognitive Drift — weekly profile change tracking */
export interface CognitiveDrift {
  current: CognitiveProfile;
  previous: CognitiveProfile | null;
  deltas: CognitiveDeltaSet;
  summary: string;
  weeks_compared: number;
}

export interface CognitiveDeltaSet {
  depth: number;
  creativity: number;
  formality: number;
  technical_level: number;
  example_preference: number;
}

/** Thought Current — temporal pattern in intent history */
export interface ThoughtCurrent {
  pattern_type: string;
  description: string;
  confidence: number;
  related_intents: string[];
}

/** Heuristic candidate edge; legacy prediction-shaped wire type. */
export interface PredictedEdge {
  source_id: string;
  target_id: string;
  source_label: string;
  target_label: string;
  probability: number;
  reason: string;
  evidence_type: string;
}

/** Refraction Insights — aggregated band usage statistics */
export interface RefractionInsights {
  total_refractions: number;
  band_distribution: Record<string, number>;
  band_by_query_type: Record<string, Record<string, number>>;
  blind_spots: string[];
  growth_score: number;
  insights: string[];
}

/** Legacy wire name for a coarse, heuristic query-topic mix; never credentials or expertise. */
export interface DomainProfile {
  domain_counts: Record<string, number>;
  total_queries: number;
  primary_domain: string;
  confidence: number;
  last_updated: string;
}

/** Heuristic model suggestion based on bounded local performance history. */
export interface ModelRecommendation {
  domain: string;
  recommended_model: string;
  avg_latency_ms: number;
  satisfaction_rate: number;
  sample_count: number;
  comparison: string | null;
}

/** System hardware info used for static, heuristic model-fit suggestions. */
export interface SystemInfo {
  total_ram_gb: number;
  available_ram_gb: number;
  cpu_count: number;
  os: string;
  arch: string;
}

// ─── Brain Wrapped™ + Cognitive Fingerprint™ ──────────────

/** Deterministic visual signature of a cognitive profile. */
export interface CognitiveFingerprint {
  hash: string;
  palette: string[];
  shape_points: [number, number][];
  rotation: number;
  archetype: string;
  archetype_tagline: string;
  seed: number;
}

export interface AxisLabels {
  depth: string;
  creativity: string;
  formality: string;
  technical_level: string;
  example_preference: string;
}

export interface CurrentSummary {
  theme: string;
  frequency: number;
  momentum: "rising" | "steady" | "fading";
}

export interface RefractionSummary {
  dominant_band: string;
  dominant_pct: number;
  blind_spot: string | null;
  growth_score: number;
}

export interface LifetimeStats {
  total_intents: number;
  total_nodes: number;
  total_edges: number;
  days_active: number;
  interactions: number;
  favorite_archetype_phrase: string;
}

/** Complete Brain Wrapped snapshot — feeds the animated story UI. */
export interface BrainSnapshot {
  fingerprint: CognitiveFingerprint;
  profile: CognitiveProfile;
  axis_labels: AxisLabels;
  drift: CognitiveDrift | null;
  evolution_summary: string;
  top_currents: CurrentSummary[];
  prophecy_count: number;
  top_prophecies: PredictedEdge[];
  refraction: RefractionSummary | null;
  stats: LifetimeStats;
  generated_at: string;
  schema_version: number;
}

/** Heuristic response-preference vector similarity (legacy API terminology). */
export interface CompatibilityScore {
  score: number;
  axis_distances: CognitiveDeltaSet;
  interpretation: string;
  shared_archetype: boolean;
}
