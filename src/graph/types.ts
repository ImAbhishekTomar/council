import type { CSSProperties } from 'react';

export type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  category: 'coding' | 'trading' | 'creative' | 'general';
  phase: 'discussion' | 'frame' | 'perspective' | 'critique' | 'build' | 'synthesize';
  profile: {
    temperament: string;
    expertise: string;
    memoryStyle: string;
    riskBias: string;
    speakingStyle: string;
    goals: string;
    constraints: string;
  };
  llmSettings: {
    temperature: number | null;
    topP: number | null;
    maxOutputTokens: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
  };
  color: string;
  confidence: number;
  uuid: string;
  fullName: string | null;
  userRole: string | null;
  summary: string;
  labels: string[];
  createdAt: string;
  avatarUrl?: string;
  activityStatus: 'thinking' | 'speaking' | 'done' | 'failed';
};

export type AgentNodeData = {
  agent: Agent;
  active: boolean;
  isHub?: boolean;
};

export type GraphNode = {
  id: string;
  label: string;
  subtitle: string;
  color: string;
  avatarUrl?: string;
  active: boolean;
  raw: Agent;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

export type GraphLink = {
  id: string;
  source: string;
  target: string;
  name: string;
  curvature: number;
  pairTotal: number;
  raw: {
    source: string;
    target: string;
  };
};

export type AppEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  type?: string;
  style?: CSSProperties;
};

export type GraphPanelProps = {
  nodes: { id: string; data: AgentNodeData; position?: { x: number; y: number }; draggable?: boolean }[];
  edges: AppEdge[];
  activeAgentIds: string[];
  selectedAgentId?: string;
  onSelectAgent: (id?: string) => void;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
};
