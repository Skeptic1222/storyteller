import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Home, Sparkles, History, BookOpen, Volume2, VolumeX, Settings, Feather, Disc, Minus, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { useAudio } from '../context/AudioContext';
import UserProfile from '../components/UserProfile';
import ChoiceButtons from '../components/ChoiceButtons';
import AudioVisualizer from '../components/AudioVisualizer';
import ChoiceTree from '../components/ChoiceTree';
import RecordingPlayer from '../components/RecordingPlayer';
import RecordingPrompt from '../components/RecordingPrompt';
import RecoveryPrompt from '../components/RecoveryPrompt';
import DivergenceModal from '../components/DivergenceModal';
import LaunchScreen from '../components/LaunchScreen';
import BookPageLayout from '../components/BookPageLayout';
import PictureBookImageDisplay from '../components/PictureBookImageDisplay';
import { AudioErrorBanner, ChapterSelector, ControlBar, CoverFullscreenOverlay, CoverThumbnail, SettingsPanel, SfxIndicator, StoryInfoPanel, TickerView, ViewSelector, VIEW_PRESETS } from '../components/story';
import { useQAChecks } from '../components/QAChecksPanel';
import { useRecordings } from '../hooks/useRecordings';
import { useLaunchSequence } from '../hooks/useLaunchSequence';
import { useStateRef, useSfxManager, useKeyboardShortcuts, useKaraokeHighlight, useStorySocket, useAutoContinue, useCoverArt, useCYOAState, useHeaderPanels, useStoryConfig } from '../hooks';
import { apiCall, API_BASE } from '../config';
import { initClientLogger, sfxLog, audioLog, socketLog } from '../utils/clientLogger';
import { stripAllTags, processTextForDisplay } from '../utils/textUtils';
import { AUTHOR_NAMES } from '../constants/authorStyles';
import { getMoodFromGenres, MOOD_ACCENTS } from '../constants/themes';
import { useTheme } from '../context/ThemeContext';
// Wake lock removed - was causing screen dimming issues

const SHOW_TEXT_STORAGE_KEY = 'narrimo_showText';
const LEGACY_SHOW_TEXT_STORAGE_KEY = 'storyteller_showText';
const KARAOKE_STORAGE_KEY = 'narrimo_karaokeEnabled';
const LEGACY_KARAOKE_STORAGE_KEY = 'storyteller_karaokeEnabled';
const FONT_SIZE_STORAGE_KEY = 'narrimo_fontSize';
const LEGACY_FONT_SIZE_STORAGE_KEY = 'storyteller_fontSize';
const TEXT_LAYOUT_STORAGE_KEY = 'narrimo_textLayout';
const LEGACY_TEXT_LAYOUT_STORAGE_KEY = 'storyteller_textLayout';

