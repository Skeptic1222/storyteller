/**
 * useSfxManager Hook
 * Manages sound effects playback for story narration.
 *
 * Features:
 * - Play/stop SFX with fade in/out
 * - Scheduled SFX based on trigger_at_seconds
 * - Generation ID tracking to prevent stale playback
 * - Abort controller for cancelling in-flight fetches
 * - Blob URL cleanup to prevent memory leaks
 * - Looping SFX auto-stop when audio ends
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useStateRef } from './useStateRef';
import { API_BASE } from '../config';
import { getStoredToken } from '../utils/authToken';
import { sfxLog } from '../utils/clientLogger';

/**
 * Convert timing string to numeric seconds
 * Uses reasonable defaults since audio duration may not be available at trigger time
 *
 * P0 FIX: Synced with server timing values from orchestrator.js:1700-1768
 * This ensures SFX triggers at the exact moment intended by the server
 *
 * @param {string} timing - Timing string like 'beginning', 'middle', 'end'
 * @param {number} audioDuration - Optional actual audio duration in seconds
 * @returns {number} Trigger time in seconds
 */
function convertTimingToSeconds(timing, audioDuration = 40) {
  if (!timing || typeof timing !== 'string') return 0;

  const t = timing.toLowerCase().trim();

  // Map string timings to numeric seconds
  // P0 FIX: SYNCED WITH SERVER VALUES (orchestrator.js timing percentages)
  const timingMap = {
    'beginning': 0,
    'start': 0,
    'early': Math.max(2, audioDuration * 0.15),      // 15% - same as server
    'middle': Math.max(15, audioDuration * 0.50),    // 50% - same as server
    'late': Math.max(25, audioDuration * 0.70),      // P0 FIX: 70% (was 75%)
    'end': Math.max(30, audioDuration * 0.85),       // P0 FIX: 85% (was 90%)
    'continuous': -1,                                 // Special value for looping
    'ambient': Math.max(10, audioDuration * 0.30),   // P0 FIX: 30% (was 50%) - CRITICAL FIX
    'on_action': Math.max(5, audioDuration * 0.30),  // 30% - same as server
    'climax': Math.max(25, audioDuration * 0.90)     // P0 FIX: Added climax timing (90%)
  };

  return timingMap[t] !== undefined ? timingMap[t] : 0;
}

/**
 * P0 FIX: TTL (Time To Live) constants for SFX playback
 * These ensure sounds never play forever, even if cleanup fails
 */
const SFX_TTL = {
  oneShot: 60000,       // 1 minute max for one-shot sounds
  loop: 120000,         // 2 minutes max for looping sounds
  ambient: 180000,      // 3 minutes max for ambient sounds
  absolute: 300000      // 5 minutes absolute maximum (emergency cutoff)
};

const MAX_TTL_TIMERS = 50; // Max concurrent TTL timers

/**
 * @param {object} options
 * @param {boolean} options.initialEnabled - Initial SFX enabled state (default: true)
 * @param {boolean} options.isPlaying - Whether main audio is playing (for auto-stop)
 * @param {boolean} options.storyEnded - Whether the story has ended
 * @returns {object} SFX manager interface
 */
