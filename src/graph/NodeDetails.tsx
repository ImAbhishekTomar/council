import type { CSSProperties } from 'react';
import { agentIcons } from './agentIcons';
import type { Agent } from './types';

function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function renderNodeValue(value: string | null) {
  if (value === null || value === '') {
    return <span className="node-value-null">null</span>;
  }
  return value;
}

type NodeDetailsProps = {
  agent: Agent;
  agentIndex: number;
  onClose: () => void;
};

export default function NodeDetails({ agent: selectedAgent, agentIndex: selectedAgentIndex, onClose }: NodeDetailsProps) {
  return (
        <aside className="node-details" style={{ '--agent-color': selectedAgent.color } as CSSProperties} onClick={(event) => event.stopPropagation()}>
          <div className="node-details-titlebar">
            <strong>Node Details</strong>
            <div className="node-details-titlebar-right">
              <span className="node-type-pill">{selectedAgent.labels[selectedAgent.labels.length - 1] ?? 'Person'}</span>
              <button type="button" className="node-details-close" onClick={onClose} title="Close node details">
                ×
              </button>
            </div>
          </div>

          <div className="node-details-body">
            <div className="node-details-identity">
              <div className="node-details-avatar" style={{ '--agent-color': selectedAgent.color } as CSSProperties}>
                {selectedAgent.avatarUrl
                  ? <><img alt={`${selectedAgent.name} avatar`} loading="lazy" src={selectedAgent.avatarUrl} /><span className="agent-icon-badge" aria-hidden="true"><svg viewBox="-10 -10 20 20"><path d={agentIcons[selectedAgentIndex % agentIcons.length]} /></svg></span></>
                  : <svg className="details-agent-icon" viewBox="-10 -10 20 20" aria-hidden="true"><path d={agentIcons[selectedAgentIndex % agentIcons.length]} /></svg>}
              </div>
              <div>
                <strong>{selectedAgent.name}</strong>
                <span>{selectedAgent.role}</span>
              </div>
            </div>

            <hr className="node-divider" />

            <dl className="node-field-grid">
              <dt>Name:</dt>
              <dd className="node-field-name">{selectedAgent.name}</dd>
              <dt>UUID:</dt>
              <dd className="node-field-uuid">{selectedAgent.uuid}</dd>
              <dt>Created:</dt>
              <dd>{formatCreated(selectedAgent.createdAt)}</dd>
            </dl>

            <hr className="node-divider" />

            <div className="node-section-title">Properties:</div>
            <dl className="node-field-grid">
              <dt>Role:</dt>
              <dd>{selectedAgent.role}</dd>
              {selectedAgent.fullName && (
                <>
                  <dt>Full name:</dt>
                  <dd>{selectedAgent.fullName}</dd>
                </>
              )}
              {selectedAgent.userRole && (
                <>
                  <dt>User role:</dt>
                  <dd>{selectedAgent.userRole}</dd>
                </>
              )}
              <dt>Status:</dt>
              <dd>{selectedAgent.activityStatus}</dd>
              <dt>Model:</dt>
              <dd>{selectedAgent.model}</dd>
              <dt>Confidence:</dt>
              <dd>{Math.round(selectedAgent.confidence * 100)}%</dd>
            </dl>

            <hr className="node-divider" />

            <div className="node-section-title">Agent Profile:</div>
            <dl className="node-field-grid">
              <dt>Phase:</dt>
              <dd>{selectedAgent.phase}</dd>
              <dt>Category:</dt>
              <dd>{selectedAgent.category}</dd>
              <dt>Style:</dt>
              <dd>{selectedAgent.profile.speakingStyle}</dd>
              <dt>Temperament:</dt>
              <dd>{selectedAgent.profile.temperament}</dd>
              <dt>Expertise:</dt>
              <dd>{selectedAgent.profile.expertise}</dd>
              <dt>Memory:</dt>
              <dd>{selectedAgent.profile.memoryStyle}</dd>
              <dt>Risk bias:</dt>
              <dd>{selectedAgent.profile.riskBias}</dd>
              <dt>Goals:</dt>
              <dd>{selectedAgent.profile.goals}</dd>
              <dt>Constraints:</dt>
              <dd>{selectedAgent.profile.constraints}</dd>
              <dt>LLM:</dt>
              <dd>{Object.values(selectedAgent.llmSettings).every((value) => value === null)
                ? 'Generation settings managed by the host'
                : `temp ${selectedAgent.llmSettings.temperature ?? '—'}, top_p ${selectedAgent.llmSettings.topP ?? '—'}, max ${selectedAgent.llmSettings.maxOutputTokens ?? '—'}, freq ${selectedAgent.llmSettings.frequencyPenalty ?? '—'}, presence ${selectedAgent.llmSettings.presencePenalty ?? '—'}`}</dd>
            </dl>

            <hr className="node-divider" />

            <div className="node-section-title">Summary:</div>
            <p className="node-summary">{selectedAgent.summary}</p>

            <hr className="node-divider" />

            <div className="node-section-title">Labels:</div>
            <div className="node-label-chips">
              {selectedAgent.labels.map((label) => (
                <span className="node-label-chip" key={label}>{label}</span>
              ))}
            </div>
          </div>
        </aside>
  );
}
