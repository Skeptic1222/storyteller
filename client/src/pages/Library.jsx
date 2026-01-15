/**
 * Library Page - E-Reader style story library
 * Browse, manage, and resume stories like a Kindle
 *
 * Uses ThemeContext for unified theme management across pages
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Library as LibraryIcon,
  ScrollText,
  CheckCircle,
  PauseCircle,
  PlayCircle,
  Circle,
  GitBranch,
  Star,
  Bookmark,
  Trash2,
  Download
} from 'lucide-react';
import { apiCall } from '../config';
import UserProfile from '../components/UserProfile';
import { useReadingTheme } from '../context/ThemeContext';

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

  // Get icon for story based on category
  const getStoryIcon = (story) => {
    const cat = getStoryCategory(story);
    if (story.cover_image_url) return null;
    return CATEGORIES[cat]?.icon || BookOpen;
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
      case 'finished': return CheckCircle;
      case 'paused': return PauseCircle;
      case 'narrating': return PlayCircle;
      case 'waiting_choice': return GitBranch;
      default: return Circle;
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

  // Navigate to appropriate page based on story type
  const handleStoryClick = (story) => {
    const storyCategory = getStoryCategory(story);
    if (storyCategory === 'dnd') {
      navigate(`/campaign/${story.id}`);
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

      {/* Filters and Search */}
      <div style={{
        display: 'flex',
        gap: '15px',
        marginBottom: '25px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {/* Status filter tabs */}
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px'
        }}>
          {filteredStories.map(story => {
            const storyCategory = getStoryCategory(story);
            const categoryColor = CATEGORIES[storyCategory]?.color || colors.accent;

            return (
            <div
              key={story.id}
              onClick={() => handleStoryClick(story)}
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
              {/* Category + Status badges */}
              <div style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                {/* Category badge */}
                <span style={{
                  background: `${categoryColor}22`,
                  color: categoryColor,
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontWeight: '600'
                }}>
                  {CATEGORIES[storyCategory]?.label}
                </span>
                {(() => {
                  const StatusIcon = getStatusIcon(story.current_status);
                  return (
                    <span style={{ color: getStatusColor(story.current_status), display: 'flex' }}>
                      <StatusIcon size={16} />
                    </span>
                  );
                })()}
              </div>

              {/* Cover placeholder */}
              <div style={{
                height: '120px',
                background: story.cover_image_url
                  ? `url(${story.cover_image_url}) center/cover`
                  : `linear-gradient(135deg, ${categoryColor}33, ${categoryColor}11)`,
                borderRadius: '8px',
                marginBottom: '15px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '40px'
              }}>
                {!story.cover_image_url && (() => {
                  const Icon = getStoryIcon(story);
                  return Icon ? <Icon size={32} color={categoryColor} /> : null;
                })()}
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
                {story.total_scenes || 0} scenes | {formatDate(story.last_activity_at || story.started_at)}
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
                      color: story.is_favorite ? '#FF6F61' : colors.textMuted,
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    aria-label={story.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star size={18} fill={story.is_favorite ? '#FF6F61' : 'none'} />
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
                      <Bookmark size={14} />
                      {story.bookmark_count}
                    </span>
                  )}

                  {/* Export button - only show if story has a recording */}
                  {(story.recording_id || story.current_recording_id) && (
                    <button
                      onClick={(e) => handleExport(story.id, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: colors.accent,
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Download story as MP3"
                      aria-label="Download story as MP3"
                    >
                      <Download size={16} />
                    </button>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={(e) => deleteStory(story.id, e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.textMuted,
                      cursor: 'pointer',
                      padding: '4px',
                      opacity: 0.7,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    aria-label="Delete story"
                  >
                    <Trash2 size={16} />
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
                        background: `${categoryColor}22`,
                        color: categoryColor,
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
          );
          })}
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
