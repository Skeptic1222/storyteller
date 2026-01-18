/**
 * BeatsDisplay - Display and edit beats for a chapter
 *
 * Features:
 * - Collapsible beat details
 * - Inline editing of beat content
 * - Beat type badges with colors
 * - Character and location info
 * - Object linking for individual beats
 * - Refine With AI for individual beats
 * - Regenerate button
 */

import { useState } from 'react';
import {
  ChevronDown, ChevronUp, RefreshCw, Loader2, MapPin, Users, Sparkles,
  Edit3, Check, X, Link, Wand2, Calendar, Plus, Trash2
} from 'lucide-react';

// Beat type colors and labels
const BEAT_TYPES = {
  opening: { label: 'Opening', color: 'bg-green-500/20 text-green-300' },
  rising_action: { label: 'Rising Action', color: 'bg-blue-500/20 text-blue-300' },
  tension: { label: 'Tension', color: 'bg-orange-500/20 text-orange-300' },
  climax: { label: 'Climax', color: 'bg-red-500/20 text-red-300' },
  resolution: { label: 'Resolution', color: 'bg-purple-500/20 text-purple-300' },
  transition: { label: 'Transition', color: 'bg-slate-500/20 text-slate-300' },
  flashback: { label: 'Flashback', color: 'bg-amber-500/20 text-amber-300' },
  dialogue: { label: 'Dialogue', color: 'bg-cyan-500/20 text-cyan-300' },
  action: { label: 'Action', color: 'bg-rose-500/20 text-rose-300' },
  revelation: { label: 'Revelation', color: 'bg-yellow-500/20 text-yellow-300' },
  emotional: { label: 'Emotional', color: 'bg-pink-500/20 text-pink-300' },
  setup: { label: 'Setup', color: 'bg-indigo-500/20 text-indigo-300' }
};

const BEAT_TYPE_OPTIONS = Object.entries(BEAT_TYPES).map(([value, { label }]) => ({
  value,
  label
}));

