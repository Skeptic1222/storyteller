/**
 * OfflineIndicator Component
 * Shows offline status and provides offline mode management
 */

import React, { useState, memo } from 'react';
import { WifiOff, Wifi, Download, Trash2, HardDrive, CloudOff, Check } from 'lucide-react';
import { useOfflineMode } from '../hooks/useOfflineMode';

// Offline banner that appears at top of screen
export const OfflineBanner = memo(function OfflineBanner() {
  const { isOffline } = useOfflineMode();

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm">
      <WifiOff size={16} />
      <span>You're offline. Some features may be limited.</span>
    </div>
  );
});

// Download story button for library items
export const DownloadStoryButton = memo(function DownloadStoryButton({
  story,
  size = 'md',
  showLabel = true
}) {
  const { cacheStory, removeStory, isStoryCached, isDownloading } = useOfflineMode();
  const [downloading, setDownloading] = useState(false);

  const isCached = isStoryCached(story.sessionId);

  const handleToggle = async () => {
    if (isCached) {
      await removeStory(story.sessionId);
    } else {
      setDownloading(true);
      await cacheStory(story);
      setDownloading(false);
    }
  };

  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 24 : 20;

  return (
    <button
      onClick={handleToggle}
      disabled={downloading || isDownloading}
      className={`
        flex items-center gap-2 rounded-lg transition-all
        ${size === 'sm' ? 'px-2 py-1 text-xs' : size === 'lg' ? 'px-4 py-2 text-base' : 'px-3 py-1.5 text-sm'}
        ${isCached
          ? 'bg-green-600/20 text-green-400 hover:bg-red-600/20 hover:text-red-400'
          : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
        }
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
      title={isCached ? 'Remove from offline storage' : 'Download for offline'}
    >
      {downloading ? (
        <div className="animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: iconSize, height: iconSize }} />
      ) : isCached ? (
        <Check size={iconSize} />
      ) : (
        <Download size={iconSize} />
      )}
      {showLabel && (
        <span>{isCached ? 'Saved offline' : 'Download'}</span>
      )}
    </button>
  );
});

// Offline storage manager panel
export const OfflineStorageManager = memo(function OfflineStorageManager({ onClose }) {
  const {
    isOnline,
    swReady,
    cachedStories,
    cacheSize,
    clearAllCaches,
    removeStory,
    refreshCacheSize,
    refreshCachedStories
  } = useOfflineMode();

  const [clearing, setClearing] = useState(false);

  const handleClearAll = async () => {
    if (confirm('Remove all offline data? This cannot be undone.')) {
      setClearing(true);
      await clearAllCaches();
      setClearing(false);
    }
  };

  const handleRemoveStory = async (sessionId) => {
    await removeStory(sessionId);
    await refreshCacheSize();
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <HardDrive size={24} />
          Offline Storage
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            &times;
          </button>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center gap-4 mb-6 p-3 rounded-lg bg-slate-700/50">
        <div className={`flex items-center gap-2 ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
          {isOnline ? <Wifi size={20} /> : <WifiOff size={20} />}
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div className="text-gray-400">|</div>
        <div className="text-gray-300">
          {swReady ? 'Service Worker active' : 'Loading...'}
        </div>
      </div>

      {/* Cache size */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-400">Storage used</span>
          <span className="text-white font-medium">
            {cacheSize ? `${cacheSize.mb} MB` : 'Calculating...'}
          </span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 transition-all"
            style={{
              width: cacheSize ? `${Math.min((cacheSize.bytes / (100 * 1024 * 1024)) * 100, 100)}%` : '0%'
            }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Recommended: Keep under 100 MB for optimal performance
        </p>
      </div>

      {/* Cached stories */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 mb-3">
          Downloaded Stories ({cachedStories.length})
        </h3>

        {cachedStories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <CloudOff size={32} className="mx-auto mb-2 opacity-50" />
            <p>No stories saved offline</p>
            <p className="text-xs mt-1">Download stories from your library to access them offline</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {cachedStories.map((story) => (
              <div
                key={story.sessionId}
                className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">
                    {story.title || 'Untitled Story'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {story.scenes?.length || 0} scenes
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveStory(story.sessionId)}
                  className="ml-2 p-2 text-gray-400 hover:text-red-400 transition-colors"
                  title="Remove from offline"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => {
            refreshCachedStories();
            refreshCacheSize();
          }}
          className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors text-sm"
        >
          Refresh
        </button>
        <button
          onClick={handleClearAll}
          disabled={clearing || cachedStories.length === 0}
          className="flex-1 px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {clearing ? 'Clearing...' : 'Clear All'}
        </button>
      </div>
    </div>
  );
});

// Compact offline indicator for header/footer
export const OfflineIndicatorCompact = memo(function OfflineIndicatorCompact() {
  const { isOnline, cachedStories } = useOfflineMode();

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className={`flex items-center gap-1 ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
        {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
      </div>
      {cachedStories.length > 0 && (
        <span className="text-gray-400">
          {cachedStories.length} saved
        </span>
      )}
    </div>
  );
});

export default {
  OfflineBanner,
  DownloadStoryButton,
  OfflineStorageManager,
  OfflineIndicatorCompact
};
