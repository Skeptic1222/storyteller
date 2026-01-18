/**
 * useStoryConfig Hook
 * Manages story configuration updates and related state
 */

import { useState, useCallback, useMemo } from 'react';
import { apiCall } from '../config';
import { AUTHOR_NAMES } from '../constants/authorStyles';

/**
 * @param {string} sessionId - Current session ID
 * @param {Object} session - Current session data
 * @param {Function} setSession - Session state setter
 */
export function useStoryConfig(sessionId, session, setSession) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Memoized config
  const config = useMemo(() => session?.config_json || {}, [session?.config_json]);

  // Author style display name
  const authorStyleName = useMemo(() => {
    if (!config.author_style || config.author_style === 'none') return null;
    return AUTHOR_NAMES[config.author_style] || config.author_style;
  }, [config.author_style]);

  // Update config via API
  const updateConfig = useCallback(async (updates) => {
    try {
      const response = await apiCall(`/stories/${sessionId}/update-config`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      if (data.success) {
        setSession(prev => ({ ...prev, config_json: data.config }));
      }
    } catch (error) {
      console.error('Failed to update config:', error);
    }
  }, [sessionId, setSession]);

  // Voice selection handler
  const handleVoiceSelect = useCallback((voice) => {
    updateConfig({ voice_id: voice.voice_id, voice_name: voice.name });
  }, [updateConfig]);

  // Narrator style change handler
  const handleNarratorStyleChange = useCallback((style) => {
    updateConfig({ narrator_style: style });
  }, [updateConfig]);

  // Save story progress
  const saveStory = useCallback(async (currentScene, readingTime = 0) => {
    setIsSaving(true);
    const sceneIndex = Number.isFinite(currentScene?.scene_index)
      ? currentScene.scene_index
      : Number.isFinite(currentScene?.sequence_index)
        ? currentScene.sequence_index
        : Number.isFinite(currentScene?.index)
          ? currentScene.index
          : 0;
    const sceneId = currentScene?.scene_id || currentScene?.id || null;
    try {
      await apiCall(`/library/${sessionId}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          scene_id: sceneId,
          scene_index: sceneIndex,
          reading_time: readingTime || 0
        })
      });
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId]);

  return {
    // State
    config,
    authorStyleName,
    isSaving,
    lastSaved,
    setLastSaved,

    // Handlers
    updateConfig,
    handleVoiceSelect,
    handleNarratorStyleChange,
    saveStory
  };
}

export default useStoryConfig;
