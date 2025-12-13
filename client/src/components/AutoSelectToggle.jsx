/**
 * AutoSelectToggle Component
 * A small toggle that enables AI-driven auto-selection for a configuration section.
 * When enabled, the section will be auto-configured based on the Story Premise.
 */

import { Sparkles, Lock, Unlock } from 'lucide-react';

function AutoSelectToggle({
  enabled,
  onChange,
  label = 'Auto',
  locked = false,  // Show as locked (manual override)
  animating = false,  // Show animation when being auto-configured
  size = 'sm'  // 'sm' or 'md'
}) {
  const isSmall = size === 'sm';

  return (
    <button
      onClick={() => !locked && onChange(!enabled)}
      disabled={locked}
      title={enabled ? `AI will auto-configure ${label}` : `Click to enable AI auto-selection for ${label}`}
      className={`
        flex items-center gap-1 px-2 py-1 rounded-full transition-all
        ${enabled
          ? animating
            ? 'bg-golden-400/30 border border-golden-400 text-golden-300 animate-pulse'
            : 'bg-golden-400/20 border border-golden-400/50 text-golden-400 hover:bg-golden-400/30'
          : 'bg-night-700/50 border border-night-600 text-night-500 hover:border-night-500 hover:text-night-400'
        }
        ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${isSmall ? 'text-xs' : 'text-sm'}
      `}
    >
      {enabled ? (
        <>
          <Sparkles className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'}`} />
          <span className="hidden sm:inline">Auto</span>
        </>
      ) : locked ? (
        <>
          <Lock className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'}`} />
          <span className="hidden sm:inline">Locked</span>
        </>
      ) : (
        <>
          <Unlock className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'}`} />
          <span className="hidden sm:inline">Manual</span>
        </>
      )}
    </button>
  );
}

/**
 * MasterAutoToggle Component
 * Controls all auto-select toggles at once
 */
export function MasterAutoToggle({
  allEnabled,
  someEnabled,
  onChange,
  animating = false
}) {
  return (
    <button
      onClick={() => onChange(!allEnabled)}
      title={allEnabled ? 'Disable all auto-selection' : 'Enable auto-selection for all sections'}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-sm font-medium
        ${allEnabled
          ? animating
            ? 'bg-golden-400 text-night-900 animate-pulse'
            : 'bg-golden-400/80 hover:bg-golden-400 text-night-900'
          : someEnabled
            ? 'bg-golden-400/30 text-golden-400 border border-golden-400/50 hover:bg-golden-400/40'
            : 'bg-night-700 text-night-400 hover:bg-night-600 hover:text-night-300'
        }
      `}
    >
      <Sparkles className={`w-4 h-4 ${animating ? 'animate-spin' : ''}`} />
      <span>{allEnabled ? 'AI Mode' : someEnabled ? 'Partial AI' : 'Manual Mode'}</span>
    </button>
  );
}

export default AutoSelectToggle;
