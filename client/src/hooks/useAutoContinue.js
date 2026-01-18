/**
 * useAutoContinue Hook
 * Handles automatic story continuation when audio playback finishes.
 * Includes CYOA scene 0 continuation and regular auto-advancement.
 *
 * Extracted from Story.jsx for maintainability.
 */

import { useEffect, useRef } from 'react';
import { audioLog } from '../utils/clientLogger';

/**
 * @param {object} options
 * @param {boolean} options.isPlaying - Whether audio is currently playing
 * @param {boolean} options.isPaused - Whether audio is paused
 * @param {boolean} options.isGenerating - Whether story is currently generating
 * @param {object} options.socket - Socket.IO socket instance
 * @param {Function} options.continueStory - Function to continue the story
 * @param {Function} options.stopAllSfx - Function to stop all sound effects
 * @param {Function} options.setIsGenerating - State setter for isGenerating
 * @param {array} options.choices - Current available choices
 * @param {array} options.pendingChoices - Choices waiting to be shown
 * @param {boolean} options.storyEnded - Whether the story has ended
 * @param {object} options.currentScene - Current scene data
 * @param {boolean} options.autoplayEnabled - Whether autoplay is enabled
 * @param {object} options.pendingAutoContinueRef - Ref for pending auto-continue flag (optional)
 * @returns {object} Refs for external control (pendingAutoContinue)
 */
export function useAutoContinue({
  isPlaying,
  isPaused,
  isGenerating,
  socket,
  continueStory,
  stopAllSfx,
  setIsGenerating,
  choices,
  pendingChoices,
  storyEnded,
  currentScene,
  autoplayEnabled,
  pendingAutoContinueRef: externalPendingRef
}) {
  // Internal refs for tracking state between renders
  const wasPlayingRef = useRef(false);
  const autoContinueTimerRef = useRef(null);
  const autoContinueLockRef = useRef(false);
  const pendingAutoContinue = externalPendingRef || useRef(false);

  // Store callbacks in refs to avoid dependency churn
  const continueStoryRef = useRef(continueStory);
  const stopAllSfxRef = useRef(stopAllSfx);
  const setIsGeneratingRef = useRef(setIsGenerating);

  useEffect(() => { continueStoryRef.current = continueStory; }, [continueStory]);
  useEffect(() => { stopAllSfxRef.current = stopAllSfx; }, [stopAllSfx]);
  useEffect(() => { setIsGeneratingRef.current = setIsGenerating; }, [setIsGenerating]);

  // Extract stable values from objects/arrays
  const choicesLength = choices?.length || 0;
  const pendingChoicesLength = pendingChoices?.length || 0;
  const hasCurrentScene = !!currentScene;

  useEffect(() => {
    // Detect when audio just finished
    const wasPlaying = wasPlayingRef.current;
    const audioJustFinished = wasPlaying && !isPlaying;

    // Update the ref for next comparison
    wasPlayingRef.current = isPlaying;

    // Clear any pending auto-continue timer when state changes
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }

    // CRITICAL: Stop all SFX when audio finishes (especially looping ones like alarms)
    if (audioJustFinished) {
      audioLog.info('STATE: PLAYING → ENDED | stopping all SFX');
      stopAllSfxRef.current?.();
    }

    if (!audioJustFinished || isGenerating || !socket) return;

    // Check conditions for auto-continuation
    const hasChoices = choicesLength > 0 || pendingChoicesLength > 0;
    const hasPendingAutoContinue = pendingAutoContinue.current;

    // Helper to safely trigger continue with lock
    const safelyTriggerContinue = (delay, reason) => {
      // Clear any existing timer first
      if (autoContinueTimerRef.current) {
        clearTimeout(autoContinueTimerRef.current);
      }

      autoContinueTimerRef.current = setTimeout(() => {
        autoContinueTimerRef.current = null;

        // Check the lock to prevent duplicate calls
        if (autoContinueLockRef.current) {
          console.log('[Story] Auto-continue blocked - already in progress');
          return;
        }

        // Double-check conditions before continuing
        // Note: We check current values via closure - these are stable primitives
        if (storyEnded || choicesLength > 0 || pendingChoicesLength > 0 || isGenerating) {
          console.log('[Story] Auto-continue cancelled - conditions changed');
          return;
        }

        // Acquire lock and continue
        autoContinueLockRef.current = true;
        console.log(`[Story] ${reason}`);

        // FAIL LOUD: Wrap in try-catch to surface any errors
        try {
          continueStoryRef.current?.();
        } catch (error) {
          console.error('[Story] Auto-continue failed:', error);
          setIsGeneratingRef.current?.(false);
          autoContinueLockRef.current = false;
          return;
        }

        // Release lock after a short delay to prevent rapid re-triggers
        setTimeout(() => {
          autoContinueLockRef.current = false;
        }, 500);
      }, delay);
    };

    // Auto-continue for CYOA scene 0 fix (always allowed - part of initial story setup)
    if (hasPendingAutoContinue) {
      pendingAutoContinue.current = false;
      safelyTriggerContinue(1500, '[CYOA] Audio finished, auto-continuing to next scene for choices');
      return;
    }

    // Regular auto-continuation when no choices are pending
    // ONLY auto-continue if autoplayEnabled is true
    if (!hasChoices && !storyEnded && hasCurrentScene && autoplayEnabled) {
      safelyTriggerContinue(1000, 'Audio finished and autoplay enabled, auto-continuing to next scene');
    } else if (!hasChoices && !storyEnded && hasCurrentScene && !autoplayEnabled) {
      console.log('[Story] Chapter audio finished, waiting for user to click continue (autoplay disabled)');
    }

    // Cleanup timer on unmount or dependency change
    return () => {
      if (autoContinueTimerRef.current) {
        clearTimeout(autoContinueTimerRef.current);
        autoContinueTimerRef.current = null;
      }
    };
  }, [isPlaying, isPaused, isGenerating, socket, choicesLength, pendingChoicesLength, storyEnded, hasCurrentScene, autoplayEnabled, pendingAutoContinue]);

  // Return refs for external control
  return {
    pendingAutoContinue,
    wasPlayingRef,
    autoContinueLockRef
  };
}

export default useAutoContinue;
