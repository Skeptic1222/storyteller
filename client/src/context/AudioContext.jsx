import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { queueLog, audioLog } from '../utils/clientLogger';

const AudioContextReact = createContext(null);

export function AudioProvider({ children }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pendingAudio, setPendingAudio] = useState(null);
  const [volume, setVolumeState] = useState(() => {
    // Load saved volume from localStorage, default to max (1.0)
    const saved = localStorage.getItem('storyteller_volume');
    return saved ? parseFloat(saved) : 1.0;
  });

  const audioRef = useRef(null);
  const audioQueue = useRef([]);
  const webAudioCtxRef = useRef(null);
  const blobUrlsRef = useRef(new Set()); // Track all blob URLs for cleanup
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
        setIsPlaying(false);
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

          // Play any pending audio
          if (pendingAudio) {
            console.log('[Audio] Playing pending audio after unlock');
            const { audioData, format, resolve, reject } = pendingAudio;
            setPendingAudio(null);
            playAudioInternal(audioData, format).then(resolve).catch(reject);
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

      // Clean up old URL
      if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioRef.current.src);
        blobUrlsRef.current.delete(audioRef.current.src);
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
      await audioRef.current.play();
      console.log('[Audio] Playback started successfully!');

      setIsPlaying(true);
      setIsPaused(false);
    } catch (error) {
      console.error('[Audio] playAudioInternal error:', error);
      throw error;
    }
  }, []);

  // Public play function - handles iOS unlock
  const playAudio = useCallback((audioData, format = 'mp3') => {
    return new Promise((resolve, reject) => {
      console.log('[Audio] playAudio called, isUnlocked:', isUnlocked, 'isIOS:', isIOS.current);

      if (!isUnlocked && isIOS.current) {
        // On iOS, if not unlocked, queue the audio and wait for user interaction
        console.log('[Audio] iOS not unlocked - queuing audio and waiting for tap');
        setPendingAudio({ audioData, format, resolve, reject });
        return;
      }

      // Audio is unlocked or not iOS - play directly
      playAudioInternal(audioData, format).then(resolve).catch(reject);
    });
  }, [isUnlocked, playAudioInternal]);

  const playUrl = useCallback((url) => {
    return new Promise((resolve, reject) => {
      console.log('[Audio] playUrl called:', url);

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
  }, []);

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
      audioRef.current.play()
        .then(() => {
          setIsPaused(false);
          setIsPlaying(true);
        })
        .catch(err => audioLog.error(`RESUME_FAILED | error: ${err.message}`));
    }
  }, [isPaused]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      const clearedCount = audioQueue.current.length;
      audioLog.info(`STOP | clearing queue: ${clearedCount} items | currentTime: ${audioRef.current.currentTime?.toFixed(2)}`);
      queueLog.info(`CLEAR | cleared: ${clearedCount} items`);
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setIsPaused(false);
      audioQueue.current = [];
      setPendingAudio(null);
    }
  }, []);

  // Volume control function
  const setVolume = useCallback((newVolume) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    localStorage.setItem('storyteller_volume', clampedVolume.toString());
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

  const queueAudio = useCallback((audioData, format = 'mp3', onStart = null) => {
    const queueItem = { audioData, format, onStart, queuedAt: Date.now() };
    audioQueue.current.push(queueItem);
    queueLog.info(`ENQUEUE | format: ${format} | hasOnStart: ${!!onStart} | queueLength: ${audioQueue.current.length} | dataLength: ${audioData?.length || 0}`);
    if (!isPlaying && !isPaused) {
      queueLog.info('IMMEDIATE_PLAY | not playing/paused, starting queue');
      playNext();
    } else {
      queueLog.info(`QUEUED | isPlaying: ${isPlaying} | isPaused: ${isPaused}`);
    }
  }, [isPlaying, isPaused]);

  const playNext = useCallback(() => {
    if (audioQueue.current.length > 0) {
      const next = audioQueue.current.shift();
      const waitTime = next.queuedAt ? Date.now() - next.queuedAt : 0;
      queueLog.info(`DEQUEUE | format: ${next.format} | remaining: ${audioQueue.current.length} | hasOnStart: ${!!next.onStart} | waitedMs: ${waitTime}`);
      // FIXED: Call onStart AFTER playAudio resolves (when audio actually starts)
      // This prevents SFX from triggering during intro audio
      playAudio(next.audioData, next.format)
        .then(() => {
          // Call onStart callback AFTER audio starts playing
          if (next.onStart) {
            queueLog.info('CALLBACK | onStart fired after playback started');
            next.onStart();
          }
        })
        .catch(err => {
          queueLog.error(`PLAYBACK_ERROR | error: ${err.message}`);
        });
    } else {
      queueLog.info('EMPTY | no more items to play');
    }
  }, [playAudio]);

  const value = useMemo(() => ({
    isPlaying,
    isPaused,
    currentTime,
    duration,
    isUnlocked,
    hasPendingAudio: !!pendingAudio,
    volume,
    setVolume,
    playAudio,
    playUrl,
    pause,
    resume,
    stop,
    queueAudio
  }), [isPlaying, isPaused, currentTime, duration, isUnlocked, pendingAudio, volume, setVolume, playAudio, playUrl, pause, resume, stop, queueAudio]);

  return (
    <AudioContextReact.Provider value={value}>
      {children}
      {/* Show tap-to-play overlay on iOS when audio is pending */}
      {pendingAudio && isIOS.current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/90 backdrop-blur"
          onClick={() => {
            // The unlock handler will pick this up
            console.log('[Audio] User tapped overlay');
          }}
        >
          <div className="text-center p-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-golden-400/20 flex items-center justify-center animate-pulse">
              <svg className="w-10 h-10 text-golden-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <p className="text-golden-400 text-xl font-medium mb-2">Tap to Play</p>
            <p className="text-night-400 text-sm">Your story is ready!</p>
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
