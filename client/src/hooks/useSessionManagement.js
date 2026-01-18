/**
 * Session Management Hook
 * Handles session loading, saving, and configuration updates
 */

import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../config';
import { stripAllTags } from '../utils/textUtils';

export function useSessionManagement(sessionId, { onNeedOutline, continueStoryWithVoice, generateCover }) {
  const [session, setSession] = useState(null);
  const [storyOutline, setStoryOutline] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [allScenes, setAllScenes] = useState([]);
  const [currentScene, setCurrentScene] = useState(null);
  const [choiceHistory, setChoiceHistory] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch session data
  const fetchSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(`/stories/${sessionId}`);
      const data = await response.json();
      setSession(data.session);

      if (data.outline) setStoryOutline(data.outline);
      if (data.characters?.length > 0) setCharacters(data.characters);

      if (data.scenes?.length > 0) {
        setAllScenes(data.scenes);

        const lastScene = data.scenes[data.scenes.length - 1];
        setCurrentScene({
          text: stripAllTags(lastScene.polished_text || lastScene.summary),
          mood: lastScene.mood,
          scene_id: lastScene.id,
          scene_index: lastScene.sequence_index
        });
      }

      // Restore choice history for CYOA path visualization
      if (data.choiceHistory?.length > 0) {
        setChoiceHistory(data.choiceHistory);
      }

      // Auto-generate cover if story has outline/synopsis but no cover
      if (!data.session?.cover_image_url && (data.outline?.synopsis || data.session?.title)) {
        generateCover?.();
      }

      // Start story if no scenes yet
      if (!data.scenes || data.scenes.length === 0) {
        if (data.session?.has_outline || data.outline) {
          const voiceId = data.session?.config_json?.voice_id || data.session?.config_json?.narratorVoice;
          continueStoryWithVoice?.(voiceId);
        } else {
          onNeedOutline?.();
        }
      }

      return data;
    } catch (error) {
      console.error('Failed to fetch session:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, onNeedOutline, continueStoryWithVoice, generateCover]);

  // Update configuration
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
      return data;
    } catch (error) {
      console.error('Failed to update config:', error);
      throw error;
    }
  }, [sessionId]);

  // Save progress
  const saveProgress = useCallback(async () => {
    setIsSaving(true);
    try {
      await apiCall(`/library/${sessionId}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          scene_id: currentScene?.scene_id || null,
          scene_index: session?.total_scenes || 0,
          reading_time: 0
        })
      });
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, currentScene?.scene_id, session?.total_scenes]);

  // Auto-save progress periodically
  useEffect(() => {
    if (!session?.id || !currentScene) return;

    const autoSave = async () => {
      try {
        await apiCall(`/library/${session.id}/progress`, {
          method: 'POST',
          body: JSON.stringify({
            scene_id: currentScene.scene_id || null,
            scene_index: session.total_scenes || 0,
            reading_time: 30
          })
        });
        setLastSaved(new Date());
      } catch (err) {
        console.warn('[Save] Failed to save progress:', err);
      }
    };

    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [session?.id, currentScene]);

  // End story
  const endStory = useCallback(async () => {
    try {
      await apiCall(`/stories/${sessionId}/end`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'user_ended' })
      });
      return true;
    } catch (error) {
      console.error('Failed to end story:', error);
      return false;
    }
  }, [sessionId]);

  // Generate outline and start
  const generateOutlineAndStart = useCallback(async (continueStory) => {
    try {
      await apiCall(`/stories/${sessionId}/generate-outline`, { method: 'POST' });
      continueStory?.();
      return true;
    } catch (error) {
      console.error('Failed to generate outline:', error);
      return false;
    }
  }, [sessionId]);

  // Get config (memoized via session)
  const config = session?.config_json || {};

  return {
    // State
    session,
    setSession,
    storyOutline,
    setStoryOutline,
    characters,
    setCharacters,
    allScenes,
    setAllScenes,
    currentScene,
    setCurrentScene,
    choiceHistory,
    setChoiceHistory,
    config,
    isLoading,
    isSaving,
    lastSaved,

    // Actions
    fetchSession,
    updateConfig,
    saveProgress,
    endStory,
    generateOutlineAndStart
  };
}

export default useSessionManagement;
