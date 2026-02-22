import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { queueLog, audioLog } from '../utils/clientLogger';
import { scopedGetItem, scopedSetItem } from '../utils/userScopedStorage';

const AudioContextReact = createContext(null);

// PERFORMANCE: Limit queue size to prevent memory bloat during long sessions
const MAX_QUEUE_SIZE = 10;
// MEMORY: Maximum blob URLs to track before forced cleanup
const MAX_BLOB_URLS = 50;

const VOLUME_STORAGE_KEY = 'narrimo_volume';
const LEGACY_VOLUME_STORAGE_KEY = 'storyteller_volume';

export function AudioProvider({ children }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStartingPlayback, setIsStartingPlayback] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pendingAudio, setPendingAudio] = useState([]);
  const [volume, setVolumeState] = useState(() => {
    // Load saved volume from user-scoped localStorage, default to max (1.0)
    const saved = scopedGetItem(VOLUME_STORAGE_KEY);
    if (saved) return parseFloat(saved);

    const legacySaved = localStorage.getItem(LEGACY_VOLUME_STORAGE_KEY);
    if (legacySaved) {
      scopedSetItem(VOLUME_STORAGE_KEY, legacySaved);
      localStorage.removeItem(LEGACY_VOLUME_STORAGE_KEY);
      return parseFloat(legacySaved);
    }

    return 1.0;
  });

  const audioRef = useRef(null);
  const audioQueue = useRef([]);
  const currentItemRef = useRef(null); // Track current playing item for onEnd callback
  const webAudioCtxRef = useRef(null);
  const blobUrlsRef = useRef(new Set()); // Track all blob URLs for cleanup
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const isIOS = useRef(
    typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
  );

  // Initialize audio element and Web Audio API context
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      // iOS needs these attributes
      audioRef.current.setAttribute('playsinline', '');
      audioRef.current.setAttribute('webkit-playsinline', '');

      audioRef.current.addEventListener('ended', () => {
        audioLog.info(`STATE: PLAYING → ENDED | duration: ${audioRef.current?.duration?.toFixed(2)}s | queueRemaining: ${audioQueue.current.length}`);
        // Save onEnd callback BEFORE clearing ref (prevents race condition)
        const onEndCallback = currentItemRef.current?.onEnd;
        currentItemRef.current = null;
        setIsPlaying(false);

        // Call onEnd callback for the item that just finished
        if (onEndCallback) {
          queueLog.info('CALLBACK | onEnd fired after playback ended');
          try {
            onEndCallback();
          } catch (err) {
            // FAIL LOUDLY - don't silently swallow errors
            console.error('[AudioContext] ERROR in onEnd callback:', err);
            audioLog.error(`CALLBACK_ERROR | onEnd failed: ${err.message}`);
          }
        }
        playNext();
      });
      audioRef.current.addEventListener('timeupdate', () => {
        const time = audioRef.current.currentTime;
        setCurrentTime(time);
        // Skip verbose timeupdate logging - too much noise
      });
      audioRef.current.addEventListener('loadedmetadata', () => {
        setDuration(audioRef.current.duration);
      });
      audioRef.current.addEventListener('error', (e) => {
        // Ignore errors when src is empty (happens during unlock cleanup)
        if (!audioRef.current.src || audioRef.current.src === '' || audioRef.current.src === window.location.href) {
          return;
        }
        audioLog.error(`PLAYBACK_ERROR | src: ${audioRef.current.src?.substring(0, 50)}`);
        setIsPlaying(false);
      });
      audioRef.current.addEventListener('canplaythrough', () => {
        audioLog.info('CAN_PLAY_THROUGH | audio ready');
      });
    }

    // Create Web Audio API context for iOS
    if (!webAudioCtxRef.current) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        webAudioCtxRef.current = new AudioCtx();
        audioLog.info(`WEB_AUDIO_CONTEXT | state: ${webAudioCtxRef.current.state}`);
      } catch (err) {
        audioLog.warn(`WEB_AUDIO_UNAVAILABLE | error: ${err.message}`);
      }
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      // Revoke all tracked blob URLs to prevent memory leaks
      blobUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          // Ignore - URL may already be revoked
        }
      });
      blobUrlsRef.current.clear();
    };
  }, []);

  // Sync refs with state to avoid stale closures
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // Unlock audio on ANY user interaction (critical for iOS)
  useEffect(() => {
    const unlockAudio = async () => {
      if (isUnlocked) return;

      let webAudioUnlocked = false;
      let html5Unlocked = false;

      try {
        // Resume Web Audio Context if suspended
        if (webAudioCtxRef.current && webAudioCtxRef.current.state === 'suspended') {
          await webAudioCtxRef.current.resume();
          webAudioUnlocked = true;
        } else if (webAudioCtxRef.current && webAudioCtxRef.current.state === 'running') {
          webAudioUnlocked = true;
        }

        // Play and immediately pause a silent sound to unlock HTML5 Audio
        if (audioRef.current) {
          // Temporarily add error handler to avoid console spam during unlock
          const tempErrorHandler = () => {};
          audioRef.current.addEventListener('error', tempErrorHandler);

          try {
            // Create a tiny silent WAV (more compatible than MP3)
            const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

            audioRef.current.src = silentWav;
            audioRef.current.volume = 0.01;

            await audioRef.current.play();
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current.volume = volume;
            audioRef.current.src = '';

            html5Unlocked = true;
          } catch (html5Err) {
            // HTML5 audio unlock failed, but we can still use Web Audio API
            console.log('[Audio] HTML5 unlock skipped (Web Audio available)');
          } finally {
            // Always remove the temp error handler
            audioRef.current.removeEventListener('error', tempErrorHandler);
          }
        }

        // Consider unlocked if either method worked
        if (webAudioUnlocked || html5Unlocked) {
          setIsUnlocked(true);
          console.log('[Audio] Audio unlocked (Web Audio:', webAudioUnlocked, ', HTML5:', html5Unlocked, ')');

          // Play any pending audio (supports both blob data and URLs)
          if (pendingAudio.length > 0) {
            console.log('[Audio] Playing pending audio after unlock');
            const queued = [...pendingAudio];
            setPendingAudio([]);

            // Resolve only the most recent pending request; reject older superseded ones.
            const latest = queued[queued.length - 1];
            queued.slice(0, -1).forEach(item => {
              item.reject?.(new Error('Playback request superseded before audio unlock'));
            });

            const { audioData, format, url, isUrl, resolve, reject } = latest;

            if (isUrl && url) {
              // URL-based playback
              if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
                URL.revokeObjectURL(audioRef.current.src);
                blobUrlsRef.current.delete(audioRef.current.src);
              }
              audioRef.current.src = url;
              audioRef.current.play()
                .then(() => {
                  setIsPlaying(true);
                  setIsPaused(false);
                  resolve();
                })
                .catch(reject);
            } else {
              // Blob data playback
              playAudioInternal(audioData, format).then(resolve).catch(reject);
            }
          }
        }

      } catch (err) {
        // Silently retry on next interaction - don't spam console
      }
    };

    // Listen for ANY user interaction to unlock
    const events = ['touchstart', 'touchend', 'click', 'mousedown', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, unlockAudio, { once: false, passive: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, unlockAudio);
      });
    };
  }, [isUnlocked, pendingAudio]);

  // Internal play function (assumes audio is unlocked)
  const playAudioInternal = useCallback(async (audioData, format = 'mp3') => {
    try {
      console.log('[Audio] Playing audio internally, format:', format, 'data length:', audioData?.length);

      // MEMORY: Force cleanup if too many blob URLs accumulated
      if (blobUrlsRef.current.size >= MAX_BLOB_URLS) {
        console.warn(`[AudioContext] Blob URL limit reached (${MAX_BLOB_URLS}), forcing cleanup`);
        const currentSrc = audioRef.current?.src;
        blobUrlsRef.current.forEach(url => {
          // Don't revoke the currently playing URL
          if (url !== currentSrc) {
            try {
              URL.revokeObjectURL(url);
            } catch (e) { /* ignore */ }
          }
        });
        // Keep only the current src if it's a blob
        blobUrlsRef.current.clear();
        if (currentSrc && currentSrc.startsWith('blob:')) {
          blobUrlsRef.current.add(currentSrc);
        }
      }

      // Convert base64 to blob
      const byteCharacters = atob(audioData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: `audio/${format}` });
      const url = URL.createObjectURL(blob);
      blobUrlsRef.current.add(url); // Track for cleanup

      console.log('[Audio] Created blob URL:', url);

      // Clean up old URL immediately (don't wait for ended event)
      if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
        const oldUrl = audioRef.current.src;
        URL.revokeObjectURL(oldUrl);
        blobUrlsRef.current.delete(oldUrl);
      }

      audioRef.current.src = url;

      // Wait for the audio to be ready
      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          audioRef.current.removeEventListener('canplaythrough', onCanPlay);
          audioRef.current.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e) => {
          audioRef.current.removeEventListener('canplaythrough', onCanPlay);
          audioRef.current.removeEventListener('error', onError);
          reject(new Error('Audio load failed: ' + e.message));
        };
        audioRef.current.addEventListener('canplaythrough', onCanPlay);
        audioRef.current.addEventListener('error', onError);
        audioRef.current.load();
      });

      console.log('[Audio] Audio loaded, attempting play...');
      setIsStartingPlayback(true);
      await audioRef.current.play();
      console.log('[Audio] Playback started successfully!');

      setIsPlaying(true);
      setIsPaused(false);
      setIsStartingPlayback(false);
    } catch (error) {
      console.error('[Audio] playAudioInternal error:', error);
      setIsStartingPlayback(false);
      throw error;
    }
  }, []);

  // Public play function - handles audio unlock for ALL browsers (not just iOS)
  const playAudio = useCallback((audioData, format = 'mp3') => {
    return new Promise((resolve, reject) => {
      console.log('[Audio] playAudio called, isUnlocked:', isUnlocked, 'isIOS:', isIOS.current);

      if (!isUnlocked) {
        // Modern browsers require user interaction before audio playback
        // Queue the audio and wait for user interaction (applies to all browsers)
        console.log('[Audio] Audio not unlocked - queuing audio and waiting for user interaction');
        setPendingAudio(prev => [...prev.slice(-4), { audioData, format, resolve, reject }]);
        return;
      }

      // Audio is unlocked - play directly
      playAudioInternal(audioData, format).then(resolve).catch(reject);
    });
  }, [isUnlocked, playAudioInternal]);

  const playUrl = useCallback((url) => {
    return new Promise((resolve, reject) => {
      console.log('[Audio] playUrl called:', url, 'isUnlocked:', isUnlocked);

      if (!isUnlocked) {
        // Modern browsers require user interaction - store URL and wait
        console.log('[Audio] Audio not unlocked - storing URL and waiting for user interaction');
        setPendingAudio(prev => [...prev.slice(-4), { url, isUrl: true, resolve, reject }]);
        return;
      }

      if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioRef.current.src);
        blobUrlsRef.current.delete(audioRef.current.src);
      }

      audioRef.current.src = url;
      audioRef.current.play()
        .then(() => {
          console.log('[Audio] URL playback started');
          setIsPlaying(true);
          setIsPaused(false);
          resolve();
        })
        .catch((err) => {
          console.error('[Audio] URL playback failed:', err);
          reject(err);
        });
    });
  }, [isUnlocked]);

  const pause = useCallback(() => {
    if (audioRef.current && isPlaying) {
      console.log('[Audio] Pausing');
      audioRef.current.pause();
      setIsPaused(true);
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const resume = useCallback(() => {
    if (audioRef.current && isPaused) {
      console.log('[Audio] Resuming');
      setIsStartingPlayback(true);
      audioRef.current.play()
        .then(() => {
          setIsPaused(false);
          setIsPlaying(true);
          setIsStartingPlayback(false);
        })
        .catch(err => {
          setIsStartingPlayback(false);
          audioLog.error(`RESUME_FAILED | error: ${err.message}`);
        });
    }
  }, [isPaused]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      const clearedCount = audioQueue.current.length;
      audioLog.info(`STOP | clearing queue: ${clearedCount} items | currentTime: ${audioRef.current.currentTime?.toFixed(2)}`);
      queueLog.info(`CLEAR | cleared: ${clearedCount} items`);

      // Call onEnd for currently playing item (critical for state cleanup like introAudioQueued)
      if (currentItemRef.current?.onEnd) {
        queueLog.info('CALLBACK | onEnd fired during stop()');
        try {
          currentItemRef.current.onEnd();
        } catch (err) {
          console.error('[AudioContext] ERROR in onEnd callback during stop:', err);
        }
      }
      currentItemRef.current = null;

      // Also call onEnd for all queued items that won't get to play
      audioQueue.current.forEach((item, idx) => {
        if (item.onEnd) {
          queueLog.info(`CALLBACK | onEnd fired for queued item ${idx} during stop()`);
          try {
            item.onEnd();
          } catch (err) {
            console.error('[AudioContext] ERROR in queued onEnd callback during stop:', err);
          }
        }
      });

      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setIsPaused(false);
      audioQueue.current = [];
      setPendingAudio([]);
    }
  }, []);

  // Volume control function
  const setVolume = useCallback((newVolume) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    scopedSetItem(VOLUME_STORAGE_KEY, clampedVolume.toString());
    localStorage.removeItem(LEGACY_VOLUME_STORAGE_KEY);
    if (audioRef.current) {
      audioRef.current.volume = clampedVolume;
    }
    // Skip volume logging - too verbose
  }, []);

  // Apply volume to audio element whenever it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Seek to a specific time in the current audio
  const seekTo = useCallback((time) => {
    if (audioRef.current && duration > 0) {
      const clampedTime = Math.max(0, Math.min(time, duration));
      audioRef.current.currentTime = clampedTime;
      setCurrentTime(clampedTime);
      audioLog.info(`SEEK | to: ${clampedTime.toFixed(2)}s | duration: ${duration.toFixed(2)}s`);
    }
  }, [duration]);

  const queueAudio = useCallback((audioData, format = 'mp3', onStart = null, onEnd = null) => {
    // FAIL LOUDLY: Validate callback parameters to catch accidental parameter swapping
    if (onStart !== null && typeof onStart !== 'function') {
      console.error('[AudioContext] ERROR: onStart must be a function, got:', typeof onStart);
      onStart = null;
    }
    if (onEnd !== null && typeof onEnd !== 'function') {
      console.error('[AudioContext] ERROR: onEnd must be a function, got:', typeof onEnd);
      onEnd = null;
    }

    // MEMORY: Prevent unbounded queue growth during long sessions
    if (audioQueue.current.length >= MAX_QUEUE_SIZE) {
      console.warn(`[AudioContext] Queue full (${MAX_QUEUE_SIZE}), dropping oldest item`);
      const dropped = audioQueue.current.shift();
      // Call onEnd for dropped item to prevent state leaks
      if (dropped?.onEnd) {
        try {
          dropped.onEnd();
        } catch (err) {
          console.error('[AudioContext] ERROR in dropped item onEnd:', err);
        }
      }
    }

    const queueItem = { audioData, format, onStart, onEnd, queuedAt: Date.now() };
    audioQueue.current.push(queueItem);
    queueLog.info(`ENQUEUE | format: ${format} | hasOnStart: ${!!onStart} | hasOnEnd: ${!!onEnd} | queueLength: ${audioQueue.current.length} | dataLength: ${audioData?.length || 0}`);
    if (!isPlayingRef.current && !isPausedRef.current) {
      queueLog.info('IMMEDIATE_PLAY | not playing/paused, starting queue');
      playNext();
    } else {
      queueLog.info(`QUEUED | isPlaying: ${isPlayingRef.current} | isPaused: ${isPausedRef.current}`);
    }
  }, []);

  const playNext = useCallback(() => {
    if (audioQueue.current.length > 0) {
      const next = audioQueue.current.shift();
      currentItemRef.current = next; // Track for onEnd callback
      const waitTime = next.queuedAt ? Date.now() - next.queuedAt : 0;
      queueLog.info(`DEQUEUE | format: ${next.format} | remaining: ${audioQueue.current.length} | hasOnStart: ${!!next.onStart} | hasOnEnd: ${!!next.onEnd} | waitedMs: ${waitTime}`);
      // FIXED: Call onStart AFTER playAudio resolves (when audio actually starts)
      // This prevents SFX from triggering during intro audio
      playAudio(next.audioData, next.format)
        .then(() => {
          // Call onStart callback AFTER audio starts playing
          if (next.onStart) {
            queueLog.info('CALLBACK | onStart fired after playback started');
            try {
              next.onStart();
            } catch (err) {
              // FAIL LOUDLY - don't silently swallow errors
              console.error('[AudioContext] ERROR in onStart callback:', err);
              queueLog.error(`CALLBACK_ERROR | onStart failed: ${err.message}`);
            }
          }
        })
        .catch(err => {
          // FAIL LOUDLY - don't silently continue
          console.error('[AudioContext] PLAYBACK_ERROR:', err);
          queueLog.error(`PLAYBACK_ERROR | error: ${err.message}`);
          currentItemRef.current = null;
        });
    } else {
      queueLog.info('EMPTY | no more items to play');
    }
  }, [playAudio]);

  const value = useMemo(() => ({
    isPlaying,
    isPaused,
    isStartingPlayback,
    currentTime,
    duration,
    isUnlocked,
    hasPendingAudio: pendingAudio.length > 0,
    volume,
    setVolume,
    seekTo,
    playAudio,
    playUrl,
    pause,
    resume,
    stop,
    queueAudio
  }), [isPlaying, isPaused, isStartingPlayback, currentTime, duration, isUnlocked, pendingAudio, volume, setVolume, seekTo, playAudio, playUrl, pause, resume, stop, queueAudio]);

  return (
    <AudioContextReact.Provider value={value}>
      {children}
      {/* Show click/tap-to-play overlay on ALL browsers when audio is pending and not unlocked */}
      {pendingAudio.length > 0 && !isUnlocked && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur"
          onClick={() => {
            // The unlock handler will pick this up
            console.log('[Audio] User clicked overlay to unlock audio');
          }}
        >
          <div className="text-center p-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-golden-400/20 flex items-center justify-center animate-pulse">
              <svg className="w-10 h-10 text-golden-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <p className="text-golden-400 text-xl font-medium mb-2">
              {isIOS.current ? 'Tap to Play' : 'Click to Play'}
            </p>
            <p className="text-slate-400 text-sm">Your story is ready!</p>
          </div>
        </div>
      )}
    </AudioContextReact.Provider>
  );
}

export function useAudio() {
  const context = useContext(AudioContextReact);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
}
