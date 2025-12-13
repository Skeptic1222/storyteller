/**
 * useOfflineMode Hook
 * Manages service worker registration and offline story caching
 */

import { useState, useEffect, useCallback } from 'react';

export function useOfflineMode() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [swRegistration, setSwRegistration] = useState(null);
  const [swReady, setSwReady] = useState(false);
  const [cachedStories, setCachedStories] = useState([]);
  const [cacheSize, setCacheSize] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/storyteller/sw.js')
        .then((registration) => {
          console.log('[OfflineMode] Service Worker registered');
          setSwRegistration(registration);
          setSwReady(true);
        })
        .catch((error) => {
          console.error('[OfflineMode] SW registration failed:', error);
        });

      // Listen for updates
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[OfflineMode] New Service Worker active');
      });
    }
  }, []);

  // Send message to service worker
  const sendSWMessage = useCallback((message) => {
    return new Promise((resolve) => {
      if (!swReady || !navigator.serviceWorker.controller) {
        resolve({ success: false, error: 'Service Worker not ready' });
        return;
      }

      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data);
      };

      navigator.serviceWorker.controller.postMessage(message, [messageChannel.port2]);
    });
  }, [swReady]);

  // Cache a story for offline access
  const cacheStory = useCallback(async (story) => {
    setIsDownloading(true);

    try {
      const result = await sendSWMessage({
        type: 'CACHE_STORY',
        payload: story
      });

      if (result.success) {
        setCachedStories((prev) => [...prev.filter(s => s.sessionId !== story.sessionId), story]);
      }

      return result;
    } finally {
      setIsDownloading(false);
    }
  }, [sendSWMessage]);

  // Remove a cached story
  const removeStory = useCallback(async (sessionId) => {
    const result = await sendSWMessage({
      type: 'REMOVE_STORY',
      payload: sessionId
    });

    if (result.success) {
      setCachedStories((prev) => prev.filter(s => s.sessionId !== sessionId));
    }

    return result;
  }, [sendSWMessage]);

  // Get all cached stories
  const refreshCachedStories = useCallback(async () => {
    const result = await sendSWMessage({
      type: 'GET_CACHED_STORIES',
      payload: null
    });

    if (result.success && result.stories) {
      setCachedStories(result.stories);
    }

    return result;
  }, [sendSWMessage]);

  // Cache audio files
  const cacheAudio = useCallback(async (urls) => {
    setIsDownloading(true);

    try {
      const result = await sendSWMessage({
        type: 'CACHE_AUDIO',
        payload: urls
      });

      return result;
    } finally {
      setIsDownloading(false);
    }
  }, [sendSWMessage]);

  // Clear all caches
  const clearAllCaches = useCallback(async () => {
    const result = await sendSWMessage({
      type: 'CLEAR_ALL_CACHES',
      payload: null
    });

    if (result.success) {
      setCachedStories([]);
      setCacheSize(null);
    }

    return result;
  }, [sendSWMessage]);

  // Get cache size
  const refreshCacheSize = useCallback(async () => {
    const result = await sendSWMessage({
      type: 'GET_CACHE_SIZE',
      payload: null
    });

    if (result.success) {
      setCacheSize({
        bytes: result.totalBytes,
        mb: result.totalMB
      });
    }

    return result;
  }, [sendSWMessage]);

  // Check if a story is cached
  const isStoryCached = useCallback((sessionId) => {
    return cachedStories.some(s => s.sessionId === sessionId);
  }, [cachedStories]);

  // Initial load of cached stories
  useEffect(() => {
    if (swReady) {
      refreshCachedStories();
      refreshCacheSize();
    }
  }, [swReady, refreshCachedStories, refreshCacheSize]);

  return {
    // Status
    isOnline,
    isOffline: !isOnline,
    swReady,
    isDownloading,

    // Cached data
    cachedStories,
    cacheSize,

    // Actions
    cacheStory,
    removeStory,
    cacheAudio,
    clearAllCaches,
    isStoryCached,

    // Refresh
    refreshCachedStories,
    refreshCacheSize
  };
}

export default useOfflineMode;
