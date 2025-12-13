import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Pause, Play, SkipForward, SkipBack, Home, Mic, MicOff, Moon, History, ChevronRight, Bookmark, BookOpen, Info, MapPin, Users, Palette, Volume2, VolumeX, Settings, Image, Maximize2, Minimize2, X, Feather, Save, Disc } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { useAudio } from '../context/AudioContext';
import UserProfile from '../components/UserProfile';
import ChoiceButtons from '../components/ChoiceButtons';
import AudioVisualizer from '../components/AudioVisualizer';
import VoiceSelector from '../components/VoiceSelector';
import ChoiceTree from '../components/ChoiceTree';
import RecordingPlayer from '../components/RecordingPlayer';
import RecordingPrompt from '../components/RecordingPrompt';
import RecoveryPrompt from '../components/RecoveryPrompt';
import DivergenceModal from '../components/DivergenceModal';
import LaunchScreen from '../components/LaunchScreen';
import BookPageLayout from '../components/BookPageLayout';
import { useQAChecks } from '../components/QAChecksPanel';
import { useRecordings } from '../hooks/useRecordings';
import { useLaunchSequence } from '../hooks/useLaunchSequence';
import { apiCall, API_BASE } from '../config';
import { initClientLogger, sfxLog, audioLog, socketLog } from '../utils/clientLogger';
import { stripCharacterTags } from '../utils/textUtils';
// Wake lock removed - was causing screen dimming issues

// Author styles for display - all 40+ authors
const AUTHOR_NAMES = {
  // Modern/Default
  modern: 'Modern Style',
  // Sword & Sorcery
  howard: 'Robert E. Howard', decamp: 'L. Sprague de Camp', carter: 'Lin Carter', moorcock: 'Michael Moorcock',
  // Science Fiction
  asimov: 'Isaac Asimov', leguin: 'Ursula K. Le Guin', heinlein: 'Robert A. Heinlein', herbert: 'Frank Herbert',
  clarke: 'Arthur C. Clarke', bradbury: 'Ray Bradbury', dick: 'Philip K. Dick', butler: 'Octavia Butler', banks: 'Iain M. Banks',
  // Epic Fantasy
  tolkien: 'J.R.R. Tolkien', donaldson: 'Stephen R. Donaldson', sanderson: 'Brandon Sanderson', rothfuss: 'Patrick Rothfuss',
  hobb: 'Robin Hobb', martin: 'George R.R. Martin', jordan: 'Robert Jordan', gaiman: 'Neil Gaiman', pratchett: 'Terry Pratchett',
  // Horror & Gothic
  lovecraft: 'H.P. Lovecraft', king: 'Stephen King', poe: 'Edgar Allan Poe', shelley: 'Mary Shelley', stoker: 'Bram Stoker',
  // Classic Literature
  shakespeare: 'Shakespeare', austen: 'Jane Austen', dickens: 'Charles Dickens', twain: 'Mark Twain',
  // Literary Fiction
  hemingway: 'Ernest Hemingway', fitzgerald: 'F. Scott Fitzgerald', steinbeck: 'John Steinbeck',
  // Mythology & Folklore
  mythology: 'Classical Mythology', folklore: 'World Folklore', fairytale: 'Brothers Grimm',
  // Children's & Whimsical
  seuss: 'Dr. Seuss', dahl: 'Roald Dahl', rowling: 'J.K. Rowling', lewis: 'C.S. Lewis'
};

