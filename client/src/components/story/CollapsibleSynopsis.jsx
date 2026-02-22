/**
 * CollapsibleSynopsis Component
 *
 * A collapsible synopsis section that can be expanded/collapsed.
 * - Remembers state via localStorage
 * - Auto-expands for first chapter, collapsed by default for subsequent
 * - Optional regenerate button on hover
 * - Independent from cover art collapse state
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, BookOpen } from 'lucide-react';
import { scopedGetItem, scopedSetItem } from '../../utils/userScopedStorage';

const SYNOPSIS_STORAGE_KEY = 'narrimo_synopsis_expanded';

const CollapsibleSynopsis = memo(function CollapsibleSynopsis({
  synopsis = '',
  chapterIndex = 0,
  onRegenerateSynopsis,
  isRegeneratingSynopsis = false,
  hideRegenerateButton = false
}) {
  // Start with auto-expand logic (first chapter = expanded, subsequent = collapsed)
  const [isExpanded, setIsExpanded] = useState(() => {
    // Try to load from localStorage first
    try {
      const saved = scopedGetItem(SYNOPSIS_STORAGE_KEY);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch {
      // Fall back to default
    }
    // Default: expanded for first chapter, collapsed for subsequent
    return chapterIndex === 0;
  });

  const [isHovered, setIsHovered] = useState(false);

  // Persist to localStorage when changed
  useEffect(() => {
    try {
      scopedSetItem(SYNOPSIS_STORAGE_KEY, JSON.stringify(isExpanded));
    } catch (err) {
      console.warn('[CollapsibleSynopsis] Failed to save state:', err);
    }
  }, [isExpanded]);

  // Auto-collapse when moving to a new chapter (after the first)
  useEffect(() => {
    if (chapterIndex > 0) {
      // Only auto-collapse if user hasn't explicitly interacted
      const saved = scopedGetItem(SYNOPSIS_STORAGE_KEY);
      if (saved === null) {
        setIsExpanded(false);
      }
    }
  }, [chapterIndex]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  if (!synopsis) return null;

  return (
    <div
      className="synopsis-collapsible mb-4"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header bar - always visible */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-700/40 hover:bg-slate-700/60 rounded-lg transition-colors group"
        aria-expanded={isExpanded}
        aria-controls="synopsis-content"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-slate-400" />
          <span className="text-slate-300 text-sm font-medium">Synopsis</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Regenerate button - only on hover and when not playing */}
          {onRegenerateSynopsis && !hideRegenerateButton && isHovered && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRegenerateSynopsis();
              }}
              disabled={isRegeneratingSynopsis}
              className={`p-1 rounded transition-all ${
                isRegeneratingSynopsis
                  ? 'bg-slate-600/50 cursor-wait'
                  : 'bg-slate-600/50 hover:bg-slate-600'
              }`}
              title="Regenerate synopsis"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isRegeneratingSynopsis ? 'animate-spin' : ''}`} />
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-300 transition-colors" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-300 transition-colors" />
          )}
        </div>
      </button>

      {/* Expandable content with smooth animation */}
      <div
        id="synopsis-content"
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 py-3 text-slate-200 text-sm leading-relaxed italic border-l-2 border-slate-600 ml-2 mt-2">
          {synopsis}
        </div>
      </div>

      {/* Collapsed preview - show truncated text when collapsed */}
      {!isExpanded && synopsis && (
        <div className="px-3 mt-1">
          <p className="text-slate-500 text-xs italic line-clamp-1">
            {synopsis}
          </p>
        </div>
      )}
    </div>
  );
});

export default CollapsibleSynopsis;
