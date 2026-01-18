/**
 * Cover Art Hook
 * Handles cover image generation and display
 */

import { useState, useCallback } from 'react';
import { apiCall } from '../config';

export function useCoverArt(sessionId) {
  const [coverUrl, setCoverUrl] = useState(null);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [showCoverFullscreen, setShowCoverFullscreen] = useState(false);

  // Generate cover image
  const generateCover = useCallback(async () => {
    if (!sessionId) return null;

    setIsGeneratingCover(true);
    try {
      const response = await apiCall(`/stories/${sessionId}/generate-cover`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.cover_url) {
        setCoverUrl(data.cover_url);
        return data.cover_url;
      }
      return null;
    } catch (error) {
      console.error('Failed to generate cover:', error);
      return null;
    } finally {
      setIsGeneratingCover(false);
    }
  }, [sessionId]);

  // Open fullscreen cover view
  const openFullscreen = useCallback(() => {
    if (coverUrl) {
      setShowCoverFullscreen(true);
    }
  }, [coverUrl]);

  // Close fullscreen cover view
  const closeFullscreen = useCallback(() => {
    setShowCoverFullscreen(false);
  }, []);

  return {
    coverUrl,
    setCoverUrl,
    isGeneratingCover,
    showCoverFullscreen,
    generateCover,
    openFullscreen,
    closeFullscreen
  };
}

export default useCoverArt;
