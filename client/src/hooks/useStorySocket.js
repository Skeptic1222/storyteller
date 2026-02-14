/**
 * useStorySocket Hook
 * Handles all Socket.IO event subscriptions for the Story page.
 * Encapsulates audio-ready, choice handling, and error recovery logic.
 *
 * Extracted from Story.jsx for maintainability.
 */

import { useEffect, useRef } from 'react';
import { audioLog, socketLog, sfxLog } from '../utils/clientLogger';

/**
 * @param {object} options
 * @param {object} options.socket - Socket.IO socket instance
 * @param {string} options.sessionId - Current session ID
 * @param {object} options.session - Session data
 * @param {object} options.audioContext - Audio context from useAudio hook
 * @param {object} options.sfxContext - SFX context (playSfxWithState, sfxEnabledRef, sfxDetailsRef)
 * @param {object} options.stateSetters - State setter functions
 * @param {object} options.refs - Ref objects (sceneAudioStartedRef)
 * @param {object} options.callbacks - Callback functions (continueStory, resetLaunch)
 * @param {array} options.pendingChoices - Current pending choices
 * @param {boolean} options.launchActive - Whether launch sequence is active
 */

export function useStorySocket({
  socket,
  sessionId,
  session,
  audioContext,
  sfxContext,
  stateSetters,
  refs,
  callbacks,
  pendingChoices,
  launchActive
}) {
  const { playAudio, queueAudio, pause, resume } = audioContext;
  const { playSfxWithState, sfxEnabledRef, sfxDetailsRef, stopAllSfx } = sfxContext;
  const {
    setIntroAudioQueued,
    setSceneAudioStarted,
    setWordTimings,
    setSceneImages,
    setSceneAudioQueued,
    setIsAudioQueued,
    setChoiceAudioPlaying,
    setChoices,
    setPendingChoices,
    setIsGenerating,
    setGenerationProgress,
    setChoiceHistory,
    setAudioError,
    setStoryEnded // P0 FIX: Accept setStoryEnded for story completion handling
  } = stateSetters;
  const { sceneAudioStartedRef } = refs;
  const { continueStory, resetLaunch } = callbacks;

  // P0 FIX: Use refs instead of module-level variables for stall detection
  // This prevents cross-session interference when multiple sessions exist
  const lastProgressUpdateTimeRef = useRef(0);
  const stallDetectionTimeoutRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    // Handle intro audio (title/synopsis narration) - QUEUE instead of play immediately
    // This ensures intro plays fully before scene audio starts
    const handleIntroAudioReady = (data) => {
      socketLog.info(`RECV: intro-audio-ready | hasAudio: ${!!data.audio} | format: ${data.format} | bytes: ${data.audio?.length || 0}`);
      audioLog.info('STATE: IDLE → INTRO_QUEUED | introAudioQueued=true');
      setIntroAudioQueued(true);
      setSceneAudioStarted(false);
      // CRITICAL: Also reset the ref so scene audio onStart callback can fire
      sceneAudioStartedRef.current = false;
      // Use onStart to log when intro begins, onEnd to clear flag when intro finishes
      queueAudio(
        data.audio,
        data.format,
        // onStart callback
        () => {
          audioLog.info('STATE: INTRO_QUEUED → INTRO_PLAYING | intro audio started');
        },
        // onEnd callback - CRITICAL: clear introAudioQueued when intro finishes
        () => {
          audioLog.info('STATE: INTRO_PLAYING → INTRO_COMPLETE | introAudioQueued=false');
          setIntroAudioQueued(false);
        }
      );
    };

    // Handle scene audio - QUEUE to ensure it plays after intro finishes
    const handleAudioReady = (data) => {
      socketLog.info(`RECV: audio-ready | hasTimings: ${!!data.wordTimings} | wordCount: ${data.wordTimings?.words?.length || 0} | bytes: ${data.audio?.length || 0} | images: ${data.sceneImages?.length || 0}`);

      // Clear stall detection since we got audio (generation succeeded)
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
        stallDetectionTimeoutRef.current = null;
      }

      // Store word timings for karaoke/read-along feature
      if (data.wordTimings) {
        const wordCount = data.wordTimings.words?.length || data.wordTimings.word_count || 0;
        const totalDuration = data.wordTimings.total_duration_ms || 0;
        audioLog.info(`WORD_TIMINGS_DEBUG | type: ${typeof data.wordTimings} | count: ${wordCount} | has_words_array: ${!!data.wordTimings.words} | total_duration_ms: ${totalDuration}`);
        if (data.wordTimings.words && data.wordTimings.words.length > 0) {
          const firstWord = data.wordTimings.words[0];
          audioLog.info(`WORD_TIMINGS_FIRST | text: "${firstWord.text}" | start_ms: ${firstWord.start_ms} | end_ms: ${firstWord.end_ms}`);
        }
        setWordTimings(data.wordTimings);
      } else {
        audioLog.info('WORD_TIMINGS_DEBUG | none provided - data.wordTimings is null/undefined');
        setWordTimings(null);
      }

      // Store scene images for picture book display
      if (data.sceneImages && data.sceneImages.length > 0) {
        audioLog.info(`SCENE_IMAGES | count: ${data.sceneImages.length}`);
        setSceneImages(data.sceneImages);
      } else {
        setSceneImages([]);
      }

      audioLog.info('STATE: * → SCENE_QUEUED | sceneAudioQueued=true');
      setSceneAudioQueued(true);

      // Queue with onStart callback to trigger SFX when scene audio starts
      queueAudio(
        data.audio,
        data.format,
        // onStart callback - scene audio begins
        () => {
          audioLog.info('STATE: SCENE_QUEUED → SCENE_PLAYING | sceneAudioStarted=true (onStart callback)');

          if (!sceneAudioStartedRef.current) {
            sceneAudioStartedRef.current = true;
            setSceneAudioStarted(true);
            setIsAudioQueued(false);

            // Trigger SFX with actual audio duration for accurate timing
            const currentSfxList = sfxDetailsRef.current?.sfxList;
            const audioDurationSeconds = data.wordTimings?.total_duration_ms
              ? data.wordTimings.total_duration_ms / 1000
              : null;
            if (currentSfxList && currentSfxList.length > 0 && sfxEnabledRef.current) {
              sfxLog.info(`TRIGGER_SUCCESS | source: onStart_callback | effects: ${currentSfxList.length} | audioDuration: ${audioDurationSeconds}s | keys: ${currentSfxList.map(s => s.sfx_key || s.sfxKey).join(', ')}`);
              playSfxWithState(currentSfxList, audioDurationSeconds);
            } else {
              sfxLog.info(`TRIGGER_SKIPPED | source: onStart_callback | enabled: ${sfxEnabledRef.current} | sfxList: ${currentSfxList?.length || 0}`);
            }
          } else {
            // FAIL LOUDLY - this should never happen
            console.warn('[StorySocket] WARNING: onStart called but sceneAudioStarted already true!');
            sfxLog.warn('TRIGGER_SKIPPED | source: onStart_callback | reason: already_started (unexpected state!)');
          }
        },
        // onEnd callback - scene audio finished
        () => {
          audioLog.info('STATE: SCENE_PLAYING → SCENE_COMPLETE | scene audio finished');
        }
      );
    };

    // Bug 3 Fix: Handle unified all-audio-ready event (intro + scene together)
    // This ensures single progress bar and no premature synopsis playback
    const handleAllAudioReady = (data) => {
      socketLog.info(`RECV: all-audio-ready | hasIntro: ${!!data.intro} | hasScene: ${!!data.scene}`);

      // Clear stall detection since we got audio (generation succeeded)
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
        stallDetectionTimeoutRef.current = null;
      }

      // Queue intro audio first (if present)
      if (data.intro) {
        audioLog.info('STATE: IDLE → INTRO_QUEUED | introAudioQueued=true (from all-audio-ready)');
        setIntroAudioQueued(true);
        setSceneAudioStarted(false);
        sceneAudioStartedRef.current = false;
        queueAudio(
          data.intro.audio,
          data.intro.format,
          () => { audioLog.info('STATE: INTRO_QUEUED → INTRO_PLAYING | intro audio started'); },
          () => {
            audioLog.info('STATE: INTRO_PLAYING → INTRO_COMPLETE | introAudioQueued=false');
            setIntroAudioQueued(false);
          }
        );
      }

      // Queue scene audio (if present)
      if (data.scene) {
        // Store word timings for karaoke/read-along feature
        if (data.scene.wordTimings) {
          const wordCount = data.scene.wordTimings.words?.length || data.scene.wordTimings.word_count || 0;
          audioLog.info(`WORD_TIMINGS_DEBUG (all-audio-ready) | count: ${wordCount}`);
          setWordTimings(data.scene.wordTimings);
        } else {
          setWordTimings(null);
        }

        // Store scene images for picture book display
        if (data.scene.sceneImages && data.scene.sceneImages.length > 0) {
          setSceneImages(data.scene.sceneImages);
        } else {
          setSceneImages([]);
        }

        audioLog.info('STATE: * → SCENE_QUEUED | sceneAudioQueued=true (from all-audio-ready)');
        setSceneAudioQueued(true);

        queueAudio(
          data.scene.audio,
          data.scene.format,
          // onStart callback - scene audio begins
          () => {
            audioLog.info('STATE: SCENE_QUEUED → SCENE_PLAYING | sceneAudioStarted=true (all-audio-ready onStart)');
            if (!sceneAudioStartedRef.current) {
              sceneAudioStartedRef.current = true;
              setSceneAudioStarted(true);
              setIsAudioQueued(false);

              // Trigger SFX with actual audio duration for accurate timing
              const currentSfxList = sfxDetailsRef.current?.sfxList;
              const audioDurationSeconds = data.scene.wordTimings?.total_duration_ms
                ? data.scene.wordTimings.total_duration_ms / 1000
                : null;
              if (currentSfxList && currentSfxList.length > 0 && sfxEnabledRef.current) {
                sfxLog.info(`TRIGGER_SUCCESS | source: all-audio-ready | effects: ${currentSfxList.length}`);
                playSfxWithState(currentSfxList, audioDurationSeconds);
              }
            }
          },
          // onEnd callback - scene audio finished
          () => {
            audioLog.info('STATE: SCENE_PLAYING → SCENE_COMPLETE | scene audio finished (all-audio-ready)');
          }
        );
      }
    };

    // Handle choice narration audio
    const handleChoiceAudioReady = (data) => {
      console.log('[Socket:Recv] EVENT: choice-audio-ready | hasAudio:', !!data.audio, '| format:', data.format);
      setChoiceAudioPlaying(true);
      playAudio(data.audio, data.format)
        .then(() => {
          console.log('[Story] Choice audio playback started');
        })
        .catch(err => {
          console.error('[Story] Choice audio playback failed:', err);
          if (pendingChoices.length > 0) {
            setChoices(pendingChoices);
            setPendingChoices([]);
          }
          setChoiceAudioPlaying(false);
        });
    };

    // Handle choice audio error - show choices immediately without audio
    const handleChoiceAudioError = (data) => {
      console.warn('[Socket:Recv] EVENT: choice-audio-error | message:', data?.message);
      if (pendingChoices.length > 0) {
        setChoices(pendingChoices);
        setPendingChoices([]);
      }
      setChoiceAudioPlaying(false);
    };

    // Handle generation progress
    const handleGenerating = (data) => {
      console.log('[Socket:Recv] EVENT: generating | step:', data?.step, '| percent:', data?.percent, '| message:', data?.message?.substring(0, 40));

      // HEARTBEAT: Reset stall detection timer on every progress update
      lastProgressUpdateTimeRef.current = Date.now();
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
      }

      setIsGenerating(true);
      if (data && typeof data === 'object') {
        setGenerationProgress({
          step: data.step || 0,
          percent: data.percent || 0,
          message: data.message || 'Creating your story...',
          // Bug 1 Fix: Include server startTime so timer survives page refresh
          startTime: data.startTime || null
        });
      }

      // STALL DETECTION: Set timeout to detect if no update arrives for 5 minutes
      // Complex stories with many characters can take 3-5 minutes for scene generation + validation
      stallDetectionTimeoutRef.current = setTimeout(() => {
        const timeSinceLastUpdate = Date.now() - lastProgressUpdateTimeRef.current;
        if (timeSinceLastUpdate > 300000) { // 5 minutes
          console.error('[Stall Detection] No progress update for 5+ minutes. Generation may be stuck.');
          setIsGenerating(false);
          setGenerationProgress({ step: 0, percent: 0, message: '' });
          setAudioError('Story generation is taking too long. Please refresh the page and try again.');
        }
      }, 305000); // Check after 5 min + 5 seconds
    };

    // P1 FIX: Handle launch progress - reset stall detection during launch phase
    // During launch, the server emits 'launch-progress' events, not 'generating' events
    // Without this, stall detection timer never resets and causes false timeout errors
    const handleLaunchProgress = () => {
      // Reset stall detection timer on launch progress (same logic as handleGenerating)
      lastProgressUpdateTimeRef.current = Date.now();
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
      }
      // Set new timeout - reuses same stall detection logic (5 minute timeout)
      stallDetectionTimeoutRef.current = setTimeout(() => {
        const timeSinceLastUpdate = Date.now() - lastProgressUpdateTimeRef.current;
        if (timeSinceLastUpdate > 300000) { // 5 minutes
          console.error('[Stall Detection] No progress update for 5+ minutes during launch.');
          setIsGenerating(false);
          setGenerationProgress({ step: 0, percent: 0, message: '' });
          setAudioError('Story generation is taking too long. Please refresh the page and try again.');
        }
      }, 305000); // Check after 5 min + 5 seconds
    };

    // Handle choice accepted
    const handleChoiceAccepted = (data) => {
      console.log('[Socket:Recv] EVENT: choice-accepted | choice_key:', data?.choice_key, '| choice_text:', data?.choice_text?.substring(0, 30));
      if (data.choice_key && data.choice_text) {
        setChoiceHistory(prev => [...prev, {
          sceneIndex: session?.total_scenes || 0,
          choiceKey: data.choice_key,
          choiceText: data.choice_text,
          timestamp: Date.now()
        }]);
      }
      setChoices([]);
      continueStory();
    };

    // Handle story paused
    const handleStoryPaused = () => {
      console.log('[Socket:Recv] EVENT: story-paused');
      pause();
    };

    // Handle story resumed
    const handleStoryResumed = () => {
      console.log('[Socket:Recv] EVENT: story-resumed');
      resume();
    };

    // Handle audio error
    const handleAudioError = (data) => {
      console.error('[Socket:Recv] EVENT: audio-error | message:', data?.message);
      // Clear stall detection since we got a response
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
        stallDetectionTimeoutRef.current = null;
      }
      // CRITICAL FIX: Clear generation state so progress bar disappears on audio error
      setIsGenerating(false);
      setGenerationProgress({ step: 0, percent: 0, message: '' });

      const isQuotaError = data.message?.toLowerCase().includes('quota');
      setAudioError(isQuotaError
        ? 'Voice narration unavailable - ElevenLabs credits exhausted. Story text will still display.'
        : 'Voice narration temporarily unavailable. Story text will still display.');
      setTimeout(() => setAudioError(null), 10000);
    };

    // Handle general error
    const handleError = (error) => {
      console.error('[Socket:Recv] EVENT: error | message:', error?.message || error);
      // Clear stall detection since we got a response
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
        stallDetectionTimeoutRef.current = null;
      }

      // Handle "No pending audio" error - happens after server restart
      if (error?.message === 'No pending audio for this session') {
        console.log('[Socket] RECOVERY | reason: no_pending_audio | action: regenerate_scene');
        resetLaunch();
        const voiceId = session?.config_json?.voice_id || session?.config_json?.narratorVoice;
        if (socket && sessionId) {
          console.log('[Socket:Emit] EVENT: continue-story (recovery) | session_id:', sessionId, '| voice_id:', voiceId);
          socket.emit('continue-story', {
            session_id: sessionId,
            voice_id: voiceId,
            autoplay: true
          });
          setIsGenerating(true);
          setGenerationProgress({ step: 1, percent: 10, message: 'Recovering session...' });
        }
        return;
      }

      setIsGenerating(false);
      setGenerationProgress({ step: 0, percent: 0, message: '' });
    };

    // Handle picture book images ready (generated asynchronously after audio)
    const handleSceneImagesReady = (data) => {
      socketLog.info(`RECV: scene-images-ready | sceneId: ${data.sceneId} | images: ${data.sceneImages?.length || 0}`);
      if (data.sceneImages && data.sceneImages.length > 0) {
        audioLog.info(`SCENE_IMAGES | count: ${data.sceneImages.length} (async delivery)`);
        setSceneImages(data.sceneImages);
      }
    };

    // Handle picture book generating status
    const handlePictureBookGenerating = (data) => {
      console.log('[Socket:Recv] EVENT: picture-book-generating | message:', data?.message);
      // Could show a loading indicator for images here if desired
    };

    // P0 FIX: Handle story completion (server signals story has ended)
    const handleStoryCompleted = (data) => {
      console.log('[Socket:Recv] EVENT: story-completed | reason:', data?.reason);
      socketLog.info(`STORY_COMPLETED | reason: ${data?.reason || 'unknown'}`);

      // Set storyEnded to trigger SFX cleanup
      if (setStoryEnded) {
        setStoryEnded(true);
      }

      // Also explicitly stop all SFX as a safety measure
      if (stopAllSfx) {
        stopAllSfx();
      }

      // Clear generation state
      setIsGenerating(false);
      setGenerationProgress({ step: 0, percent: 0, message: '' });
    };

    // Subscribe to events
    socket.on('intro-audio-ready', handleIntroAudioReady);
    socket.on('audio-ready', handleAudioReady);
    socket.on('all-audio-ready', handleAllAudioReady); // Bug 3 Fix: Unified audio event
    socket.on('choice-audio-ready', handleChoiceAudioReady);
    socket.on('choice-audio-error', handleChoiceAudioError);
    socket.on('scene-images-ready', handleSceneImagesReady);
    socket.on('picture-book-generating', handlePictureBookGenerating);
    socket.on('generating', handleGenerating);
    socket.on('launch-progress', handleLaunchProgress); // P1 FIX: Reset stall detection during launch
    socket.on('choice-accepted', handleChoiceAccepted);
    socket.on('story-paused', handleStoryPaused);
    socket.on('story-resumed', handleStoryResumed);
    socket.on('audio-error', handleAudioError);
    socket.on('error', handleError);
    socket.on('story-completed', handleStoryCompleted); // P0 FIX: Listen for story completion

    // Cleanup
    return () => {
      // Clear stall detection timeout on unmount
      if (stallDetectionTimeoutRef.current) {
        clearTimeout(stallDetectionTimeoutRef.current);
        stallDetectionTimeoutRef.current = null;
      }

      socket.off('intro-audio-ready', handleIntroAudioReady);
      socket.off('audio-ready', handleAudioReady);
      socket.off('all-audio-ready', handleAllAudioReady); // Bug 3 Fix: Cleanup unified audio event
      socket.off('choice-audio-ready', handleChoiceAudioReady);
      socket.off('choice-audio-error', handleChoiceAudioError);
      socket.off('scene-images-ready', handleSceneImagesReady);
      socket.off('picture-book-generating', handlePictureBookGenerating);
      socket.off('generating', handleGenerating);
      socket.off('launch-progress', handleLaunchProgress); // P1 FIX: Cleanup launch progress listener
      socket.off('choice-accepted', handleChoiceAccepted);
      socket.off('story-paused', handleStoryPaused);
      socket.off('story-resumed', handleStoryResumed);
      socket.off('audio-error', handleAudioError);
      socket.off('error', handleError);
      socket.off('story-completed', handleStoryCompleted); // P0 FIX: Cleanup story completion listener
    };
  }, [
    socket, sessionId, session,
    playAudio, queueAudio, pause, resume,
    playSfxWithState, sfxEnabledRef, sfxDetailsRef, stopAllSfx,
    setIntroAudioQueued, setSceneAudioStarted, setWordTimings, setSceneImages, setSceneAudioQueued,
    setIsAudioQueued, setChoiceAudioPlaying, setChoices, setPendingChoices,
    setIsGenerating, setGenerationProgress, setChoiceHistory, setAudioError, setStoryEnded,
    sceneAudioStartedRef, continueStory, resetLaunch, pendingChoices, launchActive
  ]);
}

export default useStorySocket;
