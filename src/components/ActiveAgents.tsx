// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Active Agents — Agent Status Panel with LangGraph Collaboration Trace

import type { Agent, CollaborationSummary } from "../types";

interface ActiveAgentsProps {
  agents: Agent[];
  collaboration?: CollaborationSummary | null;
}

export default function ActiveAgents({ agents, collaboration }: ActiveAgentsProps) {
  if (agents.length === 0) {
    return (
      <div className="agents-panel">
        <div className="spectrum-empty">Initializing agents...</div>
      </div>
    );
  }

  return (
    <div className="agents-panel">
      <div className="sandbox-prism-badge">
        <span className="sandbox-prism-icon">🛡️</span>
        <span className="sandbox-prism-text">Protected by Sandbox Prism</span>
        <span className="sandbox-prism-detail">HMAC-SHA256 · Allow-List · Auto-Rollback</span>
      </div>

      {/* LangGraph Collaboration Trace */}
      {collaboration && (
        <div className="collab-trace-panel">
          <div className="collab-trace-header">
            <span className="collab-trace-icon">🔗</span>
            <span className="collab-trace-title">LangGraph Collaboration</span>
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

      {agents.map((agent) => {
        // Check if this agent was active in the last collaboration
        const traceStep = collaboration?.pipeline_trace.find(
          s => s.agent.toLowerCase().replace(' ', '_') === agent.id ||
               s.agent.toLowerCase().replace(' ', '') === agent.id.replace('_', '')
        );
        const isCollabActive = traceStep?.status === 'Completed';

        return (
          <div
            key={agent.id}
            className={`agent-card ${isCollabActive ? 'agent-collab-active' : ''}`}
            title={agent.description}
          >
            <div
              className={`agent-status-indicator ${agent.status.toLowerCase()}`}
            />
            <div className="agent-info">
              <div className="agent-name">{agent.name}</div>
              <div className="agent-role">{agent.role}</div>
            </div>
            <div className="agent-badges">
              {isCollabActive && (
                <span className="agent-collab-chip" title="Participated in collaboration">
                  🔗
                </span>
              )}
              <div className="agent-sandbox-chip" title="All actions signed & sandboxed">
                ◈
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
