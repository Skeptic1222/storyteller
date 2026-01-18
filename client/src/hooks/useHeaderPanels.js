/**
 * useHeaderPanels Hook
 * Manages the show/hide state of header panels in Story.jsx
 * Ensures only one panel is open at a time
 */

import { useState, useCallback } from 'react';

export function useHeaderPanels() {
  const [showStoryInfo, setShowStoryInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChoiceHistory, setShowChoiceHistory] = useState(false);

  // Toggle story info panel (closes others)
  const toggleStoryInfo = useCallback(() => {
    setShowStoryInfo(prev => !prev);
    setShowSettings(false);
    setShowChoiceHistory(false);
  }, []);

  // Toggle settings panel (closes others)
  const toggleSettings = useCallback(() => {
    setShowSettings(prev => !prev);
    setShowStoryInfo(false);
    setShowChoiceHistory(false);
  }, []);

  // Toggle choice history panel (closes others)
  const toggleChoiceHistory = useCallback(() => {
    setShowChoiceHistory(prev => !prev);
    setShowStoryInfo(false);
    setShowSettings(false);
  }, []);

  // Close all panels
  const closeAllPanels = useCallback(() => {
    setShowStoryInfo(false);
    setShowSettings(false);
    setShowChoiceHistory(false);
  }, []);

  return {
    // State
    showStoryInfo,
    showSettings,
    showChoiceHistory,

    // Direct setters (for external control)
    setShowStoryInfo,
    setShowSettings,
    setShowChoiceHistory,

    // Toggle handlers (auto-close others)
    toggleStoryInfo,
    toggleSettings,
    toggleChoiceHistory,
    closeAllPanels
  };
}

export default useHeaderPanels;
