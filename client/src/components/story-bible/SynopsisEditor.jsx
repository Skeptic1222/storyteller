/**
 * SynopsisEditor - Multi-agent synopsis editor with real-time progress
 *
 * Flow: Generate Synopsis (10-agent system) → Refine with AI → Generate Outline → Generate Beats
 * Uses socket.io for real-time progress updates during multi-agent synopsis generation
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Sparkles, Wand2, ChevronDown, ChevronUp,
  Play, Loader2, RefreshCw, Send, Zap, Copy, Brain, CheckCircle2
} from 'lucide-react';
import { apiCall } from '../../config';
import ChapterCard from './ChapterCard';

// Agent names for progress display (IDs must match backend exactly)
const SYNOPSIS_AGENTS = [
  { id: 'character-analysis', name: 'Character Analysis', icon: '👤' },
  { id: 'world-analysis', name: 'World & Setting', icon: '🌍' },
  { id: 'conflict-analysis', name: 'Conflict & Stakes', icon: '⚔️' },
  { id: 'theme-extraction', name: 'Theme Extraction', icon: '💡' },
  { id: 'plot-structure', name: 'Plot Structure', icon: '📊' },
  { id: 'emotional-journey', name: 'Emotional Journey', icon: '💓' },
  { id: 'genre-tone', name: 'Genre & Tone', icon: '🎭' },
  { id: 'synopsis-draft', name: 'Synopsis Draft', icon: '📝' },
  { id: 'synopsis-refiner', name: 'Synopsis Refiner', icon: '✨' },
  { id: 'logline-metadata', name: 'Logline & Metadata', icon: '🏷️' }
];

export default function SynopsisEditor({
  synopsis,
  libraryId,
  libraryName,
  worldData,
  characters,
  locations,
  items,
  factions,
  lore,
  events,
  socket,
  onSynopsisUpdate,
  onSynopsisCreate
}) {
  const navigate = useNavigate();

  // State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [generatingBeats, setGeneratingBeats] = useState({});
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [outline, setOutline] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState(new Set());
  const [chapterBeats, setChapterBeats] = useState({});
  const [chapterEventLinks, setChapterEventLinks] = useState({});
  const [refiningChapter, setRefiningChapter] = useState(null);

  // Multi-agent progress state
  const [generationProgress, setGenerationProgress] = useState(null);
  const [completedAgents, setCompletedAgents] = useState([]);
  const [currentAgent, setCurrentAgent] = useState(null);
  const roomIdRef = useRef(null);

  // Parse outline from synopsis
  useEffect(() => {
    if (synopsis?.outline_json) {
      const outlineData = typeof synopsis.outline_json === 'string'
        ? JSON.parse(synopsis.outline_json)
        : synopsis.outline_json;
      setOutline(outlineData);
    } else {
      setOutline(null);
    }
  }, [synopsis?.outline_json]);

  // Fetch beats when synopsis loads
  useEffect(() => {
    if (synopsis?.id && synopsis?.is_outline_generated) {
      fetchBeats();
    }
  }, [synopsis?.id, synopsis?.is_outline_generated]);

  // Socket event handlers for multi-agent progress
  useEffect(() => {
    if (!socket) return;

    const handleProgress = (data) => {
      console.log('[Synopsis] Progress:', data);

      // Track current running agent
      if (data.status === 'running') {
        setCurrentAgent(data.agent);
      }

      setGenerationProgress(data);

      // Track completed agents
      if (data.status === 'complete') {
        setCompletedAgents(prev => {
          if (!prev.includes(data.agent)) {
            return [...prev, data.agent];
          }
          return prev;
        });
      }
    };

    const handleComplete = (data) => {
      console.log('[Synopsis] Complete:', data);
      setIsGenerating(false);
      setCurrentAgent(null);
      setGenerationProgress(null);

      // Leave the room
      if (roomIdRef.current) {
        socket.emit('leave-room', roomIdRef.current);
        roomIdRef.current = null;
      }

      // Create the synopsis in database
      if (data.synopsis) {
        handleSynopsisComplete(data.synopsis);
      }
    };

    const handleError = (data) => {
      console.error('[Synopsis] Error:', data);
      setIsGenerating(false);
      setCurrentAgent(null);
      setGenerationProgress(null);
      setCompletedAgents([]);

      // Leave the room
      if (roomIdRef.current) {
        socket.emit('leave-room', roomIdRef.current);
        roomIdRef.current = null;
      }

      alert('Failed to generate synopsis: ' + (data.error || 'Unknown error'));
    };

    socket.on('synopsis-progress', handleProgress);
    socket.on('synopsis-complete', handleComplete);
    socket.on('synopsis-error', handleError);

    return () => {
      socket.off('synopsis-progress', handleProgress);
      socket.off('synopsis-complete', handleComplete);
      socket.off('synopsis-error', handleError);

      // Leave room on unmount if still generating
      if (roomIdRef.current) {
        socket.emit('leave-room', roomIdRef.current);
      }
    };
  }, [socket]);

  // Handle synopsis completion - save to database
  const handleSynopsisComplete = async (synopsisData) => {
    try {
      const createResponse = await apiCall('/story-bible/synopsis', {
        method: 'POST',
        body: JSON.stringify({
          library_id: libraryId,
          title: synopsisData.title || libraryName,
          logline: synopsisData.logline || '',
          synopsis: synopsisData.synopsis,
          genre: synopsisData.genre || worldData?.genre,
          mood: synopsisData.mood || worldData?.tone,
          themes: synopsisData.themes || []
        })
      });

      if (onSynopsisCreate && createResponse.synopsis) {
        onSynopsisCreate(createResponse.synopsis);
      }

      // Reset progress state
      setCompletedAgents([]);
    } catch (error) {
      console.error('Failed to save synopsis:', error);
      alert('Synopsis generated but failed to save. Please try again.');
    }
  };

  const fetchBeats = async () => {
    if (!synopsis?.id) return;
    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/beats`);
      if (res.ok) {
        const data = await res.json();
        const beatsByChapter = {};
        (data.beats || []).forEach(chapterBeat => {
          beatsByChapter[chapterBeat.chapter_number] = chapterBeat.beats || [];
        });
        setChapterBeats(beatsByChapter);
      }
    } catch (error) {
      console.error('Failed to fetch beats:', error);
    }
  };

  // Generate synopsis from world data using multi-agent system
  const handleGenerateSynopsis = async () => {
    setIsGenerating(true);
    setCompletedAgents([]);
    setCurrentAgent(null);
    setGenerationProgress(null);

    try {
      const res = await apiCall('/story-bible/synopsis/generate-from-world', {
        method: 'POST',
        body: JSON.stringify({
          library_id: libraryId,
          library_name: libraryName,
          world: worldData,
          characters: characters?.slice(0, 15),
          locations: locations?.slice(0, 10),
          items: items?.slice(0, 10),
          factions: factions?.slice(0, 10),
          lore: lore?.slice(0, 10),
          events: events?.slice(0, 15) // Include planned story events
        })
      });

      if (!res.ok) {
        throw new Error('Failed to start synopsis generation');
      }

      const data = await res.json();

      // Server returns room_id for socket progress tracking
      if (data.room_id && socket) {
        roomIdRef.current = data.room_id;
        socket.emit('join-room', data.room_id);
        console.log('[Synopsis] Joined room:', data.room_id);
        // Generation will continue via socket events
        // isGenerating stays true until synopsis-complete or synopsis-error
      } else if (data.synopsis) {
        // Fallback for non-socket response (shouldn't happen with new backend)
        await handleSynopsisComplete(data.synopsis);
        setIsGenerating(false);
      }
    } catch (error) {
      console.error('Failed to generate synopsis:', error);
      alert('Failed to generate synopsis. Please try again.');
      setIsGenerating(false);
      setCompletedAgents([]);
    }
  };

  // Refine synopsis with AI (uses existing pattern)
  const handleRefine = async () => {
    if (!refinementPrompt.trim() || !synopsis?.id) return;

    setIsRefining(true);
    try {
      const res = await apiCall(`/story-bible/refine/synopsis/${synopsis.id}`, {
        method: 'POST',
        body: JSON.stringify({ prompt: refinementPrompt })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.synopsis && onSynopsisUpdate) {
          onSynopsisUpdate(data.synopsis);
        }
        setRefinementPrompt('');
      } else {
        throw new Error('Failed to refine synopsis');
      }
    } catch (error) {
      console.error('Failed to refine synopsis:', error);
      alert('Failed to refine synopsis. Please try again.');
    } finally {
      setIsRefining(false);
    }
  };

  // Generate outline
  const handleGenerateOutline = async () => {
    if (!synopsis?.id) return;

    setGeneratingOutline(true);
    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/generate-outline`, {
        method: 'POST',
        body: JSON.stringify({ chapter_count: 10 })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.outline) {
          setOutline(data.outline);
          if (onSynopsisUpdate) {
            onSynopsisUpdate({
              ...synopsis,
              outline_json: data.outline,
              is_outline_generated: true
            });
          }
        }
      } else {
        throw new Error('Failed to generate outline');
      }
    } catch (error) {
      console.error('Failed to generate outline:', error);
      alert('Failed to generate outline. Please try again.');
    } finally {
      setGeneratingOutline(false);
    }
  };

  // Generate beats for a chapter
  const handleGenerateBeats = async (chapterNumber) => {
    if (!synopsis?.id) return;

    setGeneratingBeats(prev => ({ ...prev, [chapterNumber]: true }));
    try {
      const res = await apiCall(
        `/story-bible/synopsis/${synopsis.id}/generate-beats/${chapterNumber}`,
        { method: 'POST' }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.beats) {
          setChapterBeats(prev => ({
            ...prev,
            [chapterNumber]: data.beats
          }));
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate beats');
      }
    } catch (error) {
      console.error('Failed to generate beats:', error);
      alert(`Failed to generate beats for chapter ${chapterNumber}: ${error.message}`);
    } finally {
      setGeneratingBeats(prev => ({ ...prev, [chapterNumber]: false }));
    }
  };

  // Update chapter
  const handleUpdateChapter = async (chapterIndex, updatedChapter) => {
    if (!synopsis?.id || !outline) return;

    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/outline`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'update_chapter',
          chapter_index: chapterIndex,
          chapter_data: updatedChapter
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.outline) {
          setOutline(data.outline);
        }
      }
    } catch (error) {
      console.error('Failed to update chapter:', error);
    }
  };

  // Delete chapter
  const handleDeleteChapter = async (chapterIndex) => {
    if (!synopsis?.id || !outline) return;
    if (!confirm(`Delete Chapter ${chapterIndex + 1}? This cannot be undone.`)) return;

    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/outline`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'delete_chapter',
          chapter_index: chapterIndex
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.outline) {
          setOutline(data.outline);
        }
      }
    } catch (error) {
      console.error('Failed to delete chapter:', error);
    }
  };

  // Add chapter
  const handleAddChapter = async (position) => {
    if (!synopsis?.id) return;

    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/outline`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'add_chapter',
          position,
          chapter_data: {
            title: 'New Chapter',
            summary: '',
            key_events: [],
            characters_present: [],
            location: '',
            mood: '',
            ends_with: 'continuation'
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.outline) {
          setOutline(data.outline);
        }
      }
    } catch (error) {
      console.error('Failed to add chapter:', error);
    }
  };

  const toggleChapterExpanded = (chapterNumber) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterNumber)) {
        next.delete(chapterNumber);
      } else {
        next.add(chapterNumber);
      }
      return next;
    });
  };

  // Link events to a chapter
  const handleLinkEventsToChapter = async (chapterNumber, eventIds) => {
    if (!synopsis?.id) return;

    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/chapter/${chapterNumber}/link-events`, {
        method: 'POST',
        body: JSON.stringify({ event_ids: eventIds })
      });

      if (res.ok) {
        // Update local state
        setChapterEventLinks(prev => ({
          ...prev,
          [chapterNumber]: eventIds
        }));
      } else {
        throw new Error('Failed to link events');
      }
    } catch (error) {
      console.error('Failed to link events to chapter:', error);
      alert('Failed to link events to chapter');
    }
  };

  // Refine a chapter with AI
  const handleRefineChapter = async (chapterNumber, instructions) => {
    if (!synopsis?.id || !outline) return;

    setRefiningChapter(chapterNumber);
    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsis.id}/refine-chapter/${chapterNumber}`, {
        method: 'POST',
        body: JSON.stringify({ prompt: instructions })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.chapter) {
          // Update the chapter in the outline
          const updatedOutline = {
            ...outline,
            chapters: outline.chapters.map((ch, idx) =>
              idx === chapterNumber - 1 ? data.chapter : ch
            )
          };
          setOutline(updatedOutline);
        }
      } else {
        throw new Error('Failed to refine chapter');
      }
    } catch (error) {
      console.error('Failed to refine chapter:', error);
      alert('Failed to refine chapter');
    } finally {
      setRefiningChapter(null);
    }
  };

  // Update a beat
  const handleUpdateBeat = async (chapterNumber, beatNumber, updatedBeat) => {
    if (!synopsis?.id) return;

    try {
      const res = await apiCall(
        `/story-bible/synopsis/${synopsis.id}/beats/${chapterNumber}/${beatNumber}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updatedBeat)
        }
      );

      if (res.ok) {
        // Update local state
        setChapterBeats(prev => ({
          ...prev,
          [chapterNumber]: prev[chapterNumber]?.map(b =>
            b.beat_number === beatNumber ? { ...b, ...updatedBeat } : b
          ) || []
        }));
      } else {
        throw new Error('Failed to update beat');
      }
    } catch (error) {
      console.error('Failed to update beat:', error);
      alert('Failed to update beat');
    }
  };

  // Refine a beat with AI
  const handleRefineBeat = async (chapterNumber, beatNumber, instructions) => {
    if (!synopsis?.id) return;

    try {
      const res = await apiCall(
        `/story-bible/synopsis/${synopsis.id}/refine-beat/${chapterNumber}/${beatNumber}`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: instructions })
        }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.beat) {
          // Update local state
          setChapterBeats(prev => ({
            ...prev,
            [chapterNumber]: prev[chapterNumber]?.map(b =>
              b.beat_number === beatNumber ? data.beat : b
            ) || []
          }));
        }
      } else {
        throw new Error('Failed to refine beat');
      }
    } catch (error) {
      console.error('Failed to refine beat:', error);
      alert('Failed to refine beat');
    }
  };

  const handleStartStory = () => {
    if (!synopsis?.id) return;
    navigate(`/configure?outline=${synopsis.id}&library=${libraryId}`);
  };

  const handleSaveAsCopy = async () => {
    const newName = prompt('Enter name for the new library copy:', `${libraryName} - Copy`);
    if (!newName) return;

    try {
      const res = await apiCall(`/story-bible/libraries/${libraryId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ new_name: newName })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.library) {
          alert(`Library "${newName}" created successfully!`);
        }
      }
    } catch (error) {
      console.error('Failed to duplicate library:', error);
      alert('Failed to create copy');
    }
  };

  // Multi-agent progress component
  const AgentProgressPanel = () => (
    <div className="bg-slate-900/80 rounded-xl p-6 border border-purple-500/30 mt-6">
      <div className="flex items-center gap-3 mb-4">
        <Brain className="w-6 h-6 text-purple-400 animate-pulse" />
        <h4 className="text-lg font-medium text-white">Multi-Agent Synopsis Generation</h4>
      </div>
      <p className="text-slate-400 text-sm mb-4">
        10 specialized AI agents are collaborating to create a comprehensive synopsis...
      </p>
      <div className="grid grid-cols-2 gap-2">
        {SYNOPSIS_AGENTS.map((agent, index) => {
          const isCompleted = completedAgents.includes(agent.id);
          const isCurrent = currentAgent === agent.id;
          return (
            <div
              key={agent.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                isCompleted
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                  : isCurrent
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50 animate-pulse'
                  : 'bg-slate-800/50 text-slate-500 border border-slate-700/30'
              }`}
            >
              <span className="text-base">{agent.icon}</span>
              <span className="flex-1 truncate">{agent.name}</span>
              {isCompleted && <CheckCircle2 className="w-4 h-4 text-green-400" />}
              {isCurrent && <Loader2 className="w-4 h-4 animate-spin" />}
            </div>
          );
        })}
      </div>
      <div className="mt-4 text-center text-slate-400 text-sm">
        {completedAgents.length} of {SYNOPSIS_AGENTS.length} agents complete
      </div>
    </div>
  );

  // No synopsis yet - show generate button
  if (!synopsis) {
    return (
      <div className="space-y-6">
        <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700/50 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-500/20 rounded-2xl flex items-center justify-center">
            {isGenerating ? (
              <Brain className="w-8 h-8 text-purple-400 animate-pulse" />
            ) : (
              <FileText className="w-8 h-8 text-amber-400" />
            )}
          </div>
          <h3 className="text-xl font-medium text-white mb-2">
            {isGenerating ? 'Generating Synopsis...' : 'Generate Synopsis'}
          </h3>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            {isGenerating
              ? 'Our multi-agent AI system is analyzing your world and creating a compelling synopsis.'
              : `Create a synopsis for "${libraryName}" using your world, characters, and locations.`}
          </p>

          {!isGenerating && (
            <button
              onClick={handleGenerateSynopsis}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600
                       disabled:bg-amber-500/50 text-white font-medium rounded-xl transition-colors"
            >
              <Wand2 className="w-5 h-5" />
              Generate Synopsis
            </button>
          )}

          {!worldData && !isGenerating && (
            <p className="text-amber-400/70 text-sm mt-4">
              Tip: Add a World first to get better synopsis results.
            </p>
          )}
        </div>

        {/* Show agent progress when generating */}
        {isGenerating && <AgentProgressPanel />}
      </div>
    );
  }

  // Synopsis exists - show editor
  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">{synopsis.title || libraryName}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveAsCopy}
            className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600
                     text-slate-300 rounded-lg transition-colors text-sm"
          >
            <Copy className="w-4 h-4" />
            Save as Copy
          </button>
          {outline && (
            <button
              onClick={handleStartStory}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700
                       text-white rounded-lg transition-colors"
            >
              <Play className="w-4 h-4" />
              Start Story
            </button>
          )}
        </div>
      </div>

      {/* Synopsis Display */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-white">Synopsis</h3>
          <button
            onClick={handleGenerateSynopsis}
            disabled={isGenerating}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-400 hover:text-white
                     transition-colors"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Regenerate
          </button>
        </div>

        {/* Logline */}
        {synopsis.logline && (
          <p className="text-amber-300 italic">{synopsis.logline}</p>
        )}

        {/* Synopsis text */}
        <p className="text-slate-300 whitespace-pre-wrap">{synopsis.synopsis}</p>

        {/* Meta info */}
        <div className="flex flex-wrap gap-2 pt-2">
          {synopsis.genre && (
            <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-sm">
              {synopsis.genre}
            </span>
          )}
          {synopsis.mood && (
            <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-sm">
              {synopsis.mood}
            </span>
          )}
          {synopsis.themes?.map(theme => (
            <span key={theme} className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-sm">
              {theme}
            </span>
          ))}
        </div>

        {/* Refine with AI - matches existing pattern */}
        <div className="mt-6 pt-6 border-t border-slate-700">
          <h4 className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Refine with AI
          </h4>
          <p className="text-slate-500 text-xs mb-3">
            Type what you want to change. Example: "Make it darker and more suspenseful" or "Add a romantic subplot"
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={refinementPrompt}
              onChange={(e) => setRefinementPrompt(e.target.value)}
              placeholder="What would you like to change?"
              className="flex-1 px-4 py-2.5 bg-slate-900/50 border border-slate-600 rounded-xl
                       text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRefine();
                }
              }}
            />
            <button
              onClick={handleRefine}
              disabled={isRefining || !refinementPrompt.trim()}
              className="px-4 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50
                       text-white rounded-xl transition-colors flex items-center gap-2"
            >
              {isRefining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Outline Section */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-white">Chapter Outline</h3>
          <button
            onClick={handleGenerateOutline}
            disabled={generatingOutline}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              outline
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {generatingOutline ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : outline ? (
              <RefreshCw className="w-4 h-4" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {outline ? 'Regenerate Outline' : 'Generate Outline'}
          </button>
        </div>

        {!outline ? (
          <div className="text-center py-8 text-slate-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No outline yet. Click "Generate Outline" to create a chapter structure.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {outline.chapters?.map((chapter, index) => (
              <ChapterCard
                key={index}
                chapter={chapter}
                chapterNumber={index + 1}
                isExpanded={expandedChapters.has(index + 1)}
                onToggleExpand={() => toggleChapterExpanded(index + 1)}
                beats={chapterBeats[index + 1] || []}
                isGeneratingBeats={generatingBeats[index + 1]}
                onGenerateBeats={() => handleGenerateBeats(index + 1)}
                onUpdate={(updated) => handleUpdateChapter(index, updated)}
                onDelete={() => handleDeleteChapter(index)}
                onAddChapterAfter={() => handleAddChapter(index + 1)}
                characters={characters}
                locations={locations}
                // Event linking props
                libraryEvents={events || []}
                linkedEventIds={chapterEventLinks[index + 1] || []}
                onLinkEvents={handleLinkEventsToChapter}
                // Refine With AI props
                onRefineChapter={handleRefineChapter}
                isRefining={refiningChapter === index + 1}
                // Beat editing props
                onUpdateBeat={handleUpdateBeat}
                onRefineBeat={handleRefineBeat}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
