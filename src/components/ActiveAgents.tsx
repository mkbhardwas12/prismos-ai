// PrismOS-AI workflow-role status panel. Legacy wire types retain older agent/
// debate names, but the UI describes the bounded sequential workflow truthfully.

import { memo } from "react";
import type { Agent, CollaborationSummary, DebateSummary, ArgumentSummary, AgentActivity } from "../types";
import { summarizeAgentActivities } from "../lib/agentActivity";
import "./ActiveAgents.css";

interface ActiveAgentsProps {
  agents: Agent[];
  collaboration?: CollaborationSummary | null;
  debateSummary?: DebateSummary | null;
  liveAgentSteps?: AgentActivity[];
}

const WORKFLOW_ROLE_LABELS: Record<string, string> = {
  orchestrator: "Routing Stage",
  reasoner: "Reasoning Stage",
  memory_keeper: "Knowledge Retrieval Stage",
  tool_smith: "Action Policy Stage",
  sentinel: "Safety Review Stage",
};

const WORKFLOW_ROLE_SUMMARIES: Record<string, string> = {
  orchestrator: "Routes the request through the bounded workflow",
  reasoner: "Runs bounded model-backed analysis",
  memory_keeper: "Reviews retrieved graph context",
  tool_smith: "Evaluates modeled actions against policy",
  sentinel: "Checks security and privacy heuristics",
};

function workflowRoleLabel(value: string): string {
  const id = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return WORKFLOW_ROLE_LABELS[id] ?? value;
}

function workflowTraceText(value: string): string {
  return value
    .replace(/preparing tools/gi, "Evaluating modeled actions")
    .replace(/evaluating tool needs/gi, "Evaluating modeled action policy")
    .replace(/Tool Smith/g, WORKFLOW_ROLE_LABELS.tool_smith)
    .replace(/Memory Keeper/g, WORKFLOW_ROLE_LABELS.memory_keeper)
    .replace(/Orchestrator/g, WORKFLOW_ROLE_LABELS.orchestrator)
    .replace(/Reasoner/g, WORKFLOW_ROLE_LABELS.reasoner)
    .replace(/Sentinel/g, WORKFLOW_ROLE_LABELS.sentinel);
}

function ArgumentTypeIcon({ type: argType }: { type: string }) {
  switch (argType) {
    case "Position": return <span title="Proposal trace">📌</span>;
    case "Challenge": return <span title="Constraint check">⚠️</span>;
    case "Rebuttal": return <span title="Revision trace">🔄</span>;
    case "Support": return <span title="Positive heuristic">✅</span>;
    case "Concession": return <span title="Resolved check">✓</span>;
    default: return <span>💬</span>;
  }
}