function Story() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { socket, connected, joinSession, leaveSession } = useSocket();
  const { isPlaying, isPaused, isStartingPlayback, playAudio, playUrl, queueAudio, pause, resume, stop, isUnlocked, hasPendingAudio, volume, setVolume, seekTo, currentTime, duration } = useAudio();
  const audioUnlockAttempted = useRef(false);

  const [session, setSession] = useState(null);
  const [currentScene, setCurrentScene] = useState(null);
  const [allScenes, setAllScenes] = useState([]); // All scenes for chapter selector
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ step: 0, percent: 0, message: '' });
  const [showText, setShowText] = useState(() => {
    try {
      const saved = localStorage.getItem(SHOW_TEXT_STORAGE_KEY);
      if (saved !== null) return JSON.parse(saved);

      const legacy = localStorage.getItem(LEGACY_SHOW_TEXT_STORAGE_KEY);
      if (legacy !== null) {
        localStorage.setItem(SHOW_TEXT_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_SHOW_TEXT_STORAGE_KEY);
        return JSON.parse(legacy);
      }

      return true;
    } catch {
      return true;
    }
  });
  const [karaokeEnabled, setKaraokeEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(KARAOKE_STORAGE_KEY);
      if (saved !== null) return JSON.parse(saved);

      const legacy = localStorage.getItem(LEGACY_KARAOKE_STORAGE_KEY);
      if (legacy !== null) {
        localStorage.setItem(KARAOKE_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_KARAOKE_STORAGE_KEY);
        return JSON.parse(legacy);
      }

      return true;
    } catch {
      return true;
    }
  });
  const [storyEnded, setStoryEnded] = useState(false);
  // Text size preference - persisted to localStorage
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      if (saved !== null) return parseInt(saved, 10);

      const legacy = localStorage.getItem(LEGACY_FONT_SIZE_STORAGE_KEY);
      if (legacy !== null) {
        localStorage.setItem(FONT_SIZE_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_FONT_SIZE_STORAGE_KEY);
        return parseInt(legacy, 10);
      }

      return 18;
    } catch {
      return 18;
    }
  });
  const [wordTimings, setWordTimings] = useState(null); // For karaoke/read-along text highlighting
  const [sceneImages, setSceneImages] = useState([]); // Picture book images for current scene

  // Mobile header collapse - auto-collapse on mobile when playing, user can toggle
  const [mobileHeaderExpanded, setMobileHeaderExpanded] = useState(true);

  // P1 FIX: Use ThemeContext for textLayout instead of local state
  // This ensures ControlBar buttons and BookPageLayout use the same state source
  // ThemeContext handles localStorage persistence automatically
  const { textLayout, setTextLayout, setFontSize: setThemeFontSize, setFontFamily, setLineHeight, showDialogueQuotes, dialogueQuoteStyle } = useTheme();

  // View preset state - tracks which reading preset is active (default, kindle, night, ticker)
  const [currentViewPreset, setCurrentViewPreset] = useState(() => {
    // Derive initial preset from textLayout
    if (textLayout === 'ticker') return 'ticker';
    return 'default';
  });

  // Keep preset in sync when layout is changed from other controls.
  useEffect(() => {
    if (textLayout === 'ticker' && currentViewPreset !== 'ticker') {
      setCurrentViewPreset('ticker');
    }
    if (textLayout !== 'ticker' && currentViewPreset === 'ticker') {
      setCurrentViewPreset('default');
    }
  }, [textLayout, currentViewPreset]);

  // Ticker mode state
  const [tickerPlaying, setTickerPlaying] = useState(false);
  const [tickerWordIndex, setTickerWordIndex] = useState(0);
  const [tickerWpm, setTickerWpm] = useState(300); // Words per minute

  // Note: currentWordIndex is computed by useKaraokeHighlight hook below

  // CYOA state - extracted to useCYOAState hook
  const {
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
    cyoaSettings,
    isCyoaEnabled,
    submitChoice,
    backtrackToCheckpoint: backtrackToCheckpointHook
  } = useCYOAState(sessionId, socket, { session, stopAudio: stop });

  // Header panel state - extracted to useHeaderPanels hook
  // Note: showChoiceHistory comes from useCYOAState (CYOA-specific)
  const {
    showStoryInfo,
    showSettings,
    setShowStoryInfo,
    setShowSettings,
    toggleStoryInfo: baseToggleStoryInfo,
    toggleSettings: baseToggleSettings
  } = useHeaderPanels();

  // Wrapped toggle functions that also close choice history
  const toggleStoryInfo = useCallback(() => {
    baseToggleStoryInfo();
    setShowChoiceHistory(false);
  }, [baseToggleStoryInfo, setShowChoiceHistory]);

  const toggleSettings = useCallback(() => {
    baseToggleSettings();
    setShowChoiceHistory(false);
  }, [baseToggleSettings, setShowChoiceHistory]);

  const toggleChoiceHistory = useCallback(() => {
    setShowChoiceHistory(prev => !prev);
    setShowStoryInfo(false);
    setShowSettings(false);
  }, [setShowChoiceHistory, setShowStoryInfo, setShowSettings]);

  // View preset change handler - applies preset settings
  const handleViewPresetChange = useCallback((presetId, preset) => {
    console.log('[Story] View preset changed:', presetId, preset);
    setCurrentViewPreset(presetId);

    // Apply preset settings
    if (preset?.settings) {
      if (preset.settings.fontSize) {
        setFontSize(preset.settings.fontSize);
        setThemeFontSize(preset.settings.fontSize);
      }
      if (preset.settings.fontFamily) {
        setFontFamily(preset.settings.fontFamily);
      }
      if (preset.settings.lineHeight) {
        setLineHeight(preset.settings.lineHeight);
      }
      // textLayout is handled by ViewSelector via ThemeContext
    }
  }, [setFontSize, setThemeFontSize, setFontFamily, setLineHeight]);

  // Story data state
  const [storyOutline, setStoryOutline] = useState(null);
  const [characters, setCharacters] = useState([]);

  // Normalize outline shape (API returns DB row with outline_json).
  const outlineData = useMemo(() => {
    // If we already have a normalized outline object, keep it.
    if (storyOutline && typeof storyOutline === 'object' && (storyOutline.title || storyOutline.synopsis || storyOutline.acts)) {
      return storyOutline;
    }

    const raw = storyOutline?.outline_json ?? storyOutline?.outlineJson ?? null;
    if (!raw) return null;

    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.warn('[Story] Failed to parse outline_json:', err);
      return null;
    }
  }, [storyOutline]);

  const outlineSynopsisText = useMemo(() => {
    const candidate = outlineData?.synopsis ?? outlineData?.summary ?? outlineData?.logline ?? '';
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate === 'object') {
      return candidate.synopsis || candidate.summary || candidate.logline || '';
    }
    return '';
  }, [outlineData]);

  const outlineSettingText = useMemo(() => {
    const setting = outlineData?.setting;
    if (!setting) return '';
    if (typeof setting === 'string') return setting;
    if (typeof setting === 'object') return setting.description || setting.location || setting.name || '';
    return '';
  }, [outlineData]);

  const outlineThemes = useMemo(() => {
    const themes = outlineData?.themes ?? storyOutline?.themes ?? [];
    return Array.isArray(themes) ? themes : [];
  }, [outlineData, storyOutline]);

  // Cover state - extracted to useCoverArt hook
  const {
    coverUrl,
    setCoverUrl,
    isGeneratingCover,
    showCoverFullscreen,
    generateCover,
    openFullscreen: openCoverFullscreen,
    closeFullscreen: closeCoverFullscreen
  } = useCoverArt(sessionId);

  // Config and saving state - extracted to useStoryConfig hook
  const {
    config,
    authorStyleName,
    updateConfig,
    handleVoiceSelect,
    handleNarratorStyleChange,
    saveStory: saveStoryConfig
  } = useStoryConfig(sessionId, session, setSession);

  // Genre-to-mood auto-detection - computes accent color from story genres
  const moodAccent = useMemo(() => {
    if (config.genres && typeof config.genres === 'object') {
      return getMoodFromGenres(config.genres);
    }
    // Fallback: try to infer from single genre field
    if (config.genre) {
      const genreMap = { [config.genre.toLowerCase()]: 100 };
      return getMoodFromGenres(genreMap);
    }
    return MOOD_ACCENTS.neutral;
  }, [config.genres, config.genre]);

  const [audioError, setAudioError] = useState(null); // For displaying audio generation errors

  // SFX management - extracted to useSfxManager hook
  // Pass isPlaying and storyEnded to enable auto-stop when narration ends
  const {
    sfxEnabled,
    activeSfx,
    playSfx,
    stopAllSfx,
    toggleSfx,
    setSfxEnabled,
    sfxEnabledRef
  } = useSfxManager({ initialEnabled: true, isPlaying, storyEnded });
  const prevWordTimingsRef = useRef(null); // Track wordTimings changes for SFX timing
  const lastSavedSceneRef = useRef(null);
  const outlineContinuePendingRef = useRef(false); // Continue only after outline_complete event
  // Using useStateRef to combine state+ref (avoids stale closure issues)
  const [sceneAudioStarted, setSceneAudioStarted, sceneAudioStartedRef] = useStateRef(false);
  const sfxDetailsRef = useRef(null); // Ref version of sfxDetails for callback access (from useLaunchSequence)
  const [introAudioQueued, setIntroAudioQueued] = useState(false); // Track if intro (synopsis) was queued
  const [playbackRequested, setPlaybackRequested] = useState(false); // Begin Chapter clicked; waiting for audio
  // P0 FIX: Guard against duplicate autoplay triggers
  const autoplayTriggeredRef = useRef(false);

  // P0 FIX: Reset autoplay guard when session changes (new story or chapter)
  useEffect(() => {
    autoplayTriggeredRef.current = false;
  }, [sessionId]);

  // Karaoke word highlighting - computed from wordTimings and audio state
  const currentWordIndex = useKaraokeHighlight({
    wordTimings,
    currentTime,
    isPlaying,
    isPaused,
    showText,
    isSceneAudio: sceneAudioStarted
  });
  const [sceneAudioQueued, setSceneAudioQueued] = useState(false); // Track if scene audio was queued (for SFX trigger)
  const [manualContinue, setManualContinue] = useState(false); // Track if user manually clicked Next (disable autoplay)

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

  // Launch sequence hook - manages pre-narration validation (simplified flow, no countdown)
  const {
    isActive: launchActive,
    stageStatuses,
    stageDetails,
    isReady: launchReady,
    stats: launchStats,
    scene: launchScene,
    error: launchError,
    warnings: launchWarnings,
    isReadyToPlay,
    // Audio queued state (bridges audio-ready to playback-started)
    isAudioQueued,
    setIsAudioQueued,
    // Audio generation (deferred TTS after Begin Chapter)
    isGeneratingAudio,
    audioGenerationStatus,
    // Pre-synthesized audio (unified progress)
    preloadedAudio,
    setPreloadedAudio,
    autoplayEnabled,
    setAutoplayEnabled,
    allStagesComplete,
    hasError: launchHasError,
    currentStage,
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
    launchProgress,
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
          scene_id: data.scene.id,
          scene_index: Number.isFinite(data.scene.sequence_index)
            ? data.scene.sequence_index
            : Number.isFinite(data.scene.index)
              ? data.scene.index
              : 0
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

  // Memoize errors array to prevent LaunchScreen re-renders
  const launchErrors = useMemo(() => {
    return launchError ? [launchError] : [];
  }, [launchError]);

  // QA checks hook - bridges socket events to QAChecksPanel
  useQAChecks(socket);

  // Initialize client logger when socket is available
  useEffect(() => {
    if (socket) {
      initClientLogger(socket);
      socketLog.info('CLIENT_LOGGER_INIT | page: Story.jsx');
    }
  }, [socket]);

  // Note: Auto-continue refs (pendingAutoContinue, wasPlayingRef, etc.) are now managed by useAutoContinue hook
  // Note: cyoaSettings and isCyoaEnabled are now provided by useCYOAState hook

  // SFX ref sync - sfxDetails comes from useLaunchSequence hook
  useEffect(() => {
    sfxDetailsRef.current = sfxDetails;
  }, [sfxDetails]);

  // Wrapper to pass audio state and duration to playSfx hook
  const playSfxWithState = useCallback((sfxList, audioDurationSeconds = null) => {
    // Calculate audio duration from word timings if not provided
    const duration = audioDurationSeconds ||
      (wordTimings?.total_duration_ms ? wordTimings.total_duration_ms / 1000 : 40);

    playSfx(sfxList, {
      introAudioQueued,
      sceneAudioStarted: sceneAudioStartedRef.current,
      audioDurationSeconds: duration
    });
  }, [playSfx, introAudioQueued, wordTimings]);

  // Save progress when a new scene loads so the library updates immediately
  useEffect(() => {
    if (!currentScene?.scene_id) return;
    if (lastSavedSceneRef.current === currentScene.scene_id) return;
    lastSavedSceneRef.current = currentScene.scene_id;
    saveStoryConfig(currentScene);
  }, [currentScene, saveStoryConfig]);

  // Auto-save progress periodically
  useEffect(() => {
    if (!session?.id || !currentScene) return;

    const saveProgress = async () => {
      try {
        await saveStoryConfig(currentScene, 30); // approximate 30 seconds per check
      } catch (err) {
        console.warn('[Save] Failed to save progress:', err);
      }
    };

    const interval = setInterval(saveProgress, 30000); // Save every 30 seconds
    return () => clearInterval(interval);
  }, [session?.id, currentScene, saveStoryConfig]);

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

  // Stop SFX when story ends
  useEffect(() => {
    if (storyEnded) {
      stopAllSfx();
    }
  }, [storyEnded, stopAllSfx]);

  // Persist font size to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSize.toString());
      localStorage.removeItem(LEGACY_FONT_SIZE_STORAGE_KEY);
    } catch (err) {
      console.warn('[Story] Failed to save fontSize to localStorage:', err);
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_TEXT_STORAGE_KEY, JSON.stringify(showText));
      localStorage.removeItem(LEGACY_SHOW_TEXT_STORAGE_KEY);
    } catch (err) {
      console.warn('[Story] Failed to save showText to localStorage:', err);
    }
  }, [showText]);

  useEffect(() => {
    try {
      localStorage.setItem(KARAOKE_STORAGE_KEY, JSON.stringify(karaokeEnabled));
      localStorage.removeItem(LEGACY_KARAOKE_STORAGE_KEY);
    } catch (err) {
      console.warn('[Story] Failed to save karaoke setting to localStorage:', err);
    }
  }, [karaokeEnabled]);

  // BUGFIX: Handle Scene 1 choices from launch sequence
  // Choices are delivered via launchScene but need to be set in pendingChoices
  // This runs once when launch completes and launchScene has choices
  useEffect(() => {
    if (launchReady && launchScene?.choices?.length > 0 && pendingChoices.length === 0 && choices.length === 0) {
      console.log('[Story] Scene 1 choices detected from launch sequence, setting pendingChoices:', launchScene.choices.length);
      setPendingChoices(launchScene.choices);
    }
  }, [launchReady, launchScene, pendingChoices.length, choices.length, setPendingChoices]);

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

  // BUGFIX: Fallback to show choices when no choice audio is expected
  // If scene audio FINISHES and we have pending choices but no choice audio is playing,
  // show the choices after a short delay (choice narration may have failed or been skipped)
  // CRITICAL FIX: Must wait for isPlaying=false (audio finished), not just sceneAudioStarted=true (audio started)
  // Otherwise choices appear while narration is still playing!
  useEffect(() => {
    // Don't start timer if:
    // - Scene audio hasn't started yet
    // - Audio is still playing (narration not finished)
    // - Choice audio is playing
    // - No pending choices
    // - Choices already shown
    if (!sceneAudioStarted || isPlaying || choiceAudioPlaying || pendingChoices.length === 0 || choices.length > 0) {
      return;
    }
    // Scene audio has finished (isPlaying=false after sceneAudioStarted=true)
    // Wait a moment for choice audio event, then show choices if none arrives
    const fallbackTimer = setTimeout(() => {
      if (pendingChoices.length > 0 && choices.length === 0 && !choiceAudioPlaying) {
        console.log('[Story] Choice audio fallback - showing choices after narration finished');
        setChoices(pendingChoices);
        setPendingChoices([]);
      }
    }, 2000);
    return () => clearTimeout(fallbackTimer);
  }, [sceneAudioStarted, isPlaying, choiceAudioPlaying, pendingChoices, choices.length, setChoices, setPendingChoices]);

  // Clear "playback requested" once SCENE audio starts.
  // Intro/synopsis audio may play while scene narration is still generating.
  // Keeping playbackRequested=true allows us to show progress after intro ends.
  useEffect(() => {
    if (sceneAudioStarted) {
      setPlaybackRequested(false);
    }
  }, [sceneAudioStarted]);

  // NOTE: wasPlayingRef tracking moved to auto-continue effect below continueStory definition

  // Socket event listeners

  // Handle starting playback after countdown - uses launch sequence hook
  // NOTE: SFX is triggered separately when wordTimings change (indicates scene audio started)
  const handleStartPlayback = useCallback(() => {
    if (!socket || !sessionId) return;

    // P0 FIX: Enhanced logging for debugging preloaded audio issues
    console.log('[Story] handleStartPlayback | preloadedAudio:', !!preloadedAudio, '| hasAudio:', preloadedAudio?.hasAudio, '| hasIntro:', !!preloadedAudio?.intro, '| hasScene:', !!preloadedAudio?.scene);
    setManualContinue(false); // Reset manual continue flag - user clicked Begin Chapter
    setPlaybackRequested(true);

    // Check if we have preloaded audio from unified progress bar
    // This eliminates the second "Synthesizing" progress bar
    if (preloadedAudio && preloadedAudio.hasAudio) {
      console.log('[Story] USING_PRELOADED_AUDIO | hasIntro:', !!preloadedAudio.intro, '| hasScene:', !!preloadedAudio.scene, '| segments:', preloadedAudio.totalSegments);

      // Queue intro audio first (title/synopsis narration)
      if (preloadedAudio.intro && preloadedAudio.intro.base64) {
        console.log('[Audio] Queueing preloaded intro audio');
        setIntroAudioQueued(true);
        setSceneAudioStarted(false);
        sceneAudioStartedRef.current = false;
        queueAudio(
          preloadedAudio.intro.base64,
          'mp3', // ElevenLabs returns mp3
          // onStart callback
          () => {
            console.log('[Audio] STATE: INTRO_QUEUED → INTRO_PLAYING | preloaded intro started');
          },
          // onEnd callback
          () => {
            console.log('[Audio] STATE: INTRO_PLAYING → INTRO_COMPLETE | preloaded intro finished');
            setIntroAudioQueued(false);
          }
        );
      }

      // Queue scene audio (main narration)
      if (preloadedAudio.scene && preloadedAudio.scene.base64) {
        console.log('[Audio] Queueing preloaded scene audio');

        // Store word timings for karaoke/read-along feature
        if (preloadedAudio.scene.wordTimings) {
          const wordCount = preloadedAudio.scene.wordTimings.words?.length || preloadedAudio.scene.wordTimings.word_count || 0;
          console.log('[Audio] WORD_TIMINGS_DEBUG (preloaded) | count:', wordCount);
          setWordTimings(preloadedAudio.scene.wordTimings);
        } else {
          // Fail loud: karaoke data missing; prevent playback
          setWordTimings(null);
          setAudioError('Audio ready but word timings missing; cannot start playback. Please retry generation.');
          setIsAudioQueued(false);
          setPlaybackRequested(false);
          return;
        }

        setSceneAudioQueued(true);
        queueAudio(
          preloadedAudio.scene.base64,
          'mp3',
          // onStart callback - scene audio begins
          () => {
            console.log('[Audio] STATE: SCENE_QUEUED → SCENE_PLAYING | preloaded scene started');
            if (!sceneAudioStartedRef.current) {
              sceneAudioStartedRef.current = true;
              setSceneAudioStarted(true);
              setIsAudioQueued(false);

              // Trigger SFX with actual audio duration for accurate timing
              const sfxList = sfxDetails?.sfxList;
              const audioDurationSeconds = preloadedAudio.scene.wordTimings?.total_duration_ms
                ? preloadedAudio.scene.wordTimings.total_duration_ms / 1000
                : null;
              if (sfxList && sfxList.length > 0 && sfxEnabled) {
                console.log('[SFX] TRIGGER_SUCCESS | source: preloaded_audio | effects:', sfxList.length);
                playSfxWithState(sfxList, audioDurationSeconds);
              }
            }
          },
          // onEnd callback - scene audio finished
          () => {
            console.log('[Audio] STATE: SCENE_PLAYING → SCENE_COMPLETE | preloaded scene finished');
          }
        );
      }

      // PRE-GENERATION FIX: Queue choice narration audio (plays after scene audio)
      // This ensures all audio is pre-generated and plays in sequence: intro → scene → choice narration
      if (preloadedAudio.choice && preloadedAudio.choice.base64) {
        console.log('[Audio] Queueing preloaded choice narration audio | choiceCount:', preloadedAudio.choice.choiceCount);
        queueAudio(
          preloadedAudio.choice.base64,
          'mp3',
          // onStart callback - choice audio begins
          () => {
            console.log('[Audio] STATE: CHOICE_AUDIO_PLAYING | preloaded choice narration started');
            setChoiceAudioPlaying(true);
          },
          // onEnd callback - choice audio finished, show choices
          () => {
            console.log('[Audio] STATE: CHOICE_AUDIO_COMPLETE | showing choices');
            setChoiceAudioPlaying(false);
            // Show pending choices now that narration is complete
            if (pendingChoices.length > 0) {
              setChoices(pendingChoices);
              setPendingChoices([]);
            }
          }
        );
      }

      // Clear preloaded audio after use (one-time use)
      setPreloadedAudio(null);
      return;
    }

    // Fallback: No preloaded audio - request server-side audio generation
    // DUAL PROGRESS BAR FIX (2026-01-31): This now uses the SAME progress UI
    // The launch screen stays visible (isActive=true) until audio-ready is received
    console.log('[Story] NO_PRELOADED_AUDIO | Triggering deferred TTS generation | LaunchScreen will show progress');
    triggerPlayback();
    // SFX is NOT triggered here - it triggers when wordTimings change (scene audio ready)
  }, [socket, sessionId, triggerPlayback, preloadedAudio, setPreloadedAudio, queueAudio, setIntroAudioQueued, setSceneAudioStarted, setSceneAudioQueued, setIsAudioQueued, setWordTimings, sfxDetails, sfxEnabled, playSfxWithState, pendingChoices, setChoices, setPendingChoices, setChoiceAudioPlaying]);

  // Cancel playback - uses launch sequence hook
  const handleCancelPlayback = useCallback(() => {
    console.log('[Story] Cancelling launch sequence...');
    setPlaybackRequested(false);
    cancelLaunch();
  }, [cancelLaunch]);

  // Text-only mode - skip audio generation, just show text
  const handleStartTextOnly = useCallback(() => {
    console.log('[Story] Starting text-only mode (no audio)...');

    // Enable text display
    setShowText(true);

    // Set the current scene from launch scene data
    if (launchScene) {
      const sceneIndex = Number.isFinite(launchScene.sequence_index)
        ? launchScene.sequence_index
        : Number.isFinite(launchScene.index)
          ? launchScene.index
          : 0;
      setCurrentScene({
        ...launchScene,
        scene_id: launchScene.id || launchScene.scene_id,
        scene_index: sceneIndex,
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
  }, [launchScene, sfxEnabled, sfxDetails, playSfxWithState, resetLaunch]);

  // Continue story functions - MUST be defined before socket useEffect that references them
  const continueStoryWithVoice = useCallback((voiceId, { force = false } = {}) => {
    if (!socket) return;
    if (isGenerating && !force) {
      console.log('[Story] Continue blocked: generation already in progress');
      return;
    }
    console.log('[Audio] STATE: reset to IDLE | reason: continue_story_reset | resetting all audio flags');
    // Reset launch sequence state for new scene
    resetLaunch();
    // Reset word timings for new scene (karaoke hook auto-resets when wordTimings is null)
    setWordTimings(null);
    // Reset SFX trigger flags for new scene
    setSceneAudioStarted(false);
    sceneAudioStartedRef.current = false;
    setSceneAudioQueued(false);
    setIntroAudioQueued(false);
    // Note: Auto-continue timer/lock state is managed internally by useAutoContinue hook
    // The hook's effect cleanup handles reset when isGenerating changes

    console.log('[Socket:Emit] EVENT: continue-story | session_id:', sessionId, '| voice_id:', voiceId, '| autoplay:', autoplayEnabled);
    socket.emit('continue-story', {
      session_id: sessionId,
      voice_id: voiceId,
      autoplay: autoplayEnabled
    });
    setIsGenerating(true);
    setGenerationProgress({ step: 1, percent: 5, message: 'Starting story generation...' });
  }, [socket, sessionId, isGenerating, autoplayEnabled, resetLaunch]);

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
  const jumpToScene = useCallback((chapterNumber) => {
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
    sceneAudioStartedRef.current = false;
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
  }, [allScenes, stop, stopAllSfx]);

  // Socket event handlers - extracted to useStorySocket hook
  useStorySocket({
    socket,
    sessionId,
    session,
    audioContext: { playAudio, queueAudio, pause, resume },
    sfxContext: { playSfxWithState, sfxEnabledRef, sfxDetailsRef, stopAllSfx },
    stateSetters: {
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
      setStoryEnded // P0 FIX: Pass to enable server-side story completion handling
    },
    refs: { sceneAudioStartedRef },
    callbacks: { continueStory, resetLaunch },
    pendingChoices,
    launchActive
  });

  // generateCover is now provided by useCoverArt hook

  const generateOutlineAndStart = useCallback(async () => {
    setIsGenerating(true);
    setGenerationProgress({ step: 0, percent: 5, message: 'Generating outline...' });
    outlineContinuePendingRef.current = true;
    try {
      const response = await apiCall(`/stories/${sessionId}/generate-outline`, { method: 'POST' });
      if (!response.ok) {
        outlineContinuePendingRef.current = false;
        setIsGenerating(false);
        setGenerationProgress({ step: 0, percent: 0, message: '' });

        // Handle auth errors
        if (response.status === 401 || response.status === 403) {
          setAudioError('Sign in to generate stories.');
          return;
        }

        // Handle other HTTP errors
        try {
          const errorData = await response.json();
          const errorMessage = errorData.error?.message || errorData.error || `Server error: ${response.statusText}`;
          setAudioError(`Failed to generate story: ${errorMessage}`);
        } catch {
          setAudioError(`Failed to generate story: ${response.statusText || 'Unknown error'}`);
        }
        return;
      }
    } catch (error) {
      outlineContinuePendingRef.current = false;
      setIsGenerating(false);
      setGenerationProgress({ step: 0, percent: 0, message: '' });
      const errorMsg = error?.message || 'Network error occurred';
      setAudioError(`Failed to generate story: ${errorMsg}`);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!outlineContinuePendingRef.current) return;
    const message = generationProgress?.message || '';
    if (generationProgress?.percent >= 20 && message.toLowerCase().includes('outline ready')) {
      outlineContinuePendingRef.current = false;
      const voiceId = session?.config_json?.voice_id || session?.config_json?.narratorVoice;
      continueStoryWithVoice(voiceId, { force: true });
    }
  }, [generationProgress, session?.config_json, continueStoryWithVoice]);

  const fetchSession = useCallback(async () => {
    try {
      const response = await apiCall(`/stories/${sessionId}`);
      const data = await response.json();
      setSession(data.session);
      setCoverUrl(data.session?.cover_image_url);

      if (data.outline) setStoryOutline(data.outline);
      if (data.characters?.length > 0) setCharacters(data.characters);

      if (data.scenes?.length > 0) {
        // Store all scenes for chapter selector (includes audio_url for "played" detection)
        setAllScenes(data.scenes);

        const lastScene = data.scenes[data.scenes.length - 1];
        setCurrentScene({
          text: stripAllTags(lastScene.polished_text || lastScene.summary),
          mood: lastScene.mood,
          scene_id: lastScene.id,
          scene_index: lastScene.sequence_index,
          // P0 FIX: Include audio_url and word_timings for story replay
          audio_url: lastScene.audio_url,
          word_timings: lastScene.word_timings
        });

        // Restore karaoke timings if available (enables read-along after refresh).
        if (lastScene.word_timings?.words?.length > 0) {
          setWordTimings(lastScene.word_timings);
        }
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

  // P0 FIX: Replay mode - play stored audio for existing stories loaded from library
  // This effect triggers when a user loads a story that already has audio generated
  useEffect(() => {
    // Guard conditions: only play if we have stored audio and NOT in generation/launch mode
    if (!currentScene?.audio_url) return;
    if (isGenerating || launchActive || sceneAudioStarted) return;
    if (isPlaying || isPaused) return; // Don't restart if already playing/paused

    console.log('[Story] Replay mode: detected stored audio_url, preparing playback');

    // Construct full URL if relative path
    const fullUrl = currentScene.audio_url.startsWith('http')
      ? currentScene.audio_url
      : `${window.location.origin}${currentScene.audio_url}`;

    // Play stored audio directly using playUrl
    // Note: queueAudio expects (audioData, format, onStart, onEnd) - not an options object
    const playStoredAudio = async () => {
      try {
        console.log('[Story] Replay mode: playing stored audio:', fullUrl);

        // Request picture book images if this is a picture book story
        // This triggers server-side generation or retrieval of scene images
        if (session?.config_json?.story_format === 'picture_book' && currentScene?.scene_id && socket) {
          console.log('[Story] Replay mode: requesting picture book images for scene', currentScene.scene_id);
          socket.emit('request-picture-book-images', {
            session_id: sessionId,
            scene_id: currentScene.scene_id
          });
        }

        await playUrl(fullUrl);
        // Set state after playUrl resolves (audio has started playing)
        console.log('[Audio] Replay: stored audio playback started');
        setSceneAudioStarted(true);
        sceneAudioStartedRef.current = true;
      } catch (error) {
        console.error('[Story] Replay mode: failed to play stored audio:', error);
        setAudioError('Failed to play stored audio. Try regenerating the chapter.');
      }
    };

    // Small delay to ensure UI is ready
    const timer = setTimeout(playStoredAudio, 100);
    return () => clearTimeout(timer);
  }, [currentScene?.audio_url, currentScene?.scene_id, isGenerating, launchActive, sceneAudioStarted, isPlaying, isPaused, playUrl, session?.config_json?.story_format, sessionId, socket]);

  // Effect for autoplay when countdown finishes and autoplay is enabled
  // The useLaunchSequence hook handles autoplay internally, but we listen for playback start
  // IMPORTANT: Only auto-start if session config is loaded AND autoplay is explicitly true
  // AND user didn't manually click "Next" (manualContinue flag)
  // P0 FIX: Use autoplayTriggeredRef to prevent duplicate autoplay triggers
  useEffect(() => {
    // Must have session loaded to check config
    if (!session?.config_json) {
      console.log('[Story] Autoplay check: waiting for session config to load');
      return;
    }

    // Only auto-start if explicitly enabled in config
    const configAutoplay = session.config_json.autoplay === true;

    // If user manually clicked Next, ALWAYS show Begin Chapter button (don't autoplay)
    // This gives consistent UX: user clicks Next -> sees Begin Chapter X -> clicks to start
    if (manualContinue) {
      if (isReadyToPlay && launchStats) {
        console.log('[Story] Manual continue mode - showing Begin Chapter button, waiting for user click');
      }
      return; // Don't auto-start - user must click Begin Chapter
    }

    // P0 FIX: Guard against duplicate autoplay triggers using persistent ref
    if (isReadyToPlay && configAutoplay && launchStats && !autoplayTriggeredRef.current) {
      console.log('[Story] Autoplay enabled in config, starting playback...');
      autoplayTriggeredRef.current = true; // Mark as triggered BEFORE calling handler
      handleStartPlayback();
    } else if (isReadyToPlay && launchStats && !autoplayTriggeredRef.current) {
      console.log('[Story] Ready to play, but autoplay disabled - waiting for user to click Begin Chapter');
    }
  }, [isReadyToPlay, session?.config_json, launchStats, handleStartPlayback, manualContinue]);

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
      audioLog.info('STATE: * -> SCENE_PLAYING | source: karaoke_word_0');
      sfxLog.info(`TRIGGER_SUCCESS | source: karaoke_effect | effects: ${sfxList.length} | keys: ${sfxList.map(s => s.sfx_key || s.sfxKey).join(', ')}`);
      setSceneAudioStarted(true);
      sceneAudioStartedRef.current = true;
      // Clear audio queued state - LaunchScreen can now hide
      setIsAudioQueued(false);
      playSfxWithState(sfxList);
    }
  }, [currentWordIndex, wordTimings, sfxDetails, sfxEnabled, playSfxWithState, sceneAudioStarted, introAudioQueued, sceneAudioQueued]);

  // Reset sceneAudioQueued after SFX has triggered (ready for next scene)
  useEffect(() => {
    if (sceneAudioStarted && sceneAudioQueued) {
      // SFX triggered - reset queued flag so next scene can queue again
      audioLog.info('RESET | sceneAudioQueued=false | reason: sfx_triggered');
      setSceneAudioQueued(false);
    }
  }, [sceneAudioStarted, sceneAudioQueued]);

  // Auto-collapse header on mobile when audio starts playing (maximize reading area)
  useEffect(() => {
    if (isPlaying && window.innerWidth < 640) {
      setMobileHeaderExpanded(false);
    }
  }, [isPlaying]);

  // Auto-continue story when audio finishes - extracted to useAutoContinue hook
  // Uses continueStoryAuto which respects autoplay setting (vs manual continueStory which requires Begin Chapter click)
  const { pendingAutoContinue } = useAutoContinue({
    isPlaying,
    isPaused,
    isGenerating,
    socket,
    continueStory: continueStoryAuto, // Use auto-continue function for automatic progression
    stopAllSfx,
    setIsGenerating,
    choices,
    pendingChoices,
    storyEnded,
    currentScene,
    autoplayEnabled
  });

  // Note: Karaoke word highlighting is now handled by useKaraokeHighlight hook
  // Note: submitChoice is now provided by useCYOAState hook

  // Wrapper for backtrackToCheckpoint that provides setCurrentScene
  const backtrackToCheckpoint = useCallback((checkpointIndex) => {
    return backtrackToCheckpointHook(checkpointIndex, setCurrentScene);
  }, [backtrackToCheckpointHook]);

  const togglePause = useCallback(() => {
    if (isPlaying) {
      socket?.emit('pause-story', { session_id: sessionId });
    } else if (isPaused) {
      socket?.emit('resume-story', { session_id: sessionId });
    } else if (isReadyToPlay) {
      // Handle initial playback start when ready but not yet playing
      console.log('[Story] togglePause: Starting playback from ready state');
      handleStartPlayback();
    } else if (currentScene?.scene_id && !isGeneratingAudio) {
      // Handle existing story - request audio for current scene
      console.log('[Story] togglePause: Requesting audio for existing scene', currentScene.scene_id);
      setPlaybackRequested(true);
      socket?.emit('request-scene-audio', {
        session_id: sessionId,
        scene_id: currentScene.scene_id
      });
    }
  }, [isPlaying, isPaused, isReadyToPlay, socket, sessionId, handleStartPlayback, currentScene, isGeneratingAudio]);

  const endStory = useCallback(async () => {
    try {
      // P0 FIX: Set storyEnded FIRST to stop all SFX before cleanup
      setStoryEnded(true);
      stopAllSfx();

      await apiCall(`/stories/${sessionId}/end`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'user_ended' })
      });
      navigate('/');
    } catch (error) {
      console.error('Failed to end story:', error);
    }
  }, [sessionId, navigate, stopAllSfx]);

  const goHome = useCallback(() => {
    // P0 FIX: Set storyEnded to ensure SFX stop completely
    setStoryEnded(true);
    stop();
    stopAllSfx();
    navigate('/');
  }, [stop, stopAllSfx, navigate]);

  // Keyboard shortcut handlers
  const handleToggleMute = useCallback(() => setVolume(volume > 0 ? 0 : 1), [volume, setVolume]);
  const handleToggleText = useCallback(() => setShowText(prev => !prev), []);

  // Global keyboard shortcuts - Space: pause, ArrowRight: continue, M: mute, T: text, Escape: home
  useKeyboardShortcuts({
    onTogglePause: togglePause,
    onContinue: continueStory,
    onToggleMute: handleToggleMute,
    onToggleText: handleToggleText,
    onGoHome: goHome,
    canContinue: !isGenerating && choices.length === 0
  });

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

  // Fullscreen cover overlay
  if (showCoverFullscreen && coverUrl) {
    return (
      <CoverFullscreenOverlay
        coverUrl={coverUrl}
        title={session?.title}
        authorStyleName={authorStyleName}
        synopsis={outlineSynopsisText}
        onClose={closeCoverFullscreen}
      />
    );
  }

  // Determine if story header should be hidden (clearer than complex boolean)
  // Hide during: generation or launch screen active (but NOT when ready to play - user needs to see story context)
  // FIX: Removed isReadyToPlay from this condition so title/cover/synopsis show when ready to play
  const shouldHideStoryHeader = isGenerating || launchActive || (isAudioQueued && !sceneAudioStarted && !isReadyToPlay);

  return (
    <div
      className="min-h-screen flex flex-col relative"
      data-mood={moodAccent.id}
      style={{
        '--mood-accent': moodAccent.accent,
        '--mood-glow': moodAccent.glow,
        ...(coverUrl ? {
          backgroundImage: `linear-gradient(to bottom, rgba(10,10,15,0.85), rgba(10,10,15,0.95)), url(${coverUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top'
        } : {})
      }}
    >
      {/* Audio Error Banner */}
      <AudioErrorBanner error={audioError} onDismiss={() => setAudioError(null)} />

      {/* Enhanced Header with Story Details */}
      <header className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-700">
        {/* Top Bar */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <button onClick={goHome} className="p-2 rounded-full hover:bg-slate-800">
              <Home className="w-5 h-5 text-slate-300" />
            </button>

            {/* Cover Thumbnail - clickable to expand */}
            {coverUrl && !shouldHideStoryHeader && (
              <CoverThumbnail
                coverUrl={coverUrl}
                title={session?.title || 'Story Cover'}
                size="small"
                onExpand={openCoverFullscreen}
              />
            )}

            {/* View Preset Icons */}
            {!shouldHideStoryHeader && (
              <ViewSelector
                currentPreset={currentViewPreset}
                onPresetChange={handleViewPresetChange}
                compact={true}
              />
            )}

            {/* Font Size Controls */}
            {!shouldHideStoryHeader && (
              <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-lg px-1 py-0.5">
                <button
                  onClick={() => {
                    const newSize = Math.max(12, fontSize - 2);
                    setFontSize(newSize);
                    setThemeFontSize(newSize);
                  }}
                  disabled={fontSize <= 12}
                  className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Decrease font size"
                >
                  <Minus className="w-3.5 h-3.5 text-slate-300" />
                </button>
                <span className="text-xs text-slate-300 w-6 text-center font-mono">{fontSize}</span>
                <button
                  onClick={() => {
                    const newSize = Math.min(32, fontSize + 2);
                    setFontSize(newSize);
                    setThemeFontSize(newSize);
                  }}
                  disabled={fontSize >= 32}
                  className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Increase font size"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-300" />
                </button>
              </div>
            )}
          </div>

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
                    : 'hover:bg-slate-800'
                }`}
                title={showRecordingPlayer ? 'Exit recording playback' : 'Play recording (no wait)'}
              >
                <Disc className={`w-5 h-5 ${showRecordingPlayer ? 'text-green-400 animate-spin-slow' : 'text-green-400'}`} />
                {!showRecordingPlayer && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                )}
              </button>
            )}

            {/* SFX Toggle */}
            <button onClick={toggleSfx} className={`p-2 rounded-full ${sfxEnabled ? 'hover:bg-slate-800' : 'bg-slate-700'}`}>
              {sfxEnabled ? <Volume2 className="w-5 h-5 text-cyan-400" /> : <VolumeX className="w-5 h-5 text-slate-500" />}
            </button>

            {/* Story Info */}
            <button
              onClick={toggleStoryInfo}
              className={`p-2 rounded-full ${showStoryInfo ? 'bg-blue-500/20 border border-blue-500' : 'hover:bg-slate-800'}`}
            >
              <BookOpen className="w-5 h-5 text-blue-400" />
            </button>

            {/* Settings */}
            <button
              onClick={toggleSettings}
              className={`p-2 rounded-full ${showSettings ? 'bg-golden-400/20 border border-golden-400' : 'hover:bg-slate-800'}`}
            >
              <Settings className="w-5 h-5 text-golden-400" />
            </button>

            {/* CYOA History */}
            {isCyoaEnabled && choiceHistory.length > 0 && (
              <button
                onClick={toggleChoiceHistory}
                className={`p-2 rounded-full ${showChoiceHistory ? 'bg-amber-500/20 border border-amber-500' : 'hover:bg-slate-800'}`}
              >
                <History className="w-5 h-5 text-amber-400" />
              </button>
            )}

            {/* User Profile */}
            <UserProfile />
          </div>
        </div>

        {/* Story Title & Details - Hide when LaunchScreen is visible to avoid duplicate titles */}
        {/* Extracted boolean logic for clarity: show header only when NOT in any overlay/launch phase */}
        {/* On mobile: collapsible to maximize reading area; always visible on desktop (sm+) */}
        {!shouldHideStoryHeader && (
          <>
            {/* Mobile collapse toggle - only visible on mobile */}
            <button
              onClick={() => setMobileHeaderExpanded(!mobileHeaderExpanded)}
              className="sm:hidden w-full py-1 flex items-center justify-center gap-1 text-slate-500 hover:text-slate-300 transition-colors"
              aria-expanded={mobileHeaderExpanded}
              aria-label={mobileHeaderExpanded ? 'Collapse story details' : 'Expand story details'}
            >
              {mobileHeaderExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  <span className="text-xs">Collapse</span>
                </>
              ) : (
                <>
                  <span className="text-xs truncate max-w-[200px]">{session?.title || 'Story'}</span>
                  <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Collapsible content - hidden on mobile when collapsed, always visible on desktop */}
            <div className={`px-4 pb-3 text-center transition-all duration-300 overflow-hidden ${
              mobileHeaderExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 sm:max-h-[500px] sm:opacity-100'
            }`}>
              <h1 className="text-3xl md:text-4xl font-bold text-golden-400 mb-2 leading-tight">
                {session?.title || outlineData?.title || launchStats?.title || 'Creating your story...'}
              </h1>

              {/* Meta Tags */}
              <div className="flex items-center justify-center gap-2 flex-wrap text-sm">
                {config.story_type && (
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    config.story_type === 'cyoa' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {config.story_type === 'cyoa' ? 'Choose Your Own Adventure' : config.story_type}
                  </span>
                )}
                {config.genre && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">{config.genre}</span>
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
                  <span className="text-slate-400 text-xs px-2 py-0.5 rounded-full bg-slate-700">
                    Mood: {currentScene.mood}
                  </span>
                )}
              </div>

              {/* Synopsis */}
              {outlineSynopsisText && (
                <p className="text-slate-400 text-sm mt-2 max-w-lg mx-auto line-clamp-2">
                  {outlineSynopsisText}
                </p>
              )}

              {/* Scene Counter with Progress Bar */}
              {currentScene && (
                <div className="mt-3 max-w-xs mx-auto">
                  <div className="text-slate-500 text-xs mb-1">
                    {isCyoaEnabled
                      ? `Chapter ${(currentScene.scene_index !== undefined ? currentScene.scene_index : 0) + 1}`
                      : `Scene ${(currentScene.scene_index !== undefined ? currentScene.scene_index : 0) + 1}${session?.estimated_scenes ? ` of ~${session.estimated_scenes}` : ''}`
                    }
                  </div>
                  {/* Visual Progress Bar */}
                  {!isCyoaEnabled && session?.estimated_scenes && (
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
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
          </>
        )}

      </header>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        onVoiceSelect={handleVoiceSelect}
        volume={volume}
        onVolumeChange={setVolume}
        autoplayEnabled={autoplayEnabled}
        onAutoplayChange={setAutoplayEnabled}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        showText={showText}
        onShowTextToggle={() => setShowText(prev => !prev)}
        karaokeEnabled={karaokeEnabled}
        onKaraokeToggle={() => setKaraokeEnabled(prev => !prev)}
        onNarratorStyleChange={handleNarratorStyleChange}
        onGenerateCover={generateCover}
        isGeneratingCover={isGeneratingCover}
        coverUrl={coverUrl}
        onViewCoverFullscreen={openCoverFullscreen}
      />

      {/* Story Info Panel */}
      <StoryInfoPanel
        isOpen={showStoryInfo}
        config={config}
        storyOutline={outlineData ? { ...outlineData, synopsis: outlineSynopsisText, themes: outlineThemes } : null}
        characters={characters}
        authorStyleName={authorStyleName}
        session={session}
        currentScene={currentScene}
        isCyoaEnabled={isCyoaEnabled}
        choiceHistory={choiceHistory}
      />

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
        {storyEnded ? (
          <div className="text-center">
            <Sparkles className="w-20 h-20 text-golden-400 mx-auto mb-6" />
            <h2 className="text-2xl text-golden-400 mb-4">Story complete</h2>
            <p className="text-slate-300 mb-8">Ready for another chapter?</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={goHome}
                className="px-8 py-3 bg-slate-800 border border-golden-400 rounded-full text-golden-400 hover:bg-slate-700"
              >
                Back to Home
              </button>
              <button
                onClick={() => navigate('/library')}
                className="px-8 py-3 bg-golden-400 rounded-full text-slate-900 hover:bg-golden-500"
              >
                View in Library
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Text Display - BookPageLayout or TickerView based on textLayout setting */}
            {/* Only show after launch is complete to prevent premature playback */}
            {showText && currentScene && !launchActive && (
              textLayout === 'ticker' ? (
                // Ticker View - Speed reading mode with word-by-word display
                <div className="w-full max-w-4xl mx-auto mb-8 h-64">
                  <TickerView
                    text={processTextForDisplay(currentScene.text || currentScene.polished_text || currentScene.summary || '', { showQuotes: showDialogueQuotes, quoteStyle: dialogueQuoteStyle })}
                    isPlaying={tickerPlaying}
                    onTogglePlay={() => setTickerPlaying(prev => !prev)}
                    currentWordIndex={tickerWordIndex}
                    onWordIndexChange={setTickerWordIndex}
                    wpm={tickerWpm}
                    onWpmChange={setTickerWpm}
                  />
                </div>
              ) : (
                // Book Page Layout - Float cover with text wrap, karaoke/read-along
                <div className="max-w-2xl mx-auto mb-8">
                  <BookPageLayout
                    // Story metadata
                    title={session?.title || outlineData?.title || launchStats?.title || 'Your Story'}
                    synopsis={outlineSynopsisText || launchStats?.synopsis || ''}
                    storyText={processTextForDisplay(currentScene.text || currentScene.polished_text || currentScene.summary || '', { showQuotes: showDialogueQuotes, quoteStyle: dialogueQuoteStyle })}

                    // Story details for expandable badge
                    storyDetails={{
                      authorStyle: session?.author_style ? AUTHOR_NAMES[session.author_style] || session.author_style : '',
                      setting: outlineSettingText,
                      themes: outlineThemes,
                      mood: session?.mood || outlineData?.mood || ''
                    }}

                    // Chapter index for auto-expand behavior (0-based)
                    chapterIndex={currentScene?.scene_index ?? 0}

                    // Cover art
                    coverUrl={coverUrl}

                    // Karaoke/word highlighting
                    wordTimings={karaokeEnabled ? wordTimings : null}
                    currentWordIndex={karaokeEnabled ? currentWordIndex : -1}

                    // Text size (user preference from settings)
                    fontSize={fontSize}

                    // Callbacks
                    onWordClick={(wordIndex, timeSeconds) => {
                      console.log(`Word clicked: ${wordIndex} at ${timeSeconds}s`);
                    }}

                    // State (controls whether karaoke is active)
                    isPrePlayback={!isPlaying && isReadyToPlay}
                  />
                </div>
              )
            )}

            {/* Picture Book Images - Display when in picture book mode with images */}
            {(session?.visual_mode === 'picture_book' || config.story_format === 'picture_book') && sceneImages.length > 0 && (
              <div className="max-w-md mx-auto mb-8">
                <PictureBookImageDisplay
                  images={sceneImages}
                  currentWordIndex={currentWordIndex}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                />
              </div>
            )}

            {/* Audio Visualizer & SFX Indicator - Inline below text box */}
            {(isPlaying || (sfxEnabled && activeSfx.length > 0)) && (
              <div className="max-w-2xl mx-auto mb-6 flex flex-col items-center gap-3">
                {isPlaying && <AudioVisualizer />}
                {sfxEnabled && <SfxIndicator activeSfx={activeSfx} />}
              </div>
            )}

            {/* Show indicator while choice audio is playing */}
            {pendingChoices.length > 0 && choices.length === 0 && (
              <div className="text-center mb-6 animate-pulse">
                <p className="text-golden-400 text-lg mb-2">Choose your path...</p>
                <p className="text-slate-400 text-sm">Listening to your options</p>
              </div>
            )}

            {choices.length > 0 && (
              <ChoiceButtons choices={choices} onSelect={submitChoice} />
            )}
          </>
        )}

        {/* Launch HUD overlay (pre-playback stage validation / regeneration). */}
        {(() => {
          // P2: Simplified overlay visibility to single source of truth
          // Show overlay ONLY while:
          // 1. Story isn't ended, AND
          // 2. Generating OR Launch is active OR audio is queued OR ready to play (covers entire generation-to-playback flow)
          // 3. Audio hasn't started playing OR launch is still active (launchActive takes precedence)
          // CRITICAL: Including isGenerating ensures progress bar shows immediately when generation starts
          // FIX: Keep overlay visible during entire launch phase even after audio starts
          // P0 FIX: Include isReadyToPlay to keep "Begin Chapter" button visible after launch completes
          const showLaunchOverlay = !storyEnded && (isGenerating || launchActive || isAudioQueued || isReadyToPlay) && (!sceneAudioStarted || launchActive || isReadyToPlay);

          if (!showLaunchOverlay) return null;

          return (
            <div
              className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-6"
              onClick={(e) => {
                // P2 FIX: Prevent clicks on backdrop from propagating
                // Only stop propagation if clicking the backdrop itself, not the LaunchScreen
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  // Don't do anything on backdrop click - user must use buttons
                }
              }}
            >
              <LaunchScreen
                isVisible={true}
                stats={launchStats}
                stageStatuses={stageStatuses}
                stageDetails={stageDetails}
                isReadyToPlay={isReadyToPlay}
                isGeneratingAudio={(isGeneratingAudio || playbackRequested) && !currentScene?.audio_url}
                audioGenerationStatus={audioGenerationStatus}
                isAudioQueued={isAudioQueued}
                autoplayEnabled={autoplayEnabled}
                onAutoplayChange={setAutoplayEnabled}
                onStartPlayback={handleStartPlayback}
                onStartTextOnly={handleStartTextOnly}
                onCancel={handleCancelPlayback}
                warnings={launchWarnings}
                errors={launchErrors}
                canRetryStages={canRetryStages}
                retryingStage={retryingStage}
                onRetryStage={retryStage}
                // Regeneration props for HUD panels
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
                launchProgress={launchProgress}
                // Initial generation phase props
                isGenerating={isGenerating}
                generationProgress={generationProgress}
              />
            </div>
          );
        })()}
      </main>

      {/* Cover Image - REMOVED: Now integrated into StoryBookView unified document */}

      {/* Control Bar */}
      {!storyEnded && (
        <>
            <ControlBar
            isPlaying={isPlaying}
            isPaused={isPaused}
            currentTime={currentTime}
            duration={duration}
            wordTimings={wordTimings}
            currentWordIndex={currentWordIndex}
            onTogglePause={togglePause}
            onContinue={continueStory}
            onGoHome={goHome}
            onShowChoiceHistory={() => setShowChoiceHistory(true)}
            onSeek={seekTo}
            isGenerating={isGenerating}
            hasChoices={choices.length > 0}
            isCyoaEnabled={isCyoaEnabled}
            hasCheckpoints={checkpoints.length > 0}
            isPlayingRecording={isPlayingRecording}
            // Note: audioStatus prop removed (Bug Fix 3) - secondary progress bar eliminated
            // All progress is now unified in LaunchScreen
            // Chapter number for "Next Chapter X" button label
            nextChapterNumber={(currentScene?.scene_index ?? 0) + 2}
            // Story format for dynamic terminology
            storyFormat={config.story_format}
            storyType={config.story_type}
            // Playback controls (SFX, text layout)
            sfxEnabled={sfxEnabled}
            onSfxToggle={toggleSfx}
            textLayout={textLayout}
            onTextLayoutChange={setTextLayout}
            // View presets (style themes)
            currentViewPreset={currentViewPreset}
            onPresetChange={handleViewPresetChange}
            // Font size controls
            fontSize={fontSize}
            onFontSizeChange={(size) => {
              setFontSize(size);
              setThemeFontSize(size);
            }}
          />

          {/* Chapter Selector - shows when we have multiple scenes */}
          {allScenes.length > 1 && !isGenerating && !launchActive && (
            <ChapterSelector
              storyFormat={config.story_format}
              storyType={config.story_type}
              totalChapters={allScenes.length}
              currentChapter={(currentScene?.scene_index ?? 0) + 1}
              playedChapters={allScenes
                .filter(s => s.audio_url)
                .map(s => s.sequence_index + 1)
              }
              onSelectChapter={jumpToScene}
              disabled={isGenerating || launchActive}
            />
          )}
        </>
      )}

      {/* Recording Player Overlay */}
      {showRecordingPlayer && activeRecording && recordingSegments.length > 0 && (
        <div className="fixed inset-0 z-40 bg-slate-900">
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
