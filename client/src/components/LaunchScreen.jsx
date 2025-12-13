/**
 * LaunchScreen Component
 * Pre-narration launch screen with sequential validation progress,
 * visual indicators, and cinematic countdown.
 *
 * Features:
 * - Sequential stage indicators with retry capability
 * - Cinematic countdown with pre-cue message
 * - Cover art display with regeneration option
 * - Stats summary panel
 * - HUD-style panels for agent status and usage tracking
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  Mic, Volume2, Image, Shield, Check, X, AlertCircle,
  Loader2, Play, ChevronDown, Users, Clock, Sparkles,
  RefreshCw, RotateCcw, Activity, DollarSign, ZoomIn, Minus
} from 'lucide-react';

// Import HUD components
import AgentStatusPanel from './AgentStatusPanel';
import UsageTrackerPanel from './UsageTrackerPanel';
import ExpandableSFXList from './ExpandableSFXList';
import CharacterCastPanel from './CharacterCastPanel';
import QAChecksPanel, { useQAChecks } from './QAChecksPanel';
import DetailedProgressPanel from './DetailedProgressPanel';
import { StageIndicator, CountdownDisplay } from './launch';

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
    <div className={`bg-night-700/50 rounded-lg overflow-hidden transition-all ${expanded ? 'ring-1 ring-' + color + '-500/30' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-night-600/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 text-${color}-400`} />
          <span className="text-night-300 text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-${color}-400 font-bold`}>{count}</span>
          <ChevronDown
            className={`w-4 h-4 text-night-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {expanded && children && (
        <div className="px-3 pb-3 pt-0 border-t border-night-600/50">
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
    <div className="bg-night-800/60 rounded-xl p-4 mt-4 space-y-3">
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
                  <span className="text-night-500">as {narrator.character}</span>
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
              <span className="text-night-400">Local library:</span>
              <span className="text-cyan-400">{sfxLocalTotal} sounds</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-night-400">Cached for story:</span>
              <span className="text-green-400">{sfxCached}</span>
            </div>
            {sfxMissing > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-night-400">To generate:</span>
                <span className="text-amber-400">{sfxMissing}</span>
              </div>
            )}

            {/* SFX names */}
            {sfxNames.length > 0 && (
              <div className="mt-2 pt-2 border-t border-night-600/50">
                <p className="text-night-500 text-xs mb-1">Effects:</p>
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
                    <span className="px-2 py-0.5 text-night-500 text-xs">
                      +{sfxNames.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Missing SFX */}
            {missingSfx.length > 0 && (
              <div className="mt-2 pt-2 border-t border-night-600/50">
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
        <div className="flex items-center justify-center gap-1 text-night-500 text-xs pt-2 border-t border-night-600/50">
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
    <div className={`bg-night-800/60 rounded-xl p-3 ${compact ? 'text-sm' : ''}`}>
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

          <p className={`text-night-300 text-xs leading-relaxed`}>
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
            <div className="mt-2 pt-2 border-t border-night-700/50">
              <p className="text-night-500 text-xs mb-1">Changes:</p>
              <ul className="text-xs text-night-400 space-y-0.5">
                {report.changesMade.slice(0, 3).map((change, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="text-amber-400/60">•</span>
                    <span>{change}</span>
                  </li>
                ))}
                {report.changesMade.length > 3 && (
                  <li className="text-night-500">+{report.changesMade.length - 3} more</li>
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
        <div className="bg-night-800/60 rounded-xl overflow-hidden border border-night-700">
          {/* Story Details Header - Clickable to expand */}
          <button
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-night-700/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-golden-400" />
              <span className="text-night-200 font-medium">Story Details</span>
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
            <ChevronDown className={`w-5 h-5 text-night-500 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
          </button>

          {/* Expandable Content - Scrollable when expanded */}
          {detailsExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-night-700/50 max-h-64 overflow-y-auto">
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

      {/* Main Action Row - Auto-Play toggle, Begin Chapter, SFX toggle, Cancel */}
      <div className="flex items-center gap-2">
        {/* Auto-Play Toggle - Left side, sliding pill style */}
        <div className="flex items-center gap-2 px-3 py-2 bg-night-800/80 rounded-xl border border-night-700">
          <button
            onClick={() => onAutoplayChange?.(!autoplayEnabled)}
            className={`w-10 h-6 rounded-full transition-all flex-shrink-0 ${
              autoplayEnabled ? 'bg-green-500' : 'bg-night-600'
            }`}
            title={autoplayEnabled ? 'Auto-play enabled' : 'Auto-play disabled'}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
              autoplayEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`} />
          </button>
          <span className="text-night-400 text-xs whitespace-nowrap">Auto-Play</span>
        </div>

        {/* Begin Chapter Button - Center, takes available space */}
        <button
          onClick={handleStartClick}
          disabled={isStarting}
          className={`flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-golden-400 to-amber-500
                     text-night-900 font-semibold shadow-lg shadow-golden-400/20
                     transition-all flex items-center justify-center gap-2
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

        {/* SFX Toggle - Right side, sliding pill style */}
        <div className="flex items-center gap-2 px-3 py-2 bg-night-800/80 rounded-xl border border-night-700">
          <button
            onClick={onSfxToggle}
            className={`w-10 h-6 rounded-full transition-all flex-shrink-0 ${
              sfxEnabled ? 'bg-cyan-500' : 'bg-night-600'
            }`}
            title={sfxEnabled ? 'Sound effects enabled' : 'Sound effects disabled'}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
              sfxEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`} />
          </button>
          <span className="text-night-400 text-xs whitespace-nowrap">SFX</span>
        </div>

        {/* Cancel Button - Far right */}
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-xl bg-night-800 border border-night-700 text-night-400
                     hover:bg-night-700 hover:text-night-200 transition-colors text-sm"
        >
          Cancel
        </button>
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
  coverUrl,
  title,
  synopsis,
  stats,
  stageStatuses = {},
  stageDetails = {},
  isCountdownActive,
  countdownPhase,
  countdownValue,
  isReadyToPlay,
  autoplayEnabled,
  onAutoplayChange,
  onStartPlayback,
  onCancel,
  onCancelCountdown,
  warnings = [],
  errors = [],
  // Retry props
  canRetryStages = {},
  retryingStage,
  onRetryStage,
  // Cover regeneration props
  isRegeneratingCover,
  onRegenerateCover,
  // Other regeneration props
  isRegeneratingSynopsis = false,
  onRegenerateSynopsis,
  isRegeneratingSfx = false,
  onRegenerateSfx,
  isRegeneratingVoices = false,
  onRegenerateVoices,
  // Text only mode
  onStartTextOnly,
  // Manual countdown start (when autoCountdown is false)
  onStartCountdown,
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
  // Text display props
  showText = false,
  onShowTextToggle,
  storyText = '',
  // Detailed progress log for technical info
  detailedProgressLog = [],
  // Initial generation phase props (before launch sequence starts)
  isGenerating = false,
  generationProgress = { step: 0, percent: 0, message: '' }
}) {
  // State for fullscreen cover modal
  const [showCoverFullscreen, setShowCoverFullscreen] = useState(false);

  // State for cover minimized (thumbnail mode)
  const [coverMinimized, setCoverMinimized] = useState(false);

  // State for detailed progress panel expansion
  const [progressLogExpanded, setProgressLogExpanded] = useState(true);

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

  // Determine if we should show detailed HUD
  const showHUD = !isCountdownActive;

  // Debug logging for data flow
  console.log('[LaunchScreen] Render state:', {
    showHUD,
    hasStats: !!stats,
    statsNarratorCount: stats?.narratorCount,
    statsSfxCount: stats?.sfxCount,
    statsTitle: stats?.title,
    statsSynopsis: stats?.synopsis,
    sfxDetails: sfxDetails ? { sfxCount: sfxDetails.sfxCount, sfxListLength: sfxDetails.sfxList?.length } : null,
    characterVoicesCount: characterVoices?.length,
    title,
    synopsis: synopsis?.substring(0, 50)
  });

  return (
    <div className="max-w-3xl mx-auto w-full animate-fade-in px-4 flex flex-col" style={{ maxHeight: 'calc(100vh - 120px)' }}>
      {/* Newspaper-Style Story Display - Cover floats left, content wraps around */}
      {/* ONLY show when ready to play - prevents cover appearing before progress bar finishes */}
      {/* This ensures the reveal happens AFTER all generation stages complete */}
      {isReadyToPlay && (coverUrl || coverProgress.coverUrl || title || synopsis) && (
        <div className="launch-story-container mb-4 p-4 bg-night-800/50 rounded-2xl border border-night-700 overflow-y-auto flex-1" style={{ maxHeight: '60vh', minHeight: '200px' }}>
          <div className="story-flow-content overflow-hidden">
            {/* Floating Cover Art - Text wraps around it */}
            {(coverUrl || coverProgress.coverUrl) && !coverMinimized && (
            <div className="story-cover-float relative group">
              {/* Book cover styling with spine effect - CLICKABLE for fullscreen */}
              <div
                className="relative cursor-pointer"
                style={{ perspective: '1000px' }}
                onClick={() => setShowCoverFullscreen(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setShowCoverFullscreen(true)}
              >
                {/* Book spine shadow */}
                <div className="absolute left-0 top-2 bottom-2 w-3 bg-gradient-to-r from-black/40 to-transparent rounded-l-sm z-10" />

                {/* Cover image with book-like styling */}
                <img
                  src={coverUrl || coverProgress.coverUrl}
                  alt={title || 'Story Cover'}
                  className="cover-image object-cover shadow-2xl border-2 border-night-600"
                  style={{
                    borderRadius: '4px 12px 12px 4px',
                    boxShadow: '8px 8px 20px rgba(0,0,0,0.5), -2px 0 8px rgba(0,0,0,0.3)'
                  }}
                />

                {/* Minimize cover icon - top right, shows on hover */}
                {/* Click anywhere else on cover opens fullscreen */}
                <button
                  onClick={(e) => { e.stopPropagation(); setCoverMinimized(true); }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-night-800/80 text-night-400 hover:text-white hover:bg-night-700 opacity-0 group-hover:opacity-100 transition-all z-20"
                  title="Minimize cover"
                >
                  <Minus className="w-4 h-4" />
                </button>

                {/* Regenerate cover button - bottom left, stops propagation to prevent fullscreen */}
                {onRegenerateCover && !isCountdownActive && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRegenerateCover(); }}
                    disabled={isRegeneratingCover}
                    className={`
                      absolute bottom-2 left-2 p-2 rounded-lg transition-all z-20
                      ${isRegeneratingCover
                        ? 'bg-night-800/90 cursor-wait'
                        : 'bg-night-800/70 hover:bg-night-700/90 opacity-0 group-hover:opacity-100'}
                    `}
                    title="Regenerate cover art"
                  >
                    {isRegeneratingCover ? (
                      <Loader2 className="w-4 h-4 text-golden-400 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-night-300" />
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Minimized cover thumbnail - top left corner */}
          {(coverUrl || coverProgress.coverUrl) && coverMinimized && (
            <button
              onClick={() => setCoverMinimized(false)}
              className="float-left mr-3 mb-2 w-12 h-16 rounded-lg overflow-hidden border-2 border-night-600 hover:border-golden-400 transition-colors shadow-lg"
              title="Expand cover"
            >
              <img
                src={coverUrl || coverProgress.coverUrl}
                alt="Story Cover"
                className="w-full h-full object-cover"
              />
            </button>
          )}

          {/* Title - flows around cover */}
          {title && (
            <h1 className="text-2xl md:text-3xl font-bold mb-3 gradient-text">
              {title}
            </h1>
          )}

          {/* Story Details Badge - narrative style, author, mood */}
          <div className="flex flex-wrap gap-2 mb-3">
            {stats?.storyType && (
              <span className="px-2 py-1 bg-night-700 rounded text-night-300 text-xs">
                {stats.storyType}
              </span>
            )}
            {stats?.authorStyle && (
              <span className="px-2 py-1 bg-amber-500/20 rounded text-amber-400 text-xs">
                Style: {stats.authorStyle}
              </span>
            )}
            {stats?.narratorStyle && (
              <span className="px-2 py-1 bg-purple-500/20 rounded text-purple-400 text-xs">
                {stats.narratorStyle.charAt(0).toUpperCase() + stats.narratorStyle.slice(1)} Tone
              </span>
            )}
          </div>

          {/* Synopsis - flows around cover */}
          {synopsis && (
            <div className="relative group mb-4">
              <p className="text-night-300 text-sm md:text-base leading-relaxed italic">
                {synopsis}
              </p>
              {onRegenerateSynopsis && !isCountdownActive && (
                <button
                  onClick={onRegenerateSynopsis}
                  disabled={isRegeneratingSynopsis}
                  className={`
                    inline-block ml-2 p-1 rounded transition-all opacity-0 group-hover:opacity-100
                    ${isRegeneratingSynopsis
                      ? 'bg-night-800/90 cursor-wait'
                      : 'bg-night-800/80 hover:bg-night-700'
                    }
                  `}
                  title="Regenerate synopsis"
                >
                  <RefreshCw className={`w-3 h-3 text-night-400 ${isRegeneratingSynopsis ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          )}

          {/* Story Text - flows around cover (newspaper style) */}
          {storyText && (
            <div className="story-text-flow">
              <p className="text-night-100 text-base leading-relaxed whitespace-pre-wrap font-serif">
                {storyText}
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* CSS for newspaper-style float layout */}
      <style>{`
        /* Container for flow content */
        .story-flow-content {
          overflow: hidden; /* Contain floats */
        }

        /* PC Layout (min-width: 768px) - Cover floats left, content wraps */
        @media (min-width: 768px) {
          .story-cover-float {
            float: left;
            margin-right: 1.5rem;
            margin-bottom: 1rem;
            shape-outside: margin-box;
          }
          .cover-image {
            width: 200px;
            height: 280px;
          }
        }

        /* Large screens - bigger cover */
        @media (min-width: 1024px) {
          .story-cover-float {
            margin-right: 2rem;
          }
          .cover-image {
            width: 220px;
            height: 308px;
          }
        }

        /* Mobile Portrait (max-width: 767px) - Cover centered above content */
        @media (max-width: 767px) {
          .story-cover-float {
            float: none;
            display: flex;
            justify-content: center;
            margin-bottom: 1.5rem;
          }
          .cover-image {
            width: 160px;
            height: 220px;
          }
          .story-flow-content {
            text-align: center;
          }
          .story-flow-content h1,
          .story-flow-content p,
          .story-flow-content .story-text-flow {
            text-align: left;
          }
          .story-flow-content > div:first-child {
            text-align: center;
          }
        }

        /* Mobile Landscape - Smaller float */
        @media (max-width: 767px) and (orientation: landscape) {
          .story-cover-float {
            float: left;
            margin-right: 1rem;
            margin-bottom: 0.5rem;
          }
          .cover-image {
            width: 120px;
            height: 168px;
          }
          .story-flow-content {
            text-align: left;
          }
        }
      `}</style>

      {/* ENHANCED FULL-WIDTH PROGRESS SECTION - Shows during generation AND launch */}
      {((showHUD && !isReadyToPlay) || isGenerating) && (
        <div className="mb-6 -mx-4 px-4 md:-mx-8 md:px-8 lg:-mx-12 lg:px-12">
          {/* Main Progress Container - Full Width */}
          <div className="bg-gradient-to-b from-night-800/95 to-night-900/95 rounded-2xl border border-night-600 overflow-hidden shadow-2xl">
            {/* Header with animated gradient */}
            <div className="relative px-6 py-4 bg-gradient-to-r from-golden-500/10 via-amber-500/5 to-golden-500/10 border-b border-night-700">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-golden-400/5 via-transparent to-transparent" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Sparkles className="w-8 h-8 text-golden-400" />
                    <div className="absolute inset-0 animate-ping">
                      <Sparkles className="w-8 h-8 text-golden-400/30" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-golden-400">Creating Your Story</h2>
                    <p className="text-night-400 text-sm">
                      {isGenerating && Object.keys(stageStatuses).length === 0
                        ? (generationProgress.message || 'AI agents working together to craft your experience')
                        : 'AI agents working together to craft your experience'
                      }
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold text-golden-400">
                    {/* Use generationProgress during initial generation, stageStatuses during launch */}
                    {isGenerating && Object.keys(stageStatuses).length === 0
                      ? Math.round(generationProgress.percent || 0)
                      : Math.round(
                          (Object.values(stageStatuses).filter(s => s === STATUS.SUCCESS).length /
                           Object.keys(STAGES).length) * 100
                        )
                    }%
                  </div>
                  <div className="text-night-500 text-xs">
                    {isGenerating && Object.keys(stageStatuses).length === 0 ? 'Generating' : 'Complete'}
                  </div>
                </div>
              </div>
            </div>

            {/* Full-Width Progress Bar with Milestone Markers */}
            {/* Responsive padding: more on desktop, less on mobile to maximize bar width */}
            <div className="px-2 sm:px-4 py-4 border-b border-night-700/50 overflow-visible">
              {/* Responsive margins: reduced to give more space for labels. overflow-visible for edge labels */}
              <div className="relative mx-4 sm:mx-8 md:mx-12 lg:mx-16 overflow-visible">
                {/* Background track - z-0 to stay behind badges */}
                <div className="relative z-0 w-full h-3 sm:h-4 bg-night-700 rounded-full overflow-hidden">
                  {/* Animated progress fill with smooth easing */}
                  <div
                    className="h-full bg-gradient-to-r from-golden-400 via-amber-400 to-golden-500 relative"
                    style={{
                      width: `${(() => {
                        if (isGenerating && Object.keys(stageStatuses).length === 0) {
                          // During initial generation, use percent from generationProgress
                          return generationProgress.percent || 5;
                        }
                        // During launch stages, calculate smooth progress
                        const completedCount = Object.values(stageStatuses).filter(s => s === STATUS.SUCCESS).length;
                        const inProgressCount = Object.values(stageStatuses).filter(s => s === STATUS.IN_PROGRESS).length;
                        const totalStages = Object.keys(STAGES).length;
                        // Add 0.5 for each in-progress stage to show partial progress
                        const effectiveProgress = (completedCount + (inProgressCount * 0.5)) / totalStages;
                        return effectiveProgress * 100;
                      })()}%`,
                      transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                  >
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                  </div>
                </div>

                {/* Milestone Badges - z-20 to stay above progress bar */}
                {isGenerating && Object.keys(stageStatuses).length === 0 ? (
                  /* Generation Phase Milestones */
                  <div className="absolute inset-0 z-20 flex items-center justify-between">
                    {['Planning', 'Writing', 'Characters', 'Finalizing'].map((phase, index) => {
                      const position = ((index + 1) / 4) * 100;
                      const phasePercent = (index + 1) * 25;
                      const isComplete = generationProgress.percent >= phasePercent;
                      const isActive = generationProgress.percent >= phasePercent - 25 && generationProgress.percent < phasePercent;
                      // Adjust label position for edge badges to prevent cutoff
                      const isRightEdge = position >= 90;
                      const labelAlign = isRightEdge ? 'right-0' : 'left-1/2 -translate-x-1/2';

                      return (
                        <div
                          key={phase}
                          className="absolute transform -translate-x-1/2"
                          style={{ left: `${position}%` }}
                        >
                          <div className={`
                            w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 sm:border-3 transition-all duration-500
                            ${isComplete
                              ? 'bg-green-500 border-green-400 shadow-lg shadow-green-500/50 scale-110'
                              : isActive
                                ? 'bg-golden-500 border-golden-400 shadow-lg shadow-golden-500/50 animate-pulse scale-110'
                                : 'bg-night-700 border-night-600'}
                          `}>
                            {isComplete ? (
                              <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                            ) : isActive ? (
                              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-night-400" />
                            )}
                          </div>
                          <div className={`
                            absolute top-10 sm:top-12 transform whitespace-nowrap text-[10px] sm:text-xs font-medium
                            ${labelAlign}
                            ${isComplete ? 'text-green-400' : isActive ? 'text-golden-400' : 'text-night-500'}
                          `}>
                            {phase}
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
                          <div className={`
                            w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 sm:border-3 transition-all duration-500
                            ${craftingState === 'complete'
                              ? 'bg-green-500 border-green-400 shadow-lg shadow-green-500/50 scale-110'
                              : craftingState === 'active'
                                ? 'bg-golden-500 border-golden-400 shadow-lg shadow-golden-500/50 animate-pulse scale-110'
                                : 'bg-night-700 border-night-600'}
                          `}>
                            {craftingState === 'complete' ? (
                              <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                            ) : craftingState === 'active' ? (
                              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-night-400" />
                            )}
                          </div>
                          {/* Label aligned to left edge to prevent cutoff */}
                          <div className={`
                            absolute top-10 sm:top-12 left-0 whitespace-nowrap text-[10px] sm:text-xs font-medium
                            ${craftingState === 'complete' ? 'text-green-400' : craftingState === 'active' ? 'text-golden-400' : 'text-night-500'}
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

                    return (
                      <div
                        key={stage}
                        className="absolute transform -translate-x-1/2"
                        style={{ left: `${position}%` }}
                      >
                        <div className={`
                          w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 sm:border-3 transition-all duration-500
                          ${status === STATUS.SUCCESS
                            ? 'bg-green-500 border-green-400 shadow-lg shadow-green-500/50 scale-110'
                            : status === STATUS.IN_PROGRESS
                              ? 'bg-golden-500 border-golden-400 shadow-lg shadow-golden-500/50 animate-pulse scale-110'
                              : status === STATUS.ERROR
                                ? 'bg-red-500 border-red-400 shadow-lg shadow-red-500/50'
                                : 'bg-night-700 border-night-600'}
                        `}>
                          {status === STATUS.SUCCESS ? (
                            <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                          ) : status === STATUS.IN_PROGRESS ? (
                            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin" />
                          ) : status === STATUS.ERROR ? (
                            <X className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                          ) : (
                            <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-night-400" />
                          )}
                        </div>
                        {/* Stage label below badge - responsive with short names on mobile */}
                        <div className={`
                          absolute top-10 sm:top-12 transform whitespace-nowrap text-[10px] sm:text-xs font-medium
                          ${labelAlign}
                          ${status === STATUS.SUCCESS ? 'text-green-400' :
                            status === STATUS.IN_PROGRESS ? 'text-golden-400' :
                            status === STATUS.ERROR ? 'text-red-400' : 'text-night-500'}
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
            <div className="px-6 py-4 bg-night-900/50 border-b border-night-700/50">
              <div className="flex items-start gap-4">
                {/* Animated activity indicator */}
                <div className="relative flex-shrink-0">
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-golden-400/20 to-amber-500/20 flex items-center justify-center border border-golden-500/30">
                    <Loader2 className="w-8 h-8 text-golden-400 animate-spin" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 animate-pulse border-2 border-night-900" />
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-golden-400 font-bold text-lg">
                      {Object.entries(stageStatuses).find(([_, s]) => s === STATUS.IN_PROGRESS)?.[0]
                        ? STAGE_CONFIG[Object.entries(stageStatuses).find(([_, s]) => s === STATUS.IN_PROGRESS)?.[0]]?.name
                        : 'Initializing...'}
                    </span>
                    <span className="px-2 py-0.5 bg-golden-500/20 text-golden-400 text-xs rounded-full animate-pulse">
                      Active
                    </span>
                  </div>
                  <p className="text-night-300 text-sm mb-2 line-clamp-2">
                    {Object.entries(stageDetails).find(([k, _]) => stageStatuses[k] === STATUS.IN_PROGRESS)?.[1]?.message
                      || STAGE_CONFIG[Object.entries(stageStatuses).find(([_, s]) => s === STATUS.IN_PROGRESS)?.[0]]?.description
                      || 'Processing your story...'}
                  </p>

                  {/* Sub-progress for current stage */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-night-700 rounded-full overflow-hidden">
                      <div className="h-full bg-golden-400 rounded-full animate-pulse" style={{ width: '60%' }} />
                    </div>
                    <Activity className="w-4 h-4 text-golden-400 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>

            {/* AI Agents Activity Grid - Show what each agent is doing with counts */}
            <div className="px-6 py-4">
              <h3 className="text-night-300 font-semibold mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                AI Agents at Work
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
                          : 'bg-night-800/50 border-night-700'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className={`w-4 h-4 ${
                            storyInProgress ? 'text-golden-400 animate-pulse' :
                            storyComplete ? 'text-green-400' : 'text-night-500'
                          }`} />
                          <span className="text-xs font-medium text-night-300">Story</span>
                        </div>
                        {storyComplete && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-night-500">
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
                      : 'bg-night-800/50 border-night-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Mic className={`w-4 h-4 ${
                        stageStatuses[STAGES.VOICES] === STATUS.IN_PROGRESS ? 'text-purple-400 animate-pulse' :
                        stageStatuses[STAGES.VOICES] === STATUS.SUCCESS ? 'text-green-400' : 'text-night-500'
                      }`} />
                      <span className="text-xs font-medium text-night-300">Voices</span>
                    </div>
                    {/* Voice count badge */}
                    {(voiceSummary.totalVoices || stats?.narratorCount) && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        stageStatuses[STAGES.VOICES] === STATUS.SUCCESS ? 'bg-green-500/20 text-green-400' :
                        stageStatuses[STAGES.VOICES] === STATUS.IN_PROGRESS ? 'bg-purple-500/20 text-purple-400' :
                        'bg-night-700 text-night-400'
                      }`}>
                        {voiceSummary.totalVoices || stats?.narratorCount || 0}/{voiceSummary.totalCharacters || characterVoices.length || 1}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-night-500">
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
                      : 'bg-night-800/50 border-night-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Volume2 className={`w-4 h-4 ${
                        stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS ? 'text-cyan-400 animate-pulse' :
                        stageStatuses[STAGES.SFX] === STATUS.SUCCESS ? 'text-green-400' : 'text-night-500'
                      }`} />
                      <span className="text-xs font-medium text-night-300">SFX</span>
                    </div>
                    {/* SFX count badge */}
                    {(sfxDetails.sfxCount > 0 || stats?.sfxCount > 0) && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        stageStatuses[STAGES.SFX] === STATUS.SUCCESS ? 'bg-green-500/20 text-green-400' :
                        stageStatuses[STAGES.SFX] === STATUS.IN_PROGRESS ? 'bg-cyan-500/20 text-cyan-400' :
                        'bg-night-700 text-night-400'
                      }`}>
                        {sfxDetails.cachedCount || 0}/{sfxDetails.sfxCount || stats?.sfxCount || 0}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-night-500">
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
                      : 'bg-night-800/50 border-night-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Image className={`w-4 h-4 ${
                        stageStatuses[STAGES.COVER] === STATUS.IN_PROGRESS ? 'text-amber-400 animate-pulse' :
                        stageStatuses[STAGES.COVER] === STATUS.SUCCESS ? 'text-green-400' : 'text-night-500'
                      }`} />
                      <span className="text-xs font-medium text-night-300">Cover</span>
                    </div>
                    {/* Cover progress badge */}
                    {stageStatuses[STAGES.COVER] === STATUS.IN_PROGRESS && coverProgress.progress > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400">
                        {coverProgress.progress}%
                      </span>
                    )}
                    {stageStatuses[STAGES.COVER] === STATUS.SUCCESS && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">
                        ✓
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-night-500">
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
                      : 'bg-night-800/50 border-night-700'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className={`w-4 h-4 ${
                        stageStatuses[STAGES.QA] === STATUS.IN_PROGRESS ? 'text-green-400 animate-pulse' :
                        stageStatuses[STAGES.QA] === STATUS.SUCCESS ? 'text-green-400' : 'text-night-500'
                      }`} />
                      <span className="text-xs font-medium text-night-300">QA</span>
                    </div>
                    {stageStatuses[STAGES.QA] === STATUS.SUCCESS && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">
                        ✓
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-night-500">
                    {stageStatuses[STAGES.QA] === STATUS.SUCCESS
                      ? 'All checks passed'
                      : stageStatuses[STAGES.QA] === STATUS.IN_PROGRESS
                        ? 'Validating content...'
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
                    <div className="w-full h-2 bg-night-700 rounded-full overflow-hidden">
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
            <div className="px-6 py-3 border-t border-night-700/50">
              <div className="flex items-center gap-3 text-xs">
                <Activity className="w-3 h-3 text-golden-400 animate-pulse" />
                <span className="text-night-500">Latest:</span>
                <span className="text-night-300 flex-1 truncate">
                  {detailedProgressLog && detailedProgressLog.length > 0
                    ? (detailedProgressLog[detailedProgressLog.length - 1]?.message || detailedProgressLog[detailedProgressLog.length - 1])
                    : 'Initializing story preparation...'}
                </span>
              </div>
            </div>

            {/* Cost & Usage Summary Bar */}
            <div className="px-6 py-3 bg-night-900/80 border-t border-night-700/50 flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3 text-green-400" />
                  <span className="text-night-400">Est. Cost:</span>
                  <span className="text-green-400 font-medium">{formatCost(usage.totalCost || 0)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-blue-400" />
                  <span className="text-night-400">Tokens:</span>
                  <span className="text-blue-400 font-medium">{formatTokens(usage.totalTokens || 0)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-night-500" />
                <span className="text-night-500">Processing...</span>
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

          {/* Settings Toggles */}
          <div className="mt-4 flex items-center justify-center gap-4 py-3 border-t border-night-700/50">
            <button
              onClick={() => onAutoplayChange?.(!autoplayEnabled)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                ${autoplayEnabled
                  ? 'bg-golden-500/20 border border-golden-500/50 text-golden-400'
                  : 'bg-night-800 border border-night-600 text-night-400 hover:border-night-500'}`}
              title={autoplayEnabled ? 'Disable auto-play' : 'Enable auto-play'}
            >
              <Play className={`w-4 h-4 ${autoplayEnabled ? 'text-golden-400' : 'text-night-500'}`} />
              <span className="text-sm font-medium">Auto-play</span>
              <div className={`w-2 h-2 rounded-full ${autoplayEnabled ? 'bg-golden-400' : 'bg-night-600'}`} />
            </button>

            <button
              onClick={onSfxToggle}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                ${sfxEnabled
                  ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                  : 'bg-night-800 border border-night-600 text-night-400 hover:border-night-500'}`}
              title={sfxEnabled ? 'Disable sound effects' : 'Enable sound effects'}
            >
              <Volume2 className={`w-4 h-4 ${sfxEnabled ? 'text-cyan-400' : 'text-night-500'}`} />
              <span className="text-sm font-medium">SFX</span>
              <div className={`w-2 h-2 rounded-full ${sfxEnabled ? 'bg-cyan-400' : 'bg-night-600'}`} />
            </button>
          </div>

          {/* Action Buttons */}
          {!hasError && (
            <div className="mt-4 space-y-3">
              {allStagesComplete && onStartCountdown && (
                <button
                  onClick={onStartCountdown}
                  className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-golden-400 to-amber-500
                             text-night-900 font-bold text-lg shadow-lg shadow-golden-400/20
                             hover:from-golden-300 hover:to-amber-400 transition-all
                             flex items-center justify-center gap-3 animate-pulse"
                >
                  <Play className="w-6 h-6" />
                  Start Chapter {chapterNumber}
                </button>
              )}
              <button
                onClick={onCancel}
                className={`w-full px-4 py-2 rounded-lg text-night-500 hover:text-night-300
                           hover:bg-night-800 transition-colors text-sm ${allStagesComplete ? 'mt-0' : ''}`}
              >
                Cancel
              </button>
            </div>
          )}

          {hasError && (
            <button
              onClick={onCancel}
              className="mt-4 w-full px-6 py-3 rounded-xl bg-night-800 text-night-300
                         hover:bg-night-700 transition-colors"
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
              <div className="bg-night-800/60 rounded-xl p-4">
                <h3 className="text-night-300 text-sm font-medium mb-3 flex items-center gap-2">
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
                  {onRegenerateVoices && !isCountdownActive && (
                    <button
                      onClick={onRegenerateVoices}
                      disabled={isRegeneratingVoices}
                      className={`
                        absolute top-2 right-2 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10
                        ${isRegeneratingVoices
                          ? 'bg-night-700/90 cursor-wait'
                          : 'bg-night-700/80 hover:bg-night-600'
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
                {onRegenerateSfx && !isCountdownActive && (
                  <button
                    onClick={onRegenerateSfx}
                    disabled={isRegeneratingSfx}
                    className={`
                      absolute top-2 right-2 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10
                      ${isRegeneratingSfx
                        ? 'bg-night-700/90 cursor-wait'
                        : 'bg-night-700/80 hover:bg-night-600'
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

          {/* Settings Toggles - Auto-play and SFX during preparation */}
          <div className="flex items-center justify-center gap-4 py-3 border-t border-night-700/50">
            {/* Auto-play Toggle */}
            <button
              onClick={() => onAutoplayChange?.(!autoplayEnabled)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                ${autoplayEnabled
                  ? 'bg-golden-500/20 border border-golden-500/50 text-golden-400'
                  : 'bg-night-800 border border-night-600 text-night-400 hover:border-night-500'
                }
              `}
              title={autoplayEnabled ? 'Disable auto-play (manual scene control)' : 'Enable auto-play (continuous narration)'}
            >
              <Play className={`w-4 h-4 ${autoplayEnabled ? 'text-golden-400' : 'text-night-500'}`} />
              <span className="text-sm font-medium">Auto-play</span>
              <div className={`w-2 h-2 rounded-full ${autoplayEnabled ? 'bg-golden-400' : 'bg-night-600'}`} />
            </button>

            {/* SFX Toggle */}
            <button
              onClick={onSfxToggle}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                ${sfxEnabled
                  ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                  : 'bg-night-800 border border-night-600 text-night-400 hover:border-night-500'
                }
              `}
              title={sfxEnabled ? 'Disable sound effects' : 'Enable sound effects'}
            >
              <Volume2 className={`w-4 h-4 ${sfxEnabled ? 'text-cyan-400' : 'text-night-500'}`} />
              <span className="text-sm font-medium">SFX</span>
              <div className={`w-2 h-2 rounded-full ${sfxEnabled ? 'bg-cyan-400' : 'bg-night-600'}`} />
            </button>
          </div>

          {/* Action buttons - Start Story when ready, Cancel otherwise */}
          {!hasError && (
            <div className="space-y-3">
              {/* Start Chapter Button - shows when all stages complete */}
              {allStagesComplete && onStartCountdown && (
                <button
                  onClick={onStartCountdown}
                  className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-golden-400 to-amber-500
                             text-night-900 font-bold text-lg shadow-lg shadow-golden-400/20
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
                className={`w-full px-4 py-2 rounded-lg text-night-500 hover:text-night-300
                           hover:bg-night-800 transition-colors text-sm
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
              className="w-full px-6 py-3 rounded-xl bg-night-800 text-night-300
                         hover:bg-night-700 transition-colors"
            >
              Go Back
            </button>
          )}
        </div>
      )}

      {/* Countdown Display */}
      {isCountdownActive && (
        <div className="text-center">
          <CountdownDisplay
            phase={countdownPhase}
            value={countdownValue}
            onSkip={countdownPhase === COUNTDOWN_PHASE.COUNTDOWN ? onCancelCountdown : null}
          />
        </div>
      )}

      {/* Ready to Play UI */}
      {isReadyToPlay && !isCountdownActive && (
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
      )}

      {/* Fullscreen Cover Art Modal */}
      {showCoverFullscreen && (coverUrl || coverProgress.coverUrl) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowCoverFullscreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Cover art fullscreen view"
        >
          {/* Close button */}
          <button
            onClick={() => setShowCoverFullscreen(false)}
            className="absolute top-4 right-4 p-3 rounded-full bg-night-800/80 hover:bg-night-700 transition-colors z-10"
            aria-label="Close fullscreen view"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {/* Cover image container */}
          <div
            className="relative max-w-[90vw] max-h-[90vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full-size cover image */}
            <img
              src={coverUrl || coverProgress.coverUrl}
              alt={title || 'Story Cover'}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              style={{
                boxShadow: '0 0 60px rgba(0,0,0,0.8), 0 0 100px rgba(0,0,0,0.5)'
              }}
            />

            {/* Title overlay at bottom */}
            {title && (
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg">
                <h2
                  className="text-white text-2xl md:text-3xl font-bold text-center"
                  style={{
                    textShadow: '0 2px 10px rgba(0,0,0,0.9)',
                    fontFamily: 'Georgia, "Palatino Linotype", serif',
                    letterSpacing: '0.03em'
                  }}
                >
                  {title}
                </h2>
              </div>
            )}

            {/* Regenerate button in fullscreen */}
            {onRegenerateCover && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isRegeneratingCover) return; // Don't close modal while regenerating
                  onRegenerateCover();
                  setShowCoverFullscreen(false);
                }}
                disabled={isRegeneratingCover}
                className={`
                  absolute top-4 left-4 flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                  ${isRegeneratingCover
                    ? 'bg-night-800/90 cursor-wait text-night-400'
                    : 'bg-night-800/80 hover:bg-night-700 text-white'
                  }
                `}
                title="Regenerate cover art"
              >
                {isRegeneratingCover ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="text-sm font-medium">Regenerate</span>
              </button>
            )}
          </div>

          {/* Click anywhere to close hint */}
          <p className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-night-500 text-sm">
            Click anywhere to close
          </p>
        </div>
      )}
    </div>
  );
});

export default LaunchScreen;
export { STAGES, STATUS, STAGE_CONFIG, COUNTDOWN_PHASE };
