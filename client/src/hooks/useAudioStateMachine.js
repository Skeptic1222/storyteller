/**
 * useAudioStateMachine Hook
 * Manages audio playback state as a finite state machine.
 *
 * Problem this solves:
 * Story.jsx has 5+ boolean flags for audio state that can get out of sync:
 * - isPlaying, isPaused, introAudioQueued, sceneAudioStarted, isAudioQueued
 *
 * This hook replaces them with a single state machine that guarantees
 * consistent state transitions and makes debugging easier.
 *
 * States:
 * - IDLE: No audio loaded or playing
 * - INTRO_QUEUED: Intro/synopsis audio is queued but not yet playing
 * - INTRO_PLAYING: Intro/synopsis audio is currently playing
 * - SCENE_QUEUED: Scene audio is queued but not yet playing
 * - SCENE_PLAYING: Scene audio is currently playing
 * - PAUSED: Audio was playing but is now paused
 * - ENDED: All audio has finished
 *
 * Transitions:
 * - IDLE → INTRO_QUEUED: queueIntro()
 * - INTRO_QUEUED → INTRO_PLAYING: startIntro()
 * - INTRO_PLAYING → SCENE_QUEUED: queueScene()
 * - SCENE_QUEUED → SCENE_PLAYING: startScene()
 * - SCENE_PLAYING → ENDED: endScene()
 * - (any playing) → PAUSED: pause()
 * - PAUSED → (previous): resume()
 * - (any) → IDLE: reset()
 */

import { useReducer, useCallback, useRef } from 'react';

// Audio states
export const AUDIO_STATES = {
  IDLE: 'IDLE',
  INTRO_QUEUED: 'INTRO_QUEUED',
  INTRO_PLAYING: 'INTRO_PLAYING',
  SCENE_QUEUED: 'SCENE_QUEUED',
  SCENE_PLAYING: 'SCENE_PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED'
};

// Action types
const ACTIONS = {
  QUEUE_INTRO: 'QUEUE_INTRO',
  START_INTRO: 'START_INTRO',
  QUEUE_SCENE: 'QUEUE_SCENE',
  START_SCENE: 'START_SCENE',
  END_SCENE: 'END_SCENE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  RESET: 'RESET',
  ERROR: 'ERROR'
};

// Initial state
const initialState = {
  state: AUDIO_STATES.IDLE,
  previousState: null, // For pause/resume
  error: null,
  metadata: {} // Optional metadata about current audio
};

// Reducer
function audioReducer(state, action) {
  const { type, payload } = action;

  // Log transitions for debugging
  if (typeof window !== 'undefined' && (window.narrimoDebug || window.storytellerDebug)) {
    console.log(`[AudioStateMachine] ${type}: ${state.state} → ?`, payload);
  }

  switch (type) {
    case ACTIONS.QUEUE_INTRO:
      if (state.state !== AUDIO_STATES.IDLE) {
        console.warn(`[AudioStateMachine] Invalid transition: ${state.state} → INTRO_QUEUED`);
        return state;
      }
      return {
        ...state,
        state: AUDIO_STATES.INTRO_QUEUED,
        metadata: payload || {}
      };

    case ACTIONS.START_INTRO:
      if (state.state !== AUDIO_STATES.INTRO_QUEUED) {
        console.warn(`[AudioStateMachine] Invalid transition: ${state.state} → INTRO_PLAYING`);
        return state;
      }
      return {
        ...state,
        state: AUDIO_STATES.INTRO_PLAYING
      };

    case ACTIONS.QUEUE_SCENE:
      // Can queue scene from IDLE, INTRO_PLAYING (after intro ends), or ENDED (replay)
      if (![AUDIO_STATES.IDLE, AUDIO_STATES.INTRO_PLAYING, AUDIO_STATES.ENDED].includes(state.state)) {
        console.warn(`[AudioStateMachine] Invalid transition: ${state.state} → SCENE_QUEUED`);
        return state;
      }
      return {
        ...state,
        state: AUDIO_STATES.SCENE_QUEUED,
        metadata: payload || {}
      };

    case ACTIONS.START_SCENE:
      if (state.state !== AUDIO_STATES.SCENE_QUEUED) {
        console.warn(`[AudioStateMachine] Invalid transition: ${state.state} → SCENE_PLAYING`);
        return state;
      }
      return {
        ...state,
        state: AUDIO_STATES.SCENE_PLAYING
      };

    case ACTIONS.END_SCENE:
      if (state.state !== AUDIO_STATES.SCENE_PLAYING) {
        console.warn(`[AudioStateMachine] Invalid transition: ${state.state} → ENDED`);
        return state;
      }
      return {
        ...state,
        state: AUDIO_STATES.ENDED,
        metadata: {}
      };

    case ACTIONS.PAUSE:
      if (![AUDIO_STATES.INTRO_PLAYING, AUDIO_STATES.SCENE_PLAYING].includes(state.state)) {
        console.warn(`[AudioStateMachine] Cannot pause from state: ${state.state}`);
        return state;
      }
      return {
        ...state,
        state: AUDIO_STATES.PAUSED,
        previousState: state.state
      };

    case ACTIONS.RESUME:
      if (state.state !== AUDIO_STATES.PAUSED || !state.previousState) {
        console.warn(`[AudioStateMachine] Cannot resume from state: ${state.state}`);
        return state;
      }
      return {
        ...state,
        state: state.previousState,
        previousState: null
      };

    case ACTIONS.RESET:
      return { ...initialState };

    case ACTIONS.ERROR:
      return {
        ...state,
        error: payload
      };

    default:
      console.warn(`[AudioStateMachine] Unknown action: ${type}`);
      return state;
  }
}