export function useSfxManager({ initialEnabled = true, isPlaying = null, storyEnded = false } = {}) {
  // State - using useStateRef to combine state+ref (avoids stale closure issues)
  const [sfxEnabled, setSfxEnabled, sfxEnabledRef] = useStateRef(initialEnabled);
  const [activeSfx, setActiveSfx] = useState([]);

  // Refs for tracking audio elements and cleanup
  const sfxAudioRefs = useRef(new Map());
  const sfxBlobUrls = useRef(new Set());
  const sfxAbortController = useRef(null);
  const sfxGenerationId = useRef(0);
  const scheduledTimersRef = useRef([]); // Track scheduled SFX timers for cleanup
  const fadeIntervalsRef = useRef(new Set()); // MEMORY LEAK FIX: Track fade intervals for cleanup
  const wasPlayingRef = useRef(false); // Track previous isPlaying state
  const ttlTimersRef = useRef(new Map()); // P0 FIX: TTL timers to auto-stop sounds
  const getAuthHeaders = useCallback(() => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  /**
   * Stop all currently playing SFX and cleanup resources
   */
  const stopAllSfx = useCallback(() => {
    // Abort any in-flight SFX fetches
    if (sfxAbortController.current) {
      sfxAbortController.current.abort();
      sfxAbortController.current = null;
    }

    // Increment generation ID to invalidate any pending SFX operations
    sfxGenerationId.current += 1;

    // Clear all scheduled timers
    if (scheduledTimersRef.current.length > 0) {
      sfxLog.info(`CLEAR_TIMERS | clearing ${scheduledTimersRef.current.length} scheduled timers`);
      scheduledTimersRef.current.forEach(timer => {
        try { clearTimeout(timer); } catch (e) { /* ignore */ }
      });
      scheduledTimersRef.current = [];
    }

    // P0 FIX: Clear all TTL timers
    if (ttlTimersRef.current.size > 0) {
      sfxLog.info(`CLEAR_TTL | clearing ${ttlTimersRef.current.size} TTL timers`);
      ttlTimersRef.current.forEach((timer, key) => {
        try { clearTimeout(timer); } catch (e) { /* ignore */ }
      });
      ttlTimersRef.current.clear();
    }

    // Stop and cleanup all playing audio
    sfxAudioRefs.current.forEach((audio, key) => {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
        audio.load(); // Force release of audio resources
      } catch (e) {
        console.warn('[SFX] Error stopping:', key, e);
      }
    });
    sfxAudioRefs.current.clear();

    // Revoke all blob URLs to prevent memory leaks
    sfxBlobUrls.current.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    });
    sfxBlobUrls.current.clear();
    setActiveSfx([]);
    sfxLog.info('STOP_ALL | all SFX stopped and cleaned up');
  }, []);

  /**
   * P0 FIX: Fade out and stop a specific SFX by key
   * Used by TTL enforcement to gracefully stop sounds
   */
  const fadeOutAndStop = useCallback((sfxKey) => {
    const audio = sfxAudioRefs.current.get(sfxKey);
    if (!audio) return;

    sfxLog.info(`FADE_OUT | key: ${sfxKey} | reason: TTL expired`);

    // Fade out over 1 second
    const fadeOutDuration = 1000;
    const fadeSteps = 20;
    const stepDuration = fadeOutDuration / fadeSteps;
    const startVolume = audio.volume;
    const volumeStep = startVolume / fadeSteps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      if (currentStep >= fadeSteps) {
        // Fade complete, stop audio
        clearInterval(fadeInterval);
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.src = '';
        } catch (e) { /* ignore */ }

        // Cleanup refs
        sfxAudioRefs.current.delete(sfxKey);
        ttlTimersRef.current.delete(sfxKey);

        // Update active SFX list
        setActiveSfx(prev => prev.filter(s => s.key !== sfxKey));

        sfxLog.info(`STOPPED | key: ${sfxKey} | reason: TTL_FADE_COMPLETE`);
      } else {
        audio.volume = Math.max(0, startVolume - (volumeStep * currentStep));
      }
    }, stepDuration);
  }, []);

  /**
   * Play a single SFX
   * @private
   */
  const playIndividualSfx = useCallback(async (sfx, abortController, currentGenerationId) => {
    // Check if this operation has been superseded
    if (abortController.signal.aborted || sfxGenerationId.current !== currentGenerationId) {
      sfxLog.info('ABORTED | reason: scene_changed');
      return null;
    }

    try {
      const sfxKey = sfx.sfx_key || sfx.sfxKey || sfx.key;
      if (!sfxKey) {
        sfxLog.warn('MISSING_KEY | sfx object has no sfx_key');
        return null;
      }

      const sfxVolume = sfx.volume || 0.3;
      const isLooping = sfx.is_looping ?? sfx.definition?.loop ?? sfx.loop ?? false;

      sfxLog.info(`FETCH_START | key: ${sfxKey} | volume: ${sfxVolume} | loop: ${isLooping}`);
      const response = await fetch(`${API_BASE}/sfx/ambient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ sfx_key: sfxKey }),
        signal: abortController.signal
      });

      // Check again after fetch completes
      if (sfxGenerationId.current !== currentGenerationId) {
        sfxLog.info('DISCARD_STALE | reason: generation_id_mismatch');
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        sfxLog.error(`FETCH_FAILED | key: ${sfxKey} | status: ${response.status} | error: ${errorText}`);
        return null;
      }

      const audioBlob = await response.blob();
      sfxLog.info(`FETCH_SUCCESS | key: ${sfxKey} | bytes: ${audioBlob.size}`);

      // Final check before creating audio element
      if (sfxGenerationId.current !== currentGenerationId) {
        sfxLog.info('DISCARD_STALE | reason: generation_id_mismatch_post_blob');
        return null;
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      sfxBlobUrls.current.add(audioUrl);

      const audio = new Audio(audioUrl);
      audio.volume = 0;
      audio.loop = isLooping;
      const targetVolume = Math.min(Math.max(sfxVolume, 0), 1);

      // Use a promise to ensure audio loads
      await new Promise((resolve) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);

          // Check one more time before playing
          if (sfxGenerationId.current !== currentGenerationId) {
            sfxLog.info('ABORT_PLAYBACK | reason: scene_changed_pre_play');
            URL.revokeObjectURL(audioUrl);
            sfxBlobUrls.current.delete(audioUrl);
            resolve();
            return;
          }

          audio.play().then(() => {
            sfxLog.info(`PLAYING | key: ${sfxKey} | loop: ${isLooping}`);
            // Fade in - MEMORY LEAK FIX: Track interval for cleanup
            let currentVol = 0;
            const fadeInterval = setInterval(() => {
              // Stop fade if generation changed
              if (sfxGenerationId.current !== currentGenerationId) {
                clearInterval(fadeInterval);
                fadeIntervalsRef.current.delete(fadeInterval);
                return;
              }
              currentVol += targetVolume / 20;
              if (currentVol >= targetVolume) {
                audio.volume = targetVolume;
                clearInterval(fadeInterval);
                fadeIntervalsRef.current.delete(fadeInterval);
              } else {
                audio.volume = currentVol;
              }
            }, 100);
            // Track this interval for cleanup on unmount
            fadeIntervalsRef.current.add(fadeInterval);
            resolve();
          }).catch(err => {
            sfxLog.warn(`PLAYBACK_FAILED | key: ${sfxKey} | error: ${err.message}`);
            resolve();
          });
        };
        const onError = (e) => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
          sfxLog.error(`LOAD_ERROR | key: ${sfxKey} | error: ${e.type || 'unknown'}`);
          resolve();
        };
        audio.addEventListener('canplaythrough', onCanPlay, { once: true });
        audio.addEventListener('error', onError, { once: true });
        audio.load();

        // Timeout fallback
        setTimeout(() => resolve(), 5000);
      });

      // Only track if still valid generation
      if (sfxGenerationId.current === currentGenerationId) {
        sfxAudioRefs.current.set(sfxKey, audio);

        // P0 FIX: Set TTL timer to auto-stop this sound
        // Determine TTL based on sound type
        const ttl = isLooping
          ? Math.min(SFX_TTL.loop, SFX_TTL.absolute)
          : Math.min(SFX_TTL.oneShot, SFX_TTL.absolute);

        const ttlTimer = setTimeout(() => {
          sfxLog.info(`TTL_EXPIRED | key: ${sfxKey} | ttl: ${ttl}ms | isLooping: ${isLooping}`);
          fadeOutAndStop(sfxKey);
        }, ttl);

        ttlTimersRef.current.set(sfxKey, ttlTimer);
        sfxLog.info(`TTL_SET | key: ${sfxKey} | ttl: ${ttl}ms | isLooping: ${isLooping}`);

        // Prevent unbounded TTL timer growth
        if (ttlTimersRef.current.size > MAX_TTL_TIMERS) {
          const oldest = ttlTimersRef.current.keys().next().value;
          clearTimeout(ttlTimersRef.current.get(oldest));
          ttlTimersRef.current.delete(oldest);
          sfxLog.info(`TTL_EVICT | evicted oldest timer | remaining: ${ttlTimersRef.current.size}`);
        }

        return {
          key: sfxKey,
          name: sfx.definition?.prompt?.substring(0, 30) || sfxKey.split('.')[1]?.replace(/_/g, ' ') || sfxKey,
          isLooping
        };
      }

      return null;

    } catch (error) {
      // Ignore abort errors
      if (error.name === 'AbortError') {
        sfxLog.info(`FETCH_ABORTED | key: ${sfx.sfx_key || sfx.sfxKey}`);
      } else {
        sfxLog.error(`ERROR | key: ${sfx.sfx_key || sfx.sfxKey} | error: ${error.message}`);
      }
      return null;
    }
  }, []);

  /**
   * Play sound effects list
   * @param {Array} sfxList - List of SFX to play
   * @param {object} options - Play options
   * @param {boolean} options.introAudioQueued - Whether intro audio is queued
   * @param {boolean} options.sceneAudioStarted - Whether scene audio has started
   * @param {number} options.audioDurationSeconds - Actual audio duration in seconds for timing
   */
  const playSfx = useCallback(async (sfxList, { introAudioQueued = false, sceneAudioStarted = false, audioDurationSeconds = 40 } = {}) => {
    // Comprehensive logging for SFX trigger decisions
    const logSfxState = () => `introAudioQueued: ${introAudioQueued} | sceneAudioStarted: ${sceneAudioStarted} | audioDuration: ${audioDurationSeconds}s`;

    if (!sfxEnabledRef.current || !sfxList || sfxList.length === 0) {
      sfxLog.info(`TRIGGER_SKIPPED | reason: ${!sfxEnabledRef.current ? 'disabled' : 'empty_list'} | enabled: ${sfxEnabledRef.current} | sfxList: ${sfxList?.length || 0}`);
      return;
    }

    // Additional guard: Don't play SFX if intro audio is still queued/playing
    // This ensures SFX only plays during actual story narration, not title/synopsis
    if (introAudioQueued && !sceneAudioStarted) {
      sfxLog.info(`TRIGGER_BLOCKED | reason: intro_audio_active | ${logSfxState()}`);
      return;
    }

    // FAIL LOUDLY: Warn if state is inconsistent (introAudioQueued should be false when sceneAudioStarted is true)
    if (introAudioQueued && sceneAudioStarted) {
      console.warn('[SFX] WARNING: Inconsistent state - introAudioQueued=true but sceneAudioStarted=true! This should not happen.');
      sfxLog.warn(`STATE_INCONSISTENT | ${logSfxState()} - proceeding anyway since sceneAudioStarted=true`);
    }

    sfxLog.info(`TRIGGER_ACCEPTED | effects: ${sfxList.length} | ${logSfxState()} | keys: ${sfxList.map(s => s.sfx_key || s.sfxKey).join(', ')}`);

    // Stop any existing SFX and abort in-flight fetches
    stopAllSfx();

    // Create new AbortController for this batch of SFX
    const abortController = new AbortController();
    sfxAbortController.current = abortController;

    // Capture the current generation ID to detect if we should abort
    const currentGenerationId = sfxGenerationId.current;

    const newActiveSfx = [];

    // CRITICAL FIX: Convert timing strings to numeric seconds using ACTUAL audio duration
    // This ensures SFX triggers at the correct point relative to the actual audio length
    const sfxListWithTiming = sfxList.map(sfx => ({
      ...sfx,
      trigger_at_seconds: sfx.trigger_at_seconds || convertTimingToSeconds(sfx.timing, audioDurationSeconds)
    }));

    // Log timing conversion for debugging
    sfxListWithTiming.forEach(sfx => {
      const key = sfx.sfx_key || sfx.sfxKey || sfx.key;
      sfxLog.info(`TIMING_CONVERTED | key: ${key} | timing: "${sfx.timing}" | trigger_at_seconds: ${sfx.trigger_at_seconds} | audioDuration: ${audioDurationSeconds}s`);
    });

    // Schedule SFX playback based on trigger_at_seconds
    // Group immediate SFX and delayed SFX
    const immediateSfx = [];
    const delayedSfx = [];

    for (const sfx of sfxListWithTiming) {
      const triggerTime = (sfx.trigger_at_seconds || 0) * 1000; // Convert to ms
      if (triggerTime <= 0) {
        immediateSfx.push(sfx);
      } else {
        delayedSfx.push({ sfx, delay: triggerTime });
      }
    }

    // Clear any previously scheduled timers before starting new ones
    scheduledTimersRef.current.forEach(timer => {
      try { clearTimeout(timer); } catch (e) { /* ignore */ }
    });
    scheduledTimersRef.current = [];

    // Play immediate SFX sequentially
    for (const sfx of immediateSfx) {
      if (abortController.signal.aborted) break;
      const result = await playIndividualSfx(sfx, abortController, currentGenerationId);
      if (result) newActiveSfx.push(result);
      // Small delay between SFX to avoid overwhelming
      await new Promise(r => setTimeout(r, 100));
    }

    // Schedule delayed SFX
    for (const { sfx, delay } of delayedSfx) {
      if (abortController.signal.aborted) break;
      const triggerKey = sfx.sfx_key || sfx.sfxKey || sfx.key;
      sfxLog.info(`SCHEDULED | key: ${triggerKey} | delay: ${delay}ms | timing: ${sfx.timing || 'unknown'}`);

      const timer = setTimeout(async () => {
        // Check if still valid before playing
        if (sfxGenerationId.current === currentGenerationId && !abortController.signal.aborted) {
          const result = await playIndividualSfx(sfx, abortController, currentGenerationId);
          if (result && sfxGenerationId.current === currentGenerationId) {
            setActiveSfx(prev => [...prev, result]);
          }
        }
      }, delay);

      scheduledTimersRef.current.push(timer);
    }

    // Log scheduled timers count
    if (scheduledTimersRef.current.length > 0) {
      sfxLog.info(`TIMERS_SCHEDULED | count: ${scheduledTimersRef.current.length}`);
    }

    // Only update state if still the current generation
    if (sfxGenerationId.current === currentGenerationId) {
      sfxLog.info(`ACTIVE_EFFECTS | count: ${newActiveSfx.length} | keys: ${newActiveSfx.map(s => s.key).join(', ')}`);
      setActiveSfx(newActiveSfx);
    }
  }, [stopAllSfx, playIndividualSfx]);

  /**
   * Toggle SFX enabled state
   */
  const toggleSfx = useCallback(() => {
    if (sfxEnabledRef.current) stopAllSfx();
    setSfxEnabled(prev => !prev);
  }, [stopAllSfx, setSfxEnabled]);

  /**
   * Auto-stop SFX when audio playback ends
   * This is a critical safeguard to ensure looping SFX don't continue after narration
   */
  useEffect(() => {
    // Only run if isPlaying is being tracked (passed in as a prop)
    if (isPlaying === null) return;

    // Detect when audio just finished (was playing, now not playing)
    const wasPlaying = wasPlayingRef.current;
    const audioJustFinished = wasPlaying && !isPlaying;

    // Update ref for next comparison
    wasPlayingRef.current = isPlaying;

    // Stop all SFX when audio finishes
    if (audioJustFinished && activeSfx.length > 0) {
      sfxLog.info(`AUTO_STOP | reason: audio_ended | active_sfx: ${activeSfx.length} | keys: ${activeSfx.map(s => s.key).join(', ')}`);
      stopAllSfx();
    }
  }, [isPlaying, activeSfx, stopAllSfx]);

  /**
   * Auto-stop SFX when story ends
   */
  useEffect(() => {
    if (storyEnded && activeSfx.length > 0) {
      sfxLog.info(`AUTO_STOP | reason: story_ended | active_sfx: ${activeSfx.length}`);
      stopAllSfx();
    }
  }, [storyEnded, activeSfx, stopAllSfx]);

  /**
   * Cleanup on unmount - stop all SFX and clear timers
   */
  useEffect(() => {
    return () => {
      sfxLog.info('UNMOUNT | cleaning up all SFX');
      // Clear all scheduled timers
      scheduledTimersRef.current.forEach(timer => {
        try { clearTimeout(timer); } catch (e) { /* ignore */ }
      });
      scheduledTimersRef.current = [];

      // MEMORY LEAK FIX: Clear all fade intervals
      fadeIntervalsRef.current.forEach(interval => {
        try { clearInterval(interval); } catch (e) { /* ignore */ }
      });
      fadeIntervalsRef.current.clear();

      // Stop all audio
      sfxAudioRefs.current.forEach((audio) => {
        try {
          audio.pause();
          audio.src = '';
        } catch (e) { /* ignore */ }
      });
      sfxAudioRefs.current.clear();

      // Revoke blob URLs
      sfxBlobUrls.current.forEach(url => {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      });
      sfxBlobUrls.current.clear();
    };
  }, []);

  return {
    // State
    sfxEnabled,
    activeSfx,

    // Actions
    playSfx,
    stopAllSfx,
    toggleSfx,
    setSfxEnabled,

    // Refs (for external access if needed)
    sfxEnabledRef
  };
}

export default useSfxManager;
