/**
 * usePlaybackControls Hook
 * Manages story playback controls for Story.jsx
 * Handles continue, pause, text-only mode, and scene jumping
 */

import { useState, useCallback } from 'react';
import { stripAllTags } from '../utils/textUtils';

/**
 * @param {Object} options
 * @param {Object} options.socket - Socket.io socket instance
 * @param {string} options.sessionId - Current story session ID
 * @param {Object} options.session - Current session data
 * @param {Object} options.launchSequence - Launch sequence hook return values
 * @param {Object} options.audioContext - Audio context from useAudio
 * @param {Object} options.sfxContext - SFX context (sfxEnabled, sfxDetails, playSfxWithState)
 * @param {Object} options.stateSetters - State setter functions
 */
export function usePlaybackControls({
  socket,
  sessionId,
  session,
  launchSequence,
  audioContext,
  sfxContext,
  stateSetters
}) {
  const {
    resetLaunch,
    triggerPlayback,
    cancelLaunch,
    autoplayEnabled,
    launchScene,
    sfxDetails
  } = launchSequence;

  const { stop, pause, resume, isPlaying, isPaused } = audioContext;
  const { sfxEnabled, playSfxWithState, stopAllSfx } = sfxContext;

  const {
    setWordTimings,
    setSceneAudioStarted,
    sceneAudioStartedRef,
    setSceneAudioQueued,
    setIntroAudioQueued,
    setIsGenerating,
    setGenerationProgress,
    setCurrentScene,
    setChoices,
    setPendingChoices,
    setShowText,
    isGenerating // Destructure for stable dependency reference
  } = stateSetters;

  // Track if user manually clicked Next (disable autoplay for this generation)
  const [manualContinue, setManualContinue] = useState(false);

  // Start playback after countdown - uses launch sequence hook
  const handleStartPlayback = useCallback(() => {
    if (!socket || !sessionId) return;

    console.log('[Story] Starting playback via launch sequence...');
    setManualContinue(false); // Reset manual continue flag - user clicked Begin Chapter
    triggerPlayback();
    // SFX is NOT triggered here - it triggers when wordTimings change (scene audio ready)
  }, [socket, sessionId, triggerPlayback]);

  // Cancel playback - uses launch sequence hook
  const handleCancelPlayback = useCallback(() => {
    console.log('[Story] Cancelling launch sequence...');
    cancelLaunch();
  }, [cancelLaunch]);

  // Text-only mode - skip audio generation, just show text
  const handleStartTextOnly = useCallback(() => {
    console.log('[Story] Starting text-only mode (no audio)...');

    // Enable text display
    setShowText(true);

    // Set the current scene from launch scene data
    if (launchScene) {
      setCurrentScene({
        ...launchScene,
        text: stripAllTags(launchScene.polished_text || launchScene.text || launchScene.summary),
      });
    }

    // Play SFX if enabled (SFX can still play in text mode)
    if (sfxEnabled && sfxDetails?.sfxList?.length > 0) {
      console.log('[SFX] TRIGGER_SUCCESS | source: text_only_mode | effects:', sfxDetails.sfxList.length, '| keys:', sfxDetails.sfxList.map(s => s.sfx_key || s.sfxKey));
      playSfxWithState(sfxDetails.sfxList);
    } else {
      console.log('[SFX] TRIGGER_SKIPPED | source: text_only_mode | enabled:', sfxEnabled, '| sfxList:', sfxDetails?.sfxList?.length || 0);
    }

    // Reset launch state to exit the launch screen
    resetLaunch();

    // Mark generation as complete
    setIsGenerating(false);
    setGenerationProgress({ step: 0, percent: 0, message: '' });
  }, [launchScene, sfxEnabled, sfxDetails, playSfxWithState, resetLaunch, setCurrentScene, setShowText, setIsGenerating, setGenerationProgress]);

  // Continue story with specific voice
  const continueStoryWithVoice = useCallback((voiceId) => {
    if (socket && !isGenerating) {
      console.log('[Audio] STATE: * → IDLE | reason: continue_story_reset | resetting all audio flags');
      // Reset launch sequence state for new scene
      resetLaunch();
      // Reset word timings for new scene
      setWordTimings(null);
      // Reset SFX trigger flags for new scene
      setSceneAudioStarted(false);
      if (sceneAudioStartedRef) sceneAudioStartedRef.current = false;
      setSceneAudioQueued(false);
      setIntroAudioQueued(false);

      console.log('[Socket:Emit] EVENT: continue-story | session_id:', sessionId, '| voice_id:', voiceId, '| autoplay:', autoplayEnabled);
      socket.emit('continue-story', {
        session_id: sessionId,
        voice_id: voiceId,
        autoplay: autoplayEnabled
      });
      setIsGenerating(true);
    }
  }, [socket, sessionId, autoplayEnabled, resetLaunch, setWordTimings, setSceneAudioStarted, sceneAudioStartedRef, setSceneAudioQueued, setIntroAudioQueued, setIsGenerating, isGenerating]);

  // Manual continue - called when user clicks Next button (should show Begin Chapter X)
  const continueStory = useCallback(() => {
    setManualContinue(true); // Disable autoplay for this generation - user must click Begin Chapter
    const voiceId = session?.config_json?.voice_id || session?.config_json?.narratorVoice;
    continueStoryWithVoice(voiceId);
  }, [session, continueStoryWithVoice]);

  // Auto-continue - called by useAutoContinue hook (respects autoplay setting)
  const continueStoryAuto = useCallback(() => {
    setManualContinue(false); // Auto-continue respects autoplay setting
    const voiceId = session?.config_json?.voice_id || session?.config_json?.narratorVoice;
    continueStoryWithVoice(voiceId);
  }, [session, continueStoryWithVoice]);

  // Jump to a specific scene/chapter (for chapter selector)
  const jumpToScene = useCallback((chapterNumber, allScenes) => {
    // chapterNumber is 1-based, scene_index is 0-based
    const targetIndex = chapterNumber - 1;
    const targetScene = allScenes.find(s => s.sequence_index === targetIndex);

    if (!targetScene) {
      console.warn(`[Story] Scene ${chapterNumber} not found in allScenes`);
      return;
    }

    console.log(`[Story] Jumping to scene ${chapterNumber} (index ${targetIndex})`);

    // Stop current audio and SFX
    stop();
    stopAllSfx();

    // Reset audio state
    setWordTimings(null);
    setSceneAudioStarted(false);
    if (sceneAudioStartedRef) sceneAudioStartedRef.current = false;
    setSceneAudioQueued(false);
    setIntroAudioQueued(false);

    // Set the target scene as current
    setCurrentScene({
      text: stripAllTags(targetScene.polished_text || targetScene.summary),
      mood: targetScene.mood,
      scene_id: targetScene.id,
      scene_index: targetScene.sequence_index
    });

    // Clear any pending choices (they belong to the previous scene)
    setChoices([]);
    setPendingChoices([]);
  }, [stop, stopAllSfx, setWordTimings, setSceneAudioStarted, sceneAudioStartedRef, setSceneAudioQueued, setIntroAudioQueued, setCurrentScene, setChoices, setPendingChoices]);

  // Toggle pause/resume
  const togglePause = useCallback(() => {
    if (isPlaying) socket?.emit('pause-story', { session_id: sessionId });
    else if (isPaused) socket?.emit('resume-story', { session_id: sessionId });
  }, [isPlaying, isPaused, socket, sessionId]);

  return {
    // State
    manualContinue,
    setManualContinue,

    // Handlers
    handleStartPlayback,
    handleCancelPlayback,
    handleStartTextOnly,
    continueStory,
    continueStoryAuto,
    continueStoryWithVoice,
    jumpToScene,
    togglePause
  };
}

export default usePlaybackControls;
