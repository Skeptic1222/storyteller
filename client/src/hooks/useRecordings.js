/**
 * useRecordings Hook
 * Manages recording detection, playback state, and CYOA path tracking
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import recordingService from '../services/recordingService';

/**
 * Hook for managing story recordings
 * @param {string} sessionId - Story session ID
 * @param {Object} options - Configuration options
 * @returns {Object} Recording state and controls
 */
export function useRecordings(sessionId, options = {}) {
  const {
    autoCheckOnMount = true,
    checkForRecovery = true,
    onRecordingFound = null,
    onDiverge = null
  } = options;

  // Store callbacks in refs to avoid triggering effects on every render
  const onRecordingFoundRef = useRef(onRecordingFound);
  const onDivergeRef = useRef(onDiverge);

  // Update refs when callbacks change
  useEffect(() => {
    onRecordingFoundRef.current = onRecordingFound;
  }, [onRecordingFound]);

  useEffect(() => {
    onDivergeRef.current = onDiverge;
  }, [onDiverge]);

  // Recording state
  const [recordings, setRecordings] = useState([]);
  const [activeRecording, setActiveRecording] = useState(null);
  const [segments, setSegments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Playback state
  const [playbackSession, setPlaybackSession] = useState(null);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);

  // CYOA path tracking
  const [currentPath, setCurrentPath] = useState(null);
  const [choiceHistory, setChoiceHistory] = useState([]);
  const [availableRecordedChoices, setAvailableRecordedChoices] = useState({});

  // Recovery state
  const [recoveryInfo, setRecoveryInfo] = useState(null);
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);

  // Refs for cleanup
  const playbackIdRef = useRef(null);
  const lastSegmentRef = useRef(0);

  /**
   * Check for available recordings on mount
   * Note: Uses refs for callbacks to prevent infinite re-renders
   */
  useEffect(() => {
    if (!sessionId || !autoCheckOnMount) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function checkRecordings() {
      setIsLoading(true);
      setError(null);

      try {
        // Check for complete recordings
        const data = await recordingService.getSessionRecordings(sessionId);
        if (cancelled) return;

        setRecordings(data.recordings || []);

        // If there's a complete recording, notify via ref
        const completeRecording = data.recordings?.find(r => r.is_complete);
        if (completeRecording) {
          console.log('[useRecordings] Found complete recording:', completeRecording.id);
          onRecordingFoundRef.current?.(completeRecording);
        }

        // Check for interrupted recordings to recover
        if (checkForRecovery) {
          const recovery = await recordingService.checkRecovery(sessionId);
          if (cancelled) return;

          if (recovery.hasInterrupted) {
            console.log('[useRecordings] Found interrupted recording for recovery');
            setRecoveryInfo(recovery);
            setShowRecoveryPrompt(true);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[useRecordings] Error checking recordings:', err);
        setError(err.message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    checkRecordings();

    return () => {
      cancelled = true;
    };
  }, [sessionId, autoCheckOnMount, checkForRecovery]);

  /**
   * Load a recording for playback
   */
  const loadRecording = useCallback(async (recordingId) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await recordingService.getRecording(recordingId);
      if (!data) {
        throw new Error('Recording not found');
      }

      setActiveRecording(data.recording);
      setSegments(data.segments || []);
      setCurrentSegmentIndex(0);
      setCurrentPath(data.recording.cyoa_path_signature);

      return data;
    } catch (err) {
      console.error('[useRecordings] Error loading recording:', err);
      setError(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Start playing a recording
   */
  const startRecordingPlayback = useCallback(async (recordingId = null, userId = null) => {
    const targetId = recordingId || activeRecording?.id;
    if (!targetId) return false;

    try {
      // Load recording if not already loaded
      if (!activeRecording || activeRecording.id !== targetId) {
        const data = await loadRecording(targetId);
        if (!data) return false;
      }

      // Start playback session
      const result = await recordingService.startPlayback(targetId, userId);
      if (result) {
        setPlaybackSession(result);
        playbackIdRef.current = result.playbackId;
        setIsPlayingRecording(true);
        setCurrentSegmentIndex(0);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[useRecordings] Error starting playback:', err);
      setError(err.message);
      return false;
    }
  }, [activeRecording, loadRecording]);

  /**
   * Stop recording playback
   */
  const stopRecordingPlayback = useCallback(() => {
    setIsPlayingRecording(false);
    if (playbackIdRef.current) {
      recordingService.completePlayback(playbackIdRef.current);
      playbackIdRef.current = null;
    }
    setPlaybackSession(null);
  }, []);

  /**
   * Update playback position
   */
  const updatePosition = useCallback((segmentIndex, positionSeconds) => {
    setCurrentSegmentIndex(segmentIndex);
    lastSegmentRef.current = segmentIndex;

    if (playbackIdRef.current) {
      recordingService.updatePlaybackPosition(
        playbackIdRef.current,
        segmentIndex,
        positionSeconds
      );
    }
  }, []);

  /**
   * Handle segment completion
   */
  const onSegmentComplete = useCallback(() => {
    if (currentSegmentIndex < segments.length - 1) {
      setCurrentSegmentIndex(prev => prev + 1);
      return true; // More segments available
    }
    return false; // Recording complete
  }, [currentSegmentIndex, segments.length]);

  /**
   * Check if a choice has a recording
   */
  const checkChoiceRecording = useCallback(async (choiceKey) => {
    if (!sessionId) return false;
    return await recordingService.checkChoice(sessionId, currentPath, choiceKey);
  }, [sessionId, currentPath]);

  /**
   * Update available recorded choices at current position
   */
  const refreshAvailableChoices = useCallback(async () => {
    if (!sessionId) return;
    const choices = await recordingService.getAvailablePaths(sessionId, currentPath);
    setAvailableRecordedChoices(choices);
    return choices;
  }, [sessionId, currentPath]);

  /**
   * Handle choice selection during recording playback
   */
  const handleRecordedChoice = useCallback(async (choiceKey) => {
    const hasRecording = availableRecordedChoices[choiceKey];

    if (hasRecording) {
      // Switch to the recorded path
      console.log('[useRecordings] Switching to recorded path for choice:', choiceKey);

      // Update choice history
      setChoiceHistory(prev => [...prev, choiceKey]);

      // Load the recording for this path
      const newPath = currentPath ? `${currentPath}-${choiceKey}` : choiceKey;
      setCurrentPath(newPath);

      // Find and load recording for new path
      const pathCheck = await recordingService.checkPath(sessionId, [...choiceHistory, choiceKey]);
      if (pathCheck.recordingId) {
        await loadRecording(pathCheck.recordingId);
        return { action: 'continue', recordingId: pathCheck.recordingId };
      }
    }

    // No recording - diverge to live generation
    console.log('[useRecordings] Diverging to live generation for choice:', choiceKey);
    stopRecordingPlayback();
    onDivergeRef.current?.(choiceKey, currentSegmentIndex);
    return { action: 'diverge', choiceKey };
  }, [
    availableRecordedChoices,
    currentPath,
    sessionId,
    choiceHistory,
    loadRecording,
    stopRecordingPlayback,
    currentSegmentIndex
  ]);

  /**
   * Resume an interrupted recording
   */
  const resumeRecording = useCallback(async () => {
    if (!recoveryInfo?.recording) return false;

    try {
      const result = await recordingService.resumeRecording(recoveryInfo.recording.id);
      if (result?.success) {
        await loadRecording(recoveryInfo.recording.id);
        setShowRecoveryPrompt(false);
        setRecoveryInfo(null);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[useRecordings] Error resuming recording:', err);
      return false;
    }
  }, [recoveryInfo, loadRecording]);

  /**
   * Dismiss recovery prompt
   */
  const dismissRecovery = useCallback(() => {
    setShowRecoveryPrompt(false);
    setRecoveryInfo(null);
  }, []);

  /**
   * Cleanup on unmount - mark recording as interrupted if playing
   */
  useEffect(() => {
    return () => {
      if (isPlayingRecording && activeRecording?.id) {
        recordingService.markInterrupted(activeRecording.id, lastSegmentRef.current);
      }
    };
  }, [isPlayingRecording, activeRecording?.id]);

  // Derived state
  const hasRecording = useMemo(() =>
    recordings.some(r => r.is_complete),
    [recordings]
  );

  const currentSegment = useMemo(() =>
    segments[currentSegmentIndex] || null,
    [segments, currentSegmentIndex]
  );

  const progress = useMemo(() => ({
    current: currentSegmentIndex + 1,
    total: segments.length,
    percent: segments.length ? ((currentSegmentIndex + 1) / segments.length) * 100 : 0
  }), [currentSegmentIndex, segments.length]);

  return {
    // State
    recordings,
    activeRecording,
    segments,
    currentSegment,
    currentSegmentIndex,
    isLoading,
    error,
    isPlayingRecording,
    playbackSession,
    progress,
    hasRecording,

    // CYOA state
    currentPath,
    choiceHistory,
    availableRecordedChoices,

    // Recovery
    recoveryInfo,
    showRecoveryPrompt,

    // Actions
    loadRecording,
    startRecordingPlayback,
    stopRecordingPlayback,
    updatePosition,
    onSegmentComplete,
    checkChoiceRecording,
    refreshAvailableChoices,
    handleRecordedChoice,
    resumeRecording,
    dismissRecovery,

    // Setters for external control
    setCurrentSegmentIndex,
    setIsPlayingRecording
  };
}

export default useRecordings;
