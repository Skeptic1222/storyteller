/**
 * useSleepTimer Hook
 * Manages automatic story pause after a set duration
 * Useful for long listening sessions
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Preset durations in minutes
export const SLEEP_TIMER_PRESETS = [
  { label: 'Off', minutes: 0 },
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '20 min', minutes: 20 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '60 min', minutes: 60 },
  { label: '90 min', minutes: 90 }
];

/**
 * Listening timer hook for auto-pausing playback
 * @param {Object} options - Configuration options
 * @param {Function} options.onTimerEnd - Callback when timer ends (use to pause story)
 * @param {Function} options.onWarning - Callback 1 minute before timer ends
 * @param {boolean} options.pauseOnHidden - Pause timer when tab is hidden
 * @returns {Object} Timer state and controls
 */
export function useSleepTimer(options = {}) {
  const {
    onTimerEnd = null,
    onWarning = null,
    pauseOnHidden = true
  } = options;

  // Store callbacks in refs to avoid effect dependencies
  const onTimerEndRef = useRef(onTimerEnd);
  const onWarningRef = useRef(onWarning);

  useEffect(() => {
    onTimerEndRef.current = onTimerEnd;
  }, [onTimerEnd]);

  useEffect(() => {
    onWarningRef.current = onWarning;
  }, [onWarning]);

  // Timer state
  const [isActive, setIsActive] = useState(false);
  const [duration, setDuration] = useState(0); // in minutes
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [hasWarned, setHasWarned] = useState(false);

  // Interval ref
  const intervalRef = useRef(null);

  /**
   * Start the timer
   * @param {number} minutes - Duration in minutes
   */
  const startTimer = useCallback((minutes) => {
    if (minutes <= 0) {
      stopTimer();
      return;
    }

    // Clear any existing timer
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    const totalSeconds = minutes * 60;
    setDuration(minutes);
    setRemainingSeconds(totalSeconds);
    setIsActive(true);
    setIsPaused(false);
    setHasWarned(false);

    console.log(`[ListeningTimer] Started: ${minutes} minutes`);

    intervalRef.current = setInterval(() => {
      setRemainingSeconds(prev => {
        // Check for warning (1 minute remaining)
        if (prev === 61 && !hasWarned) {
          setHasWarned(true);
          onWarningRef.current?.();
          console.log('[ListeningTimer] Warning: 1 minute remaining');
        }

        // Check for end
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          setIsActive(false);
          onTimerEndRef.current?.();
          console.log('[ListeningTimer] Timer ended');
          return 0;
        }

        return prev - 1;
      });
    }, 1000);
  }, [hasWarned]);

  /**
   * Stop and reset the timer
   */
  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsActive(false);
    setDuration(0);
    setRemainingSeconds(0);
    setIsPaused(false);
    setHasWarned(false);
    console.log('[ListeningTimer] Stopped');
  }, []);

  /**
   * Pause the timer
   */
  const pauseTimer = useCallback(() => {
    if (!isActive || isPaused) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPaused(true);
    console.log('[ListeningTimer] Paused');
  }, [isActive, isPaused]);

  /**
   * Resume the timer
   */
  const resumeTimer = useCallback(() => {
    if (!isActive || !isPaused) return;

    setIsPaused(false);

    intervalRef.current = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === 61 && !hasWarned) {
          setHasWarned(true);
          onWarningRef.current?.();
        }

        if (prev <= 1) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          setIsActive(false);
          onTimerEndRef.current?.();
          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    console.log('[ListeningTimer] Resumed');
  }, [isActive, isPaused, hasWarned]);

  /**
   * Add time to the timer
   * @param {number} minutes - Minutes to add
   */
  const addTime = useCallback((minutes) => {
    if (!isActive) return;

    const additionalSeconds = minutes * 60;
    setRemainingSeconds(prev => prev + additionalSeconds);
    setHasWarned(false); // Reset warning if we added time
    console.log(`[ListeningTimer] Added ${minutes} minutes`);
  }, [isActive]);

  // Handle visibility change (pause when tab is hidden)
  useEffect(() => {
    if (!pauseOnHidden) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseTimer();
      } else {
        resumeTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pauseOnHidden, pauseTimer, resumeTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Format remaining time as MM:SS
  const formatTime = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Calculate progress percentage
  const progress = duration > 0
    ? ((duration * 60 - remainingSeconds) / (duration * 60)) * 100
    : 0;

  return {
    // State
    isActive,
    isPaused,
    duration,
    remainingSeconds,
    formattedTime: formatTime(remainingSeconds),
    progress,
    hasWarned,

    // Actions
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    addTime,

    // Presets
    presets: SLEEP_TIMER_PRESETS
  };
}

export default useSleepTimer;
