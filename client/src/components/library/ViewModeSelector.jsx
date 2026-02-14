/**
 * ViewModeSelector - Toggle between Grid/List/Gallery view modes
 *
 * Provides visual toggle buttons for different library display layouts
 */

import { Grid, List, LayoutGrid } from 'lucide-react';

export const VIEW_MODES = {
  grid: {
    id: 'grid',
    label: 'Grid',
    icon: Grid,
    description: 'Card grid with synopsis'
  },
  list: {
    id: 'list',
    label: 'List',
    icon: List,
    description: 'Compact list view'
  },
  gallery: {
    id: 'gallery',
    label: 'Gallery',
    icon: LayoutGrid,
    description: 'Cover-focused gallery'
  }
};

export default function ViewModeSelector({
  currentMode,
  onModeChange,
  colors,
  className = ''
}) {
  return (
    <div
      className={`view-mode-selector ${className}`}
      style={{
        display: 'flex',
        gap: '4px',
        background: colors.card,
        borderRadius: '8px',
        padding: '4px',
        border: `1px solid ${colors.border}`
      }}
    >
      {Object.values(VIEW_MODES).map((mode) => {
        const Icon = mode.icon;
        const isActive = currentMode === mode.id;

        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            title={mode.description}
            aria-label={`Switch to ${mode.label} view`}
            aria-pressed={isActive}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '32px',
              background: isActive ? colors.accent : 'transparent',
              color: isActive ? 'white' : colors.textMuted,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  );
}

// Export view mode constants
export { VIEW_MODES as viewModes };
