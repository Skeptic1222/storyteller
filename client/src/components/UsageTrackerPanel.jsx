/**
 * UsageTrackerPanel Component
 * Displays real-time API usage and cost tracking
 * Collapsible badge view - shows only total cost, expands to show details
 */

import React, { useState } from 'react';
import { DollarSign, Zap, Mic2, Image, MessageCircle, ChevronDown, Sparkles } from 'lucide-react';

function UsageTrackerPanel({
  usage,
  formatCost,
  formatTokens,
  formatCharacters,
  compact = false
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!usage) return null;

  const hasActivity = usage.total?.cost > 0 ||
    usage.elevenlabs?.characters > 0 ||
    usage.openai?.inputTokens > 0 ||
    usage.falai?.count > 0;

  if (!hasActivity && compact) return null;

  const totalCost = usage.total?.formatted || '$0.0000';

  // Collapsed badge view - just shows total cost
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="usage-tracker-badge"
        title="Click to expand usage details"
      >
        <DollarSign size={14} />
        <span className="badge-cost">{totalCost}</span>
        <ChevronDown size={12} className="chevron" />

        <style>{`
          .usage-tracker-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 20px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            cursor: pointer;
            transition: all 0.2s;
            color: #22c55e;
          }

          .usage-tracker-badge:hover {
            background: rgba(0, 0, 0, 0.8);
            border-color: rgba(34, 197, 94, 0.5);
          }

          .badge-cost {
            font-size: 13px;
            font-weight: 600;
          }

          .chevron {
            opacity: 0.6;
            transition: transform 0.2s;
          }

          .usage-tracker-badge:hover .chevron {
            opacity: 1;
          }
        `}</style>
      </button>
    );
  }

  // Expanded view with full details
  return (
    <div className="usage-tracker-panel">
      <button
        onClick={() => setIsExpanded(false)}
        className="panel-header"
      >
        <h3>USAGE TRACKER</h3>
        <div className="total-cost">
          <DollarSign size={12} />
          <span>{totalCost}</span>
          <ChevronDown size={12} className="chevron expanded" />
        </div>
      </button>

      <div className="usage-grid">
        {/* ElevenLabs */}
        <UsageItem
          icon={<Mic2 size={14} />}
          label="ElevenLabs"
          value={formatCharacters(usage.elevenlabs?.characters || 0)}
          subValue="chars"
          cost={formatCost(usage.elevenlabs?.cost)}
          color="#8b5cf6"
        />

        {/* OpenAI */}
        <UsageItem
          icon={<MessageCircle size={14} />}
          label="OpenAI"
          value={formatTokens((usage.openai?.inputTokens || 0) + (usage.openai?.outputTokens || 0))}
          subValue="tokens"
          cost={formatCost(usage.openai?.cost)}
          color="#22c55e"
        />

        {/* DALL-E Images */}
        {usage.images?.count > 0 && (
          <UsageItem
            icon={<Image size={14} />}
            label="DALL-E"
            value={usage.images?.count || 0}
            subValue="images"
            cost={formatCost(usage.images?.cost)}
            color="#f59e0b"
          />
        )}

        {/* Fal AI Images */}
        {usage.falai?.count > 0 && (
          <UsageItem
            icon={<Sparkles size={14} />}
            label="Fal AI"
            value={usage.falai?.count || 0}
            subValue="images"
            cost={formatCost(usage.falai?.cost)}
            color="#ec4899"
          />
        )}

        {/* Whisper */}
        {usage.whisper?.minutes > 0 && (
          <UsageItem
            icon={<Zap size={14} />}
            label="Whisper"
            value={(usage.whisper?.minutes || 0).toFixed(1)}
            subValue="min"
            cost={formatCost(usage.whisper?.cost)}
            color="#3b82f6"
          />
        )}
      </div>

      {/* Model breakdown (if available and not compact) */}
      {!compact && Object.keys(usage.openai?.byModel || {}).length > 0 && (
        <div className="model-breakdown">
          <div className="breakdown-header">Model Breakdown</div>
          {Object.entries(usage.openai.byModel).map(([model, data]) => (
            <div key={model} className="model-row">
              <span className="model-name">{model}</span>
              <span className="model-tokens">
                {formatTokens(data.input)}/{formatTokens(data.output)}
              </span>
              <span className="model-cost">{formatCost(data.cost)}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .usage-tracker-panel {
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          cursor: pointer;
          transition: background 0.2s;
          width: 100%;
          background: transparent;
          border: none;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .panel-header:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .panel-header h3 {
          margin: 0;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1px;
          color: rgba(255, 255, 255, 0.7);
        }

        .total-cost {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 14px;
          font-weight: 600;
          color: #22c55e;
        }

        .chevron {
          opacity: 0.6;
          transition: transform 0.2s;
        }

        .chevron.expanded {
          transform: rotate(180deg);
        }

        .usage-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          padding: 12px;
        }

        .model-breakdown {
          margin: 0 12px 12px 12px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .breakdown-header {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 6px;
        }

        .model-row {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          padding: 4px 0;
          color: rgba(255, 255, 255, 0.6);
        }

        .model-name {
          flex: 1;
        }

        .model-tokens {
          flex: 1;
          text-align: center;
        }

        .model-cost {
          flex: 1;
          text-align: right;
          color: rgba(255, 255, 255, 0.8);
        }
      `}</style>
    </div>
  );
}

function UsageItem({ icon, label, value, subValue, cost, color }) {
  return (
    <div className="usage-item" style={{ '--accent-color': color }}>
      <div className="usage-icon">{icon}</div>
      <div className="usage-details">
        <div className="usage-label">{label}</div>
        <div className="usage-value">
          <span className="value">{value}</span>
          <span className="sub">{subValue}</span>
        </div>
      </div>
      <div className="usage-cost">{cost}</div>

      <style>{`
        .usage-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 4px;
          border-left: 2px solid var(--accent-color, #3b82f6);
        }

        .usage-icon {
          color: var(--accent-color, #3b82f6);
          opacity: 0.8;
        }

        .usage-details {
          flex: 1;
          min-width: 0;
        }

        .usage-label {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
        }

        .usage-value {
          font-size: 12px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
        }

        .usage-value .sub {
          font-size: 10px;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.4);
          margin-left: 2px;
        }

        .usage-cost {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.6);
        }
      `}</style>
    </div>
  );
}

export default UsageTrackerPanel;
