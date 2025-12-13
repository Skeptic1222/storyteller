/**
 * Reader Page - E-Reader style story viewer
 * Read/listen to stories with bookmarks, progress tracking, and audio sync
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { stripCharacterTags } from '../utils/textUtils';

// Theme definitions
const THEMES = {
  dark: {
    bg: '#0a0a0f',
    text: '#d4d4d4',
    textMuted: '#666',
    accent: '#6366f1',
    highlight: '#6366f133'
  },
  sepia: {
    bg: '#f4ecd8',
    text: '#5c4b37',
    textMuted: '#8b7355',
    accent: '#8b5e3c',
    highlight: '#8b5e3c33'
  },
  light: {
    bg: '#ffffff',
    text: '#1a1a1a',
    textMuted: '#666',
    accent: '#4f46e5',
    highlight: '#4f46e533'
  },
  midnight: {
    bg: '#0f172a',
    text: '#cbd5e1',
    textMuted: '#64748b',
    accent: '#818cf8',
    highlight: '#818cf833'
  }
};

const FONT_FAMILIES = {
  georgia: 'Georgia, serif',
  palatino: 'Palatino Linotype, Book Antiqua, serif',
  times: 'Times New Roman, serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  verdana: 'Verdana, sans-serif',
  opendyslexic: 'OpenDyslexic, sans-serif'
};

export default function Reader() {
  const { storyId } = useParams();
  const navigate = useNavigate();

  // Story data
  const [story, setStory] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);

  // Reader state
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showToc, setShowToc] = useState(false);

  // Settings
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState(20);
  const [fontFamily, setFontFamily] = useState('georgia');
  const [lineHeight, setLineHeight] = useState(1.8);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [syncHighlight, setSyncHighlight] = useState(true);

  // Refs
  const audioRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const readingStartRef = useRef(null);

  const colors = THEMES[theme];
  const currentScene = scenes[currentSceneIndex];

  // Fetch story data
  useEffect(() => {
    fetchStory();
    readingStartRef.current = Date.now();

    return () => {
      // Save progress on unmount
      saveProgress();
    };
  }, [storyId]);

  const fetchStory = async () => {
    try {
      const res = await fetch(`${API_BASE}/library/${storyId}`);
      const data = await res.json();

      setStory(data.story);
      setScenes(data.scenes || []);
      setCharacters(data.characters || []);
      setBookmarks(data.bookmarks || []);

      // Resume from last position
      if (data.story?.current_scene_index) {
        setCurrentSceneIndex(Math.min(data.story.current_scene_index, (data.scenes?.length || 1) - 1));
      }
    } catch (error) {
      console.error('Failed to fetch story:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveProgress = async () => {
    if (!currentScene) return;

    const readingTime = Math.floor((Date.now() - (readingStartRef.current || Date.now())) / 1000);

    try {
      await fetch(`${API_BASE}/library/${storyId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_id: currentScene.id,
          scene_index: currentSceneIndex,
          audio_position: audioRef.current?.currentTime || 0,
          reading_time: readingTime,
          mode: isPlaying ? 'audio' : 'text'
        })
      });
    } catch (error) {
      console.error('Failed to save progress:', error);
    }

    readingStartRef.current = Date.now();
  };

  // Navigation
  const goToScene = useCallback((index) => {
    saveProgress();
    setCurrentSceneIndex(Math.max(0, Math.min(index, scenes.length - 1)));
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [scenes.length]);

  const nextScene = useCallback(() => {
    if (currentSceneIndex < scenes.length - 1) {
      goToScene(currentSceneIndex + 1);
    }
  }, [currentSceneIndex, scenes.length, goToScene]);

  const prevScene = useCallback(() => {
    if (currentSceneIndex > 0) {
      goToScene(currentSceneIndex - 1);
    }
  }, [currentSceneIndex, goToScene]);

  // Audio controls
  const togglePlayPause = useCallback(() => {
    if (!audioRef.current || !currentScene?.audio_url) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, currentScene]);

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
    if (autoPlayNext && currentSceneIndex < scenes.length - 1) {
      nextScene();
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play();
          setIsPlaying(true);
        }
      }, 500);
    }
  }, [autoPlayNext, currentSceneIndex, scenes.length, nextScene]);

  // Bookmark management
  const addBookmark = async () => {
    try {
      const res = await fetch(`${API_BASE}/library/${storyId}/bookmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_id: currentScene.id,
          name: `Scene ${currentSceneIndex + 1}`,
          audio_position: audioRef.current?.currentTime || 0
        })
      });
      const data = await res.json();
      setBookmarks([...bookmarks, data.bookmark]);
    } catch (error) {
      console.error('Failed to add bookmark:', error);
    }
  };

  const deleteBookmark = async (bookmarkId) => {
    try {
      await fetch(`${API_BASE}/library/${storyId}/bookmark/${bookmarkId}`, {
        method: 'DELETE'
      });
      setBookmarks(bookmarks.filter(b => b.id !== bookmarkId));
    } catch (error) {
      console.error('Failed to delete bookmark:', error);
    }
  };

  const goToBookmark = (bookmark) => {
    const sceneIdx = scenes.findIndex(s => s.id === bookmark.scene_id);
    if (sceneIdx >= 0) {
      goToScene(sceneIdx);
      if (bookmark.audio_position_seconds && audioRef.current) {
        audioRef.current.currentTime = bookmark.audio_position_seconds;
      }
    }
    setShowBookmarks(false);
  };

  // Controls visibility
  const handleInteraction = () => {
    setShowControls(true);
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowRight':
          nextScene();
          break;
        case 'ArrowLeft':
          prevScene();
          break;
        case 'b':
          addBookmark();
          break;
        case 'Escape':
          navigate('/library');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, nextScene, prevScene]);

  // Export story
  const exportStory = async (format) => {
    window.open(`${API_BASE}/library/${storyId}/export?format=${format}`, '_blank');
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: colors.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.text
      }}>
        Loading story...
      </div>
    );
  }

  if (!story || scenes.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        background: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.text,
        gap: '20px'
      }}>
        <p>Story not found or has no content</p>
        <button onClick={() => navigate('/library')} style={{
          background: colors.accent,
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          borderRadius: '8px',
          cursor: 'pointer'
        }}>
          Back to Library
        </button>
      </div>
    );
  }

  const progress = ((currentSceneIndex + 1) / scenes.length) * 100;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: colors.bg,
        color: colors.text,
        transition: 'background 0.3s, color 0.3s'
      }}
      onClick={handleInteraction}
    >
      {/* Hidden audio element */}
      {currentScene?.audio_url && (
        <audio
          ref={audioRef}
          src={currentScene.audio_url}
          onEnded={handleAudioEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          playbackRate={playbackSpeed}
        />
      )}

      {/* Top bar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '15px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: `linear-gradient(${colors.bg}, transparent)`,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
        zIndex: 100
      }}>
        <button
          onClick={() => { saveProgress(); navigate('/library'); }}
          style={{
            background: 'none',
            border: 'none',
            color: colors.text,
            fontSize: '20px',
            cursor: 'pointer'
          }}
        >
          ← Library
        </button>

        <div style={{ display: 'flex', gap: '15px' }}>
          <button
            onClick={() => setShowToc(true)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              fontSize: '18px',
              cursor: 'pointer'
            }}
            title="Table of Contents"
          >
            ☰
          </button>
          <button
            onClick={() => setShowBookmarks(true)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              fontSize: '18px',
              cursor: 'pointer'
            }}
            title="Bookmarks"
          >
            🔖
          </button>
          <button
            onClick={addBookmark}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              fontSize: '18px',
              cursor: 'pointer'
            }}
            title="Add Bookmark"
          >
            +🔖
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              fontSize: '18px',
              cursor: 'pointer'
            }}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: colors.textMuted + '33',
        zIndex: 101
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: colors.accent,
          transition: 'width 0.3s'
        }} />
      </div>

      {/* Main reading area */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '80px 30px 150px',
        minHeight: '100vh'
      }}>
        {/* Scene title */}
        <div style={{
          textAlign: 'center',
          marginBottom: '40px',
          color: colors.textMuted
        }}>
          <h2 style={{ fontSize: '14px', fontWeight: 'normal', margin: 0 }}>
            {story.title}
          </h2>
          <p style={{ fontSize: '12px', margin: '5px 0 0' }}>
            Scene {currentSceneIndex + 1} of {scenes.length}
            {currentScene?.mood && ` • ${currentScene.mood}`}
          </p>
        </div>

        {/* Scene content */}
        <div style={{
          fontFamily: FONT_FAMILIES[fontFamily],
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
          textAlign: 'justify'
        }}>
          {stripCharacterTags(currentScene?.polished_text || '')?.split('\n').map((paragraph, i) => (
            <p key={i} style={{ marginBottom: '1.5em' }}>
              {paragraph}
            </p>
          ))}
        </div>

        {/* CYOA Choices */}
        {currentScene?.choices && currentScene.choices.length > 0 && (
          <div style={{
            marginTop: '40px',
            padding: '20px',
            background: colors.highlight,
            borderRadius: '12px'
          }}>
            <h4 style={{ margin: '0 0 15px', color: colors.accent }}>
              What happens next?
            </h4>
            {currentScene.choices.map((choice, i) => (
              <button
                key={choice.id || i}
                onClick={() => {
                  // Handle choice selection
                  if (!choice.selected) {
                    nextScene();
                  }
                }}
                disabled={choice.selected}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '15px 20px',
                  marginBottom: '10px',
                  background: choice.selected ? colors.accent : 'transparent',
                  color: choice.selected ? 'white' : colors.text,
                  border: `2px solid ${colors.accent}`,
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: choice.selected ? 'default' : 'pointer',
                  textAlign: 'left',
                  opacity: choice.selected ? 0.7 : 1
                }}
              >
                <strong>{choice.key}.</strong> {choice.text}
              </button>
            ))}
          </div>
        )}

        {/* End of story */}
        {currentSceneIndex === scenes.length - 1 && (
          <div style={{
            textAlign: 'center',
            marginTop: '60px',
            padding: '40px',
            borderTop: `1px solid ${colors.textMuted}33`
          }}>
            <p style={{ fontSize: '24px', marginBottom: '20px' }}>The End</p>
            <p style={{ color: colors.textMuted, marginBottom: '30px' }}>
              Thank you for reading "{story.title}"
            </p>
            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => goToScene(0)}
                style={{
                  background: colors.accent,
                  color: 'white',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Read Again
              </button>
              <button
                onClick={() => exportStory('html')}
                style={{
                  background: 'transparent',
                  color: colors.accent,
                  border: `2px solid ${colors.accent}`,
                  padding: '12px 24px',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Export Story
              </button>
              <button
                onClick={() => navigate('/library')}
                style={{
                  background: 'transparent',
                  color: colors.textMuted,
                  border: `1px solid ${colors.textMuted}`,
                  padding: '12px 24px',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Back to Library
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '20px',
        background: `linear-gradient(transparent, ${colors.bg})`,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
        zIndex: 100
      }}>
        <div style={{
          maxWidth: '600px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px'
        }}>
          {/* Previous */}
          <button
            onClick={prevScene}
            disabled={currentSceneIndex === 0}
            style={{
              background: 'none',
              border: 'none',
              color: currentSceneIndex === 0 ? colors.textMuted : colors.text,
              fontSize: '24px',
              cursor: currentSceneIndex === 0 ? 'default' : 'pointer',
              padding: '10px'
            }}
          >
            ◀
          </button>

          {/* Play/Pause */}
          {currentScene?.audio_url && (
            <button
              onClick={togglePlayPause}
              style={{
                background: colors.accent,
                border: 'none',
                color: 'white',
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                fontSize: '24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
          )}

          {/* Next */}
          <button
            onClick={nextScene}
            disabled={currentSceneIndex === scenes.length - 1}
            style={{
              background: 'none',
              border: 'none',
              color: currentSceneIndex === scenes.length - 1 ? colors.textMuted : colors.text,
              fontSize: '24px',
              cursor: currentSceneIndex === scenes.length - 1 ? 'default' : 'pointer',
              padding: '10px'
            }}
          >
            ▶
          </button>
        </div>

        {/* Scene indicator */}
        <div style={{
          textAlign: 'center',
          marginTop: '10px',
          fontSize: '12px',
          color: colors.textMuted
        }}>
          {currentSceneIndex + 1} / {scenes.length}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200
        }} onClick={() => setShowSettings(false)}>
          <div
            style={{
              background: colors.bg,
              padding: '30px',
              borderRadius: '16px',
              maxWidth: '400px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px', color: colors.text }}>Reading Settings</h3>

            {/* Theme */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>Theme</label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                {Object.keys(THEMES).map(t => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: THEMES[t].bg,
                      color: THEMES[t].text,
                      border: theme === t ? `2px solid ${colors.accent}` : '2px solid transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      textTransform: 'capitalize'
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>
                Font Size: {fontSize}px
              </label>
              <input
                type="range"
                min="14"
                max="32"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                style={{ width: '100%', marginTop: '8px' }}
              />
            </div>

            {/* Font Family */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>Font</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '10px',
                  background: colors.bg,
                  color: colors.text,
                  border: `1px solid ${colors.textMuted}`,
                  borderRadius: '8px'
                }}
              >
                {Object.entries(FONT_FAMILIES).map(([key, value]) => (
                  <option key={key} value={key} style={{ fontFamily: value }}>
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Line Height */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>
                Line Height: {lineHeight}
              </label>
              <input
                type="range"
                min="1.2"
                max="2.4"
                step="0.1"
                value={lineHeight}
                onChange={(e) => setLineHeight(Number(e.target.value))}
                style={{ width: '100%', marginTop: '8px' }}
              />
            </div>

            {/* Playback Speed */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>
                Playback Speed: {playbackSpeed}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={playbackSpeed}
                onChange={(e) => {
                  setPlaybackSpeed(Number(e.target.value));
                  if (audioRef.current) {
                    audioRef.current.playbackRate = Number(e.target.value);
                  }
                }}
                style={{ width: '100%', marginTop: '8px' }}
              />
            </div>

            {/* Auto-play */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={autoPlayNext}
                  onChange={(e) => setAutoPlayNext(e.target.checked)}
                />
                <span style={{ color: colors.text }}>Auto-play next scene</span>
              </label>
            </div>

            {/* Export options */}
            <div style={{ borderTop: `1px solid ${colors.textMuted}33`, paddingTop: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>Export Story</label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button
                  onClick={() => exportStory('text')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'transparent',
                    color: colors.text,
                    border: `1px solid ${colors.textMuted}`,
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                >
                  Text
                </button>
                <button
                  onClick={() => exportStory('html')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'transparent',
                    color: colors.text,
                    border: `1px solid ${colors.textMuted}`,
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                >
                  HTML
                </button>
                <button
                  onClick={() => exportStory('json')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'transparent',
                    color: colors.text,
                    border: `1px solid ${colors.textMuted}`,
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                >
                  JSON
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '12px',
                background: colors.accent,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Bookmarks Modal */}
      {showBookmarks && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200
        }} onClick={() => setShowBookmarks(false)}>
          <div
            style={{
              background: colors.bg,
              padding: '30px',
              borderRadius: '16px',
              maxWidth: '400px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px', color: colors.text }}>Bookmarks</h3>

            {bookmarks.filter(b => !b.is_auto_bookmark).length === 0 ? (
              <p style={{ color: colors.textMuted, textAlign: 'center', padding: '20px' }}>
                No bookmarks yet. Press B or tap +🔖 to add one.
              </p>
            ) : (
              bookmarks.filter(b => !b.is_auto_bookmark).map(bookmark => (
                <div
                  key={bookmark.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    background: colors.highlight,
                    borderRadius: '8px',
                    marginBottom: '10px',
                    cursor: 'pointer'
                  }}
                  onClick={() => goToBookmark(bookmark)}
                >
                  <div>
                    <div style={{ color: colors.text, fontWeight: '500' }}>
                      {bookmark.name}
                    </div>
                    {bookmark.note && (
                      <div style={{ fontSize: '12px', color: colors.textMuted, marginTop: '4px' }}>
                        {bookmark.note}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteBookmark(bookmark.id); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.textMuted,
                      cursor: 'pointer',
                      fontSize: '18px'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}

            <button
              onClick={() => setShowBookmarks(false)}
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '12px',
                background: colors.accent,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Table of Contents Modal */}
      {showToc && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200
        }} onClick={() => setShowToc(false)}>
          <div
            style={{
              background: colors.bg,
              padding: '30px',
              borderRadius: '16px',
              maxWidth: '400px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px', color: colors.text }}>Scenes</h3>

            {scenes.map((scene, i) => (
              <div
                key={scene.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px',
                  background: i === currentSceneIndex ? colors.highlight : 'transparent',
                  borderRadius: '8px',
                  marginBottom: '5px',
                  cursor: 'pointer'
                }}
                onClick={() => { goToScene(i); setShowToc(false); }}
              >
                <span style={{
                  width: '30px',
                  color: i === currentSceneIndex ? colors.accent : colors.textMuted
                }}>
                  {i + 1}.
                </span>
                <span style={{
                  flex: 1,
                  color: colors.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {scene.summary || stripCharacterTags(scene.polished_text || '')?.substring(0, 40) + '...'}
                </span>
                {scene.mood && (
                  <span style={{
                    fontSize: '12px',
                    color: colors.textMuted,
                    marginLeft: '10px'
                  }}>
                    {scene.mood}
                  </span>
                )}
              </div>
            ))}

            <button
              onClick={() => setShowToc(false)}
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '12px',
                background: colors.accent,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
