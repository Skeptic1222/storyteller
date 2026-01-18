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
 * @param {string} timing - Timing string like 'beginning', 'middle', 'end'
 * @param {number} audioDuration - Optional actual audio duration in seconds
 * @returns {number} Trigger time in seconds
 */
function convertTimingToSeconds(timing, audioDuration = 40) {
  if (!timing || typeof timing !== 'string') return 0;

  const t = timing.toLowerCase().trim();

  // Map string timings to numeric seconds
  // AI generates: beginning, middle, end, continuous, on_action
  const timingMap = {
    'beginning': 0,
    'start': 0,
    'early': Math.max(2, audioDuration * 0.15),
    'middle': Math.max(15, audioDuration * 0.5),
    'late': Math.max(25, audioDuration * 0.75),
    'end': Math.max(30, audioDuration * 0.9),
    'continuous': -1, // Special value for looping
    'ambient': Math.max(15, audioDuration * 0.5), // Ambient = middle
    'on_action': Math.max(5, audioDuration * 0.3) // On action = early-middle (30%)
  };

  return timingMap[t] !== undefined ? timingMap[t] : 0;
}

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
