/**
 * ChapterSelector Component
 * Compact horizontal chapter strip with numbered buttons.
 * Features:
 * - Dynamic terminology (Chapter/Part/Page/Scene based on format)
 * - Visual states: current (golden), played (filled), unplayed (outline)
 * - Overflow handling: shows first 5 buttons + [⋯] for more
 * - Position indicator: "3/12"
 */

import { useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { getStoryTerminology } from '../../utils/storyTerminology';

function ChapterSelector({
  // Story config
  storyFormat = 'short_story',
  storyType = 'linear',

  // Chapter data
  totalChapters = 1,
  currentChapter = 1, // 1-based
  playedChapters = [], // Array of 1-based chapter numbers that have been played/cached

  // Callbacks
  onSelectChapter, // (chapterNumber) => void

  // Disabled state (during generation)
  disabled = false,

  // Maximum visible buttons before overflow
  maxVisible = 5
}) {
  const [showAllModal, setShowAllModal] = useState(false);

  const terms = getStoryTerminology(storyFormat, storyType);

  // Generate chapter numbers array
  const chapters = Array.from({ length: totalChapters }, (_, i) => i + 1);

  // Determine which chapters to show directly vs overflow
  const visibleChapters = chapters.slice(0, maxVisible);
  const hasOverflow = chapters.length > maxVisible;

  // Check if a chapter has been played/cached
  const isPlayed = (chapterNum) => playedChapters.includes(chapterNum);

  // Handle chapter click
  const handleClick = (chapterNum) => {
    if (disabled || chapterNum === currentChapter) return;
    onSelectChapter?.(chapterNum);
    setShowAllModal(false);
  };

  // Button style based on state
  const getButtonStyle = (chapterNum) => {
    const isCurrent = chapterNum === currentChapter;
    const played = isPlayed(chapterNum);

    if (isCurrent) {
      return 'bg-golden-400 text-slate-900 border-golden-400 font-bold shadow-md shadow-golden-400/30';
    }
    if (played) {
      return 'bg-slate-600 text-slate-200 border-slate-500 hover:border-golden-400/50';
    }
    return 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400';
  };

  return (
    <>
      {/* Main chapter strip */}
      <div className="chapter-selector flex items-center gap-2 px-3 py-2 bg-slate-900/60 border-t border-slate-700/50">
        {/* Label */}
        <span className="text-slate-500 text-xs font-medium min-w-fit">
          {terms.abbrev}:
        </span>

        {/* Chapter buttons */}
        <div className="flex items-center gap-1.5">
          {visibleChapters.map((chapterNum) => (
            <button
              key={chapterNum}
              onClick={() => handleClick(chapterNum)}
              disabled={disabled || chapterNum === currentChapter}
              className={`
                w-8 h-8 rounded-full border-2 text-sm font-medium
                transition-all duration-150
                disabled:cursor-default
                ${getButtonStyle(chapterNum)}
                ${disabled && chapterNum !== currentChapter ? 'opacity-50' : ''}
              `}
              title={`${terms.singular} ${chapterNum}${isPlayed(chapterNum) ? ' (played)' : ''}`}
              aria-label={`Go to ${terms.singular} ${chapterNum}`}
              aria-current={chapterNum === currentChapter ? 'true' : undefined}
            >
              {chapterNum}
            </button>
          ))}

          {/* Overflow button */}
          {hasOverflow && (
            <button
              onClick={() => setShowAllModal(true)}
              disabled={disabled}
              className={`
                w-8 h-8 rounded-full border-2 border-slate-600 bg-slate-800
                flex items-center justify-center
                hover:border-slate-400 transition-all
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title={`Show all ${totalChapters} ${terms.plural.toLowerCase()}`}
              aria-label={`Show all ${terms.plural.toLowerCase()}`}
            >
              <MoreHorizontal className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>

        {/* Position indicator */}
        <span className="text-slate-500 text-xs ml-auto">
          {currentChapter}/{totalChapters}
        </span>
      </div>

      {/* All chapters modal */}
      {showAllModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowAllModal(false)}
        >
          <div
            className="bg-slate-800 rounded-2xl border border-slate-600 p-4 max-w-md w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-golden-400 font-semibold">
                All {terms.plural}
              </h3>
              <button
                onClick={() => setShowAllModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Chapter grid */}
            <div className="grid grid-cols-5 gap-2">
              {chapters.map((chapterNum) => (
                <button
                  key={chapterNum}
                  onClick={() => handleClick(chapterNum)}
                  disabled={disabled || chapterNum === currentChapter}
                  className={`
                    w-full aspect-square rounded-lg border-2 text-sm font-medium
                    transition-all duration-150
                    disabled:cursor-default
                    ${getButtonStyle(chapterNum)}
                    ${disabled && chapterNum !== currentChapter ? 'opacity-50' : ''}
                  `}
                  title={`${terms.singular} ${chapterNum}${isPlayed(chapterNum) ? ' (played)' : ''}`}
                >
                  {chapterNum}
                </button>
              ))}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-3 border-t border-slate-700 flex items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-golden-400" />
                <span className="text-slate-400">Current</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-slate-600 border border-slate-500" />
                <span className="text-slate-400">Played</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full border border-slate-600" />
                <span className="text-slate-400">Unplayed</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ChapterSelector;
