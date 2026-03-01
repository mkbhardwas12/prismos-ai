// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Spectrum Graph View — Knowledge Graph Viewer

import type { SpectrumNode } from "../types";

interface SpectrumGraphViewProps {
  nodes: SpectrumNode[];
}

export default function SpectrumGraphView({ nodes }: SpectrumGraphViewProps) {
  if (nodes.length === 0) {
    return (
      <div className="spectrum-view">
        <div className="spectrum-empty">
          No nodes yet.
          <br />
          Start a conversation to build your knowledge graph.
        </div>
      </div>
    );
  }

  return (
    <div className="spectrum-view">
      <ul className="spectrum-node-list">
        {nodes.slice(0, 20).map((node) => (
          <li
            key={node.id}
            className="spectrum-node-item"
            title={`${node.node_type}: ${node.content.slice(0, 100)}`}
          >
            <span className={`spectrum-node-dot type-${node.node_type}`} />
            <span>{node.label}</span>
          </li>
        ))}
      </ul>
      {nodes.length > 20 && (
        <div className="spectrum-empty">+{nodes.length - 20} more nodes</div>
      )}
    </div>
  );
}
