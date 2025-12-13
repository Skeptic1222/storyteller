import { memo, useEffect, useCallback } from 'react';

const ChoiceButtons = memo(function ChoiceButtons({ choices, onSelect }) {
  if (!choices || choices.length === 0) return null;

  const getKeyColor = (key) => {
    const colors = {
      A: 'from-blue-500 to-blue-600',
      B: 'from-purple-500 to-purple-600',
      C: 'from-green-500 to-green-600',
      D: 'from-orange-500 to-orange-600'
    };
    return colors[key] || 'from-night-500 to-night-600';
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
      className="w-full max-w-md space-y-3 mt-6"
      role="group"
      aria-label="Story choices"
    >
      <div className="text-center text-night-300 text-sm mb-4" id="choice-prompt">
        What would you like to do?
      </div>
      {choices.map((choice, index) => (
        <button
          key={choice.key}
          onClick={() => onSelect(choice.key)}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(choice.key)}
          aria-label={`Choice ${choice.key}: ${choice.text}${choice.description ? `. ${choice.description}` : ''}`}
          aria-describedby="choice-prompt"
          tabIndex={0}
          className="w-full p-4 rounded-xl bg-night-800/80 border border-night-600
                     hover:border-night-400 transition-all choice-button
                     flex items-center gap-4 text-left group
                     focus:outline-none focus:ring-2 focus:ring-golden-500 focus:border-golden-500"
        >
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-br ${getKeyColor(choice.key)}
                        flex items-center justify-center text-white font-bold text-lg
                        group-hover:scale-110 transition-transform`}
            aria-hidden="true"
          >
            {choice.key}
          </div>
          <div className="flex-1">
            <div className="text-night-100 font-medium">
              {choice.text}
            </div>
            {choice.description && (
              <div className="text-night-400 text-sm mt-1">
                {choice.description}
              </div>
            )}
            {/* Voice command hint for this specific choice */}
            <div className="text-night-500 text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              Press {index + 1} or {choice.key} • Say "{keyToOrdinal[choice.key]}"
            </div>
          </div>
        </button>
      ))}
      <div className="text-center text-night-500 text-xs mt-2 space-y-1" aria-live="polite">
        <div>⌨️ Press 1-4 or A-D • 🎤 Say "one", "two", "three"</div>
        <div className="text-night-600">Or tap to select</div>
      </div>
    </div>
  );
});

export default ChoiceButtons;
