/**
 * LaunchScreen Component
 * Progress overlay for story generation with HUD-style status displays.
 *
 * Features:
 * - Sequential stage indicators with retry capability
 * - HUD-style panels for agent status and usage tracking
 * - Floating "Begin Chapter" action bar when ready
 *
 * Note: Cover art and synopsis are now displayed in BookPageLayout (unified reader).
 * This component only handles progress/status overlay.
 */

import { useState, memo, useEffect, useRef } from 'react';
import {
  Mic, Volume2, Image, Shield, Check, X, AlertCircle,
  Loader2, Play, ChevronDown, Users, Clock, Sparkles,
  RefreshCw, RotateCcw, Activity, DollarSign, BookOpen,
  Pen, UserPlus, Wand2, Star, Zap, Timer, AudioLines
} from 'lucide-react';

// Import HUD components
import AgentStatusPanel from './AgentStatusPanel';
import UsageTrackerPanel from './UsageTrackerPanel';
import ExpandableSFXList from './ExpandableSFXList';
import CharacterCastPanel from './CharacterCastPanel';
import QAChecksPanel, { useQAChecks } from './QAChecksPanel';
import DetailedProgressPanel from './DetailedProgressPanel';
import { StageIndicator } from './launch';

// Import constants from centralized location
import { STAGES, STATUS, COUNTDOWN_PHASE, STAGE_CONFIG } from '../constants/launchStages';

/**
 * Expandable badge component
 */
const ExpandableBadge = memo(function ExpandableBadge({
  icon: Icon,
  label,
  count,
  color,
  children,
  defaultExpanded = false
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`bg-slate-700/50 rounded-lg overflow-hidden transition-all ${expanded ? 'ring-1 ring-' + color + '-500/30' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-slate-600/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 text-${color}-400`} />
          <span className="text-slate-300 text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-${color}-400 font-bold`}>{count}</span>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {expanded && children && (
        <div className="px-3 pb-3 pt-0 border-t border-slate-600/50">
          {children}
        </div>
      )}
    </div>
  );
});

/**
 * Stats summary component with expandable badges
 */
