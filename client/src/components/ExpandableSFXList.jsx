/**
 * ExpandableSFXList Component
 * Displays a list of sound effects with expandable details
 * Enhanced with animated waveforms, pulse effects, and modern UI
 */

import React, { useState } from 'react';
import {
  Volume2, ChevronDown, ChevronUp,
  Cloud, Footprints, DoorOpen, Sparkles, Wind, Zap,
  Check, Loader2, AlertCircle, Database, Activity
} from 'lucide-react';

// Category icons
const CATEGORY_ICONS = {
  weather: Cloud,
  footsteps: Footprints,
  doors: DoorOpen,
  magic: Sparkles,
  ambient: Wind,
  action: Zap,
  default: Volume2
};

// Estimated cost per generated SFX (ElevenLabs Sound Effects ~$0.10-0.30 per generation)
const ESTIMATED_COST_PER_SFX = 0.15;

/**
 * Animated waveform bars component
 */
function WaveformAnimation({ isActive = false, color = '#a78bfa' }) {
  const bars = [0, 1, 2, 3];

  return (
    <div className="waveform-container">
      {bars.map(i => (
        <div
          key={i}
          className={`waveform-bar ${isActive ? 'active' : ''}`}
          style={{
            '--bar-delay': `${i * 0.1}s`,
            backgroundColor: color
          }}
        />
      ))}
    </div>
  );
}

/**
 * Pulse ring effect for active/generating states
 */
function PulseRing({ color = 'rgba(139, 92, 246, 0.6)' }) {
  return (
    <div
      className="pulse-ring"
      style={{ '--pulse-color': color }}
    />
  );
}

