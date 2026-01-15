/**
 * SettingsPanel Component
 * Story settings panel with voice selector, volume control, narrator tone, and cover generation.
 * Extracted from Story.jsx for maintainability.
 */

import { Settings, X, Volume2, VolumeX, Image, Maximize2, Type, Columns, Rows, FileText } from 'lucide-react';
import VoiceSelector from '../VoiceSelector';
import { useTheme } from '../../context/ThemeContext';

const NARRATOR_STYLES = [
  { id: 'warm', label: 'Warm & Gentle', icon: '🌙' },
  { id: 'dramatic', label: 'Dramatic', icon: '🎭' },
  { id: 'playful', label: 'Playful', icon: '✨' },
  { id: 'mysterious', label: 'Mysterious', icon: '🌑' }
];

const TEXT_LAYOUTS = [
  { id: 'vertical', label: 'Vertical Flow', icon: Rows },
  { id: 'horizontal', label: 'Two Columns', icon: Columns },
  { id: 'modal', label: 'Modal (One Paragraph)', icon: FileText }
];

function SettingsPanel({
  isOpen,
  onClose,
  config,
  onVoiceSelect,
  volume,
  onVolumeChange,
  autoplayEnabled = false,
  onAutoplayChange,
  fontSize = 18,
  onFontSizeChange,
  showText = true,
  onShowTextToggle,
  karaokeEnabled = true,
  onKaraokeToggle,
  onNarratorStyleChange,
  onGenerateCover,
  isGeneratingCover,
  coverUrl,
  onViewCoverFullscreen
}) {
  let textLayout = 'vertical';
  let setTextLayout = null;

  try {
    const themeContext = useTheme();
    if (themeContext) {
      textLayout = themeContext.textLayout;
      setTextLayout = themeContext.setTextLayout;
    } else {
      console.warn('[SettingsPanel] ThemeContext not available - text layout toggle disabled');
    }
  } catch (error) {
    console.error('[SettingsPanel] Error accessing ThemeContext:', error);
  }

  if (!isOpen) return null;

  return (
    <div className="bg-slate-800/95 border-b border-golden-400/30 p-4 max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-golden-400 font-medium flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Story Settings
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        {/* Voice Selection */}
        <div>
          <h4 className="text-slate-200 text-sm font-medium mb-2 flex items-center gap-2">
            <Volume2 className="w-4 h-4" />
            Narrator Voice
          </h4>
          <VoiceSelector
            selectedVoice={{ voice_id: config.voice_id, name: config.voice_name }}
            onSelect={onVoiceSelect}
            narratorStyle={config.narrator_style || 'warm'}
          />
        </div>

        {/* Volume Control */}
        <div>
          <h4 className="text-slate-200 text-sm font-medium mb-2 flex items-center justify-between">
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
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-golden-400"
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>Quiet</span>
            <span>Loud</span>
          </div>
        </div>

        {/* Playback Settings */}
        {onAutoplayChange && (
          <div>
            <h4 className="text-slate-200 text-sm font-medium mb-2">Playback</h4>
            <label className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-300">
              <span>Auto-play narration</span>
              <input
                type="checkbox"
                checked={autoplayEnabled}
                onChange={() => onAutoplayChange(!autoplayEnabled)}
                className="accent-golden-400"
              />
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Starts narration automatically when a scene is ready.
            </p>
          </div>
        )}

        {/* Text Size Control */}
        {onFontSizeChange && (
          <div>
            <h4 className="text-slate-200 text-sm font-medium mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Type className="w-4 h-4" />
                Text Size
              </span>
              <span className="text-golden-400 text-xs">{fontSize}px</span>
            </h4>
            <input
              type="range"
              min="12"
              max="28"
              step="1"
              value={fontSize}
              onChange={(e) => onFontSizeChange(parseInt(e.target.value, 10))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-golden-400"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>Small</span>
              <span>Large</span>
            </div>
          </div>
        )}

        {/* Reading View */}
        {(onShowTextToggle || onKaraokeToggle) && (
          <div>
            <h4 className="text-slate-200 text-sm font-medium mb-2 flex items-center gap-2">
              <Type className="w-4 h-4" />
              Reading View
            </h4>
            {onShowTextToggle && (
              <label className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-300">
                <span>Show story text</span>
                <input
                  type="checkbox"
                  checked={showText}
                  onChange={onShowTextToggle}
                  className="accent-golden-400"
                />
              </label>
            )}
            {onKaraokeToggle && (
              <label className={`mt-2 flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-300 ${showText ? '' : 'opacity-50'}`}>
                <span>Read-along highlight</span>
                <input
                  type="checkbox"
                  checked={karaokeEnabled}
                  onChange={onKaraokeToggle}
                  disabled={!showText}
                  className="accent-golden-400"
                />
              </label>
            )}
          </div>
        )}

        {/* Text Layout */}
        {setTextLayout && (
          <div>
            <h4 className="text-slate-200 text-sm font-medium mb-2 flex items-center gap-2">
              <Columns className="w-4 h-4" />
              Text Layout
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {TEXT_LAYOUTS.map(layout => {
                const IconComponent = layout.icon;
                return (
                  <button
                    key={layout.id}
                    onClick={() => setTextLayout(layout.id)}
                    className={`p-2 rounded-lg border text-left text-sm flex items-center gap-2 ${
                      textLayout === layout.id
                        ? 'border-golden-400 bg-slate-700 text-white'
                        : 'border-slate-600 hover:border-slate-500 text-slate-300'
                    }`}
                  >
                    <IconComponent className="w-4 h-4" />
                    {layout.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Choose how story text is displayed during playback.
            </p>
          </div>
        )}

        {/* Narrator Style */}
        <div>
          <h4 className="text-slate-200 text-sm font-medium mb-2">Narrator Tone</h4>
          <div className="grid grid-cols-2 gap-2">
            {NARRATOR_STYLES.map(style => (
              <button
                key={style.id}
                onClick={() => onNarratorStyleChange(style.id)}
                className={`p-2 rounded-lg border text-left text-sm ${
                  config.narrator_style === style.id
                    ? 'border-golden-400 bg-slate-700'
                    : 'border-slate-600 hover:border-slate-500'
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
          <h4 className="text-slate-200 text-sm font-medium mb-2 flex items-center gap-2">
            <Image className="w-4 h-4" />
            Story Cover
          </h4>
          <button
            onClick={onGenerateCover}
            disabled={isGeneratingCover}
            className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-white rounded-lg flex items-center justify-center gap-2"
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
              onClick={onViewCoverFullscreen}
              className="w-full mt-2 py-2 px-4 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 rounded-lg flex items-center justify-center gap-2"
            >
              <Maximize2 className="w-4 h-4" />
              View Fullscreen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
