import { useState, useEffect, useRef } from 'react';
import { Volume2, Play, Pause, Loader, Search, ChevronDown, Music, Waves, Sparkles } from 'lucide-react';
import { apiCall } from '../config';

// Category icons and colors
const CATEGORY_STYLES = {
  weather: { icon: '🌧️', color: 'bg-blue-500/20 text-blue-400', label: 'Weather' },
  environment: { icon: '🌳', color: 'bg-green-500/20 text-green-400', label: 'Environment' },
  action: { icon: '⚔️', color: 'bg-red-500/20 text-red-400', label: 'Action' },
  combat: { icon: '💥', color: 'bg-orange-500/20 text-orange-400', label: 'Combat' },
  magic: { icon: '✨', color: 'bg-purple-500/20 text-purple-400', label: 'Magic' },
  creature: { icon: '🐉', color: 'bg-amber-500/20 text-amber-400', label: 'Creature' },
  emotional: { icon: '💫', color: 'bg-pink-500/20 text-pink-400', label: 'Emotional' },
  cached: { icon: '💾', color: 'bg-slate-500/20 text-slate-400', label: 'Generated' }
};

function SFXLibraryBrowser({ onSelect, showPreview = true }) {
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState({ libraryFlat: [], cachedSfx: [], categories: [] });
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedCategories, setExpandedCategories] = useState(new Set(['weather', 'environment']));
  const [playingId, setPlayingId] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    fetchLibrary();
    return () => stopPlayback();
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [search, selectedCategory]);

  const fetchLibrary = async () => {
    try {
      const params = new URLSearchParams({
        include_cached: 'true',
        limit: '100'
      });
      if (search) params.append('search', search);
      if (selectedCategory !== 'all') params.append('category', selectedCategory);

      const response = await apiCall(`/sfx/library?${params.toString()}`);
      const data = await response.json();

      setLibrary(data);
    } catch (error) {
      console.error('Failed to fetch SFX library:', error);
    } finally {
      setLoading(false);
    }
  };

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const previewSfx = async (sfx) => {
    stopPlayback();

    const sfxId = sfx.sfx_key;
    setPreviewLoading(sfxId);

    try {
      // For cached SFX with file_path, use the file directly
      if (sfx.file_path) {
        const audio = new Audio(`/storyteller${sfx.file_path}`);
        audioRef.current = audio;

        audio.onended = () => setPlayingId(null);
        audio.onerror = () => {
          console.error('Failed to play SFX');
          setPlayingId(null);
        };

        await audio.play();
        setPlayingId(sfxId);
        setPreviewLoading(null);
        return;
      }

      // For library SFX, generate preview
      const response = await apiCall('/sfx/preview', {
        method: 'POST',
        body: JSON.stringify({
          sfx_key: sfx.source === 'library' ? sfx.sfx_key : undefined,
          prompt: sfx.source === 'cache' ? sfx.prompt : undefined
        })
      });

      if (!response.ok) throw new Error('Failed to generate preview');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        console.error('Failed to play SFX preview');
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };

      await audio.play();
      setPlayingId(sfxId);
    } catch (error) {
      console.error('Failed to preview SFX:', error);
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleSelect = (sfx) => {
    if (onSelect) {
      onSelect(sfx);
    }
  };

  const toggleCategory = (category) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // Group flat library by category
  const groupedLibrary = {};
  for (const sfx of library.libraryFlat || []) {
    if (!groupedLibrary[sfx.category]) {
      groupedLibrary[sfx.category] = [];
    }
    groupedLibrary[sfx.category].push(sfx);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader className="w-6 h-6 text-night-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="w-5 h-5 text-golden-400" />
          <span className="text-night-200 font-medium">SFX Library</span>
        </div>
        <div className="text-night-500 text-xs">
          {library.stats?.libraryCount || 0} effects • {library.stats?.totalCached || 0} cached
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-night-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sound effects..."
          className="w-full pl-10 pr-4 py-2 bg-night-800 border border-night-700 rounded-lg text-night-200 placeholder-night-500 focus:border-golden-400 focus:outline-none"
        />
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            selectedCategory === 'all'
              ? 'bg-golden-400 text-night-900'
              : 'bg-night-700 text-night-300 hover:bg-night-600'
          }`}
        >
          All
        </button>
        {(library.categories || []).map(cat => {
          const style = CATEGORY_STYLES[cat] || { icon: '🔊', color: 'bg-night-700 text-night-300' };
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                selectedCategory === cat
                  ? 'bg-golden-400 text-night-900'
                  : `${style.color} hover:opacity-80`
              }`}
            >
              <span>{style.icon}</span>
              {style.label || cat}
            </button>
          );
        })}
      </div>

      {/* SFX list grouped by category */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {Object.entries(groupedLibrary).map(([category, sfxList]) => {
          const style = CATEGORY_STYLES[category] || { icon: '🔊', color: 'bg-night-700', label: category };
          const isExpanded = expandedCategories.has(category);

          return (
            <div key={category} className="rounded-lg border border-night-700 overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category)}
                className={`w-full flex items-center justify-between p-3 ${style.color} hover:opacity-90 transition-all`}
              >
                <div className="flex items-center gap-2">
                  <span>{style.icon}</span>
                  <span className="font-medium">{style.label}</span>
                  <span className="text-xs opacity-60">({sfxList.length})</span>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {/* SFX items */}
              {isExpanded && (
                <div className="bg-night-900/50 divide-y divide-night-800">
                  {sfxList.map((sfx) => (
                    <div
                      key={sfx.sfx_key}
                      className="flex items-center gap-3 p-3 hover:bg-night-800/50 transition-all"
                    >
                      {/* Preview button */}
                      {showPreview && (
                        <button
                          onClick={() => previewSfx(sfx)}
                          disabled={previewLoading === sfx.sfx_key}
                          className="w-8 h-8 flex-shrink-0 rounded-full bg-night-700 flex items-center justify-center hover:bg-night-600 transition-all disabled:opacity-50"
                        >
                          {previewLoading === sfx.sfx_key ? (
                            <Loader className="w-4 h-4 text-golden-400 animate-spin" />
                          ) : playingId === sfx.sfx_key ? (
                            <Pause className="w-4 h-4 text-golden-400" />
                          ) : (
                            <Play className="w-4 h-4 text-night-300 ml-0.5" />
                          )}
                        </button>
                      )}

                      {/* SFX info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-night-200 text-sm font-medium capitalize truncate">
                          {sfx.name}
                        </div>
                        <div className="text-night-500 text-xs truncate">
                          {sfx.duration ? `${sfx.duration}s` : ''} {sfx.loop ? '• Loop' : '• One-shot'}
                        </div>
                      </div>

                      {/* Select button */}
                      {onSelect && (
                        <button
                          onClick={() => handleSelect(sfx)}
                          className="px-3 py-1.5 bg-golden-400/20 text-golden-400 rounded-lg text-xs font-medium hover:bg-golden-400/30 transition-all"
                        >
                          Select
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Cached/Generated SFX section */}
        {(library.cachedSfx?.length > 0) && (
          <div className="rounded-lg border border-night-700 overflow-hidden">
            <button
              onClick={() => toggleCategory('cached')}
              className={`w-full flex items-center justify-between p-3 ${CATEGORY_STYLES.cached.color} hover:opacity-90 transition-all`}
            >
              <div className="flex items-center gap-2">
                <span>{CATEGORY_STYLES.cached.icon}</span>
                <span className="font-medium">Generated SFX</span>
                <span className="text-xs opacity-60">({library.cachedSfx.length})</span>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${expandedCategories.has('cached') ? 'rotate-180' : ''}`} />
            </button>

            {expandedCategories.has('cached') && (
              <div className="bg-night-900/50 divide-y divide-night-800">
                {library.cachedSfx.map((sfx) => (
                  <div
                    key={sfx.sfx_key}
                    className="flex items-center gap-3 p-3 hover:bg-night-800/50 transition-all"
                  >
                    {showPreview && (
                      <button
                        onClick={() => previewSfx(sfx)}
                        disabled={previewLoading === sfx.sfx_key}
                        className="w-8 h-8 flex-shrink-0 rounded-full bg-night-700 flex items-center justify-center hover:bg-night-600 transition-all disabled:opacity-50"
                      >
                        {previewLoading === sfx.sfx_key ? (
                          <Loader className="w-4 h-4 text-golden-400 animate-spin" />
                        ) : playingId === sfx.sfx_key ? (
                          <Pause className="w-4 h-4 text-golden-400" />
                        ) : (
                          <Play className="w-4 h-4 text-night-300 ml-0.5" />
                        )}
                      </button>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="text-night-200 text-sm font-medium truncate">
                        {sfx.name}
                      </div>
                      <div className="text-night-500 text-xs truncate">
                        {sfx.access_count} plays • {sfx.duration ? `${sfx.duration}s` : 'Variable'}
                      </div>
                    </div>

                    {onSelect && (
                      <button
                        onClick={() => handleSelect(sfx)}
                        className="px-3 py-1.5 bg-golden-400/20 text-golden-400 rounded-lg text-xs font-medium hover:bg-golden-400/30 transition-all"
                      >
                        Select
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {Object.keys(groupedLibrary).length === 0 && library.cachedSfx?.length === 0 && (
          <div className="text-center py-8 text-night-500">
            <Waves className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No sound effects found</p>
            {search && <p className="text-xs mt-1">Try a different search term</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default SFXLibraryBrowser;
