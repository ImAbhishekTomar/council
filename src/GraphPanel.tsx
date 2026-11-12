import { useMemo } from 'react';
import NodeDetails from './graph/NodeDetails';
import useGraphSimulation from './graph/useGraphSimulation';
import type { AgentNodeData, AppEdge, GraphLink, GraphNode } from './graph/types';

type GraphPanelProps = {
  nodes: { id: string; data: AgentNodeData; position?: { x: number; y: number }; draggable?: boolean }[];
  edges: AppEdge[];
  activeAgentIds: string[];
  selectedAgentId?: string;
  onSelectAgent: (id?: string) => void;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
};

function GraphPanel({
  nodes,
  edges,
  activeAgentIds,
  selectedAgentId,
  onSelectAgent,
  showEdgeLabels,
  onToggleEdgeLabels,
}: GraphPanelProps) {

  const graphNodes = useMemo<GraphNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        label: node.data.agent.name,
        subtitle: node.data.agent.role,
        color: node.data.agent.color,
        avatarUrl: node.data.agent.avatarUrl,
        active: node.data.active,
        raw: node.data.agent,
        x: node.position?.x,
        y: node.position?.y,
      })),
    [nodes],
  );

  const graphLinks = useMemo<GraphLink[]>(() => {
    const counts = new Map<string, number>();
    edges.forEach((edge) => {
      const key = [edge.source, edge.target].sort().join('_');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    const current = new Map<string, number>();
    return edges.map((edge) => {
      const key = [edge.source, edge.target].sort().join('_');
      const total = counts.get(key) ?? 1;
      const index = current.get(key) ?? 0;
      current.set(key, index + 1);
      const isReversed = edge.source > edge.target;
      let curvature = 0;
      if (total > 1) {
        const range = Math.min(1.2, 0.6 + total * 0.15);
        curvature = ((index / (total - 1)) - 0.5) * range * 2;
        if (isReversed) curvature = -curvature;
      }
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        name: edge.label ?? 'agent view',
        curvature,
        pairTotal: total,
        raw: { source: edge.source, target: edge.target },
      };
    });
  }, [edges]);

  const entityTypes = useMemo(
    () => {
      const map = new Map<string, string>();
      nodes.forEach((node) => {
        const type = node.data.agent.role || 'Agent';
        if (!map.has(type)) map.set(type, node.data.agent.color);
      });
      return Array.from(map.entries()).map(([name, color]) => ({ name, color }));
    },
    [nodes],
  );
  const selectedAgent = useMemo(() => nodes.find((node) => node.id === selectedAgentId)?.data.agent, [selectedAgentId, nodes]);
  const selectedAgentIndex = nodes.findIndex((node) => node.id === selectedAgentId);

  const { containerRef, svgRef } = useGraphSimulation({
    graphNodes,
    graphLinks,
    activeAgentIds,
    selectedAgentId,
    showEdgeLabels,
    onSelectAgent,
  });

  return (
    <div className="graph-container" ref={containerRef}>
      <div className="edge-labels-toggle">
        <label className="toggle-switch">
          <input type="checkbox" checked={showEdgeLabels} onChange={onToggleEdgeLabels} />
          <span className="slider" />
        </label>
        <span className="toggle-label">Show edge labels</span>
      </div>
      <svg ref={svgRef} className="graph-svg" />
      {selectedAgent && (
        <NodeDetails agent={selectedAgent} agentIndex={selectedAgentIndex} onClose={() => onSelectAgent(undefined)} />
      )}
      {entityTypes.length > 0 && (
        <div className="graph-legend">
          <span className="legend-title">Council roles</span>
          <div className="legend-items">
            {entityTypes.map((type) => (
              <div className="legend-item" key={type.name}>
                <span className="legend-dot" style={{ background: type.color }} />
                <span className="legend-label">{type.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GraphPanel;
