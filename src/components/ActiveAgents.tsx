// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Active Agents — Agent Status Panel with LangGraph Collaboration & Debate Trace

import type { Agent, CollaborationSummary, DebateSummary, ArgumentSummary, AgentActivity } from "../types";
import "./ActiveAgents.css";

interface ActiveAgentsProps {
  agents: Agent[];
  collaboration?: CollaborationSummary | null;
  debateSummary?: DebateSummary | null;
  liveAgentSteps?: AgentActivity[];
}

function ArgumentTypeIcon({ type: argType }: { type: string }) {
  switch (argType) {
    case "Position": return <span title="Position">📌</span>;
    case "Challenge": return <span title="Challenge">⚔️</span>;
    case "Rebuttal": return <span title="Rebuttal">🔄</span>;
    case "Support": return <span title="Support">✅</span>;
    case "Concession": return <span title="Concession">🤝</span>;
    default: return <span>💬</span>;
  }
}

function DebatePanel({ debate }: { debate: DebateSummary }) {
  return (
    <div className="debate-panel">
      <div className="debate-header">
        <span className="debate-icon">⚖️</span>
        <span className="debate-title">Agent Debate</span>
        <span className={`debate-resolution-badge ${debate.resolved ? 'resolved' : 'unresolved'}`}>
          {debate.resolved ? '✓ Resolved' : '⚡ Unresolved'}
        </span>
      </div>

      <div className="debate-stats">
        <div className="debate-stat">
          <span className="debate-stat-value">{debate.rounds}</span>
          <span className="debate-stat-label">Rounds</span>
        </div>
        <div className="debate-stat">
          <span className="debate-stat-value">{debate.total_arguments}</span>
          <span className="debate-stat-label">Arguments</span>
        </div>
        <div className="debate-stat">
          <span className="debate-stat-value">{Math.round(debate.agreement_score * 100)}%</span>
          <span className="debate-stat-label">Agreement</span>
        </div>
      </div>

      <div className="debate-breakdown">
        <span className="debate-tag tag-position">📌 {debate.positions} positions</span>
        <span className="debate-tag tag-challenge">⚔️ {debate.challenges} challenges</span>
        <span className="debate-tag tag-rebuttal">🔄 {debate.rebuttals} rebuttals</span>
        <span className="debate-tag tag-support">✅ {debate.supports} supports</span>
      </div>

      {debate.arguments.length > 0 && (
        <div className="debate-arguments">
          {debate.arguments.map((arg: ArgumentSummary, i: number) => (
            <div key={i} className={`debate-arg debate-arg-${arg.argument_type.toLowerCase()}`}>
              <div className="debate-arg-header">
                <ArgumentTypeIcon type={arg.argument_type} />
                <span className="debate-arg-agent">{arg.agent}</span>
                {arg.target && (
                  <span className="debate-arg-target">→ {arg.target}</span>
                )}
                <span className="debate-arg-confidence">{Math.round(arg.confidence * 100)}%</span>
              </div>
              <div className="debate-arg-content">{arg.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ActiveAgents({ agents, collaboration, debateSummary, liveAgentSteps }: ActiveAgentsProps) {
  if (agents.length === 0) {
    return (
      <div className="agents-panel">
        <div className="spectrum-empty">
          <span className="agent-init-spinner" aria-hidden="true" />
          Initializing agents…
        </div>
      </div>
    );
  }

  // Count active agents — include live agent step data
  const liveSteps = liveAgentSteps ?? [];
  const hasLiveActivity = liveSteps.length > 0;

  // Determine which agents are currently "thinking" based on live events
  const liveThinkingAgents = new Set<string>();
  const liveCompletedAgents = new Set<string>();
  for (const step of liveSteps) {
    if (step.status === "thinking") liveThinkingAgents.add(step.agent.toLowerCase().replace(/ /g, "_"));
    if (step.status === "completed") {
      liveThinkingAgents.delete(step.agent.toLowerCase().replace(/ /g, "_"));
      liveCompletedAgents.add(step.agent.toLowerCase().replace(/ /g, "_"));
    }
  }
  // The most recent live action for each agent (for label display)
  const latestLiveAction = new Map<string, string>();
  for (const step of liveSteps) {
    latestLiveAction.set(step.agent.toLowerCase().replace(/ /g, "_"), step.action);
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
                const last = liveSteps[liveSteps.length - 1];
                const phaseLabel: Record<string, string> = {
                  orchestrate: "🧭 Orchestrating",
                  analyze: "🔬 Analyzing",
                  debate: "⚖️ Debating",
                  review: "🛡️ Security review",
                  vote: "🗳️ Voting",
                  execute: "⚡ Executing",
                };
                return phaseLabel[last.phase] ?? `${liveThinkingAgents.size} agents working…`;
              })()
            : isAnyActive
            ? `${processingCount} agent${processingCount > 1 ? "s" : ""} working…`
            : "All agents standing by"}
        </span>
      </div>

      <div className="sandbox-prism-badge" title="Every AI agent runs inside an isolated security container. If anything goes wrong, changes are automatically reversed. All actions are cryptographically signed.">
        <span className="sandbox-prism-icon">🛡️</span>
        <span className="sandbox-prism-text">Protected by Sandbox Prism</span>
        <span className="sandbox-prism-detail">HMAC-SHA256 · Allow-List · Auto-Rollback</span>
      </div>

      <div className="wasm-isolation-badge" title="Code runs in a WebAssembly sandbox — agents cannot access your files, network, or system without explicit permission. Execution time and memory are strictly limited.">
        <span className="wasm-badge-icon">🔒</span>
        <span className="wasm-badge-text">WASM Isolated</span>
        <span className="wasm-badge-detail">wasmtime · Fuel Metering · Memory Bounded · Zero Ambient Authority</span>
      </div>

      {/* LangGraph Collaboration Trace */}
      {collaboration && (
        <div className="collab-trace-panel">
          <div className="collab-trace-header">
            <span className="collab-trace-icon">🔗</span>
            <span className="collab-trace-title">LangGraph Workflow</span>
            <span className={`collab-consensus-badge ${collaboration.consensus_approved ? 'approved' : 'rejected'}`}>
              {collaboration.consensus_approved ? '✓ Approved' : '✗ Rejected'}
            </span>
          </div>
          <div className="collab-pipeline">
            {collaboration.pipeline_trace.map((step, i) => (
              <div key={i} className={`collab-step collab-step-${step.status.toLowerCase()}`}>
                <span className="collab-step-dot" />
                <span className="collab-step-agent">{step.agent}</span>
                <span className="collab-step-action">{step.action}</span>
              </div>
            ))}
          </div>
          <div className="collab-vote-summary">
            <span className="collab-vote-approve">✓ {collaboration.approve_count}</span>
            <span className="collab-vote-reject">✗ {collaboration.reject_count}</span>
            <span className="collab-vote-msgs">💬 {collaboration.message_count} msgs</span>
          </div>
        </div>
      )}

      {/* Debate Panel */}
      {debateSummary && <DebatePanel debate={debateSummary} />}

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
          if (isLiveThinking && liveAction) return liveAction;
          if (isLiveCompleted && liveAction) return liveAction;
          if (agent.status === "Processing") {
            switch (agent.id) {
              case "orchestrator": return "Routing intent…";
              case "reasoner": return "Analyzing context…";
              case "memory_keeper": return "Querying graph…";
              case "tool_smith": return "Preparing tools…";
              case "sentinel": return "Reviewing safety…";
              default: return "Processing…";
            }
          }
          if (isCollabActive && traceStep) return traceStep.action;
          if (inDebate && debateArg) return `Argued: ${debateArg.argument_type}`;
          return agent.role;
        })();

        const isAgentActive = agent.status === 'Processing' || isLiveThinking;

        return (
          <div
            key={agent.id}
            className={`agent-card ${isCollabActive ? 'agent-collab-active' : ''} ${inDebate ? 'agent-debate-active' : ''} ${isAgentActive ? 'agent-processing' : ''} ${isLiveThinking ? 'agent-live-thinking' : ''} ${isLiveCompleted ? 'agent-live-done' : ''}`}
            title={agent.description}
          >
            <div
              className={`agent-status-indicator ${isLiveThinking ? 'processing' : isLiveCompleted ? 'idle' : agent.status.toLowerCase()}`}
            />
            <div className="agent-info">
              <div className="agent-name">{agent.name}</div>
              <div className={`agent-role ${isAgentActive ? 'agent-role-active' : ''}`}>{actionText}</div>
            </div>
            <div className="agent-badges">
              {isLiveThinking && (
                <span className="agent-thinking-chip" title="Currently thinking">
                  💭
                </span>
              )}
              {isLiveCompleted && !isLiveThinking && (
                <span className="agent-done-chip" title="Completed">
                  ✓
                </span>
              )}
              {inDebate && (
                <span className="agent-debate-chip" title={`Debated: ${debateArg?.argument_type}`}>
                  ⚖️
                </span>
              )}
              {isCollabActive && (
                <span className="agent-collab-chip" title="Participated in collaboration">
                  🔗
                </span>
              )}
              <div className="agent-sandbox-chip" title="WASM isolated · HMAC signed · Sandboxed">
                ◈
              </div>
              <div className="agent-wasm-chip" title="True WASM isolation via wasmtime">
                🔒
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
