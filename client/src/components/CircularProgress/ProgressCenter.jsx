/**
 * ProgressCenter Component
 * Center content of the circular progress ring
 *
 * Features:
 * - Large percentage display with Narrimo styling
 * - Integrated TimeDisplay component
 * - Current activity description with gradient divider
 * - Responsive sizing for full-screen display
 */

import { memo, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import TimeDisplay from './TimeDisplay';

const ProgressCenter = memo(function ProgressCenter({
  percent = 0,
  elapsedMs = 0,
  estimatedRemainingMs = null,
  currentActivity = '',
  stageLabel = '',
  size = 220, // Inner diameter of the center area
  showTimeDisplay = true
}) {
  // Estimate remaining time based on progress if not provided
  const calculatedRemainingMs = useMemo(() => {
    if (estimatedRemainingMs !== null) return estimatedRemainingMs;
    if (percent <= 5 || elapsedMs < 5000) return null;

    const msPerPercent = elapsedMs / percent;
    const remainingPercent = 100 - percent;
    return msPerPercent * remainingPercent;
  }, [percent, elapsedMs, estimatedRemainingMs]);

  // Truncate activity text if too long (more aggressive for mobile)
  const truncatedActivity = useMemo(() => {
    if (!currentActivity) return 'AI agents working...';
    // Remove verbose status messages
    let text = currentActivity
      .replace(/\s*-\s*Still working.*$/i, '')
      .replace(/\s*-\s*Processing.*$/i, '')
      .replace(/\s*\(\d+[ms]\s*\d*[ms]?\)$/i, '')
      .replace(/\s*\(\d+s\)$/i, '')
      .trim();
    // Keep it short for mobile
    if (text.length > 35) {
      return text.substring(0, 32) + '...';
    }
    return text;
  }, [currentActivity]);

  // Calculate font sizes based on container size
  const percentFontSize = size >= 220 ? 'text-7xl' : size >= 180 ? 'text-6xl' : 'text-5xl';
  const percentSymbolSize = size >= 220 ? 'text-4xl' : size >= 180 ? 'text-3xl' : 'text-2xl';

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 10 }}
    >
      <div
        className="flex flex-col items-center justify-center text-center px-4"
        style={{
          width: size,
          height: size
        }}
      >
        {/* Main percentage - large and bold with gradient text */}
        <div className={`${percentFontSize} font-black mb-2 tracking-tight`}>
          <span className="bg-gradient-to-br from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
            {Math.round(percent)}
          </span>
          <span className={`${percentSymbolSize} text-slate-400 font-bold ml-1`}>%</span>
        </div>

        {/* Time display - integrated component */}
        {showTimeDisplay && (
          <div className="mb-3">
            <TimeDisplay
              elapsedMs={elapsedMs}
              estimatedRemainingMs={calculatedRemainingMs}
              size="compact"
            />
          </div>
        )}

        {/* Divider line with gradient */}
        <div className="w-4/5 h-px bg-gradient-to-r from-transparent via-slate-500 to-transparent mb-3" />

        {/* Current stage label with sparkle icon */}
        {stageLabel && (
          <div className="flex items-center gap-2 text-xs font-semibold text-golden-400 uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>{stageLabel}</span>
          </div>
        )}

        {/* Current activity text */}
        <div
          className="text-sm text-slate-300 text-center leading-relaxed"
          style={{ maxWidth: size - 40 }}
        >
          {truncatedActivity}
        </div>
      </div>
    </div>
  );
});

export default ProgressCenter;
