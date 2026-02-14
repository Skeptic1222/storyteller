/**
 * TimeDisplay Component
 * Dedicated time display with animated clock and hourglass
 *
 * Features:
 * - Animated clock icon with rotating second hand
 * - Hourglass for remaining time estimate
 * - Clean, minimal design matching Narrimo aesthetic
 */

import { memo, useMemo } from 'react';
import { Clock, Hourglass } from 'lucide-react';

const TimeDisplay = memo(function TimeDisplay({
  elapsedMs = 0,
  estimatedRemainingMs = null,
  size = 'default' // 'compact', 'default', 'large'
}) {
  // Format time as M:SS or MM:SS
  const formatTime = (ms) => {
    if (!ms || ms < 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format remaining time with "~" prefix and "left" suffix
  const formatRemaining = (ms) => {
    if (!ms || ms <= 0) return null;
    const totalSeconds = Math.floor(ms / 1000);

    if (totalSeconds < 5) return '< 5s left';

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `~${minutes}:${seconds.toString().padStart(2, '0')} left`;
    }
    return `~${seconds}s left`;
  };

  const elapsedFormatted = useMemo(() => formatTime(elapsedMs), [elapsedMs]);
  const remainingFormatted = useMemo(() => {
    if (estimatedRemainingMs === null) return 'calculating...';
    return formatRemaining(estimatedRemainingMs);
  }, [estimatedRemainingMs]);

  // Calculate rotation for animated clock hand (one full rotation per minute)
  const secondHandRotation = useMemo(() => {
    const seconds = (elapsedMs / 1000) % 60;
    return seconds * 6; // 360 degrees / 60 seconds = 6 degrees per second
  }, [elapsedMs]);

  // Size variants
  const sizeClasses = {
    compact: {
      container: 'gap-4 text-xs',
      icon: 'w-4 h-4',
      text: 'font-mono font-medium',
      separator: 'w-px h-4'
    },
    default: {
      container: 'gap-6 text-base',
      icon: 'w-5 h-5',
      text: 'font-mono font-semibold',
      separator: 'w-px h-6'
    },
    large: {
      container: 'gap-8 text-lg',
      icon: 'w-6 h-6',
      text: 'font-mono font-bold',
      separator: 'w-px h-8'
    }
  };

  const s = sizeClasses[size] || sizeClasses.default;

  return (
    <div className={`flex items-center ${s.container}`}>
      {/* Elapsed Time with Animated Clock */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Clock className={`${s.icon} text-cyan-400`} />
          {/* Animated second hand overlay */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ transform: `rotate(${secondHandRotation}deg)` }}
          >
            <div
              className="bg-cyan-400 origin-bottom rounded-full"
              style={{
                width: '1.5px',
                height: size === 'compact' ? '5px' : size === 'large' ? '8px' : '6px',
                marginBottom: size === 'compact' ? '3px' : size === 'large' ? '5px' : '4px'
              }}
            />
          </div>
        </div>
        <span className={`${s.text} text-white`}>
          {elapsedFormatted}
        </span>
      </div>

      {/* Vertical Separator */}
      <div className={`${s.separator} bg-gradient-to-b from-transparent via-slate-500 to-transparent`} />

      {/* Remaining Time with Hourglass */}
      <div className="flex items-center gap-2">
        <Hourglass
          className={`${s.icon} text-sage-400 ${estimatedRemainingMs === null ? 'animate-pulse' : ''}`}
          style={{
            animation: estimatedRemainingMs !== null && estimatedRemainingMs > 0
              ? 'hourglass-flow 2s ease-in-out infinite'
              : undefined
          }}
        />
        <span className={`${s.text} text-slate-300`}>
          {remainingFormatted || 'calculating...'}
        </span>
      </div>

      {/* Inline keyframe styles for hourglass animation */}
      <style>{`
        @keyframes hourglass-flow {
          0%, 100% {
            transform: rotate(0deg);
            opacity: 0.8;
          }
          25% {
            transform: rotate(5deg);
            opacity: 1;
          }
          75% {
            transform: rotate(-5deg);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
});

export default TimeDisplay;
