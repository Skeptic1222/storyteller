/**
 * TickerView Component
 * Word-by-word display for speed reading mode.
 * Shows current word large and centered, with surrounding words fading.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Settings } from 'lucide-react';

// Default words per minute (adjustable)
const DEFAULT_WPM = 300;

function TickerView({
  text = '',
  isPlaying = false,
  onTogglePlay,
  currentWordIndex = 0,
  onWordIndexChange,
  wpm = DEFAULT_WPM,
  onWpmChange,
  className = ''
}) {
  const [localWordIndex, setLocalWordIndex] = useState(currentWordIndex);
  const [showSettings, setShowSettings] = useState(false);
  const intervalRef = useRef(null);

  // Split text into words
  const words = useMemo(() => {
    return text
      .replace(/\n/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }, [text]);

  // Sync with external word index
  useEffect(() => {
    setLocalWordIndex(currentWordIndex);
  }, [currentWordIndex]);

  // Auto-advance when playing
  useEffect(() => {
    if (isPlaying && words.length > 0) {
      const msPerWord = 60000 / wpm;
      intervalRef.current = setInterval(() => {
        setLocalWordIndex(prev => {
          const next = prev + 1;
          if (next >= words.length) {
            // Reached end
            if (onTogglePlay) onTogglePlay();
            return prev;
          }
          if (onWordIndexChange) onWordIndexChange(next);
          return next;
        });
      }, msPerWord);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, wpm, words.length, onTogglePlay, onWordIndexChange]);

  // Get surrounding words for context
  const getContextWords = (index, range) => {
    const result = [];
    for (let i = index - range; i <= index + range; i++) {
      if (i >= 0 && i < words.length && i !== index) {
        result.push({
          word: words[i],
          position: i - index // Negative = before, positive = after
        });
      }
    }
    return result;
  };

  const contextWords = getContextWords(localWordIndex, 3);
  const currentWord = words[localWordIndex] || '';

  // Progress percentage
  const progress = words.length > 0 ? ((localWordIndex + 1) / words.length) * 100 : 0;

  // Skip forward/backward
  const skipWords = (delta) => {
    const newIndex = Math.max(0, Math.min(words.length - 1, localWordIndex + delta));
    setLocalWordIndex(newIndex);
    if (onWordIndexChange) onWordIndexChange(newIndex);
  };

  if (!text || words.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full text-slate-500 ${className}`}>
        <p>No text to display</p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      style={{ backgroundColor: 'var(--reader-bg-color, #0f172a)' }}
    >
      {/* Main display area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Context words - fading out */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {contextWords.map(({ word, position }) => {
            const opacity = Math.max(0.1, 1 - Math.abs(position) * 0.25);
            const scale = Math.max(0.4, 1 - Math.abs(position) * 0.15);
            const xOffset = position * 180; // Pixels between words

            return (
              <span
                key={position}
                className="absolute font-serif transition-all duration-150"
                style={{
                  fontSize: '24px',
                  opacity,
                  transform: `translateX(${xOffset}px) scale(${scale})`,
                  color: 'var(--reader-text-color, #94a3b8)',
                  filter: 'brightness(0.6)'
                }}
              >
                {word}
              </span>
            );
          })}
        </div>

        {/* Current word - large and centered */}
        <span
          className="relative z-10 font-serif font-medium transition-all duration-100"
          style={{
            fontSize: '48px',
            textShadow: '0 0 20px rgba(251, 191, 36, 0.3)',
            color: 'var(--reader-text-color, #ffffff)'
          }}
        >
          {currentWord}
        </span>

        {/* Focal point line */}
        <div
          className="absolute left-1/2 top-1/2 w-0.5 h-16 bg-golden-400/30 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        />
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-800">
        <div
          className="h-full bg-golden-400 transition-all duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-t border-slate-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => skipWords(-10)}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
            title="Skip back 10 words"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={onTogglePlay}
            className="p-3 bg-golden-400 text-slate-900 rounded-full hover:bg-golden-300 transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          <button
            onClick={() => skipWords(10)}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
            title="Skip forward 10 words"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* Word count / position */}
        <div className="text-sm text-slate-400">
          {localWordIndex + 1} / {words.length}
        </div>

        {/* WPM Settings */}
        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors text-sm"
          >
            <Settings className="w-4 h-4" />
            {wpm} WPM
          </button>

          {showSettings && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowSettings(false)}
              />
              <div className="absolute bottom-full right-0 mb-2 p-3 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 w-48">
                <label className="text-sm text-slate-300 block mb-2">
                  Reading Speed
                </label>
                <input
                  type="range"
                  min="100"
                  max="600"
                  step="25"
                  value={wpm}
                  onChange={(e) => onWpmChange?.(parseInt(e.target.value, 10))}
                  className="w-full accent-golden-400"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>Slow</span>
                  <span>{wpm} WPM</span>
                  <span>Fast</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TickerView;
