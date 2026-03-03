// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS Active Agents — Agent Status Panel with LangGraph Collaboration & Debate Trace

import type { Agent, CollaborationSummary, DebateSummary, ArgumentSummary } from "../types";
import "./ActiveAgents.css";

interface ActiveAgentsProps {
  agents: Agent[];
  collaboration?: CollaborationSummary | null;
  debateSummary?: DebateSummary | null;
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

export default function ActiveAgents({ agents, collaboration, debateSummary }: ActiveAgentsProps) {
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

  // Count active agents
  const processingCount = agents.filter(a => a.status === "Processing").length;
  const isAnyActive = processingCount > 0;

  return (
    <div className="agents-panel">
      {/* Live status bar */}
      <div className={`agents-status-bar ${isAnyActive ? "agents-active" : "agents-idle"}`}>
        <span className={`agents-status-dot ${isAnyActive ? "active" : ""}`} />
        <span className="agents-status-text">
          {isAnyActive
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

        // Dynamic action text based on agent role + state
        const actionText = (() => {
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

        return (
          <div
            key={agent.id}
            className={`agent-card ${isCollabActive ? 'agent-collab-active' : ''} ${inDebate ? 'agent-debate-active' : ''} ${agent.status === 'Processing' ? 'agent-processing' : ''}`}
            title={agent.description}
          >
            <div
              className={`agent-status-indicator ${agent.status.toLowerCase()}`}
            />
            <div className="agent-info">
              <div className="agent-name">{agent.name}</div>
              <div className={`agent-role ${agent.status === 'Processing' ? 'agent-role-active' : ''}`}>{actionText}</div>
            </div>
            <div className="agent-badges">
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
