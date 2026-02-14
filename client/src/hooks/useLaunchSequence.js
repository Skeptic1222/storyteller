/**
 * useLaunchSequence Hook
 * Manages the pre-narration launch sequence including:
 * - Sequential validation stage tracking
 * - Socket event handling for stage updates
 * - Retry mechanism for failed stages
 * - Cover regeneration support
 * - HUD data: Agent status, usage tracking, character voices, SFX details, QA checks
 *
 * Simplified flow (v2): Generate → Ready → Play (no countdown)
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Import stage constants from single source of truth
import { STAGES, STATUS, COUNTDOWN_PHASE } from '../constants/launchStages.js';

// Agent configuration for HUD display
const AGENTS = {
  planner: { name: 'Story Planner', description: 'Creating story outline' },
  lore: { name: 'Lore Agent', description: 'Building world consistency' },
  writer: { name: 'Scene Writer', description: 'Crafting narrative' },
  narrator: { name: 'Narrator', description: 'Preparing voice delivery' },
  safety: { name: 'Safety Agent', description: 'Checking content guidelines' },
  sfx: { name: 'SFX Coordinator', description: 'Detecting sound effects' },
  cyoa: { name: 'Choice Manager', description: 'Creating story choices' },
  qa: { name: 'Quality Assurance', description: 'Final verification' },
  voice: { name: 'Voice Agent', description: 'Assigning voices' },
  cover: { name: 'Cover Artist', description: 'Generating cover art' }
};

/**
 * Hook for managing the launch sequence
 * @param {Object} socket - Socket.IO socket instance
 * @param {string} sessionId - Current story session ID
 * @param {Object} options - Configuration options
 * @returns {Object} Launch sequence state and controls
 */