function ExpandableSFXList({
  sfxList = [],
  sfxCount = 0,
  cachedCount = 0,
  generatingCount = 0,
  totalInLibrary = 0,
  compact = false,
  sfxEnabled = true,
  isAnalyzing = false
}) {
  // Calculate estimated cost for new SFX generation
  const estimatedCost = generatingCount > 0 ? (generatingCount * ESTIMATED_COST_PER_SFX).toFixed(2) : null;
  const [expanded, setExpanded] = useState(false);

  // Calculate unique sounds (distinct keys/names)
  const uniqueSoundKeys = new Set(sfxList.map(sfx => sfx.key || sfx.name));
  const uniqueSoundCount = uniqueSoundKeys.size;

  // Opportunities = total placements, Unique = distinct sounds
  const opportunityCount = sfxCount || sfxList.length;

  // Determine if there's activity (analyzing or generating)
  const hasActivity = isAnalyzing || generatingCount > 0;

  const getCategoryIcon = (category) => {
    const IconComponent = CATEGORY_ICONS[category?.toLowerCase()] || CATEGORY_ICONS.default;
    return <IconComponent size={14} />;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'cached':
        return <Check size={12} className="status-cached" />;
      case 'generating':
        return <Loader2 size={12} className="status-generating" />;
      case 'complete':
        return <Check size={12} className="status-complete" />;
      case 'error':
        return <AlertCircle size={12} className="status-error" />;
      default:
        return <Database size={12} className="status-default" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'cached': return '#22c55e';
      case 'generating': return '#f59e0b';
      case 'complete': return '#22c55e';
      case 'error': return '#ef4444';
      default: return 'rgba(255, 255, 255, 0.3)';
    }
  };

  return (
    <div className="sfx-list-panel">
      <button
        className={`sfx-header ${hasActivity ? 'active' : ''}`}
        onClick={() => setExpanded(!expanded)}
        disabled={sfxList.length === 0}
      >
        <div className="sfx-icon-container">
          <div className={`sfx-icon ${hasActivity ? 'active' : ''}`}>
            {isAnalyzing ? (
              <Activity size={16} className="pulse-scale" />
            ) : (
              <Volume2 size={16} />
            )}
            {hasActivity && <PulseRing />}
          </div>
          {!isAnalyzing && opportunityCount > 0 && (
            <WaveformAnimation isActive={generatingCount > 0} />
          )}
        </div>

        <div className="sfx-summary">
          <div className="sfx-count">
            {!sfxEnabled
              ? 'Sound Effects Disabled'
              : isAnalyzing
                ? 'Analyzing Scene...'
                : opportunityCount > 0
                  ? `${opportunityCount} Sound Opportunities`
                  : 'Sound Effects Enabled'}
          </div>
          <div className="sfx-breakdown">
            {isAnalyzing && (
              <span className="analyzing">
                <Loader2 size={10} className="spin inline" /> AI scanning...
              </span>
            )}
            {!isAnalyzing && opportunityCount > 0 && (
              <>
                <span className="badge unique">
                  <Sparkles size={10} />
                  {uniqueSoundCount} unique
                </span>
                {cachedCount > 0 && (
                  <span className="badge cached">
                    <Database size={10} />
                    {cachedCount} from library
                  </span>
                )}
                {generatingCount > 0 && (
                  <span className="badge generating">
                    <Loader2 size={10} className="spin" />
                    {generatingCount} generating
                  </span>
                )}
                {estimatedCost && generatingCount > 0 && (
                  <span className="badge cost">
                    <Zap size={10} />
                    ~${estimatedCost} est.
                  </span>
                )}
              </>
            )}
            {!isAnalyzing && sfxCount === 0 && sfxEnabled && (
              <span className="pending">Scene analysis pending</span>
            )}
          </div>
        </div>

        {sfxList.length > 0 && (
          <div className="expand-icon">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        )}
      </button>

      {expanded && sfxList.length > 0 && (
        <div className="sfx-details">
          {sfxList.map((sfx, index) => (
            <div
              key={sfx.key || index}
              className={`sfx-item ${sfx.status}`}
              style={{ '--item-delay': `${index * 0.05}s` }}
            >
              <div className="sfx-item-icon">
                <div className="sfx-category-icon">
                  {getCategoryIcon(sfx.category)}
                </div>
                {sfx.status === 'generating' && (
                  <div className="sfx-item-pulse-ring" />
                )}
              </div>

              <div className="sfx-item-content">
                <div className="sfx-name">{sfx.name}</div>
                {sfx.status === 'generating' && (
                  <WaveformAnimation
                    isActive={true}
                    color={getStatusColor(sfx.status)}
                  />
                )}
              </div>

              <div className="sfx-status-icon">
                {getStatusIcon(sfx.status)}
              </div>
            </div>
          ))}

          {totalInLibrary > 0 && (
            <div className="library-info">
              <Database size={12} />
              <span>SFX library: {totalInLibrary} total sounds available</span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .sfx-list-panel {
          background: linear-gradient(135deg, rgba(0, 0, 0, 0.5) 0%, rgba(20, 20, 30, 0.6) 100%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
          transition: all 0.3s ease;
        }

        .sfx-list-panel:hover {
          border-color: rgba(255, 255, 255, 0.2);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        }

        .sfx-header {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.9);
          text-align: left;
          transition: all 0.3s ease;
          position: relative;
        }

        .sfx-header.active::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at top left, rgba(139, 92, 246, 0.1), transparent 70%);
          pointer-events: none;
        }

        .sfx-header:not(:disabled):hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .sfx-header:disabled {
          cursor: default;
          opacity: 0.6;
        }

        .sfx-icon-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .sfx-icon {
          position: relative;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.2));
          border-radius: 10px;
          color: #a78bfa;
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(139, 92, 246, 0.2);
        }

        .sfx-icon.active {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(99, 102, 241, 0.3));
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
        }

        .pulse-scale {
          animation: pulse-scale 2s ease-in-out infinite;
        }

        @keyframes pulse-scale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }

        .pulse-ring {
          position: absolute;
          inset: -4px;
          border: 2px solid var(--pulse-color, rgba(139, 92, 246, 0.6));
          border-radius: 12px;
          animation: pulse-ring 2s ease-out infinite;
          pointer-events: none;
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(1.3);
            opacity: 0;
          }
        }

        .waveform-container {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 20px;
        }

        .waveform-bar {
          width: 3px;
          height: 4px;
          background: rgba(167, 139, 250, 0.4);
          border-radius: 2px;
          transition: all 0.2s ease;
        }

        .waveform-bar.active {
          animation: waveform 0.8s ease-in-out infinite;
          animation-delay: var(--bar-delay, 0s);
        }

        @keyframes waveform {
          0%, 100% {
            height: 4px;
            opacity: 0.5;
          }
          50% {
            height: 20px;
            opacity: 1;
          }
        }

        .sfx-summary {
          flex: 1;
          min-width: 0;
        }

        .sfx-count {
          font-size: 14px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          margin-bottom: 4px;
        }

        .sfx-breakdown {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          font-size: 11px;
        }

        .sfx-breakdown .badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 12px;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .sfx-breakdown .badge:hover {
          transform: translateY(-1px);
        }

        .sfx-breakdown .unique {
          background: rgba(34, 211, 238, 0.2);
          color: #22d3ee;
          border: 1px solid rgba(34, 211, 238, 0.3);
        }

        .sfx-breakdown .cached {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border: 1px solid rgba(34, 197, 94, 0.3);
        }

        .sfx-breakdown .generating {
          background: rgba(245, 158, 11, 0.2);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.3);
          animation: badge-pulse 2s ease-in-out infinite;
        }

        .sfx-breakdown .cost {
          background: rgba(251, 113, 133, 0.2);
          color: #fb7185;
          border: 1px solid rgba(251, 113, 133, 0.3);
        }

        @keyframes badge-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .sfx-breakdown .analyzing {
          color: #a78bfa;
          display: flex;
          align-items: center;
          gap: 4px;
          font-style: italic;
        }

        .sfx-breakdown .pending {
          color: rgba(255, 255, 255, 0.5);
          font-style: italic;
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        .inline {
          display: inline-block;
          vertical-align: middle;
        }

        .expand-icon {
          color: rgba(255, 255, 255, 0.5);
          transition: all 0.3s ease;
        }

        .sfx-header:hover .expand-icon {
          color: rgba(255, 255, 255, 0.8);
          transform: translateY(1px);
        }

        .sfx-details {
          padding: 0 14px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 10px;
          max-height: 300px;
          overflow-y: auto;
          animation: slide-down 0.3s ease-out;
        }

        @keyframes slide-down {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Custom scrollbar */
        .sfx-details::-webkit-scrollbar {
          width: 6px;
        }

        .sfx-details::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }

        .sfx-details::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.4);
          border-radius: 3px;
        }

        .sfx-details::-webkit-scrollbar-thumb:hover {
          background: rgba(139, 92, 246, 0.6);
        }

        .sfx-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          font-size: 12px;
          transition: all 0.3s ease;
          animation: item-fade-in 0.4s ease-out;
          animation-delay: var(--item-delay, 0s);
          animation-fill-mode: both;
        }

        @keyframes item-fade-in {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .sfx-item:hover {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
          border-color: rgba(255, 255, 255, 0.15);
          transform: translateX(2px);
        }

        .sfx-item.cached {
          opacity: 0.8;
          border-left: 3px solid #22c55e;
        }

        .sfx-item.generating {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
          border-left: 3px solid #f59e0b;
        }

        .sfx-item.error {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
          border-left: 3px solid #ef4444;
        }

        .sfx-item-icon {
          position: relative;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          flex-shrink: 0;
        }

        .sfx-item-pulse-ring {
          position: absolute;
          inset: -3px;
          border: 2px solid rgba(245, 158, 11, 0.4);
          border-radius: 8px;
          animation: pulse-ring 1.5s ease-out infinite;
        }

        .sfx-category-icon {
          color: rgba(255, 255, 255, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sfx-item-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sfx-name {
          color: rgba(255, 255, 255, 0.9);
          text-transform: capitalize;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sfx-status-icon {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .status-cached {
          color: #22c55e;
        }

        .status-generating {
          color: #f59e0b;
          animation: spin 1s linear infinite;
        }

        .status-complete {
          color: #22c55e;
          animation: check-pop 0.3s ease-out;
        }

        @keyframes check-pop {
          0% { transform: scale(0); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }

        .status-error {
          color: #ef4444;
          animation: shake 0.4s ease-in-out;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px); }
          75% { transform: translateX(3px); }
        }

        .status-default {
          color: rgba(255, 255, 255, 0.3);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .library-info {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          margin-top: 4px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          background: rgba(0, 0, 0, 0.2);
          border-radius: 6px;
          border: 1px dashed rgba(255, 255, 255, 0.1);
        }

        /* Responsive adjustments */
        @media (max-width: 640px) {
          .sfx-header {
            padding: 12px;
            gap: 10px;
          }

          .sfx-icon {
            width: 36px;
            height: 36px;
          }

          .sfx-count {
            font-size: 13px;
          }

          .sfx-breakdown {
            gap: 4px;
          }

          .sfx-breakdown .badge {
            padding: 2px 6px;
            font-size: 10px;
          }
        }
      `}</style>
    </div>
  );
}

export default ExpandableSFXList;
