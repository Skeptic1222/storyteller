/**
 * MiniAgentGauge Component
 * Small circular gauge showing individual agent status.
 *
 * States:
 * - pending: Gray ring, "Waiting" label
 * - active: Animated ring fill, percentage, pulse effect
 * - complete: Full green ring, checkmark, duration shown
 * - error: Red ring, retry indicator
 */

import { memo } from 'react';
import { Check, Loader2, Clock, AlertCircle } from 'lucide-react';

const STATUS_COLORS = {
  pending: {
    stroke: '#475569',      // slate-600
    bg: '#1e293b',          // slate-800
    text: '#94a3b8',        // slate-400
    glow: 'transparent'
  },
  active: {
    stroke: '#fbbf24',      // golden-400
    bg: '#292524',          // warm dark
    text: '#fbbf24',        // golden-400
    glow: 'rgba(251, 191, 36, 0.3)'
  },
  complete: {
    stroke: '#10b981',      // emerald-500
    bg: '#064e3b',          // emerald-900
    text: '#10b981',        // emerald-500
    glow: 'rgba(16, 185, 129, 0.2)'
  },
  error: {
    stroke: '#ef4444',      // red-500
    bg: '#450a0a',          // red-950
    text: '#ef4444',        // red-500
    glow: 'rgba(239, 68, 68, 0.2)'
  }
};

const MiniAgentGauge = memo(function MiniAgentGauge({
  name,
  icon: Icon,
  status = 'pending',
  progress = 0,
  duration = null,
  message = '',
  size = 64,
  className = ''
}) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const strokeWidth = 4;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;

  // For active status, use progress; for complete, show full
  const displayProgress = status === 'complete' ? 100 : (status === 'active' ? progress : 0);
  const strokeDashoffset = circumference - (circumference * displayProgress / 100);

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      {/* Gauge container */}
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          filter: status === 'active' ? `drop-shadow(0 0 8px ${colors.glow})` : 'none'
        }}
      >
        {/* Pulse ring for active state */}
        {status === 'active' && (
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ backgroundColor: colors.glow }}
          />
        )}

        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill={colors.bg}
            stroke={colors.stroke}
            strokeWidth={strokeWidth}
            strokeOpacity={status === 'pending' ? 0.3 : 0.2}
          />

          {/* Progress ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: 'stroke-dashoffset 0.5s ease-out'
            }}
          />
        </svg>

        {/* Center icon/content */}
        <div className="absolute inset-0 flex items-center justify-center">
          {status === 'complete' ? (
            <Check
              className="text-emerald-400"
              style={{ width: size * 0.4, height: size * 0.4 }}
            />
          ) : status === 'active' ? (
            <Loader2
              className="animate-spin"
              style={{
                width: size * 0.35,
                height: size * 0.35,
                color: colors.text
              }}
            />
          ) : status === 'error' ? (
            <AlertCircle
              className="text-red-400"
              style={{ width: size * 0.4, height: size * 0.4 }}
            />
          ) : Icon ? (
            <Icon
              style={{
                width: size * 0.35,
                height: size * 0.35,
                color: colors.text
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Label */}
      <span
        className="font-medium text-center leading-tight"
        style={{
          fontSize: Math.max(9, size * 0.16),
          color: colors.text
        }}
      >
        {name}
      </span>

      {/* Status or progress text */}
      <span
        className="text-center leading-tight opacity-70"
        style={{
          fontSize: Math.max(8, size * 0.14),
          color: colors.text
        }}
      >
        {status === 'complete' && duration
          ? formatDuration(duration)
          : status === 'active' && progress > 0
            ? `${Math.round(progress)}%`
            : status === 'pending'
              ? 'Waiting'
              : status === 'error'
                ? 'Failed'
                : message || ''}
      </span>
    </div>
  );
});

export default MiniAgentGauge;
