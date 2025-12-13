/**
 * AgentStatusPanel Component
 * Displays real-time status of AI agents in a HUD-style panel
 */

import React from 'react';
import {
  FileText, Book, PenTool, Mic, Shield, Volume2,
  GitBranch, CheckCircle, Users, Image,
  Loader2, Check, AlertCircle
} from 'lucide-react';

// Icon mapping
const ICONS = {
  FileText, Book, PenTool, Mic, Shield, Volume2,
  GitBranch, CheckCircle, Users, Image
};

function AgentStatusPanel({ agents = [], overallProgress = 0, activeAgent = null, compact = false }) {
  // Filter to only show relevant agents (those that are active, complete, or in error)
  const relevantAgents = compact
    ? agents.filter(a => a.status !== 'pending')
    : agents;

  if (relevantAgents.length === 0 && compact) {
    return null;
  }

  return (
    <div className="agent-status-panel">
      <div className="panel-header">
        <h3>AI AGENTS</h3>
        <div className="overall-progress">
          <div className="progress-bar" style={{ '--progress': `${overallProgress}%` }}>
            <div className="progress-fill" />
          </div>
          <span>{overallProgress}%</span>
        </div>
      </div>

      <div className="agents-list">
        {relevantAgents.map(agent => (
          <AgentRow key={agent.agent} agent={agent} isActive={activeAgent === agent.agent} />
        ))}
      </div>

      <style>{`
        .agent-status-panel {
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 12px;
          font-family: 'SF Mono', 'Fira Code', monospace;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .panel-header h3 {
          margin: 0;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1px;
          color: rgba(255, 255, 255, 0.7);
        }

        .overall-progress {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .overall-progress span {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.6);
          min-width: 32px;
          text-align: right;
        }

        .progress-bar {
          width: 60px;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          width: var(--progress, 0%);
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          transition: width 0.3s ease;
        }

        .agents-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
      `}</style>
    </div>
  );
}

function AgentRow({ agent, isActive }) {
  const IconComponent = ICONS[agent.icon] || CheckCircle;

  const getStatusIcon = () => {
    switch (agent.status) {
      case 'active':
        return <Loader2 className="status-icon spinning" size={14} />;
      case 'complete':
        return <Check className="status-icon complete" size={14} />;
      case 'error':
        return <AlertCircle className="status-icon error" size={14} />;
      default:
        return <div className="status-icon pending" />;
    }
  };

  const getStatusColor = () => {
    switch (agent.status) {
      case 'active': return '#3b82f6';
      case 'complete': return '#22c55e';
      case 'error': return '#ef4444';
      default: return 'rgba(255, 255, 255, 0.3)';
    }
  };

  return (
    <div className={`agent-row ${agent.status} ${isActive ? 'active-highlight' : ''}`}>
      <div className="agent-icon" style={{ color: getStatusColor() }}>
        <IconComponent size={14} />
      </div>
      <div className="agent-info">
        <div className="agent-name">{agent.name}</div>
        {agent.message && (
          <div className="agent-message">{agent.message}</div>
        )}
      </div>
      <div className="agent-status">
        {getStatusIcon()}
      </div>

      {agent.status === 'active' && agent.progress > 0 && (
        <div className="agent-progress-bar">
          <div className="agent-progress-fill" style={{ width: `${agent.progress}%` }} />
        </div>
      )}

      <style>{`
        .agent-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 4px;
          position: relative;
          overflow: hidden;
          transition: background 0.2s;
        }

        .agent-row.active-highlight {
          background: rgba(59, 130, 246, 0.1);
          border-left: 2px solid #3b82f6;
        }

        .agent-row.complete {
          opacity: 0.7;
        }

        .agent-row.pending {
          opacity: 0.4;
        }

        .agent-icon {
          width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .agent-info {
          flex: 1;
          min-width: 0;
        }

        .agent-name {
          font-size: 12px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
        }

        .agent-message {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .agent-status {
          width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-icon {
          opacity: 0.8;
        }

        .status-icon.spinning {
          animation: spin 1s linear infinite;
          color: #3b82f6;
        }

        .status-icon.complete {
          color: #22c55e;
        }

        .status-icon.error {
          color: #ef4444;
        }

        .status-icon.pending {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .agent-progress-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: rgba(255, 255, 255, 0.05);
        }

        .agent-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          transition: width 0.3s ease;
        }
      `}</style>
    </div>
  );
}

export default AgentStatusPanel;