const StatsSummary = memo(function StatsSummary({ stats }) {
  if (!stats) return null;

  const sfxNames = stats.sfxNames || [];
  const sfxCached = stats.sfxCachedCount || 0;
  const sfxMissing = stats.sfxMissingCount || 0;
  const sfxTotal = stats.sfxCount || 0;
  const sfxLocalTotal = stats.sfxTotalLocal || 0;
  const missingSfx = stats.sfxMissing || [];

  return (
    <div className="bg-slate-800/60 rounded-xl p-4 mt-4 space-y-3">
      {/* Narrator Badge - Expandable at top */}
      <ExpandableBadge
        icon={Users}
        label="Narrators"
        count={stats.narratorCount || 1}
        color="purple"
        defaultExpanded={stats.narratorCount > 1}
      >
        {stats.narrators && stats.narrators.length > 0 ? (
          <div className="mt-2 space-y-1">
            {stats.narrators.map((narrator, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <div className="w-2 h-2 rounded-full bg-purple-400/60" />
                <span className="text-purple-300">{narrator.name || narrator.label || 'Narrator'}</span>
                {narrator.character && (
                  <span className="text-slate-500">as {narrator.character}</span>
                )}
              </div>
            ))}
          </div>
        ) : stats.narratorDisplay ? (
          <p className="text-purple-300/80 text-xs mt-2">{stats.narratorDisplay}</p>
        ) : null}
      </ExpandableBadge>

      {/* SFX Badge - Expandable with details */}
      <ExpandableBadge
        icon={Volume2}
        label="Sound Effects"
        count={sfxTotal}
        color="cyan"
        defaultExpanded={sfxTotal > 0}
      >
        {sfxTotal > 0 && (
          <div className="mt-2 space-y-2">
            {/* Cache status */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Local library:</span>
              <span className="text-cyan-400">{sfxLocalTotal} sounds</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Cached for story:</span>
              <span className="text-green-400">{sfxCached}</span>
            </div>
            {sfxMissing > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">To generate:</span>
                <span className="text-amber-400">{sfxMissing}</span>
              </div>
            )}

            {/* SFX names */}
            {sfxNames.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-600/50">
                <p className="text-slate-500 text-xs mb-1">Effects:</p>
                <div className="flex flex-wrap gap-1">
                  {sfxNames.slice(0, 8).map((name, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-cyan-500/10 text-cyan-300 text-xs rounded-full"
                    >
                      {name}
                    </span>
                  ))}
                  {sfxNames.length > 8 && (
                    <span className="px-2 py-0.5 text-slate-500 text-xs">
                      +{sfxNames.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Missing SFX */}
            {missingSfx.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-600/50">
                <p className="text-amber-500 text-xs mb-1">Generating:</p>
                <div className="flex flex-wrap gap-1">
                  {missingSfx.slice(0, 5).map((name, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-amber-500/10 text-amber-300 text-xs rounded-full animate-pulse"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ExpandableBadge>

      {/* Duration estimate */}
      {stats.estimatedDuration > 0 && (
        <div className="flex items-center justify-center gap-1 text-slate-500 text-xs pt-2 border-t border-slate-600/50">
          <Clock className="w-3 h-3" />
          <span>~{Math.ceil(stats.estimatedDuration / 60)} min estimated</span>
        </div>
      )}
    </div>
  );
});

/**
 * Safety Report Panel - Section 5 of Storyteller Gospel
 * Shows content intensity analysis and adjustment status
 */
const SafetyReportPanel = memo(function SafetyReportPanel({ safetyReport, compact = false }) {
  if (!safetyReport) return null;

  const { wasAdjusted, summary, audience, display, report } = safetyReport;

  const displayMessage = display?.message || summary || 'Content verified';

  // Audience badge colors
  const audienceColors = {
    children: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
    general: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
    mature: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' }
  };
  const audienceStyle = audienceColors[audience] || audienceColors.general;

  return (
    <div className={`bg-slate-800/60 rounded-xl p-3 ${compact ? 'text-sm' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className={`
          w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          ${wasAdjusted ? 'bg-amber-500/20' : 'bg-green-500/20'}
        `}>
          <Shield className={`w-4 h-4 ${wasAdjusted ? 'text-amber-400' : 'text-green-400'}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium ${wasAdjusted ? 'text-amber-400' : 'text-green-400'}`}>
              Content Safety
            </span>
            {/* Audience Badge */}
            <span className={`
              px-2 py-0.5 text-xs rounded-full capitalize
              ${audienceStyle.bg} ${audienceStyle.text} ${audienceStyle.border} border
            `}>
              {audience}
            </span>
          </div>

          <p className={`text-slate-300 text-xs leading-relaxed`}>
            {displayMessage}
          </p>

          {/* Show adjustment details if content was modified */}
          {wasAdjusted && display?.changeCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400/80">
              <AlertCircle className="w-3 h-3" />
              <span>{display.changeCount} adjustment{display.changeCount > 1 ? 's' : ''} made</span>
            </div>
          )}

          {/* Show specific changes in advanced mode */}
          {wasAdjusted && report?.changesMade?.length > 0 && !compact && (
            <div className="mt-2 pt-2 border-t border-slate-700/50">
              <p className="text-slate-500 text-xs mb-1">Changes:</p>
              <ul className="text-xs text-slate-400 space-y-0.5">
                {report.changesMade.slice(0, 3).map((change, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="text-amber-400/60">-</span>
                    <span>{change}</span>
                  </li>
                ))}
                {report.changesMade.length > 3 && (
                  <li className="text-slate-500">+{report.changesMade.length - 3} more</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Check icon */}
        <div className="flex-shrink-0">
          {wasAdjusted ? (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          ) : (
            <Check className="w-4 h-4 text-green-400" />
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Ready to Play Section - Final playback controls
 * Features expandable Story Details and streamlined button row
 */
const ReadyToPlaySection = memo(function ReadyToPlaySection({
  stats,
  characterVoices = [],
  voiceSummary = {},
  usage = {},
  formatCost,
  formatTokens,
  formatCharacters,
  sfxDetails = {},
  autoplayEnabled,
  onAutoplayChange,
  sfxEnabled,
  onSfxToggle,
  onStartPlayback,
  onCancel,
  chapterNumber = 1
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const handleStartClick = () => {
    if (isStarting) return; // Prevent double-click
    setIsStarting(true);
    onStartPlayback();
    // Reset after 5 seconds if playback doesn't start (safety fallback)
    setTimeout(() => setIsStarting(false), 5000);
  };

  return (
    <div className="space-y-4">
      {/* Expandable Story Details Section */}
      {(stats || characterVoices.length > 0 || (sfxDetails.sfxCount > 0)) && (
        <div className="bg-slate-800/60 rounded-xl overflow-hidden border border-slate-700">
          {/* Story Details Header - Clickable to expand */}
          <button
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-golden-400" />
              <span className="text-slate-200 font-medium">Story Details</span>
              {/* Quick stats badges */}
              <div className="flex items-center gap-2 ml-2">
                {characterVoices.length > 0 && (
                  <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                    {voiceSummary.totalVoices || characterVoices.length} voices
                  </span>
                )}
                {sfxDetails.sfxCount > 0 && (
                  <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-xs rounded-full">
                    {sfxDetails.sfxCount} SFX
                  </span>
                )}
                {usage.totalCost > 0 && (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                    {formatCost(usage.totalCost)}
                  </span>
                )}
              </div>
            </div>
            <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
          </button>

          {/* Expandable Content - Scrollable when expanded */}
          {detailsExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 max-h-64 overflow-y-auto">
              {/* Voice Cast */}
              {characterVoices.length > 0 && (
                <div className="pt-3">
                  <CharacterCastPanel
                    characters={characterVoices}
                    totalCharacters={voiceSummary.totalCharacters}
                    totalVoices={voiceSummary.totalVoices}
                    compact={true}
                  />
                </div>
              )}

              {/* SFX List */}
              {sfxDetails.sfxCount > 0 && (
                <ExpandableSFXList
                  sfxList={sfxDetails.sfxList}
                  sfxCount={sfxDetails.sfxCount}
                  cachedCount={sfxDetails.cachedCount}
                  generatingCount={sfxDetails.generatingCount}
                  totalInLibrary={sfxDetails.totalInLibrary}
                  sfxEnabled={sfxDetails.sfxEnabled !== false}
                  compact={true}
                />
              )}

              {/* API Usage */}
              {(usage.totalCost > 0 || usage.totalTokens > 0) && (
                <UsageTrackerPanel
                  usage={usage}
                  formatCost={formatCost}
                  formatTokens={formatTokens}
                  formatCharacters={formatCharacters}
                  compact={true}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Action Row - Responsive layout for mobile */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        {/* Top row on mobile: Begin Chapter Button (full width) */}
        <button
          onClick={handleStartClick}
          disabled={isStarting}
          className={`flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-golden-400 to-amber-500
                     text-slate-900 font-semibold shadow-lg shadow-golden-400/20
                     transition-all flex items-center justify-center gap-2 order-first sm:order-none
                     ${isStarting ? 'opacity-80 cursor-wait' : 'hover:from-golden-300 hover:to-amber-400'}`}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Starting...</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              <span>Begin Chapter {chapterNumber}</span>
            </>
          )}
        </button>

        {/* Bottom row on mobile: Toggles and Cancel */}
        <div className="flex items-center justify-between sm:justify-start gap-2">
          {/* Auto-Play Toggle */}
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 rounded-xl border border-slate-700">
            <button
              onClick={() => onAutoplayChange?.(!autoplayEnabled)}
              className={`w-10 h-6 rounded-full transition-all flex-shrink-0 ${
                autoplayEnabled ? 'bg-green-500' : 'bg-slate-600'
              }`}
              title={autoplayEnabled ? 'Auto-play enabled' : 'Auto-play disabled'}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                autoplayEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`} />
            </button>
            <span className="text-slate-400 text-xs whitespace-nowrap hidden sm:inline">Auto-Play</span>
          </div>

          {/* SFX Toggle */}
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 rounded-xl border border-slate-700">
            <button
              onClick={onSfxToggle}
              className={`w-10 h-6 rounded-full transition-all flex-shrink-0 ${
                sfxEnabled ? 'bg-cyan-500' : 'bg-slate-600'
              }`}
              title={sfxEnabled ? 'Sound effects enabled' : 'Sound effects disabled'}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                sfxEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`} />
            </button>
            <span className="text-slate-400 text-xs whitespace-nowrap hidden sm:inline">SFX</span>
          </div>

          {/* Cancel Button */}
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400
                       hover:bg-slate-700 hover:text-slate-200 transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
});

/**
 * Main LaunchScreen component
 * HUD-style layout with AI agent status, usage tracking, and detailed stage info
 */
const LaunchScreen = memo(function LaunchScreen({
  isVisible,
  stats,
  stageStatuses = {},
  stageDetails = {},
  isReadyToPlay,
  // Deferred narration generation after user clicks Begin Chapter
  isGeneratingAudio = false,
  audioGenerationStatus = null,
  isAudioQueued = false,
  autoplayEnabled,
  onAutoplayChange,
  onStartPlayback,
  onCancel,
  warnings = [],
  errors = [],
  // Retry props
  canRetryStages = {},
  retryingStage,
  onRetryStage,
  // Regeneration props (for HUD panels)
  isRegeneratingSfx = false,
  onRegenerateSfx,
  isRegeneratingVoices = false,
  onRegenerateVoices,
  // Text only mode
  onStartTextOnly,
  // SFX toggle
  sfxEnabled,
  onSfxToggle,
  // Cover progress
  coverProgress = {},
  // Chapter number for button text
  chapterNumber = 1,
  // HUD props
  agents = {},
  usage = {},
  characterVoices = [],
  voiceSummary = {},
  sfxDetails = {},
  qaChecks = {},
  safetyReport = null,
  // Helper functions
  formatCost = (cost) => cost ? `$${cost.toFixed(4)}` : '$0.00',
  formatTokens = (tokens) => tokens ? tokens.toString() : '0',
  formatCharacters = (chars) => chars ? chars.toString() : '0',
  // Detailed progress log for technical info
  detailedProgressLog = [],
  // Initial generation phase props (before launch sequence starts)
  isGenerating = false,
  generationProgress = { step: 0, percent: 0, message: '' },
  launchProgress = { percent: 0, message: '', stage: null }
}) {
  // State for detailed progress panel expansion
  const [progressLogExpanded, setProgressLogExpanded] = useState(true);

  // Elapsed time tracking for user engagement
  // Bug 1 Fix: Use server's startTime from generationProgress (survives page refresh)
  // Falls back to local time only if server hasn't provided one
  const localStartTimeRef = useRef(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Check if all stages are pending (needed for timer logic)
  const allStagesPendingForTimer = Object.values(stageStatuses).every(
    status => status === STATUS.PENDING
  );

  // Track elapsed time when generation is active
  // Bug 1 Fix: Prefer server startTime over local time for refresh resilience
  useEffect(() => {
    // Stop tracking when ready to play
    if (isReadyToPlay) {
      return;
    }

    // Start local timer as fallback when generation begins (server time may not be available yet)
    if ((isGenerating || !allStagesPendingForTimer) && !localStartTimeRef.current) {
      localStartTimeRef.current = Date.now();
    }

    // Update elapsed time every second
    const interval = setInterval(() => {
      // Bug 1 Fix: Prefer server startTime (survives refresh) over local time
      const serverStartTime = generationProgress?.startTime;
      const effectiveStartTime = serverStartTime || localStartTimeRef.current;

      if (effectiveStartTime) {
        const elapsed = Math.floor((Date.now() - effectiveStartTime) / 1000);
        setElapsedSeconds(elapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isGenerating, isReadyToPlay, allStagesPendingForTimer, generationProgress?.startTime]);

  // Reset timer when component becomes visible for a new generation
  useEffect(() => {
    if (isVisible && !isReadyToPlay) {
      // Only reset if we're starting fresh (all stages pending and not generating yet)
      if (allStagesPendingForTimer && !isGenerating) {
        localStartTimeRef.current = null;
        setElapsedSeconds(0);
      }
    }
  }, [isVisible, isReadyToPlay, allStagesPendingForTimer, isGenerating]);

  // Format elapsed time as MM:SS
  const formatElapsedTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // P2 FIX: Calculate estimated time remaining (ETA) based on progress and elapsed time
  // Uses exponential smoothing to avoid wild fluctuations
  const calculateETA = (percent, elapsed) => {
    // Only calculate ETA if we have meaningful progress (>5%) and elapsed time (>10s)
    if (percent <= 5 || elapsed < 10) return null;

    // Estimate total time based on current progress rate
    const estimatedTotal = (elapsed / percent) * 100;
    const remaining = Math.max(0, estimatedTotal - elapsed);

    // Cap at reasonable maximum (15 minutes = 900 seconds)
    const cappedRemaining = Math.min(remaining, 900);

    // Don't show if less than 5 seconds remaining
    if (cappedRemaining < 5) return null;

    // Format as "~Xm" or "~Xs" for brevity
    if (cappedRemaining >= 60) {
      return `~${Math.ceil(cappedRemaining / 60)}m`;
    }
    return `~${Math.round(cappedRemaining)}s`;
  };

  // Don't render if not visible
  if (!isVisible) return null;

  // Check if all stages are complete
  const allStagesComplete = Object.values(stageStatuses).every(
    status => status === STATUS.SUCCESS
  );

  // Check if any stage has error
  const hasError = Object.values(stageStatuses).some(
    status => status === STATUS.ERROR
  );

  // Determine if we should show detailed HUD (always show in simplified flow)
  const showHUD = true;
  const allStagesPending = Object.values(stageStatuses).every(
    status => status === STATUS.PENDING
  );
  const baseGenerationPercent = generationProgress?.percent || 0;
  const hasLaunchProgress = Number.isFinite(launchProgress?.percent) && launchProgress.percent > 0;
  const useGenerationProgress = isGenerating && (allStagesPending || !hasLaunchProgress);
  const generationPercent = Math.max(baseGenerationPercent, 5);

  const completedCount = Object.values(stageStatuses).filter(s => s === STATUS.SUCCESS).length;
  const inProgressCount = Object.values(stageStatuses).filter(s => s === STATUS.IN_PROGRESS).length;
  const totalStages = Object.keys(STAGES).length;
  const stageCompletionPercent = totalStages > 0
    ? ((completedCount + (inProgressCount * 0.5)) / totalStages) * 100
    : 0;
  const activeLaunchPercent = hasLaunchProgress ? launchProgress.percent : stageCompletionPercent;
  const displayPercent = useGenerationProgress
    ? generationPercent
    : Math.max(baseGenerationPercent, activeLaunchPercent);
  const activeStageKey = Object.entries(stageStatuses).find(([_, s]) => s === STATUS.IN_PROGRESS)?.[0];
  const activeStage = activeStageKey ? STAGE_CONFIG[activeStageKey] : null;
  const generationMessage = generationProgress?.message || 'Generating story...';
  const launchMessage = launchProgress?.message || activeStage?.description || 'Processing your story...';
  const latestFallback = useGenerationProgress ? generationMessage : (launchMessage || 'Initializing story preparation...');

  const isPlaybackPreparing = Boolean(isGeneratingAudio || audioGenerationStatus || isAudioQueued);
  const playbackMessage = audioGenerationStatus?.message
    || (isAudioQueued
      ? 'Narration queued — starting playback...'
      : 'Synthesizing narration audio...');
  const playbackProgress = isAudioQueued ? 95 : 65;

  const currentActivityLabel = isPlaybackPreparing
    ? 'Narration Engine'
    : (useGenerationProgress ? 'Story Generation' : (activeStage?.name || 'Initializing...'));
  const currentActivityMessage = isPlaybackPreparing
    ? playbackMessage
    : (useGenerationProgress
      ? generationMessage
      : (stageDetails[activeStageKey]?.message || activeStage?.description || 'Processing your story...'));
  const currentActivityProgress = isPlaybackPreparing
    ? playbackProgress
    : (useGenerationProgress
      ? generationPercent
      : (launchProgress?.percent || (activeStage ? 60 : 20)));
  const activityProgressPercent = Math.max(5, Math.min(100, currentActivityProgress));
  const effectiveDisplayPercent = isPlaybackPreparing ? playbackProgress : displayPercent;

  // PHASE 3 FIX: Remove production debug logging (was causing 80+ console entries)
  // Enable temporarily by setting localStorage.debug = 'launchscreen'
  if (typeof window !== 'undefined' && window.localStorage?.getItem('debug')?.includes('launchscreen')) {
    console.log('[LaunchScreen] Render state:', {
      showHUD,
      hasStats: !!stats,
      statsNarratorCount: stats?.narratorCount,
      statsSfxCount: stats?.sfxCount,
      statsTitle: stats?.title,
      statsSynopsis: stats?.synopsis?.substring(0, 50),
      sfxDetails: sfxDetails ? { sfxCount: sfxDetails.sfxCount, sfxListLength: sfxDetails.sfxList?.length } : null,
      characterVoicesCount: characterVoices?.length
    });
  }

  return (
    <div className="max-w-3xl mx-auto w-full animate-fade-in px-4 flex flex-col" style={{ maxHeight: 'calc(100vh - 120px)' }}>
      {/* ENHANCED FULL-WIDTH PROGRESS SECTION - Shows during generation, launch, and deferred audio */}
      {((showHUD && (!isReadyToPlay || isPlaybackPreparing)) || isGenerating) && (
        <div className="mb-6 -mx-4 px-4 md:-mx-8 md:px-8 lg:-mx-12 lg:px-12">
          {/* Main Progress Container - Full Width */}
          <div className="bg-gradient-to-b from-slate-800/95 to-slate-900/95 rounded-2xl border border-slate-600 overflow-hidden shadow-2xl">
            {/* Header with animated gradient - responsive padding */}
            <div className="relative px-3 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-golden-500/10 via-amber-500/5 to-golden-500/10 border-b border-slate-700">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-golden-400/5 via-transparent to-transparent" />
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <div className="relative flex-shrink-0">
                    <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-golden-400" />
                    <div className="absolute inset-0 animate-ping">
                      <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-golden-400/30" />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-2xl font-bold text-golden-400 truncate">
                      {isPlaybackPreparing ? 'Preparing Narration' : 'Creating Your Story'}
                    </h2>
                    <p className="text-slate-400 text-xs sm:text-sm truncate">
                      {isPlaybackPreparing
                        ? playbackMessage
                        : (useGenerationProgress
                          ? (generationProgress.message || 'AI agents working together to craft your experience')
                          : (launchProgress.message || 'AI agents working together to craft your experience')
                        )}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-2xl sm:text-4xl font-bold text-golden-400">
                    {/* Use generationProgress during initial generation, stageStatuses during launch */}
                    {Math.round(effectiveDisplayPercent)}%
                  </div>
                  {/* P2 FIX: Improved timing display with ETA */}
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="flex items-center gap-1 sm:gap-2 text-slate-500 text-[10px] sm:text-xs">
                      <span className="hidden sm:inline">{isPlaybackPreparing ? 'Narrating' : (useGenerationProgress ? 'Generating' : 'Complete')}</span>
                      {elapsedSeconds > 0 && !isReadyToPlay && (
                        <span className="flex items-center gap-0.5 sm:gap-1 text-slate-400">
                          <Timer className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          {formatElapsedTime(elapsedSeconds)}
                        </span>
                      )}
                    </div>
                    {/* ETA display - only show when progress is meaningful */}
                    {(() => {
                      const eta = calculateETA(effectiveDisplayPercent, elapsedSeconds);
                      return eta && !isReadyToPlay ? (
                        <span className="text-[9px] sm:text-[10px] text-golden-400/70 flex items-center gap-1">
                          <Clock className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                          <span className="hidden xs:inline">ETA:</span> {eta}
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Full-Width Progress Bar with Milestone Markers - Enhanced Visual Design */}
            {/* Responsive padding: more on desktop, less on mobile to maximize bar width */}
            <div className="px-2 sm:px-4 py-4 border-b border-slate-700/50 overflow-visible">
              {/* Responsive margins: reduced to give more space for labels. overflow-visible for edge labels */}
              <div className="relative mx-4 sm:mx-8 md:mx-12 lg:mx-16 overflow-visible">
                {/* Ambient glow behind the progress bar */}
                <div
                  className="absolute -inset-2 rounded-full blur-xl opacity-40 transition-all duration-1000"
                  style={{
                    background: `linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.5) ${effectiveDisplayPercent}%, transparent ${effectiveDisplayPercent + 5}%)`,
                    width: '100%'
                  }}
                />

                {/* Background track with inner glow - z-0 to stay behind badges */}
                <div className="relative z-0 w-full h-4 sm:h-5 bg-gradient-to-b from-slate-800 to-slate-700 rounded-full overflow-hidden shadow-inner border border-slate-600/50">
                  {/* Animated progress fill with enhanced gradient */}
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 via-golden-400 to-yellow-400 relative shadow-lg"
                    style={{
                      width: `${effectiveDisplayPercent}%`,
                      transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: '0 0 20px rgba(251, 191, 36, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)'
                    }}
                  >
                    {/* Multiple shimmer layers for depth */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
                    {/* Pulsing leading edge */}
                    <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-white/40 to-transparent animate-pulse" />
                  </div>
                </div>

                {/* Milestone Badges - z-20 to stay above progress bar */}
                {useGenerationProgress ? (
                  /* Generation Phase Milestones with unique icons */
                  <div className="absolute inset-0 z-20 flex items-center justify-between">
                    {[
                      { name: 'Planning', icon: BookOpen, shortName: 'Plan' },
                      { name: 'Writing', icon: Pen, shortName: 'Write' },
                      { name: 'Characters', icon: UserPlus, shortName: 'Cast' },
                      { name: 'Finalizing', icon: Wand2, shortName: 'Magic' }
                    ].map((phase, index, arr) => {
                      // Position badges evenly: 0%, 33%, 66%, 100%
                      const position = (index / (arr.length - 1)) * 100;
                      const phasePercent = (index + 1) * 25;
                      const isComplete = generationPercent >= phasePercent;
                      const isActive = generationPercent >= phasePercent - 25 && generationPercent < phasePercent;
                      // Adjust label position for edge badges to prevent cutoff
                      const isLeftEdge = position <= 10;
                      const isRightEdge = position >= 90;
                      const labelAlign = isLeftEdge ? 'left-0' : isRightEdge ? 'right-0' : 'left-1/2 -translate-x-1/2';
                      const PhaseIcon = phase.icon;

                      return (
                        <div
                          key={phase.name}
                          className="absolute transform -translate-x-1/2"
                          style={{ left: `${position}%` }}
                        >
                          {/* Particle ring for active milestone */}
                          {isActive && (
                            <>
                              <div className="absolute inset-0 -m-3 rounded-full border-2 border-golden-400/40 animate-ping" />
                              <div className="absolute inset-0 -m-2 rounded-full border border-golden-400/60 animate-pulse" />
                              {/* Floating sparkles around active badge */}
                              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                                <Star className="w-2 h-2 text-golden-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                              </div>
                              <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2">
                                <Zap className="w-2 h-2 text-amber-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                              </div>
                            </>
                          )}
                          <div className={`
                            relative w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center border-2 sm:border-3 transition-all duration-500
                            ${isComplete
                              ? 'bg-gradient-to-br from-green-400 to-emerald-600 border-green-300 shadow-lg shadow-green-500/60 scale-110'
                              : isActive
                                ? 'bg-gradient-to-br from-golden-400 to-amber-600 border-golden-300 shadow-lg shadow-golden-500/60 scale-115'
                                : 'bg-gradient-to-br from-slate-600 to-slate-800 border-slate-500'}
                          `}>
                            {isComplete ? (
                              <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow" />
                            ) : isActive ? (
                              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin drop-shadow" />
                            ) : (
                              <PhaseIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                            )}
                          </div>
                          <div className={`
                            absolute top-11 sm:top-13 transform whitespace-nowrap text-[9px] sm:text-xs font-semibold tracking-wide
                            ${labelAlign}
                            ${isComplete ? 'text-green-400' : isActive ? 'text-golden-400 animate-pulse' : 'text-slate-500'}
                          `}>
                            <span className="hidden sm:inline">{phase.name}</span>
                            <span className="sm:hidden">{phase.shortName}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Launch Stage Milestones - "Crafting Story" at start (0%), stages spread evenly */
                  <div className="absolute inset-0 z-20 flex items-center justify-between">
                    {/* "Crafting Story" badge at 0% - three states: pending, active (spinning), complete (green) */}
                    {(() => {
                      // Determine the state of "Crafting Story"
                      const hasAnyStageStarted = Object.values(stageStatuses).some(
                        s => s === STATUS.IN_PROGRESS || s === STATUS.SUCCESS
                      );
                      const hasAnyStageComplete = Object.values(stageStatuses).some(
                        s => s === STATUS.SUCCESS
                      );
                      // Three states: pending (gray), active (golden spinning), complete (green checkmark)
                      const craftingState = hasAnyStageComplete ? 'complete' : hasAnyStageStarted ? 'active' : 'pending';

                      return (
                        <div
                          className="absolute transform -translate-x-1/2"
                          style={{ left: '0%' }}
                        >
                          {/* Particle effects for active state */}
                          {craftingState === 'active' && (
                            <>
                              <div className="absolute inset-0 -m-3 rounded-full border-2 border-golden-400/40 animate-ping" />
                              <div className="absolute inset-0 -m-2 rounded-full border border-golden-400/60 animate-pulse" />
                            </>
                          )}
                          <div className={`
                            relative w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center border-2 sm:border-3 transition-all duration-500
                            ${craftingState === 'complete'
                              ? 'bg-gradient-to-br from-green-400 to-emerald-600 border-green-300 shadow-lg shadow-green-500/60 scale-110'
                              : craftingState === 'active'
                                ? 'bg-gradient-to-br from-golden-400 to-amber-600 border-golden-300 shadow-lg shadow-golden-500/60 scale-115'
                                : 'bg-gradient-to-br from-slate-600 to-slate-800 border-slate-500'}
                          `}>
                            {craftingState === 'complete' ? (
                              <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow" />
                            ) : craftingState === 'active' ? (
                              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin drop-shadow" />
                            ) : (
                              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                            )}
                          </div>
                          {/* Label aligned to left edge to prevent cutoff */}
                          <div className={`
                            absolute top-11 sm:top-13 left-0 whitespace-nowrap text-[9px] sm:text-xs font-semibold tracking-wide
                            ${craftingState === 'complete' ? 'text-green-400' : craftingState === 'active' ? 'text-golden-400 animate-pulse' : 'text-slate-500'}
                          `}>
                            <span className="hidden sm:inline">Crafting Story</span>
                            <span className="sm:hidden">Story</span>
                          </div>
                        </div>
                      );
                    })()}
                    {Object.keys(STAGES).map((key, index) => {
                      const stage = STAGES[key];
                      const status = stageStatuses[stage];
                      const config = STAGE_CONFIG[stage];
                      const Icon = config?.icon || Sparkles;
                      const totalStages = Object.keys(STAGES).length; // 5 stages
                      // Evenly space all badges: 20%, 40%, 60%, 80%, 100%
                      const position = ((index + 1) / totalStages) * 100;
                      // Edge alignment: first badge left-aligned, last badge right-aligned
                      const isRightEdge = position >= 90;
                      const labelAlign = isRightEdge ? 'right-0' : 'left-1/2 -translate-x-1/2';
                      // Shorter names for mobile
                      const shortNames = {
                        story: 'Story',
                        voices: 'Voices',
                        sfx: 'SFX',
                        cover: 'Cover',
                        qa: 'QA'
                      };
                      const isActive = status === STATUS.IN_PROGRESS;

                    return (
                      <div
                        key={stage}
                        className="absolute transform -translate-x-1/2"
                        style={{ left: `${position}%` }}
                      >
                        {/* Particle effects for active state */}
                        {isActive && (
                          <>
                            <div className="absolute inset-0 -m-3 rounded-full border-2 border-golden-400/40 animate-ping" />
                            <div className="absolute inset-0 -m-2 rounded-full border border-golden-400/60 animate-pulse" />
                            {/* Floating sparkles around active badge */}
                            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                              <Star className="w-2 h-2 text-golden-300 animate-bounce" />
                            </div>
                          </>
                        )}
                        <div className={`
                          relative w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center border-2 sm:border-3 transition-all duration-500
                          ${status === STATUS.SUCCESS
                            ? 'bg-gradient-to-br from-green-400 to-emerald-600 border-green-300 shadow-lg shadow-green-500/60 scale-110'
                            : status === STATUS.IN_PROGRESS
                              ? 'bg-gradient-to-br from-golden-400 to-amber-600 border-golden-300 shadow-lg shadow-golden-500/60 scale-115'
                              : status === STATUS.ERROR
                                ? 'bg-gradient-to-br from-red-400 to-red-600 border-red-300 shadow-lg shadow-red-500/60'
                                : 'bg-gradient-to-br from-slate-600 to-slate-800 border-slate-500'}
                        `}>
                          {status === STATUS.SUCCESS ? (
                            <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow" />
                          ) : status === STATUS.IN_PROGRESS ? (
                            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin drop-shadow" />
                          ) : status === STATUS.ERROR ? (
                            <X className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow" />
                          ) : (
                            <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                          )}
                        </div>
                        {/* Stage label below badge - responsive with short names on mobile */}
                        <div className={`
                          absolute top-11 sm:top-13 transform whitespace-nowrap text-[9px] sm:text-xs font-semibold tracking-wide
                          ${labelAlign}
                          ${status === STATUS.SUCCESS ? 'text-green-400' :
                            status === STATUS.IN_PROGRESS ? 'text-golden-400 animate-pulse' :
                            status === STATUS.ERROR ? 'text-red-400' : 'text-slate-500'}
                        `}>
                          <span className="hidden sm:inline">{config?.name}</span>
                          <span className="sm:hidden">{shortNames[stage] || config?.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              {/* Spacer for milestone labels - slightly smaller on mobile */}
              <div className="h-6 sm:h-8" />
            </div>

            {/* Current Activity Panel - What's happening RIGHT NOW */}
            {/* P2 FIX: Improved mobile padding and activity indicator sizing */}
            <div className="px-3 sm:px-6 py-3 sm:py-4 bg-slate-900/50 border-b border-slate-700/50">
              <div className="flex items-start gap-3 sm:gap-4">
                {/* Animated activity indicator - smaller on mobile */}
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-golden-400/20 to-amber-500/20 flex items-center justify-center border border-golden-500/30">
                    <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-golden-400 animate-spin" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-green-500 animate-pulse border-2 border-slate-900" />
                </div>

                {/* P2 FIX: Improved mobile text sizing and truncation */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-golden-400 font-bold text-base sm:text-lg truncate">
                      {currentActivityLabel}
                    </span>
                    <span className="px-1.5 sm:px-2 py-0.5 bg-golden-500/20 text-golden-400 text-[10px] sm:text-xs rounded-full animate-pulse flex-shrink-0">
                      Active
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs sm:text-sm mb-2 line-clamp-2">
                    {currentActivityMessage}
                  </p>

                  {/* Sub-progress for current stage */}
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex-1 h-1.5 sm:h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-golden-400 rounded-full animate-pulse" style={{ width: `${activityProgressPercent}%` }} />
                    </div>
                    <Activity className="w-3 h-3 sm:w-4 sm:h-4 text-golden-400 animate-pulse flex-shrink-0" />
                  </div>
                </div>
              </div>
            </div>

            {/* AI Agents Activity Grid - Show what each agent is doing with counts */}
            {/* P2 FIX: Improved mobile padding */}
            <div className="px-3 sm:px-6 py-3 sm:py-4">
              <h3 className="text-slate-300 font-semibold mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                <Users className="w-4 h-4 text-purple-400" />
                AI Agents at Work
              </h3>
              {/* P2 FIX: Improved responsive grid for better mobile portrait/landscape */}
              {/* Portrait: 2 cols, Landscape: 3 cols, Tablet: 4 cols, Desktop: 5 cols */}
              <div className="grid grid-cols-2 landscape:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                {/* Story Generation Agent - Shows story creation status */}
                {/* Story is IN_PROGRESS when isGenerating but launch hasn't started yet */}
                {/* Story is SUCCESS when launch sequence has started (story must be complete) */}
                {(() => {
                  const launchStarted = Object.values(stageStatuses).some(s => s !== STATUS.PENDING);
                  const storyInProgress = isGenerating && !launchStarted;
                  const storyComplete = launchStarted || stageStatuses[STAGES.STORY] === STATUS.SUCCESS;
                  return (
                    <div className={`p-3 rounded-xl border transition-all ${
                      storyInProgress
                        ? 'bg-golden-500/10 border-golden-500/50 ring-2 ring-golden-500/20'
                        : storyComplete
                          ? 'bg-green-500/10 border-green-500/30'
                          : 'bg-slate-800/50 border-slate-700'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className={`w-4 h-4 ${
                            storyInProgress ? 'text-golden-400 animate-pulse' :
                            storyComplete ? 'text-green-400' : 'text-slate-500'
                          }`} />
                          <span className="text-xs font-medium text-slate-300">Story</span>
                        </div>
                        {storyComplete && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 inline-flex items-center">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {storyComplete
                          ? 'Story crafted'
                          : storyInProgress
                            ? 'Crafting story...'
                            : 'Waiting...'}
                      </p>
                    </div>
                  );
                })()}

                {/* Voice Assignment Agent - Shows voice count */}
                <div className={`p-3 rounded-xl border transition-all ${
                  stageStatuses[STAGES.VOICES] === STATUS.IN_PROGRESS
                    ? 'bg-purple-500/10 border-purple-500/50 ring-2 ring-purple-500/20'
                    : stageStatuses[STAGES.VOICES] === STATUS.SUCCESS
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Mic className={`w-4 h-4 ${
                        stageStatuses[STAGES.VOICES] === STATUS.IN_PROGRESS ? 'text-purple-400 animate-pulse' :
                        stageStatuses[STAGES.VOICES] === STATUS.SUCCESS ? 'text-green-400' : 'text-slate-500'
                      }`} />
                      <span className="text-xs font-medium text-slate-300">Voices</span>
                    </div>
                    {/* Voice count badge */}
                    {(voiceSummary.totalVoices || stats?.narratorCount) && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        stageStatuses[STAGES.VOICES] === STATUS.SUCCESS ? 'bg-green-500/20 text-green-400' :
                        stageStatuses[STAGES.VOICES] === STATUS.IN_PROGRESS ? 'bg-purple-500/20 text-purple-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {voiceSummary.totalVoices || stats?.narratorCount || 0}/{voiceSummary.totalCharacters || characterVoices.length || 1}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {stageStatuses[STAGES.VOICES] === STATUS.SUCCESS
                      ? `${voiceSummary.totalVoices || stats?.narratorCount || 1} voices for ${voiceSummary.totalCharacters || characterVoices.length || 1} characters`
                      : stageStatuses[STAGES.VOICES] === STATUS.IN_PROGRESS
                        ? 'Casting voice actors...'
                        : 'Waiting...'}
                  </p>
                </div>

                {/* SFX Detection Agent - Shows SFX count */}
                <div className={`p-3 rounded-xl border transition-all ${
                  stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS
                    ? 'bg-cyan-500/10 border-cyan-500/50 ring-2 ring-cyan-500/20'
                    : stageStatuses[STAGES.SFX] === STATUS.SUCCESS
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Volume2 className={`w-4 h-4 ${
                        stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS ? 'text-cyan-400 animate-pulse' :
                        stageStatuses[STAGES.SFX] === STATUS.SUCCESS ? 'text-green-400' : 'text-slate-500'
                      }`} />
                      <span className="text-xs font-medium text-slate-300">SFX</span>
                    </div>
                    {/* SFX count badge */}
                    {(sfxDetails.sfxCount > 0 || stats?.sfxCount > 0) && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        stageStatuses[STAGES.SFX] === STATUS.SUCCESS ? 'bg-green-500/20 text-green-400' :
                        stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS ? 'bg-cyan-500/20 text-cyan-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {sfxDetails.cachedCount || 0}/{sfxDetails.sfxCount || stats?.sfxCount || 0}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {stageStatuses[STAGES.SFX] === STATUS.SUCCESS
                      ? `${sfxDetails.sfxCount || stats?.sfxCount || 0} effects (${sfxDetails.cachedCount || 0} cached)`
                      : stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS
                        ? 'Detecting sound cues...'
                        : 'Waiting...'}
                  </p>
                </div>

                {/* Cover Art Agent - Shows progress % */}
                <div className={`p-3 rounded-xl border transition-all ${
                  stageStatuses[STAGES.COVER] === STATUS.IN_PROGRESS
                    ? 'bg-amber-500/10 border-amber-500/50 ring-2 ring-amber-500/20'
                    : stageStatuses[STAGES.COVER] === STATUS.SUCCESS
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Image className={`w-4 h-4 ${
                        stageStatuses[STAGES.COVER] === STATUS.IN_PROGRESS ? 'text-amber-400 animate-pulse' :
                        stageStatuses[STAGES.COVER] === STATUS.SUCCESS ? 'text-green-400' : 'text-slate-500'
                      }`} />
                      <span className="text-xs font-medium text-slate-300">Cover</span>
                    </div>
                    {/* Cover progress badge */}
                    {stageStatuses[STAGES.COVER] === STATUS.IN_PROGRESS && coverProgress.progress > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400">
                        {coverProgress.progress}%
                      </span>
                    )}
                    {stageStatuses[STAGES.COVER] === STATUS.SUCCESS && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 inline-flex items-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {stageStatuses[STAGES.COVER] === STATUS.SUCCESS
                      ? 'Cover art ready'
                      : stageStatuses[STAGES.COVER] === STATUS.IN_PROGRESS
                        ? coverProgress.message || 'DALL-E 3...'
                        : 'Waiting...'}
                  </p>
                </div>

                {/* QA Agent - Shows check count */}
                <div className={`p-3 rounded-xl border transition-all ${
                  stageStatuses[STAGES.QA] === STATUS.IN_PROGRESS
                    ? 'bg-green-500/10 border-green-500/50 ring-2 ring-green-500/20'
                    : stageStatuses[STAGES.QA] === STATUS.SUCCESS
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className={`w-4 h-4 ${
                        stageStatuses[STAGES.QA] === STATUS.IN_PROGRESS ? 'text-green-400 animate-pulse' :
                        stageStatuses[STAGES.QA] === STATUS.SUCCESS ? 'text-green-400' : 'text-slate-500'
                      }`} />
                      <span className="text-xs font-medium text-slate-300">QA</span>
                    </div>
                    {stageStatuses[STAGES.QA] === STATUS.SUCCESS && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 inline-flex items-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {stageStatuses[STAGES.QA] === STATUS.SUCCESS
                      ? 'All checks passed'
                      : stageStatuses[STAGES.QA] === STATUS.IN_PROGRESS
                        ? 'Validating content...'
                        : 'Waiting...'}
                  </p>
                </div>

                {/* Audio Synthesis Agent - Shows audio generation progress */}
                <div className={`p-3 rounded-xl border transition-all ${
                  stageStatuses[STAGES.AUDIO] === STATUS.IN_PROGRESS
                    ? 'bg-blue-500/10 border-blue-500/50 ring-2 ring-blue-500/20'
                    : stageStatuses[STAGES.AUDIO] === STATUS.SUCCESS
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <AudioLines className={`w-4 h-4 ${
                        stageStatuses[STAGES.AUDIO] === STATUS.IN_PROGRESS ? 'text-blue-400 animate-pulse' :
                        stageStatuses[STAGES.AUDIO] === STATUS.SUCCESS ? 'text-green-400' : 'text-slate-500'
                      }`} />
                      <span className="text-xs font-medium text-slate-300">Audio</span>
                    </div>
                    {stageStatuses[STAGES.AUDIO] === STATUS.SUCCESS && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 inline-flex items-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {stageStatuses[STAGES.AUDIO] === STATUS.SUCCESS
                      ? 'Audio ready'
                      : stageStatuses[STAGES.AUDIO] === STATUS.IN_PROGRESS
                        ? 'Synthesizing narration...'
                        : 'Waiting...'}
                  </p>
                </div>
              </div>
            </div>

            {/* Cover Art Generation Progress - Enhanced */}
            {coverProgress.status === 'generating' && (
              <div className="px-6 py-4 bg-amber-500/5 border-t border-amber-500/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Image className="w-6 h-6 text-amber-400 animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-amber-400 font-medium">Generating Cover Art with DALL-E 3</span>
                      <span className="text-amber-400 font-bold">{coverProgress.progress || 0}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300"
                        style={{ width: `${coverProgress.progress || 0}%` }}
                      />
                    </div>
                    {coverProgress.message && (
                      <p className="text-amber-400/70 text-xs mt-2">{coverProgress.message}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Compact Activity Summary - Shows latest activity inline */}
            <div className="px-6 py-3 border-t border-slate-700/50">
              <div className="flex items-center gap-3 text-xs">
                <Activity className="w-3 h-3 text-golden-400 animate-pulse" />
                <span className="text-slate-500">Latest:</span>
                <span className="text-slate-300 flex-1 truncate">
                  {detailedProgressLog && detailedProgressLog.length > 0
                    ? (detailedProgressLog[detailedProgressLog.length - 1]?.message || detailedProgressLog[detailedProgressLog.length - 1])
                    : latestFallback}
                </span>
              </div>
            </div>

            {/* Cost & Usage Summary Bar */}
            <div className="px-6 py-3 bg-slate-900/80 border-t border-slate-700/50 flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3 text-green-400" />
                  <span className="text-slate-400">Est. Cost:</span>
                  <span className="text-green-400 font-medium">{formatCost(usage.totalCost || 0)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-blue-400" />
                  <span className="text-slate-400">Tokens:</span>
                  <span className="text-blue-400 font-medium">{formatTokens(usage.totalTokens || 0)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-slate-500" />
                <span className="text-slate-500">Processing...</span>
              </div>
            </div>
          </div>

          {/* Shimmer animation style */}
          <style>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
            .animate-shimmer {
              animation: shimmer 2s infinite;
            }
          `}</style>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  {warnings.map((warning, i) => (
                    <p key={i} className="text-amber-400 text-xs">{warning}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-2">
                <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  {errors.map((error, i) => (
                    <p key={i} className="text-red-400 text-xs">{error}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons - Only show inline button when NOT isReadyToPlay (floating bar handles it then) */}
          {!hasError && !isReadyToPlay && (
            <div className="mt-4 space-y-3">
              {allStagesComplete && onStartPlayback && (
                <button
                  onClick={onStartPlayback}
                  className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-golden-400 to-amber-500
                             text-slate-900 font-bold text-lg shadow-lg shadow-golden-400/20
                             hover:from-golden-300 hover:to-amber-400 transition-all
                             flex items-center justify-center gap-3 animate-pulse"
                >
                  <Play className="w-6 h-6" />
                  Start Chapter {chapterNumber}
                </button>
              )}
              <button
                onClick={onCancel}
                className={`w-full px-4 py-2 rounded-lg text-slate-500 hover:text-slate-300
                           hover:bg-slate-800 transition-colors text-sm ${allStagesComplete ? 'mt-0' : ''}`}
              >
                Cancel
              </button>
            </div>
          )}

          {hasError && (
            <button
              onClick={onCancel}
              className="mt-4 w-full px-6 py-3 rounded-xl bg-slate-800 text-slate-300
                         hover:bg-slate-700 transition-colors"
            >
              Go Back
            </button>
          )}
        </div>
      )}

      {/* OLD HUD Content section removed - now consolidated into enhanced progress section above */}
      {/* The enhanced progress section above includes all functionality */}
      {false && showHUD && !isReadyToPlay && (
        <div className="space-y-4 hidden">
          {/* Two-column layout on larger screens */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column - Agent Status + Usage */}
            <div className="space-y-4">
              {/* Agent Status Panel */}
              <AgentStatusPanel agents={Array.isArray(agents) ? agents : Object.values(agents)} compact={true} />

              {/* Usage Tracker Panel */}
              <UsageTrackerPanel
                usage={usage}
                formatCost={formatCost}
                formatTokens={formatTokens}
                formatCharacters={formatCharacters}
                compact={true}
              />
            </div>

            {/* Right Column - Validation Stages */}
            <div className="space-y-4">
              {/* Validation Progress */}
              <div className="bg-slate-800/60 rounded-xl p-4">
                <h3 className="text-slate-300 text-sm font-medium mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-golden-400" />
                  Preparing Your Story
                </h3>

                <div className="space-y-2">
                  {Object.keys(STAGES).map(key => {
                    const stage = STAGES[key];
                    return (
                      <StageIndicator
                        key={stage}
                        stage={stage}
                        status={stageStatuses[stage] || STATUS.PENDING}
                        details={stageDetails[stage]}
                        canRetry={canRetryStages[stage]}
                        isRetrying={retryingStage === stage}
                        onRetry={onRetryStage}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Character Cast Panel with regenerate */}
              {characterVoices.length > 0 && (
                <div className="relative group">
                  <CharacterCastPanel
                    characters={characterVoices}
                    totalCharacters={voiceSummary.totalCharacters}
                    totalVoices={voiceSummary.totalVoices}
                    compact={true}
                  />
                  {onRegenerateVoices && (
                    <button
                      onClick={onRegenerateVoices}
                      disabled={isRegeneratingVoices}
                      className={`
                        absolute top-2 right-2 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10
                        ${isRegeneratingVoices
                          ? 'bg-slate-700/90 cursor-wait'
                          : 'bg-slate-700/80 hover:bg-slate-600'
                        }
                      `}
                      title="Regenerate voice assignments"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-purple-400 ${isRegeneratingVoices ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
              )}

              {/* SFX List with regenerate */}
              <div className="relative group">
                <ExpandableSFXList
                  sfxList={sfxDetails.sfxList}
                  sfxCount={sfxDetails.sfxCount}
                  cachedCount={sfxDetails.cachedCount}
                  generatingCount={sfxDetails.generatingCount}
                  totalInLibrary={sfxDetails.totalInLibrary}
                  sfxEnabled={sfxDetails.sfxEnabled !== false}
                  compact={true}
                  isAnalyzing={stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS || isRegeneratingSfx}
                />
                {onRegenerateSfx && (
                  <button
                    onClick={onRegenerateSfx}
                    disabled={isRegeneratingSfx}
                    className={`
                      absolute top-2 right-2 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10
                      ${isRegeneratingSfx
                        ? 'bg-slate-700/90 cursor-wait'
                        : 'bg-slate-700/80 hover:bg-slate-600'
                      }
                    `}
                    title="Re-detect sound effects"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRegeneratingSfx ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>

              {/* QA Checks */}
              <QAChecksPanel compact={true} />

              {/* Safety Report Panel */}
              {safetyReport && (
                <SafetyReportPanel safetyReport={safetyReport} compact={true} />
              )}
            </div>
          </div>

          {/* Stats Summary with badges (fallback display for narrator/SFX info) */}
          {stats && (stats.narratorCount > 0 || stats.sfxCount > 0) && (
            <StatsSummary stats={stats} />
          )}

          {/* Detailed Progress Log - Technical Information Panel */}
          {detailedProgressLog && detailedProgressLog.length > 0 && (
            <DetailedProgressPanel
              logs={detailedProgressLog}
              isExpanded={progressLogExpanded}
              onToggleExpand={() => setProgressLogExpanded(!progressLogExpanded)}
              maxHeight="250px"
            />
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  {warnings.map((warning, i) => (
                    <p key={i} className="text-amber-400 text-xs">
                      {warning}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-2">
                <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  {errors.map((error, i) => (
                    <p key={i} className="text-red-400 text-xs">
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Action buttons - Only show inline when NOT isReadyToPlay (floating bar handles it then) */}
          {!hasError && !isReadyToPlay && (
            <div className="space-y-3">
              {/* Start Chapter Button - shows when all stages complete */}
              {allStagesComplete && onStartPlayback && (
                <button
                  onClick={onStartPlayback}
                  className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-golden-400 to-amber-500
                             text-slate-900 font-bold text-lg shadow-lg shadow-golden-400/20
                             hover:from-golden-300 hover:to-amber-400 transition-all
                             flex items-center justify-center gap-3 animate-pulse"
                >
                  <Play className="w-6 h-6" />
                  Start Chapter {chapterNumber}
                </button>
              )}

              {/* Cancel button */}
              <button
                onClick={onCancel}
                className={`w-full px-4 py-2 rounded-lg text-slate-500 hover:text-slate-300
                           hover:bg-slate-800 transition-colors text-sm
                           ${allStagesComplete ? 'mt-0' : ''}`}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Go back button on error */}
          {hasError && (
            <button
              onClick={onCancel}
              className="w-full px-6 py-3 rounded-xl bg-slate-800 text-slate-300
                         hover:bg-slate-700 transition-colors"
            >
              Go Back
            </button>
          )}
        </div>
      )}

      {/* Ready to Play UI - floating bottom bar when ready */}
      {/* P2 FIX: Hide Begin Chapter button when audio is generating (after user clicked Begin Chapter) */}
      {isReadyToPlay && !isGeneratingAudio && !isAudioQueued && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-3 sm:px-4">
          <div className="bg-slate-900/95 backdrop-blur-sm rounded-2xl p-3 sm:p-4 border border-slate-700 shadow-2xl">
            <ReadyToPlaySection
            stats={stats}
            characterVoices={characterVoices}
            voiceSummary={voiceSummary}
            usage={usage}
            formatCost={formatCost}
            formatTokens={formatTokens}
            formatCharacters={formatCharacters}
            sfxDetails={sfxDetails}
            autoplayEnabled={autoplayEnabled}
            onAutoplayChange={onAutoplayChange}
            sfxEnabled={sfxEnabled}
            onSfxToggle={onSfxToggle}
            onStartPlayback={onStartPlayback}
            onCancel={onCancel}
            chapterNumber={chapterNumber}
            />
          </div>
        </div>
      )}

      {/* Audio Generation Status - shown when Begin Chapter was clicked and audio is generating */}
      {isReadyToPlay && (isGeneratingAudio || isAudioQueued) && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-3 sm:px-4">
          <div className="bg-slate-900/95 backdrop-blur-sm rounded-2xl p-3 sm:p-4 border border-slate-700 shadow-2xl">
            <div className="flex items-center justify-center gap-3 text-slate-200">
              <Loader2 className="w-5 h-5 animate-spin text-golden-400" />
              <span className="font-medium">
                {audioGenerationStatus?.message || 'Generating audio...'}
              </span>
            </div>
            {audioGenerationStatus?.percent > 0 && (
              <div className="mt-3 w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-golden-400 to-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${audioGenerationStatus.percent}%` }}
                />
              </div>
            )}
            <button
              onClick={onCancel}
              className="mt-3 w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400
                         hover:bg-slate-700 hover:text-slate-200 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default LaunchScreen;
export { STAGES, STATUS, STAGE_CONFIG, COUNTDOWN_PHASE };
