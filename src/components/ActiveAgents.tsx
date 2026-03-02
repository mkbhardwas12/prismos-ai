// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Active Agents — Agent Status Panel with Sandbox Prism Protection Badge

import type { Agent } from "../types";

interface ActiveAgentsProps {
  agents: Agent[];
}

export default function ActiveAgents({ agents }: ActiveAgentsProps) {
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
      {agents.map((agent) => (
        <div
          key={agent.id}
          className="agent-card"
          title={agent.description}
        >
          <div
            className={`agent-status-indicator ${agent.status.toLowerCase()}`}
          />
          <div className="agent-info">
            <div className="agent-name">{agent.name}</div>
            <div className="agent-role">{agent.role}</div>
          </div>
          <div className="agent-sandbox-chip" title="All actions signed & sandboxed">
            ◈
          </div>
        </div>
      ))}
    </div>
  );
}
