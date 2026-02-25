/**
 * Library Page - E-Reader style story library
 * Browse, manage, and resume stories like a Kindle
 *
 * Uses ThemeContext for unified theme management across pages
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Library as LibraryIcon,
  ScrollText
} from 'lucide-react';
import { apiCall } from '../config';
import UserProfile from '../components/UserProfile';
import { useReadingTheme } from '../context/ThemeContext';
import { LibraryCard, ViewModeSelector } from '../components/library';
import { scopedGetItem, scopedSetItem } from '../utils/userScopedStorage';

const VIEW_MODE_KEY = 'narrimo_library_view_mode';

// Content categories
const CATEGORIES = {
  all: { label: 'All', icon: LibraryIcon, color: '#6A8A82' },
  story: { label: 'Stories', icon: BookOpen, color: '#FF6F61' },
  story_bible: { label: 'Story Bible', icon: ScrollText, color: '#C0C0C0' }
};

export default function Library() {
  const navigate = useNavigate();
  const { theme: colors, setTheme, themes } = useReadingTheme();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all'); // New: content category
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [displayCount, setDisplayCount] = useState(12); // Pagination: show 12 initially
  const ITEMS_PER_PAGE = 12;

  // View mode state with user-scoped localStorage persistence
  const [viewMode, setViewMode] = useState(() => {
    return scopedGetItem(VIEW_MODE_KEY) || 'grid';
  });

  // Persist view mode to user-scoped localStorage
  useEffect(() => {
    scopedSetItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    fetchLibrary();
  }, [filter, category]);

  const fetchLibrary = async () => {
    try {
      const res = await apiCall(`/library?filter=${filter}&category=${category}`);
      if (!res.ok) {
        if (res.status === 401) {
          navigate('/welcome');
          return;
        }
        throw new Error('Failed to load library');
      }
      const data = await res.json();
      setStories(data.stories || []);
    } catch (error) {
      console.error('Failed to fetch library:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get category for a story based on its mode/type
  const getStoryCategory = (story) => {
    if (story.mode === 'dnd' || story.mode === 'campaign') return 'dnd';
    if (story.mode === 'story_bible' || story.story_bible_id) return 'story_bible';
    return 'story';
  };

  const toggleFavorite = async (storyId, e) => {
    e.stopPropagation();
    try {
      await apiCall(`/library/${storyId}/favorite`, { method: 'POST' });
      fetchLibrary();
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleExport = (storyId, e) => {
    e.stopPropagation();
    // Validate that story has recording before navigating
    const story = stories.find(s => s.id === storyId);
    if (!story || (!story.recording_id && !story.current_recording_id)) {
      alert('This story does not have a recording available for export.');
      return;
    }
    navigate(`/reader/${storyId}`, { state: { openExport: true } });
  };

  const deleteStory = async (storyId, e) => {
    e.stopPropagation();
    if (confirm('Delete this story from your library?')) {
      try {
        await apiCall(`/library/${storyId}`, { method: 'DELETE' });
        fetchLibrary();
      } catch (error) {
        console.error('Failed to delete story:', error);
      }
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };


  // Filter and sort stories - memoized for performance
  const filteredStories = useMemo(() => {
    return stories
      .filter(story => {
        // Category filter
        if (category !== 'all') {
          const storyCategory = getStoryCategory(story);
          if (storyCategory !== category) return false;
        }
        // Search filter
        if (searchQuery) {
          return story.title?.toLowerCase().includes(searchQuery.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'recent') {
          return new Date(b.last_activity_at || b.started_at) - new Date(a.last_activity_at || a.started_at);
        }
        if (sortBy === 'title') {
          return (a.title || '').localeCompare(b.title || '');
        }
        if (sortBy === 'progress') {
          return (b.progress_percent || 0) - (a.progress_percent || 0);
        }
        return 0;
      });
  }, [stories, category, searchQuery, sortBy]);

  // Paginated stories - only show displayCount items
  const displayedStories = useMemo(() => {
    return filteredStories.slice(0, displayCount);
  }, [filteredStories, displayCount]);

  const hasMoreStories = displayCount < filteredStories.length;

  const handleLoadMore = useCallback(() => {
    setDisplayCount(prev => prev + ITEMS_PER_PAGE);
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [category, searchQuery, sortBy, filter]);

  // Get container styles based on view mode
  const getViewModeStyles = (mode) => {
    switch (mode) {
      case 'list':
        return {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        };
      case 'gallery':
        return {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '16px'
        };
      case 'grid':
      default:
        return {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '20px'
        };
    }
  };

  // Navigate to appropriate page based on story type
  const handleStoryClick = (story) => {
    const storyCategory = getStoryCategory(story);
    if (storyCategory === 'dnd') {
      navigate(`/reader/${story.id}`);
    } else {
      navigate(`/reader/${story.id}`);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: colors.bg,
      color: colors.text,
      padding: '20px',
      fontFamily: 'Georgia, serif'
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '30px',
        flexWrap: 'wrap',
        gap: '15px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer',
              padding: '5px',
              display: 'flex',
              alignItems: 'center'
            }}
            aria-label="Back to home"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 'normal' }}>
            My Library
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* View Mode Selector */}
          <ViewModeSelector
            currentMode={viewMode}
            onModeChange={setViewMode}
            colors={colors}
          />

          {/* Theme toggle - uses ThemeContext for persistence across pages */}
          <select
            value={colors.id}
            onChange={(e) => setTheme(e.target.value)}
            style={{
              background: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '14px'
            }}
          >
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <button
            onClick={() => navigate('/')}
            style={{
              background: colors.accent,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            + New Story
          </button>

          {/* User Profile */}
          <UserProfile />
        </div>
      </header>

      {/* Category Tabs - Story, Story Bible */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '20px',
        flexWrap: 'wrap'
      }}>
        {Object.entries(CATEGORIES).map(([key, cat]) => {
          const Icon = cat.icon;
          return (
            <button
              key={key}
              onClick={() => setCategory(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: category === key ? `${cat.color}22` : colors.card,
                color: category === key ? cat.color : colors.textMuted,
                border: `2px solid ${category === key ? cat.color : 'transparent'}`,
                borderRadius: '12px',
                padding: '10px 18px',
                fontSize: '14px',
                fontWeight: category === key ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <Icon size={18} />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Filters and Search - Mobile-first stacked layout */}
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        {/* Status filter tabs - full width on mobile, auto on desktop */}
        <div
          className="flex gap-1 p-1 rounded-xl w-full sm:w-auto overflow-x-auto"
          style={{ background: colors.card }}
        >
          {['all', 'in_progress', 'completed', 'favorites'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="flex-1 sm:flex-none px-3 py-2 sm:px-4 rounded-lg text-sm font-medium capitalize whitespace-nowrap min-h-[44px] transition-colors"
              style={{
                background: filter === f ? colors.accent : 'transparent',
                color: filter === f ? 'white' : colors.textMuted
              }}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Search and Sort row - stack on mobile */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-1 sm:items-center">
          {/* Search */}
          <input
            type="text"
            placeholder="Search stories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:flex-1 sm:min-w-[200px] px-4 py-3 rounded-lg text-sm"
            style={{
              background: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`
            }}
          />

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full sm:w-auto px-4 py-3 rounded-lg text-sm min-h-[44px]"
            style={{
              background: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`
            }}
          >
            <option value="recent">Recently Read</option>
            <option value="title">Title</option>
            <option value="progress">Progress</option>
          </select>
        </div>
      </div>

      {/* Story Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: colors.textMuted }}>
          Loading your library...
        </div>
      ) : filteredStories.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px',
          color: colors.textMuted
        }}>
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
            <LibraryIcon size={48} color={colors.textMuted} />
          </div>
          <p>No stories yet</p>
          <button
            onClick={() => navigate('/')}
            style={{
              background: colors.accent,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '16px',
              cursor: 'pointer',
              marginTop: '15px'
            }}
          >
            Create Your First Story
          </button>
        </div>
      ) : (
        <div
          className={`library-view library-view--${viewMode}`}
          style={getViewModeStyles(viewMode)}
        >
          {displayedStories.map(story => (
            <LibraryCard
              key={story.id}
              story={story}
              viewMode={viewMode}
              colors={colors}
              onStoryClick={handleStoryClick}
              onFavorite={toggleFavorite}
              onExport={handleExport}
              onDelete={deleteStory}
            />
          ))}
        </div>
      )}

      {/* Load More button for pagination */}
      {hasMoreStories && !loading && (
        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <button
            onClick={handleLoadMore}
            style={{
              background: `${colors.accent}22`,
              color: colors.accent,
              border: `1px solid ${colors.accent}44`,
              borderRadius: '8px',
              padding: '12px 32px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${colors.accent}33`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `${colors.accent}22`;
            }}
          >
            Load More ({filteredStories.length - displayCount} remaining)
          </button>
        </div>
      )}

      {/* Stats footer */}
      {stories.length > 0 && (
        <div style={{
          marginTop: '40px',
          padding: '20px',
          background: colors.card,
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-around',
          textAlign: 'center',
          flexWrap: 'wrap',
          gap: '20px'
        }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: colors.accent }}>
              {stories.length}
            </div>
            <div style={{ fontSize: '13px', color: colors.textMuted }}>Total Stories</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: colors.accent }}>
              {stories.filter(s => s.current_status === 'finished').length}
            </div>
            <div style={{ fontSize: '13px', color: colors.textMuted }}>Completed</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: colors.accent }}>
              {formatDuration(stories.reduce((sum, s) => sum + (s.total_reading_time_seconds || 0), 0))}
            </div>
            <div style={{ fontSize: '13px', color: colors.textMuted }}>Total Time</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: colors.accent }}>
              {stories.reduce((sum, s) => sum + (s.total_scenes || 0), 0)}
            </div>
            <div style={{ fontSize: '13px', color: colors.textMuted }}>Scenes Read</div>
          </div>
        </div>
      )}
    </div>
  );
}
