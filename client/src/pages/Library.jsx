/**
 * Library Page - E-Reader style story library
 * Browse, manage, and resume stories like a Kindle
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import UserProfile from '../components/UserProfile';

// Theme definitions
const THEMES = {
  dark: {
    bg: '#0a0a0f',
    card: '#1a1a2e',
    text: '#e0e0e0',
    textMuted: '#888',
    accent: '#6366f1',
    border: '#2a2a3e'
  },
  sepia: {
    bg: '#f4ecd8',
    card: '#ebe3d0',
    text: '#5c4b37',
    textMuted: '#8b7355',
    accent: '#8b5e3c',
    border: '#d4c9b0'
  },
  light: {
    bg: '#ffffff',
    card: '#f5f5f5',
    text: '#1a1a1a',
    textMuted: '#666',
    accent: '#4f46e5',
    border: '#e0e0e0'
  }
};

export default function Library() {
  const navigate = useNavigate();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [theme, setTheme] = useState('dark');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');

  const colors = THEMES[theme];

  useEffect(() => {
    fetchLibrary();
  }, [filter]);

  const fetchLibrary = async () => {
    try {
      const res = await fetch(`${API_BASE}/library?filter=${filter}`);
      const data = await res.json();
      setStories(data.stories || []);
    } catch (error) {
      console.error('Failed to fetch library:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (storyId, e) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/library/${storyId}/favorite`, { method: 'POST' });
      fetchLibrary();
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const deleteStory = async (storyId, e) => {
    e.stopPropagation();
    if (confirm('Delete this story from your library?')) {
      try {
        await fetch(`${API_BASE}/library/${storyId}`, { method: 'DELETE' });
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

  const formatDate = (dateStr) => {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'finished': return '✓';
      case 'paused': return '⏸';
      case 'narrating': return '▶';
      case 'waiting_choice': return '?';
      default: return '○';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'finished': return '#22c55e';
      case 'paused': return '#eab308';
      case 'narrating': return '#3b82f6';
      case 'waiting_choice': return '#a855f7';
      default: return colors.textMuted;
    }
  };

  // Filter and sort stories
  const filteredStories = stories
    .filter(story => {
      if (!searchQuery) return true;
      return story.title?.toLowerCase().includes(searchQuery.toLowerCase());
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
              fontSize: '24px',
              cursor: 'pointer',
              padding: '5px'
            }}
          >
            ←
          </button>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 'normal' }}>
            My Library
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Theme toggle */}
          <select
            value={theme}
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
            <option value="dark">Dark</option>
            <option value="sepia">Sepia</option>
            <option value="light">Light</option>
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

      {/* Filters and Search */}
      <div style={{
        display: 'flex',
        gap: '15px',
        marginBottom: '25px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {/* Filter tabs */}
        <div style={{
          display: 'flex',
          gap: '5px',
          background: colors.card,
          borderRadius: '10px',
          padding: '4px'
        }}>
          {['all', 'in_progress', 'completed', 'favorites'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? colors.accent : 'transparent',
                color: filter === f ? 'white' : colors.textMuted,
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search stories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: colors.card,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '10px 15px',
            fontSize: '14px',
            flex: 1,
            minWidth: '200px'
          }}
        />

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            background: colors.card,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '10px 15px',
            fontSize: '14px'
          }}
        >
          <option value="recent">Recently Read</option>
          <option value="title">Title</option>
          <option value="progress">Progress</option>
        </select>
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
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>📚</div>
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px'
        }}>
          {filteredStories.map(story => (
            <div
              key={story.id}
              onClick={() => navigate(`/reader/${story.id}`)}
              style={{
                background: colors.card,
                borderRadius: '12px',
                padding: '20px',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                border: `1px solid ${colors.border}`,
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Status badge */}
              <div style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                display: 'flex',
                gap: '8px'
              }}>
                <span style={{
                  color: getStatusColor(story.current_status),
                  fontSize: '14px'
                }}>
                  {getStatusIcon(story.current_status)}
                </span>
              </div>

              {/* Cover placeholder */}
              <div style={{
                height: '120px',
                background: story.cover_image_url
                  ? `url(${story.cover_image_url}) center/cover`
                  : `linear-gradient(135deg, ${colors.accent}33, ${colors.accent}11)`,
                borderRadius: '8px',
                marginBottom: '15px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '40px'
              }}>
                {!story.cover_image_url && (story.cyoa_enabled ? '🎭' : '📖')}
              </div>

              {/* Title */}
              <h3 style={{
                margin: '0 0 8px 0',
                fontSize: '18px',
                fontWeight: '600',
                color: colors.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {story.title || 'Untitled Story'}
              </h3>

              {/* Meta info */}
              <div style={{
                fontSize: '13px',
                color: colors.textMuted,
                marginBottom: '12px'
              }}>
                {story.total_scenes || 0} scenes • {formatDate(story.last_activity_at || story.started_at)}
              </div>

              {/* Preview text */}
              <p style={{
                fontSize: '14px',
                color: colors.textMuted,
                margin: '0 0 15px 0',
                lineHeight: '1.5',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}>
                {story.first_scene_preview?.substring(0, 100) || 'No preview available'}...
              </p>

              {/* Progress bar */}
              <div style={{
                background: colors.border,
                borderRadius: '4px',
                height: '4px',
                marginBottom: '12px',
                overflow: 'hidden'
              }}>
                <div style={{
                  background: colors.accent,
                  height: '100%',
                  width: `${story.progress_percent || 0}%`,
                  borderRadius: '4px',
                  transition: 'width 0.3s'
                }} />
              </div>

              {/* Footer */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '12px', color: colors.textMuted }}>
                  {story.progress_percent || 0}% complete
                </span>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {/* Favorite button */}
                  <button
                    onClick={(e) => toggleFavorite(story.id, e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: story.is_favorite ? '#f59e0b' : colors.textMuted,
                      fontSize: '18px',
                      cursor: 'pointer',
                      padding: '4px'
                    }}
                  >
                    {story.is_favorite ? '★' : '☆'}
                  </button>

                  {/* Bookmark count */}
                  {story.bookmark_count > 0 && (
                    <span style={{
                      fontSize: '12px',
                      color: colors.textMuted,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      🔖 {story.bookmark_count}
                    </span>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={(e) => deleteStory(story.id, e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.textMuted,
                      fontSize: '14px',
                      cursor: 'pointer',
                      padding: '4px',
                      opacity: 0.6
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Tags */}
              {story.themes && story.themes.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: '6px',
                  marginTop: '12px',
                  flexWrap: 'wrap'
                }}>
                  {story.themes.slice(0, 3).map((theme, i) => (
                    <span
                      key={i}
                      style={{
                        background: `${colors.accent}22`,
                        color: colors.accent,
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '12px'
                      }}
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
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
