import type {
  AgentActivity,
  WorkflowDecision,
  WorkflowLane,
  WorkflowRoleId,
  WorkflowVoteBasis,
} from "../types";

type VisibleActivityStatus = "active" | "completed" | "error";

export interface AgentActivityRecord {
  id: string;
  action: string;
  phase: string;
  phaseLabel: string;
  status: VisibleActivityStatus;
  statusLabel: string;
  iteration: number;
  elapsedMs: number;
  decision?: WorkflowDecision;
}

export interface AgentActivityRow extends AgentActivityRecord {
  key: string;
  agent: string;
  updateCount: number;
  history: AgentActivityRecord[];
}

const PHASE_LABELS: Record<string, string> = {
  orchestrate: "Coordination",
  plan: "Planning",
  analyze: "Context",
  build: "Drafting",
  judge: "Quality check",
  refine: "Refinement",
  debate: "Review",
  review: "Safety review",
  vote: "Decision",
  execute: "Finalization",
};

const ALLOWED_AGENTS = new Map([
  ["orchestrator", "Orchestrator"],
  ["planner", "Planner"],
  ["reasoner", "Reasoner"],
  ["critic", "Critic"],
  ["tool smith", "Tool Smith"],
  ["memory keeper", "Memory Keeper"],
  ["debate", "Debate"],
  ["sentinel", "Sentinel"],
  ["consensus", "Consensus"],
  ["sandbox prism", "Sandbox Prism"],
  ["code reviewer", "Code Reviewer"],
]);
const ALLOWED_PHASES = new Set(Object.keys(PHASE_LABELS));
const ALLOWED_STATUSES: Set<AgentActivity["status"]> = new Set([
  "started",
  "thinking",
  "completed",
  "failed",
]);
const ALLOWED_ROLES = new Set<WorkflowRoleId>([
  "orchestrator",
  "reasoner",
  "tool_smith",
  "memory_keeper",
  "sentinel",
]);
const ALLOWED_LANES = new Set<WorkflowLane>(["general", "reasoning", "code"]);
const ALLOWED_VOTE_BASES = new Set<WorkflowVoteBasis>([
  "workflow_complete",
  "critic_accepted",
  "best_available",
  "single_pass",
  "action_policy_clear",
  "action_policy_blocked",
  "context_available",
  "fresh_context",
  "safety_policy_clear",
  "safety_policy_veto",
]);

const UNSAFE_FORMATTING = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

function compactText(value: string, maxCharacters: number): string {
  const compact = value.replace(UNSAFE_FORMATTING, " ").replace(/\s+/g, " ").trim();
  const characters = Array.from(compact);
  return characters.length > maxCharacters
    ? `${characters.slice(0, Math.max(0, maxCharacters - 1)).join("")}…`
    : compact;
}

function finiteInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(input).every((key) => allowedKeys.has(key));
}

function looksLikeSecret(value: string): boolean {
  const lower = value.toLocaleLowerCase();
  if (lower.includes("-----begin") && lower.includes("private key")) return true;
  return value.split(/\s+/).some((word) => {
    const token = word.replace(/^[^a-z0-9_-]+|[^a-z0-9_-]+$/gi, "");
    return token.startsWith("sk-")
      || token.startsWith("ghp_")
      || token.startsWith("github_pat_")
      || token.startsWith("xoxb-")
      || token.startsWith("xoxp-")
      || (token.startsWith("AKIA") && token.length >= 16);
  });
}

function stringEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? value as T : null;
}

function safeDecisionTextList(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const safe = looksLikeSecret(entry) ? "[Sensitive detail omitted]" : compactText(entry, 240);
    if (!safe) return null;
    result.push(safe);
  }
  return result;
}

function safeRoleList(value: unknown): WorkflowRoleId[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const roles = value.map((entry) => stringEnum(entry, ALLOWED_ROLES));
  return roles.every((role): role is WorkflowRoleId => role !== null) ? roles : null;
}

