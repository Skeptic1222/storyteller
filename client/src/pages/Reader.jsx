/**
 * Reader Page - E-Reader style story viewer
 * Read/listen to stories with bookmarks, progress tracking, and audio sync
 *
 * Uses ThemeContext for unified theme management across pages
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  ChevronUp,
  Download,
  List,
  Maximize2,
  Minimize2,
  Settings
} from 'lucide-react';
import { API_BASE, apiCall } from '../config';
import { getStoredToken } from '../utils/authToken';
import { stripAllTags } from '../utils/textUtils';
import { useKaraokeHighlight } from '../hooks/useKaraokeHighlight';
import { useReadingTheme, useTypography } from '../context/ThemeContext';

// Extended font families (some not in ThemeContext)
const FONT_FAMILIES = {
  georgia: 'Georgia, serif',
  palatino: 'Palatino Linotype, Book Antiqua, serif',
  times: 'Times New Roman, serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  verdana: 'Verdana, sans-serif',
  opendyslexic: 'OpenDyslexic, sans-serif'
};

const READER_SETTINGS_STORAGE_KEY = 'narrimo_reader_settings';
const LEGACY_READER_SETTINGS_STORAGE_KEY = 'storyteller_reader_settings';

export default function Reader() {
  const { storyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Theme from context - persists across pages
  const { theme: colors, setTheme, themes } = useReadingTheme();
  const {
    fontSize,
    lineHeight,
    setFontSize,
    setLineHeight
  } = useTypography();
  const themeId = colors?.id || 'dark';

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
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportInfo, setExportInfo] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Reader-specific settings (not in context yet)
  const [fontFamily, setFontFamily] = useState('georgia');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [syncHighlight, setSyncHighlight] = useState(true);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioBuffering, setAudioBuffering] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Line-level karaoke highlighting
  const [currentLineStart, setCurrentLineStart] = useState(-1);
  const [currentLineEnd, setCurrentLineEnd] = useState(-1);

  // Refs
  const audioRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const readingStartRef = useRef(null);
  const wordRefs = useRef(new Map());
  const currentScene = scenes[currentSceneIndex];

  const getAuthHeaders = useCallback(() => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const downloadWithAuth = useCallback(async (url, fallbackName) => {
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) {
      throw new Error('Download failed');
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
    const filename = match?.[1] || fallbackName;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }, [getAuthHeaders]);

  // Karaoke highlighting hook
  const currentWordIndex = useKaraokeHighlight({
    wordTimings: syncHighlight ? currentScene?.word_timings : null,
    currentTime: audioCurrentTime,
    isPlaying: isPlaying,
    isPaused: !isPlaying && audioCurrentTime > 0,
    showText: true,
    isSceneAudio: true
  });

  // Line detection for karaoke - highlight entire line containing current word
  useEffect(() => {
    if (currentWordIndex < 0 || !wordRefs.current.size) {
      setCurrentLineStart(-1);
      setCurrentLineEnd(-1);
      return;
    }

    const currentWordEl = wordRefs.current.get(currentWordIndex);
    if (!currentWordEl) return;

    const currentRect = currentWordEl.getBoundingClientRect();
    const threshold = 15; // pixels - words on same line should be within this Y distance

    let lineStart = currentWordIndex;
    let lineEnd = currentWordIndex;

    // Find line start (scan backwards)
    for (let i = currentWordIndex - 1; i >= 0; i--) {
      const el = wordRefs.current.get(i);
      if (!el) break;
      const rect = el.getBoundingClientRect();
      if (Math.abs(rect.top - currentRect.top) > threshold) break;
      lineStart = i;
    }

    // Find line end (scan forwards)
    const totalWords = currentScene?.word_timings?.words?.length || 0;
    for (let i = currentWordIndex + 1; i < totalWords; i++) {
      const el = wordRefs.current.get(i);
      if (!el) break;
      const rect = el.getBoundingClientRect();
      if (Math.abs(rect.top - currentRect.top) > threshold) break;
      lineEnd = i;
    }

    setCurrentLineStart(lineStart);
    setCurrentLineEnd(lineEnd);
  }, [currentWordIndex, currentScene?.word_timings?.words?.length]);

  // Load reader settings from localStorage on mount
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(READER_SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        if (settings.theme) setTheme(settings.theme);
        if (settings.fontSize) setFontSize(settings.fontSize);
        if (settings.fontFamily) setFontFamily(settings.fontFamily);
        if (settings.lineHeight) setLineHeight(settings.lineHeight);
        if (settings.playbackSpeed) setPlaybackSpeed(settings.playbackSpeed);
        if (typeof settings.autoPlayNext === 'boolean') setAutoPlayNext(settings.autoPlayNext);
        if (typeof settings.syncHighlight === 'boolean') setSyncHighlight(settings.syncHighlight);
        return;
      }

      const legacySettings = localStorage.getItem(LEGACY_READER_SETTINGS_STORAGE_KEY);
      if (legacySettings) {
        const settings = JSON.parse(legacySettings);
        localStorage.setItem(READER_SETTINGS_STORAGE_KEY, legacySettings);
        localStorage.removeItem(LEGACY_READER_SETTINGS_STORAGE_KEY);

        if (settings.theme) setTheme(settings.theme);
        if (settings.fontSize) setFontSize(settings.fontSize);
        if (settings.fontFamily) setFontFamily(settings.fontFamily);
        if (settings.lineHeight) setLineHeight(settings.lineHeight);
        if (settings.playbackSpeed) setPlaybackSpeed(settings.playbackSpeed);
        if (typeof settings.autoPlayNext === 'boolean') setAutoPlayNext(settings.autoPlayNext);
        if (typeof settings.syncHighlight === 'boolean') setSyncHighlight(settings.syncHighlight);
      }
    } catch (e) {
      console.warn('Failed to load reader settings:', e);
    }
  }, []);

  // Save reader settings to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify({
        theme: themeId, fontSize, fontFamily, lineHeight, playbackSpeed, autoPlayNext, syncHighlight
      }));
      localStorage.removeItem(LEGACY_READER_SETTINGS_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to save reader settings:', e);
    }
  }, [themeId, fontSize, fontFamily, lineHeight, playbackSpeed, autoPlayNext, syncHighlight]);

  // Clear word refs when scene changes
  useEffect(() => {
    wordRefs.current.clear();
    setCurrentLineStart(-1);
    setCurrentLineEnd(-1);
  }, [currentSceneIndex]);

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
      const res = await apiCall(`/library/${storyId}`);
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

  // Auto-open export modal if navigated from Library
  useEffect(() => {
    if (!loading && story && location.state?.openExport) {
      openExportModal();
      // Clear the state to prevent reopening on re-renders
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [loading, story, location.state]);

  const saveProgress = async () => {
    if (!currentScene) return;

    const readingTime = Math.floor((Date.now() - (readingStartRef.current || Date.now())) / 1000);

    try {
      await apiCall(`/library/${storyId}/progress`, {
        method: 'POST',
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
      const res = await apiCall(`/library/${storyId}/bookmark`, {
        method: 'POST',
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
      await apiCall(`/library/${storyId}/bookmark/${bookmarkId}`, {
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

  // Scroll-to-top button visibility
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('Fullscreen not supported:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Sync fullscreen state with browser's fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Export story (legacy)
  const exportStory = async (format) => {
    try {
      const fallbackName = `${story?.title || 'story'}.${format}`;
      await downloadWithAuth(`${API_BASE}/library/${storyId}/export?format=${format}`, fallbackName);
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed. Please try again.');
    }
  };

  // Open export modal and fetch export info
  const openExportModal = async () => {
    setShowExportModal(true);
    setExportInfo(null);

    // Get the current recording ID from story data
    const recordingId = story?.current_recording_id || story?.recording_id;
    if (!recordingId) {
      setExportInfo({ error: 'No recording available for this story' });
      return;
    }

    try {
      const response = await apiCall(`/recordings/${recordingId}/export-info`);
      if (response.ok) {
        const info = await response.json();
        setExportInfo(info);
      } else {
        setExportInfo({ error: 'Failed to load export info' });
      }
    } catch (error) {
      console.error('Export info error:', error);
      setExportInfo({ error: 'Failed to load export info' });
    }
  };

  // Handle download export
  const handleExport = async (options = {}) => {
    const { includeSfx = false, format = 'mp3' } = options;
    const recordingId = story?.current_recording_id || story?.recording_id;

    if (!recordingId) {
      alert('No recording available for export');
      return;
    }

    setExporting(true);

    try {
      const queryParams = new URLSearchParams();
      if (format !== 'mp3') {
        queryParams.set('format', format);
      } else if (includeSfx) {
        queryParams.set('includeSfx', 'true');
      }

      const url = `${API_BASE}/recordings/${recordingId}/export${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      const baseTitle = story?.title || 'story';
      const suffix = includeSfx ? '_with_sfx' : '';
      const extension = format === 'mp3' ? 'mp3' : format;
      const fallbackName = `${baseTitle}${suffix}.${extension}`;

      await downloadWithAuth(url, fallbackName);
      setShowExportModal(false);
      setExporting(false);

    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed. Please try again.');
      setExporting(false);
    }
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
      {/* CSS Keyframes for loading animations */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Hidden audio element */}
      {currentScene?.audio_url && (
        <audio
          ref={audioRef}
          src={currentScene.audio_url}
          onEnded={handleAudioEnded}
          onPlay={() => { setIsPlaying(true); setAudioBuffering(false); }}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setAudioCurrentTime(e.target.currentTime)}
          onLoadStart={() => setAudioLoading(true)}
          onCanPlay={() => setAudioLoading(false)}
          onWaiting={() => setAudioBuffering(true)}
          onPlaying={() => setAudioBuffering(false)}
          playbackRate={playbackSpeed}
        />
      )}

      {/* Top bar - auto-hides in fullscreen, visible on hover/tap */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '15px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: isFullscreen
          ? `${colors.bg}ee`  // More opaque in fullscreen for better visibility
          : `linear-gradient(${colors.bg}, transparent)`,
        opacity: showControls ? 1 : 0,
        transform: isFullscreen && !showControls ? 'translateY(-100%)' : 'translateY(0)',
        transition: 'opacity 0.3s, transform 0.3s',
        zIndex: 100,
        borderRadius: isFullscreen ? '0 0 8px 8px' : 0
      }}>
                  <button
            onClick={() => { saveProgress(); navigate('/library'); }}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <ArrowLeft size={18} />
            <span>Library</span>
          </button>

        <div style={{ display: 'flex', gap: '12px' }}>
                    <button
            onClick={() => setShowToc(true)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer'
            }}
            title="Table of Contents"
          >
            <List size={18} />
          </button>
                    <button
            onClick={() => setShowBookmarks(true)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer'
            }}
            title="Bookmarks"
          >
            <Bookmark size={18} />
          </button>
                    <button
            onClick={addBookmark}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer'
            }}
            title="Add Bookmark"
          >
            <BookmarkPlus size={18} />
          </button>
                    <button
            onClick={() => setShowSettings(true)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer'
            }}
            title="Settings"
          >
            <Settings size={18} />
          </button>
                    <button
            onClick={openExportModal}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer'
            }}
            title="Download Story"
          >
            <Download size={18} />
          </button>
                    <button
            onClick={toggleFullscreen}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text,
              cursor: 'pointer'
            }}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
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
        maxWidth: isFullscreen ? '900px' : '800px',
        margin: '0 auto',
        padding: isFullscreen ? '40px 40px 120px' : '80px 30px 150px',
        minHeight: '100vh',
        transition: 'padding 0.3s, max-width 0.3s'
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
          {/* Render with word-by-word karaoke highlighting if word_timings available */}
          {syncHighlight && currentScene?.word_timings?.words ? (
            <div style={{ marginBottom: '1.5em' }}>
              {currentScene.word_timings.words.map((word, i) => {
                const isCurrentWord = i === currentWordIndex;
                const isOnCurrentLine = i >= currentLineStart && i <= currentLineEnd && currentLineStart >= 0;

                return (
                  <span
                    key={i}
                    ref={(el) => {
                      if (el) wordRefs.current.set(i, el);
                      else wordRefs.current.delete(i);
                    }}
                    style={{
                      backgroundColor: isCurrentWord
                        ? colors.accent
                        : isOnCurrentLine
                          ? colors.highlight
                          : 'transparent',
                      color: isCurrentWord ? '#fff' : colors.text,
                      padding: isCurrentWord
                        ? `${Math.round(fontSize * 0.1)}px ${Math.round(fontSize * 0.2)}px`
                        : isOnCurrentLine
                          ? `${Math.round(fontSize * 0.05)}px 0`
                          : '0',
                      borderRadius: `${Math.round(fontSize * 0.15)}px`,
                      transition: 'background-color 0.15s, color 0.15s',
                      display: 'inline'
                    }}
                  >
                    {word.text}
                    {/* Add space after word */}
                    {i < currentScene.word_timings.words.length - 1 ? ' ' : ''}
                  </span>
                );
              })}
            </div>
          ) : (
            /* Fallback to paragraph-based rendering when no word timings */
            stripAllTags(currentScene?.polished_text || '')?.split('\n').map((paragraph, i) => (
              <p key={i} style={{ marginBottom: '1.5em' }}>
                {paragraph}
              </p>
            ))
          )}
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
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
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

          {/* Play/Pause with Loading/Buffering indicator */}
          {currentScene?.audio_url && (
            <button
              onClick={togglePlayPause}
              disabled={audioLoading}
              style={{
                background: audioLoading || audioBuffering ? colors.textMuted : colors.accent,
                border: 'none',
                color: 'white',
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                fontSize: '24px',
                cursor: audioLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                opacity: audioBuffering ? 0.8 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              {audioLoading ? (
                <span style={{
                  width: '24px',
                  height: '24px',
                  border: '3px solid rgba(255,255,255,0.3)',
                  borderTop: '3px solid white',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
              ) : audioBuffering ? (
                <span style={{
                  fontSize: '20px',
                  animation: 'pulse 1s ease-in-out infinite'
                }}>⏳</span>
              ) : (
                isPlaying ? '⏸' : '▶'
              )}
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

            {/* Theme - uses ThemeContext for persistence across pages */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', color: colors.textMuted }}>Theme</label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                {themes.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: t.bg,
                      color: t.text,
                      border: colors.id === t.id ? `2px solid ${colors.accent}` : '2px solid transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {t.name}
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
                  {scene.summary || stripAllTags(scene.polished_text || '')?.substring(0, 40) + '...'}
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

      {/* Export Modal */}
      {showExportModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200
        }} onClick={() => setShowExportModal(false)}>
          <div
            style={{
              background: colors.bg,
              padding: '30px',
              borderRadius: '16px',
              maxWidth: '450px',
              width: '90%',
              border: `1px solid ${colors.textMuted}33`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px', color: colors.text }}>Download Story</h3>

            {!exportInfo && (
              <div style={{ textAlign: 'center', padding: '20px', color: colors.textMuted }}>
                Loading export options...
              </div>
            )}

            {exportInfo?.error && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#ef4444' }}>
                {exportInfo.error}
              </div>
            )}

            {exportInfo && !exportInfo.error && (
              <div>
                <div style={{
                  padding: '15px',
                  background: colors.highlight,
                  borderRadius: '8px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  color: colors.textMuted
                }}>
                  <div><strong style={{ color: colors.text }}>{exportInfo.title || 'Story'}</strong></div>
                  <div style={{ marginTop: '5px' }}>
                    {exportInfo.segmentCount} scenes
                    {exportInfo.duration ? ` • ${Math.round(exportInfo.duration / 60)} min` : ''}
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 10px', color: colors.text, fontSize: '14px' }}>Audio Download</h4>

                  <button
                    onClick={() => handleExport({ includeSfx: false })}
                    disabled={exporting}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: colors.accent,
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: exporting ? 'not-allowed' : 'pointer',
                      opacity: exporting ? 0.7 : 1,
                      marginBottom: '10px',
                      fontWeight: '500'
                    }}
                  >
                    {exporting ? 'Preparing Download...' : 'Download MP3 (Narration Only)'}
                  </button>

                  {exportInfo.hasSfx && (
                    <button
                      onClick={() => handleExport({ includeSfx: true })}
                      disabled={exporting}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'transparent',
                        color: colors.accent,
                        border: `2px solid ${colors.accent}`,
                        borderRadius: '8px',
                        cursor: exporting ? 'not-allowed' : 'pointer',
                        opacity: exporting ? 0.7 : 1
                      }}
                    >
                      {exporting ? 'Preparing...' : 'Download MP3 with Sound Effects'}
                    </button>
                  )}
                </div>

                {exportInfo.subtitleFormats?.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 10px', color: colors.text, fontSize: '14px' }}>Subtitles</h4>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => handleExport({ format: 'srt' })}
                        style={{
                          flex: 1,
                          padding: '10px',
                          background: colors.highlight,
                          color: colors.text,
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer'
                        }}
                      >
                        Download .SRT
                      </button>
                      <button
                        onClick={() => handleExport({ format: 'vtt' })}
                        style={{
                          flex: 1,
                          padding: '10px',
                          background: colors.highlight,
                          color: colors.text,
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer'
                        }}
                      >
                        Download .VTT
                      </button>
                    </div>
                    <p style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      color: colors.textMuted
                    }}>
                      Use with external media players
                    </p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setShowExportModal(false)}
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '12px',
                background: 'transparent',
                color: colors.textMuted,
                border: `1px solid ${colors.textMuted}33`,
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Scroll to Top Button */}
      {showScrollTop && (
                  <button
            style={{
              position: 'fixed',
              bottom: '30px',
              right: '30px',
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: colors.accent,
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 90,
              opacity: showControls ? 1 : 0.6,
              transition: 'opacity 0.3s, transform 0.2s',
              transform: 'translateY(0)'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-3px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
            title="Scroll to top"
            aria-label="Scroll to top"
          >
            <ChevronUp size={22} />
          </button>
      )}

      {/* Floating fullscreen exit hint - visible in fullscreen mode */}
      {isFullscreen && (
                  <button
            onClick={toggleFullscreen}
            style={{
              position: 'fixed',
              top: '10px',
              right: '10px',
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              background: colors.bg + 'cc',
              color: colors.textMuted,
              border: `1px solid ${colors.textMuted}44`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 102,
              opacity: showControls ? 0 : 0.5,
              transition: 'opacity 0.3s'
            }}
            onMouseEnter={(e) => e.target.style.opacity = 1}
            onMouseLeave={(e) => e.target.style.opacity = showControls ? 0 : 0.5}
            title="Exit Fullscreen (Esc)"
            aria-label="Exit fullscreen"
          >
            <Minimize2 size={18} />
          </button>
      )}
    </div>
  );
}