/**
 * Audio state machine hook.
 *
 * @returns {Object} State machine interface
 */
export function useAudioStateMachine() {
  const [state, dispatch] = useReducer(audioReducer, initialState);
  const stateRef = useRef(state);

  // Keep ref in sync for callbacks
  stateRef.current = state;

  // Action creators
  const queueIntro = useCallback((metadata) => {
    dispatch({ type: ACTIONS.QUEUE_INTRO, payload: metadata });
  }, []);

  const startIntro = useCallback(() => {
    dispatch({ type: ACTIONS.START_INTRO });
  }, []);

  const queueScene = useCallback((metadata) => {
    dispatch({ type: ACTIONS.QUEUE_SCENE, payload: metadata });
  }, []);

  const startScene = useCallback(() => {
    dispatch({ type: ACTIONS.START_SCENE });
  }, []);

  const endScene = useCallback(() => {
    dispatch({ type: ACTIONS.END_SCENE });
  }, []);

  const pause = useCallback(() => {
    dispatch({ type: ACTIONS.PAUSE });
  }, []);

  const resume = useCallback(() => {
    dispatch({ type: ACTIONS.RESUME });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: ACTIONS.RESET });
  }, []);

  const setError = useCallback((error) => {
    dispatch({ type: ACTIONS.ERROR, payload: error });
  }, []);

  // Computed values (derived from state)
  const isPlaying = state.state === AUDIO_STATES.INTRO_PLAYING ||
                    state.state === AUDIO_STATES.SCENE_PLAYING;

  const isPaused = state.state === AUDIO_STATES.PAUSED;

  const isIntroActive = state.state === AUDIO_STATES.INTRO_QUEUED ||
                        state.state === AUDIO_STATES.INTRO_PLAYING;

  const isSceneActive = state.state === AUDIO_STATES.SCENE_QUEUED ||
                        state.state === AUDIO_STATES.SCENE_PLAYING;

  const canPlaySfx = state.state === AUDIO_STATES.SCENE_PLAYING;

  const hasEnded = state.state === AUDIO_STATES.ENDED;

  return {
    // Current state
    audioState: state.state,
    previousState: state.previousState,
    error: state.error,
    metadata: state.metadata,

    // Ref for callback access
    stateRef,

    // Actions
    queueIntro,
    startIntro,
    queueScene,
    startScene,
    endScene,
    pause,
    resume,
    reset,
    setError,

    // Computed values
    isPlaying,
    isPaused,
    isIntroActive,
    isSceneActive,
    canPlaySfx,
    hasEnded,

    // Constants for comparison
    STATES: AUDIO_STATES
  };
}

export default useAudioStateMachine;
