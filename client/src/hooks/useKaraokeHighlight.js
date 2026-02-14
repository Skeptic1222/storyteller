/**
 * useKaraokeHighlight Hook
 * Tracks which word should be highlighted based on audio playback time.
 *
 * Uses polling (50ms interval) for smooth updates instead of relying on
 * timeupdate events which can be inconsistent.
 *
 * Features:
 * - Binary search for efficient word lookup
 * - Ref-based time tracking to avoid effect re-runs
 * - Diagnostic logging for debugging
 */

import { useState, useEffect, useRef } from 'react';
import { audioLog } from '../utils/clientLogger';

/**
 * @param {object} options
 * @param {object} options.wordTimings - Word timing data with { words: [{ text, start_ms, end_ms }] }
 * @param {number} options.currentTime - Current audio playback time in seconds
 * @param {boolean} options.isPlaying - Whether audio is currently playing
 * @param {boolean} options.isPaused - Whether audio is paused
 * @param {boolean} options.showText - Whether text display is enabled
 * @param {boolean} options.isSceneAudio - Whether this is scene audio (not intro)
 * @returns {number} Current word index (-1 if no word is highlighted)
 */
export function useKaraokeHighlight({
  wordTimings,
  currentTime,
  isPlaying,
  isPaused,
  showText,
  isSceneAudio
}) {
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const currentTimeRef = useRef(0);

  // Keep currentTimeRef in sync with currentTime
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Word highlighting effect
  useEffect(() => {
    // Diagnostic logging
    audioLog.info(`KARAOKE_EFFECT_RUN | hasWordTimings: ${!!wordTimings?.words} | wordCount: ${wordTimings?.words?.length || 0} | isPlaying: ${isPlaying} | showText: ${showText} | isPaused: ${isPaused} | isSceneAudio: ${isSceneAudio}`);

    // Validate timings before enabling karaoke
    // Calculate offset from first word (ElevenLabs often has lead-in silence)
    let timingOffset = 0;
    if (wordTimings?.words && wordTimings.words.length > 0) {
      const words = wordTimings.words;
      const firstStart = words[0].start_ms ?? 0;
      const lastEnd = words[words.length - 1].end_ms ?? 0;

      // Store offset for normalization instead of rejecting valid timings
      if (firstStart > 50) {
        timingOffset = firstStart;
        audioLog.info(`KARAOKE_TIMING_OFFSET | applying ${timingOffset}ms offset to normalize timings`);
      }

      // Check for non-monotonic timings (actual data corruption)
      for (let i = 1; i < words.length; i++) {
        if (words[i].start_ms < words[i - 1].end_ms) {
          audioLog.error(`KARAOKE_TIMING_INVALID | non-monotonic at index ${i} (${words[i].start_ms} < ${words[i - 1].end_ms})`);
          setCurrentWordIndex(-1);
          return;
        }
      }

      // Check for excessive drift (but account for offset)
      if (wordTimings.total_duration_ms) {
        const adjustedLastEnd = lastEnd - timingOffset;
        const adjustedTotal = wordTimings.total_duration_ms - timingOffset;
        const drift = Math.abs(adjustedTotal - adjustedLastEnd);
        if (drift > 500) {
          audioLog.error(`KARAOKE_TIMING_DRIFT | total=${wordTimings.total_duration_ms}ms lastEnd=${lastEnd}ms drift=${drift}ms (after offset adjustment)`);
          setCurrentWordIndex(-1);
          return;
        }
      }
    }

    // Guard conditions
    if (!wordTimings?.words || !isPlaying || !showText || isPaused || !isSceneAudio) {
      const reason = !wordTimings?.words ? 'no_word_timings' :
                     !isPlaying ? 'not_playing' :
                     !showText ? 'text_hidden' :
                     isPaused ? 'paused' :
                     !isSceneAudio ? 'scene_not_started' : 'unknown';
      audioLog.info(`KARAOKE_BLOCKED | reason: ${reason}`);
      setCurrentWordIndex(-1);
      return;
    }

    audioLog.info(`KARAOKE_STARTING | words: ${wordTimings.words.length} | isSceneAudio: ${isSceneAudio} | currentTimeRef: ${currentTimeRef.current} | timingOffset: ${timingOffset}ms`);

    // Capture offset for use in interval (closure)
    const offsetMs = timingOffset;

    let lastFoundIndex = -1;
    let pollCount = 0;
    let lastTimeMs = -1;
    let stallCount = 0;
    const MAX_STALL_COUNT = 100; // 5 seconds without time change = stalled
    const MAX_POLL_COUNT = 20000; // Safety limit (~16 minutes)

    // Poll audio time every 50ms for smooth highlighting
    const interval = setInterval(() => {
      pollCount++;

      // Safety limit to prevent infinite polling
      if (pollCount >= MAX_POLL_COUNT) {
        audioLog.error(`KARAOKE_MAX_POLLS | reached ${MAX_POLL_COUNT} polls, stopping`);
        clearInterval(interval);
        return;
      }

      // CRITICAL FIX: Apply the timing offset to compensate for ElevenLabs lead-in silence
      // The word timings from ElevenLabs often start at 300-500ms instead of 0
      // We need to ADD the offset to our current time to match the word timing positions
      const rawTimeMs = currentTimeRef.current * 1000;
      const timeMs = rawTimeMs + offsetMs;
      const words = wordTimings.words;

      // Stall detection: stop polling if audio time hasn't changed
      if (Math.abs(timeMs - lastTimeMs) < 1) {
        stallCount++;
        if (stallCount >= MAX_STALL_COUNT) {
          audioLog.error(`KARAOKE_STALLED | audio time frozen at ${timeMs.toFixed(0)}ms for ${stallCount} polls, stopping`);
          clearInterval(interval);
          return;
        }
      } else {
        stallCount = 0;
        lastTimeMs = timeMs;
      }

      // Log every 20 polls (1 second)
      if (pollCount % 20 === 0) {
        audioLog.info(`KARAOKE_POLL | pollCount: ${pollCount} | timeMs: ${timeMs.toFixed(0)} | lastFoundIndex: ${lastFoundIndex}`);
      }

      // Binary search for current word
      let left = 0;
      let right = words.length - 1;
      let foundIndex = -1;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const word = words[mid];

        // Compare adjusted time against word timings
        if (timeMs >= word.start_ms && timeMs < word.end_ms) {
          foundIndex = mid;
          break;
        } else if (timeMs < word.start_ms) {
          right = mid - 1;
        } else {
          left = mid + 1;
        }
      }

      // Update if changed
      if (foundIndex !== lastFoundIndex) {
        if (foundIndex >= 0) {
          audioLog.info(`KARAOKE_WORD_CHANGE | index: ${foundIndex} | word: "${words[foundIndex]?.text}" | timeMs: ${timeMs.toFixed(0)}`);
        }
        lastFoundIndex = foundIndex;
        setCurrentWordIndex(foundIndex);
      }
    }, 50);

    return () => {
      audioLog.info(`KARAOKE_CLEANUP | totalPolls: ${pollCount}`);
      clearInterval(interval);
    };
  }, [wordTimings, isPlaying, isPaused, showText, isSceneAudio]);

  return currentWordIndex;
}

export default useKaraokeHighlight;
