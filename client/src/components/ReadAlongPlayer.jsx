import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, BookOpen, Eye, EyeOff, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react';

/**
 * Read Along / Karaoke Player Component
 * Highlights words in sync with audio playback for an interactive reading experience
 * Now with optional book-like title and synopsis display
 */
function ReadAlongPlayer({
  segment,
  audioUrl,
  wordTimings,
  coverImageUrl,
  isPlaying,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  initialTime = 0,
  className = '',
  // New book-style props
  title = '',
  synopsis = '',
  sceneNumber = 0,
  totalScenes = 0
}) {
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const wordRefs = useRef(new Map());
  const animationFrameRef = useRef(null);

  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [showText, setShowText] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [overlayOnCover, setOverlayOnCover] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Parse words from timing data
  const words = useMemo(() => {
    if (!wordTimings?.words) return [];
    return Array.isArray(wordTimings.words) ? wordTimings.words : [];
  }, [wordTimings]);

  // Binary search for current word by time (efficient for large texts)
  const findWordAtTime = useCallback((timeMs) => {
    if (words.length === 0) return -1;

    let left = 0;
    let right = words.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const word = words[mid];

      if (timeMs >= word.start_ms && timeMs < word.end_ms) {
        return mid;
      } else if (timeMs < word.start_ms) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    // If not found exactly, find the closest previous word
    if (left > 0 && timeMs >= words[left - 1].end_ms) {
      return left - 1;
    }

    return -1;
  }, [words]);

  // Smooth word highlighting using requestAnimationFrame
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let lastWordIndex = -1;

    const updateHighlight = () => {
      if (audio.paused) return;

      const timeMs = audio.currentTime * 1000;
      const wordIndex = findWordAtTime(timeMs);

      if (wordIndex !== lastWordIndex) {
        lastWordIndex = wordIndex;
        setCurrentWordIndex(wordIndex);

        // Scroll word into view smoothly
        if (wordIndex >= 0) {
          const wordEl = wordRefs.current.get(wordIndex);
          if (wordEl && containerRef.current) {
            const container = containerRef.current;
            const wordRect = wordEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Only scroll if word is outside visible area
            if (wordRect.top < containerRect.top + 100 || wordRect.bottom > containerRect.bottom - 100) {
              wordEl.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
            }
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(updateHighlight);
    };

    const handlePlay = () => {
      animationFrameRef.current = requestAnimationFrame(updateHighlight);
      onPlay?.();
    };

    const handlePause = () => {
      cancelAnimationFrame(animationFrameRef.current);
      onPause?.();
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      if (initialTime > 0) {
        audio.currentTime = initialTime;
      }
    };

    const handleEnded = () => {
      cancelAnimationFrame(animationFrameRef.current);
      setCurrentWordIndex(-1);
      onEnded?.();
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [findWordAtTime, onPlay, onPause, onEnded, onTimeUpdate, initialTime]);

  // Control playback from external isPlaying prop
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying && audio.paused) {
      audio.play().catch(console.error);
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying]);

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

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().catch(console.error);
    } else {
      audio.pause();
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.muted = !audio.muted;
      setIsMuted(audio.muted);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * duration;
  };

  // Click on a word to seek to that position
  const handleWordClick = (wordIndex) => {
    const audio = audioRef.current;
    if (!audio || !words[wordIndex]) return;

    audio.currentTime = words[wordIndex].start_ms / 1000;
  };

  return (
    <div
      ref={containerRef}
      className={`
        read-along-container relative
        ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-900' : 'rounded-xl bg-slate-800/90'}
        ${overlayOnCover && coverImageUrl ? '' : ''}
        ${className}
      `}
    >
      {/* Background cover image (optional overlay mode) */}
      {overlayOnCover && coverImageUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${coverImageUrl})` }}
        >
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
        </div>
      )}

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
      />

      {/* Controls bar */}
      <div className="relative z-10 flex items-center justify-between p-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            className="p-3 rounded-full bg-golden-500 text-slate-900 hover:bg-golden-400 transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          {/* Time display */}
          <span className="text-slate-300 text-sm font-mono min-w-[80px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Mute toggle */}
          <button
            onClick={toggleMute}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Show/hide text */}
          <button
            onClick={() => setShowText(!showText)}
            className={`p-2 rounded-lg transition-colors ${
              showText ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-400'
            }`}
            title={showText ? 'Hide text' : 'Show text'}
          >
            {showText ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
          </button>

          {/* Overlay on cover */}
          {coverImageUrl && (
            <button
              onClick={() => setOverlayOnCover(!overlayOnCover)}
              className={`p-2 rounded-lg transition-colors ${
                overlayOnCover ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-400'
              }`}
              title="Overlay on cover art"
            >
              <BookOpen className="w-5 h-5" />
            </button>
          )}

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Book-style title and synopsis header */}
      {(title || synopsis) && (
        <div className="relative z-10 px-4 py-3 border-b border-slate-700/50 bg-slate-800/30">
          {title && (
            <h2 className={`font-serif text-golden-400 font-bold ${isFullscreen ? 'text-2xl' : 'text-lg'}`}>
              {title}
            </h2>
          )}
          {sceneNumber > 0 && (
            <p className="text-slate-500 text-xs mt-1">
              Scene {sceneNumber}{totalScenes > 0 ? ` of ${totalScenes}` : ''}
            </p>
          )}
          {synopsis && (
            <p className={`text-slate-400 mt-2 leading-relaxed ${isFullscreen ? 'text-base' : 'text-sm'}`}>
              {synopsis}
            </p>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div
        className="relative z-10 h-1 bg-slate-700 cursor-pointer"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-golden-500 transition-all duration-100"
          style={{ width: `${(currentTime / duration) * 100}%` }}
        />
      </div>

      {/* Text display with word highlighting */}
      {showText && words.length > 0 && (
        <div
          className={`
            relative z-10 p-6 overflow-y-auto
            ${isFullscreen ? 'h-[calc(100%-80px)]' : 'max-h-[60vh]'}
          `}
        >
          <div
            className={`
              read-along-text
              text-xl md:text-2xl lg:text-3xl
              leading-relaxed md:leading-loose
              ${isFullscreen ? 'max-w-4xl mx-auto text-center' : ''}
            `}
          >
            {words.map((word, idx) => (
              <span
                key={idx}
                ref={el => wordRefs.current.set(idx, el)}
                onClick={() => handleWordClick(idx)}
                className={`
                  inline-block px-1 py-0.5 mx-0.5 rounded cursor-pointer
                  transition-all duration-150 ease-out
                  ${idx === currentWordIndex
                    ? 'bg-golden-400 text-slate-900 scale-110 font-semibold shadow-lg shadow-golden-400/40'
                    : idx < currentWordIndex
                      ? 'text-slate-500'
                      : 'text-slate-200 hover:bg-slate-700'
                  }
                `}
              >
                {word.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: Show cover when text is hidden */}
      {!showText && coverImageUrl && (
        <div className={`relative z-10 flex items-center justify-center p-8 ${isFullscreen ? 'h-[calc(100%-80px)]' : 'min-h-[300px]'}`}>
          <img
            src={coverImageUrl}
            alt="Story cover"
            className="max-h-full max-w-full object-contain rounded-xl shadow-2xl"
          />
        </div>
      )}

      {/* No word timings message */}
      {showText && words.length === 0 && segment?.scene_text && (
        <div className="relative z-10 p-6">
          <p className="text-slate-200 text-lg leading-relaxed">
            {segment.scene_text}
          </p>
          <p className="text-slate-500 text-sm mt-4">
            Word-by-word highlighting not available for this segment.
          </p>
        </div>
      )}

      {/* Reading mode label */}
      <div className="absolute bottom-4 left-4 z-10">
        <span className="text-slate-500 text-xs bg-slate-800/80 px-2 py-1 rounded">
          Read Along Mode
        </span>
      </div>
    </div>
  );
}

export default ReadAlongPlayer;