/** Strictly parse the tagged decision union received across IPC. */
export function normalizeWorkflowDecision(value: unknown): WorkflowDecision | undefined {
  const input = objectValue(value);
  if (!input || typeof input.kind !== "string") return undefined;

  switch (input.kind) {
    case "work_plan": {
      if (!hasOnlyKeys(input, ["kind", "query_type", "unit_count", "roles", "context_count"])) return undefined;
      const queryType = stringEnum(input.query_type, new Set(["query", "create", "analyze", "connect", "system"] as const));
      const unitCount = finiteInteger(input.unit_count, 0, 12);
      const roles = safeRoleList(input.roles);
      const contextCount = finiteInteger(input.context_count, 0, 100_000);
      if (!queryType || unitCount === null || !roles || contextCount === null) return undefined;
      return { kind: "work_plan", query_type: queryType, unit_count: unitCount, roles, context_count: contextCount };
    }
    case "routing": {
      if (!hasOnlyKeys(input, ["kind", "lane", "auto_swapped", "basis"])) return undefined;
      const lane = stringEnum(input.lane, ALLOWED_LANES);
      const basis = stringEnum(input.basis, new Set(["configured_model", "capability_match", "requested_model_kept"] as const));
      if (!lane || typeof input.auto_swapped !== "boolean" || !basis) return undefined;
      return { kind: "routing", lane, auto_swapped: input.auto_swapped, basis };
    }
    case "criteria": {
      if (!hasOnlyKeys(input, ["kind", "source", "checks"])) return undefined;
      const source = stringEnum(input.source, new Set(["model", "deterministic"] as const));
      const checks = safeDecisionTextList(input.checks, 6);
      if (!source || !checks) return undefined;
      return { kind: "criteria", source, checks };
    }
    case "judge": {
      if (!hasOnlyKeys(input, ["kind", "attempt", "graded", "passed", "score_pct", "limitations"])) return undefined;
      const attempt = finiteInteger(input.attempt, 1, 12);
      const scorePct = finiteInteger(input.score_pct, 0, 100);
      const limitations = safeDecisionTextList(input.limitations, 8);
      if (attempt === null || scorePct === null || !limitations || typeof input.graded !== "boolean" || typeof input.passed !== "boolean") return undefined;
      return { kind: "judge", attempt, graded: input.graded, passed: input.passed, score_pct: scorePct, limitations };
    }
    case "review_summary": {
      if (!hasOnlyKeys(input, ["kind", "rounds", "trace_items", "resolved", "agreement_pct"])) return undefined;
      const rounds = finiteInteger(input.rounds, 0, 12);
      const traceItems = finiteInteger(input.trace_items, 0, 64);
      const agreementPct = finiteInteger(input.agreement_pct, 0, 100);
      if (rounds === null || traceItems === null || agreementPct === null || typeof input.resolved !== "boolean") return undefined;
      return { kind: "review_summary", rounds, trace_items: traceItems, resolved: input.resolved, agreement_pct: agreementPct };
    }
    case "policy_check": {
      if (!hasOnlyKeys(input, ["kind", "gate", "passed", "concern_count"])) return undefined;
      const gate = stringEnum(input.gate, new Set(["answer_candidate", "final_review"] as const));
      const concernCount = finiteInteger(input.concern_count, 0, 64);
      if (!gate || concernCount === null || typeof input.passed !== "boolean") return undefined;
      return { kind: "policy_check", gate, passed: input.passed, concern_count: concernCount };
    }
    case "vote": {
      if (!hasOnlyKeys(input, ["kind", "role", "approved", "confidence_pct", "basis"])) return undefined;
      const role = stringEnum(input.role, ALLOWED_ROLES);
      const confidencePct = finiteInteger(input.confidence_pct, 0, 100);
      const basis = stringEnum(input.basis, ALLOWED_VOTE_BASES);
      if (!role || confidencePct === null || !basis || typeof input.approved !== "boolean") return undefined;
      return { kind: "vote", role, approved: input.approved, confidence_pct: confidencePct, basis };
    }
    case "consensus": {
      if (!hasOnlyKeys(input, ["kind", "approved", "approve_count", "reject_count", "total", "sentinel_required"])) return undefined;
      const approveCount = finiteInteger(input.approve_count, 0, 12);
      const rejectCount = finiteInteger(input.reject_count, 0, 12);
      const total = finiteInteger(input.total, 0, 12);
      if (approveCount === null || rejectCount === null || total === null || typeof input.approved !== "boolean" || input.sentinel_required !== true) return undefined;
      if (approveCount + rejectCount !== total) return undefined;
      return { kind: "consensus", approved: input.approved, approve_count: approveCount, reject_count: rejectCount, total, sentinel_required: true };
    }
    case "persistence": {
      if (!hasOnlyKeys(input, ["kind", "succeeded", "edge_count", "conversation_stored"])) return undefined;
      const edgeCount = finiteInteger(input.edge_count, 0, 100_000);
      if (edgeCount === null || typeof input.succeeded !== "boolean" || typeof input.conversation_stored !== "boolean") return undefined;
      return { kind: "persistence", succeeded: input.succeeded, edge_count: edgeCount, conversation_stored: input.conversation_stored };
    }
    case "finalization": {
      if (!hasOnlyKeys(input, ["kind", "approved", "validated", "attempts_used", "max_attempts"])) return undefined;
      const attemptsUsed = finiteInteger(input.attempts_used, 0, 12);
      const maxAttempts = finiteInteger(input.max_attempts, 1, 12);
      if (attemptsUsed === null || maxAttempts === null || typeof input.approved !== "boolean" || typeof input.validated !== "boolean") return undefined;
      return { kind: "finalization", approved: input.approved, validated: input.validated, attempts_used: attemptsUsed, max_attempts: maxAttempts };
    }
    default:
      return undefined;
  }
}

