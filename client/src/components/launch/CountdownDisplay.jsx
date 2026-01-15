/**
 * CountdownDisplay Component
 * Cinematic countdown animation with multiple phases
 */
import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { COUNTDOWN_PHASE } from '../../constants/launchStages';

const CountdownDisplay = memo(function CountdownDisplay({ phase, value, onSkip }) {
  // Pre-cue phase: "All set! Beginning in..."
  if (phase === COUNTDOWN_PHASE.PRE_CUE) {
    return (
      <div className="text-center py-8 animate-fade-in">
        <div className="mb-4">
          <Sparkles className="w-12 h-12 text-golden-400 mx-auto animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">All Set!</h2>
        <p className="text-slate-400 text-lg">Beginning in...</p>
      </div>
    );
  }

  // Go phase: Brief "Go!" moment
  if (phase === COUNTDOWN_PHASE.GO) {
    return (
      <div className="text-center py-8">
        <div className="relative inline-block">
          {/* Expanding ring animation */}
          <div className="absolute inset-0 rounded-full bg-golden-400/30 animate-ping" />
          <div className="absolute inset-0 rounded-full bg-golden-400/20 animate-pulse scale-110" />

          {/* Main circle */}
          <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-golden-400 to-amber-500
                          flex items-center justify-center shadow-lg shadow-golden-400/40">
            <span className="text-4xl font-bold text-slate-900">GO!</span>
          </div>
        </div>
      </div>
    );
  }

  // Countdown phase: Animated numbers
  return (
    <div className="text-center py-8">
      <div className="relative inline-block">
        {/* Animated outer ring */}
        <div className="absolute inset-0 rounded-full border-4 border-golden-400/20 animate-ping" />

        {/* Pulsing background ring */}
        <div className="absolute -inset-2 rounded-full bg-gradient-to-br from-golden-400/10 to-amber-500/10 animate-pulse" />

        {/* Main countdown number with scale animation on change */}
        <div
          key={value}
          className="relative w-32 h-32 rounded-full bg-gradient-to-br from-golden-400/20 to-amber-500/20
                      border-2 border-golden-400 flex items-center justify-center
                      animate-[scale-in_0.3s_ease-out]"
          style={{
            animation: 'scale-in 0.3s ease-out'
          }}
        >
          <span className="text-6xl font-bold text-golden-400 drop-shadow-lg">
            {value}
          </span>
        </div>
      </div>

      <p className="text-slate-300 mt-6 text-lg">
        Starting in...
      </p>

      {/* Cancel button during countdown */}
      {onSkip && (
        <button
          className="mt-4 text-slate-500 hover:text-slate-300 text-sm underline transition-colors"
          onClick={onSkip}
        >
          Skip countdown
        </button>
      )}
    </div>
  );
});

export default CountdownDisplay;
