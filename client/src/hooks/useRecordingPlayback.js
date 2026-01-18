/**
 * useRecordingPlayback Hook
 * Manages recording playback UI state and handlers for Story.jsx
 * Handles recording prompts, divergence modals, and recovery flows
 */

import { useState, useCallback } from 'react';

/**
 * @param {Object} options
 * @param {Object} options.socket - Socket.io socket instance
 * @param {string} options.sessionId - Current story session ID
 * @param {Object} options.recordings - Recording management from useRecordings hook
 * @param {boolean} options.isCyoaEnabled - Whether CYOA mode is enabled
 * @param {Function} options.fetchSession - Function to fetch fresh session data
 */
export function useRecordingPlayback({
  socket,
  sessionId,
  recordings,
  isCyoaEnabled,
  fetchSession
}) {
  const {
    recordings: recordingList,
    activeRecording,
    segments: recordingSegments,
    isLoading: recordingLoading,
    isPlayingRecording,
    hasRecording,
    recoveryInfo,
    showRecoveryPrompt,
    startRecordingPlayback,
    stopRecordingPlayback,
    refreshAvailableChoices,
    resumeRecording,
    dismissRecovery
  } = recordings;

  // UI state
  const [showRecordingPrompt, setShowRecordingPrompt] = useState(false);
  const [showRecordingPlayer, setShowRecordingPlayer] = useState(false);
  const [showDivergenceModal, setShowDivergenceModal] = useState(false);
  const [divergenceChoice, setDivergenceChoice] = useState(null);
  const [foundRecording, setFoundRecording] = useState(null);

  // Play a found recording
  const handlePlayRecording = useCallback(async () => {
    if (!foundRecording) return;

    setShowRecordingPrompt(false);
    const success = await startRecordingPlayback(foundRecording.id);
    if (success) {
      setShowRecordingPlayer(true);
      // Refresh available choices for CYOA paths
      if (isCyoaEnabled) {
        refreshAvailableChoices();
      }
    } else {
      // Fall back to fresh generation
      console.warn('[Story] Failed to start recording playback, generating fresh');
      handleGenerateFresh();
    }
  }, [foundRecording, startRecordingPlayback, isCyoaEnabled, refreshAvailableChoices]);

  // Generate fresh instead of playing recording
  const handleGenerateFresh = useCallback(() => {
    setShowRecordingPrompt(false);
    setFoundRecording(null);
    // Continue with normal story generation flow
    fetchSession();
  }, [fetchSession]);

  // Close recording player
  const handleCloseRecordingPlayer = useCallback(() => {
    setShowRecordingPlayer(false);
    stopRecordingPlayback();
  }, [stopRecordingPlayback]);

  // Handle divergence from recording (user wants to make different choice)
  const handleRecordingDiverge = useCallback((choiceKey, segmentIndex) => {
    // Find the choice text from the current segment's choices
    const currentSegment = recordingSegments[segmentIndex];
    const choicesAtEnd = currentSegment?.choices_at_end;
    let choices = [];
    try {
      choices = typeof choicesAtEnd === 'string' ? JSON.parse(choicesAtEnd) : choicesAtEnd || [];
    } catch { choices = []; }

    const choice = choices.find(c => c.key === choiceKey);

    setDivergenceChoice({
      key: choiceKey,
      text: choice?.text || `Option ${choiceKey}`
    });
    setShowDivergenceModal(true);
  }, [recordingSegments]);

  // Confirm divergence and submit choice
  const handleDivergenceConfirm = useCallback((choiceKey) => {
    setShowDivergenceModal(false);
    setShowRecordingPlayer(false);
    stopRecordingPlayback();

    // Submit the choice via socket for live generation
    if (socket) {
      console.log('[Socket:Emit] EVENT: submit-choice (divergence) | session_id:', sessionId, '| choice_key:', choiceKey);
      socket.emit('submit-choice', {
        session_id: sessionId,
        choice_key: choiceKey,
        from_recording: true
      });
    }
  }, [socket, sessionId, stopRecordingPlayback]);

  // Cancel divergence
  const handleDivergenceCancel = useCallback(() => {
    setShowDivergenceModal(false);
    setDivergenceChoice(null);
  }, []);

  // Resume from recovery point
  const handleResumeRecovery = useCallback(async () => {
    const success = await resumeRecording();
    if (success) {
      setShowRecordingPlayer(true);
    }
  }, [resumeRecording]);

  // Discard recovery and start fresh
  const handleDiscardRecovery = useCallback(() => {
    dismissRecovery();
    // Continue with fresh start
    fetchSession();
  }, [dismissRecovery, fetchSession]);

  // Toggle recording player from header button
  const toggleRecordingPlayer = useCallback(() => {
    if (showRecordingPlayer) {
      handleCloseRecordingPlayer();
    } else if (foundRecording) {
      handlePlayRecording();
    } else if (recordingList.length > 0) {
      setFoundRecording(recordingList.find(r => r.is_complete) || recordingList[0]);
      setShowRecordingPrompt(true);
    }
  }, [showRecordingPlayer, foundRecording, recordingList, handleCloseRecordingPlayer, handlePlayRecording]);

  // Callback for useRecordings onRecordingFound
  const onRecordingFound = useCallback((recording) => {
    console.log('[Story] Recording found:', recording.id);
    setFoundRecording(recording);
    setShowRecordingPrompt(true);
  }, []);

  return {
    // State
    showRecordingPrompt,
    setShowRecordingPrompt,
    showRecordingPlayer,
    showDivergenceModal,
    divergenceChoice,
    foundRecording,
    setFoundRecording,

    // From useRecordings (passed through)
    activeRecording,
    recordingSegments,
    recordingLoading,
    isPlayingRecording,
    hasRecording,
    recoveryInfo,
    showRecoveryPrompt,

    // Handlers
    handlePlayRecording,
    handleGenerateFresh,
    handleCloseRecordingPlayer,
    handleRecordingDiverge,
    handleDivergenceConfirm,
    handleDivergenceCancel,
    handleResumeRecovery,
    handleDiscardRecovery,
    toggleRecordingPlayer,
    onRecordingFound,
    dismissRecovery
  };
}

export default useRecordingPlayback;