/** Runtime validation for untrusted Tauri event payloads. */
export function normalizeAgentActivity(value: unknown): AgentActivity | null {
  const input = objectValue(value);
  if (!input || input.schema_version !== 1) return null;
  if (!hasOnlyKeys(input, ["schema_version", "task_id", "agent", "action", "status", "phase", "iteration", "elapsed_ms", "decision"])) return null;
  if (typeof input.task_id !== "string" || typeof input.agent !== "string" || typeof input.action !== "string") return null;
  const phase = stringEnum(input.phase, ALLOWED_PHASES);
  const status = stringEnum(input.status, ALLOWED_STATUSES);
  const taskId = compactText(input.task_id, 160);
  const normalizedAgent = compactText(input.agent, 48);
  const agent = ALLOWED_AGENTS.get(normalizedAgent.toLocaleLowerCase());
  const action = compactText(input.action, 180);
  const iteration = input.iteration === undefined ? 0 : finiteInteger(input.iteration, 0, 12);
  const elapsedMs = finiteInteger(input.elapsed_ms, 0, 86_400_000);
  if (!phase || !status || !taskId || !agent || !action || iteration === null || elapsedMs === null) return null;

  const decision = input.decision === undefined ? undefined : normalizeWorkflowDecision(input.decision);
  if (input.decision !== undefined && !decision) return null;

  return {
    schema_version: 1,
    task_id: taskId,
    agent,
    action,
    status,
    phase,
    iteration,
    elapsed_ms: elapsedMs,
    ...(decision ? { decision } : {}),
  };
}

function activityKey(agent: string): string {
  const normalized = agent.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "workflow";
}

function visibleStatus(status: string): VisibleActivityStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "error";
  return "active";
}

function statusLabel(status: VisibleActivityStatus): string {
  if (status === "completed") return "Done";
  if (status === "error") return "Needs attention";
  return "Working";
}

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? "Workflow";
}

export function elapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `T+${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `T+${minutes}m ${seconds}s`;
}

export function safeActivityText(action: string, phase: string): string {
  const compact = compactText(action, 180);
  return compact || `${phaseLabel(phase)} in progress`;
}

/** Preserve a chronological, sanitized history while retaining one latest row per role. */
export function summarizeAgentActivities(steps: AgentActivity[]): AgentActivityRow[] {
  const rows = new Map<string, AgentActivityRow>();

  for (const [sequence, rawStep] of steps.entries()) {
    const step = normalizeAgentActivity(rawStep);
    if (!step) continue;
    const key = activityKey(step.agent);
    const previous = rows.get(key);
    const status = visibleStatus(step.status);
    const record: AgentActivityRecord = {
      id: `${key}-${sequence}`,
      action: safeActivityText(step.action, step.phase),
      phase: step.phase,
      phaseLabel: phaseLabel(step.phase),
      status,
      statusLabel: statusLabel(status),
      iteration: step.iteration ?? 0,
      elapsedMs: step.elapsed_ms,
      ...(step.decision ? { decision: step.decision } : {}),
    };
    const fingerprint = JSON.stringify({
      action: record.action,
      phase: record.phase,
      status: record.status,
      iteration: record.iteration,
      decision: record.decision,
    });
    const previousRecord = previous?.history[previous.history.length - 1];
    const previousFingerprint = previousRecord
      ? JSON.stringify({
          action: previousRecord.action,
          phase: previousRecord.phase,
          status: previousRecord.status,
          iteration: previousRecord.iteration,
          decision: previousRecord.decision,
        })
      : null;
    const history = previous && fingerprint === previousFingerprint
      ? previous.history
      : [...(previous?.history ?? []), record];

    rows.set(key, {
      ...record,
      key,
      agent: step.agent,
      updateCount: (previous?.updateCount ?? 0) + 1,
      history,
    });
  }

  return Array.from(rows.values());
}