function Story() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { socket, connected, joinSession, leaveSession } = useSocket();
  const { isPlaying, isPaused, playAudio, queueAudio, pause, resume, stop, isUnlocked, hasPendingAudio, volume, setVolume, currentTime, duration } = useAudio();
  const audioUnlockAttempted = useRef(false);

  const [session, setSession] = useState(null);
  const [currentScene, setCurrentScene] = useState(null);
  const [choices, setChoices] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ step: 0, percent: 0, message: '' });
  const [isListening, setIsListening] = useState(false);
  const [showText, setShowText] = useState(true); // Default to showing book view with karaoke
  const [storyEnded, setStoryEnded] = useState(false);
  const [wordTimings, setWordTimings] = useState(null); // For karaoke/read-along text highlighting
  const [currentWordIndex, setCurrentWordIndex] = useState(-1); // Currently highlighted word

  // CYOA checkpoint/history state
  const [choiceHistory, setChoiceHistory] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [showChoiceHistory, setShowChoiceHistory] = useState(false);
  const [isBacktracking, setIsBacktracking] = useState(false);
  const [choiceAudioPlaying, setChoiceAudioPlaying] = useState(false);
  const [pendingChoices, setPendingChoices] = useState([]); // Choices waiting for audio

  // Story Info panel state
  const [showStoryInfo, setShowStoryInfo] = useState(false);
  const [storyOutline, setStoryOutline] = useState(null);
  const [characters, setCharacters] = useState([]);

  // Settings panel state
  const [showSettings, setShowSettings] = useState(false);

  // Cover state
  const [coverUrl, setCoverUrl] = useState(null);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [showCoverFullscreen, setShowCoverFullscreen] = useState(false);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [audioError, setAudioError] = useState(null); // For displaying audio generation errors

  // SFX state
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [activeSfx, setActiveSfx] = useState([]);
  const sfxAudioRefs = useRef(new Map());
  const sfxBlobUrls = useRef(new Set());
  const sfxAbortController = useRef(null); // AbortController for cancelling in-flight SFX fetches
  const sfxGenerationId = useRef(0); // Monotonic ID to detect stale SFX operations
  const prevWordTimingsRef = useRef(null); // Track wordTimings changes for SFX timing
  const [sceneAudioStarted, setSceneAudioStarted] = useState(false); // Track when scene audio actually starts playing
  const sceneAudioStartedRef = useRef(false); // Ref version for callback access (avoids stale closure)
  const sfxDetailsRef = useRef(null); // Ref version of sfxDetails for callback access
  const sfxEnabledRef = useRef(true); // Ref version of sfxEnabled for callback access
  const currentTimeRef = useRef(0); // Ref for karaoke polling (avoids effect re-runs on timeupdate)
  const [introAudioQueued, setIntroAudioQueued] = useState(false); // Track if intro (synopsis) was queued
  const [sceneAudioQueued, setSceneAudioQueued] = useState(false); // Track if scene audio was queued (for SFX trigger)

  // Recording playback state
  const [showRecordingPrompt, setShowRecordingPrompt] = useState(false);
  const [showRecordingPlayer, setShowRecordingPlayer] = useState(false);
  const [showDivergenceModal, setShowDivergenceModal] = useState(false);
  const [divergenceChoice, setDivergenceChoice] = useState(null);
  const [foundRecording, setFoundRecording] = useState(null);

  // Recording hook - manages detection, playback, and CYOA path tracking
  const {
    recordings,
    activeRecording,
    segments: recordingSegments,
    isLoading: recordingLoading,
    isPlayingRecording,
    hasRecording,
    recoveryInfo,
    showRecoveryPrompt,
    availableRecordedChoices,
    loadRecording,
    startRecordingPlayback,
    stopRecordingPlayback,
    handleRecordedChoice,
    refreshAvailableChoices,
    resumeRecording,
    dismissRecovery
  } = useRecordings(sessionId, {
    autoCheckOnMount: true,
    checkForRecovery: true,
    onRecordingFound: (recording) => {
      console.log('[Story] Recording found:', recording.id);
      setFoundRecording(recording);
      setShowRecordingPrompt(true);
    },
    onDiverge: (choiceKey, segmentIndex) => {
      console.log('[Story] DIVERGE | segmentIndex:', segmentIndex, '| choiceKey:', choiceKey);
      setShowRecordingPlayer(false);
      // Continue with live generation
      if (socket) {
        console.log('[Socket:Emit] EVENT: submit-choice (diverge) | session_id:', sessionId, '| choice_key:', choiceKey, '| diverge_at_segment:', segmentIndex);
        socket.emit('submit-choice', {
          session_id: sessionId,
          choice_key: choiceKey,
          from_recording: true,
          diverge_at_segment: segmentIndex
        });
      }
    }
  });

  // Launch sequence hook - manages pre-narration validation and countdown
  const {
    isActive: launchActive,
    stageStatuses,
    stageDetails,
    isReady: launchReady,
    stats: launchStats,
    scene: launchScene,
    error: launchError,
    warnings: launchWarnings,
    isCountdownActive,
    countdownPhase,
    countdownValue,
    isReadyToPlay,
    autoplayEnabled,
    setAutoplayEnabled,
    allStagesComplete,
    hasError: launchHasError,
    currentStage,
    startCountdown,
    cancelCountdown,
    cancel: cancelLaunch,
    startPlayback: triggerPlayback,
    reset: resetLaunch,
    // Retry and regeneration
    retryingStage,
    canRetryStages,
    retryStage,
    isRegeneratingCover,
    regenerateCover,
    // Additional regeneration
    isRegeneratingSynopsis,
    regenerateSynopsis,
    isRegeneratingSfx,
    regenerateSfx,
    isRegeneratingVoices,
    regenerateVoices,
    // HUD data
    agents,
    usage,
    characterVoices,
    voiceSummary,
    sfxDetails,
    qaChecks,
    coverProgress,
    safetyReport,
    detailedProgressLog,
    // Helper functions
    formatCost,
    formatTokens,
    formatCharacters
  } = useLaunchSequence(socket, sessionId, {
    countdownDuration: 5,
    autoCountdown: false, // Disabled to let user review HUD and optionally regenerate before starting
    onReady: (data) => {
      console.log('[Story] Launch sequence ready:', data);
      // Update session info from launch sequence
      if (data.stats) {
        setSession(prev => ({
          ...prev,
          title: data.stats.title || prev?.title,
          synopsis: data.stats.synopsis || prev?.synopsis,
          cover_image_url: data.stats.coverArtUrl || prev?.cover_image_url
        }));
        if (data.stats.coverArtUrl) {
          setCoverUrl(data.stats.coverArtUrl);
        }
      }
      // Update current scene from launch data
      if (data.scene) {
        setCurrentScene({
          ...data.scene,
          scene_id: data.scene.id
        });
        // Store pending choices
        if (data.scene.choices && data.scene.choices.length > 0) {
          setPendingChoices(data.scene.choices);
          setChoices([]);
        }
      }
      setIsGenerating(false);
      setGenerationProgress({ step: 0, percent: 0, message: '' });
    },
    onCountdownComplete: () => {
      console.log('[Story] Countdown complete');
      // If autoplay is enabled, playback will start automatically via the hook
    },
    onError: (data) => {
      console.error('[Story] Launch sequence error:', data);
      setAudioError(data.error || 'Launch sequence failed');
      setIsGenerating(false);
    }
  });

  // QA checks hook - bridges socket events to QAChecksPanel
  useQAChecks(socket);

  // Initialize client logger when socket is available
  useEffect(() => {
    if (socket) {
      initClientLogger(socket);
      socketLog.info('CLIENT_LOGGER_INIT | page: Story.jsx');
    }
  }, [socket]);

  // CYOA auto-continue ref (must be declared before useEffects that reference it)
  const pendingAutoContinue = useRef(false);
  const wasPlayingRef = useRef(false); // Track previous isPlaying for auto-continue
  const autoContinueTimerRef = useRef(null); // Timer ID for auto-continue to prevent race conditions
  const autoContinueLockRef = useRef(false); // Lock to prevent multiple simultaneous continues

  // CYOA settings from config - memoized for performance
  const cyoaSettings = useMemo(() => session?.config_json?.cyoa_settings || {
    auto_checkpoint: true,
    show_choice_history: true,
    allow_backtrack: true,
    structure_type: 'diamond',
    max_branches: 3
  }, [session?.config_json?.cyoa_settings]);

  const isCyoaEnabled = useMemo(() =>
    session?.config_json?.cyoa_enabled || session?.config_json?.story_type === 'cyoa',
    [session?.config_json?.cyoa_enabled, session?.config_json?.story_type]
  );

  // SFX Management Functions
  // Keep refs in sync with state for callback access (avoids stale closure issues)
  useEffect(() => {
    sfxDetailsRef.current = sfxDetails;
  }, [sfxDetails]);

  useEffect(() => {
    sfxEnabledRef.current = sfxEnabled;
  }, [sfxEnabled]);

  useEffect(() => {
    sceneAudioStartedRef.current = sceneAudioStarted;
  }, [sceneAudioStarted]);

  const stopAllSfx = useCallback(() => {
    // Abort any in-flight SFX fetches
    if (sfxAbortController.current) {
      sfxAbortController.current.abort();
      sfxAbortController.current = null;
    }
    // Increment generation ID to invalidate any pending SFX operations
    sfxGenerationId.current += 1;

    // Stop and cleanup all playing audio
    sfxAudioRefs.current.forEach((audio, key) => {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
        audio.load(); // Force release of audio resources
      } catch (e) {
        console.warn('[SFX] Error stopping:', key, e);
      }
    });
    sfxAudioRefs.current.clear();

    // Revoke all blob URLs to prevent memory leaks
    sfxBlobUrls.current.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    });
    sfxBlobUrls.current.clear();
    setActiveSfx([]);
    sfxLog.info('STOP_ALL | all SFX stopped and cleaned up');
  }, []);

  /**
   * Play sound effects - ONLY during actual story narration
   * SFX should NOT play during title/synopsis intro audio
   * This is triggered by the onStart callback when scene audio begins (not intro)
   */
  const playSfx = useCallback(async (sfxList) => {
    // Comprehensive logging for SFX trigger decisions
    const logSfxState = () => `introAudioQueued: ${introAudioQueued} | sceneAudioStarted: ${sceneAudioStartedRef.current}`;

    if (!sfxEnabled || !sfxList || sfxList.length === 0) {
      sfxLog.info(`TRIGGER_SKIPPED | reason: ${!sfxEnabled ? 'disabled' : 'empty_list'} | enabled: ${sfxEnabled} | sfxList: ${sfxList?.length || 0}`);
      return;
    }

    // Additional guard: Don't play SFX if intro audio is still queued/playing
    // This ensures SFX only plays during actual story narration, not title/synopsis
    if (introAudioQueued && !sceneAudioStartedRef.current) {
      sfxLog.info(`TRIGGER_BLOCKED | reason: intro_audio_active | ${logSfxState()}`);
      return;
    }

    sfxLog.info(`TRIGGER_ACCEPTED | effects: ${sfxList.length} | ${logSfxState()} | keys: ${sfxList.map(s => s.sfx_key || s.sfxKey).join(', ')}`);

    // Stop any existing SFX and abort in-flight fetches
    stopAllSfx();

    // Create new AbortController for this batch of SFX
    const abortController = new AbortController();
    sfxAbortController.current = abortController;

    // Capture the current generation ID to detect if we should abort
    const currentGenerationId = sfxGenerationId.current;

    const newActiveSfx = [];

    // Process SFX sequentially to avoid rate limiting
    for (const sfx of sfxList) {
      // Check if this operation has been superseded
      if (abortController.signal.aborted || sfxGenerationId.current !== currentGenerationId) {
        sfxLog.info('ABORTED | reason: scene_changed');
        break;
      }

      try {
        const sfxKey = sfx.sfx_key || sfx.sfxKey || sfx.key;
        if (!sfxKey) {
          sfxLog.warn('MISSING_KEY | sfx object has no sfx_key');
          continue;
        }

        const sfxVolume = sfx.volume || 0.3;
        const isLooping = sfx.is_looping ?? sfx.definition?.loop ?? sfx.loop ?? false;

        sfxLog.info(`FETCH_START | key: ${sfxKey} | volume: ${sfxVolume} | loop: ${isLooping}`);
        const response = await fetch(`${API_BASE}/sfx/ambient`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sfx_key: sfxKey }),
          signal: abortController.signal
        });

        // Check again after fetch completes
        if (sfxGenerationId.current !== currentGenerationId) {
          sfxLog.info('DISCARD_STALE | reason: generation_id_mismatch');
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          sfxLog.error(`FETCH_FAILED | key: ${sfxKey} | status: ${response.status} | error: ${errorText}`);
          continue;
        }

        const audioBlob = await response.blob();
        sfxLog.info(`FETCH_SUCCESS | key: ${sfxKey} | bytes: ${audioBlob.size}`);

        // Final check before creating audio element
        if (sfxGenerationId.current !== currentGenerationId) {
          sfxLog.info('DISCARD_STALE | reason: generation_id_mismatch_post_blob');
          continue;
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        sfxBlobUrls.current.add(audioUrl);

        const audio = new Audio(audioUrl);
        audio.volume = 0;
        audio.loop = isLooping;
        const targetVolume = Math.min(Math.max(sfxVolume, 0), 1);

        // Use a promise to ensure audio loads
        await new Promise((resolve) => {
          const onCanPlay = () => {
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('error', onError);

            // Check one more time before playing
            if (sfxGenerationId.current !== currentGenerationId) {
              sfxLog.info('ABORT_PLAYBACK | reason: scene_changed_pre_play');
              URL.revokeObjectURL(audioUrl);
              sfxBlobUrls.current.delete(audioUrl);
              resolve();
              return;
            }

            audio.play().then(() => {
              sfxLog.info(`PLAYING | key: ${sfxKey} | loop: ${isLooping}`);
              // Fade in
              let currentVol = 0;
              const fadeInterval = setInterval(() => {
                // Stop fade if generation changed
                if (sfxGenerationId.current !== currentGenerationId) {
                  clearInterval(fadeInterval);
                  return;
                }
                currentVol += targetVolume / 20;
                if (currentVol >= targetVolume) {
                  audio.volume = targetVolume;
                  clearInterval(fadeInterval);
                } else {
                  audio.volume = currentVol;
                }
              }, 100);
              resolve();
            }).catch(err => {
              sfxLog.warn(`PLAYBACK_FAILED | key: ${sfxKey} | error: ${err.message}`);
              resolve();
            });
          };
          const onError = (e) => {
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('error', onError);
            sfxLog.error(`LOAD_ERROR | key: ${sfxKey} | error: ${e.type || 'unknown'}`);
            resolve();
          };
          audio.addEventListener('canplaythrough', onCanPlay, { once: true });
          audio.addEventListener('error', onError, { once: true });
          audio.load();

          // Timeout fallback
          setTimeout(() => resolve(), 5000);
        });

        // Only track if still valid generation
        if (sfxGenerationId.current === currentGenerationId) {
          sfxAudioRefs.current.set(sfxKey, audio);
          newActiveSfx.push({
            key: sfxKey,
            name: sfx.definition?.prompt?.substring(0, 30) || sfxKey.split('.')[1]?.replace(/_/g, ' ') || sfxKey,
            isLooping
          });
        }

        // Small delay between SFX to avoid overwhelming
        await new Promise(r => setTimeout(r, 100));

      } catch (error) {
        // Ignore abort errors
        if (error.name === 'AbortError') {
          sfxLog.info(`FETCH_ABORTED | key: ${sfx.sfx_key || sfx.sfxKey}`);
        } else {
          sfxLog.error(`ERROR | key: ${sfx.sfx_key || sfx.sfxKey} | error: ${error.message}`);
        }
      }
    }

    // Only update state if still the current generation
    if (sfxGenerationId.current === currentGenerationId) {
      sfxLog.info(`ACTIVE_EFFECTS | count: ${newActiveSfx.length} | keys: ${newActiveSfx.map(s => s.key).join(', ')}`);
      setActiveSfx(newActiveSfx);
    }
  }, [sfxEnabled, stopAllSfx, introAudioQueued]);

  const toggleSfx = useCallback(() => {
    if (sfxEnabled) stopAllSfx();
    setSfxEnabled(prev => !prev);
  }, [sfxEnabled, stopAllSfx]);

  // Auto-save progress periodically
  useEffect(() => {
    if (!session?.id || !currentScene) return;

    const saveProgress = async () => {
      try {
        await apiCall(`/library/${session.id}/progress`, {
          method: 'POST',
          body: JSON.stringify({
            scene_id: currentScene.scene_id || null,
            scene_index: session.total_scenes || 0,
            reading_time: 30 // approximate 30 seconds per check
          })
        });
        setLastSaved(new Date());
      } catch (err) {
        console.warn('[Save] Failed to save progress:', err);
      }
    };

    const interval = setInterval(saveProgress, 30000); // Save every 30 seconds
    return () => clearInterval(interval);
  }, [session?.id, currentScene]);

  // Wake lock removed - was causing screen dimming issues

  // Join session on mount
  useEffect(() => {
    if (connected && sessionId && socket) {
      const handleSessionJoined = (data) => {
        console.log('Session joined:', data);
        fetchSession();
      };
      socket.on('session-joined', handleSessionJoined);
      joinSession(sessionId);
      return () => socket.off('session-joined', handleSessionJoined);
    }
  }, [connected, sessionId, socket]);

  // Set autoplay from session config when session loads
  useEffect(() => {
    if (session?.config_json?.autoplay !== undefined) {
      console.log('[Story] Setting autoplay from config:', session.config_json.autoplay);
      setAutoplayEnabled(session.config_json.autoplay);
    }
  }, [session?.config_json?.autoplay, setAutoplayEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      leaveSession();
      stop();
      stopAllSfx();
    };
  }, [stopAllSfx]);

  // Show pending choices when choice audio finishes playing
  useEffect(() => {
    // When audio stops and we have pending choices, show them
    if (!isPlaying && choiceAudioPlaying && pendingChoices.length > 0) {
      console.log('[Story] Choice audio finished, showing choices');
      setChoices(pendingChoices);
      setPendingChoices([]);
      setChoiceAudioPlaying(false);
    }
  }, [isPlaying, choiceAudioPlaying, pendingChoices]);

  // NOTE: wasPlayingRef tracking moved to auto-continue effect below continueStory definition

  // Socket event listeners

  // Handle starting playback after countdown - uses launch sequence hook
  // NOTE: SFX is triggered separately when wordTimings change (indicates scene audio started)
  const handleStartPlayback = useCallback(() => {
    if (!socket || !sessionId) return;

    console.log('[Story] Starting playback via launch sequence...');
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
        text: stripCharacterTags(launchScene.polished_text || launchScene.text || launchScene.summary),
      });
    }

    // Play SFX if enabled (SFX can still play in text mode)
    if (sfxEnabled && sfxDetails?.sfxList?.length > 0) {
      console.log('[SFX] TRIGGER_SUCCESS | source: text_only_mode | effects:', sfxDetails.sfxList.length, '| keys:', sfxDetails.sfxList.map(s => s.sfx_key || s.sfxKey));
      playSfx(sfxDetails.sfxList);
    } else {
      console.log('[SFX] TRIGGER_SKIPPED | source: text_only_mode | enabled:', sfxEnabled, '| sfxList:', sfxDetails?.sfxList?.length || 0);
    }

    // Reset launch state to exit the launch screen
    resetLaunch();

    // Mark generation as complete
    setIsGenerating(false);
    setGenerationProgress({ step: 0, percent: 0, message: '' });
  }, [launchScene, sfxEnabled, sfxDetails, playSfx, resetLaunch]);

  // Continue story functions - MUST be defined before socket useEffect that references them
  const continueStoryWithVoice = useCallback((voiceId) => {
    if (socket && !isGenerating) {
      console.log('[Audio] STATE: * → IDLE | reason: continue_story_reset | resetting all audio flags');
      // Reset launch sequence state for new scene
      resetLaunch();
      // Reset word timings for new scene
      setWordTimings(null);
      setCurrentWordIndex(-1);
      // Reset SFX trigger flags for new scene
      setSceneAudioStarted(false);
      sceneAudioStartedRef.current = false;
      setSceneAudioQueued(false);
      setIntroAudioQueued(false);

      // Clear auto-continue state to prevent race conditions
      if (autoContinueTimerRef.current) {
        clearTimeout(autoContinueTimerRef.current);
        autoContinueTimerRef.current = null;
      }
      autoContinueLockRef.current = false;

      console.log('[Socket:Emit] EVENT: continue-story | session_id:', sessionId, '| voice_id:', voiceId, '| autoplay:', autoplayEnabled);
      socket.emit('continue-story', {
        session_id: sessionId,
        voice_id: voiceId,
        autoplay: autoplayEnabled
      });
      setIsGenerating(true);
    }
  }, [socket, sessionId, isGenerating, autoplayEnabled, resetLaunch]);

  const continueStory = useCallback(() => {
    const voiceId = session?.config_json?.voice_id || session?.config_json?.narratorVoice;
    continueStoryWithVoice(voiceId);
  }, [session, continueStoryWithVoice]);

  useEffect(() => {
    if (!socket) return;

    // Handle intro audio (title/synopsis narration) - QUEUE instead of play immediately
    // This ensures intro plays fully before scene audio starts
    socket.on('intro-audio-ready', (data) => {
      socketLog.info(`RECV: intro-audio-ready | hasAudio: ${!!data.audio} | format: ${data.format} | bytes: ${data.audio?.length || 0}`);
      audioLog.info('STATE: IDLE → INTRO_QUEUED | introAudioQueued=true');
      setIntroAudioQueued(true);
      setSceneAudioStarted(false); // Reset scene audio flag - intro must finish first
      queueAudio(data.audio, data.format);
    });

    // Handle scene audio - QUEUE to ensure it plays after intro finishes
    socket.on('audio-ready', (data) => {
      socketLog.info(`RECV: audio-ready | hasTimings: ${!!data.wordTimings} | wordCount: ${data.wordTimings?.words?.length || 0} | bytes: ${data.audio?.length || 0}`);
      // Store word timings for karaoke/read-along feature
      if (data.wordTimings) {
        audioLog.info(`WORD_TIMINGS | count: ${data.wordTimings.words?.length || data.wordTimings.word_count || 0}`);
        setWordTimings(data.wordTimings);
        setCurrentWordIndex(-1); // Reset word highlight
      } else {
        // No word timings - clear for fallback SFX trigger
        audioLog.info('WORD_TIMINGS | count: 0 (none provided)');
        setWordTimings(null);
      }
      // Mark scene audio as queued
      audioLog.info(`STATE: * → SCENE_QUEUED | sceneAudioQueued=true | introAudioQueued: ${introAudioQueued}`);
      setSceneAudioQueued(true);

      // Queue with onStart callback to trigger SFX when THIS audio starts (after intro finishes)
      // This is the ONLY reliable way to know scene audio started, not intro
      // CRITICAL: Also sets sceneAudioStarted=true which enables karaoke word tracking
      queueAudio(data.audio, data.format, () => {
        audioLog.info('STATE: SCENE_QUEUED → SCENE_PLAYING | sceneAudioStarted=true (onStart callback)');
        // Note: SFX trigger is handled in the callback via sceneAudioStartedRef
        // We use a ref because the callback closure captures stale state
        if (!sceneAudioStartedRef.current) {
          sceneAudioStartedRef.current = true;
          setSceneAudioStarted(true);
          // Trigger SFX - get current sfxDetails from ref
          const currentSfxList = sfxDetailsRef.current?.sfxList;
          if (currentSfxList && currentSfxList.length > 0 && sfxEnabledRef.current) {
            sfxLog.info(`TRIGGER_SUCCESS | source: onStart_callback | effects: ${currentSfxList.length} | keys: ${currentSfxList.map(s => s.sfx_key || s.sfxKey).join(', ')}`);
            playSfx(currentSfxList);
          } else {
            sfxLog.info(`TRIGGER_SKIPPED | source: onStart_callback | enabled: ${sfxEnabledRef.current} | sfxList: ${currentSfxList?.length || 0}`);
          }
        } else {
          sfxLog.info('TRIGGER_SKIPPED | source: onStart_callback | reason: already_started');
        }
      });
    });

    // Handle choice narration audio
    socket.on('choice-audio-ready', (data) => {
      console.log('[Socket:Recv] EVENT: choice-audio-ready | hasAudio:', !!data.audio, '| format:', data.format);
      setChoiceAudioPlaying(true);
      playAudio(data.audio, data.format)
        .then(() => {
          console.log('[Story] Choice audio playback started');
        })
        .catch(err => {
          console.error('[Story] Choice audio playback failed:', err);
          // If audio fails, show choices anyway
          if (pendingChoices.length > 0) {
            setChoices(pendingChoices);
            setPendingChoices([]);
          }
          setChoiceAudioPlaying(false);
        });
    });

    // Handle choice audio error - show choices immediately without audio
    socket.on('choice-audio-error', (data) => {
      console.warn('[Socket:Recv] EVENT: choice-audio-error | message:', data?.message);
      // Show choices immediately since audio failed
      if (pendingChoices.length > 0) {
        setChoices(pendingChoices);
        setPendingChoices([]);
      }
      setChoiceAudioPlaying(false);
    });

    socket.on('generating', (data) => {
      console.log('[Socket:Recv] EVENT: generating | step:', data?.step, '| percent:', data?.percent, '| message:', data?.message?.substring(0, 40));
      setIsGenerating(true);
      if (data && typeof data === 'object') {
        setGenerationProgress({
          step: data.step || 0,
          percent: data.percent || 0,
          message: data.message || 'Creating your story...'
        });
      }
    });
    socket.on('choice-accepted', (data) => {
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
    });
    socket.on('story-paused', () => {
      console.log('[Socket:Recv] EVENT: story-paused');
      pause();
    });
    socket.on('story-resumed', () => {
      console.log('[Socket:Recv] EVENT: story-resumed');
      resume();
    });
    socket.on('audio-error', (data) => {
      console.error('[Socket:Recv] EVENT: audio-error | message:', data?.message);
      // Show user-friendly error message
      const isQuotaError = data.message?.toLowerCase().includes('quota');
      setAudioError(isQuotaError
        ? 'Voice narration unavailable - ElevenLabs credits exhausted. Story text will still display.'
        : 'Voice narration temporarily unavailable. Story text will still display.');
      // Auto-hide error after 10 seconds
      setTimeout(() => setAudioError(null), 10000);
    });
    socket.on('error', (error) => {
      console.error('[Socket:Recv] EVENT: error | message:', error?.message || error);

      // Handle "No pending audio" error - happens after server restart
      // Recovery: trigger continue-story to regenerate the scene
      if (error?.message === 'No pending audio for this session') {
        console.log('[Socket] RECOVERY | reason: no_pending_audio | action: regenerate_scene');
        // Reset launch state first
        resetLaunch();
        // Then trigger continue-story to regenerate
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
    });

    return () => {
      socket.off('intro-audio-ready');
      socket.off('audio-ready');
      socket.off('choice-audio-ready');
      socket.off('choice-audio-error');
      socket.off('audio-error');
      socket.off('generating');
      socket.off('choice-accepted');
      socket.off('story-paused');
      socket.off('story-resumed');
      socket.off('error');
    };
  }, [socket, playAudio, queueAudio, pause, resume, playSfx, stopAllSfx, pendingChoices, continueStory, launchActive, resetLaunch, session, sessionId]);

  const generateCover = useCallback(async () => {
    setIsGeneratingCover(true);
    try {
      const response = await apiCall(`/stories/${sessionId}/generate-cover`, { method: 'POST' });
      const data = await response.json();
      if (data.cover_url) {
        setCoverUrl(data.cover_url);
      }
    } catch (error) {
      console.error('Failed to generate cover:', error);
    } finally {
      setIsGeneratingCover(false);
    }
  }, [sessionId]);

  const generateOutlineAndStart = useCallback(async () => {
    setIsGenerating(true);
    try {
      await apiCall(`/stories/${sessionId}/generate-outline`, { method: 'POST' });
      continueStory();
    } catch (error) {
      console.error('Failed to generate outline:', error);
      setIsGenerating(false);
      setGenerationProgress({ step: 0, percent: 0, message: '' });
      setAudioError('Failed to generate story outline. Please try again or go back to configure.');
    }
  }, [sessionId, continueStory]);

  const fetchSession = useCallback(async () => {
    try {
      const response = await apiCall(`/stories/${sessionId}`);
      const data = await response.json();
      setSession(data.session);
      setCoverUrl(data.session?.cover_image_url);

      if (data.outline) setStoryOutline(data.outline);
      if (data.characters?.length > 0) setCharacters(data.characters);

      if (data.scenes?.length > 0) {
        const lastScene = data.scenes[data.scenes.length - 1];
        setCurrentScene({
          text: stripCharacterTags(lastScene.polished_text || lastScene.summary),
          mood: lastScene.mood,
          scene_id: lastScene.id
        });
        // Reset generating state when we have scenes (fixes stuck "Creating your Story...")
        setIsGenerating(false);
        setGenerationProgress({ step: 0, percent: 0, message: '' });

        // Load pending choices on reconnection
        if (data.pendingChoices?.length > 0) {
          console.log('[Story] Restoring pending choices on reconnection');
          setChoices(data.pendingChoices);
        }
      }

      // Restore choice history for CYOA path visualization
      if (data.choiceHistory?.length > 0) {
        console.log('[Story] Restoring choice history:', data.choiceHistory.length, 'choices');
        setChoiceHistory(data.choiceHistory);
      }

      // Auto-generate cover if story has outline/synopsis but no cover
      if (!data.session?.cover_image_url && (data.outline?.synopsis || data.session?.title)) {
        console.log('[Story] Auto-generating cover...');
        generateCover();
      }

      if (!data.scenes || data.scenes.length === 0) {
        if (data.session?.has_outline || data.outline) {
          const voiceId = data.session?.config_json?.voice_id || data.session?.config_json?.narratorVoice;
          continueStoryWithVoice(voiceId);
        } else {
          generateOutlineAndStart();
        }
      }
    } catch (error) {
      console.error('Failed to fetch session:', error);
    }
  }, [sessionId, generateCover, continueStoryWithVoice, generateOutlineAndStart]);

  // Effect for autoplay when countdown finishes and autoplay is enabled
  // The useLaunchSequence hook handles autoplay internally, but we listen for playback start
  // IMPORTANT: Only auto-start if session config is loaded AND autoplay is explicitly true
  useEffect(() => {
    // Must have session loaded to check config
    if (!session?.config_json) {
      console.log('[Story] Autoplay check: waiting for session config to load');
      return;
    }

    // Only auto-start if explicitly enabled in config
    const configAutoplay = session.config_json.autoplay === true;

    if (isReadyToPlay && configAutoplay && launchStats) {
      console.log('[Story] Autoplay enabled in config, starting playback...');
      handleStartPlayback();
    } else if (isReadyToPlay && launchStats) {
      console.log('[Story] Ready to play, but autoplay disabled - waiting for user to click Begin Chapter');
    }
  }, [isReadyToPlay, session?.config_json, launchStats, handleStartPlayback]);

  // Play SFX when SCENE audio ACTUALLY starts playing (not during synopsis/intro audio)
  // PRIMARY: SFX is triggered via onStart callback in queueAudio (see audio-ready handler)
  // SECONDARY: This effect handles karaoke-based trigger for cases with wordTimings
  // CRITICAL: SFX must NEVER play during title/synopsis narration - only during story content
  useEffect(() => {
    const sfxList = sfxDetails?.sfxList;

    // Guard: need SFX to play, SFX enabled, and not already triggered
    if (!sfxList || sfxList.length === 0 || !sfxEnabled || sceneAudioStarted) {
      // Only log if there's something noteworthy
      if (sfxList?.length > 0 && sceneAudioStarted) {
        sfxLog.info('TRIGGER_SKIPPED | source: karaoke_effect | reason: already_triggered');
      }
      return;
    }

    // Additional guard: Don't trigger if intro audio is still playing
    // wordTimings are ONLY set by audio-ready (scene audio), not intro-audio-ready
    // But this extra check ensures no edge cases slip through
    // CRITICAL: Must wait for scene audio to actually START, not just be queued
    // Both intro and scene can be queued, but intro plays first
    if (introAudioQueued && !sceneAudioStarted) {
      sfxLog.info(`TRIGGER_BLOCKED | source: karaoke_effect | reason: intro_active_scene_not_started | introAudioQueued: ${introAudioQueued} | sceneAudioStarted: ${sceneAudioStarted}`);
      return;
    }

    // Secondary trigger: With wordTimings, trigger when first word starts (karaoke mode)
    // wordTimings come from scene audio ONLY (set in audio-ready handler, not intro-audio-ready)
    // This is a backup - the primary trigger is the onStart callback
    if (wordTimings?.words?.length > 0 && currentWordIndex === 0) {
      audioLog.info('STATE: * → SCENE_PLAYING | source: karaoke_word_0');
      sfxLog.info(`TRIGGER_SUCCESS | source: karaoke_effect | effects: ${sfxList.length} | keys: ${sfxList.map(s => s.sfx_key || s.sfxKey).join(', ')}`);
      setSceneAudioStarted(true);
      sceneAudioStartedRef.current = true;
      playSfx(sfxList);
    }
  }, [currentWordIndex, wordTimings, sfxDetails, sfxEnabled, playSfx, sceneAudioStarted, introAudioQueued, sceneAudioQueued]);

  // Reset sceneAudioQueued after SFX has triggered (ready for next scene)
  useEffect(() => {
    if (sceneAudioStarted && sceneAudioQueued) {
      // SFX triggered - reset queued flag so next scene can queue again
      audioLog.info('RESET | sceneAudioQueued=false | reason: sfx_triggered');
      setSceneAudioQueued(false);
    }
  }, [sceneAudioStarted, sceneAudioQueued]);

  // Auto-continue story when audio finishes
  // This handles both CYOA scene 0 continuation and regular story auto-advancement
  // NOTE: This useEffect must be AFTER continueStory is defined to avoid "before initialization" errors
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
      stopAllSfx();
    }

    if (!audioJustFinished || isGenerating || !socket) return;

    // Check conditions for auto-continuation
    const hasChoices = choices.length > 0 || pendingChoices.length > 0;
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

        // Double-check conditions before continuing (using refs where needed)
        if (storyEnded || choices.length > 0 || pendingChoices.length > 0 || isGenerating) {
          console.log('[Story] Auto-continue cancelled - conditions changed');
          return;
        }

        // Acquire lock and continue
        autoContinueLockRef.current = true;
        console.log(`[Story] ${reason}`);

        // FAIL LOUD: Wrap in try-catch to surface any errors
        try {
          continueStory();
        } catch (error) {
          console.error('[Story] Auto-continue failed:', error);
          setIsGenerating(false);
          // Release lock so user can manually continue
          autoContinueLockRef.current = false;
          return;
        }

        // Release lock after a short delay to prevent rapid re-triggers
        setTimeout(() => {
          autoContinueLockRef.current = false;
        }, 500);
      }, delay);
    };

    // Auto-continue for CYOA scene 0 fix (always allowed - this is part of initial story setup)
    if (hasPendingAutoContinue) {
      pendingAutoContinue.current = false;
      safelyTriggerContinue(1500, '[CYOA] Audio finished, auto-continuing to next scene for choices');
      return;
    }

    // Regular auto-continuation when no choices are pending
    // ONLY auto-continue if autoplayEnabled is true - otherwise wait for user to click "Begin Chapter X"
    if (!hasChoices && !storyEnded && currentScene && autoplayEnabled) {
      safelyTriggerContinue(1000, 'Audio finished and autoplay enabled, auto-continuing to next scene');
    } else if (!hasChoices && !storyEnded && currentScene && !autoplayEnabled) {
      // When autoplay is disabled, just log that chapter finished - user will click to continue
      console.log('[Story] Chapter audio finished, waiting for user to click continue (autoplay disabled)');
    }

    // Cleanup timer on unmount or dependency change
    return () => {
      if (autoContinueTimerRef.current) {
        clearTimeout(autoContinueTimerRef.current);
        autoContinueTimerRef.current = null;
      }
    };
  }, [isPlaying, isPaused, isGenerating, socket, continueStory, choices, pendingChoices, storyEnded, currentScene, autoplayEnabled, stopAllSfx]);

  // Keep currentTimeRef in sync with currentTime (for karaoke polling without effect re-runs)
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Word highlighting effect - tracks which word should be highlighted based on audio time
  // Uses polling for smooth updates (50ms interval) instead of relying on timeupdate events
  // CRITICAL: Only run when SCENE audio is playing, not during intro audio
  // FIX (2025-12-12): Use currentTimeRef instead of currentTime state to avoid constant effect re-runs
  useEffect(() => {
    // DIAGNOSTIC: Log every time this effect runs to see what's blocking it
    audioLog.info(`KARAOKE_EFFECT_RUN | hasWordTimings: ${!!wordTimings?.words} | wordCount: ${wordTimings?.words?.length || 0} | isPlaying: ${isPlaying} | showText: ${showText} | isPaused: ${isPaused} | sceneAudioStarted: ${sceneAudioStarted}`);

    // Guard: Must have word timings, be playing, showing text, not paused, AND scene audio must have started
    // The sceneAudioStarted check prevents karaoke from running during intro audio playback
    if (!wordTimings?.words || !isPlaying || !showText || isPaused || !sceneAudioStarted) {
      // Log WHY we're not starting karaoke
      const reason = !wordTimings?.words ? 'no_word_timings' :
                     !isPlaying ? 'not_playing' :
                     !showText ? 'text_hidden' :
                     isPaused ? 'paused' :
                     !sceneAudioStarted ? 'scene_not_started' : 'unknown';
      audioLog.info(`KARAOKE_BLOCKED | reason: ${reason}`);
      // Reset word index when conditions aren't met
      setCurrentWordIndex(-1);
      return;
    }

    audioLog.info(`KARAOKE_STARTING | words: ${wordTimings.words.length} | sceneAudioStarted: ${sceneAudioStarted} | currentTimeRef: ${currentTimeRef.current}`);

    // Track last known word index to avoid redundant setState calls
    let lastFoundIndex = -1;
    let pollCount = 0;

    // Poll audio time every 50ms for smooth highlighting
    const interval = setInterval(() => {
      pollCount++;
      // Use ref values inside interval to avoid stale closures
      const timeMs = currentTimeRef.current * 1000;
      const words = wordTimings.words;

      // Log every 20 polls (1 second) to verify interval is running
      if (pollCount % 20 === 0) {
        audioLog.info(`KARAOKE_POLL | pollCount: ${pollCount} | timeMs: ${timeMs.toFixed(0)} | lastFoundIndex: ${lastFoundIndex} | currentTimeRef: ${currentTimeRef.current.toFixed(2)}`);
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
        // Log word changes (every word, not just every 10)
        if (foundIndex >= 0) {
          audioLog.info(`KARAOKE_WORD_CHANGE | index: ${foundIndex} | word: "${words[foundIndex]?.text}" | timeMs: ${timeMs.toFixed(0)} | wordRange: [${words[foundIndex]?.start_ms}-${words[foundIndex]?.end_ms}]`);
        }
        lastFoundIndex = foundIndex;
        setCurrentWordIndex(foundIndex);
      }
    }, 50); // Update every 50ms for smooth highlighting

    return () => {
      audioLog.info(`KARAOKE_CLEANUP | totalPolls: ${pollCount}`);
      clearInterval(interval);
    };
  }, [wordTimings, isPlaying, isPaused, showText, sceneAudioStarted]); // NOTE: currentTime and currentWordIndex removed - using refs

  const submitChoice = useCallback((choiceKey) => {
    if (socket) {
      const selectedChoice = choices.find(c => c.key === choiceKey || c.choice_key === choiceKey);
      const choiceText = selectedChoice?.text || selectedChoice?.choice_text || choiceKey;
      console.log('[Socket:Emit] EVENT: submit-choice | session_id:', sessionId, '| choice_key:', choiceKey, '| choice_text:', choiceText?.substring(0, 50));
      socket.emit('submit-choice', {
        session_id: sessionId,
        choice_key: choiceKey,
        choice_text: choiceText
      });
    }
  }, [socket, sessionId, choices]);

  const backtrackToCheckpoint = useCallback(async (checkpointIndex) => {
    if (!cyoaSettings.allow_backtrack) return;
    const checkpoint = checkpoints[checkpointIndex];
    if (!checkpoint) return;

    setIsBacktracking(true);
    stop();

    try {
      const response = await apiCall(`/stories/${sessionId}/backtrack`, {
        method: 'POST',
        body: JSON.stringify({ scene_id: checkpoint.sceneId, scene_index: checkpoint.sceneIndex })
      });

      if (response.ok) {
        setCurrentScene({ text: checkpoint.sceneText, scene_id: checkpoint.sceneId });
        setChoices(checkpoint.choices);
        setCheckpoints(prev => prev.slice(0, checkpointIndex + 1));
        setChoiceHistory(prev => prev.filter(c => c.sceneIndex <= checkpoint.sceneIndex));
        setShowChoiceHistory(false);
      }
    } catch (error) {
      console.error('Failed to backtrack:', error);
    } finally {
      setIsBacktracking(false);
    }
  }, [cyoaSettings.allow_backtrack, checkpoints, sessionId, stop]);

  const togglePause = useCallback(() => {
    if (isPlaying) socket?.emit('pause-story', { session_id: sessionId });
    else if (isPaused) socket?.emit('resume-story', { session_id: sessionId });
  }, [isPlaying, isPaused, socket, sessionId]);

  const updateConfig = useCallback(async (updates) => {
    try {
      const response = await apiCall(`/stories/${sessionId}/update-config`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      if (data.success) {
        setSession(prev => ({ ...prev, config_json: data.config }));
      }
    } catch (error) {
      console.error('Failed to update config:', error);
    }
  }, [sessionId]);

  const handleVoiceSelect = useCallback((voice) => {
    updateConfig({ voice_id: voice.voice_id, voice_name: voice.name });
  }, [updateConfig]);

  const handleNarratorStyleChange = useCallback((style) => {
    updateConfig({ narrator_style: style });
  }, [updateConfig]);

  const saveStory = useCallback(async () => {
    setIsSaving(true);
    try {
      await apiCall(`/library/${sessionId}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          scene_id: currentScene?.scene_id || null,
          scene_index: session?.total_scenes || 0,
          reading_time: 0
        })
      });
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, currentScene?.scene_id, session?.total_scenes]);

  const endStory = useCallback(async () => {
    try {
      await apiCall(`/stories/${sessionId}/end`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'user_ended' })
      });
      navigate('/');
    } catch (error) {
      console.error('Failed to end story:', error);
    }
  }, [sessionId, navigate]);

  const goHome = useCallback(() => {
    stop();
    navigate('/');
  }, [stop, navigate]);

  // Global keyboard shortcuts for audio controls
  // NOTE: This useEffect must be AFTER togglePause, continueStory, and goHome are defined
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't intercept if typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      switch (event.key) {
        case ' ': // Spacebar - Play/Pause
          event.preventDefault();
          togglePause();
          break;
        case 'ArrowRight': // Right arrow - Skip forward
          if (!isGenerating && choices.length === 0) {
            event.preventDefault();
            continueStory();
          }
          break;
        case 'm': // M - Toggle mute
        case 'M':
          event.preventDefault();
          setVolume(volume > 0 ? 0 : 1);
          break;
        case 't': // T - Toggle text display
        case 'T':
          event.preventDefault();
          setShowText(prev => !prev);
          break;
        case 'Escape': // Escape - Go home
          event.preventDefault();
          goHome();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePause, continueStory, isGenerating, choices.length, volume, setVolume, goHome]);

  // Recording playback handlers
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

  const handleGenerateFresh = useCallback(() => {
    setShowRecordingPrompt(false);
    setFoundRecording(null);
    // Continue with normal story generation flow
    fetchSession();
  }, [fetchSession]);

  const handleCloseRecordingPlayer = useCallback(() => {
    setShowRecordingPlayer(false);
    stopRecordingPlayback();
  }, [stopRecordingPlayback]);

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

  const handleDivergenceCancel = useCallback(() => {
    setShowDivergenceModal(false);
    setDivergenceChoice(null);
  }, []);

  const handleResumeRecovery = useCallback(async () => {
    const success = await resumeRecording();
    if (success) {
      setShowRecordingPlayer(true);
    }
  }, [resumeRecording]);

  const handleDiscardRecovery = useCallback(() => {
    dismissRecovery();
    // Continue with fresh start
    fetchSession();
  }, [dismissRecovery, fetchSession]);

  // Memoized derived values for performance
  const config = useMemo(() => session?.config_json || {}, [session?.config_json]);

  const authorStyleName = useMemo(() => {
    if (!config.author_style || config.author_style === 'none') return null;
    return AUTHOR_NAMES[config.author_style] || config.author_style;
  }, [config.author_style]);

  // Fullscreen cover overlay
  if (showCoverFullscreen && coverUrl) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black flex items-center justify-center cursor-pointer"
        onClick={() => setShowCoverFullscreen(false)}
      >
        <button
          onClick={() => setShowCoverFullscreen(false)}
          className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 z-10"
        >
          <Minimize2 className="w-6 h-6" />
        </button>
        <img
          src={coverUrl}
          alt="Story Cover"
          className="max-h-full max-w-full object-contain"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-8 text-center">
          <h1 className="text-4xl font-bold text-white mb-2">{session?.title || 'Your Story'}</h1>
          {authorStyleName && (
            <p className="text-xl text-golden-400">In the style of {authorStyleName}</p>
          )}
          {storyOutline?.synopsis && (
            <p className="text-night-300 mt-4 max-w-2xl mx-auto">{storyOutline.synopsis}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col relative"
      style={coverUrl ? {
        backgroundImage: `linear-gradient(to bottom, rgba(10,10,15,0.85), rgba(10,10,15,0.95)), url(${coverUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top'
      } : {}}
    >
      {/* Audio Error Banner */}
      {audioError && (
        <div className="bg-amber-500/20 border-b border-amber-500/50 px-4 py-2 flex items-center justify-between">
          <p className="text-amber-300 text-sm flex items-center gap-2">
            <VolumeX className="w-4 h-4" />
            {audioError}
          </p>
          <button
            onClick={() => setAudioError(null)}
            className="text-amber-400 hover:text-amber-300 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Enhanced Header with Story Details */}
      <header className="bg-night-900/80 backdrop-blur-sm border-b border-night-700">
        {/* Top Bar */}
        <div className="flex items-center justify-between p-3">
          <button onClick={goHome} className="p-2 rounded-full hover:bg-night-800">
            <Home className="w-5 h-5 text-night-300" />
          </button>

          <div className="flex items-center gap-2">
            {/* Recording Indicator */}
            {hasRecording && (
              <button
                onClick={() => {
                  if (showRecordingPlayer) {
                    handleCloseRecordingPlayer();
                  } else if (foundRecording) {
                    handlePlayRecording();
                  } else if (recordings.length > 0) {
                    setFoundRecording(recordings.find(r => r.is_complete) || recordings[0]);
                    setShowRecordingPrompt(true);
                  }
                }}
                className={`p-2 rounded-full relative ${
                  showRecordingPlayer
                    ? 'bg-green-500/20 border border-green-500'
                    : 'hover:bg-night-800'
                }`}
                title={showRecordingPlayer ? 'Exit recording playback' : 'Play recording (no wait)'}
              >
                <Disc className={`w-5 h-5 ${showRecordingPlayer ? 'text-green-400 animate-spin-slow' : 'text-green-400'}`} />
                {!showRecordingPlayer && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                )}
              </button>
            )}

            {/* Save Button */}
            <button
              onClick={saveStory}
              disabled={isSaving}
              className="p-2 rounded-full hover:bg-night-800 text-night-400 hover:text-green-400"
              title={lastSaved ? `Last saved: ${lastSaved.toLocaleTimeString()}` : 'Save progress'}
            >
              <Save className={`w-5 h-5 ${isSaving ? 'animate-pulse' : ''}`} />
            </button>

            {/* SFX Toggle */}
            <button onClick={toggleSfx} className={`p-2 rounded-full ${sfxEnabled ? 'hover:bg-night-800' : 'bg-night-700'}`}>
              {sfxEnabled ? <Volume2 className="w-5 h-5 text-cyan-400" /> : <VolumeX className="w-5 h-5 text-night-500" />}
            </button>

            {/* Story Info */}
            <button
              onClick={() => { setShowStoryInfo(!showStoryInfo); setShowSettings(false); setShowChoiceHistory(false); }}
              className={`p-2 rounded-full ${showStoryInfo ? 'bg-blue-500/20 border border-blue-500' : 'hover:bg-night-800'}`}
            >
              <BookOpen className="w-5 h-5 text-blue-400" />
            </button>

            {/* Settings */}
            <button
              onClick={() => { setShowSettings(!showSettings); setShowStoryInfo(false); setShowChoiceHistory(false); }}
              className={`p-2 rounded-full ${showSettings ? 'bg-golden-400/20 border border-golden-400' : 'hover:bg-night-800'}`}
            >
              <Settings className="w-5 h-5 text-golden-400" />
            </button>

            {/* CYOA History */}
            {isCyoaEnabled && choiceHistory.length > 0 && (
              <button
                onClick={() => { setShowChoiceHistory(!showChoiceHistory); setShowStoryInfo(false); setShowSettings(false); }}
                className={`p-2 rounded-full ${showChoiceHistory ? 'bg-amber-500/20 border border-amber-500' : 'hover:bg-night-800'}`}
              >
                <History className="w-5 h-5 text-amber-400" />
              </button>
            )}

            {/* Text Toggle */}
            <button
              onClick={() => setShowText(!showText)}
              className={`p-2 rounded-full ${showText ? 'bg-night-700' : 'hover:bg-night-800'}`}
            >
              <span className="text-night-300 text-sm font-medium">Aa</span>
            </button>

            {/* User Profile */}
            <UserProfile />
          </div>
        </div>

        {/* Story Title & Details - Hide when LaunchScreen is visible to avoid duplicate titles */}
        {/* FIXED: Also hide during isGenerating phase since LaunchScreen shows then too */}
        {!(isGenerating || launchActive || isCountdownActive || isReadyToPlay) && (
          <div className="px-4 pb-3 text-center">
            <h1 className="text-3xl md:text-4xl font-bold text-golden-400 mb-2 leading-tight">
              {session?.title || storyOutline?.title || 'Creating your story...'}
            </h1>

            {/* Meta Tags */}
            <div className="flex items-center justify-center gap-2 flex-wrap text-sm">
              {config.story_type && (
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  config.story_type === 'cyoa' ? 'bg-amber-500/20 text-amber-400' :
                  config.story_type === 'campaign' ? 'bg-red-500/20 text-red-400' :
                  'bg-night-700 text-night-300'
                }`}>
                  {config.story_type === 'cyoa' ? 'Choose Your Own Adventure' : config.story_type}
                </span>
              )}
              {config.genre && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-night-700 text-night-300">{config.genre}</span>
              )}
              {authorStyleName && (
                <span className="text-purple-400 flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10">
                  <Feather className="w-3 h-3" />
                  <span className="text-purple-300/70 text-xs">Style:</span> {authorStyleName}
                </span>
              )}
              {config.narrator_style && (
                <span className="text-cyan-400 text-xs px-2 py-0.5 rounded-full bg-cyan-500/10">
                  {config.narrator_style.charAt(0).toUpperCase() + config.narrator_style.slice(1)} Tone
                </span>
              )}
              {currentScene?.mood && currentScene.mood.toLowerCase() !== (config.narrator_style || '').toLowerCase() && (
                <span className="text-night-400 text-xs px-2 py-0.5 rounded-full bg-night-700">
                  Mood: {currentScene.mood}
                </span>
              )}
            </div>

            {/* Synopsis */}
            {storyOutline?.synopsis && (
              <p className="text-night-400 text-sm mt-2 max-w-lg mx-auto line-clamp-2">
                {storyOutline.synopsis}
              </p>
            )}

            {/* Scene Counter with Progress Bar */}
            {currentScene && (
              <div className="mt-3 max-w-xs mx-auto">
                <div className="text-night-500 text-xs mb-1">
                  {isCyoaEnabled
                    ? `Chapter ${(currentScene.scene_index !== undefined ? currentScene.scene_index : 0) + 1}`
                    : `Scene ${(currentScene.scene_index !== undefined ? currentScene.scene_index : 0) + 1}${session?.estimated_scenes ? ` of ~${session.estimated_scenes}` : ''}`
                  }
                </div>
                {/* Visual Progress Bar */}
                {!isCyoaEnabled && session?.estimated_scenes && (
                  <div className="w-full h-1.5 bg-night-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-golden-400 to-golden-500 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (((currentScene.scene_index !== undefined ? currentScene.scene_index : 0) + 1) / session.estimated_scenes) * 100)}%`
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-night-800/95 border-b border-golden-400/30 p-4 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-golden-400 font-medium flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Story Settings
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-night-400 hover:text-night-200">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Voice Selection */}
            <div>
              <h4 className="text-night-200 text-sm font-medium mb-2 flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Narrator Voice
              </h4>
              <VoiceSelector
                selectedVoice={{ voice_id: config.voice_id, name: config.voice_name }}
                onSelect={handleVoiceSelect}
                narratorStyle={config.narrator_style || 'warm'}
              />
            </div>

            {/* Volume Control */}
            <div>
              <h4 className="text-night-200 text-sm font-medium mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  Volume
                </span>
                <span className="text-golden-400 text-xs">{Math.round(volume * 100)}%</span>
              </h4>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-2 bg-night-700 rounded-lg appearance-none cursor-pointer accent-golden-400"
              />
              <div className="flex justify-between text-xs text-night-400 mt-1">
                <span>Quiet</span>
                <span>Loud</span>
              </div>
            </div>

            {/* Narrator Style */}
            <div>
              <h4 className="text-night-200 text-sm font-medium mb-2">Narrator Tone</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'warm', label: 'Warm & Gentle', icon: '🌙' },
                  { id: 'dramatic', label: 'Dramatic', icon: '🎭' },
                  { id: 'playful', label: 'Playful', icon: '✨' },
                  { id: 'mysterious', label: 'Mysterious', icon: '🌑' }
                ].map(style => (
                  <button
                    key={style.id}
                    onClick={() => handleNarratorStyleChange(style.id)}
                    className={`p-2 rounded-lg border text-left text-sm ${
                      config.narrator_style === style.id
                        ? 'border-golden-400 bg-night-700'
                        : 'border-night-600 hover:border-night-500'
                    }`}
                  >
                    <span className="mr-1">{style.icon}</span>
                    {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Cover */}
            <div>
              <h4 className="text-night-200 text-sm font-medium mb-2 flex items-center gap-2">
                <Image className="w-4 h-4" />
                Story Cover
              </h4>
              <button
                onClick={generateCover}
                disabled={isGeneratingCover}
                className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-night-700 text-white rounded-lg flex items-center justify-center gap-2"
              >
                {isGeneratingCover ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating Cover...
                  </>
                ) : coverUrl ? (
                  <>
                    <Image className="w-4 h-4" />
                    Regenerate Cover
                  </>
                ) : (
                  <>
                    <Image className="w-4 h-4" />
                    Generate Book Cover
                  </>
                )}
              </button>
              {coverUrl && (
                <button
                  onClick={() => setShowCoverFullscreen(true)}
                  className="w-full mt-2 py-2 px-4 border border-night-600 text-night-300 hover:text-white hover:border-night-500 rounded-lg flex items-center justify-center gap-2"
                >
                  <Maximize2 className="w-4 h-4" />
                  View Fullscreen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Story Info Panel */}
      {showStoryInfo && (
        <div className="bg-night-800/95 border-b border-blue-500/30 p-4 max-h-96 overflow-y-auto">
          <h3 className="text-blue-400 font-medium flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4" />
            Story Details
          </h3>

          <div className="space-y-4 text-sm">
            {/* Story Type & Format */}
            <div className="flex flex-wrap gap-2 pb-3 border-b border-night-700">
              {config.story_type && (
                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                  config.story_type === 'cyoa' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  config.story_type === 'campaign' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                  'bg-night-700 text-night-300'
                }`}>
                  {config.story_type === 'cyoa' ? 'Choose Your Own Adventure' :
                   config.story_type === 'campaign' ? 'Campaign Mode' : config.story_type}
                </span>
              )}
              {config.story_length && (
                <span className="px-2 py-1 rounded-lg text-xs bg-night-700 text-night-300">
                  {config.story_length.charAt(0).toUpperCase() + config.story_length.slice(1)} Story
                </span>
              )}
              {config.genre && (
                <span className="px-2 py-1 rounded-lg text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {config.genre}
                </span>
              )}
            </div>

            {storyOutline?.synopsis && (
              <div>
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <Info className="w-3 h-3" />
                  <span>Synopsis</span>
                </div>
                <p className="text-night-200">{storyOutline.synopsis}</p>
              </div>
            )}

            {storyOutline?.setting && (
              <div>
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <MapPin className="w-3 h-3" />
                  <span>Setting</span>
                </div>
                <p className="text-night-200">
                  {typeof storyOutline.setting === 'object'
                    ? storyOutline.setting.description || storyOutline.setting.location
                    : storyOutline.setting}
                </p>
              </div>
            )}

            {characters.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <Users className="w-3 h-3" />
                  <span>Characters ({characters.length})</span>
                </div>
                <div className="space-y-1">
                  {characters.slice(0, 5).map((char, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-night-200 font-medium">{char.name}</span>
                      {char.role && <span className="text-night-500">({char.role})</span>}
                    </div>
                  ))}
                  {characters.length > 5 && (
                    <span className="text-night-500 text-xs">+{characters.length - 5} more</span>
                  )}
                </div>
              </div>
            )}

            {authorStyleName && (
              <div>
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <Feather className="w-3 h-3" />
                  <span>Author Style</span>
                </div>
                <p className="text-purple-300">{authorStyleName}</p>
              </div>
            )}

            {config.narrator_style && (
              <div>
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <Palette className="w-3 h-3" />
                  <span>Narration Tone</span>
                </div>
                <p className="text-cyan-300">{config.narrator_style.charAt(0).toUpperCase() + config.narrator_style.slice(1)}</p>
              </div>
            )}

            {storyOutline?.themes?.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <Bookmark className="w-3 h-3" />
                  <span>Themes</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {storyOutline.themes.map((theme, i) => (
                    <span key={i} className="px-2 py-0.5 bg-night-700 rounded-full text-night-300 text-xs">
                      {theme}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Story progress info */}
            {session && (
              <div className="pt-3 border-t border-night-700">
                <div className="flex items-center gap-1 text-night-400 mb-1">
                  <Info className="w-3 h-3" />
                  <span>Progress</span>
                </div>
                <p className="text-night-300">
                  {isCyoaEnabled
                    ? `Chapter ${(currentScene?.scene_index ?? 0) + 1} • ${choiceHistory.length} choices made`
                    : `Scene ${(currentScene?.scene_index ?? 0) + 1}${session.estimated_scenes ? ` of ~${session.estimated_scenes}` : ''}`
                  }
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Choice History Panel - Visual Tree */}
      {showChoiceHistory && isCyoaEnabled && (
        <div className="border-b border-amber-500/30">
          <ChoiceTree
            choiceHistory={choiceHistory}
            checkpoints={checkpoints}
            currentSceneIndex={currentScene?.scene_index ?? session?.total_scenes ?? 0}
            onBacktrack={backtrackToCheckpoint}
            allowBacktrack={cyoaSettings.allow_backtrack && !isBacktracking}
          />
        </div>
      )}


      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        {(isGenerating || launchActive || isCountdownActive || isReadyToPlay) ? (
          /* Pre-playback launch screen with HUD, validation progress, countdown, and play button */
          /* Now also shows during initial generation phase for enhanced progress UI */
          <LaunchScreen
            isVisible={true}
            coverUrl={coverUrl}
            title={session?.title || launchStats?.title}
            synopsis={session?.synopsis || launchStats?.synopsis}
            stats={launchStats}
            stageStatuses={stageStatuses}
            stageDetails={stageDetails}
            isCountdownActive={isCountdownActive}
            countdownPhase={countdownPhase}
            countdownValue={countdownValue}
            isReadyToPlay={isReadyToPlay}
            autoplayEnabled={autoplayEnabled}
            onAutoplayChange={setAutoplayEnabled}
            onStartPlayback={handleStartPlayback}
            onStartTextOnly={handleStartTextOnly}
            onStartCountdown={startCountdown}
            onCancel={handleCancelPlayback}
            onCancelCountdown={cancelCountdown}
            warnings={launchWarnings}
            errors={launchError ? [launchError] : []}
            canRetryStages={canRetryStages}
            retryingStage={retryingStage}
            onRetryStage={retryStage}
            isRegeneratingCover={isRegeneratingCover}
            onRegenerateCover={regenerateCover}
            // Additional regeneration props
            isRegeneratingSynopsis={isRegeneratingSynopsis}
            onRegenerateSynopsis={regenerateSynopsis}
            isRegeneratingSfx={isRegeneratingSfx}
            onRegenerateSfx={regenerateSfx}
            isRegeneratingVoices={isRegeneratingVoices}
            onRegenerateVoices={regenerateVoices}
            // SFX toggle
            sfxEnabled={sfxEnabled}
            onSfxToggle={toggleSfx}
            // Chapter number for button text (1-based)
            // Use launchScene.index during launch, currentScene.scene_index during playback
            chapterNumber={(launchScene?.index ?? currentScene?.scene_index ?? 0) + 1}
            // HUD props
            coverProgress={coverProgress}
            agents={agents}
            usage={usage}
            characterVoices={characterVoices}
            voiceSummary={voiceSummary}
            sfxDetails={sfxDetails}
            qaChecks={qaChecks}
            safetyReport={safetyReport}
            formatCost={formatCost}
            formatTokens={formatTokens}
            formatCharacters={formatCharacters}
            // Detailed progress log for technical info display
            detailedProgressLog={detailedProgressLog}
            // Text display props
            showText={showText}
            onShowTextToggle={() => setShowText(!showText)}
            storyText={stripCharacterTags(launchScene?.polished_text || launchScene?.text || launchScene?.summary || '')}
            // Initial generation phase props
            isGenerating={isGenerating}
            generationProgress={generationProgress}
          />
        ) : storyEnded ? (
          <div className="text-center">
            <Moon className="w-20 h-20 text-golden-400 mx-auto mb-6" />
            <h2 className="text-2xl text-golden-400 mb-4">The End</h2>
            <p className="text-night-300 mb-8">Sweet dreams...</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={goHome}
                className="px-8 py-3 bg-night-800 border border-golden-400 rounded-full text-golden-400 hover:bg-night-700"
              >
                Back to Home
              </button>
              <button
                onClick={() => navigate('/library')}
                className="px-8 py-3 bg-golden-400 rounded-full text-night-900 hover:bg-golden-500"
              >
                View in Library
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Book Page Layout - Float cover with text wrap, karaoke/read-along */}
            {showText && currentScene && (
              <div className="max-w-2xl mx-auto mb-8">
                <BookPageLayout
                  // Story metadata
                  title={session?.title || storyOutline?.title || 'Your Story'}
                  synopsis={storyOutline?.synopsis || ''}
                  storyText={stripCharacterTags(currentScene.text || currentScene.polished_text || currentScene.summary || '')}

                  // Story details for expandable badge
                  storyDetails={{
                    authorStyle: session?.author_style ? AUTHOR_NAMES[session.author_style] || session.author_style : '',
                    setting: typeof storyOutline?.setting === 'object'
                      ? storyOutline.setting.description || storyOutline.setting.location
                      : storyOutline?.setting || '',
                    themes: storyOutline?.themes || [],
                    mood: session?.mood || storyOutline?.mood || ''
                  }}

                  // Cover art
                  coverUrl={coverUrl}

                  // Karaoke/word highlighting
                  wordTimings={wordTimings}
                  currentWordIndex={currentWordIndex}

                  // Callbacks
                  onWordClick={(wordIndex, timeSeconds) => {
                    console.log(`Word clicked: ${wordIndex} at ${timeSeconds}s`);
                  }}

                  // State
                  isCountdownActive={isReadyToPlay}
                />
              </div>
            )}

            {/* Audio Visualizer & SFX Indicator - Inline below text box */}
            {(isPlaying || (sfxEnabled && activeSfx.length > 0)) && (
              <div className="max-w-2xl mx-auto mb-6 flex flex-col items-center gap-3">
                {isPlaying && <AudioVisualizer />}
                {sfxEnabled && activeSfx.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-night-800/80 border border-cyan-500/30 rounded-full">
                    {/* SFX wave bars animation */}
                    <div className="flex items-center gap-0.5">
                      {[...Array(4)].map((_, i) => (
                        <div
                          key={i}
                          className="w-1 bg-cyan-400 rounded-full animate-pulse"
                          style={{
                            height: `${8 + Math.random() * 8}px`,
                            animationDelay: `${i * 0.1}s`
                          }}
                        />
                      ))}
                    </div>
                    {/* Active SFX pills */}
                    {activeSfx.slice(0, 3).map((sfx, i) => (
                      <span key={sfx.key || i} className="text-cyan-400 text-xs">
                        {sfx.name}
                      </span>
                    ))}
                    {activeSfx.length > 3 && (
                      <span className="text-cyan-400/60 text-xs">+{activeSfx.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Show indicator while choice audio is playing */}
            {pendingChoices.length > 0 && choices.length === 0 && (
              <div className="text-center mb-6 animate-pulse">
                <p className="text-golden-400 text-lg mb-2">Choose your path...</p>
                <p className="text-night-400 text-sm">Listening to your options</p>
              </div>
            )}

            {choices.length > 0 && (
              <ChoiceButtons choices={choices} onSelect={submitChoice} />
            )}
          </>
        )}
      </main>

      {/* Cover Image - REMOVED: Now integrated into StoryBookView unified document */}

      {/* Control Bar */}
      {!storyEnded && (
        <footer className="bg-night-900/80 backdrop-blur">
          {/* Audio Progress Bar - Status Bar */}
          {(isPlaying || isPaused || duration > 0) && (
            <div className="px-6 pt-4 pb-2">
              <div className="flex items-center gap-3 max-w-md mx-auto">
                <span className="text-night-400 text-xs font-mono min-w-[40px] text-right">
                  {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
                </span>
                <div className="flex-1 h-2 bg-night-700 rounded-full overflow-hidden relative group cursor-pointer">
                  <div
                    className="h-full bg-gradient-to-r from-golden-400 to-golden-500 rounded-full transition-all duration-100"
                    style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-night-400 text-xs font-mono min-w-[40px]">
                  {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
                </span>
              </div>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className={`text-xs ${isPlaying ? 'text-green-400' : 'text-night-500'}`}>
                  {isPlaying ? 'Playing' : isPaused ? 'Paused' : 'Ready'}
                </span>
                {wordTimings?.words && (
                  <span className="text-night-600 text-xs">
                    {currentWordIndex >= 0 ? currentWordIndex + 1 : 0}/{wordTimings.words.length} words
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="p-6 pt-2 flex items-center justify-center gap-4">
            {/* Back/Restart Button */}
            {isCyoaEnabled && checkpoints.length > 0 ? (
              <button
                onClick={() => setShowChoiceHistory(true)}
                className="flex flex-col items-center gap-1 p-3 rounded-xl bg-night-800 border-2 border-night-600 hover:border-amber-400"
                title="Go back to a previous choice"
              >
                <SkipBack className="w-5 h-5 text-amber-400" />
                <span className="text-[10px] text-night-400">Choices</span>
              </button>
            ) : (
              <button
                onClick={goHome}
                className="flex flex-col items-center gap-1 p-3 rounded-xl bg-night-800 border-2 border-night-600 hover:border-night-400"
                title="Go back to home"
              >
                <Home className="w-5 h-5 text-night-300" />
                <span className="text-[10px] text-night-400">Home</span>
              </button>
            )}

            {/* Voice Input */}
            <button
              onClick={() => setIsListening(!isListening)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl ${
                isListening
                  ? 'bg-red-500/20 border-2 border-red-500'
                  : 'bg-night-800 border-2 border-night-600 hover:border-night-400'
              }`}
              title={isListening ? 'Stop listening' : 'Voice command'}
            >
              {isListening ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5 text-night-300" />}
              <span className="text-[10px] text-night-400">{isListening ? 'Stop' : 'Voice'}</span>
            </button>

            {/* Play/Pause Main Control */}
            <button
              onClick={togglePause}
              className="flex flex-col items-center gap-1 p-5 rounded-full bg-golden-400 hover:bg-golden-500 shadow-lg shadow-golden-400/30 focus:outline-none focus:ring-2 focus:ring-golden-300"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={isPlaying ? 'Pause audio playback' : 'Play audio'}
              aria-pressed={isPlaying}
            >
              {isPlaying ? <Pause className="w-7 h-7 text-night-900" aria-hidden="true" /> : <Play className="w-7 h-7 text-night-900 ml-0.5" aria-hidden="true" />}
            </button>

            {/* Skip Forward */}
            <button
              onClick={continueStory}
              disabled={isGenerating || choices.length > 0}
              className="flex flex-col items-center gap-1 p-3 rounded-xl bg-night-800 border-2 border-night-600 hover:border-night-400 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-golden-500"
              title="Skip to next scene (→)"
              aria-label="Skip to next scene"
            >
              <SkipForward className="w-5 h-5 text-night-300" aria-hidden="true" />
              <span className="text-[10px] text-night-400">Next</span>
            </button>

            {/* Text Toggle */}
            <button
              onClick={() => setShowText(!showText)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-golden-500 ${
                showText ? 'bg-night-700 border-2 border-night-500' : 'bg-night-800 border-2 border-night-600 hover:border-night-400'
              }`}
              title={showText ? 'Hide text (T)' : 'Show text (T)'}
              aria-label={showText ? 'Hide story text' : 'Show story text'}
              aria-pressed={showText}
            >
              <BookOpen className="w-5 h-5 text-night-300" aria-hidden="true" />
              <span className="text-[10px] text-night-400">Text</span>
            </button>
          </div>
        </footer>
      )}

      {/* Recording Player Overlay */}
      {showRecordingPlayer && activeRecording && recordingSegments.length > 0 && (
        <div className="fixed inset-0 z-40 bg-night-900">
          <RecordingPlayer
            recording={activeRecording}
            segments={recordingSegments}
            onClose={handleCloseRecordingPlayer}
            onDiverge={handleRecordingDiverge}
            showChoiceTree={isCyoaEnabled}
            autoPlay={true}
          />
        </div>
      )}

      {/* Recording Prompt Modal */}
      <RecordingPrompt
        isOpen={showRecordingPrompt}
        recording={foundRecording}
        onPlayRecording={handlePlayRecording}
        onGenerateFresh={handleGenerateFresh}
        onClose={() => setShowRecordingPrompt(false)}
        isLoading={recordingLoading}
      />

      {/* Recovery Prompt Modal */}
      <RecoveryPrompt
        isOpen={showRecoveryPrompt}
        recoveryInfo={recoveryInfo}
        onResume={handleResumeRecovery}
        onStartFresh={handleGenerateFresh}
        onDiscard={handleDiscardRecovery}
        onClose={dismissRecovery}
        isLoading={recordingLoading}
      />

      {/* Divergence Modal */}
      <DivergenceModal
        isOpen={showDivergenceModal}
        choiceKey={divergenceChoice?.key}
        choiceText={divergenceChoice?.text}
        onContinue={handleDivergenceConfirm}
        onCancel={handleDivergenceCancel}
        isLoading={isGenerating}
      />
    </div>
  );
}

export default Story;
