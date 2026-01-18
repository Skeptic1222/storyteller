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

    audioLog.info(`KARAOKE_STARTING | words: ${wordTimings.words.length} | isSceneAudio: ${isSceneAudio} | currentTimeRef: ${currentTimeRef.current}`);

    let lastFoundIndex = -1;
    let pollCount = 0;

    // Poll audio time every 50ms for smooth highlighting
    const interval = setInterval(() => {
      pollCount++;
      const timeMs = currentTimeRef.current * 1000;
      const words = wordTimings.words;

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
