import { useEffect, useMemo, useState } from 'react';
import GraphPanel from './GraphPanel';

type Agent = {
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
  parentId?: string;
};

type Link = { from: string; to: string; label: string; updatedAt: string };
type Run = {
  id: string;
  question: string;
  status: 'active' | 'complete' | 'error';
  startedAt: string;
  agents: Agent[];
  links: Link[];
  answer?: string;
  confidence?: number;
  error?: string;
};

type GraphNode = { id: string; data: { agent: Agent; active: boolean; isHub?: boolean }; draggable?: boolean };
type GraphEdge = { id: string; source: string; target: string; label: string; animated?: boolean };

function useRun(runId: string | null) {
  const [run, setRun] = useState<Run | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data: Run | null) => { if (alive && data) setRun(data); })
      .catch(() => undefined);
    const stream = new EventSource(`/api/events?runId=${encodeURIComponent(runId)}`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data) as { run: Run };
      if (alive) setRun(event.run);
    };
    return () => { alive = false; stream.close(); };
  }, [runId]);

  return { run, connected };
}

export function Dashboard() {
  const params = new URLSearchParams(window.location.search);
  const runId = params.get('run');
  const { run, connected } = useRun(runId);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);

  const nodes = useMemo<GraphNode[]>(() => (run?.agents ?? []).map((agent) => ({
    id: agent.id,
    data: { agent, active: agent.activityStatus === 'thinking' || agent.activityStatus === 'speaking', isHub: agent.id === 'atom' },
    draggable: true,
  })), [run?.agents]);
  const edges = useMemo<GraphEdge[]>(() => (run?.links ?? []).map((link, index) => ({
    id: `${link.from}-${link.to}-${index}`,
    source: link.from,
    target: link.to,
    label: link.label,
    animated: true,
  })), [run?.links]);
  const activeAgentIds = useMemo(() => (run?.agents ?? []).filter((agent) => agent.activityStatus === 'thinking' || agent.activityStatus === 'speaking').map((agent) => agent.id), [run?.agents]);
  const status = !connected
    ? 'Reconnecting'
    : run?.status === 'complete'
      ? 'Session complete'
      : run?.status === 'error'
        ? 'Session error'
        : 'Live';

  if (!runId) return <main className="empty-page"><span className="brand-mark">C</span><h1>No session selected</h1><p>Start a Council session to open its live graph.</p></main>;
  if (!run) return <main className="empty-page"><span className="brand-mark">C</span><h1>Connecting to Council</h1><p>The local session is loading…</p></main>;

  return <main className="dashboard">
    <header className="dashboard-header">
      <div className="brand"><span className="brand-mark">C</span><span>Council<small>live session</small></span></div>
      <div className="session-question"><span>Question</span><p>{run.question}</p></div>
      <div className={`connection ${connected && run.status === 'active' ? 'is-connected' : ''}`}><i />{status}</div>
    </header>
    <section className="graph-panel" aria-label="Council agent graph">
      <GraphPanel
        nodes={nodes}
        edges={edges}
        activeAgentIds={activeAgentIds}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        showEdgeLabels={showEdgeLabels}
        onToggleEdgeLabels={() => setShowEdgeLabels((value) => !value)}
      />
    </section>
  </main>;
}
