import { memo, useEffect, useCallback } from 'react';

/**
 * ChoiceButtons - CYOA choice selection UI
 *
 * Redesigned for better integration with reader area:
 * - Matches reader content width (max-w-2xl)
 * - Uses reader-aware colors that work with theme
 * - Responsive: full-width on mobile, constrained on desktop
 * - Visual connection to story text (part of reading flow)
 */
const ChoiceButtons = memo(function ChoiceButtons({ choices, onSelect }) {
  if (!choices || choices.length === 0) return null;

  const getKeyColor = (key) => {
    const colors = {
      A: 'from-blue-500 to-blue-600',
      B: 'from-purple-500 to-purple-600',
      C: 'from-green-500 to-green-600',
      D: 'from-orange-500 to-orange-600'
    };
    return colors[key] || 'from-slate-500 to-slate-600';
  };

  // Map keys to ordinal words for voice hints
  const keyToOrdinal = {
    A: 'one',
    B: 'two',
    C: 'three',
    D: 'four'
  };

  // Keyboard shortcuts: 1-4 or A-D to select choices
  const handleKeyDown = useCallback((event) => {
    const keyMap = {
      '1': 'A', '2': 'B', '3': 'C', '4': 'D',
      'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D',
      'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'
    };
    const choiceKey = keyMap[event.key];
    if (choiceKey && choices.some(c => c.key === choiceKey)) {
      event.preventDefault();
      onSelect(choiceKey);
    }
  }, [choices, onSelect]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="choice-buttons-container w-full max-w-2xl mx-auto mt-4 px-3 sm:px-0"
      role="group"
      aria-label="Story choices"
    >
      {/* Visual connection - dashed continuation line */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-golden-400/30 to-transparent" />
        <span className="text-golden-400/80 text-sm font-medium" id="choice-prompt">
          What will you do?
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-golden-400/30 to-transparent" />
      </div>

      {/* Choice buttons - responsive grid */}
      <div className="space-y-2 sm:space-y-3">
        {choices.map((choice, index) => (
          <button
            key={choice.key}
            onClick={() => onSelect(choice.key)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(choice.key)}
            aria-label={`Choice ${choice.key}: ${choice.text}${choice.description ? `. ${choice.description}` : ''}`}
            aria-describedby="choice-prompt"
            tabIndex={0}
            className="choice-button w-full p-3 sm:p-4 rounded-xl
                       bg-slate-800/70 border border-slate-600/80
                       hover:border-golden-400/50 hover:bg-slate-700/70
                       active:scale-[0.98] transition-all
                       flex items-center gap-3 sm:gap-4 text-left group
                       focus:outline-none focus:ring-2 focus:ring-golden-400/50 focus:border-golden-400"
          >
            {/* Choice key badge - smaller on mobile */}
            <div
              className={`choice-key w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br ${getKeyColor(choice.key)}
                          flex items-center justify-center text-white font-bold text-base sm:text-lg
                          group-hover:scale-110 transition-transform flex-shrink-0`}
              aria-hidden="true"
            >
              {choice.key}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-slate-100 font-medium text-sm sm:text-base leading-snug">
                {choice.text}
              </div>
              {choice.description && (
                <div className="text-slate-400 text-xs sm:text-sm mt-1 line-clamp-2">
                  {choice.description}
                </div>
              )}
              {/* Voice/keyboard hint - visible on hover (desktop) */}
              <div className="hidden sm:block text-slate-500 text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                Press {index + 1} or {choice.key}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Keyboard/voice hints footer - simplified on mobile */}
      <div className="text-center text-slate-500 text-xs mt-3 sm:mt-4" aria-live="polite">
        <div className="hidden sm:block">
          ⌨️ Press 1-{choices.length} or A-{String.fromCharCode(64 + choices.length)} • Tap to select
        </div>
        <div className="sm:hidden text-slate-600">
          Tap a choice to continue
        </div>
      </div>
    </div>
  );
});

export default ChoiceButtons;
