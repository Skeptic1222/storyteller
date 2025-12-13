/**
 * StoryBookView Component
 * Unified document view with title, cover, synopsis, and story text.
 * Responsive layout: PC (cover left, synopsis right) / Mobile (stacked).
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  BookOpen, ChevronDown, ChevronUp,
  Maximize2, Minimize2, Minus, RefreshCw, Image
} from 'lucide-react';

function StoryBookView({
  // Story metadata
  title = 'Your Story',
  synopsis = '',
  authorStyle = '',
  setting = '',
  themes = [],

  // Current scene info
  sceneIndex = 0,
  totalScenes = 0,
  sceneText = '',

  // Karaoke/word highlighting
  wordTimings = null,
  currentWordIndex = -1,

  // Audio state
  isPlaying = false,
  currentTime = 0,
  duration = 0,

  // Cover image
  coverImageUrl = null,

  // Display options
  showSynopsis: initialShowSynopsis = true,
  fullscreenEnabled = true,

  // Callbacks
  onWordClick,
  onToggleFullscreen,
  onRegenerateCover,

  className = ''
}) {
  const containerRef = useRef(null);
  const wordRefs = useRef(new Map());
  const textContainerRef = useRef(null);
  const storyStartRef = useRef(null);

  const [synopsisExpanded, setSynopsisExpanded] = useState(initialShowSynopsis);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [coverMinimized, setCoverMinimized] = useState(false);
  const [coverFullscreen, setCoverFullscreen] = useState(false);
  const [textMinimized, setTextMinimized] = useState(false);

  // Parse words from timing data
  const words = useMemo(() => {
    if (!wordTimings?.words) {
      console.log('[StoryBookView] No word timings available');
      return [];
    }
    const wordArray = Array.isArray(wordTimings.words) ? wordTimings.words : [];
    console.log('[StoryBookView] Parsed', wordArray.length, 'words for karaoke');
    return wordArray;
  }, [wordTimings]);

  // Auto-scroll to current word during playback
  // Uses containerRef (the scrollable container with overflow-y-auto) for proper scroll detection
  useEffect(() => {
    if (currentWordIndex >= 0 && currentWordIndex < words.length) {
      const wordEl = wordRefs.current.get(currentWordIndex);
      if (wordEl && containerRef.current) {
        const container = containerRef.current;
        const wordRect = wordEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Scroll if word is outside visible area (with padding for header/footer)
        if (wordRect.top < containerRect.top + 80 || wordRect.bottom > containerRect.bottom - 80) {
          console.log('[StoryBookView] Auto-scrolling to word', currentWordIndex, words[currentWordIndex]?.text);
          wordEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      }
    }
  }, [currentWordIndex, words]);

  // Auto-scroll to story start when playback begins
  useEffect(() => {
    if (isPlaying && currentWordIndex === 0 && storyStartRef.current) {
      // Scroll to story start when first word starts playing
      setTimeout(() => {
        storyStartRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    }
  }, [isPlaying, currentWordIndex]);

  // Toggle fullscreen
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
      onToggleFullscreen?.(!isFullscreen);
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle word click for seeking
  const handleWordClick = (wordIndex) => {
    if (words[wordIndex] && onWordClick) {
      onWordClick(wordIndex, words[wordIndex].start_ms / 1000);
    }
  };

  // Format scene progress
  const sceneProgress = totalScenes > 0
    ? `Scene ${sceneIndex + 1} of ${totalScenes}`
    : sceneIndex > 0
      ? `Scene ${sceneIndex + 1}`
      : '';

  return (
    <div
      ref={containerRef}
      className={`
        story-document
        ${isFullscreen
          ? 'fixed inset-0 z-50 bg-night-950 overflow-y-auto'
          : 'relative bg-night-900/95 rounded-2xl border border-night-700 overflow-y-auto max-h-[80vh]'
        }
        ${className}
      `}
    >
      {/* Title Header */}
      <header className={`
        sticky top-0 z-20 bg-night-900/95 backdrop-blur-sm border-b border-night-700/50
        ${isFullscreen ? 'px-8 py-6' : 'px-6 py-4'}
      `}>
        <div className="flex items-start justify-between gap-4">
          {/* Title and Author */}
          <div className="flex-1 min-w-0">
            <h1 className={`
              font-serif text-golden-400 font-bold leading-tight
              ${isFullscreen ? 'text-4xl' : 'text-3xl'}
            `}>
              {title}
            </h1>
            {authorStyle && (
              <p className={`text-night-500 italic mt-1 ${isFullscreen ? 'text-lg' : 'text-sm'}`}>
                In the style of {authorStyle}
              </p>
            )}
            {sceneProgress && (
              <div className={`mt-2 ${isFullscreen ? 'text-base' : 'text-sm'}`}>
                <span className="text-night-500">{sceneProgress}</span>
                {isPlaying && (
                  <span className="ml-3 text-green-400 text-xs animate-pulse">
                    Playing
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Text window controls - minimize and maximize */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Minimize text button */}
            <button
              onClick={() => setTextMinimized(!textMinimized)}
              className="p-2 rounded-lg bg-night-800 text-night-400 hover:text-night-200 transition-colors"
              title={textMinimized ? 'Expand text' : 'Minimize text'}
            >
              <Minus className="w-5 h-5" />
            </button>

            {/* Fullscreen toggle */}
            {fullscreenEnabled && (
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg bg-night-800 text-night-400 hover:text-night-200 transition-colors"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Newspaper-Style Layout - Cover floats, text wraps around */}
      {/* Collapsible when minimized */}
      {!textMinimized ? (
        <section className={`
          story-flow-container
          ${isFullscreen ? 'px-8 py-6' : 'px-6 py-6'}
        `}>
          {/* Floating Cover Image - Text wraps around it */}
          {coverImageUrl && !coverMinimized && (
          <div className="story-cover-float relative group">
            {/* Cover image - click to open fullscreen */}
            <img
              src={coverImageUrl}
              alt="Story cover"
              onClick={() => setCoverFullscreen(true)}
              className="cover-image rounded-xl shadow-2xl border-2 border-night-600 cursor-pointer hover:border-golden-400 transition-colors"
            />

            {/* Minimize cover icon - top right, shows on hover */}
            {/* Click anywhere else on cover opens fullscreen */}
            <button
              onClick={(e) => { e.stopPropagation(); setCoverMinimized(true); }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-night-900/80 text-night-400 hover:text-night-200 hover:bg-night-800 opacity-0 group-hover:opacity-100 transition-all"
              title="Minimize cover"
            >
              <Minus className="w-4 h-4" />
            </button>

            {/* Regenerate button - bottom left, shows on hover */}
            {onRegenerateCover && (
              <button
                onClick={(e) => { e.stopPropagation(); onRegenerateCover(); }}
                className="absolute bottom-2 left-2 p-1.5 rounded-lg bg-night-900/80 text-night-400 hover:text-amber-400 hover:bg-night-800 opacity-0 group-hover:opacity-100 transition-all"
                title="Regenerate cover"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Minimized cover - small thumbnail icon */}
        {coverImageUrl && coverMinimized && (
          <button
            onClick={() => setCoverMinimized(false)}
            className="story-cover-minimized float-left mr-4 mb-2 p-2 rounded-lg bg-night-800 border border-night-600 hover:border-golden-400 transition-colors group"
            title="Expand cover"
          >
            <Image className="w-6 h-6 text-night-400 group-hover:text-golden-400" />
          </button>
        )}

        {/* Synopsis - Flows around cover */}
        {synopsis && (
          <div className="synopsis-flow mb-6">
            <button
              onClick={() => setSynopsisExpanded(!synopsisExpanded)}
              className="w-full flex items-center justify-between text-left group mb-3"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <span className={`text-amber-400 font-medium ${isFullscreen ? 'text-lg' : 'text-base'}`}>
                  Synopsis
                </span>
              </div>
              {synopsisExpanded ? (
                <ChevronUp className="w-4 h-4 text-night-500 group-hover:text-night-300" />
              ) : (
                <ChevronDown className="w-4 h-4 text-night-500 group-hover:text-night-300" />
              )}
            </button>

            {synopsisExpanded && (
              <div className={isFullscreen ? 'text-lg' : 'text-base'}>
                <p className="text-night-300 leading-relaxed">
                  {synopsis}
                </p>

                {/* Themes */}
                {themes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {themes.map((theme, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-night-800 rounded text-night-400 text-xs"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                )}

                {setting && (
                  <div className="mt-3 text-night-400 text-sm">
                    <span className="font-medium">Setting:</span> {setting}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Story Content - Also flows around cover (newspaper-style) */}
        <div ref={storyStartRef} className="story-text-flow">
        <div ref={textContainerRef}>
          {words.length > 0 ? (
            /* Karaoke mode - word by word highlighting */
            <div className={`
              story-karaoke-text font-serif leading-loose
              ${isFullscreen
                ? 'text-2xl md:text-3xl'
                : 'text-xl'
              }
            `}>
              {words.map((word, idx) => {
                // Handle both 'text' and 'word' properties (different data structures)
                const wordText = word.text || word.word || '';
                return (
                  <span
                    key={idx}
                    ref={el => wordRefs.current.set(idx, el)}
                    onClick={() => handleWordClick(idx)}
                    className={`
                      inline-block px-1 py-0.5 mx-0.5 rounded cursor-pointer
                      transition-all duration-150 ease-out
                      ${idx === currentWordIndex
                        ? 'bg-golden-400 text-night-900 scale-110 font-semibold shadow-lg shadow-golden-400/40'
                        : idx < currentWordIndex
                          ? 'text-night-500'
                          : 'text-night-200 hover:bg-night-700/50'
                      }
                    `}
                  >
                    {wordText}
                  </span>
                );
              })}
            </div>
          ) : sceneText ? (
            /* Plain text fallback */
            <div className={`
              story-plain-text font-serif leading-loose text-night-200
              ${isFullscreen
                ? 'text-2xl md:text-3xl'
                : 'text-xl'
              }
            `}>
              <p className="whitespace-pre-wrap">{sceneText}</p>
            </div>
          ) : (
            /* Empty state */
            <div className="text-center py-12">
              <BookOpen className="w-12 h-12 text-night-600 mx-auto mb-4" />
              <p className="text-night-500">
                The story will appear here...
              </p>
            </div>
          )}
        </div>
        </div>
      </section>
      ) : (
        /* Minimized state - compact view */
        <div className="px-6 py-4 text-center text-night-500 border-b border-night-700/30">
          <p className="text-sm">Story text minimized. Click the expand button to show.</p>
        </div>
      )}

      {/* Footer - Reading indicator */}
      {words.length > 0 && (
        <footer className={`
          sticky bottom-0 z-20 bg-night-900/95 backdrop-blur-sm border-t border-night-700/30
          ${isFullscreen ? 'px-8 py-4' : 'px-6 py-3'}
        `}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-night-600" />
              <span className="text-night-600 text-xs">
                Read Along Mode
              </span>
            </div>

            <span className="text-night-600 text-xs">
              {currentWordIndex >= 0 ? currentWordIndex + 1 : 0} / {words.length} words
            </span>
          </div>
        </footer>
      )}

      {/* Cover Fullscreen Overlay */}
      {coverFullscreen && coverImageUrl && (
        <div
          className="fixed inset-0 z-[100] bg-night-950/95 flex items-center justify-center p-4"
          onClick={() => setCoverFullscreen(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={coverImageUrl}
              alt="Story cover fullscreen"
              className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            />

            {/* Close button */}
            <button
              onClick={() => setCoverFullscreen(false)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-night-900/80 text-night-400 hover:text-night-200 hover:bg-night-800 transition-colors"
              title="Close"
            >
              <Minimize2 className="w-5 h-5" />
            </button>

            {/* Regenerate button */}
            {onRegenerateCover && (
              <button
                onClick={(e) => { e.stopPropagation(); onRegenerateCover(); }}
                className="absolute bottom-4 left-4 p-2 rounded-lg bg-night-900/80 text-night-400 hover:text-amber-400 hover:bg-night-800 transition-colors"
                title="Regenerate cover"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* CSS-in-JS for newspaper-style float layout */}
      <style>{`
        /* Container for flow content */
        .story-flow-container {
          overflow: hidden; /* Contain floats */
        }

        /* PC Layout (min-width: 768px) - Cover floats left, text wraps */
        @media (min-width: 768px) {
          .story-cover-float {
            float: left;
            width: 280px;
            margin-right: 1.5rem;
            margin-bottom: 1rem;
            shape-outside: margin-box;
          }
          .cover-image {
            width: 100%;
            max-width: 280px;
          }
          .synopsis-flow {
            /* Synopsis flows around the cover */
          }
          .story-text-flow {
            /* Text also flows around the cover */
          }
        }

        /* Large screens - bigger cover */
        @media (min-width: 1024px) {
          .story-cover-float {
            width: 320px;
          }
          .cover-image {
            max-width: 320px;
          }
        }

        /* Mobile Portrait (max-width: 767px) - Stacked layout */
        @media (max-width: 767px) {
          .story-cover-float {
            float: none;
            width: 100%;
            display: flex;
            justify-content: center;
            margin-bottom: 1.5rem;
          }
          .cover-image {
            width: 60%;
            max-width: 200px;
          }
          .synopsis-flow,
          .story-text-flow {
            clear: both;
          }
        }

        /* Mobile Landscape - Smaller float */
        @media (max-width: 767px) and (orientation: landscape) {
          .story-cover-float {
            float: left;
            width: 150px;
            margin-right: 1rem;
            margin-bottom: 0.5rem;
          }
          .cover-image {
            width: 100%;
            max-width: 150px;
          }
        }
      `}</style>
    </div>
  );
}

export default StoryBookView;
