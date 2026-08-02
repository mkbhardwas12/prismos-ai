import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { WorkflowDecision, WorkflowRoleId, WorkflowVoteBasis } from "../types";
import {
  elapsedLabel,
  summarizeAgentActivities,
  type AgentActivityRecord,
} from "../lib/agentActivity";
import type { AgentActivity } from "../types";

interface DecisionFact {
  label: string;
  value: string;
  tone?: "positive" | "warning" | "neutral";
}

const ROLE_LABELS: Record<WorkflowRoleId, string> = {
  orchestrator: "Orchestrator",
  reasoner: "Reasoner",
  tool_smith: "Tool Smith",
  memory_keeper: "Memory Keeper",
  sentinel: "Sentinel",
};

const VOTE_BASIS_LABELS: Record<WorkflowVoteBasis, string> = {
  workflow_complete: "Required workflow stages completed",
  critic_accepted: "Bounded Critic accepted the answer",
  best_available: "Best available attempt after quality checks",
  single_pass: "Single-pass output; no model grade",
  action_policy_clear: "Configured action policy found no block",
  action_policy_blocked: "Configured action policy blocked the proposal",
  context_available: "Retrieved graph context was available",
  fresh_context: "Fresh topic; no prior graph context required",
  safety_policy_clear: "Deterministic safety policy passed",
  safety_policy_veto: "Deterministic safety policy vetoed",
};

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function decisionFacts(decision: WorkflowDecision): DecisionFact[] {
  switch (decision.kind) {
    case "work_plan":
      return [
        { label: "Request class", value: decision.query_type },
        { label: "Work units", value: String(decision.unit_count) },
        { label: "Roles selected", value: decision.roles.map((role) => ROLE_LABELS[role]).join(", ") },
        { label: "Local context evidence", value: `${decision.context_count} node${decision.context_count === 1 ? "" : "s"}` },
      ];
    case "routing":
      return [
        { label: "Capability lane", value: decision.lane },
        { label: "Model route changed", value: yesNo(decision.auto_swapped) },
        {
          label: "Routing basis",
          value: decision.reason_code === "configured_model"
            ? "Configured model used for a general request"
            : decision.reason_code === "capability_match"
              ? "A locally available capability match was selected"
              : "Requested model already matched the capability lane",
        },
      ];
    case "criteria":
      return [
        { label: "Criteria source", value: decision.source === "model" ? "Model-backed Planner" : "Deterministic fallback" },
        ...decision.checks.map((check, index) => ({ label: `Criterion ${index + 1}`, value: check })),
      ];
    case "judge":
      return [
        { label: "Decision", value: decision.passed ? "Accepted" : "Needs revision", tone: decision.passed ? "positive" : "warning" },
        { label: "Grade source", value: decision.graded ? "Model-backed Critic" : "Ungraded fallback" },
        { label: "Score", value: `${decision.score_pct}%` },
        ...decision.limitations.map((item, index) => ({ label: `Gap ${index + 1}`, value: item, tone: "warning" as const })),
      ];
    case "review_summary":
      return [
        { label: "Review passes", value: String(decision.rounds) },
        { label: "Trace records", value: String(decision.trace_items) },
        { label: "Checks resolved", value: yesNo(decision.resolved), tone: decision.resolved ? "positive" : "warning" },
        { label: "Heuristic agreement", value: `${decision.agreement_pct}%` },
      ];
    case "policy_check":
      return [
        { label: "Policy gate", value: decision.gate === "answer_candidate" ? "Answer candidate" : "Final proposal review" },
        { label: "Result", value: decision.passed ? "Passed" : "Flagged", tone: decision.passed ? "positive" : "warning" },
        { label: "Concerns", value: String(decision.concern_count) },
      ];
    case "vote":
      return [
        { label: "Role", value: ROLE_LABELS[decision.role] },
        { label: "Vote", value: decision.approved ? "Approve" : "Reject", tone: decision.approved ? "positive" : "warning" },
        { label: "Confidence", value: `${decision.confidence_pct}%` },
        { label: "Decision basis", value: VOTE_BASIS_LABELS[decision.basis] },
      ];
    case "consensus":
      return [
        { label: "Outcome", value: decision.approved ? "Approved" : "Rejected", tone: decision.approved ? "positive" : "warning" },
        { label: "Approvals", value: `${decision.approve_count} of ${decision.total}` },
        { label: "Rejections", value: String(decision.reject_count) },
        { label: "Rule", value: "Majority approval plus required Sentinel approval" },
      ];
    case "persistence":
      return [
        { label: "Graph update", value: decision.succeeded ? "Completed" : "Skipped after an error", tone: decision.succeeded ? "positive" : "warning" },
        { label: "Edges reinforced", value: String(decision.edge_count) },
        { label: "Conversation stored locally", value: yesNo(decision.conversation_stored) },
      ];
    case "finalization":
      return [
        { label: "Response", value: decision.approved ? "Policy-approved" : "Rejected", tone: decision.approved ? "positive" : "warning" },
        { label: "Critic validated", value: yesNo(decision.validated) },
        { label: "Attempts used", value: `${decision.attempts_used} of ${decision.max_attempts}` },
      ];
  }
}

