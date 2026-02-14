/**
 * ControlBar Component
 * Footer control bar with play/pause, skip, voice input, and text toggle.
 * Includes audio progress bar with time display.
 * Extracted from Story.jsx for maintainability.
 */

import { Pause, Play, SkipForward, SkipBack, Home, Database, Zap, Loader2, Volume2, VolumeX, Columns, Rows, FileText, Minus, Plus } from 'lucide-react';
import { getUnitLabel } from '../../utils/storyTerminology';
import ViewSelector from './ViewSelector';

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
  onSeek, // NEW: Seek to specific time
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
  onTextLayoutChange,
  // View presets
  currentViewPreset = 'default',
  onPresetChange,
  // Font size controls
  fontSize = 18,
  onFontSizeChange
}) {
  // Get dynamic label for next button (e.g., "Ch 2" for novels, "Pt 2" for short stories)
  const nextLabel = nextChapterNumber
    ? getUnitLabel(storyFormat, storyType, nextChapterNumber, true)
    : 'Next';

  const seekFromClientX = (clientX, element) => {
    if (!onSeek || duration <= 0 || !element) return;
    const rect = element.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(percent * duration);
  };

  // Note: Secondary progress bar removed (Bug Fix 3)
  // All progress is now shown in LaunchScreen - nothing plays until everything is ready

  return (
    <footer className="bg-slate-900/80 backdrop-blur">
      {/* Audio Progress Bar - Status Bar (Seekable) */}
      {(isPlaying || isPaused || duration > 0) && (
        <div className="px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 pb-2">
          <div className="flex items-center gap-3 max-w-md mx-auto">
            <span className="text-slate-400 text-xs font-mono min-w-[40px] text-right">
              {formatTime(currentTime)}
            </span>
            {/* Seekable progress bar */}
            <div
              className="flex-1 h-3 bg-slate-700 rounded-full overflow-visible relative group cursor-pointer"
              style={{ touchAction: 'none' }}
              role="slider"
              aria-label="Audio progress"
              aria-valuemin={0}
              aria-valuemax={duration || 100}
              aria-valuenow={currentTime}
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
              tabIndex={onSeek ? 0 : -1}
              onClick={(e) => {
                seekFromClientX(e.clientX, e.currentTarget);
              }}
              onTouchStart={(e) => {
                if (!e.touches?.[0]) return;
                if (e.cancelable) e.preventDefault();
                seekFromClientX(e.touches[0].clientX, e.currentTarget);
              }}
              onTouchMove={(e) => {
                if (!e.touches?.[0]) return;
                if (e.cancelable) e.preventDefault();
                seekFromClientX(e.touches[0].clientX, e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (!onSeek || duration <= 0) return;
                const step = duration * 0.05; // 5% per key press
                if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  onSeek(Math.max(0, currentTime - step));
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  onSeek(Math.min(duration, currentTime + step));
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  onSeek(0);
                } else if (e.key === 'End') {
                  e.preventDefault();
                  onSeek(duration);
                }
              }}
            >
              {/* Progress fill */}
              <div
                className="h-full bg-gradient-to-r from-golden-400 to-golden-500 rounded-full transition-all duration-100"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
              {/* Seek thumb - visible on hover */}
              {onSeek && duration > 0 && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-golden-400 rounded-full shadow-lg opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none"
                  style={{ left: `calc(${(currentTime / duration) * 100}% - 8px)` }}
                />
              )}
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

      {/* Row 1: Primary Controls - Home, SFX, Play/Pause, Next */}
      <div className="px-4 sm:px-6 pt-2 pb-1 flex items-center justify-center gap-3 sm:gap-4">
        {/* Back/Restart Button */}
        {isCyoaEnabled && hasCheckpoints ? (
          <button
            onClick={onShowChoiceHistory}
            className="flex flex-col items-center gap-1 p-2.5 sm:p-3 rounded-xl bg-slate-800 border-2 border-slate-600 hover:border-amber-400"
            title="Go back to a previous choice"
          >
            <SkipBack className="w-5 h-5 text-amber-400" />
            <span className="text-[10px] text-slate-400">Choices</span>
          </button>
        ) : (
          <button
            onClick={onGoHome}
            className="flex flex-col items-center gap-1 p-2.5 sm:p-3 rounded-xl bg-slate-800 border-2 border-slate-600 hover:border-slate-400"
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
            className={`flex flex-col items-center gap-1 p-2.5 sm:p-3 rounded-xl border-2 ${
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

        {/* Play/Pause Main Control */}
        <button
          onClick={onTogglePause}
          className="flex flex-col items-center gap-1 p-4 sm:p-5 rounded-full bg-golden-400 hover:bg-golden-500 shadow-lg shadow-golden-400/30 focus:outline-none focus:ring-2 focus:ring-golden-300"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause audio playback' : 'Play audio'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? <Pause className="w-6 h-6 sm:w-7 sm:h-7 text-slate-900" aria-hidden="true" /> : <Play className="w-6 h-6 sm:w-7 sm:h-7 text-slate-900 ml-0.5" aria-hidden="true" />}
        </button>

        {/* Next Chapter/Part/Page Button - Shows dynamic terminology */}
        <button
          onClick={onContinue}
          disabled={isGenerating || hasChoices}
          className={`flex flex-col items-center gap-1 p-2.5 sm:p-3 rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-golden-500
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

      {/* Row 2: Appearance Controls - View Presets, Font Size, Text Layout */}
      <div className="px-4 sm:px-6 pb-4 pt-1 flex items-center justify-center gap-4 sm:gap-6 border-t border-slate-700/50 mt-1">
        {/* View Presets - Compact mode (4 icon buttons) */}
        {onPresetChange && (
          <div className="flex flex-col items-center gap-1">
            <ViewSelector
              currentPreset={currentViewPreset}
              onPresetChange={onPresetChange}
              compact={true}
            />
            <span className="text-[10px] text-slate-400">Style</span>
          </div>
        )}

        {/* Font Size Controls */}
        {onFontSizeChange && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-0.5 bg-slate-700/50 rounded-lg p-0.5">
              <button
                onClick={() => onFontSizeChange(Math.max(12, fontSize - 2))}
                disabled={fontSize <= 12}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Decrease font size"
                aria-label="Decrease font size"
              >
                <Minus className="w-4 h-4 text-slate-300" />
              </button>
              <span className="text-xs text-slate-300 w-8 text-center font-mono">{fontSize}</span>
              <button
                onClick={() => onFontSizeChange(Math.min(32, fontSize + 2))}
                disabled={fontSize >= 32}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Increase font size"
                aria-label="Increase font size"
              >
                <Plus className="w-4 h-4 text-slate-300" />
              </button>
            </div>
            <span className="text-[10px] text-slate-400">Size</span>
          </div>
        )}

        {/* Text Layout Selector */}
        {onTextLayoutChange && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-0.5" title="Text layout mode">
              <button
                type="button"
                onClick={() => onTextLayoutChange('vertical')}
                className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                  textLayout === 'vertical'
                    ? 'bg-blue-500/30 border border-blue-400'
                    : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
                }`}
                title="Vertical flow layout"
                aria-label="Vertical text layout"
                aria-pressed={textLayout === 'vertical'}
              >
                <Rows className="w-5 h-5 text-slate-300" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onTextLayoutChange('horizontal')}
                className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                  textLayout === 'horizontal'
                    ? 'bg-blue-500/30 border border-blue-400'
                    : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
                }`}
                title="Two column layout"
                aria-label="Horizontal text layout"
                aria-pressed={textLayout === 'horizontal'}
              >
                <Columns className="w-5 h-5 text-slate-300" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onTextLayoutChange('modal')}
                className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                  textLayout === 'modal'
                    ? 'bg-blue-500/30 border border-blue-400'
                    : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
                }`}
                title="Modal (one paragraph) layout"
                aria-label="Modal text layout"
                aria-pressed={textLayout === 'modal'}
              >
                <FileText className="w-5 h-5 text-slate-300" aria-hidden="true" />
              </button>
            </div>
            <span className="text-[10px] text-slate-400">Layout</span>
          </div>
        )}
      </div>
    </footer>
  );
}

export default ControlBar;