function QualityTracePanel({ debate }: { debate: DebateSummary }) {
  return (
    <div className="debate-panel">
      <div className="debate-header">
        <span className="debate-icon">📐</span>
        <span className="debate-title">Deterministic Quality Trace</span>
        <span className={`debate-resolution-badge ${debate.resolved ? 'resolved' : 'unresolved'}`}>
          {debate.resolved ? '✓ Checks complete' : '⚠ Checks incomplete'}
        </span>
      </div>

      <div className="debate-stats">
        <div className="debate-stat">
          <span className="debate-stat-value">{debate.rounds}</span>
          <span className="debate-stat-label">Passes</span>
        </div>
        <div className="debate-stat">
          <span className="debate-stat-value">{debate.total_arguments}</span>
          <span className="debate-stat-label">Trace items</span>
        </div>
        <div className="debate-stat">
          <span className="debate-stat-value">{Math.round(debate.agreement_score * 100)}%</span>
          <span className="debate-stat-label">Heuristic score</span>
        </div>
      </div>

      <div className="debate-breakdown">
        <span className="debate-tag tag-position">📌 {debate.positions} proposals</span>
        <span className="debate-tag tag-challenge">⚠️ {debate.challenges} constraint checks</span>
        <span className="debate-tag tag-rebuttal">🔄 {debate.rebuttals} revisions</span>
        <span className="debate-tag tag-support">✅ {debate.supports} positive signals</span>
      </div>

      {debate.arguments.length > 0 && (
        <div className="debate-arguments">
          {debate.arguments.map((arg: ArgumentSummary, i: number) => (
            <div key={i} className={`debate-arg debate-arg-${arg.argument_type.toLowerCase()}`}>
              <div className="debate-arg-header">
                <ArgumentTypeIcon type={arg.argument_type} />
                <span className="debate-arg-agent">{workflowRoleLabel(arg.agent)}</span>
                {arg.target && (
                  <span className="debate-arg-target">→ {workflowRoleLabel(arg.target)}</span>
                )}
                <span className="debate-arg-confidence">{Math.round(arg.confidence * 100)}%</span>
              </div>
              <div className="debate-arg-content">{workflowTraceText(arg.content)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(function ActiveAgents({ agents, collaboration, debateSummary, liveAgentSteps }: ActiveAgentsProps) {
  if (agents.length === 0) {
    return (
      <div className="agents-panel">
        <div className="spectrum-empty">
          <span className="agent-init-spinner" aria-hidden="true" />
          Initializing workflow roles…
        </div>
      </div>
    );
  }

  // Count active workflow stages, including live step data.
  const liveSteps = liveAgentSteps ?? [];
  const liveRows = summarizeAgentActivities(liveSteps);
  const activeRows = liveRows.filter((row) => row.status === "active");
  const hasLiveActivity = activeRows.length > 0;

  // One latest state per role. `started` and legacy `thinking` both normalize
  // to active, so project review and chat use the same presentation contract.
  const liveThinkingAgents = new Set<string>();
  const liveCompletedAgents = new Set<string>();
  for (const row of liveRows) {
    const id = row.agent.toLowerCase().replace(/ /g, "_");
    if (row.status === "active") liveThinkingAgents.add(id);
    if (row.status === "completed") liveCompletedAgents.add(id);
  }
  // The most recent live action for each agent (for label display)
  const latestLiveAction = new Map<string, string>();
  for (const row of liveRows) {
    latestLiveAction.set(row.agent.toLowerCase().replace(/ /g, "_"), row.action);
  }

  const processingCount = agents.filter(a => a.status === "Processing").length;
  const isAnyActive = processingCount > 0 || hasLiveActivity;

  return (
    <div className="agents-panel">
      {/* Live status bar */}
      <div className={`agents-status-bar ${isAnyActive ? "agents-active" : "agents-idle"}`}>
        <span className={`agents-status-dot ${isAnyActive ? "active" : ""}`} />
        <span className="agents-status-text">
          {hasLiveActivity
            ? (() => {
                const last = activeRows[activeRows.length - 1];
                const phaseLabel: Record<string, string> = {
                  orchestrate: "🧭 Orchestrating",
                  plan: "📋 Planning criteria",
                  analyze: "🔬 Analyzing",
                  build: "✍️ Drafting answer",
                  judge: "⚖️ Judging answer",
                  refine: "♻️ Refining",
                  debate: "📐 Running policy checks",
                  review: "🛡️ Security review",
                  vote: "📊 Computing heuristic checks",
                  execute: "⚡ Applying workflow result",
                };
                const base = phaseLabel[last.phase] ?? `${liveThinkingAgents.size} workflow stages active…`;
                // Show the goal-loop attempt when the backend supplies one.
                return last.iteration && last.iteration > 1
                  ? `${base} (attempt ${last.iteration})`
                  : base;
              })()
            : isAnyActive
            ? `${processingCount} workflow stage${processingCount > 1 ? "s" : ""} active…`
            : "Workflow stages ready"}
        </span>
      </div>

      <div className="sandbox-prism-badge" title="Workflow-stage intents are classified against per-role allow-lists and recorded with a process-local HMAC. Checkpoints are audit bookkeeping, not a generic undo for external effects.">
        <span className="sandbox-prism-icon">🛡️</span>
        <span className="sandbox-prism-text">Action Policy Active</span>
        <span className="sandbox-prism-detail">Per-Role Allow-List · Anomaly Checks · Authenticated Records</span>
      </div>

      <div className="wasm-isolation-badge" title="Core backend inference accepts loopback Ollama endpoints by default. This is an endpoint policy, not operating-system process isolation.">
        <span className="wasm-badge-icon">🔒</span>
        <span className="wasm-badge-text">Local Model Boundary</span>
        <span className="wasm-badge-detail">Loopback Default · Proxies Disabled · Redirects Disabled</span>
      </div>

      {/* Sequential workflow trace (legacy collaboration field name) */}
      {collaboration && (
        <div className="collab-trace-panel">
          <div className="collab-trace-header">
            <span className="collab-trace-icon">🔗</span>
            <span className="collab-trace-title">Sequential Workflow Trace</span>
            <span className={`collab-consensus-badge ${collaboration.consensus_approved ? 'approved' : 'rejected'}`}>
              {collaboration.consensus_approved ? '✓ Heuristic checks passed' : '⚠ Heuristic checks flagged'}
            </span>
          </div>
          <div className="collab-pipeline">
            {collaboration.pipeline_trace.map((step, i) => (
              <div key={i} className={`collab-step collab-step-${step.status.toLowerCase()}`}>
                <span className="collab-step-dot" />
                <span className="collab-step-agent">{workflowRoleLabel(step.agent)}</span>
                <span className="collab-step-action">{workflowTraceText(step.action)}</span>
              </div>
            ))}
          </div>
          <div className="collab-vote-summary">
            <span className="collab-vote-approve">✓ {collaboration.approve_count} positive checks</span>
            <span className="collab-vote-reject">⚠ {collaboration.reject_count} flagged checks</span>
            <span className="collab-vote-msgs">{collaboration.message_count} trace records</span>
          </div>
        </div>
      )}

      {/* Deterministic quality/policy trace (legacy debate field name) */}
      {debateSummary && <QualityTracePanel debate={debateSummary} />}

      {agents.map((agent) => {
        // Check if this agent was active in the last collaboration
        const traceStep = collaboration?.pipeline_trace.find(
          s => s.agent.toLowerCase().replace(' ', '_') === agent.id ||
               s.agent.toLowerCase().replace(' ', '') === agent.id.replace('_', '')
        );
        const isCollabActive = traceStep?.status === 'Completed';

        // Check if agent participated in debate
        const debateArg = debateSummary?.arguments.find(
          a => a.agent.toLowerCase().replace(' ', '_') === agent.id ||
               a.agent.toLowerCase().replace(' ', '') === agent.id.replace('_', '')
        );
        const inDebate = !!debateArg;

        // Phase 2: live agent status from real-time events
        const isLiveThinking = liveThinkingAgents.has(agent.id);
        const isLiveCompleted = liveCompletedAgents.has(agent.id);
        const liveAction = latestLiveAction.get(agent.id);

        // Dynamic action text based on agent role + state
        const actionText = (() => {
          // Phase 2: live action text takes precedence
          if (isLiveThinking && liveAction) return workflowTraceText(liveAction);
          if (isLiveCompleted && liveAction) return workflowTraceText(liveAction);
          if (agent.status === "Processing") {
            switch (agent.id) {
              case "orchestrator": return "Routing intent…";
              case "reasoner": return "Analyzing context…";
              case "memory_keeper": return "Querying graph…";
              case "tool_smith": return "Evaluating modeled actions…";
              case "sentinel": return "Reviewing safety…";
              default: return "Processing…";
            }
          }
          if (isCollabActive && traceStep) return workflowTraceText(traceStep.action);
          if (inDebate && debateArg) return `Quality trace: ${debateArg.argument_type}`;
          return WORKFLOW_ROLE_SUMMARIES[agent.id] ?? "Deterministic workflow role";
        })();

        const isAgentActive = agent.status === 'Processing' || isLiveThinking;

        return (
          <div
            key={agent.id}
            className={`agent-card ${isCollabActive ? 'agent-collab-active' : ''} ${inDebate ? 'agent-debate-active' : ''} ${isAgentActive ? 'agent-processing' : ''} ${isLiveThinking ? 'agent-live-thinking' : ''} ${isLiveCompleted ? 'agent-live-done' : ''}`}
            title={`${workflowRoleLabel(agent.id)} — deterministic workflow role`}
          >
            <div
              className={`agent-status-indicator ${isLiveThinking ? 'processing' : isLiveCompleted ? 'idle' : agent.status.toLowerCase()}`}
            />
            <div className="agent-info">
              <div className="agent-name">{workflowRoleLabel(agent.id)}</div>
              <div className={`agent-role ${isAgentActive ? 'agent-role-active' : ''}`}>{actionText}</div>
            </div>
            <div className="agent-badges">
              {isLiveThinking && (
                <span className="agent-thinking-chip" title="Workflow stage running">
                  ⚙️
                </span>
              )}
              {isLiveCompleted && !isLiveThinking && (
                <span className="agent-done-chip" title="Completed">
                  ✓
                </span>
              )}
              {inDebate && (
                <span className="agent-debate-chip" title={`Quality trace: ${debateArg?.argument_type}`}>
                  📐
                </span>
              )}
              {isCollabActive && (
                <span className="agent-collab-chip" title="Appeared in the sequential workflow trace">
                  🔗
                </span>
              )}
              <div className="agent-sandbox-chip" title="Checked by the per-role action policy">
                ◈
              </div>
              <div className="agent-wasm-chip" title="Local model endpoint policy">
                🔒
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
})