function DecisionRecord({ record }: { record: AgentActivityRecord }) {
  const facts = record.decision ? decisionFacts(record.decision) : [];
  return (
    <li className="agent-trace-event">
      <div className="agent-trace-event-header">
        <span className={`agent-trace-event-status agent-trace-event-status-${record.status}`} aria-hidden="true" />
        <span className="agent-trace-event-phase">{record.phaseLabel}</span>
        {record.iteration > 0 && <span>Attempt {record.iteration}</span>}
        <time>{elapsedLabel(record.elapsedMs)}</time>
      </div>
      <div className="agent-trace-event-action">{record.action}</div>
      {facts.length > 0 && (
        <dl className="agent-decision-facts">
          {facts.map((fact, index) => (
            <div className={`agent-decision-fact agent-decision-fact-${fact.tone ?? "neutral"}`} key={`${fact.label}-${index}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

interface AgentActivityFeedProps {
  steps: AgentActivity[];
  isRunning?: boolean;
  onDismiss?: () => void;
}

export default function AgentActivityFeed({ steps, isRunning = true, onDismiss }: AgentActivityFeedProps) {
  const rows = useMemo(() => summarizeAgentActivities(steps), [steps]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const taskId = steps.at(-1)?.task_id ?? "";
  const activeCount = rows.filter((row) => row.status === "active").length;
  const completedCount = rows.filter((row) => row.status === "completed").length;
  const allExpanded = rows.length > 0 && rows.every((row) => expandedKeys.has(row.key));
  const retainedUpdates = rows.reduce((total, row) => total + row.history.length, 0);

  useEffect(() => {
    setExpandedKeys(new Set());
  }, [taskId]);

  if (rows.length === 0) return null;

  const toggleRow = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedKeys(allExpanded ? new Set() : new Set(rows.map((row) => row.key)));
  };

  const countText = isRunning
    ? `${activeCount} working${completedCount > 0 ? ` · ${completedCount} done` : ""}`
    : `Trace complete · ${rows.length} role${rows.length === 1 ? "" : "s"}`;

  return (
    <section className="agent-activity-feed" aria-label="Workflow decision trace">
      <div className="agent-activity-header">
        <div className="agent-activity-heading">
          <span className="agent-activity-title">Live workflow activity</span>
          <span className="agent-activity-privacy">Decision record only · private chain-of-thought is not recorded</span>
        </div>
        <div className="agent-activity-header-actions">
          <span className="agent-activity-count" aria-live="polite" aria-atomic="true">{countText}</span>
          <button className="agent-activity-expand-all" type="button" onClick={toggleAll}>
            {allExpanded ? "Collapse all" : "Expand all details"}
          </button>
          {onDismiss && (
            <button className="agent-activity-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss decision trace">×</button>
          )}
        </div>
      </div>
      <div className="agent-activity-retention">{retainedUpdates} safe update{retainedUpdates === 1 ? "" : "s"} retained for this task</div>
      <div className="agent-activity-rows">
        <AnimatePresence initial={false}>
          {rows.map((row) => {
            const expanded = expandedKeys.has(row.key);
            const displayStatus = !isRunning && row.status === "active" ? "completed" : row.status;
            const displayStatusLabel = !isRunning && row.status === "active" ? "Recorded" : row.statusLabel;
            const panelId = `agent-trace-${row.key}`;
            return (
              <motion.div
                key={row.key}
                className={`live-step-card live-phase-${row.phase}`}
                initial={{ opacity: 0, x: -12, height: 0 }}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                layout
              >
                <div className={`live-step live-step-${displayStatus}`} aria-label={`${row.agent}: ${row.action}. ${displayStatusLabel}`}>
                  <span className={`live-step-dot dot-${displayStatus}`} aria-hidden="true" />
                  <span className="live-step-identity">
                    <span className="live-step-agent">{row.agent}</span>
                    <span className="live-step-phase">{row.phaseLabel}</span>
                  </span>
                  <span className="live-step-action" title={row.action}>{row.action}</span>
                  {row.iteration > 0 && <span className="live-step-iteration">Attempt {row.iteration}</span>}
                  <span className="live-step-elapsed" title="Time of this update since the task began">{elapsedLabel(row.elapsedMs)}</span>
                  <button
                    className="live-step-details-toggle"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => toggleRow(row.key)}
                  >
                    {expanded ? "Hide" : "Details"} ({row.history.length})
                  </button>
                  <span className={`live-step-status live-step-status-${displayStatus}`}>
                    {displayStatus === "active" && <span className="live-step-pulse" aria-hidden="true">●</span>}
                    {displayStatus === "completed" && <span aria-hidden="true">✓</span>}
                    {displayStatus === "error" && <span aria-hidden="true">!</span>}
                    {displayStatusLabel}
                  </span>
                </div>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      id={panelId}
                      className="agent-decision-trace"
                      role="region"
                      aria-label={`${row.agent} decision record`}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      <div className="agent-decision-trace-title">What {row.agent} reported and decided</div>
                      <ol className="agent-trace-events">
                        {row.history.map((record) => <DecisionRecord key={record.id} record={record} />)}
                      </ol>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
