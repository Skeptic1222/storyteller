/**
 * ViewSelector Component
 * Provides quick access to reading view presets (Default, Kindle, Night, Ticker).
 * Each preset configures multiple theme settings at once for optimal reading experience.
 */

import { useState } from 'react';
import { Eye, BookOpen, Moon, Zap, ChevronDown } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// View presets with all associated settings
export const VIEW_PRESETS = {
  default: {
    id: 'default',
    label: 'Default',
    icon: Eye,
    description: 'Standard dark theme',
    settings: {
      fontFamily: 'system-ui',
      fontSize: 18,
      lineHeight: 1.6,
      textLayout: 'vertical'
    },
    colors: {
      textColor: '#F7F4E9',
      backgroundColor: '#0A2342'
    }
  },
  kindle: {
    id: 'kindle',
    label: 'Kindle',
    icon: BookOpen,
    description: 'Warm sepia tones',
    settings: {
      fontFamily: 'serif',
      fontSize: 20,
      lineHeight: 1.8,
      textLayout: 'vertical'
    },
    colors: {
      textColor: '#1F1A14',
      backgroundColor: '#F7F4E9'
    }
  },
  night: {
    id: 'night',
    label: 'Night',
    icon: Moon,
    description: 'Low light reading',
    settings: {
      fontFamily: 'sans-serif',
      fontSize: 18,
      lineHeight: 1.7,
      textLayout: 'vertical'
    },
    colors: {
      textColor: '#D1D8E3',
      backgroundColor: '#081223'
    }
  },
  ticker: {
    id: 'ticker',
    label: 'Ticker',
    icon: Zap,
    description: 'Speed reading mode',
    settings: {
      fontFamily: 'sans-serif',
      fontSize: 32,
      lineHeight: 1.4,
      textLayout: 'ticker'
    },
    colors: {
      textColor: '#F7F4E9',
      backgroundColor: '#0B1A32'
    }
  }
};

function ViewSelector({
  currentPreset = 'default',
  onPresetChange,
  compact = false,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Try to get theme context, but handle cases where it's not available
  let setFontSize, setFontFamily, setLineHeight, setTextLayout, setTextColor, setBackgroundColor;
  try {
    const themeContext = useTheme();
    setFontSize = themeContext?.setFontSize;
    setFontFamily = themeContext?.setFontFamily;
    setLineHeight = themeContext?.setLineHeight;
    setTextLayout = themeContext?.setTextLayout;
    setTextColor = themeContext?.setTextColor;
    setBackgroundColor = themeContext?.setBackgroundColor;
  } catch (e) {
    // ThemeContext not available
  }

  const currentPresetConfig = VIEW_PRESETS[currentPreset] || VIEW_PRESETS.default;
  const CurrentIcon = currentPresetConfig.icon;

  const handlePresetSelect = (presetId) => {
    const preset = VIEW_PRESETS[presetId];
    if (!preset) return;

    // Apply theme settings if theme context is available
    if (setFontSize && preset.settings.fontSize) {
      setFontSize(preset.settings.fontSize);
    }
    if (setFontFamily && preset.settings.fontFamily) {
      setFontFamily(preset.settings.fontFamily);
    }
    if (setLineHeight && preset.settings.lineHeight) {
      setLineHeight(preset.settings.lineHeight);
    }
    if (setTextLayout && preset.settings.textLayout) {
      setTextLayout(preset.settings.textLayout);
    }

    // Apply color settings from preset (CRITICAL - was missing before!)
    if (setTextColor && preset.colors?.textColor) {
      setTextColor(preset.colors.textColor);
    }
    if (setBackgroundColor && preset.colors?.backgroundColor) {
      setBackgroundColor(preset.colors.backgroundColor);
    }

    // Notify parent component
    if (onPresetChange) {
      onPresetChange(presetId, preset);
    }

    setIsOpen(false);
  };

  if (compact) {
    // Compact mode - just icon buttons
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        {Object.values(VIEW_PRESETS).map((preset) => {
          const PresetIcon = preset.icon;
          const isActive = currentPreset === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => handlePresetSelect(preset.id)}
              className={`p-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-golden-400/20 text-golden-400 border border-golden-400/30'
                  : 'bg-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
              title={`${preset.label}: ${preset.description}`}
            >
              <PresetIcon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  // Dropdown mode
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 transition-colors"
      >
        <CurrentIcon className="w-4 h-4 text-golden-400" />
        <span>{currentPresetConfig.label}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown menu */}
          <div className="absolute top-full left-0 mt-1 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden">
            {Object.values(VIEW_PRESETS).map((preset) => {
              const PresetIcon = preset.icon;
              const isActive = currentPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? 'bg-golden-400/10 text-golden-400'
                      : 'text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <PresetIcon className={`w-4 h-4 ${isActive ? 'text-golden-400' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{preset.label}</div>
                    <div className="text-xs text-slate-500 truncate">{preset.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default ViewSelector;
