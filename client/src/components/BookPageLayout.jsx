/**
 * BookPageLayout Component
 * Unified book-page style layout with floating cover art and text wrapping.
 * Contains: Cover (floating left) + Title + Story Details badge + Synopsis + Story
 *
 * Features:
 * - Cover art floats left (CSS float), text wraps around like a real book
 * - Cover click → fullscreen view
 * - Cover hover top-right → minimize icon to collapse to tiny square
 * - Minimize/restore toggle for cover and text box
 * - Story Details badge below title (expandable)
 * - No separate text toggle - everything is in one unified container
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Minus, Plus, ZoomIn, X, RefreshCw, Loader2,
  ChevronDown, ChevronUp, BookOpen, MapPin, Sparkles,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { stripAllTags } from '../utils/textUtils';
import { useTheme } from '../context/ThemeContext';
import { CollapsibleSynopsis } from './story';

const DETAILS_STORAGE_KEY = 'narrimo_details_expanded';
const LEGACY_DETAILS_STORAGE_KEY = 'storyteller_details_expanded';

function BookPageLayout({
  // Story metadata
  title = '',
  synopsis = '',
  storyText = '',

  // Story details (for expandable badge)
  storyDetails = {}, // { setting, themes, authorStyle, mood, ... }

  // Chapter info (for auto-expand behavior)
  chapterIndex = 0, // 0-based, first chapter auto-expands details

  // Cover art
  coverUrl = null,
  coverProgress = {},

  // Regeneration handlers
  onRegenerateCover,
  onRegenerateSynopsis,
  isRegeneratingCover = false,
  isRegeneratingSynopsis = false,

  // Karaoke/word highlighting
  wordTimings = null,
  currentWordIndex = -1,
  onWordClick,

  // Text size (user preference)
  fontSize = 18,

  // State (controls regenerate buttons visibility during pre-playback)
  isPrePlayback = false,
  // Deprecated alias (kept for backward compatibility)
  isCountdownActive,

  // Class name
  className = ''
}) {
  // Support deprecated isCountdownActive prop (backward compatibility)
  const hideRegenerateButtons = isPrePlayback || isCountdownActive || false;

  // Get text layout from theme context
  const { textLayout } = useTheme();

  // Debug: Log textLayout changes
  useEffect(() => {
    console.log('[BookPageLayout] textLayout changed to:', textLayout);
  }, [textLayout]);

  // Cover state: 'full' | 'minimized'
  const [coverState, setCoverState] = useState('full');
  // Text box state: 'full' | 'minimized'
  const [textBoxState, setTextBoxState] = useState('full');
  // Story details expanded - persisted to localStorage
  // Start with true (expanded), then load from localStorage in useEffect to avoid SSR/hydration issues
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [detailsLoaded, setDetailsLoaded] = useState(false);

  // Modal mode - paragraph navigation
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);

  // Load detailsExpanded from localStorage on mount (avoids SSR/hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DETAILS_STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        // Validate type to prevent corrupted data from breaking UI
        if (typeof parsed === 'boolean') {
          setDetailsExpanded(parsed);
        } else {
          // Reset corrupted data to default and log warning
          console.warn('[BookPageLayout] Invalid localStorage value type, expected boolean got:', typeof parsed, '- resetting to default');
          setDetailsExpanded(true);
          localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(true));
        }
      } else {
        const legacySaved = localStorage.getItem(LEGACY_DETAILS_STORAGE_KEY);
        if (legacySaved !== null) {
          const parsed = JSON.parse(legacySaved);
          if (typeof parsed === 'boolean') {
            localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(parsed));
            localStorage.removeItem(LEGACY_DETAILS_STORAGE_KEY);
            setDetailsExpanded(parsed);
          } else {
            // Reset legacy corrupted data to default
            console.warn('[BookPageLayout] Invalid legacy localStorage value type, expected boolean got:', typeof parsed, '- resetting to default');
            setDetailsExpanded(true);
            localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(true));
            localStorage.removeItem(LEGACY_DETAILS_STORAGE_KEY);
          }
        }
      }
    } catch (err) {
      console.warn('[BookPageLayout] Failed to read details state from localStorage:', err, '- using default');
      setDetailsExpanded(true);
    }
    setDetailsLoaded(true);
  }, []);

  // Persist detailsExpanded state to localStorage (only after initial load)
  useEffect(() => {
    if (!detailsLoaded) return; // Skip first render to avoid overwriting with default
    try {
      localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(detailsExpanded));
      localStorage.removeItem(LEGACY_DETAILS_STORAGE_KEY);
    } catch (err) {
      // FAIL LOUDLY - don't silently swallow storage errors
      console.warn('[BookPageLayout] Failed to save details state to localStorage:', err);
    }
  }, [detailsExpanded, detailsLoaded]);

  // Fullscreen cover modal
  const [showCoverFullscreen, setShowCoverFullscreen] = useState(false);
  // Hover states for showing minimize icons
  const [coverHovered, setCoverHovered] = useState(false);
  const [textBoxHovered, setTextBoxHovered] = useState(false);

  const textContainerRef = useRef(null);
  const wordRefs = useRef(new Map());
  const lastManualScrollRef = useRef(0);

  // Line detection state - tracks which line range the current word is on
  const [currentLineRange, setCurrentLineRange] = useState({ start: -1, end: -1 });

  // Parse words from timing data for karaoke
  const words = useMemo(() => {
    if (!wordTimings?.words) return [];
    return Array.isArray(wordTimings.words) ? wordTimings.words : [];
  }, [wordTimings]);

  // Split story text into paragraphs for modal mode
  const paragraphs = useMemo(() => {
    if (!storyText) return [];
    return storyText.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
  }, [storyText]);

  // Reset paragraph index when story text changes
  useEffect(() => {
    setCurrentParagraphIndex(0);
  }, [storyText]);

  // Modal navigation handlers
  const handlePrevParagraph = useCallback(() => {
    setCurrentParagraphIndex(prev => Math.max(0, prev - 1));
  }, []);

  const handleNextParagraph = useCallback(() => {
    setCurrentParagraphIndex(prev => Math.min(paragraphs.length - 1, prev + 1));
  }, [paragraphs.length]);

  // Calculate line ranges based on word DOM positions
  // Words on the same visual line will have similar Y positions
  const calculateLineRanges = useCallback(() => {
    if (words.length === 0) return [];
    const ranges = [];
    let lineStart = 0;
    let lastY = null;
    const threshold = 15; // pixels - words within this Y distance are on same line

    for (let idx = 0; idx < words.length; idx++) {
      const el = wordRefs.current.get(idx);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      if (lastY !== null && Math.abs(rect.top - lastY) > threshold) {
        // New line detected
        ranges.push({ start: lineStart, end: idx - 1 });
        lineStart = idx;
      }
      lastY = rect.top;
    }
    // Push final line
    ranges.push({ start: lineStart, end: words.length - 1 });
    return ranges;
  }, [words.length]);

  // Update current line range when current word changes
  useEffect(() => {
    if (currentWordIndex < 0 || words.length === 0) {
      setCurrentLineRange({ start: -1, end: -1 });
      return;
    }

    // Small delay to ensure DOM is updated
    const timer = setTimeout(() => {
      const lineRanges = calculateLineRanges();
      const currentLine = lineRanges.find(
        range => currentWordIndex >= range.start && currentWordIndex <= range.end
      );
      if (currentLine) {
        setCurrentLineRange(currentLine);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [currentWordIndex, words.length, calculateLineRanges]);

  // Auto-scroll to current word during playback
  useEffect(() => {
    if (currentWordIndex >= 0 && currentWordIndex < words.length) {
      const wordEl = wordRefs.current.get(currentWordIndex);
      if (wordEl && textContainerRef.current) {
        // Respect recent user scroll gestures to avoid fighting manual reading.
        if (Date.now() - lastManualScrollRef.current < 1200) return;

        const container = textContainerRef.current;
        const wordRect = wordEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (wordRect.top < containerRect.top + 60 || wordRect.bottom > containerRect.bottom - 60) {
          wordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [currentWordIndex, words]);

  // Handle word click for seeking
  const handleWordClick = (wordIndex) => {
    if (words[wordIndex] && onWordClick) {
      onWordClick(wordIndex, words[wordIndex].start_ms / 1000);
    }
  };

  // Cover image source
  const effectiveCoverUrl = coverUrl || coverProgress?.coverUrl;

  // Has any content to display
  const hasContent = title || synopsis || storyText;

  // Story details to show in badge (synopsis is now a SEPARATE section)
  const hasStoryDetails = storyDetails && (
    storyDetails.setting ||
    storyDetails.themes?.length > 0 ||
    storyDetails.authorStyle ||
    storyDetails.mood
  );

  // If text box is minimized, show collapsed state
  if (textBoxState === 'minimized' && hasContent) {
    return (
      <div className={`book-page-collapsed ${className}`}>
        {/* Minimized cover (tiny square) if cover was not already minimized */}
        {effectiveCoverUrl && coverState !== 'minimized' && (
          <button
            onClick={() => setCoverState('minimized')}
            className="w-12 h-12 rounded-lg overflow-hidden border border-slate-600 hover:border-slate-400 transition-all mr-3 flex-shrink-0"
            title="Click to minimize cover"
          >
            <img src={effectiveCoverUrl} alt="" className="w-full h-full object-cover" />
          </button>
        )}

        {/* Minimized text box indicator */}
        <button
          onClick={() => setTextBoxState('full')}
          onMouseEnter={() => setTextBoxHovered(true)}
          onMouseLeave={() => setTextBoxHovered(false)}
          className="flex items-center gap-3 px-4 py-3 bg-slate-800/80 rounded-xl border border-slate-600 hover:border-golden-400/50 transition-all flex-1"
          title="Click to restore text"
        >
          <BookOpen className="w-5 h-5 text-golden-400" />
          <span className="text-slate-300 truncate">{title || 'Story'}</span>
          <Plus className="w-4 h-4 text-slate-400 ml-auto" />
        </button>

        {/* Minimized cover thumbnail if cover is minimized */}
        {effectiveCoverUrl && coverState === 'minimized' && (
          <button
            onClick={() => setCoverState('full')}
            className="w-10 h-10 rounded overflow-hidden border border-slate-600 hover:border-amber-400/50 transition-all ml-3 flex-shrink-0 opacity-70 hover:opacity-100"
            title="Click to restore cover"
          >
            <img src={effectiveCoverUrl} alt="" className="w-full h-full object-cover" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`book-page-container ${className}`}>
      {/* Fullscreen Cover Modal */}
      {showCoverFullscreen && effectiveCoverUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen cover image"
          onClick={() => setShowCoverFullscreen(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors"
            onClick={() => setShowCoverFullscreen(false)}
            aria-label="Close fullscreen cover view"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={effectiveCoverUrl}
            alt={title || 'Story Cover'}
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Main Book Page - Unified Container with dynamic reader colors */}
      <div
        className="book-page-content reader-container relative rounded-2xl border border-slate-600 overflow-hidden"
        style={{ backgroundColor: 'var(--reader-bg-color, rgba(30, 41, 59, 0.7))' }}
        onMouseEnter={() => setTextBoxHovered(true)}
        onMouseLeave={() => setTextBoxHovered(false)}
      >
        {/* Minimize icon for text box - appears on hover */}
        {textBoxHovered && hasContent && (
          <button
            onClick={() => setTextBoxState('minimized')}
            className="absolute top-3 right-3 z-30 p-1.5 bg-slate-700/90 rounded-lg hover:bg-slate-600 transition-all"
            title="Minimize text box"
          >
            <Minus className="w-4 h-4 text-slate-300" />
          </button>
        )}

        {/* Scrollable content area */}
        <div
          ref={textContainerRef}
          className="book-page-scroll p-5 md:p-6 max-h-[60vh] overflow-y-auto"
          onScroll={() => {
            lastManualScrollRef.current = Date.now();
          }}
        >
          {/* Floating Cover Art (left side) */}
          {effectiveCoverUrl && coverState === 'full' && (
            <div
              className="book-cover-float relative group"
              onMouseEnter={() => setCoverHovered(true)}
              onMouseLeave={() => setCoverHovered(false)}
            >
              {/* Cover Image - clickable for fullscreen */}
              <div
                className="cursor-pointer"
                onClick={() => setShowCoverFullscreen(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setShowCoverFullscreen(true)}
              >
                {/* Book spine shadow effect */}
                <div className="absolute left-0 top-2 bottom-2 w-2 bg-gradient-to-r from-black/40 to-transparent rounded-l-sm z-10" />

                <img
                  src={effectiveCoverUrl}
                  alt={title || 'Story Cover'}
                  className="book-cover-image object-cover shadow-xl border-2 border-slate-500"
                  style={{
                    borderRadius: '3px 10px 10px 3px',
                    boxShadow: '6px 6px 16px rgba(0,0,0,0.4), -2px 0 6px rgba(0,0,0,0.2)'
                  }}
                />

                {/* Zoom hint on hover */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all opacity-0 group-hover:opacity-100 pointer-events-none"
                     style={{ borderRadius: '3px 10px 10px 3px' }}>
                  <div className="bg-slate-800/90 rounded-full p-2">
                    <ZoomIn className="w-5 h-5 text-white" />
                  </div>
                </div>
              </div>

              {/* Minimize cover icon - top right of cover on hover (underscore symbol) */}
              {coverHovered && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCoverState('minimized');
                  }}
                  className="absolute -top-2 -right-2 z-20 w-6 h-6 flex items-center justify-center bg-slate-700/95 rounded-md hover:bg-slate-600 transition-all border border-slate-500"
                  title="Minimize cover (_)"
                  aria-label="Minimize cover"
                >
                  <span className="text-slate-300 font-bold text-sm leading-none pb-1">_</span>
                </button>
              )}

              {/* Regenerate cover button - BOTTOM-LEFT */}
              {onRegenerateCover && !hideRegenerateButtons && coverHovered && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRegenerateCover(); }}
                  disabled={isRegeneratingCover}
                  className={`
                    absolute bottom-2 left-2 z-20 p-1.5 rounded-lg transition-all
                    ${isRegeneratingCover
                      ? 'bg-slate-800/90 cursor-wait'
                      : 'bg-slate-800/80 hover:bg-slate-700'}
                  `}
                  title="Regenerate cover art"
                >
                  {isRegeneratingCover ? (
                    <Loader2 className="w-3.5 h-3.5 text-golden-400 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-slate-300" />
                  )}
                </button>
              )}
            </div>
          )}

          {/* Minimized cover (small square in top-left of text area) */}
          {/* Size 44x44px minimum for WCAG 2.5.5 touch target compliance */}
          {effectiveCoverUrl && coverState === 'minimized' && (
            <button
              onClick={() => setCoverState('full')}
              className="book-cover-minimized w-11 h-11 rounded-md overflow-hidden border border-slate-500 hover:border-amber-400/50 transition-all flex-shrink-0 opacity-80 hover:opacity-100"
              title="Click to restore cover"
              aria-label="Restore cover image"
            >
              <img src={effectiveCoverUrl} alt="" className="w-full h-full object-cover" />
            </button>
          )}

          {/* Title */}
          {title && (
            <h1 className="book-title text-2xl md:text-3xl font-bold mb-2 text-golden-400 font-serif leading-tight">
              {title}
            </h1>
          )}

          {/* Story Details Badge (expandable) - does NOT include synopsis */}
          {hasStoryDetails && (
            <div className="story-details-badge mb-3">
              <button
                onClick={() => setDetailsExpanded(!detailsExpanded)}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/60 rounded-lg hover:bg-slate-700 transition-all text-sm"
                aria-expanded={detailsExpanded}
                aria-controls="story-details-content"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-300">Story Details</span>
                {detailsExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {detailsExpanded && (
                <div id="story-details-content" className="mt-2 p-3 bg-slate-900/50 rounded-lg border border-slate-600 text-sm space-y-2">
                  {/* Story details badges - synopsis moved out to separate section */}
                  {storyDetails.authorStyle && (
                    <p className="text-slate-400 italic">
                      In the style of <span className="text-slate-300">{storyDetails.authorStyle}</span>
                    </p>
                  )}
                  {storyDetails.setting && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
                      <span className="text-slate-300">{storyDetails.setting}</span>
                    </div>
                  )}
                  {storyDetails.themes?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {storyDetails.themes.map((theme, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 bg-slate-800 rounded text-slate-400 text-xs"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  )}
                  {storyDetails.mood && (
                    <p className="text-slate-400">
                      Mood: <span className="text-slate-300">{storyDetails.mood}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Synopsis - collapsible section below story details badge */}
          <CollapsibleSynopsis
            synopsis={synopsis}
            chapterIndex={chapterIndex}
            onRegenerateSynopsis={onRegenerateSynopsis}
            isRegeneratingSynopsis={isRegeneratingSynopsis}
            hideRegenerateButton={hideRegenerateButtons}
          />

          {/* Story text flows naturally around cover like old-school indent */}

          {/* Story Text with Karaoke highlighting */}
          {storyText && (
            <div className="story-text-section story-text-readable leading-relaxed">
              {textLayout === 'modal' ? (
                /* Modal mode - One paragraph at a time */
                <div className="modal-text-layout max-w-md mx-auto border border-slate-700 p-6 rounded-lg min-h-64 flex flex-col justify-between">
                  <div className="flex-1 overflow-y-auto mb-4">
                    {words.length > 0 ? (
                      /* Karaoke mode in modal */
                      <div className="story-karaoke leading-loose" style={{ fontSize: `${fontSize}px` }}>
                        {words.map((word, idx) => {
                          const rawText = word.text || word.word || '';
                          const wordText = stripAllTags(rawText).trim();
                          const isOnCurrentLine = currentLineRange.start >= 0 &&
                            idx >= currentLineRange.start &&
                            idx <= currentLineRange.end;
                          const needsSpace = idx < words.length - 1 && !wordText.endsWith('-');
                          return (
                            <span key={idx}>
                              <span
                                ref={el => wordRefs.current.set(idx, el)}
                                onClick={() => handleWordClick(idx)}
                                className={`
                                  inline px-1 py-0.5 rounded-sm cursor-pointer
                                  transition-colors duration-100 ease-out
                                  ${idx === currentWordIndex
                                    ? 'bg-golden-400/90 text-slate-900 font-semibold'
                                    : idx < currentWordIndex
                                      ? 'text-slate-500'
                                      : 'text-slate-100 hover:bg-slate-700/30'
                                  }
                                  ${isOnCurrentLine && idx !== currentWordIndex ? 'karaoke-current-line' : ''}
                                `}
                              >
                                {wordText}
                              </span>
                              {needsSpace && ' '}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      /* Plain paragraph in modal */
                      <p className="paragraph whitespace-pre-wrap text-inherit" style={{ fontSize: `${fontSize}px` }}>
                        {paragraphs[currentParagraphIndex] || ''}
                      </p>
                    )}
                  </div>
                  {/* Navigation controls */}
                  <div className="flex justify-between items-center gap-4 pt-4 border-t border-slate-700">
                    <button
                      onClick={handlePrevParagraph}
                      disabled={currentParagraphIndex === 0}
                      className="flex items-center gap-1 px-3 py-2 bg-slate-700/60 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm text-slate-200 transition-colors"
                      aria-label="Previous paragraph"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </button>
                    <span className="text-xs text-slate-400">
                      {currentParagraphIndex + 1} / {paragraphs.length}
                    </span>
                    <button
                      onClick={handleNextParagraph}
                      disabled={currentParagraphIndex >= paragraphs.length - 1}
                      className="flex items-center gap-1 px-3 py-2 bg-slate-700/60 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm text-slate-200 transition-colors"
                      aria-label="Next paragraph"
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : textLayout === 'horizontal' ? (
                /* Horizontal mode - Two columns */
                <div className="horizontal-text-layout grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 max-w-4xl mx-auto">
                  {words.length > 0 ? (
                    /* Karaoke mode in two columns */
                    <div className="story-karaoke leading-loose col-span-2" style={{ fontSize: `${fontSize}px` }}>
                      {words.map((word, idx) => {
                        const rawText = word.text || word.word || '';
                        const wordText = stripAllTags(rawText).trim();
                        const isOnCurrentLine = currentLineRange.start >= 0 &&
                          idx >= currentLineRange.start &&
                          idx <= currentLineRange.end;
                        const needsSpace = idx < words.length - 1 && !wordText.endsWith('-');
                        return (
                          <span key={idx}>
                            <span
                              ref={el => wordRefs.current.set(idx, el)}
                              onClick={() => handleWordClick(idx)}
                              className={`
                                inline px-1 py-0.5 rounded-sm cursor-pointer
                                transition-colors duration-100 ease-out
                                ${idx === currentWordIndex
                                  ? 'bg-golden-400/90 text-slate-900 font-semibold'
                                  : idx < currentWordIndex
                                    ? 'text-slate-500'
                                    : 'text-slate-100 hover:bg-slate-700/30'
                                }
                                ${isOnCurrentLine && idx !== currentWordIndex ? 'karaoke-current-line' : ''}
                              `}
                            >
                              {wordText}
                            </span>
                            {needsSpace && ' '}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    /* Plain text in two columns */
                    paragraphs.map((paragraph, idx) => (
                      <p key={idx} className="paragraph whitespace-pre-wrap text-inherit" style={{ fontSize: `${fontSize}px` }}>
                        {paragraph}
                      </p>
                    ))
                  )}
                </div>
              ) : (
                /* Vertical mode - Default layout */
                <div className="vertical-text-layout max-w-2xl">
                  {words.length > 0 ? (
                    /* Karaoke mode - word by word highlighting */
                    <div className="story-karaoke leading-loose" style={{ fontSize: `${fontSize}px` }}>
                      {words.map((word, idx) => {
                        // Strip prosody tags from word text (safety net for any tags that slip through)
                        const rawText = word.text || word.word || '';
                        // Strip tags AND trailing/leading whitespace from the word itself
                        const wordText = stripAllTags(rawText).trim();
                        // Check if this word is on the current line being read
                        const isOnCurrentLine = currentLineRange.start >= 0 &&
                          idx >= currentLineRange.start &&
                          idx <= currentLineRange.end;
                        // Add space after word unless it's the last word or ends with hyphen
                        const needsSpace = idx < words.length - 1 && !wordText.endsWith('-');
                        return (
                          <span key={idx}>
                            <span
                              ref={el => wordRefs.current.set(idx, el)}
                              onClick={() => handleWordClick(idx)}
                              className={`
                                inline px-1 py-0.5 rounded-sm cursor-pointer
                                transition-colors duration-100 ease-out
                                ${idx === currentWordIndex
                                  ? 'bg-golden-400/90 text-slate-900 font-semibold'
                                  : idx < currentWordIndex
                                    ? 'text-slate-500'
                                    : 'text-slate-100 hover:bg-slate-700/30'
                                }
                                ${isOnCurrentLine && idx !== currentWordIndex ? 'karaoke-current-line' : ''}
                              `}
                            >
                              {wordText}
                            </span>
                            {needsSpace && ' '}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    /* Plain text fallback - Kindle-style readable formatting */
                    <div className="story-plain" style={{ fontSize: `${fontSize}px` }}>
                      {paragraphs.map((paragraph, idx) => (
                        <p key={idx} className="paragraph whitespace-pre-wrap text-inherit">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty state when no content */}
          {!hasContent && (
            <div className="text-center py-8">
              <BookOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500">Your story will appear here...</p>
            </div>
          )}
        </div>

        {/* Word count footer (only when karaoke active) */}
        {words.length > 0 && (
          <div className="px-5 py-2 bg-slate-900/80 border-t border-slate-700/50 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-slate-600" />
              <span className="text-slate-600">Read Along Mode</span>
            </div>
            <span className="text-slate-600">
              {currentWordIndex >= 0 ? currentWordIndex + 1 : 0} / {words.length} words
            </span>
          </div>
        )}
      </div>

      {/* CSS for book page layout */}
      <style>{`
        .book-page-container {
          width: 100%;
        }

        .book-page-collapsed {
          display: flex;
          align-items: center;
          padding: 0.5rem;
        }

        .book-page-scroll {
          overflow-wrap: break-word;
          word-wrap: break-word;
        }

        /* Floating cover - creates book page effect */
        /* Cover top aligns with title top via consistent margin */
        .book-cover-float {
          float: left;
          margin-right: 1.25rem;
          margin-bottom: 0.75rem;
          margin-top: 0;
          shape-outside: margin-box;
        }

        .book-cover-image {
          width: 140px;
          height: 196px;
        }

        /* Minimized cover in corner */
        .book-cover-minimized {
          float: left;
          margin-right: 0.75rem;
          margin-bottom: 0.5rem;
        }

        /* Story text wraps around cover - NO clear:both */
        /* Text naturally flows around the floated cover image */
        /* Only takes full width when it goes below the cover height */
        .story-text-section {
          /* Do NOT clear - let it wrap around cover like old-school indent */
        }

        /* Synopsis also wraps around cover */
        .synopsis-section {
          /* Don't clear - let it wrap */
        }

        /* Story details badge */
        .story-details-badge {
          display: inline-block;
        }

        /* Title styling */
        .book-title {
          /* Title wraps around cover too */
        }

        /* Custom scrollbar */
        .book-page-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .book-page-scroll::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }
        .book-page-scroll::-webkit-scrollbar-thumb {
          background: rgba(212, 175, 55, 0.3);
          border-radius: 3px;
        }
        .book-page-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(212, 175, 55, 0.5);
        }

        /* Responsive adjustments */
        @media (min-width: 768px) {
          .book-cover-image {
            width: 180px;
            height: 252px;
          }
          .book-cover-float {
            margin-right: 1.5rem;
            margin-bottom: 1rem;
          }
        }

        /* Mobile portrait - smaller cover */
        @media (max-width: 480px) {
          .book-cover-image {
            width: 100px;
            height: 140px;
          }
          .book-cover-float {
            margin-right: 0.75rem;
            margin-bottom: 0.5rem;
          }
        }

        /* Mobile landscape - side layout */
        @media (max-width: 767px) and (orientation: landscape) {
          .book-cover-image {
            width: 120px;
            height: 168px;
          }
        }
      `}</style>
    </div>
  );
}

export default BookPageLayout;
