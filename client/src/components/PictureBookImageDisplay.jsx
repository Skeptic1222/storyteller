/**
 * PictureBookImageDisplay Component
 *
 * Displays scene images synchronized with narration.
 * Images crossfade as the story is read aloud.
 *
 * Features:
 * - Automatic image transitions synced to word timing
 * - Smooth crossfade animations
 * - Manual navigation when paused
 * - Progress indicator dots
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Image, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

function PictureBookImageDisplay({
  images = [],           // Array of {image_url, trigger_word_index, trigger_time_ms}
  currentWordIndex = -1, // From karaoke word tracking
  currentTime = 0,       // Current audio time in seconds
  isPlaying = false,
  className = ''
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const prevImageRef = useRef(null);

  // Sort images by trigger time
  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) =>
      (a.trigger_time_ms || 0) - (b.trigger_time_ms || 0)
    );
  }, [images]);

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

  return (
    <div className={`picture-book-display relative ${className}`}>
      {/* Image container with crossfade */}
      <div className="relative overflow-hidden rounded-xl aspect-square bg-slate-900 shadow-xl">
        {/* Loading state */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
            <Loader2 className="w-8 h-8 text-golden-400 animate-spin" />
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

        {/* Current image */}
        <img
          src={currentImage.image_url}
          alt={`Scene illustration ${currentImageIndex + 1}`}
          onLoad={() => setImageLoaded(true)}
          className={`
            w-full h-full object-cover
            transition-opacity duration-500
            ${isTransitioning ? 'opacity-0' : 'opacity-100'}
            ${!imageLoaded ? 'opacity-0' : ''}
          `}
        />

        {/* Image progress indicator dots */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 bg-slate-900/60 px-3 py-2 rounded-full">
          {sortedImages.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goToImage(idx)}
              className={`
                w-2 h-2 rounded-full transition-all duration-200
                ${idx === currentImageIndex
                  ? 'bg-golden-400 scale-125 shadow-md shadow-golden-400/50'
                  : idx < currentImageIndex
                    ? 'bg-golden-400/50'
                    : 'bg-slate-500 hover:bg-slate-400'
                }
              `}
              aria-label={`Go to image ${idx + 1}`}
            />
          ))}
        </div>

        {/* Navigation arrows (visible when paused or on hover) */}
        {sortedImages.length > 1 && (
          <>
            <button
              onClick={() => goToImage(currentImageIndex - 1)}
              disabled={currentImageIndex === 0}
              className={`
                absolute left-2 top-1/2 transform -translate-y-1/2
                p-2 rounded-full bg-slate-900/80
                text-slate-300 hover:text-white hover:bg-slate-800
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-opacity duration-200
                ${isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'}
              `}
              aria-label="Previous image"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() => goToImage(currentImageIndex + 1)}
              disabled={currentImageIndex === sortedImages.length - 1}
              className={`
                absolute right-2 top-1/2 transform -translate-y-1/2
                p-2 rounded-full bg-slate-900/80
                text-slate-300 hover:text-white hover:bg-slate-800
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-opacity duration-200
                ${isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'}
              `}
              aria-label="Next image"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Playing indicator */}
        {isPlaying && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-slate-900/70 rounded-full">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-300">Auto</span>
          </div>
        )}
      </div>

      {/* Image counter */}
      <div className="text-center mt-2 text-slate-500 text-sm">
        {currentImageIndex + 1} / {sortedImages.length} illustrations
      </div>

      {/* CSS for animations */}
      <style>{`
        .picture-book-display img {
          transition: opacity 0.5s ease-in-out, transform 0.3s ease-out;
        }

        .picture-book-display img:hover {
          transform: scale(1.01);
        }
      `}</style>
    </div>
  );
}

export default PictureBookImageDisplay;
