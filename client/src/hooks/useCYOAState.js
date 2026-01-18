/**
 * useCYOAState Hook
 * Manages Choose Your Own Adventure (CYOA) state including choices,
 * checkpoints, history tracking, and choice submission.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for managing CYOA state
 * @param {string} sessionId - The story session ID
 * @param {object} socket - Socket.io connection
 * @param {object} options - Additional options
 * @param {object} options.session - Session data containing config
 * @param {function} options.stopAudio - Function to stop audio playback
 * @returns {object} CYOA state and handlers
 */
export default function useCYOAState(sessionId, socket, options = {}) {
  const { session, stopAudio } = options;

  // Core CYOA state
  const [choices, setChoices] = useState([]);
  const [pendingChoices, setPendingChoices] = useState([]);
  const [choiceHistory, setChoiceHistory] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [showChoiceHistory, setShowChoiceHistory] = useState(false);
  const [isBacktracking, setIsBacktracking] = useState(false);
  const [choiceAudioPlaying, setChoiceAudioPlaying] = useState(false);

  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true);

  // Store pendingChoices in ref to avoid re-subscribing to socket events
  const pendingChoicesRef = useRef(pendingChoices);
  useEffect(() => {
    pendingChoicesRef.current = pendingChoices;
  }, [pendingChoices]);

  // Store choiceHistory length in ref
  const choiceHistoryLengthRef = useRef(choiceHistory.length);
  useEffect(() => {
    choiceHistoryLengthRef.current = choiceHistory.length;
  }, [choiceHistory.length]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Derive CYOA settings from session config
  const cyoaSettings = session?.config?.cyoa_settings || {
    enabled: false,
    num_choices: 3,
    voice_choices: false,
    checkpoint_frequency: 5
  };

  const isCyoaEnabled = session?.config?.story_type === 'cyoa' ||
                        session?.config?.enable_cyoa === true ||
                        cyoaSettings.enabled === true;

  // Handle choice submission
  const submitChoice = useCallback((choiceKeyOrId, isId = false) => {
    if (!socket || !sessionId) {
      console.error('[useCYOAState] Cannot submit choice: missing socket or sessionId');
      return;
    }

    // Stop any playing audio
    if (stopAudio) {
      stopAudio();
    }

    const payload = {
      session_id: sessionId
    };

    if (isId) {
      payload.choice_id = choiceKeyOrId;
    } else {
      payload.choice_key = choiceKeyOrId.toUpperCase();
    }

    console.log('[useCYOAState] Submitting choice:', payload);
    socket.emit('submit-choice', payload);

    // Clear current choices while waiting for response
    setChoices([]);
    setChoiceAudioPlaying(false);
  }, [socket, sessionId, stopAudio]);

  // Handle backtracking to a checkpoint
  const backtrackToCheckpoint = useCallback((checkpointIndex, setCurrentScene) => {
    if (!socket || !sessionId) {
      console.error('[useCYOAState] Cannot backtrack: missing socket or sessionId');
      return;
    }

    if (checkpointIndex < 0 || checkpointIndex >= checkpoints.length) {
      console.error('[useCYOAState] Invalid checkpoint index:', checkpointIndex);
      return;
    }

    const checkpoint = checkpoints[checkpointIndex];
    console.log('[useCYOAState] Backtracking to checkpoint:', checkpoint);

    setIsBacktracking(true);

    // Stop any playing audio
    if (stopAudio) {
      stopAudio();
    }

    // Clear choices
    setChoices([]);
    setPendingChoices([]);
    setChoiceAudioPlaying(false);

    // Emit backtrack event
    socket.emit('backtrack-to-checkpoint', {
      session_id: sessionId,
      checkpoint_id: checkpoint.id,
      scene_number: checkpoint.sceneNumber
    });

    // Update local scene if setCurrentScene provided
    if (setCurrentScene && checkpoint.sceneData) {
      setCurrentScene(checkpoint.sceneData);
    }

    // Trim choice history to checkpoint
    setChoiceHistory(prev => prev.slice(0, checkpoint.historyIndex || checkpointIndex));

    // Reset backtracking flag after a short delay
    setTimeout(() => {
      if (isMountedRef.current) {
        setIsBacktracking(false);
      }
    }, 500);
  }, [socket, sessionId, checkpoints, stopAudio]);

  // Listen for socket events related to CYOA
  useEffect(() => {
    if (!socket) return;

    // Handle choice accepted
    const handleChoiceAccepted = (data) => {
      if (!isMountedRef.current) return;
      console.log('[useCYOAState] Choice accepted:', data);

      // Add to history
      setChoiceHistory(prev => [...prev, {
        key: data.key,
        text: data.text,
        sceneNumber: data.sceneNumber,
        timestamp: Date.now()
      }]);
    };

    // Handle checkpoint created
    const handleCheckpointCreated = (data) => {
      if (!isMountedRef.current) return;
      console.log('[useCYOAState] Checkpoint created:', data);

      setCheckpoints(prev => [...prev, {
        id: data.checkpoint_id,
        sceneNumber: data.scene_number,
        sceneData: data.scene_data,
        historyIndex: choiceHistoryLengthRef.current,
        timestamp: Date.now()
      }]);
    };

    // Handle choice audio ready
    const handleChoiceAudioReady = (data) => {
      if (!isMountedRef.current) return;
      console.log('[useCYOAState] Choice audio ready');
      setChoiceAudioPlaying(true);
    };

    // Handle choice audio error
    const handleChoiceAudioError = (data) => {
      if (!isMountedRef.current) return;
      console.error('[useCYOAState] Choice audio error:', data.message);
      setChoiceAudioPlaying(false);
      // Show choices immediately if audio fails
      if (pendingChoicesRef.current.length > 0) {
        setChoices(pendingChoicesRef.current);
        setPendingChoices([]);
      }
    };

    // Handle session reconnect with CYOA state
    const handleSessionState = (data) => {
      if (!isMountedRef.current) return;
      if (data.choiceHistory) {
        setChoiceHistory(data.choiceHistory);
      }
      if (data.checkpoints) {
        setCheckpoints(data.checkpoints);
      }
      if (data.pendingChoices) {
        setChoices(data.pendingChoices);
      }
    };

    socket.on('choice-accepted', handleChoiceAccepted);
    socket.on('checkpoint-created', handleCheckpointCreated);
    socket.on('choice-audio-ready', handleChoiceAudioReady);
    socket.on('choice-audio-error', handleChoiceAudioError);
    socket.on('session-state', handleSessionState);

    return () => {
      socket.off('choice-accepted', handleChoiceAccepted);
      socket.off('checkpoint-created', handleCheckpointCreated);
      socket.off('choice-audio-ready', handleChoiceAudioReady);
      socket.off('choice-audio-error', handleChoiceAudioError);
      socket.off('session-state', handleSessionState);
    };
  }, [socket]); // Only socket - other values accessed via refs to prevent re-subscription

  return {
    // State
    choices,
    setChoices,
    pendingChoices,
    setPendingChoices,
    choiceHistory,
    setChoiceHistory,
    checkpoints,
    showChoiceHistory,
    setShowChoiceHistory,
    isBacktracking,
    choiceAudioPlaying,
    setChoiceAudioPlaying,

    // Derived values
    cyoaSettings,
    isCyoaEnabled,

    // Actions
    submitChoice,
    backtrackToCheckpoint
  };
}
