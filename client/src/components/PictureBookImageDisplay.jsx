/**
 * PictureBookImageDisplay Component
 *
 * Displays scene images synchronized with narration.
 * Images crossfade as the story is read aloud.
 *
 * Features:
 * - Automatic image transitions synced to word timing
 * - Smooth crossfade animations
 * - Ken Burns effects for cinematic feel
 * - Manual navigation when paused
 * - Progress indicator dots
 * - Fullscreen mode
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Image, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-react';

// Ken Burns effect variations - cycled through for visual variety
const KEN_BURNS_EFFECTS = [
  'ken-burns-zoom-in',
  'ken-burns-pan-left',
  'ken-burns-zoom-out',
  'ken-burns-pan-right',
  'ken-burns-zoom-pan-ne',
  'ken-burns-pan-up',
  'ken-burns-zoom-pan-sw',
  'ken-burns-pan-down'
];

function PictureBookImageDisplay({
  images = [],           // Array of {image_url, trigger_word_index, trigger_time_ms, ken_burns_effect?}
  currentWordIndex = -1, // From karaoke word tracking
  currentTime = 0,       // Current audio time in seconds
  isPlaying = false,
  enableKenBurns = true, // Enable Ken Burns animations
  className = ''
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const prevImageRef = useRef(null);
  const containerRef = useRef(null);
  const isTouchDevice = useMemo(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  ), []);
  const supportsHover = useMemo(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  ), []);

  // Sort images by trigger time
  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) =>
      (a.trigger_time_ms || 0) - (b.trigger_time_ms || 0)
    );
  }, [images]);

  // Calculate duration for Ken Burns based on time until next image
  const getKenBurnsDuration = useCallback((imageIndex) => {
    if (imageIndex >= sortedImages.length - 1) {
      return 15; // Default 15s for last image
    }
    const currentTrigger = sortedImages[imageIndex]?.trigger_time_ms || 0;
    const nextTrigger = sortedImages[imageIndex + 1]?.trigger_time_ms || currentTrigger + 15000;
    const durationMs = nextTrigger - currentTrigger;
    // Clamp between 5s and 30s
    return Math.max(5, Math.min(30, durationMs / 1000));
  }, [sortedImages]);

  // Get Ken Burns effect for an image
  const getKenBurnsEffect = useCallback((imageIndex) => {
    if (!enableKenBurns) return '';
    // Use specified effect or cycle through available effects
    const image = sortedImages[imageIndex];
    if (image?.ken_burns_effect) {
      return `ken-burns-${image.ken_burns_effect.replace('_', '-')}`;
    }
    return KEN_BURNS_EFFECTS[imageIndex % KEN_BURNS_EFFECTS.length];
  }, [sortedImages, enableKenBurns]);

  // Reset to first image when images change
  useEffect(() => {
    setCurrentImageIndex(0);
    setImageLoaded(false);
  }, [images]);

  // Determine which image should be shown based on current playback position
  useEffect(() => {
    if (!isPlaying || sortedImages.length === 0) return;

    const currentTimeMs = currentTime * 1000;

    // Find the most recent image that should be displayed
    let targetIndex = 0;
    for (let i = 0; i < sortedImages.length; i++) {
      if (sortedImages[i].trigger_time_ms <= currentTimeMs) {
        targetIndex = i;
      } else {
        break;
      }
    }

    if (targetIndex !== currentImageIndex) {
      // Trigger crossfade transition
      setIsTransitioning(true);
      prevImageRef.current = sortedImages[currentImageIndex]?.image_url;

      setTimeout(() => {
        setCurrentImageIndex(targetIndex);
        setTimeout(() => setIsTransitioning(false), 500);
      }, 100);
    }
  }, [currentTime, sortedImages, isPlaying, currentImageIndex]);

  // Also update based on word index for more precise sync
  useEffect(() => {
    if (currentWordIndex < 0 || sortedImages.length === 0) return;

    let targetIndex = 0;
    for (let i = 0; i < sortedImages.length; i++) {
      if (sortedImages[i].trigger_word_index <= currentWordIndex) {
        targetIndex = i;
      } else {
        break;
      }
    }

    if (targetIndex !== currentImageIndex && !isTransitioning) {
      setIsTransitioning(true);
      prevImageRef.current = sortedImages[currentImageIndex]?.image_url;

      setTimeout(() => {
        setCurrentImageIndex(targetIndex);
        setTimeout(() => setIsTransitioning(false), 500);
      }, 100);
    }
  }, [currentWordIndex, sortedImages, currentImageIndex, isTransitioning]);

  // Manual navigation (when paused)
  const goToImage = (index) => {
    if (index >= 0 && index < sortedImages.length) {
      setIsTransitioning(true);
      prevImageRef.current = sortedImages[currentImageIndex]?.image_url;
      setTimeout(() => {
        setCurrentImageIndex(index);
        setTimeout(() => setIsTransitioning(false), 300);
      }, 50);
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  if (sortedImages.length === 0) {
    return (
      <div className={`picture-book-placeholder ${className}`}>
        <div className="flex items-center justify-center h-64 bg-slate-800 rounded-xl border border-slate-700">
          <div className="text-center text-slate-500">
            <Image className="w-12 h-12 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Picture book images will appear here</p>
          </div>
        </div>
      </div>
    );
  }

  const currentImage = sortedImages[currentImageIndex];
  const kbDuration = getKenBurnsDuration(currentImageIndex);
  const kbEffect = getKenBurnsEffect(currentImageIndex);

  return (
    <div
      ref={containerRef}
      className={`picture-book-display relative ${className} ${isFullscreen ? 'picture-book-fullscreen' : ''}`}
    >
      {/* Image container with crossfade and Ken Burns */}
      <div className="ken-burns-container relative overflow-hidden rounded-xl aspect-video bg-slate-900 shadow-xl">
        {/* Loading state */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800 z-10">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        )}

        {/* Previous image (for crossfade) */}
        {isTransitioning && prevImageRef.current && (
          <img
            src={prevImageRef.current}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 opacity-0"
          />
        )}

        {/* Current image with Ken Burns effect */}
        <img
          src={currentImage.image_url}
          alt={`Scene illustration ${currentImageIndex + 1}`}
          onLoad={() => setImageLoaded(true)}
          style={{
            '--kb-duration': `${kbDuration}s`
          }}
          className={`
            w-full h-full object-cover
            transition-opacity duration-500
            ${isTransitioning ? 'opacity-0' : 'opacity-100'}
            ${!imageLoaded ? 'opacity-0' : ''}
            ${enableKenBurns && imageLoaded ? kbEffect : ''}
            ${!isPlaying && enableKenBurns ? 'ken-burns-paused' : ''}
          `}
        />

        {/* Image progress indicator dots */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 bg-slate-900/60 px-3 py-2 rounded-full z-20">
          {sortedImages.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goToImage(idx)}
              className={`
                ${isTouchDevice ? 'w-11 h-11' : 'w-6 h-6'} rounded-full transition-all duration-200 flex items-center justify-center
                ${idx === currentImageIndex ? 'bg-slate-800/60' : supportsHover ? 'hover:bg-slate-700/50' : ''}
              `}
              aria-label={`Go to image ${idx + 1}`}
            >
              <span
                className={`
                  w-2.5 h-2.5 rounded-full transition-all duration-200
                  ${idx === currentImageIndex
                    ? 'bg-amber-400 scale-125 shadow-md shadow-amber-400/50'
                    : idx < currentImageIndex
                      ? 'bg-amber-400/50'
                      : `bg-slate-500 ${supportsHover ? 'hover:bg-slate-400' : ''}`
                  }
                `}
              />
            </button>
          ))}
        </div>

        {/* Navigation arrows (visible when paused or on hover) */}
        {sortedImages.length > 1 && (
          <>
            <button
              onClick={() => goToImage(currentImageIndex - 1)}
              disabled={currentImageIndex === 0}
              className={`
                absolute left-2 top-1/2 transform -translate-y-1/2 z-20
                w-11 h-11 rounded-full bg-slate-900/80
                flex items-center justify-center
                text-slate-300 ${supportsHover ? 'hover:text-white hover:bg-slate-800' : ''}
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-opacity duration-200
                ${isPlaying && supportsHover ? 'opacity-0 hover:opacity-100' : 'opacity-100'}
              `}
              aria-label="Previous image"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => goToImage(currentImageIndex + 1)}
              disabled={currentImageIndex === sortedImages.length - 1}
              className={`
                absolute right-2 top-1/2 transform -translate-y-1/2 z-20
                w-11 h-11 rounded-full bg-slate-900/80
                flex items-center justify-center
                text-slate-300 ${supportsHover ? 'hover:text-white hover:bg-slate-800' : ''}
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-opacity duration-200
                ${isPlaying && supportsHover ? 'opacity-0 hover:opacity-100' : 'opacity-100'}
              `}
              aria-label="Next image"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Fullscreen toggle button */}
        <button
          onClick={toggleFullscreen}
          className={`
            absolute top-3 left-3 z-20
            w-11 h-11 rounded-full bg-slate-900/70
            flex items-center justify-center
            text-slate-300 ${supportsHover ? 'hover:text-white hover:bg-slate-800' : ''}
            transition-opacity duration-200
            ${isPlaying && supportsHover ? 'opacity-0 hover:opacity-100' : 'opacity-100'}
          `}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
        </button>

        {/* Playing indicator */}
        {isPlaying && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-slate-900/70 rounded-full z-20">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-300">Auto</span>
          </div>
        )}

        {/* Ken Burns indicator (debug, can be removed) */}
        {enableKenBurns && isPlaying && (
          <div className="absolute bottom-14 right-3 px-2 py-1 bg-slate-900/50 rounded text-xs text-slate-400 z-20">
            {kbEffect.replace('ken-burns-', '')} · {kbDuration}s
          </div>
        )}
      </div>

      {/* Image counter */}
      {!isFullscreen && (
        <div className="text-center mt-2 text-slate-500 text-sm">
          {currentImageIndex + 1} / {sortedImages.length} illustrations
        </div>
      )}
    </div>
  );
}

export default PictureBookImageDisplay;
