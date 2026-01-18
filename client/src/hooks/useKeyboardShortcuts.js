/**
 * useKeyboardShortcuts Hook
 * Global keyboard shortcuts for story playback controls.
 *
 * Shortcuts:
 * - Space: Play/Pause
 * - ArrowRight: Skip to next scene (when not generating and no choices)
 * - M: Toggle mute
 * - T: Toggle text display
 * - Escape: Go home
 */

import { useEffect, useCallback } from 'react';

/**
 * @param {object} options
 * @param {Function} options.onTogglePause - Play/pause toggle handler
 * @param {Function} options.onContinue - Continue to next scene handler
 * @param {Function} options.onToggleMute - Toggle mute handler
 * @param {Function} options.onToggleText - Toggle text display handler
 * @param {Function} options.onGoHome - Navigate home handler
 * @param {boolean} options.canContinue - Whether continue action is allowed
 * @param {boolean} options.enabled - Whether shortcuts are enabled (default: true)
 */
export function useKeyboardShortcuts({
  onTogglePause,
  onContinue,
  onToggleMute,
  onToggleText,
  onGoHome,
  canContinue = true,
  enabled = true
}) {
  const handleKeyDown = useCallback((event) => {
    // Don't intercept if typing in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

    switch (event.key) {
      case ' ': // Spacebar - Play/Pause
        event.preventDefault();
        onTogglePause?.();
        break;

      case 'ArrowRight': // Right arrow - Skip forward
        if (canContinue) {
          event.preventDefault();
          onContinue?.();
        }
        break;

      case 'm': // M - Toggle mute
      case 'M':
        event.preventDefault();
        onToggleMute?.();
        break;

      case 't': // T - Toggle text display
      case 'T':
        event.preventDefault();
        onToggleText?.();
        break;

      case 'Escape': // Escape - Go home
        event.preventDefault();
        onGoHome?.();
        break;

      default:
        break;
    }
  }, [onTogglePause, onContinue, onToggleMute, onToggleText, onGoHome, canContinue]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}

export default useKeyboardShortcuts;
