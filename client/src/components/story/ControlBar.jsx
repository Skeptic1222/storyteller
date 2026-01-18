/**
 * ControlBar Component
 * Footer control bar with play/pause, skip, voice input, and text toggle.
 * Includes audio progress bar with time display.
 * Extracted from Story.jsx for maintainability.
 */

import { Pause, Play, SkipForward, SkipBack, Home, Database, Zap, Loader2, Volume2, VolumeX, Columns, Rows, FileText } from 'lucide-react';
import { getUnitLabel } from '../../utils/storyTerminology';

/**
 * Format time in mm:ss format
 * Handles edge cases: null, undefined, NaN, Infinity
 */
function formatTime(seconds) {
  // Guard against invalid values
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${mins}:${secs}`;
}

function ControlBar({
  // Audio state
  isPlaying,
  isPaused,
  currentTime,
  duration,
  wordTimings,
  currentWordIndex,
  // Controls
  onTogglePause,
  onContinue,
  onGoHome,
  onShowChoiceHistory,
  // State
  isGenerating,
  hasChoices,
  // CYOA
  isCyoaEnabled,
  hasCheckpoints,
  // Recording indicator
  isPlayingRecording = false,
  // Chapter navigation
  nextChapterNumber = null,
  // Story format for dynamic terminology
  storyFormat = 'short_story',
  storyType = 'linear',
  // Note: audioStatus prop removed (Bug Fix 3) - secondary progress bar eliminated
  // Playback controls (SFX, text layout)
  sfxEnabled = true,
  onSfxToggle,
  textLayout = 'vertical',
  onTextLayoutChange
}) {
  // Get dynamic label for next button (e.g., "Ch 2" for novels, "Pt 2" for short stories)
  const nextLabel = nextChapterNumber
    ? getUnitLabel(storyFormat, storyType, nextChapterNumber, true)
    : 'Next';

  // Note: Secondary progress bar removed (Bug Fix 3)
  // All progress is now shown in LaunchScreen - nothing plays until everything is ready

  return (
    <footer className="bg-slate-900/80 backdrop-blur">
      {/* Audio Progress Bar - Status Bar */}
      {(isPlaying || isPaused || duration > 0) && (
        <div className="px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 pb-2">
          <div className="flex items-center gap-3 max-w-md mx-auto">
            <span className="text-slate-400 text-xs font-mono min-w-[40px] text-right">
              {formatTime(currentTime)}
            </span>
            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden relative group cursor-pointer">
              <div
                className="h-full bg-gradient-to-r from-golden-400 to-golden-500 rounded-full transition-all duration-100"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-slate-400 text-xs font-mono min-w-[40px]">
              {formatTime(duration)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className={`text-xs ${isPlaying ? 'text-green-400' : 'text-slate-500'}`}>
              {isPlaying ? 'Playing' : isPaused ? 'Paused' : 'Ready'}
            </span>
            {/* Recording vs Live indicator */}
            {isPlayingRecording ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs" title="Playing from saved recording (free)">
                <Database className="w-3 h-3" />
                Recorded
              </span>
            ) : isPlaying ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs" title="Live generation (uses tokens)">
                <Zap className="w-3 h-3" />
                Live
              </span>
            ) : null}
            {wordTimings?.words && (
              <span className="text-slate-600 text-xs">
                {currentWordIndex >= 0 ? currentWordIndex + 1 : 0}/{wordTimings.words.length} words
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-6 pt-2 flex items-center justify-center gap-4">
        {/* Back/Restart Button */}
        {isCyoaEnabled && hasCheckpoints ? (
          <button
            onClick={onShowChoiceHistory}
            className="flex flex-col items-center gap-1 p-3 rounded-xl bg-slate-800 border-2 border-slate-600 hover:border-amber-400"
            title="Go back to a previous choice"
          >
            <SkipBack className="w-5 h-5 text-amber-400" />
            <span className="text-[10px] text-slate-400">Choices</span>
          </button>
        ) : (
          <button
            onClick={onGoHome}
            className="flex flex-col items-center gap-1 p-3 rounded-xl bg-slate-800 border-2 border-slate-600 hover:border-slate-400"
            title="Go back to home"
          >
            <Home className="w-5 h-5 text-slate-300" />
            <span className="text-[10px] text-slate-400">Home</span>
          </button>
        )}

        {/* SFX Toggle */}
        {onSfxToggle && (
          <button
            onClick={onSfxToggle}
            className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 ${
              sfxEnabled
                ? 'bg-slate-800 border-slate-600 hover:border-cyan-400'
                : 'bg-slate-700 border-slate-500 hover:border-slate-400'
            }`}
            title={sfxEnabled ? 'Sound effects enabled' : 'Sound effects disabled'}
            aria-label={sfxEnabled ? 'Disable sound effects' : 'Enable sound effects'}
          >
            {sfxEnabled ? (
              <Volume2 className="w-5 h-5 text-cyan-400" aria-hidden="true" />
            ) : (
              <VolumeX className="w-5 h-5 text-slate-500" aria-hidden="true" />
            )}
            <span className="text-[10px] text-slate-400">SFX</span>
          </button>
        )}

        {/* Text Layout Selector */}
        {onTextLayoutChange && (
          <div className="flex flex-col items-center gap-1 px-2">
            <div className="flex items-center gap-1" title="Text layout mode">
              <button
                type="button"
                onClick={() => {
                  console.log('[ControlBar] Layout button clicked: vertical, current:', textLayout);
                  onTextLayoutChange('vertical');
                }}
                className={`p-2 rounded-lg transition-colors ${
                  textLayout === 'vertical'
                    ? 'bg-blue-500/30 border border-blue-400'
                    : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
                }`}
                title="Vertical flow layout"
                aria-label="Vertical text layout"
                aria-pressed={textLayout === 'vertical'}
              >
                <Rows className="w-4 h-4 text-slate-300" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log('[ControlBar] Layout button clicked: horizontal, current:', textLayout);
                  onTextLayoutChange('horizontal');
                }}
                className={`p-2 rounded-lg transition-colors ${
                  textLayout === 'horizontal'
                    ? 'bg-blue-500/30 border border-blue-400'
                    : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
                }`}
                title="Two column layout"
                aria-label="Horizontal text layout"
                aria-pressed={textLayout === 'horizontal'}
              >
                <Columns className="w-4 h-4 text-slate-300" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log('[ControlBar] Layout button clicked: modal, current:', textLayout);
                  onTextLayoutChange('modal');
                }}
                className={`p-2 rounded-lg transition-colors ${
                  textLayout === 'modal'
                    ? 'bg-blue-500/30 border border-blue-400'
                    : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
                }`}
                title="Modal (one paragraph) layout"
                aria-label="Modal text layout"
                aria-pressed={textLayout === 'modal'}
              >
                <FileText className="w-4 h-4 text-slate-300" aria-hidden="true" />
              </button>
            </div>
            <span className="text-[10px] text-slate-400">
              {textLayout === 'vertical' ? 'Vertical' : textLayout === 'horizontal' ? 'Two-Col' : 'Modal'}
            </span>
          </div>
        )}

        {/* Play/Pause Main Control */}
        <button
          onClick={onTogglePause}
          className="flex flex-col items-center gap-1 p-5 rounded-full bg-golden-400 hover:bg-golden-500 shadow-lg shadow-golden-400/30 focus:outline-none focus:ring-2 focus:ring-golden-300"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause audio playback' : 'Play audio'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? <Pause className="w-7 h-7 text-slate-900" aria-hidden="true" /> : <Play className="w-7 h-7 text-slate-900 ml-0.5" aria-hidden="true" />}
        </button>

        {/* Next Chapter/Part/Page Button - Shows dynamic terminology */}
        <button
          onClick={onContinue}
          disabled={isGenerating || hasChoices}
          className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-golden-500
            ${isGenerating
              ? 'bg-golden-400/20 border-golden-400/50 cursor-wait'
              : 'bg-slate-800 border-slate-600 hover:border-golden-400 hover:bg-slate-700'}
            ${(isGenerating || hasChoices) ? 'opacity-70' : ''}`}
          title={isGenerating ? 'Generating...' : nextChapterNumber ? `Continue to ${nextLabel}` : "Continue story"}
          aria-label={isGenerating ? 'Generating next part' : nextChapterNumber ? `Continue to ${nextLabel}` : "Continue story"}
        >
          {isGenerating ? (
            <Loader2 className="w-5 h-5 text-golden-400 animate-spin" aria-hidden="true" />
          ) : (
            <SkipForward className="w-5 h-5 text-slate-300" aria-hidden="true" />
          )}
          <span className={`text-[10px] ${isGenerating ? 'text-golden-400' : 'text-slate-400'}`}>
            {isGenerating ? 'Loading...' : nextLabel}
          </span>
        </button>

      </div>
    </footer>
  );
}

export default ControlBar;
