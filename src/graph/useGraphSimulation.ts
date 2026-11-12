import { useEffect, useRef, type RefObject } from 'react';
import * as d3 from 'd3';
import { agentIcons } from './agentIcons';
import type { GraphLink, GraphNode } from './types';

function nodeRadius() {
  return 22;
}

function truncateNodeLabel(label: string) {
  return label.length > 18 ? `${label.slice(0, 18)}...` : label;
}

function nodeClipId(id: string) {
  return `agent-avatar-clip-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

type GraphSimulationInput = {
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
  activeAgentIds: string[];
  selectedAgentId?: string;
  showEdgeLabels: boolean;
  onSelectAgent: (id?: string) => void;
};

export default function useGraphSimulation({
  graphNodes,
  graphLinks,
  activeAgentIds,
  selectedAgentId,
  showEdgeLabels,
  onSelectAgent,
}: GraphSimulationInput) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const positionCacheRef = useRef(new Map<string, { x: number; y: number }>());
  const sizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width !== sizeRef.current.width || rect.height !== sizeRef.current.height) {
        sizeRef.current = { width: rect.width, height: rect.height };
        renderGraph();
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes.length, graphLinks.length, showEdgeLabels, activeAgentIds, selectedAgentId]);

  useEffect(() => {
    renderGraph();
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphLinks, showEdgeLabels, activeAgentIds, selectedAgentId]);

  function getLinkPath(link: GraphLink) {
    const { source, target, curvature } = link as GraphLink & { source: GraphNode; target: GraphNode };
    const sourceNode = source as unknown as GraphNode;
    const targetNode = target as unknown as GraphNode;
    const sourceX = sourceNode.x ?? 0;
    const sourceY = sourceNode.y ?? 0;
    const targetX = targetNode.x ?? 0;
    const targetY = targetNode.y ?? 0;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const sx = sourceX;
    const sy = sourceY;
    const tx = targetX;
    const ty = targetY;

    if (curvature === 0) {
      return `M${sx},${sy} L${tx},${ty}`;
    }

    const offsetRatio = 0.25 + link.pairTotal * 0.05;
    const baseOffset = Math.max(35, dist * offsetRatio);
    const offsetX = (-dy / dist) * curvature * baseOffset;
    const offsetY = (dx / dist) * curvature * baseOffset;
    const cx = (sx + tx) / 2 + offsetX;
    const cy = (sy + ty) / 2 + offsetY;
    return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
  }

  function renderGraph() {
    if (!svgRef.current || !containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    if (width === 0 || height === 0) return;

    sizeRef.current = { width, height };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    const defs = svg.append('defs');
    graphNodes.forEach((node) => {
      defs
        .append('clipPath')
        .attr('id', nodeClipId(node.id))
        .append('circle')
        .attr('r', nodeRadius())
        .attr('cx', 0)
        .attr('cy', 0);
    });

    const g = svg.append('g');
    const activeAgentSet = new Set(activeAgentIds);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.15, 4]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoom as any);

    const nodeMap = new Map<string, GraphNode>();
    graphNodes.forEach((node) => {
      const cachedPosition = positionCacheRef.current.get(node.id);
      if (typeof node.x !== 'number') {
        node.x = cachedPosition?.x ?? width / 2 + (Math.random() - 0.5) * 120;
      }
      if (typeof node.y !== 'number') {
        node.y = cachedPosition?.y ?? height / 2 + (Math.random() - 0.5) * 120;
      }
      nodeMap.set(node.id, node);
    });

    // d3.forceLink mutates link.source/target from string ids into node object
    // references. graphLinks is memoized and shared across renders, so we must
    // filter on the untouched `raw` ids and hand forceLink fresh copies -
    // otherwise on the next render nodeMap.has(link.source) sees an object, not
    // an id, drops every edge, and no connections render.
    const edges = graphLinks
      .filter((link) => nodeMap.has(link.raw.source) && nodeMap.has(link.raw.target))
      .map((link) => ({ ...link, source: link.raw.source, target: link.raw.target }));

    // When an agent is selected, highlight its edges + direct neighbours and dim
    // everything else. Sets are computed from the untouched `raw` ids so they stay
    // valid after d3.forceLink mutates link.source/target into node objects.
    const hasSelection = Boolean(selectedAgentId);
    const neighbourIds = new Set<string>();
    const highlightedEdgeIds = new Set<string>();
    if (selectedAgentId) {
      neighbourIds.add(selectedAgentId);
      edges.forEach((edge) => {
        if (edge.raw.source === selectedAgentId) {
          neighbourIds.add(edge.raw.target);
          highlightedEdgeIds.add(edge.id);
        } else if (edge.raw.target === selectedAgentId) {
          neighbourIds.add(edge.raw.source);
          highlightedEdgeIds.add(edge.id);
        }
      });
    }
    const isEdgeHighlighted = (link: GraphLink) => highlightedEdgeIds.has(link.id);
    const labelDisplay = () => (showEdgeLabels ? 'block' : 'none');

    if (graphNodes.length === 0) {
      svg
        .append('text')
        .attr('class', 'graph-empty')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('alignment-baseline', 'middle')
        .text('Start a council to build the discussion graph');
      return;
    }

    const simulation = d3
      .forceSimulation(graphNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(edges).id((d) => d.id).distance((d) => 150 + (d.pairTotal - 1) * 50).strength(1))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(66))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04));

    if (simulationRef.current) {
      simulationRef.current.stop();
    }
    simulationRef.current = simulation;

    const linkGroup = g.append('g').attr('class', 'links');

    const linkPath = linkGroup
      .selectAll<SVGPathElement, GraphLink>('path')
      .data(edges)
      .enter()
      .append('path')
      .attr('class', (d) => `link-path${hasSelection && isEdgeHighlighted(d) ? ' is-highlighted' : ''}${hasSelection && !isEdgeHighlighted(d) ? ' is-dimmed' : ''}`)
      .attr('stroke-width', (d) => (hasSelection && isEdgeHighlighted(d) ? 2.5 : 1.5))
      .attr('fill', 'none')
      .attr('stroke', (d) => (hasSelection && isEdgeHighlighted(d) ? '#8B5CF6' : '#334155'))
      .attr('stroke-opacity', (d) => (hasSelection && !isEdgeHighlighted(d) ? 0.32 : 0.92))
      .attr('stroke-linecap', 'round')
      .style('cursor', 'pointer')
      .on('click', (event) => {
        event.stopPropagation();
        onSelectAgent(undefined);
      });

    const linkLabelBg = linkGroup
      .selectAll<SVGRectElement, GraphLink>('rect')
      .data(edges)
      .enter()
      .append('rect')
      .attr('class', 'link-label-bg')
      .attr('rx', 4)
      .attr('ry', 4)
      .style('display', labelDisplay());

    const linkLabelText = linkGroup
      .selectAll<SVGTextElement, GraphLink>('text')
      .data(edges)
      .enter()
      .append('text')
      .attr('class', 'link-label')
      .text((d) => d.name)
      .attr('font-size', 9)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .style('font-family', 'system-ui, sans-serif')
      .style('display', labelDisplay());

    const nodeGroup = g.append('g').attr('class', 'nodes');
    const node = nodeGroup
      .selectAll<SVGGElement, GraphNode>('g')
      .data(graphNodes)
      .enter()
      .append('g')
      .attr('class', (d) => `graph-node${d.id === selectedAgentId ? ' is-selected' : ''}${activeAgentSet.has(d.id) ? ' is-speaking' : ''}${hasSelection && !neighbourIds.has(d.id) ? ' is-dimmed' : ''}`)
      .attr('cursor', 'pointer')
      .on('mouseenter', (event) => {
        d3.select(event.currentTarget as SVGGElement).classed('is-hovered', true);
      })
      .on('mouseleave', (event) => {
        d3.select(event.currentTarget as SVGGElement).classed('is-hovered', false);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        onSelectAgent(d.id);
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    node
      .filter((d) => activeAgentSet.has(d.id))
      .append('circle')
      .attr('class', 'graph-node-pulse')
      .attr('r', nodeRadius())
      .attr('stroke', (d) => d.color);

    node
      .append('circle')
      .attr('class', 'graph-node-dot')
      .attr('r', nodeRadius())
      .attr('fill', (d) => d.color)
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 3);

    node
      .filter((d) => Boolean(d.avatarUrl) && !activeAgentSet.has(d.id))
      .append('image')
      .attr('class', 'graph-node-avatar')
      .attr('href', (d) => d.avatarUrl ?? '')
      .attr('x', -nodeRadius())
      .attr('y', -nodeRadius())
      .attr('width', nodeRadius() * 2)
      .attr('height', nodeRadius() * 2)
      .attr('clip-path', (d) => `url(#${nodeClipId(d.id)})`)
      .attr('preserveAspectRatio', 'xMidYMid slice');

    node
      .filter((d) => Boolean(d.avatarUrl) && !activeAgentSet.has(d.id))
      .append('circle')
      .attr('class', 'graph-node-avatar-ring')
      .attr('r', nodeRadius())
      .attr('fill', 'none')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 3);

    node
      .append('path')
      .attr('class', 'graph-node-icon')
      .attr('d', (_, index) => agentIcons[index % agentIcons.length]);

    const nodeLabels = nodeGroup
      .selectAll<SVGTextElement, GraphNode>('text')
      .data(graphNodes)
      .enter()
      .append('text')
      .attr('class', 'graph-node-label')
      .text((d) => truncateNodeLabel(d.label))
      .attr('dx', 24)
      .attr('dy', 4);

    simulation.on('tick', () => {
      linkPath.attr('d', getLinkPath as any);
      linkLabelText.each(function (d) {
        const path = (d as any) as GraphLink & { source: GraphNode; target: GraphNode };
        const mid = getLinkMidpoint(path);
        d3.select(this).attr('x', mid.x).attr('y', mid.y);
      });
      linkLabelBg.each(function (d) {
        const path = (d as any) as GraphLink & { source: GraphNode; target: GraphNode };
        const mid = getLinkMidpoint(path);
        const textEl = d3.select(linkLabelText.nodes()[edges.indexOf(d)]).node();
        if (!textEl) return;
        const bbox = textEl.getBBox();
        d3.select(this)
          .attr('x', mid.x - bbox.width / 2 - 6)
          .attr('y', mid.y - bbox.height / 2 - 2)
          .attr('width', bbox.width + 12)
          .attr('height', bbox.height + 6);
      });

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      nodeLabels.attr('x', (d) => d.x ?? 0).attr('y', (d) => d.y ?? 0);
      graphNodes.forEach((item) => {
        if (typeof item.x === 'number' && typeof item.y === 'number') positionCacheRef.current.set(item.id, { x: item.x, y: item.y });
      });
    });

    svg.on('click', () => {
      onSelectAgent(undefined);
    });
  }

  function getLinkMidpoint(link: GraphLink & { source: GraphNode; target: GraphNode }) {
    const sx = link.source.x ?? 0;
    const sy = link.source.y ?? 0;
    const tx = link.target.x ?? 0;
    const ty = link.target.y ?? 0;

    if (link.curvature === 0) {
      return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
    }

    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const offsetRatio = 0.25 + link.pairTotal * 0.05;
    const baseOffset = Math.max(35, dist * offsetRatio);
    const offsetX = (-dy / dist) * link.curvature * baseOffset;
    const offsetY = (dx / dist) * link.curvature * baseOffset;
    const cx = (sx + tx) / 2 + offsetX;
    const cy = (sy + ty) / 2 + offsetY;

    const midX = 0.25 * sx + 0.5 * cx + 0.25 * tx;
    const midY = 0.25 * sy + 0.5 * cy + 0.25 * ty;
    return { x: midX, y: midY };
  }

  return { containerRef, svgRef };
}