export default function BeatsDisplay({
  beats,
  onRegenerate,
  isRegenerating,
  onUpdateBeat,
  onRefineBeat,
  libraryEvents = [],
  chapterNumber
}) {
  const [expandedBeats, setExpandedBeats] = useState(new Set());
  const [editingBeat, setEditingBeat] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [linkingBeat, setLinkingBeat] = useState(null);
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  const [refiningBeat, setRefiningBeat] = useState(null);
  const [refineInstructions, setRefineInstructions] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const toggleBeat = (beatNumber) => {
    setExpandedBeats(prev => {
      const next = new Set(prev);
      if (next.has(beatNumber)) {
        next.delete(beatNumber);
      } else {
        next.add(beatNumber);
      }
      return next;
    });
  };

  const getBeatTypeStyle = (type) => {
    const beatType = BEAT_TYPES[type?.toLowerCase()] || BEAT_TYPES.transition;
    return beatType;
  };

  // Edit functions
  const startEditing = (beat) => {
    setEditingBeat(beat.beat_number);
    setEditForm({
      summary: beat.summary || '',
      type: beat.type || 'transition',
      characters: beat.characters || [],
      location: beat.location || '',
      mood: beat.mood || '',
      dialogue_hint: beat.dialogue_hint || '',
      sensory_details: beat.sensory_details || ''
    });
  };

  const cancelEditing = () => {
    setEditingBeat(null);
    setEditForm({});
  };

  const saveEditing = (beat) => {
    if (onUpdateBeat) {
      onUpdateBeat(chapterNumber, beat.beat_number, {
        ...beat,
        ...editForm
      });
    }
    setEditingBeat(null);
    setEditForm({});
  };

  // Event linking functions
  const openEventLinking = (beat) => {
    setLinkingBeat(beat.beat_number);
    setSelectedEventIds([...(beat.linked_event_ids || [])]);
  };

  const toggleEventSelection = (eventId) => {
    if (selectedEventIds.includes(eventId)) {
      setSelectedEventIds(selectedEventIds.filter(id => id !== eventId));
    } else {
      setSelectedEventIds([...selectedEventIds, eventId]);
    }
  };

  const saveEventLinks = (beat) => {
    if (onUpdateBeat) {
      onUpdateBeat(chapterNumber, beat.beat_number, {
        ...beat,
        linked_event_ids: selectedEventIds
      });
    }
    setLinkingBeat(null);
    setSelectedEventIds([]);
  };

  // Refine With AI functions
  const openRefine = (beat) => {
    setRefiningBeat(beat.beat_number);
    setRefineInstructions('');
  };

  const handleRefine = async (beat) => {
    if (onRefineBeat && refineInstructions.trim()) {
      setIsRefining(true);
      try {
        await onRefineBeat(chapterNumber, beat.beat_number, refineInstructions);
      } finally {
        setIsRefining(false);
        setRefiningBeat(null);
        setRefineInstructions('');
      }
    }
  };

  // Get linked events for a beat
  const getLinkedEvents = (beat) => {
    const linkedIds = beat.linked_event_ids || [];
    return libraryEvents.filter(e => linkedIds.includes(e.id));
  };

  if (!beats || beats.length === 0) {
    return (
      <div className="text-center py-4 text-slate-400 text-sm">
        No beats generated yet.
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/50">
      <div className="flex items-center justify-between mb-3">
        <h6 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          Story Beats
        </h6>
        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-white
                   transition-colors disabled:opacity-50"
        >
          {isRegenerating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Regenerate All
        </button>
      </div>

      <div className="space-y-2">
        {beats.map((beat, index) => {
          const beatNumber = beat.beat_number || index + 1;
          const isExpanded = expandedBeats.has(beatNumber);
          const isEditing = editingBeat === beatNumber;
          const isLinking = linkingBeat === beatNumber;
          const isRefineOpen = refiningBeat === beatNumber;
          const typeStyle = getBeatTypeStyle(beat.type);
          const linkedEvents = getLinkedEvents(beat);

          return (
            <div
              key={beatNumber}
              className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden"
            >
              {/* Beat Header */}
              <div
                onClick={() => !isEditing && toggleBeat(beatNumber)}
                className={`flex items-center gap-3 p-3 transition-colors ${
                  !isEditing ? 'cursor-pointer hover:bg-slate-700/30' : ''
                }`}
              >
                <span className="text-xs font-medium text-slate-500 w-6">
                  #{beatNumber}
                </span>

                <span className={`px-2 py-0.5 rounded text-xs ${typeStyle.color}`}>
                  {typeStyle.label}
                </span>

                <p className="flex-1 text-sm text-slate-300 truncate">
                  {beat.summary}
                </p>

                {/* Linked events badge */}
                {linkedEvents.length > 0 && (
                  <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-xs flex items-center gap-1">
                    <Link className="w-3 h-3" />
                    {linkedEvents.length}
                  </span>
                )}

                <button
                  onClick={(e) => { e.stopPropagation(); toggleBeat(beatNumber); }}
                  className="p-1 text-slate-400"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-700/30 space-y-3">
                  {isEditing ? (
                    /* Edit Mode */
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Summary</label>
                        <textarea
                          value={editForm.summary}
                          onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                          rows={2}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-amber-500 resize-y"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Type</label>
                          <select
                            value={editForm.type}
                            onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                     text-white text-sm focus:outline-none focus:border-amber-500"
                          >
                            {BEAT_TYPE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Location</label>
                          <input
                            type="text"
                            value={editForm.location}
                            onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                     text-white text-sm focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Mood</label>
                        <input
                          type="text"
                          value={editForm.mood}
                          onChange={(e) => setEditForm({ ...editForm, mood: e.target.value })}
                          placeholder="e.g., Tense, Hopeful, Dark..."
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Dialogue Hint</label>
                        <input
                          type="text"
                          value={editForm.dialogue_hint}
                          onChange={(e) => setEditForm({ ...editForm, dialogue_hint: e.target.value })}
                          placeholder="e.g., Character reveals their secret"
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Sensory Details</label>
                        <input
                          type="text"
                          value={editForm.sensory_details}
                          onChange={(e) => setEditForm({ ...editForm, sensory_details: e.target.value })}
                          placeholder="e.g., Cold wind, distant thunder..."
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                   text-white text-sm focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          onClick={cancelEditing}
                          className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEditing(beat)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700
                                   text-white rounded-lg text-sm transition-colors"
                        >
                          <Check className="w-4 h-4" />
                          Save
                        </button>
                      </div>
                    </div>
                  ) : isLinking ? (
                    /* Event Linking Mode */
                    <div className="space-y-3">
                      <h6 className="text-sm font-medium text-cyan-300 flex items-center gap-2">
                        <Link className="w-4 h-4" />
                        Link Events to Beat #{beatNumber}
                      </h6>

                      {libraryEvents.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
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
                                <p className="text-sm text-slate-200">{event.title}</p>
                                {event.event_type && (
                                  <span className="text-xs text-slate-400">{event.event_type}</span>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 text-center py-2">
                          No events available to link.
                        </p>
                      )}

                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setLinkingBeat(null)}
                          className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEventLinks(beat)}
                          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm transition-colors"
                        >
                          Save Links ({selectedEventIds.length})
                        </button>
                      </div>
                    </div>
                  ) : isRefineOpen ? (
                    /* Refine With AI Mode */
                    <div className="space-y-3">
                      <h6 className="text-sm font-medium text-purple-300 flex items-center gap-2">
                        <Wand2 className="w-4 h-4" />
                        Refine Beat #{beatNumber} With AI
                      </h6>

                      <textarea
                        value={refineInstructions}
                        onChange={(e) => setRefineInstructions(e.target.value)}
                        placeholder="Enter instructions... e.g., 'Make this more suspenseful' or 'Add more sensory details'"
                        rows={2}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg
                                 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-y"
                      />

                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setRefiningBeat(null)}
                          className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRefine(beat)}
                          disabled={!refineInstructions.trim() || isRefining}
                          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700
                                   text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                          {isRefining ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Wand2 className="w-4 h-4" />
                          )}
                          {isRefining ? 'Refining...' : 'Refine'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View Mode */
                    <>
                      {/* Full summary */}
                      <p className="text-sm text-slate-300">{beat.summary}</p>

                      {/* Linked events */}
                      {linkedEvents.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-xs text-cyan-400 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Linked Events:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {linkedEvents.map(event => (
                              <span
                                key={event.id}
                                className="px-2 py-0.5 bg-cyan-500/10 text-cyan-300 rounded text-xs"
                              >
                                {event.title}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Meta info row */}
                      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                        {beat.characters?.length > 0 && (
                          <div className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {Array.isArray(beat.characters)
                              ? beat.characters.join(', ')
                              : beat.characters}
                          </div>
                        )}
                        {beat.location && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {beat.location}
                          </div>
                        )}
                        {beat.mood && (
                          <span className="px-2 py-0.5 bg-purple-500/10 text-purple-300 rounded">
                            {beat.mood}
                          </span>
                        )}
                      </div>

                      {/* Dialogue hint */}
                      {beat.dialogue_hint && (
                        <div className="text-xs">
                          <span className="text-slate-500">Dialogue hint: </span>
                          <span className="text-slate-400 italic">"{beat.dialogue_hint}"</span>
                        </div>
                      )}

                      {/* Sensory details */}
                      {beat.sensory_details && (
                        <div className="text-xs">
                          <span className="text-slate-500">Sensory: </span>
                          <span className="text-slate-400">{beat.sensory_details}</span>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/30">
                        <button
                          onClick={() => startEditing(beat)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-white
                                   bg-slate-700/50 hover:bg-slate-700 rounded transition-colors"
                        >
                          <Edit3 className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => openEventLinking(beat)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300
                                   bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors"
                        >
                          <Link className="w-3 h-3" />
                          Link Events
                        </button>
                        <button
                          onClick={() => openRefine(beat)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 hover:text-purple-300
                                   bg-purple-500/10 hover:bg-purple-500/20 rounded transition-colors"
                        >
                          <Wand2 className="w-3 h-3" />
                          Refine With AI
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