export function useLaunchSequence(socket, sessionId, options = {}) {
  const {
    initialAutoplay = false, // initial autoplay state from config
    onReady = null, // callback when ready to play
    onError = null // callback on error
  } = options;

  // Store callbacks in refs to avoid effect dependencies
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Launch sequence state
  const [isActive, setIsActive] = useState(false);
  const [stageStatuses, setStageStatuses] = useState({
    [STAGES.STORY]: STATUS.PENDING,
    [STAGES.VOICES]: STATUS.PENDING,
    [STAGES.SFX]: STATUS.PENDING,
    [STAGES.COVER]: STATUS.PENDING,
    [STAGES.QA]: STATUS.PENDING,
    [STAGES.AUDIO]: STATUS.PENDING  // Audio synthesis stage
  });
  const [stageDetails, setStageDetails] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [stats, setStats] = useState(null);
  const [scene, setScene] = useState(null);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  // CIRCULAR PROGRESS (2026-01-31): Added startTime for timer persistence
  const [launchProgress, setLaunchProgress] = useState({ percent: 0, message: '', stage: null, startTime: null });

  // Ready to play state (simplified - no countdown)
  const [isReadyToPlay, setIsReadyToPlay] = useState(false);

  // Autoplay state - initialized from config
  const [autoplayEnabled, setAutoplayEnabled] = useState(initialAutoplay);

  // Refs
  const readyReceivedRef = useRef(false);
  // Guard against duplicate start-playback emissions (React StrictMode)
  const playbackStartedRef = useRef(false);
  // P0 FIX: Persistent ref to prevent launch-sequence-ready from being processed multiple times
  // This ref persists across state changes unlike isReady which gets cleared in handleAudioReady
  const launchCompletedRef = useRef(false);

  // Retry state
  const [retryingStage, setRetryingStage] = useState(null);
  const [canRetryStages, setCanRetryStages] = useState({});

  // Cover regeneration state
  const [isRegeneratingCover, setIsRegeneratingCover] = useState(false);

  // Additional regeneration states
  const [isRegeneratingSynopsis, setIsRegeneratingSynopsis] = useState(false);
  const [isRegeneratingSfx, setIsRegeneratingSfx] = useState(false);
  const [isRegeneratingVoices, setIsRegeneratingVoices] = useState(false);

  // Playback audio generation state (for deferred TTS)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioGenerationStatus, setAudioGenerationStatus] = useState(null);

  // Audio queued state - bridges gap between audio-ready and audio-playing
  // This keeps the loading indicator visible until audio actually starts
  const [isAudioQueued, setIsAudioQueued] = useState(false);

  // Pre-synthesized audio data from unified progress (no second progress bar!)
  const [preloadedAudio, setPreloadedAudio] = useState(null);

  // HUD state - Agent status tracking
  const [agents, setAgents] = useState(() => {
    const initialAgents = {};
    Object.keys(AGENTS).forEach(key => {
      initialAgents[key] = {
        ...AGENTS[key],
        status: 'pending',
        message: '',
        progress: 0,
        duration: 0,
        startTime: null
      };
    });
    return initialAgents;
  });

  // HUD state - Usage tracking
  const [usage, setUsage] = useState({
    elevenlabs: { characters: 0, requests: 0, cost: 0 },
    openai: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, cost: 0, byModel: {} },
    whisper: { minutes: 0, requests: 0, cost: 0 },
    images: { count: 0, cost: 0 },
    total: { cost: 0, formatted: '$0.0000' }
  });

  // HUD state - Character voice assignments
  const [characterVoices, setCharacterVoices] = useState([]);
  const [voiceSummary, setVoiceSummary] = useState({ totalCharacters: 0, totalVoices: 0 });

  // HUD state - SFX details
  const [sfxDetails, setSfxDetails] = useState({
    sfxList: [],
    sfxCount: 0,
    cachedCount: 0,
    generatingCount: 0,
    totalInLibrary: 0,
    sfxEnabled: true
  });

  // HUD state - QA checks
  const [qaChecks, setQaChecks] = useState({
    safety: { status: 'pending', message: '' },
    sliders: { status: 'pending', message: '' },
    continuity: { status: 'pending', message: '' },
    engagement: { status: 'pending', message: '' }
  });

  // HUD state - Cover progress
  const [coverProgress, setCoverProgress] = useState({
    status: 'pending',
    progress: 0,
    message: '',
    coverUrl: null
  });

  // HUD state - Safety report (Section 5 of Storyteller Gospel)
  const [safetyReport, setSafetyReport] = useState(null);

  // Detailed progress log - technical information for users who want to see "what's happening under the hood"
  const [detailedProgressLog, setDetailedProgressLog] = useState([]);

  /**
   * Reset all state to initial values
   */
  const reset = useCallback(() => {
    setIsActive(false);
    setStageStatuses({
      [STAGES.STORY]: STATUS.PENDING,
      [STAGES.VOICES]: STATUS.PENDING,
      [STAGES.SFX]: STATUS.PENDING,
      [STAGES.COVER]: STATUS.PENDING,
      [STAGES.QA]: STATUS.PENDING,
      [STAGES.AUDIO]: STATUS.PENDING
    });
    setStageDetails({});
    setIsReady(false);
    setStats(null);
    setScene(null);
    setError(null);
    setWarnings([]);
    setIsReadyToPlay(false);
    setRetryingStage(null);
    setCanRetryStages({});
    setIsRegeneratingCover(false);
    setIsGeneratingAudio(false);
    setAudioGenerationStatus(null);
    setPreloadedAudio(null);  // Clear pre-synthesized audio

    // Reset HUD state
    const initialAgents = {};
    Object.keys(AGENTS).forEach(key => {
      initialAgents[key] = {
        ...AGENTS[key],
        status: 'pending',
        message: '',
        progress: 0,
        duration: 0,
        startTime: null
      };
    });
    setAgents(initialAgents);
    setUsage({
      elevenlabs: { characters: 0, requests: 0, cost: 0 },
      openai: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, cost: 0, byModel: {} },
      whisper: { minutes: 0, requests: 0, cost: 0 },
      images: { count: 0, cost: 0 },
      total: { cost: 0, formatted: '$0.0000' }
    });
    setCharacterVoices([]);
    setVoiceSummary({ totalCharacters: 0, totalVoices: 0 });
    setSfxDetails({
      sfxList: [],
      sfxCount: 0,
      cachedCount: 0,
      generatingCount: 0,
      totalInLibrary: 0,
      sfxEnabled: true
    });
    setQaChecks({
      safety: { status: 'pending', message: '' },
      sliders: { status: 'pending', message: '' },
      continuity: { status: 'pending', message: '' },
      engagement: { status: 'pending', message: '' }
    });
    setCoverProgress({
      status: 'pending',
      progress: 0,
      message: '',
      coverUrl: null
    });
    setSafetyReport(null);
    setDetailedProgressLog([]);
    setLaunchProgress({ percent: 0, message: '', stage: null });

    // Clear refs
    readyReceivedRef.current = false;
    playbackStartedRef.current = false;
    launchCompletedRef.current = false; // P0 FIX: Reset launch completion guard
  }, []);

  /**
   * Cancel the entire launch sequence
   */
  const cancel = useCallback(() => {
    console.log('[Launch] CANCEL | sessionId:', sessionId);

    if (socket && sessionId) {
      console.log('[Socket:Emit] EVENT: cancel-launch-sequence | session_id:', sessionId);
      socket.emit('cancel-launch-sequence', { session_id: sessionId });
    }

    reset();
  }, [socket, sessionId, reset]);

  /**
   * Request playback to start
   */
  const startPlayback = useCallback(() => {
    // Guard against duplicate emissions (React StrictMode double-invokes effects)
    if (playbackStartedRef.current) {
      console.log('[Launch] START_PLAYBACK | skipped - already started');
      return;
    }
    playbackStartedRef.current = true;

    console.log('[Launch] START_PLAYBACK | sessionId:', sessionId);
    if (socket && sessionId) {
      console.log('[Socket:Emit] EVENT: start-playback | session_id:', sessionId);
      socket.emit('start-playback', { session_id: sessionId });
    }
    // Don't reset here - let the audio handlers manage the transition
  }, [socket, sessionId]);

  /**
   * Confirm ready event received (sends to server to cancel watchdog)
   */
  const confirmReady = useCallback(() => {
    console.log('[Launch] CONFIRM_READY | sessionId:', sessionId);
    readyReceivedRef.current = true;
    if (socket && sessionId) {
      console.log('[Socket:Emit] EVENT: confirm-ready | session_id:', sessionId);
      socket.emit('confirm-ready', { session_id: sessionId });
    }
  }, [socket, sessionId]);

  /**
   * Retry a specific failed stage
   */
  const retryStage = useCallback((stage) => {
    if (!socket || !sessionId) return;
    if (!canRetryStages[stage]) {
      console.warn('[Launch] RETRY_BLOCKED | stage:', stage, '| reason: not_retryable');
      return;
    }

    console.log('[Launch] RETRY_STAGE | stage:', stage, '| sessionId:', sessionId);
    setRetryingStage(stage);
    console.log('[Socket:Emit] EVENT: retry-stage | session_id:', sessionId, '| stage:', stage);
    socket.emit('retry-stage', { session_id: sessionId, stage });
  }, [socket, sessionId, canRetryStages]);

  /**
   * Request cover art regeneration
   */
  const regenerateCover = useCallback(() => {
    if (!socket || !sessionId) return;

    console.log('[Launch] REGENERATE | type: cover | sessionId:', sessionId);
    setIsRegeneratingCover(true);
    console.log('[Socket:Emit] EVENT: regenerate-cover | session_id:', sessionId);
    socket.emit('regenerate-cover', { session_id: sessionId });
  }, [socket, sessionId]);

  /**
   * Request synopsis/outline regeneration
   */
  const regenerateSynopsis = useCallback(() => {
    if (!socket || !sessionId) return;

    console.log('[Launch] REGENERATE | type: synopsis | sessionId:', sessionId);
    setIsRegeneratingSynopsis(true);
    console.log('[Socket:Emit] EVENT: regenerate-synopsis | session_id:', sessionId);
    socket.emit('regenerate-synopsis', { session_id: sessionId });
  }, [socket, sessionId]);

  /**
   * Request SFX detection regeneration
   */
  const regenerateSfx = useCallback(() => {
    if (!socket || !sessionId) return;

    console.log('[Launch] REGENERATE | type: sfx | sessionId:', sessionId);
    setIsRegeneratingSfx(true);
    console.log('[Socket:Emit] EVENT: regenerate-sfx | session_id:', sessionId);
    socket.emit('regenerate-sfx', { session_id: sessionId });
  }, [socket, sessionId]);

  /**
   * Request voice assignment regeneration
   */
  const regenerateVoices = useCallback(() => {
    if (!socket || !sessionId) return;

    console.log('[Launch] REGENERATE | type: voices | sessionId:', sessionId);
    setIsRegeneratingVoices(true);
    console.log('[Socket:Emit] EVENT: regenerate-voices | session_id:', sessionId);
    socket.emit('regenerate-voices', { session_id: sessionId });
  }, [socket, sessionId]);

  /**
   * Handle socket events for launch sequence
   */
  useEffect(() => {
    if (!socket) return;

    // Launch sequence started - initialize UI
    const handleSequenceStarted = (data) => {
      console.log('[Socket:Recv] EVENT: launch-sequence-started | sessionId:', data?.session_id, '| startTime:', data?.startTime);
      setIsActive(true);
      setError(null);
      setWarnings([]);
      readyReceivedRef.current = false;

      // CIRCULAR PROGRESS (2026-01-31): Capture startTime for timer persistence
      if (data.startTime) {
        setLaunchProgress(prev => ({ ...prev, startTime: data.startTime }));
      }

      if (data.allStatuses) {
        // Add STORY stage - mark as SUCCESS since story generation is complete when launch starts
        setStageStatuses({
          [STAGES.STORY]: STATUS.SUCCESS,
          ...data.allStatuses
        });
      } else {
        // Mark STORY as success when launch sequence begins (story was already generated)
        setStageStatuses(prev => ({
          ...prev,
          [STAGES.STORY]: STATUS.SUCCESS
        }));
      }
    };

    // Individual stage status update
    const handleStageUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: launch-stage-update | stage:', data.stage, '| status:', data.status, '| hasDetails:', !!data.details);

      if (data.stage && data.status) {
        setStageStatuses(prev => ({
          ...prev,
          [data.stage]: data.status
        }));

        if (data.details) {
          setStageDetails(prev => ({
            ...prev,
            [data.stage]: data.details
          }));

          // Track retry capability
          if (data.details.canRetry !== undefined) {
            setCanRetryStages(prev => ({
              ...prev,
              [data.stage]: data.details.canRetry
            }));
          }
        }

        // Clear retry state if stage succeeded
        if (data.status === STATUS.SUCCESS && retryingStage === data.stage) {
          setRetryingStage(null);
        }
      }
    };

    // Overall progress update
    const handleProgress = (data) => {
      console.log('[Socket:Recv] EVENT: launch-progress | percent:', data?.percent, '| message:', data?.message?.substring(0, 40), '| stage:', data?.stage);
      // CIRCULAR PROGRESS (2026-01-31): Preserve or update startTime from server
      setLaunchProgress(prev => ({
        percent: data?.percent ?? 0,
        message: data?.message || '',
        stage: data?.stage || null,
        startTime: data?.startTime || prev.startTime  // Preserve startTime if not in this event
      }));
    };

    // Launch sequence ready - all validations passed
    const handleSequenceReady = (data) => {
      console.log('[Socket:Recv] EVENT: launch-sequence-ready | isRetry:', data?.isRetry, '| hasStats:', !!data?.stats, '| hasScene:', !!data?.scene);

      // P0 FIX: Use persistent ref instead of state for duplicate guard
      // isReady state gets cleared in handleAudioReady, breaking this guard
      // launchCompletedRef persists across state changes
      // ATOMIC GUARD: Set ref first, then check previous value
      // This prevents two concurrent events from both passing the check
      const wasAlreadyCompleted = launchCompletedRef.current;
      launchCompletedRef.current = true;

      if (wasAlreadyCompleted && !data.isRetry) {
        console.log('[Launch] SKIP_DUPLICATE | reason: launch_completed_ref');
        return;
      }
      setIsReady(true);
      setStats(data.stats);
      setScene(data.scene);
      readyReceivedRef.current = true;

      if (data.allStatuses) {
        setStageStatuses(data.allStatuses);
      }

      // Store any warnings
      if (data.stats?.warnings) {
        setWarnings(data.stats.warnings);
      }

      // Update SFX details from ready event (covers missed sfx-detail-update)
      if (data.sfxDetails && data.sfxDetails.sfxCount > 0) {
        console.log('[Launch] SFX_FALLBACK | sfxCount:', data.sfxDetails.sfxCount, '| cachedCount:', data.sfxDetails.cachedCount);
        setSfxDetails({
          sfxList: data.sfxDetails.sfxList || [],
          sfxCount: data.sfxDetails.sfxCount || 0,
          cachedCount: data.sfxDetails.cachedCount || 0,
          generatingCount: data.sfxDetails.generatingCount || 0,
          totalInLibrary: data.sfxDetails.totalInLibrary || 0,
          sfxEnabled: data.sfxDetails.sfxEnabled !== false
        });
      }

      // Update voice details from ready event (covers missed voice-assignment-update)
      if (data.voiceDetails && data.voiceDetails.characters && data.voiceDetails.characters.length > 0) {
        console.log('[Launch] VOICE_FALLBACK | characters:', data.voiceDetails.characters?.length, '| totalVoices:', data.voiceDetails.totalVoices);
        setCharacterVoices(data.voiceDetails.characters);
        setVoiceSummary({
          totalCharacters: data.voiceDetails.totalCharacters || data.voiceDetails.characters.length,
          totalVoices: data.voiceDetails.totalVoices || data.voiceDetails.characters.length
        });
      }

      // Store pre-synthesized audio if available (unified progress - no second progress bar!)
      if (data.audioDetails && data.audioDetails.hasAudio) {
        console.log('[Launch] AUDIO_PRELOADED | hasIntro:', !!data.audioDetails.intro, '| hasScene:', !!data.audioDetails.scene, '| segments:', data.audioDetails.totalSegments);
        setPreloadedAudio(data.audioDetails);
        // Mark narrator agent as complete since audio is pre-synthesized
        setAgents(prev => ({
          ...prev,
          narrator: {
            ...prev.narrator,
            status: 'complete',
            message: `Audio ready (${data.audioDetails.totalSegments} segments)`,
            progress: 100
          }
        }));
      }

      // Confirm ready event received (cancels server watchdog)
      confirmReady();

      // Notify parent
      onReadyRef.current?.(data);

      // Go directly to ready (no countdown - simplified flow)
      console.log('[Launch] Ready to play - no countdown');
      setIsReadyToPlay(true);

      // DUAL PROGRESS BAR FIX (2026-01-31): Only hide launch screen if audio is preloaded
      // If audio isn't ready, keep launch screen active so deferred TTS shows in same UI
      const hasPreloadedAudio = data.audioDetails && data.audioDetails.hasAudio;
      if (hasPreloadedAudio) {
        console.log('[Launch] Audio preloaded - hiding launch screen');
        setIsActive(false);
      } else {
        console.log('[Launch] NO_PRELOADED_AUDIO | Keeping launch screen active for deferred TTS');
        // Keep isActive=true so LaunchScreen stays visible during deferred audio generation
        // The launch screen will hide when playback actually starts (audio-ready event)
      }
    };

    // Launch sequence error
    const handleSequenceError = (data) => {
      console.error('[Socket:Recv] EVENT: launch-sequence-error | error:', data?.error, '| failedStage:', data?.failedStage);
      setError(data.error || 'Launch sequence failed');
      setRetryingStage(null);

      if (data.statuses) {
        setStageStatuses(data.statuses);
      }

      // Update retry capability for failed stage
      if (data.failedStage) {
        setCanRetryStages(prev => ({
          ...prev,
          [data.failedStage]: true
        }));
      }

      onErrorRef.current?.(data);
    };

    // Launch sequence cancelled
    const handleSequenceCancelled = (data) => {
      console.log('[Socket:Recv] EVENT: launch-sequence-cancelled | sessionId:', data?.session_id);
      reset();
    };

    // Retry stage completed
    const handleRetryComplete = (data) => {
      console.log('[Socket:Recv] EVENT: retry-stage-complete | stage:', data?.stage, '| success:', data?.success, '| status:', data?.status);
      setRetryingStage(null);

      if (data.success && data.status === STATUS.SUCCESS) {
        // Check if all stages are now complete
        const allSuccess = Object.values({
          ...stageStatuses,
          [data.stage]: data.status
        }).every(s => s === STATUS.SUCCESS);

        if (allSuccess) {
          // Request ready event again
          socket.emit('check-ready', { session_id: sessionId });
        }
      }
    };

    // Cover regenerated
    const handleCoverRegenerated = (data) => {
      console.log('[Socket:Recv] EVENT: cover-regenerated | success:', data?.success, '| hasCoverUrl:', !!data?.coverUrl);
      setIsRegeneratingCover(false);

      if (data.success && data.coverUrl) {
        // Update stats with new cover
        setStats(prev => prev ? { ...prev, coverArtUrl: data.coverUrl } : prev);
        setCoverProgress(prev => ({ ...prev, coverUrl: data.coverUrl, status: 'complete' }));
      }
    };

    // Synopsis regenerated
    const handleSynopsisRegenerated = (data) => {
      console.log('[Socket:Recv] EVENT: synopsis-regenerated | success:', data?.success, '| hasTitle:', !!data?.title);
      setIsRegeneratingSynopsis(false);

      if (data.success) {
        // Update stats with new synopsis
        setStats(prev => prev ? {
          ...prev,
          title: data.title || prev.title,
          synopsis: data.synopsis || prev.synopsis
        } : prev);
      }
    };

    // SFX re-detected
    const handleSfxRegenerated = (data) => {
      console.log('[Socket:Recv] EVENT: sfx-regenerated | success:', data?.success, '| sfxCount:', data?.sfxDetails?.sfxCount);
      setIsRegeneratingSfx(false);

      if (data.success && data.sfxDetails) {
        setSfxDetails(data.sfxDetails);
        setStats(prev => prev ? {
          ...prev,
          sfxCount: data.sfxDetails.sfxCount || 0,
          sfxOpportunities: data.sfxDetails.opportunities || 0
        } : prev);
      }
    };

    // Voices reassigned
    const handleVoicesRegenerated = (data) => {
      console.log('[Socket:Recv] EVENT: voices-regenerated | success:', data?.success, '| characters:', data?.characterVoices?.length);
      setIsRegeneratingVoices(false);

      if (data.success && data.characterVoices) {
        setCharacterVoices(data.characterVoices);
        setVoiceSummary(prev => ({
          ...prev,
          totalCharacters: data.totalCharacters || data.characterVoices.length,
          totalVoices: data.totalVoices || data.characterVoices.length
        }));
        setStats(prev => prev ? {
          ...prev,
          narratorCount: data.characterVoices.length
        } : prev);
      }
    };

    // HUD: Agent status updates
    const handleAgentStatusUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: agent-status-update | agent:', data?.agent, '| status:', data?.status, '| progress:', data?.progress);
      if (data.agent && AGENTS[data.agent]) {
        setAgents(prev => ({
          ...prev,
          [data.agent]: {
            ...prev[data.agent],
            status: data.status || prev[data.agent].status,
            message: data.message || '',
            progress: data.progress ?? prev[data.agent].progress,
            duration: data.duration_ms || prev[data.agent].duration,
            startTime: data.status === 'active' && !prev[data.agent].startTime
              ? Date.now()
              : prev[data.agent].startTime
          }
        }));
      }
    };

    // HUD: Usage tracking updates
    const handleUsageUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: usage-update | total:', data?.total, '| elevenlabs:', data?.elevenlabs, '| openai:', data?.openai);
      setUsage(prev => ({
        elevenlabs: data.elevenlabs || prev.elevenlabs,
        openai: data.openai || prev.openai,
        whisper: data.whisper || prev.whisper,
        images: data.images || prev.images,
        total: data.total || prev.total
      }));
    };

    // HUD: Voice assignment updates
    const handleVoiceAssignmentUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: voice-assignment-update | characters:', data?.characters?.length, '| totalVoices:', data?.totalVoices);
      if (data.characters) {
        setCharacterVoices(data.characters);
      }
      setVoiceSummary({
        totalCharacters: data.totalCharacters || 0,
        totalVoices: data.totalVoices || 0
      });
    };

    // HUD: SFX detail updates
    const handleSfxDetailUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: sfx-detail-update | sfxCount:', data?.sfxCount, '| cachedCount:', data?.cachedCount, '| generatingCount:', data?.generatingCount);
      setSfxDetails({
        sfxList: data.sfxList || [],
        sfxCount: data.sfxCount || data.sfxList?.length || 0,  // Use server's sfxCount first
        cachedCount: data.cachedCount || 0,
        generatingCount: data.generatingCount || 0,
        totalInLibrary: data.totalInLibrary || 0,
        sfxEnabled: data.sfxEnabled !== false
      });
    };

    // HUD: QA check updates
    const handleQaCheckUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: qa-check-update | checkName:', data?.checkName, '| status:', data?.status);
      if (data.checkName) {
        setQaChecks(prev => ({
          ...prev,
          [data.checkName]: {
            status: data.status || 'pending',
            message: data.message || '',
            details: data.details || null
          }
        }));
      }
    };

    // HUD: Safety report updates (Section 5 of Storyteller Gospel)
    const handleSafetyReportUpdate = (data) => {
      console.log('[Socket:Recv] EVENT: safety-report-update | audience:', data?.audience, '| wasAdjusted:', data?.wasAdjusted);
      setSafetyReport({
        report: data.report || null,
        display: data.display || null,
        audience: data.audience || 'general',
        wasAdjusted: data.wasAdjusted || false,
        summary: data.summary || ''
      });
    };

    // HUD: Cover generation progress
    const handleCoverGenerationProgress = (data) => {
      console.log('[Socket:Recv] EVENT: cover-generation-progress | status:', data?.status, '| progress:', data?.progress, '| hasCoverUrl:', !!data?.coverUrl);
      setCoverProgress({
        status: data.status || 'pending',
        progress: data.progress || 0,
        message: data.message || '',
        coverUrl: data.coverUrl || null
      });

      // Also update stats if cover URL received
      if (data.coverUrl) {
        setStats(prev => prev ? { ...prev, coverArtUrl: data.coverUrl } : prev);
      }
    };

    // Detailed progress - technical logs for power users
    const handleDetailedProgress = (data) => {
      console.log('[Socket:Recv] EVENT: detailed-progress | category:', data?.category, '| message:', data?.message?.substring(0, 50));
      setDetailedProgressLog(prev => {
        // Keep max 500 entries to show complete log history (increased from 100)
        const newLog = [...prev, {
          id: Date.now() + Math.random(),
          timestamp: data.timestamp || new Date().toISOString(),
          category: data.category || 'general',
          message: data.message || '',
          details: data.details || {}
        }];
        return newLog.slice(-500);
      });
    };

    // Playback starting - audio being generated on-demand (deferred TTS)
    const handlePlaybackStarting = (data) => {
      console.log('[Socket:Recv] EVENT: playback-starting | hasAudio:', data?.hasAudio, '| isDeferred:', data?.isDeferred);
      setIsGeneratingAudio(true);
      setAudioGenerationStatus({
        message: data.message || 'Generating audio...',
        hasAudio: data.hasAudio || false,
        isDeferred: data.isDeferred !== false,
        progress: null
      });

      // If audio is deferred (no pre-generated audio), show narrator agent as active
      if (data.isDeferred) {
        setAgents(prev => ({
          ...prev,
          narrator: {
            ...prev.narrator,
            status: 'active',
            message: 'Synthesizing narration...',
            progress: 50
          }
        }));
      }
    };

    // Audio ready - generation complete (deferred TTS path)
    const handleAudioReady = (data) => {
      console.log('[Socket:Recv] EVENT: audio-ready (useLaunchSequence) | audio queued, keeping loading visible until playback');
      setIsGeneratingAudio(false);
      setAudioGenerationStatus(null);

      // Mark narrator as complete
      setAgents(prev => ({
        ...prev,
        narrator: {
          ...prev.narrator,
          status: 'complete',
          message: 'Narration ready',
          progress: 100
        }
      }));

      // CRITICAL FIX: Don't hide LaunchScreen yet!
      // Set isAudioQueued to keep the loading indicator visible
      // LaunchScreen will hide when isPlaying becomes true (audio actually starts)
      setIsAudioQueued(true);

      // DUAL PROGRESS BAR FIX (2026-01-31):
      // Now that audio is ready (from deferred TTS), hide launch screen
      // isAudioQueued keeps the loading spinner visible until playback starts
      setIsActive(false);
      setIsReadyToPlay(false);
      // P0 FIX: DO NOT clear isReady here - it breaks the duplicate guard in handleSequenceReady
      // The launchCompletedRef now handles duplicate prevention, so clearing isReady is unnecessary
      // setIsReady(false); // REMOVED - was causing progress bar reversion bug
      // DO NOT reset: sfxDetails, characterVoices, stats, scene - still needed for playback
    };

    // Audio error (generation/playback failed)
    const handleAudioError = (data) => {
      console.error('[Socket:Recv] EVENT: audio-error (useLaunchSequence) | message:', data?.message);
      setIsGeneratingAudio(false);
      setAudioGenerationStatus(null);
      setIsAudioQueued(false);
      setIsReadyToPlay(false);
      playbackStartedRef.current = false; // allow user to retry start-playback
      setError(data?.message || 'Audio generation failed');
      onErrorRef.current?.({ error: data?.message || 'Audio generation failed' });
    };

    // Audio generating - progress/status updates during deferred narration generation
    const handleAudioGenerating = (data) => {
      const message = data?.message || 'Generating narration...';
      const progress = Number.isFinite(data?.progress)
        ? Math.max(0, Math.min(100, data.progress))
        : null;

      setIsGeneratingAudio(true);
      setAudioGenerationStatus(prev => ({
        ...(prev || {}),
        message,
        progress
      }));
    };

    // Register event listeners
    socket.on('launch-sequence-started', handleSequenceStarted);
    socket.on('launch-stage-update', handleStageUpdate);
    socket.on('launch-progress', handleProgress);
    socket.on('launch-sequence-ready', handleSequenceReady);
    socket.on('launch-sequence-error', handleSequenceError);
    socket.on('launch-sequence-cancelled', handleSequenceCancelled);
    socket.on('retry-stage-complete', handleRetryComplete);
    socket.on('cover-regenerated', handleCoverRegenerated);
    socket.on('synopsis-regenerated', handleSynopsisRegenerated);
    socket.on('sfx-regenerated', handleSfxRegenerated);
    socket.on('voices-regenerated', handleVoicesRegenerated);

    // HUD event listeners
    socket.on('agent-status-update', handleAgentStatusUpdate);
    socket.on('usage-update', handleUsageUpdate);
    socket.on('voice-assignment-update', handleVoiceAssignmentUpdate);
    socket.on('sfx-detail-update', handleSfxDetailUpdate);
    socket.on('qa-check-update', handleQaCheckUpdate);
    socket.on('safety-report-update', handleSafetyReportUpdate);
    socket.on('cover-generation-progress', handleCoverGenerationProgress);
    socket.on('detailed-progress', handleDetailedProgress);

    // Playback audio events (deferred TTS)
    socket.on('playback-starting', handlePlaybackStarting);
    socket.on('audio-generating', handleAudioGenerating);
    socket.on('audio-ready', handleAudioReady);
    socket.on('audio-error', handleAudioError);

    // Cleanup
    return () => {
      socket.off('launch-sequence-started', handleSequenceStarted);
      socket.off('launch-stage-update', handleStageUpdate);
      socket.off('launch-progress', handleProgress);
      socket.off('launch-sequence-ready', handleSequenceReady);
      socket.off('launch-sequence-error', handleSequenceError);
      socket.off('launch-sequence-cancelled', handleSequenceCancelled);
      socket.off('retry-stage-complete', handleRetryComplete);
      socket.off('cover-regenerated', handleCoverRegenerated);
      socket.off('synopsis-regenerated', handleSynopsisRegenerated);
      socket.off('sfx-regenerated', handleSfxRegenerated);
      socket.off('voices-regenerated', handleVoicesRegenerated);

      // HUD event cleanup
      socket.off('agent-status-update', handleAgentStatusUpdate);
      socket.off('usage-update', handleUsageUpdate);
      socket.off('voice-assignment-update', handleVoiceAssignmentUpdate);
      socket.off('sfx-detail-update', handleSfxDetailUpdate);
      socket.off('qa-check-update', handleQaCheckUpdate);
      socket.off('safety-report-update', handleSafetyReportUpdate);
      socket.off('cover-generation-progress', handleCoverGenerationProgress);
      socket.off('detailed-progress', handleDetailedProgress);

      // Playback audio cleanup
      socket.off('playback-starting', handlePlaybackStarting);
      socket.off('audio-generating', handleAudioGenerating);
      socket.off('audio-ready', handleAudioReady);
      socket.off('audio-error', handleAudioError);
    };
  }, [socket, sessionId, confirmReady, reset, isReady, stageStatuses, retryingStage]);

  // Computed values
  const allStagesComplete = Object.values(stageStatuses).every(
    status => status === STATUS.SUCCESS
  );

  const hasError = Object.values(stageStatuses).some(
    status => status === STATUS.ERROR
  ) || !!error;

  const currentStage = Object.entries(stageStatuses).find(
    ([_, status]) => status === STATUS.IN_PROGRESS
  )?.[0] || null;

  // Helper functions for usage display - memoized to prevent re-renders
  const formatCost = useCallback((cost) => {
    if (cost === undefined || cost === null) return '$0.00';
    return `$${cost.toFixed(4)}`;
  }, []);

  const formatTokens = useCallback((tokens) => {
    if (!tokens) return '0';
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return tokens.toString();
  }, []);

  const formatCharacters = useCallback((chars) => {
    if (!chars) return '0';
    if (chars >= 1000) return `${(chars / 1000).toFixed(1)}k`;
    return chars.toString();
  }, []);

  return {
    // State
    isActive,
    stageStatuses,
    stageDetails,
    isReady,
    stats,
    scene,
    error,
    warnings,

    // Ready state (simplified - no countdown)
    isReadyToPlay,

    // Audio queued state (bridges audio-ready to playback-started)
    isAudioQueued,
    setIsAudioQueued,

    // Autoplay
    autoplayEnabled,
    setAutoplayEnabled,

    // Retry state
    retryingStage,
    canRetryStages,

    // Cover regeneration
    isRegeneratingCover,

    // Audio generation (deferred TTS)
    isGeneratingAudio,
    audioGenerationStatus,

    // Pre-synthesized audio (unified progress - no second progress bar)
    preloadedAudio,
    setPreloadedAudio,

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

    // Computed
    allStagesComplete,
    hasError,
    currentStage,

    // Actions
    cancel,
    startPlayback,
    reset,
    retryStage,
    regenerateCover,
    regenerateSynopsis,
    regenerateSfx,
    regenerateVoices,
    confirmReady,

    // Regeneration states
    isRegeneratingSynopsis,
    isRegeneratingSfx,
    isRegeneratingVoices,

    // Helper functions
    formatCost,
    formatTokens,
    formatCharacters
  };
}

export { STAGES, STATUS, COUNTDOWN_PHASE };
export default useLaunchSequence;
