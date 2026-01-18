/**
 * ChapterCard - Collapsible chapter card with inline beats display
 *
 * Features:
 * - Expandable/collapsible view
 * - Inline editing of chapter details
 * - Beats generation and display
 * - Add/delete chapter controls
 */

import { useState } from 'react';
import {
  ChevronDown, ChevronUp, ChevronRight, Plus, Trash2, Edit3, Check, X,
  Loader2, Zap, GripVertical, MapPin, Users, Sparkles, Link, Wand2, Calendar, Unlink
} from 'lucide-react';
import BeatsDisplay from './BeatsDisplay';

// End type options
const END_TYPES = [
  { value: 'cliffhanger', label: 'Cliffhanger' },
  { value: 'resolution', label: 'Resolution' },
  { value: 'revelation', label: 'Revelation' },
  { value: 'transition', label: 'Transition' },
  { value: 'continuation', label: 'Continuation' }
];

// Mood options
const MOODS = [
  'Tense', 'Hopeful', 'Dark', 'Mysterious', 'Action-packed', 'Emotional',
  'Suspenseful', 'Peaceful', 'Chaotic', 'Melancholic', 'Triumphant', 'Foreboding'
];

export default function ChapterCard({
  chapter,
  chapterNumber,
  isExpanded,
  onToggleExpand,
  beats,
  isGeneratingBeats,
  onGenerateBeats,
  onUpdate,
  onDelete,
  onAddChapterAfter,
  characters,
  locations,
  // New props for event linking and refinement
  libraryEvents = [],
  linkedEventIds = [],
  onLinkEvents,
  onRefineChapter,
  isRefining = false,
  // Props for beats
  onUpdateBeat,
  onRefineBeat
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [showBeats, setShowBeats] = useState(false);

  // Event linking state
  const [showEventLinking, setShowEventLinking] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState([]);

  // Refine With AI state
  const [showRefine, setShowRefine] = useState(false);
  const [refineInstructions, setRefineInstructions] = useState('');

  // Edit form state
  const [editTitle, setEditTitle] = useState(chapter.title || '');
  const [editSummary, setEditSummary] = useState(chapter.summary || '');
  const [editKeyEvents, setEditKeyEvents] = useState(chapter.key_events || []);
  const [editCharacters, setEditCharacters] = useState(chapter.characters_present || []);
  const [editLocation, setEditLocation] = useState(chapter.location || '');
  const [editMood, setEditMood] = useState(chapter.mood || '');
  const [editEndsWith, setEditEndsWith] = useState(chapter.ends_with || 'continuation');
  const [newEventText, setNewEventText] = useState('');

  const startEditing = () => {
    setEditTitle(chapter.title || '');
    setEditSummary(chapter.summary || '');
    setEditKeyEvents([...(chapter.key_events || [])]);
    setEditCharacters([...(chapter.characters_present || [])]);
    setEditLocation(chapter.location || '');
    setEditMood(chapter.mood || '');
    setEditEndsWith(chapter.ends_with || 'continuation');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveChanges = () => {
    onUpdate({
      ...chapter,
      title: editTitle,
      summary: editSummary,
      key_events: editKeyEvents,
      characters_present: editCharacters,
      location: editLocation,
      mood: editMood,
      ends_with: editEndsWith
    });
    setIsEditing(false);
  };

  const addKeyEvent = () => {
    if (newEventText.trim()) {
      setEditKeyEvents([...editKeyEvents, newEventText.trim()]);
      setNewEventText('');
    }
  };

  const removeKeyEvent = (index) => {
    setEditKeyEvents(editKeyEvents.filter((_, i) => i !== index));
  };

  const toggleCharacter = (charName) => {
    if (editCharacters.includes(charName)) {
      setEditCharacters(editCharacters.filter(c => c !== charName));
    } else {
      setEditCharacters([...editCharacters, charName]);
    }
  };

  // Event linking functions
  const openEventLinking = () => {
    setSelectedEventIds([...linkedEventIds]);
    setShowEventLinking(true);
  };

  const toggleEventSelection = (eventId) => {
    if (selectedEventIds.includes(eventId)) {
      setSelectedEventIds(selectedEventIds.filter(id => id !== eventId));
    } else {
      setSelectedEventIds([...selectedEventIds, eventId]);
    }
  };

  const saveEventLinks = () => {
    if (onLinkEvents) {
      onLinkEvents(chapterNumber, selectedEventIds);
    }
    setShowEventLinking(false);
  };

  // Get linked events data
  const linkedEvents = libraryEvents.filter(e => linkedEventIds.includes(e.id));

  // Refine With AI functions
  const handleRefine = () => {
    if (onRefineChapter && refineInstructions.trim()) {
      onRefineChapter(chapterNumber, refineInstructions);
      setRefineInstructions('');
      setShowRefine(false);
    }
  };

  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-700/50 overflow-hidden">
      {/* Chapter Header - Always visible */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-800/30 transition-colors"
        onClick={() => !isEditing && onToggleExpand()}
      >
        <div className="flex items-center gap-2 text-slate-400">
          <GripVertical className="w-4 h-4 opacity-50" />
          <span className="text-sm font-medium text-amber-400">
            Chapter {chapterNumber}
          </span>
        </div>

        <h4 className="flex-1 font-medium text-white">{chapter.title}</h4>

        {/* Quick badges */}
        <div className="flex items-center gap-2">
          {chapter.mood && (
            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs">
              {chapter.mood}
            </span>
          )}
          {beats.length > 0 && (
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
              {beats.length} beats
            </span>
          )}
          {chapter.ends_with && (
            <span className={`px-2 py-0.5 rounded text-xs ${
              chapter.ends_with === 'cliffhanger' ? 'bg-red-500/20 text-red-300' :
              chapter.ends_with === 'revelation' ? 'bg-amber-500/20 text-amber-300' :
              'bg-slate-500/20 text-slate-300'
            }`}>
              {chapter.ends_with}
            </span>
          )}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          className="p-1 text-slate-400 hover:text-white transition-colors"
        >
          {isExpanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-slate-700/50">
          {isEditing ? (
            /* Edit Mode */
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg
                           text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Summary</label>
                <textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg
                           text-white focus:outline-none focus:border-amber-500 resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Key Events</label>
                <div className="space-y-2 mb-2">
                  {editKeyEvents.map((event, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-slate-300 bg-slate-800 px-3 py-1.5 rounded">
                        {event}
                      </span>
                      <button
                        onClick={() => removeKeyEvent(idx)}
                        className="p-1 text-red-400 hover:text-red-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newEventText}
                    onChange={(e) => setNewEventText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyEvent())}
                    placeholder="Add key event..."
                    className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg
                             text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={addKeyEvent}
                    disabled={!newEventText.trim()}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg
                             disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Characters Present</label>
                <div className="flex flex-wrap gap-2">
                  {characters?.map(char => (
                    <button
                      key={char.id}
                      onClick={() => toggleCharacter(char.name)}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        editCharacters.includes(char.name)
                          ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      {char.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Location</label>
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    placeholder="Chapter location..."
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg
                             text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Mood</label>
                  <select
                    value={editMood}
                    onChange={(e) => setEditMood(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg
                             text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Select mood...</option>
                    {MOODS.map(m => (
                      <option key={m} value={m.toLowerCase()}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Ends With</label>
                  <select
                    value={editEndsWith}
                    onChange={(e) => setEditEndsWith(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg
                             text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    {END_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveChanges}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700
                           text-white rounded-lg transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            </div>
          ) : (
            /* View Mode */
            <div className="p-4 space-y-4">
              {/* Summary */}
              <div>
                <p className="text-slate-300">{chapter.summary}</p>
              </div>

              {/* Key Events */}
              {chapter.key_events?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-medium text-slate-400">Key Events</h5>
                    <button
                      onClick={openEventLinking}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300
                               bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors"
                    >
                      <Link className="w-3 h-3" />
                      Link Events ({linkedEventIds.length})
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {chapter.key_events.map((event, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-slate-300">
                        <ChevronRight className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        {event}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Linked Library Events */}
              {linkedEvents.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700/30">
                  <h5 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Linked Events from Timeline
                  </h5>
                  <div className="space-y-2">
                    {linkedEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-2 p-2 bg-cyan-500/10 rounded-lg">
                        <Link className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-cyan-300 font-medium">{event.title}</p>
                          {event.description && (
                            <p className="text-xs text-slate-400 line-clamp-2">{event.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta info */}
              <div className="flex flex-wrap gap-4 text-sm text-slate-400">
                {chapter.characters_present?.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {chapter.characters_present.join(', ')}
                  </div>
                )}
                {chapter.location && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {chapter.location}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                <div className="flex items-center gap-2">
                  <button
                    onClick={startEditing}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600
                             text-slate-300 rounded-lg text-sm transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={onDelete}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20
                             text-red-400 rounded-lg text-sm transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Beats toggle/generate */}
                  {beats.length > 0 ? (
                    <button
                      onClick={() => setShowBeats(!showBeats)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30
                               text-blue-300 rounded-lg text-sm transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      {showBeats ? 'Hide' : 'Show'} Beats ({beats.length})
                    </button>
                  ) : (
                    <button
                      onClick={onGenerateBeats}
                      disabled={isGeneratingBeats}
                      className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30
                               text-purple-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {isGeneratingBeats ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4" />
                      )}
                      Generate Beats
                    </button>
                  )}
                </div>
              </div>

              {/* Beats Display */}
              {showBeats && beats.length > 0 && (
                <BeatsDisplay
                  beats={beats}
                  onRegenerate={onGenerateBeats}
                  isRegenerating={isGeneratingBeats}
                  onUpdateBeat={onUpdateBeat}
                  onRefineBeat={onRefineBeat}
                  libraryEvents={libraryEvents}
                  chapterNumber={chapterNumber}
                />
              )}

              {/* Event Linking UI */}
              {showEventLinking && (
                <div className="mt-4 p-4 bg-slate-800/50 rounded-lg border border-cyan-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <h6 className="text-sm font-medium text-cyan-300 flex items-center gap-2">
                      <Link className="w-4 h-4" />
                      Link Timeline Events to Chapter {chapterNumber}
                    </h6>
                    <button
                      onClick={() => setShowEventLinking(false)}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {libraryEvents.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto mb-3">
                      {libraryEvents.map((event) => (
                        <label
                          key={event.id}
                          className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                            selectedEventIds.includes(event.id)
                              ? 'bg-cyan-500/20 border border-cyan-500/50'
                              : 'bg-slate-700/30 hover:bg-slate-700/50 border border-transparent'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedEventIds.includes(event.id)}
                            onChange={() => toggleEventSelection(event.id)}
                            className="mt-1 rounded border-slate-500 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-200 font-medium">{event.title}</p>
                            {event.description && (
                              <p className="text-xs text-slate-400 line-clamp-2">{event.description}</p>
                            )}
                            {event.event_type && (
                              <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-slate-600/50 text-slate-300 rounded">
                                {event.event_type}
                              </span>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 text-center py-4">
                      No events in the library. Add events to link them to chapters.
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowEventLinking(false)}
                      className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEventLinks}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm transition-colors"
                    >
                      Save Links ({selectedEventIds.length})
                    </button>
                  </div>
                </div>
              )}

              {/* Refine With AI */}
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <button
                  onClick={() => setShowRefine(!showRefine)}
                  className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                >
                  <Wand2 className="w-4 h-4" />
                  {showRefine ? 'Hide' : 'Refine Chapter With AI'}
                </button>

                {showRefine && (
                  <div className="mt-3 space-y-3">
                    <textarea
                      value={refineInstructions}
                      onChange={(e) => setRefineInstructions(e.target.value)}
                      placeholder="Enter instructions for refining this chapter... e.g., 'Add more tension to the ending' or 'Include a scene with the villain'"
                      rows={3}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg
                               text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-y"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleRefine}
                        disabled={!refineInstructions.trim() || isRefining}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700
                                 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        {isRefining ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        {isRefining ? 'Refining...' : 'Refine Chapter'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add chapter after button */}
      {isExpanded && (
        <button
          onClick={onAddChapterAfter}
          className="w-full py-2 border-t border-dashed border-slate-700 hover:border-slate-600
                   text-slate-500 hover:text-slate-400 text-sm transition-colors"
        >
          <Plus className="w-4 h-4 inline mr-1" />
          Add Chapter After
        </button>
      )}
    </div>
  );
}
