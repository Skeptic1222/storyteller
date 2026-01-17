/**
 * SleepTimer Component
 * UI for setting and displaying a listening timer
 */

import { useState, memo } from 'react';
import { Clock, Plus, X, ChevronDown, AlertCircle } from 'lucide-react';
import { useSleepTimer } from '../hooks/useSleepTimer';

/**
 * Compact sleep timer control for story player
 */
export const SleepTimerControl = memo(function SleepTimerControl({
  onTimerEnd,
  onWarning,
  className = ''
}) {
  const [showPicker, setShowPicker] = useState(false);

  const {
    isActive,
    isPaused,
    duration,
    remainingSeconds,
    formattedTime,
    progress,
    hasWarned,
    startTimer,
    stopTimer,
    addTime,
    presets
  } = useSleepTimer({
    onTimerEnd,
    onWarning,
    pauseOnHidden: false // Don't pause when tab hidden - story should still play
  });

  const handleSelectPreset = (minutes) => {
    if (minutes === 0) {
      stopTimer();
    } else {
      startTimer(minutes);
    }
    setShowPicker(false);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Main button */}
      <button
        onClick={() => setShowPicker(!showPicker)}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg transition-all
          ${isActive
            ? hasWarned
              ? 'bg-amber-500/20 text-amber-400 animate-pulse'
              : 'bg-narrimo-sage/20 text-narrimo-sage'
            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }
        `}
        title={isActive ? `Listening timer: ${formattedTime}` : 'Set listening timer'}
      >
        <Clock className="w-4 h-4" />
        {isActive ? (
          <span className="text-sm font-medium">{formattedTime}</span>
        ) : (
          <span className="text-sm">Timer</span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${showPicker ? 'rotate-180' : ''}`} />
      </button>

      {/* Progress ring (when active) */}
      {isActive && (
        <svg
          className="absolute -inset-1 w-[calc(100%+8px)] h-[calc(100%+8px)] -rotate-90 pointer-events-none"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-slate-700"
          />
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={`${progress * 3.01} 301`}
            className={hasWarned ? 'text-amber-400' : 'text-narrimo-sage'}
          />
        </svg>
      )}

      {/* Dropdown picker */}
      {showPicker && (
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden z-50">
          <div className="p-2 border-b border-slate-600 flex items-center justify-between">
            <span className="text-slate-300 text-sm font-medium">Listening Timer</span>
            <button
              onClick={() => setShowPicker(false)}
              className="text-slate-500 hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-2 max-h-60 overflow-y-auto">
            {presets.map(preset => (
              <button
                key={preset.minutes}
                onClick={() => handleSelectPreset(preset.minutes)}
                className={`
                  w-full px-3 py-2 rounded text-left text-sm transition-colors
                  flex items-center justify-between
                  ${duration === preset.minutes && isActive
                    ? 'bg-narrimo-sage/20 text-narrimo-sage'
                    : 'hover:bg-slate-700 text-slate-300'
                  }
                `}
              >
                <span>{preset.label}</span>
                {duration === preset.minutes && isActive && (
                  <Clock className="w-4 h-4" />
                )}
              </button>
            ))}
          </div>

          {/* Add time button (when active) */}
          {isActive && (
            <div className="p-2 border-t border-slate-600">
              <button
                onClick={() => addTime(5)}
                className="w-full px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add 5 minutes
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Sleep timer warning overlay
 * Shows when 1 minute remaining
 */
export const SleepTimerWarning = memo(function SleepTimerWarning({
  remainingSeconds,
  onAddTime,
  onDismiss
}) {
  // Early return if not in warning range (undefined > 60 is false, so check explicitly)
  if (remainingSeconds == null || remainingSeconds <= 0 || remainingSeconds > 60) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
      <div className="bg-amber-900/90 backdrop-blur-sm rounded-xl px-4 py-3 shadow-lg flex items-center gap-3 animate-bounce-gentle">
        <AlertCircle className="w-5 h-5 text-amber-400" />
        <span className="text-amber-100 text-sm">
          Timer: {remainingSeconds}s remaining
        </span>
        <button
          onClick={() => onAddTime(5)}
          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-white text-sm font-medium"
        >
          +5 min
        </button>
        <button
          onClick={onDismiss}
          className="text-amber-400 hover:text-amber-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

export default SleepTimerControl;
