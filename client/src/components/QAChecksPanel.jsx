/**
 * QAChecksPanel Component
 * Displays individual QA check statuses
 */

import React, { useState, useEffect } from 'react';
import {
  Shield, Sliders, GitBranch, Sparkles,
  Check, Loader2, AlertTriangle, X, ChevronDown, ChevronUp
} from 'lucide-react';

const QA_CHECKS = {
  safety: { name: 'Content Safety', icon: Shield, description: 'Ensuring content guidelines' },
  sliders: { name: 'Slider Compliance', icon: Sliders, description: 'Verifying mood/genre settings' },
  continuity: { name: 'Story Continuity', icon: GitBranch, description: 'Checking plot consistency' },
  engagement: { name: 'Engagement Level', icon: Sparkles, description: 'Analyzing story engagement' }
};

function QAChecksPanel({ compact = false }) {
  const [checks, setChecks] = useState({
    safety: { status: 'pending', message: '' },
    sliders: { status: 'pending', message: '' },
    continuity: { status: 'pending', message: '' },
    engagement: { status: 'pending', message: '' }
  });
  const [expanded, setExpanded] = useState(!compact);

  // Listen for QA check updates
  useEffect(() => {
    const handleQAUpdate = (event) => {
      if (event.detail) {
        const { checkName, status, message, details } = event.detail;
        if (checks[checkName]) {
          setChecks(prev => ({
            ...prev,
            [checkName]: { status, message, details }
          }));
        }
      }
    };

    window.addEventListener('qa-check-update', handleQAUpdate);
    return () => window.removeEventListener('qa-check-update', handleQAUpdate);
  }, []);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'passed':
        return <Check size={14} className="status-passed" />;
      case 'running':
        return <Loader2 size={14} className="status-running" />;
      case 'warning':
        return <AlertTriangle size={14} className="status-warning" />;
      case 'failed':
        return <X size={14} className="status-failed" />;
      default:
        return <div className="status-pending" />;
    }
  };

  const allPassed = Object.values(checks).every(c => c.status === 'passed');
  const hasWarning = Object.values(checks).some(c => c.status === 'warning');
  const hasFailed = Object.values(checks).some(c => c.status === 'failed');
  const isRunning = Object.values(checks).some(c => c.status === 'running');

  const overallStatus = hasFailed ? 'failed' : hasWarning ? 'warning' : allPassed ? 'passed' : isRunning ? 'running' : 'pending';

  return (
    <div className={`qa-panel ${overallStatus}`}>
      <button
        className="qa-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="qa-icon">
          {getStatusIcon(overallStatus)}
        </div>
        <div className="qa-summary">
          <div className="qa-title">Quality Checks</div>
          <div className="qa-status-text">
            {hasFailed && 'Issues found'}
            {!hasFailed && hasWarning && 'Passed with warnings'}
            {!hasFailed && !hasWarning && allPassed && 'All checks passed'}
            {!hasFailed && !hasWarning && !allPassed && isRunning && 'Running checks...'}
            {!hasFailed && !hasWarning && !allPassed && !isRunning && 'Pending'}
          </div>
        </div>
        <div className="expand-icon">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="qa-details">
          {Object.entries(QA_CHECKS).map(([key, config]) => {
            const check = checks[key] || { status: 'pending', message: '' };
            const IconComponent = config.icon;

            return (
              <div key={key} className={`qa-check ${check.status}`}>
                <div className="check-icon">
                  <IconComponent size={14} />
                </div>
                <div className="check-info">
                  <div className="check-name">{config.name}</div>
                  <div className="check-message">
                    {check.message || config.description}
                  </div>
                </div>
                <div className="check-status">
                  {getStatusIcon(check.status)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .qa-panel {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }

        .qa-panel.passed {
          border-color: rgba(34, 197, 94, 0.3);
        }

        .qa-panel.warning {
          border-color: rgba(245, 158, 11, 0.3);
        }

        .qa-panel.failed {
          border-color: rgba(239, 68, 68, 0.3);
        }

        .qa-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.9);
          text-align: left;
          transition: background 0.2s;
        }

        .qa-header:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .qa-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(34, 197, 94, 0.2);
          border-radius: 6px;
        }

        .qa-panel.warning .qa-icon {
          background: rgba(245, 158, 11, 0.2);
        }

        .qa-panel.failed .qa-icon {
          background: rgba(239, 68, 68, 0.2);
        }

        .qa-summary {
          flex: 1;
        }

        .qa-title {
          font-size: 14px;
          font-weight: 500;
        }

        .qa-status-text {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 2px;
        }

        .expand-icon {
          color: rgba(255, 255, 255, 0.5);
        }

        .qa-details {
          padding: 0 12px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 8px;
        }

        .qa-check {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 6px;
        }

        .qa-check.passed {
          opacity: 0.7;
        }

        .qa-check.running {
          background: rgba(59, 130, 246, 0.1);
        }

        .qa-check.warning {
          background: rgba(245, 158, 11, 0.1);
        }

        .qa-check.failed {
          background: rgba(239, 68, 68, 0.1);
        }

        .check-icon {
          color: rgba(255, 255, 255, 0.5);
        }

        .check-info {
          flex: 1;
          min-width: 0;
        }

        .check-name {
          font-size: 12px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
        }

        .check-message {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 2px;
        }

        .check-status {
          width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-passed {
          color: #22c55e;
        }

        .status-running {
          color: #3b82f6;
          animation: spin 1s linear infinite;
        }

        .status-warning {
          color: #f59e0b;
        }

        .status-failed {
          color: #ef4444;
        }

        .status-pending {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Export a hook to update QA checks from socket events
export function useQAChecks(socket) {
  useEffect(() => {
    if (!socket) return;

    const handleQAUpdate = (data) => {
      // Dispatch custom event for the panel to listen to
      window.dispatchEvent(new CustomEvent('qa-check-update', { detail: data }));
    };

    socket.on('qa-check-update', handleQAUpdate);
    return () => socket.off('qa-check-update', handleQAUpdate);
  }, [socket]);
}

export default QAChecksPanel;
