/**
 * Story Bible Page - Advanced story planning and world building
 * Tab-based interface for managing characters, world, locations, lore, and synopsis
 * Supports collaborative AI refinement and outline generation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Globe, MapPin, BookOpen, FileText, Plus, Search,
  Upload, Sparkles, ChevronRight, ChevronDown, ChevronUp, Edit3, Trash2, Star,
  Link2, Send, Loader2, RefreshCw, List, X, Check, AlertCircle, FileUp, Wand2, Zap,
  Sword, Building2, Flame, Calendar
} from 'lucide-react';
import { apiCall, API_BASE } from '../config';
import { getStoredToken } from '../utils/authToken';
import UserProfile from '../components/UserProfile';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import ExtractionProgress from '../components/story-bible/ExtractionProgress';
import ImportPreview from '../components/story-bible/ImportPreview';
import SynopsisEditor from '../components/story-bible/SynopsisEditor';
import BrainDump from '../components/story-bible/BrainDump';

// Tab definitions - Brain Dump first, then content tabs, Synopsis last
const TABS = [
  { id: 'brain-dump', label: 'Brain Dump', icon: Wand2, color: 'text-purple-400', bgColor: 'bg-purple-500/20', countKey: null },
  { id: 'characters', label: 'Characters', icon: Users, color: 'text-blue-400', bgColor: 'bg-blue-500/20', countKey: 'totalCharacters' },
  { id: 'events', label: 'Events', icon: Calendar, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', countKey: 'totalEvents' },
  { id: 'world', label: 'World', icon: Globe, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', countKey: null },
  { id: 'locations', label: 'Locations', icon: MapPin, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', countKey: 'totalLocations' },
  { id: 'items', label: 'Items', icon: Sword, color: 'text-orange-400', bgColor: 'bg-orange-500/20', countKey: 'totalItems' },
  { id: 'factions', label: 'Factions', icon: Building2, color: 'text-rose-400', bgColor: 'bg-rose-500/20', countKey: 'totalFactions' },
  { id: 'abilities', label: 'Abilities', icon: Flame, color: 'text-red-400', bgColor: 'bg-red-500/20', countKey: 'totalAbilities' },
  { id: 'lore', label: 'Lore', icon: BookOpen, color: 'text-purple-400', bgColor: 'bg-purple-500/20', countKey: 'totalLore' },
  { id: 'synopsis', label: 'Synopsis / Outline', icon: FileText, color: 'text-amber-400', bgColor: 'bg-amber-500/20', countKey: null }
];

// Empty state messages per tab
const EMPTY_STATES = {
  characters: {
    icon: Users,
    title: 'No Characters Yet',
    description: 'Create your first character to start building your story cast. Characters can be reused across multiple stories.',
    buttonText: 'Create Character'
  },
  events: {
    icon: Calendar,
    title: 'No Events Yet',
    description: 'Add planned story moments - confrontations, revelations, escapes, battles. Events are scenes that should happen during your story.',
    buttonText: 'Create Event'
  },
  world: {
    icon: Globe,
    title: 'No World Defined',
    description: 'Define your story world with its rules, setting, and atmosphere. The world provides consistent context for all your stories.',
    buttonText: 'Create World'
  },
  locations: {
    icon: MapPin,
    title: 'No Locations Yet',
    description: 'Add locations within your world - cities, buildings, rooms. Locations can be hierarchical (City → District → Building).',
    buttonText: 'Create Location'
  },
  items: {
    icon: Sword,
    title: 'No Items Yet',
    description: 'Add weapons, vehicles, artifacts, and other objects. Items can be linked to characters who own or use them.',
    buttonText: 'Create Item'
  },
  factions: {
    icon: Building2,
    title: 'No Factions Yet',
    description: 'Create organizations, guilds, kingdoms, and groups. Track membership, hierarchy, and faction relationships.',
    buttonText: 'Create Faction'
  },
  abilities: {
    icon: Flame,
    title: 'No Abilities Yet',
    description: 'Add spells, skills, powers, and special abilities for fantasy and RPG content. Link abilities to characters.',
    buttonText: 'Create Ability'
  },
  lore: {
    icon: BookOpen,
    title: 'No Lore Entries Yet',
    description: 'Add history, customs, rules, and legends. Lore entries provide knowledge and context for story generation.',
    buttonText: 'Create Lore Entry'
  },
  synopsis: {
    icon: FileText,
    title: 'No Synopsis Yet',
    description: 'Create your story synopsis and generate a chapter outline. Use your characters, world, and lore to build a complete story structure.',
    buttonText: 'Create Synopsis'
  }
};

// Relationship types for character connections
const RELATIONSHIP_TYPES = [
  { value: 'married', label: 'Married' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'dating', label: 'Dating' },
  { value: 'ex', label: 'Ex-Partner' },
  { value: 'parent', label: 'Parent', directional: true, reverse: 'child' },
  { value: 'child', label: 'Child', directional: true, reverse: 'parent' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'friend', label: 'Friend' },
  { value: 'best_friend', label: 'Best Friend' },
  { value: 'enemy', label: 'Enemy' },
  { value: 'rival', label: 'Rival' },
  { value: 'mentor', label: 'Mentor', directional: true, reverse: 'student' },
  { value: 'student', label: 'Student', directional: true, reverse: 'mentor' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'boss', label: 'Boss', directional: true, reverse: 'employee' },
  { value: 'ally', label: 'Ally' },
  { value: 'acquaintance', label: 'Acquaintance' }
];

export default function StoryBible() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { socket } = useSocket();
  const [activeTab, setActiveTab] = useState('brain-dump');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Data for each tab
  const [characters, setCharacters] = useState([]);
  const [events, setEvents] = useState([]);
  const [world, setWorld] = useState(null);
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [factions, setFactions] = useState([]);
  const [abilities, setAbilities] = useState([]);
  const [lore, setLore] = useState([]);
  const [synopses, setSynopses] = useState([]);
  const [connections, setConnections] = useState([]);

  // UI State
  const [selectedItem, setSelectedItem] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [expandedOutline, setExpandedOutline] = useState(null);

  // Bulk Import State
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportFile, setBulkImportFile] = useState(null);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const fileInputRef = useRef(null);
  const getAuthHeaders = useCallback(() => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Advanced Multi-Agent Import State
  const [useAdvancedImport, setUseAdvancedImport] = useState(true); // Default to advanced
  const [extractionRoomId, setExtractionRoomId] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [extractedLibraryId, setExtractedLibraryId] = useState(null);
  const [isSavingExtracted, setIsSavingExtracted] = useState(false);

  // Import creates new library - prompt for name
  const [showImportLibraryPrompt, setShowImportLibraryPrompt] = useState(false);
  const [importLibraryName, setImportLibraryName] = useState('');

  // Stats
  const [stats, setStats] = useState({
    totalCharacters: 0,
    totalLocations: 0,
    totalItems: 0,
    totalFactions: 0,
    totalAbilities: 0,
    totalLore: 0,
    totalSynopses: 0
  });

  // Library Management State
  const [allLibraries, setAllLibraries] = useState([]);
  const [currentLibraryId, setCurrentLibraryId] = useState(null);
  const [currentLibrary, setCurrentLibrary] = useState(null);
  const [isEditingLibraryName, setIsEditingLibraryName] = useState(false);
  const [editedLibraryName, setEditedLibraryName] = useState('');
  const [showCreateLibrary, setShowCreateLibrary] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const libraryMenuRef = useRef(null);

  // Close library menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (libraryMenuRef.current && !libraryMenuRef.current.contains(event.target)) {
        setShowLibraryMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchAllLibraries();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // When currentLibraryId changes, fetch that library's data
  useEffect(() => {
    if (currentLibraryId) {
      fetchLibraryData(currentLibraryId);
    }
  }, [currentLibraryId]);

  // Fetch all libraries for the user
  const fetchAllLibraries = async () => {
    try {
      const res = await apiCall('/story-bible/libraries');
      if (res.ok) {
        const data = await res.json();
        setAllLibraries(data.libraries || []);

        // If we have libraries and no current selection, select the first one
        if (data.libraries?.length > 0 && !currentLibraryId) {
          setCurrentLibraryId(data.libraries[0].id);
          setCurrentLibrary(data.libraries[0]);
        } else if (!data.libraries || data.libraries.length === 0) {
          // No libraries exist - set loading to false so page can render empty state
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Failed to fetch libraries:', error);
      setLoading(false);
    }
  };

  // Create a new library
  const handleCreateLibrary = async () => {
    if (!newLibraryName.trim()) return;

    try {
      const res = await apiCall('/story-bible/libraries', {
        method: 'POST',
        body: JSON.stringify({ name: newLibraryName.trim() })
      });

      if (res.ok) {
        const data = await res.json();
        setAllLibraries(prev => [data.library, ...prev]);
        setCurrentLibraryId(data.library.id);
        setCurrentLibrary(data.library);
        setNewLibraryName('');
        setShowCreateLibrary(false);
      }
    } catch (error) {
      console.error('Failed to create library:', error);
    }
  };

  // Rename current library
  const handleRenameLibrary = async () => {
    if (!editedLibraryName.trim() || !currentLibraryId) return;

    try {
      const res = await apiCall(`/story-bible/libraries/${currentLibraryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editedLibraryName.trim() })
      });

      if (res.ok) {
        const data = await res.json();
        setCurrentLibrary(data.library);
        setAllLibraries(prev => prev.map(lib =>
          lib.id === currentLibraryId ? data.library : lib
        ));
        setIsEditingLibraryName(false);
      }
    } catch (error) {
      console.error('Failed to rename library:', error);
    }
  };

  // Delete current library
  const handleDeleteLibrary = async () => {
    if (!currentLibraryId) return;

    if (!confirm(`Delete "${currentLibrary?.name}"? This will permanently delete all characters, locations, lore, and stories in this library.`)) {
      return;
    }

    try {
      const res = await apiCall(`/story-bible/libraries/${currentLibraryId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        const data = await res.json();

        // If a new library was auto-created (deleted last library), switch to it
        if (data.newLibrary) {
          setAllLibraries([data.newLibrary]);
          setCurrentLibraryId(data.newLibrary.id);
          setCurrentLibrary(data.newLibrary);
        } else {
          // Switch to another existing library
          const remainingLibraries = allLibraries.filter(lib => lib.id !== currentLibraryId);
          setAllLibraries(remainingLibraries);
          if (remainingLibraries.length > 0) {
            setCurrentLibraryId(remainingLibraries[0].id);
            setCurrentLibrary(remainingLibraries[0]);
          }
        }
        setShowLibraryMenu(false);
      }
    } catch (error) {
      console.error('Failed to delete library:', error);
    }
  };

  // Switch to a different library
  const handleSwitchLibrary = (library) => {
    setCurrentLibraryId(library.id);
    setCurrentLibrary(library);
    setShowLibraryMenu(false);
    setSelectedItem(null); // Clear selection when switching
  };

  const fetchLibraryData = async (libraryId = currentLibraryId) => {
    if (!libraryId) return;
    setLoading(true);
    try {
      // Fetch library overview with counts
      const libraryRes = await apiCall(`/story-bible?library_id=${libraryId}`);
      const libraryData = await libraryRes.json();

      // Fetch data for each tab - pass library_id to scope to specific library
      const [charactersRes, eventsRes, worldsRes, locationsRes, itemsRes, factionsRes, abilitiesRes, loreRes, synopsisRes, connectionsRes] = await Promise.all([
        apiCall(`/story-bible/characters?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/events?library_id=${libraryId}&order_by=chronological`).then(r => r.json()),
        apiCall(`/story-bible/worlds?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/locations?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/items?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/factions?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/abilities?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/lore?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/synopsis?library_id=${libraryId}`).then(r => r.json()),
        apiCall(`/story-bible/connections?library_id=${libraryId}`).then(r => r.json())
      ]);

      setCharacters(charactersRes.characters || []);
      setEvents(eventsRes.events || []);
      // For world, we use the first one (singular world concept)
      setWorld(worldsRes.worlds?.[0] || null);
      setLocations(locationsRes.locations || []);
      setItems(itemsRes.items || []);
      setFactions(factionsRes.factions || []);
      setAbilities(abilitiesRes.abilities || []);
      setLore(loreRes.lore || []);
      setSynopses(synopsisRes.synopsis || []);
      setConnections(connectionsRes.connections || []);

      const counts = libraryData.counts || {};
      setStats({
        totalCharacters: parseInt(counts.characters) || 0,
        totalEvents: parseInt(eventsRes.count) || 0,
        totalLocations: parseInt(locationsRes.count) || 0,
        totalItems: parseInt(counts.items) || 0,
        totalFactions: parseInt(counts.factions) || 0,
        totalAbilities: parseInt(abilitiesRes.count) || 0,
        totalLore: parseInt(counts.lore) || 0,
        totalSynopses: parseInt(counts.synopsis) || 0
      });
    } catch (error) {
      console.error('Failed to fetch library data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActiveData = () => {
    switch (activeTab) {
      case 'characters': return characters;
      case 'events': return events;
      case 'world': return world ? [world] : [];
      case 'locations': return locations;
      case 'items': return items;
      case 'factions': return factions;
      case 'abilities': return abilities;
      case 'lore': return lore;
      case 'synopsis': return synopses;
      default: return [];
    }
  };

  const getFilteredData = () => {
    const data = getActiveData();
    if (!searchQuery) return data;
    return data.filter(item =>
      item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  // CRUD Operations
  const handleCreate = async (data) => {
    try {
      const endpoints = {
        characters: '/story-bible/characters',
        events: '/story-bible/events',
        world: '/story-bible/worlds',
        locations: '/story-bible/locations',
        items: '/story-bible/items',
        factions: '/story-bible/factions',
        abilities: '/story-bible/abilities',
        lore: '/story-bible/lore',
        synopsis: '/story-bible/synopsis'
      };

      // Include library_id in the request body
      const dataWithLibrary = {
        ...data,
        library_id: currentLibraryId
      };

      const res = await apiCall(endpoints[activeTab], {
        method: 'POST',
        body: JSON.stringify(dataWithLibrary)
      });

      if (res.ok) {
        await fetchLibraryData();
        setShowCreateModal(false);
      }
    } catch (error) {
      console.error('Failed to create:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this?')) return;

    try {
      const endpoints = {
        characters: `/story-bible/characters/${id}`,
        events: `/story-bible/events/${id}`,
        world: `/story-bible/worlds/${id}`,
        locations: `/story-bible/locations/${id}`,
        items: `/story-bible/items/${id}`,
        factions: `/story-bible/factions/${id}`,
        abilities: `/story-bible/abilities/${id}`,
        lore: `/story-bible/lore/${id}`,
        synopsis: `/story-bible/synopsis/${id}`
      };

      const res = await apiCall(endpoints[activeTab], { method: 'DELETE' });
      if (res.ok) {
        setSelectedItem(null);
        await fetchLibraryData();
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  // Move event up or down in chronological order
  const handleMoveEvent = async (eventId, direction) => {
    const currentIndex = events.findIndex(e => e.id === eventId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= events.length) return;

    // Create new order with swapped items
    const newEvents = [...events];
    [newEvents[currentIndex], newEvents[newIndex]] = [newEvents[newIndex], newEvents[currentIndex]];
    const eventIds = newEvents.map(e => e.id);

    try {
      const res = await apiCall('/story-bible/events/reorder', {
        method: 'POST',
        body: JSON.stringify({ library_id: currentLibraryId, event_ids: eventIds })
      });

      if (res.ok) {
        setEvents(newEvents);
      }
    } catch (error) {
      console.error('Failed to reorder events:', error);
    }
  };

  const handleRefine = async (entityType, entityId) => {
    if (!refinementPrompt.trim()) return;

    setIsRefining(true);
    try {
      const res = await apiCall(`/story-bible/refine/${entityType}/${entityId}`, {
        method: 'POST',
        body: JSON.stringify({ prompt: refinementPrompt })
      });

      if (res.ok) {
        const result = await res.json();
        setRefinementPrompt('');
        await fetchLibraryData();
        // Update selected item with new data
        if (result[entityType]) {
          setSelectedItem(result[entityType]);
        }
      }
    } catch (error) {
      console.error('Failed to refine:', error);
    } finally {
      setIsRefining(false);
    }
  };

  const handleGenerateOutline = async (synopsisId) => {
    setIsGeneratingOutline(true);
    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsisId}/generate-outline`, {
        method: 'POST',
        body: JSON.stringify({ chapter_count: 10 })
      });

      if (res.ok) {
        const result = await res.json();
        // Update the selected item with the new outline
        setSelectedItem(prev => ({
          ...prev,
          outline_json: result.outline,
          is_outline_generated: true
        }));
        setExpandedOutline(result.outline);
        // Refresh all data in background
        fetchLibraryData();
      }
    } catch (error) {
      console.error('Failed to generate outline:', error);
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  // Outline editing functions
  const handleUpdateOutline = async (synopsisId, action, data) => {
    try {
      const res = await apiCall(`/story-bible/synopsis/${synopsisId}/outline`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...data })
      });

      if (res.ok) {
        const result = await res.json();
        // Update the selected item with the new outline
        setSelectedItem(prev => ({
          ...prev,
          outline_json: result.outline
        }));
        // Also update in synopses list
        setSynopses(prev => prev.map(s =>
          s.id === synopsisId ? { ...s, outline_json: result.outline } : s
        ));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update outline:', error);
      return false;
    }
  };

  const handleCreateConnection = async (data) => {
    try {
      const res = await apiCall('/story-bible/connections', {
        method: 'POST',
        body: JSON.stringify(data)
      });

      if (res.ok) {
        setShowConnectionModal(false);
        await fetchLibraryData();
      }
    } catch (error) {
      console.error('Failed to create connection:', error);
    }
  };

  // Bulk Import Functions
  const handleBulkImportText = async (autoCreate = false) => {
    if (!bulkImportText.trim()) return;

    setIsProcessingImport(true);
    try {
      const res = await apiCall('/story-bible/bulk-import', {
        method: 'POST',
        body: JSON.stringify({
          text: bulkImportText,
          auto_create: autoCreate
        })
      });

      if (res.ok) {
        const result = await res.json();
        if (autoCreate) {
          await fetchLibraryData();
          setShowBulkImport(false);
          setBulkImportText('');
          setImportPreview(null);
        } else {
          setImportPreview(result);
        }
      }
    } catch (error) {
      console.error('Failed to process bulk import:', error);
    } finally {
      setIsProcessingImport(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBulkImportFile(file);
    setIsProcessingImport(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('auto_create', 'false');

      // Use fetch directly for FormData (apiCall adds JSON headers)
      const res = await fetch(`${API_BASE}/story-bible/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (res.ok) {
        const result = await res.json();
        setImportPreview(result);
      } else {
        console.error('File upload failed');
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
    } finally {
      setIsProcessingImport(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;

    setIsProcessingImport(true);
    try {
      // If we have a file, re-upload with auto_create
      if (bulkImportFile) {
        const formData = new FormData();
        formData.append('file', bulkImportFile);
        formData.append('auto_create', 'true');

        const res = await fetch(`${API_BASE}/story-bible/upload`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData
        });

        if (res.ok) {
          await fetchLibraryData();
          setShowBulkImport(false);
          setBulkImportFile(null);
          setImportPreview(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      } else {
        // Text-based import
        await handleBulkImportText(true);
      }
    } catch (error) {
      console.error('Failed to confirm import:', error);
    } finally {
      setIsProcessingImport(false);
    }
  };

  // Advanced Multi-Agent Import Functions

  // Step 1: Show prompt to name the new library
  const handleStartImport = () => {
    if (!bulkImportText.trim()) return;
    // Generate a default name from first line or "Imported Story"
    const firstLine = bulkImportText.trim().split('\n')[0].substring(0, 50);
    setImportLibraryName(firstLine || 'Imported Story');
    setShowImportLibraryPrompt(true);
  };

  // Step 2: Create library and start import
  const handleAdvancedImport = async () => {
    if (!bulkImportText.trim() || !importLibraryName.trim()) return;

    setShowImportLibraryPrompt(false);
    setIsProcessingImport(true);
    setExtractedData(null);

    try {
      // Create new library for this import
      const createRes = await apiCall('/story-bible/libraries', {
        method: 'POST',
        body: JSON.stringify({ name: importLibraryName.trim() })
      });

      if (!createRes.ok) {
        console.error('Failed to create library for import');
        setIsProcessingImport(false);
        return;
      }

      const { library: newLibrary } = await createRes.json();

      // Add to libraries list and switch to it
      setAllLibraries(prev => [newLibrary, ...prev]);
      setCurrentLibraryId(newLibrary.id);
      setCurrentLibrary(newLibrary);

      // Now start the extraction into this new library
      const res = await apiCall('/story-bible/bulk-import-advanced', {
        method: 'POST',
        body: JSON.stringify({
          text: bulkImportText,
          library_id: newLibrary.id
        })
      });

      if (res.ok) {
        const result = await res.json();
        setExtractionRoomId(result.roomId);
        setExtractedLibraryId(newLibrary.id);
      } else {
        console.error('Failed to start advanced import');
        setIsProcessingImport(false);
      }
    } catch (error) {
      console.error('Failed to start advanced import:', error);
      setIsProcessingImport(false);
    }
  };

  const handleExtractionComplete = async (data) => {
    console.log('[StoryBible] Extraction complete, fetching results');
    setIsProcessingImport(false);

    // Fetch the full extracted data
    try {
      const res = await apiCall(`/story-bible/bulk-import-advanced/${extractionRoomId}`);
      if (res.ok) {
        const result = await res.json();
        setExtractedData(result.data);
        setExtractedLibraryId(result.libraryId);
      }
    } catch (error) {
      console.error('Failed to fetch extraction results:', error);
    }
  };

  const handleExtractionError = (error) => {
    console.error('[StoryBible] Extraction error:', error);
    setIsProcessingImport(false);
    setExtractionRoomId(null);
  };

  const handleSaveExtracted = async (editedData) => {
    setIsSavingExtracted(true);
    try {
      const res = await apiCall('/story-bible/bulk-import-advanced/save', {
        method: 'POST',
        body: JSON.stringify({
          libraryId: extractedLibraryId,
          data: editedData
        })
      });

      if (res.ok) {
        await fetchLibraryData();
        // Reset all import state
        setShowBulkImport(false);
        setBulkImportText('');
        setExtractedData(null);
        setExtractionRoomId(null);
        setExtractedLibraryId(null);
      }
    } catch (error) {
      console.error('Failed to save extracted data:', error);
    } finally {
      setIsSavingExtracted(false);
    }
  };

  const handleCancelExtraction = () => {
    setExtractedData(null);
    setExtractionRoomId(null);
    setExtractedLibraryId(null);
    setIsProcessingImport(false);
  };

  const emptyState = EMPTY_STATES[activeTab];
  const filteredData = getFilteredData();
  const EmptyIcon = emptyState?.icon || FileText;

  // Get connections for a character
  const getCharacterConnections = (characterId) => {
    return connections.filter(c =>
      c.character_a_id === characterId || c.character_b_id === characterId
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8 bg-slate-800 rounded-2xl border border-slate-700 max-w-md">
          <Sparkles className="w-12 h-12 text-golden-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-100 mb-2">Sign In Required</h2>
          <p className="text-slate-400 mb-6">
            Create an account to build your personal Story Bible - a collection of characters, worlds, and lore you can reuse across stories.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-golden-400 hover:bg-golden-500 text-slate-900 font-medium rounded-xl transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  // Empty state - no libraries exist yet
  if (!loading && allLibraries.length === 0) {
    return (
      <div className="min-h-screen pb-24">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center justify-between p-4 bg-slate-900/95 backdrop-blur border-b border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/configure')}
              className="p-2 rounded-full hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-300" />
            </button>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-400" />
              <h1 className="text-xl font-semibold text-purple-400">Story Bible</h1>
            </div>
          </div>
          <UserProfile />
        </header>

        {/* Create First Library */}
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center p-8 bg-slate-800 rounded-2xl border border-slate-700 max-w-lg">
            <BookOpen className="w-16 h-16 text-purple-400 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-slate-100 mb-2">Create Your First Story Bible</h2>
            <p className="text-slate-400 mb-6 leading-relaxed">
              A Story Bible is your personal collection of characters, worlds, locations, and lore
              that you can reuse across multiple stories. Create one to get started!
            </p>

            {showCreateLibrary ? (
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  value={newLibraryName}
                  onChange={(e) => setNewLibraryName(e.target.value)}
                  placeholder="Enter library name..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newLibraryName.trim()) handleCreateLibrary();
                    if (e.key === 'Escape') {
                      setShowCreateLibrary(false);
                      setNewLibraryName('');
                    }
                  }}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500 text-center"
                  autoFocus
                />
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={handleCreateLibrary}
                    disabled={!newLibraryName.trim()}
                    className="px-6 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
                  >
                    Create Library
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateLibrary(false);
                      setNewLibraryName('');
                    }}
                    className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreateLibrary(true)}
                className="px-8 py-3 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-xl transition-colors flex items-center gap-2 mx-auto"
              >
                <Plus className="w-5 h-5" />
                Create Story Bible
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between p-4 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/configure')}
            className="p-2 rounded-full hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </button>

          {/* Library Selector */}
          <div className="relative" ref={libraryMenuRef}>
            {isEditingLibraryName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedLibraryName}
                  onChange={(e) => setEditedLibraryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameLibrary();
                    if (e.key === 'Escape') setIsEditingLibraryName(false);
                  }}
                  className="px-2 py-1 bg-slate-800 border border-purple-500 rounded text-slate-100 text-lg font-semibold focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={handleRenameLibrary}
                  className="p-1 text-emerald-400 hover:text-emerald-300"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsEditingLibraryName(false)}
                  className="p-1 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLibraryMenu(!showLibraryMenu)}
                className="flex items-center gap-2 hover:bg-slate-800 rounded-lg px-2 py-1 transition-colors"
              >
                <BookOpen className="w-5 h-5 text-purple-400" />
                <div className="text-left">
                  <h1 className="text-xl font-semibold text-purple-400 flex items-center gap-1">
                    {currentLibrary?.name || 'Story Bible'}
                    <ChevronDown className={`w-4 h-4 transition-transform ${showLibraryMenu ? 'rotate-180' : ''}`} />
                  </h1>
                  <p className="text-slate-500 text-xs">
                    {allLibraries.length > 1 ? `${allLibraries.length} libraries` : 'Your story elements'}
                  </p>
                </div>
              </button>
            )}

            {/* Library Dropdown Menu */}
            {showLibraryMenu && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                {/* Create New Library */}
                {showCreateLibrary ? (
                  <div className="p-3 border-b border-slate-700">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newLibraryName}
                        onChange={(e) => setNewLibraryName(e.target.value)}
                        placeholder="New library name..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateLibrary();
                          if (e.key === 'Escape') setShowCreateLibrary(false);
                        }}
                        className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        autoFocus
                      />
                      <button
                        onClick={handleCreateLibrary}
                        disabled={!newLibraryName.trim()}
                        className="p-2 bg-purple-500 hover:bg-purple-600 disabled:bg-slate-700 text-white rounded-lg"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateLibrary(false);
                          setNewLibraryName('');
                        }}
                        className="p-2 text-slate-400 hover:text-slate-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreateLibrary(true)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-purple-400 hover:bg-slate-700 border-b border-slate-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create New Library</span>
                  </button>
                )}

                {/* Library List */}
                <div className="max-h-64 overflow-y-auto">
                  {allLibraries.map((lib) => (
                    <button
                      key={lib.id}
                      onClick={() => handleSwitchLibrary(lib)}
                      className={`w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700 transition-colors ${
                        lib.id === currentLibraryId ? 'bg-purple-500/10' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {lib.id === currentLibraryId && (
                          <Check className="w-4 h-4 text-purple-400" />
                        )}
                        <div className={`text-left ${lib.id !== currentLibraryId ? 'ml-7' : ''}`}>
                          <span className="text-slate-100 font-medium">{lib.name}</span>
                          <div className="text-xs text-slate-500">
                            {lib.character_count || 0} chars • {lib.synopsis_count || 0} stories
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Current Library Actions */}
                <div className="border-t border-slate-700 p-2 flex gap-2">
                  <button
                    onClick={() => {
                      setEditedLibraryName(currentLibrary?.name || '');
                      setIsEditingLibraryName(true);
                      setShowLibraryMenu(false);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    Rename
                  </button>
                  <button
                    onClick={handleDeleteLibrary}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchLibraryData()}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <UserProfile />
        </div>
      </header>

      {/* Tabs - compact, no icons, fits in one row */}
      <div className="px-2 pt-3">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-0.5 p-0.5 bg-slate-800/50 rounded-lg">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              const count = tab.countKey ? stats[tab.countKey] : null;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSelectedItem(null); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-700 text-slate-100 shadow-lg'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                  }`}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span className={`text-[10px] px-1 py-0.5 rounded ${
                      isActive ? 'bg-slate-600 text-slate-200' : 'bg-slate-700/50 text-slate-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Search and Actions - Hidden for brain-dump and synopsis tabs */}
      {activeTab !== 'brain-dump' && activeTab !== 'synopsis' && (
        <div className="px-4 py-4">
          <div className="max-w-4xl mx-auto flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder={`Search ${activeTab}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
              />
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="px-4">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
          ) : selectedItem ? (
            /* Detail View */
            <DetailView
              item={selectedItem}
              type={activeTab}
              onBack={() => setSelectedItem(null)}
              onDelete={() => handleDelete(selectedItem.id)}
              onRefine={handleRefine}
              refinementPrompt={refinementPrompt}
              setRefinementPrompt={setRefinementPrompt}
              isRefining={isRefining}
              connections={activeTab === 'characters' ? getCharacterConnections(selectedItem.id) : []}
              characters={characters}
              onAddConnection={() => setShowConnectionModal(true)}
              onGenerateOutline={activeTab === 'synopsis' ? () => handleGenerateOutline(selectedItem.id) : null}
              isGeneratingOutline={isGeneratingOutline}
              onUpdateOutline={activeTab === 'synopsis' ? (action, data) => handleUpdateOutline(selectedItem.id, action, data) : null}
              events={events}
              lore={lore}
              onRefreshData={() => fetchLibraryData(currentLibraryId)}
            />
          ) : activeTab === 'brain-dump' ? (
            /* Brain Dump - Advanced import tab */
            <BrainDump
              libraryId={currentLibraryId}
              libraryName={currentLibrary?.name || 'Library'}
              socket={socket}
              onExtractionComplete={(data) => {
                // Refresh data after extraction
                if (currentLibraryId) {
                  fetchLibraryData(currentLibraryId);
                }
              }}
              onDataRefresh={(libId) => {
                if (libId) {
                  fetchLibraryData(libId);
                }
              }}
            />
          ) : activeTab === 'synopsis' ? (
            /* Synopsis Editor - Single synopsis per library */
            <SynopsisEditor
              synopsis={synopses[0] || null}
              libraryId={currentLibraryId}
              libraryName={currentLibrary?.name || 'Library'}
              worldData={world}
              characters={characters}
              locations={locations}
              items={items}
              factions={factions}
              lore={lore}
              events={events}
              socket={socket}
              onSynopsisUpdate={(updated) => {
                setSynopses([updated]);
              }}
              onSynopsisCreate={(created) => {
                setSynopses([created]);
              }}
              onStartStory={(synopsisId) => {
                navigate(`/configure?outline=${synopsisId}&library=${currentLibraryId}`);
              }}
            />
          ) : filteredData.length === 0 ? (
            /* Empty State */
            <div className="text-center py-16 px-4">
              <div className="w-20 h-20 mx-auto mb-6 bg-slate-800 rounded-2xl flex items-center justify-center">
                <EmptyIcon className="w-10 h-10 text-slate-500" />
              </div>
              <h3 className="text-xl font-medium text-slate-100 mb-2">{emptyState.title}</h3>
              <p className="text-slate-400 max-w-md mx-auto mb-8">{emptyState.description}</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-xl transition-colors"
              >
                <Plus className="w-5 h-5" />
                {emptyState.buttonText}
              </button>

              {/* Quick Tips */}
              <QuickTips activeTab={activeTab} />
            </div>
          ) : (
            /* Item Grid - extra left padding for events to show order controls */
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${activeTab === 'events' ? 'pl-4' : ''}`}>
              {filteredData.map((item, index) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  type={activeTab}
                  onClick={() => setSelectedItem(item)}
                  connections={activeTab === 'characters' ? getCharacterConnections(item.id) : []}
                  orderIndex={activeTab === 'events' ? index : null}
                  totalItems={activeTab === 'events' ? filteredData.length : null}
                  onMoveUp={activeTab === 'events' ? () => handleMoveEvent(item.id, 'up') : null}
                  onMoveDown={activeTab === 'events' ? () => handleMoveEvent(item.id, 'down') : null}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Floating Action Button (Mobile) */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-purple-500 hover:bg-purple-600 text-white rounded-full shadow-lg shadow-purple-500/30 flex items-center justify-center sm:hidden transition-colors"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateModal
          type={activeTab}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
          existingWorld={world}
          characters={characters}
        />
      )}

      {/* Connection Modal */}
      {showConnectionModal && selectedItem && (
        <ConnectionModal
          character={selectedItem}
          characters={characters}
          onClose={() => setShowConnectionModal(false)}
          onCreate={handleCreateConnection}
        />
      )}

      {/* Import Library Name Prompt Modal */}
      {showImportLibraryPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-slate-100 mb-2">
              Create New Story Bible
            </h3>
            <p className="text-slate-400 text-sm mb-4">
              Importing creates a new Story Bible. What would you like to name it?
            </p>
            <input
              type="text"
              value={importLibraryName}
              onChange={(e) => setImportLibraryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && importLibraryName.trim()) handleAdvancedImport();
                if (e.key === 'Escape') {
                  setShowImportLibraryPrompt(false);
                  setImportLibraryName('');
                }
              }}
              placeholder="Enter library name..."
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500 mb-4"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowImportLibraryPrompt(false);
                  setImportLibraryName('');
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdvancedImport}
                disabled={!importLibraryName.trim()}
                className="px-6 py-2 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-medium rounded-xl transition-all"
              >
                Create & Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function ItemCard({ item, type, onClick, connections, orderIndex, totalItems, onMoveUp, onMoveDown }) {
  const hasOutline = type === 'synopsis' && item.is_outline_generated;
  const showOrderControls = type === 'events' && orderIndex !== null;

  return (
    <div
      onClick={onClick}
      className="p-4 bg-slate-800 rounded-xl border border-slate-700 hover:border-slate-600 transition-all cursor-pointer group relative"
    >
      {/* Event order controls */}
      {showOrderControls && (
        <div className="absolute -left-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
            disabled={orderIndex === 0}
            className={`p-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors ${orderIndex === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
            title="Move up in order"
          >
            <ChevronUp className="w-3 h-3 text-slate-300" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
            disabled={orderIndex === totalItems - 1}
            className={`p-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors ${orderIndex === totalItems - 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
            title="Move down in order"
          >
            <ChevronDown className="w-3 h-3 text-slate-300" />
          </button>
        </div>
      )}

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Event order number badge */}
          {showOrderControls && (
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-yellow-500/20 text-yellow-300 text-xs font-bold rounded">
              {orderIndex + 1}
            </span>
          )}
          <h4 className="font-medium text-slate-100 group-hover:text-purple-300 transition-colors line-clamp-1">
            {item.name || item.title}
          </h4>
        </div>
        {item.is_favorite && (
          <Star className="w-4 h-4 text-amber-400 fill-amber-400 flex-shrink-0" />
        )}
      </div>

      {item.role && (
        <span className="inline-block px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300 mb-2">
          {item.role}
        </span>
      )}

      {item.location_type && (
        <span className="inline-block px-2 py-0.5 bg-cyan-500/20 rounded text-xs text-cyan-300 mb-2">
          {item.location_type}
        </span>
      )}

      {item.entry_type && (
        <span className="inline-block px-2 py-0.5 bg-purple-500/20 rounded text-xs text-purple-300 mb-2">
          {item.entry_type}
        </span>
      )}

      {item.item_type && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block px-2 py-0.5 bg-orange-500/20 rounded text-xs text-orange-300">
            {item.item_type}
          </span>
          {item.rarity && item.rarity !== 'common' && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
              item.rarity === 'legendary' ? 'bg-yellow-500/20 text-yellow-300' :
              item.rarity === 'very_rare' ? 'bg-purple-500/20 text-purple-300' :
              item.rarity === 'rare' ? 'bg-blue-500/20 text-blue-300' :
              'bg-green-500/20 text-green-300'
            }`}>
              {item.rarity.replace('_', ' ')}
            </span>
          )}
          {item.is_magical && (
            <span className="inline-block px-2 py-0.5 bg-violet-500/20 rounded text-xs text-violet-300">
              ✨ magical
            </span>
          )}
        </div>
      )}

      {item.faction_type && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block px-2 py-0.5 bg-rose-500/20 rounded text-xs text-rose-300">
            {item.faction_type}
          </span>
          {item.alignment && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
              item.alignment?.includes('good') ? 'bg-green-500/20 text-green-300' :
              item.alignment?.includes('evil') ? 'bg-red-500/20 text-red-300' :
              'bg-slate-600 text-slate-400'
            }`}>
              {item.alignment?.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      )}

      {item.ability_type && (
        <span className="inline-block px-2 py-0.5 bg-red-500/20 rounded text-xs text-red-300 mb-2">
          {item.ability_type}
        </span>
      )}

      {item.event_type && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="inline-block px-2 py-0.5 bg-yellow-500/20 rounded text-xs text-yellow-300">
            {item.event_type}
          </span>
          {item.importance && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
              item.importance === 'major' ? 'bg-red-500/20 text-red-300' :
              item.importance === 'supporting' ? 'bg-blue-500/20 text-blue-300' :
              'bg-slate-600 text-slate-400'
            }`}>
              {item.importance}
            </span>
          )}
          {item.is_incorporated && (
            <span className="inline-block px-2 py-0.5 bg-emerald-500/20 rounded text-xs text-emerald-300">
              ✓ incorporated
            </span>
          )}
        </div>
      )}

      <p className="text-sm text-slate-400 line-clamp-2 mb-3">
        {item.description || item.synopsis || item.content || 'No description'}
      </p>

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {type === 'characters' && connections.length > 0 && (
            <span className="flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              {connections.length} connections
            </span>
          )}
          {type === 'synopsis' && hasOutline && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Check className="w-3 h-3" />
              Outline ready
            </span>
          )}
          {type !== 'characters' && type !== 'synopsis' && `Used ${item.use_count || 0} times`}
        </span>
      </div>
    </div>
  );
}

function DetailView({
  item, type, onBack, onDelete, onRefine,
  refinementPrompt, setRefinementPrompt, isRefining,
  connections, characters, onAddConnection,
  onGenerateOutline, isGeneratingOutline, onUseInStory,
  onUpdateOutline, events, lore, onRefreshData
}) {
  // Outline editing state
  const [editingChapterIndex, setEditingChapterIndex] = useState(null);
  const [editingChapter, setEditingChapter] = useState(null);
  const [isSavingChapter, setIsSavingChapter] = useState(false);
  // Per-chapter refinement state
  const [chapterRefinePrompt, setChapterRefinePrompt] = useState('');
  const [isRefiningChapter, setIsRefiningChapter] = useState(false);
  // Event/Lore linking state
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [showEventLinkModal, setShowEventLinkModal] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const navigate = useNavigate();

  // Load linked events for the current chapter being edited
  useEffect(() => {
    if (editingChapterIndex !== null && type === 'synopsis' && item?.id) {
      loadLinkedEvents(editingChapterIndex + 1);
    }
  }, [editingChapterIndex, item?.id]);

  const loadLinkedEvents = async (chapterNumber) => {
    try {
      const res = await apiCall(`/story-bible/outline-events/${item.id}?chapter=${chapterNumber}`);
      if (res.ok) {
        const data = await res.json();
        setLinkedEvents(data.links || []);
      }
    } catch (error) {
      console.error('Failed to load linked events:', error);
    }
  };

  const handleRefineChapter = async () => {
    if (!chapterRefinePrompt.trim() || editingChapterIndex === null) return;

    setIsRefiningChapter(true);
    try {
      const res = await apiCall(`/story-bible/synopsis/${item.id}/refine-chapter/${editingChapterIndex + 1}`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: chapterRefinePrompt,
          include_events: linkedEvents.length > 0
        })
      });

      if (res.ok) {
        const result = await res.json();
        // Update the editing chapter with refined data
        setEditingChapter(result.chapter);
        setChapterRefinePrompt('');
        // Optionally refresh parent data
        if (onRefreshData) onRefreshData();
      }
    } catch (error) {
      console.error('Failed to refine chapter:', error);
    } finally {
      setIsRefiningChapter(false);
    }
  };

  const handleLinkEvent = async (eventId) => {
    if (editingChapterIndex === null) return;

    setLoadingLinks(true);
    try {
      const res = await apiCall('/story-bible/outline-events', {
        method: 'POST',
        body: JSON.stringify({
          synopsis_id: item.id,
          chapter_number: editingChapterIndex + 1,
          event_id: eventId
        })
      });

      if (res.ok) {
        await loadLinkedEvents(editingChapterIndex + 1);
        setShowEventLinkModal(false);
      }
    } catch (error) {
      console.error('Failed to link event:', error);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleUnlinkEvent = async (linkId) => {
    setLoadingLinks(true);
    try {
      const res = await apiCall(`/story-bible/outline-events/${linkId}`, {
        method: 'DELETE'
      });

      if (res.ok && editingChapterIndex !== null) {
        await loadLinkedEvents(editingChapterIndex + 1);
      }
    } catch (error) {
      console.error('Failed to unlink event:', error);
    } finally {
      setLoadingLinks(false);
    }
  };
  const entityTypeMap = {
    characters: 'character',
    events: 'event',
    world: 'world',
    locations: 'location',
    items: 'item',
    factions: 'faction',
    abilities: 'ability',
    lore: 'lore',
    synopsis: 'synopsis'
  };

  const entityType = entityTypeMap[type];

  // Check if synopsis has an outline ready
  const hasOutline = type === 'synopsis' && item.is_outline_generated;

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to list
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Use in Story CTA - for synopsis with outline */}
      {type === 'synopsis' && hasOutline && (
        <div className="p-4 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-b border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4" />
                Outline Ready
              </h4>
              <p className="text-sm text-slate-400">
                This story outline can be used in the Configure page
              </p>
            </div>
            <button
              onClick={() => navigate(`/configure?outline=${item.id}`)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-xl transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
              Use This Story
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-6">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">
          {item.name || item.title}
        </h2>

        {item.role && (
          <span className="inline-block px-3 py-1 bg-blue-500/20 rounded-full text-sm text-blue-300 mb-4">
            {item.role}
          </span>
        )}

        {/* Item details badges */}
        {item.item_type && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="inline-block px-3 py-1 bg-orange-500/20 rounded-full text-sm text-orange-300">
              {item.item_type}
            </span>
            {item.rarity && (
              <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                item.rarity === 'legendary' ? 'bg-yellow-500/20 text-yellow-300' :
                item.rarity === 'very_rare' ? 'bg-purple-500/20 text-purple-300' :
                item.rarity === 'rare' ? 'bg-blue-500/20 text-blue-300' :
                item.rarity === 'uncommon' ? 'bg-green-500/20 text-green-300' :
                'bg-slate-600 text-slate-400'
              }`}>
                {item.rarity.replace('_', ' ')}
              </span>
            )}
            {item.is_magical && (
              <span className="inline-block px-3 py-1 bg-violet-500/20 rounded-full text-sm text-violet-300">
                ✨ Magical
              </span>
            )}
          </div>
        )}

        {/* Faction details badges */}
        {item.faction_type && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="inline-block px-3 py-1 bg-rose-500/20 rounded-full text-sm text-rose-300">
              {item.faction_type}
            </span>
            {item.alignment && (
              <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                item.alignment?.includes('good') ? 'bg-green-500/20 text-green-300' :
                item.alignment?.includes('evil') ? 'bg-red-500/20 text-red-300' :
                'bg-slate-600 text-slate-400'
              }`}>
                {item.alignment?.replace(/_/g, ' ')}
              </span>
            )}
            {item.size && (
              <span className="inline-block px-3 py-1 bg-slate-600 rounded-full text-sm text-slate-300">
                {item.size}
              </span>
            )}
          </div>
        )}

        {/* Ability details badges */}
        {item.ability_type && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="inline-block px-3 py-1 bg-red-500/20 rounded-full text-sm text-red-300">
              {item.ability_type}
            </span>
            {item.school && (
              <span className="inline-block px-3 py-1 bg-purple-500/20 rounded-full text-sm text-purple-300">
                {item.school}
              </span>
            )}
            {item.level && (
              <span className="inline-block px-3 py-1 bg-slate-600 rounded-full text-sm text-slate-300">
                Level {item.level}
              </span>
            )}
          </div>
        )}

        {item.logline && (
          <p className="text-slate-300 italic mb-4">{item.logline}</p>
        )}

        <div className="space-y-4 text-slate-300">
          {item.description && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Description</h4>
              <p>{item.description}</p>
            </div>
          )}

          {item.synopsis && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Synopsis</h4>
              <p>{item.synopsis}</p>
            </div>
          )}

          {item.content && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Content</h4>
              <p>{item.content}</p>
            </div>
          )}

          {item.personality && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Personality</h4>
              <p>{item.personality}</p>
            </div>
          )}

          {item.backstory && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Backstory</h4>
              <p>{item.backstory}</p>
            </div>
          )}

          {item.atmosphere && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Atmosphere</h4>
              <p>{item.atmosphere}</p>
            </div>
          )}

          {item.magic_system && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Magic System</h4>
              <p>{item.magic_system}</p>
            </div>
          )}

          {/* Item-specific fields */}
          {item.properties && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Properties</h4>
              <p>{item.properties}</p>
            </div>
          )}

          {item.origin && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Origin</h4>
              <p>{item.origin}</p>
            </div>
          )}

          {item.history && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">History</h4>
              <p>{item.history}</p>
            </div>
          )}

          {/* Faction-specific fields */}
          {item.goals && Array.isArray(item.goals) && item.goals.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Goals</h4>
              <div className="flex flex-wrap gap-2">
                {item.goals.map((goal, i) => (
                  <span key={i} className="px-2 py-1 bg-slate-700 rounded text-sm">
                    {goal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {item.methods && Array.isArray(item.methods) && item.methods.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Methods</h4>
              <div className="flex flex-wrap gap-2">
                {item.methods.map((method, i) => (
                  <span key={i} className="px-2 py-1 bg-slate-700 rounded text-sm">
                    {method}
                  </span>
                ))}
              </div>
            </div>
          )}

          {item.headquarters && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Headquarters</h4>
              <p>{item.headquarters}</p>
            </div>
          )}

          {item.leader && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Leader</h4>
              <p>{item.leader}</p>
            </div>
          )}

          {/* Ability-specific fields */}
          {item.effect && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Effect</h4>
              <p>{item.effect}</p>
            </div>
          )}

          {item.casting_time && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Casting Time</h4>
              <p>{item.casting_time}</p>
            </div>
          )}

          {item.range && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Range</h4>
              <p>{item.range}</p>
            </div>
          )}

          {item.duration && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Duration</h4>
              <p>{item.duration}</p>
            </div>
          )}

          {item.components && Array.isArray(item.components) && item.components.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Components</h4>
              <div className="flex flex-wrap gap-2">
                {item.components.map((comp, i) => (
                  <span key={i} className="px-2 py-1 bg-slate-700 rounded text-sm">
                    {comp}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Character Connections */}
        {type === 'characters' && (
          <div className="mt-6 pt-6 border-t border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Connections
              </h4>
              <button
                onClick={onAddConnection}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Connection
              </button>
            </div>

            {connections.length === 0 ? (
              <p className="text-slate-500 text-sm">No connections yet</p>
            ) : (
              <div className="space-y-2">
                {connections.map(conn => {
                  const otherCharId = conn.character_a_id === item.id ? conn.character_b_id : conn.character_a_id;
                  const otherChar = characters.find(c => c.id === otherCharId);
                  const relType = conn.character_a_id === item.id
                    ? conn.relationship_type
                    : (conn.reverse_relationship_type || conn.relationship_type);

                  return (
                    <div key={conn.id} className="flex items-center gap-2 p-2 bg-slate-700/50 rounded-lg">
                      <span className="text-slate-100">{otherChar?.name || 'Unknown'}</span>
                      <span className="text-slate-500">—</span>
                      <span className="text-purple-300 capitalize">{relType.replace('_', ' ')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Synopsis Outline */}
        {type === 'synopsis' && (
          <div className="mt-6 pt-6 border-t border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <List className="w-4 h-4" />
                Chapter Outline
              </h4>
              <button
                onClick={onGenerateOutline}
                disabled={isGeneratingOutline}
                className="flex items-center gap-2 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50 text-white text-sm rounded-lg transition-colors"
              >
                {isGeneratingOutline ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {item.is_outline_generated ? 'Regenerate' : 'Generate'} Outline
                  </>
                )}
              </button>
            </div>

            {(() => {
              // Parse outline_json if it's a string
              let outline = item.outline_json;
              if (typeof outline === 'string') {
                try { outline = JSON.parse(outline); } catch (e) { outline = null; }
              }
              const chapters = outline?.chapters || [];

              // Helper functions for chapter editing
              const startEditChapter = (idx) => {
                setEditingChapterIndex(idx);
                setEditingChapter({ ...chapters[idx] });
              };

              const cancelEditChapter = () => {
                setEditingChapterIndex(null);
                setEditingChapter(null);
              };

              const saveChapter = async () => {
                if (!onUpdateOutline || editingChapterIndex === null) return;
                setIsSavingChapter(true);
                const success = await onUpdateOutline('update_chapter', {
                  chapter_index: editingChapterIndex,
                  chapter_data: editingChapter
                });
                setIsSavingChapter(false);
                if (success) {
                  setEditingChapterIndex(null);
                  setEditingChapter(null);
                }
              };

              const addChapter = async (atIndex) => {
                if (!onUpdateOutline) return;
                await onUpdateOutline('add_chapter', {
                  chapter_index: atIndex,
                  chapter_data: {
                    title: 'New Chapter',
                    summary: '',
                    key_events: [],
                    mood: '',
                    location: '',
                    ends_with: ''
                  }
                });
              };

              const deleteChapter = async (idx) => {
                if (!onUpdateOutline) return;
                if (window.confirm(`Delete Chapter ${idx + 1}?`)) {
                  await onUpdateOutline('delete_chapter', { chapter_index: idx });
                }
              };

              const moveChapter = async (idx, direction) => {
                if (!onUpdateOutline) return;
                const newIndex = direction === 'up' ? idx - 1 : idx + 1;
                if (newIndex < 0 || newIndex >= chapters.length) return;
                await onUpdateOutline('reorder', { chapter_index: idx, new_index: newIndex });
              };

              if (chapters.length > 0) {
                return (
                  <div className="space-y-2">
                    {/* Add chapter at start */}
                    {onUpdateOutline && (
                      <button
                        onClick={() => addChapter(0)}
                        className="w-full p-2 border-2 border-dashed border-slate-600 hover:border-amber-500/50 rounded-lg text-slate-500 hover:text-amber-400 text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add Chapter at Start
                      </button>
                    )}

                    {chapters.map((chapter, idx) => (
                      <div key={idx}>
                        {editingChapterIndex === idx ? (
                          /* Editing Mode */
                          <div className="p-4 bg-slate-700 rounded-lg border border-amber-500/50 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-amber-400 font-medium">Editing Chapter {idx + 1}</span>
                              <div className="flex gap-2">
                                <button
                                  onClick={cancelEditChapter}
                                  className="px-3 py-1 text-sm text-slate-400 hover:text-slate-100"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={saveChapter}
                                  disabled={isSavingChapter}
                                  className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-lg flex items-center gap-1"
                                >
                                  {isSavingChapter ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                  Save
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">Title</label>
                              <input
                                type="text"
                                value={editingChapter?.title || ''}
                                onChange={(e) => setEditingChapter(prev => ({ ...prev, title: e.target.value }))}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">Summary</label>
                              <textarea
                                value={editingChapter?.summary || ''}
                                onChange={(e) => setEditingChapter(prev => ({ ...prev, summary: e.target.value }))}
                                rows={3}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-amber-500 resize-none"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">Key Events (one per line)</label>
                              <textarea
                                value={(editingChapter?.key_events || []).join('\n')}
                                onChange={(e) => setEditingChapter(prev => ({ ...prev, key_events: e.target.value.split('\n').filter(ev => ev.trim()) }))}
                                rows={3}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-amber-500 resize-none"
                                placeholder="Event 1&#10;Event 2&#10;Event 3"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400 mb-1 block">Mood</label>
                                <input
                                  type="text"
                                  value={editingChapter?.mood || ''}
                                  onChange={(e) => setEditingChapter(prev => ({ ...prev, mood: e.target.value }))}
                                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                                  placeholder="e.g., Tense, Hopeful"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400 mb-1 block">Location</label>
                                <input
                                  type="text"
                                  value={editingChapter?.location || ''}
                                  onChange={(e) => setEditingChapter(prev => ({ ...prev, location: e.target.value }))}
                                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                                  placeholder="Where it takes place"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">Ends With</label>
                              <input
                                type="text"
                                value={editingChapter?.ends_with || ''}
                                onChange={(e) => setEditingChapter(prev => ({ ...prev, ends_with: e.target.value }))}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                                placeholder="Cliffhanger, Resolution, Revelation..."
                              />
                            </div>

                            {/* Linked Events Section */}
                            <div className="border-t border-slate-600 pt-3 mt-3">
                              <div className="flex items-center justify-between mb-2">
                                <label className="text-xs text-slate-400 flex items-center gap-1">
                                  <Link2 className="w-3 h-3" />
                                  Linked Events
                                </label>
                                <button
                                  onClick={() => setShowEventLinkModal(true)}
                                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  Link Event
                                </button>
                              </div>
                              {linkedEvents.length > 0 ? (
                                <div className="space-y-1">
                                  {linkedEvents.map(link => (
                                    <div key={link.id} className="flex items-center justify-between px-2 py-1.5 bg-slate-800/50 rounded text-sm">
                                      <span className="text-slate-200">{link.event?.name || 'Unknown Event'}</span>
                                      <button
                                        onClick={() => handleUnlinkEvent(link.id)}
                                        className="text-slate-500 hover:text-red-400 p-1"
                                        title="Unlink"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500 italic">No events linked. Link events to include them when refining.</p>
                              )}
                            </div>

                            {/* Refine With AI Section */}
                            <div className="border-t border-slate-600 pt-3 mt-3">
                              <label className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                Refine Chapter With AI
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={chapterRefinePrompt}
                                  onChange={(e) => setChapterRefinePrompt(e.target.value)}
                                  placeholder="e.g., Add more tension, make the ending more dramatic..."
                                  className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-purple-500"
                                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleRefineChapter()}
                                />
                                <button
                                  onClick={handleRefineChapter}
                                  disabled={!chapterRefinePrompt.trim() || isRefiningChapter}
                                  className="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-purple-300 text-sm disabled:opacity-50 flex items-center gap-1"
                                >
                                  {isRefiningChapter ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-4 h-4" />
                                  )}
                                  Refine
                                </button>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                {linkedEvents.length > 0
                                  ? `AI will use ${linkedEvents.length} linked event(s) for context`
                                  : 'Tip: Link events above for more contextual refinement'}
                              </p>
                            </div>
                          </div>
                        ) : (
                          /* Display Mode */
                          <div className="p-3 bg-slate-700/50 rounded-lg group hover:bg-slate-700/70 transition-colors">
                            <div className="flex items-start gap-2">
                              <span className="text-amber-400 font-medium shrink-0">
                                Ch {chapter.chapter_number || idx + 1}:
                              </span>
                              <div className="flex-1">
                                <span className="text-slate-100 font-medium">{chapter.title}</span>
                                <p className="text-slate-400 text-sm mt-1">{chapter.summary}</p>
                                {chapter.key_events && chapter.key_events.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {chapter.key_events.slice(0, 3).map((event, i) => (
                                      <span key={i} className="text-xs px-2 py-0.5 bg-slate-600 text-slate-300 rounded">
                                        {event}
                                      </span>
                                    ))}
                                    {chapter.key_events.length > 3 && (
                                      <span className="text-xs px-2 py-0.5 bg-slate-600 text-slate-400 rounded">
                                        +{chapter.key_events.length - 3} more
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {/* Edit controls */}
                              {onUpdateOutline && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => moveChapter(idx, 'up')}
                                    disabled={idx === 0}
                                    className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                                    title="Move up"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => moveChapter(idx, 'down')}
                                    disabled={idx === chapters.length - 1}
                                    className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                                    title="Move down"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => startEditChapter(idx)}
                                    className="p-1 text-slate-400 hover:text-amber-400"
                                    title="Edit chapter"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => deleteChapter(idx)}
                                    className="p-1 text-slate-400 hover:text-red-400"
                                    title="Delete chapter"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Add chapter button between chapters */}
                        {onUpdateOutline && idx < chapters.length - 1 && (
                          <button
                            onClick={() => addChapter(idx + 1)}
                            className="w-full p-1.5 border-2 border-dashed border-transparent hover:border-slate-600 rounded-lg text-slate-600 hover:text-slate-400 text-xs transition-colors flex items-center justify-center gap-1 opacity-0 hover:opacity-100"
                          >
                            <Plus className="w-3 h-3" />
                            Insert Chapter
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Add chapter at end */}
                    {onUpdateOutline && (
                      <button
                        onClick={() => addChapter(chapters.length)}
                        className="w-full p-2 border-2 border-dashed border-slate-600 hover:border-amber-500/50 rounded-lg text-slate-500 hover:text-amber-400 text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add Chapter at End
                      </button>
                    )}
                  </div>
                );
              }

              return (
                <p className="text-slate-500 text-sm">
                  No outline yet. Click "Generate Outline" to create one from your story bible.
                </p>
              );
            })()}
          </div>
        )}

        {/* Refinement Input */}
        <div className="mt-6 pt-6 border-t border-slate-700">
          <h4 className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Refine with AI
          </h4>
          <p className="text-slate-500 text-xs mb-3">
            Type what you want to add or change. Example: "Add that they love jazz music" or "Make them more mysterious"
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={refinementPrompt}
              onChange={(e) => setRefinementPrompt(e.target.value)}
              placeholder="What would you like to change?"
              className="flex-1 px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onRefine(entityType, item.id);
                }
              }}
            />
            <button
              onClick={() => onRefine(entityType, item.id)}
              disabled={isRefining || !refinementPrompt.trim()}
              className="px-4 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50 text-white rounded-xl transition-colors flex items-center gap-2"
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

      {/* Event Link Modal */}
      {showEventLinkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="font-semibold text-slate-100">Link Event to Chapter</h3>
              <button
                onClick={() => setShowEventLinkModal(false)}
                className="p-2 hover:bg-slate-700 rounded-lg text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {events && events.length > 0 ? (
                <div className="space-y-2">
                  {events.filter(e => !linkedEvents.find(l => l.event_id === e.id)).map(event => (
                    <button
                      key={event.id}
                      onClick={() => handleLinkEvent(event.id)}
                      disabled={loadingLinks}
                      className="w-full p-3 text-left bg-slate-700/50 hover:bg-slate-700 rounded-lg border border-slate-600 hover:border-yellow-500/50 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <Calendar className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-slate-100 truncate">{event.name}</h4>
                          <p className="text-sm text-slate-400 line-clamp-2">{event.description}</p>
                          {event.importance && (
                            <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                              {event.importance}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No events in library</p>
                  <p className="text-slate-500 text-sm mt-1">Create events in the Events tab first</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickTips({ activeTab }) {
  const tips = {
    characters: [
      'Add voice descriptions for voice acting',
      'Define relationships to influence dialogue tone',
      'Characters are forked into stories, keeping the original safe'
    ],
    world: [
      'Define world rules (magic systems, technology levels)',
      'Set the tone and atmosphere for consistent generation',
      'One world per library - locations go inside it'
    ],
    locations: [
      'Create hierarchies (Kingdom → City → Building)',
      'Add atmosphere details for scene setting',
      'Link locations to your world for organization'
    ],
    items: [
      'Track weapons, vehicles, artifacts, and equipment',
      'Set rarity and magical properties for RPG integration',
      'Link items to characters who own or use them'
    ],
    factions: [
      'Create organizations, guilds, and groups',
      'Define goals, methods, and alignment',
      'Track faction relationships and conflicts'
    ],
    abilities: [
      'Add spells, skills, and special powers',
      'Define ability components, ranges, and durations',
      'Perfect for RPG and tabletop game content'
    ],
    lore: [
      'Add keywords to auto-inject lore when mentioned',
      'Set importance levels to prioritize context',
      'Great for magic systems, history, events'
    ],
    synopsis: [
      'Create stories with synopsis and outline - use them in Configure page',
      'Generate chapter-by-chapter outlines with AI',
      'Edit outline chapters manually - add, remove, reorder'
    ]
  };

  const tabTips = tips[activeTab] || [];
  const tabConfig = TABS.find(t => t.id === activeTab);

  return (
    <div className="mt-12 p-6 bg-slate-800/50 rounded-2xl border border-slate-700 text-left max-w-lg mx-auto">
      <h4 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-golden-400" />
        Quick Tips
      </h4>
      <ul className="space-y-3 text-sm text-slate-400">
        {tabTips.map((tip, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <ChevronRight className={`w-4 h-4 mt-0.5 ${tabConfig?.color || 'text-purple-400'} flex-shrink-0`} />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateModal({ type, onClose, onCreate, existingWorld, characters }) {
  const [freeformText, setFreeformText] = useState('');
  const [parsedPreview, setParsedPreview] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const entityTypeMap = {
    characters: 'character',
    events: 'event',
    world: 'world',
    locations: 'location',
    items: 'item',
    factions: 'faction',
    abilities: 'ability',
    lore: 'lore',
    synopsis: 'synopsis'
  };

  const titles = {
    characters: 'Create Character',
    events: 'Create Event',
    world: 'Create World',
    locations: 'Create Location',
    items: 'Create Item',
    factions: 'Create Faction',
    abilities: 'Create Ability',
    lore: 'Create Lore Entry',
    synopsis: 'Create Synopsis'
  };

  const placeholders = {
    characters: `Describe your character freely, e.g.:
"A gruff dwarf warrior named Thorin who lost his kingdom to a dragon. He's proud and stubborn but deeply loyal. Around 150 years old, with a long gray beard and scars from many battles. Speaks in a deep, rumbling voice."`,
    events: `Describe a planned story event freely, e.g.:
"A dramatic confrontation in the abandoned warehouse where the hero finally faces the villain. The villain reveals they were childhood friends. A tense fight breaks out, interrupted when the building starts to collapse. Both must work together to escape."`,
    world: `Describe your world freely, e.g.:
"A medieval fantasy realm where magic flows through crystalline ley lines. Three kingdoms constantly vie for power while ancient forests hide elven cities. Technology is pre-industrial but magical artifacts can replicate modern conveniences."`,
    locations: `Describe your location freely, e.g.:
"The Rusty Anchor tavern sits at the edge of the harbor district. Sailors and merchants crowd the worn wooden tables. The air smells of salt, ale, and pipe smoke. A mysterious back room hosts secret dealings after midnight."`,
    items: `Describe your item freely, e.g.:
"The Sword of Dawn is a legendary blade that glows with golden light at sunrise. Forged by ancient elven smiths, it can cut through magical darkness and is especially effective against undead. Currently in the possession of the Order of Light."`,
    factions: `Describe your faction freely, e.g.:
"The Thieves Guild of Shadowmere operates in the city's underground, with agents in every tavern and market. They follow a strict code of honor among thieves and never harm children. Led by the mysterious 'Gray Fox' whose true identity is unknown."`,
    abilities: `Describe your ability freely, e.g.:
"Fireball is a 3rd-level evocation spell that creates a fiery explosion. The caster points a finger and a bright streak flashes to a point within 150 feet, then blossoms into flame. Each creature in a 20-foot radius must make a Dexterity saving throw."`,
    lore: `Describe your lore entry freely, e.g.:
"The Blood Moon Prophecy speaks of a night when three moons align and the barrier between worlds weakens. Every 500 years, creatures from the shadow realm can cross over. The last occurrence destroyed the Empire of Ash."`,
    synopsis: `Describe your story freely, e.g.:
"A young chef discovers her grandmother's recipe book contains actual magic spells. Each dish she cooks brings fantastical consequences - love potions in the soup, invisibility in the pie. She must master her culinary magic before a rival restaurant learns her secret."`
  };

  const handleParse = async () => {
    if (!freeformText.trim()) return;

    setIsProcessing(true);
    try {
      const res = await apiCall('/story-bible/parse-text', {
        method: 'POST',
        body: JSON.stringify({
          text: freeformText,
          entity_type: entityTypeMap[type]
        })
      });

      if (res.ok) {
        const result = await res.json();
        setParsedPreview(result.parsed);
      }
    } catch (error) {
      console.error('Failed to parse text:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async () => {
    if (!parsedPreview) return;

    setIsSubmitting(true);
    await onCreate(parsedPreview);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-medium text-slate-100">{titles[type]}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!parsedPreview ? (
            <>
              {/* Freeform Input */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Describe your {entityTypeMap[type]} in your own words
                </label>
                <textarea
                  value={freeformText}
                  onChange={(e) => setFreeformText(e.target.value)}
                  placeholder={placeholders[type]}
                  rows={8}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500 resize-none"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Write naturally - AI will extract name, details, traits, and more.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleParse}
                  disabled={isProcessing || !freeformText.trim()}
                  className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Extract Details
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            /* Preview Parsed Data */
            <>
              <div className="p-4 bg-slate-700/50 rounded-xl border border-slate-600">
                <h4 className="font-medium text-slate-100 mb-3 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  Extracted Details
                </h4>

                <div className="space-y-3 text-sm">
                  {parsedPreview.name && (
                    <div>
                      <span className="text-slate-400">Name:</span>
                      <span className="text-slate-100 ml-2 font-medium">{parsedPreview.name}</span>
                    </div>
                  )}
                  {parsedPreview.title && (
                    <div>
                      <span className="text-slate-400">Title:</span>
                      <span className="text-slate-100 ml-2 font-medium">{parsedPreview.title}</span>
                    </div>
                  )}
                  {parsedPreview.gender && (
                    <div>
                      <span className="text-slate-400">Gender:</span>
                      <span className="text-slate-100 ml-2 capitalize">{parsedPreview.gender}</span>
                    </div>
                  )}
                  {parsedPreview.age_group && (
                    <div>
                      <span className="text-slate-400">Age:</span>
                      <span className="text-slate-100 ml-2 capitalize">{parsedPreview.age_group?.replace('_', ' ')}</span>
                    </div>
                  )}
                  {parsedPreview.role && (
                    <div>
                      <span className="text-slate-400">Role:</span>
                      <span className="text-slate-100 ml-2 capitalize">{parsedPreview.role}</span>
                    </div>
                  )}
                  {parsedPreview.genre && (
                    <div>
                      <span className="text-slate-400">Genre:</span>
                      <span className="text-slate-100 ml-2">{parsedPreview.genre}</span>
                    </div>
                  )}
                  {parsedPreview.location_type && (
                    <div>
                      <span className="text-slate-400">Type:</span>
                      <span className="text-slate-100 ml-2 capitalize">{parsedPreview.location_type}</span>
                    </div>
                  )}
                  {parsedPreview.entry_type && (
                    <div>
                      <span className="text-slate-400">Entry Type:</span>
                      <span className="text-slate-100 ml-2 capitalize">{parsedPreview.entry_type}</span>
                    </div>
                  )}
                  {parsedPreview.description && (
                    <div>
                      <span className="text-slate-400">Description:</span>
                      <p className="text-slate-300 mt-1">{parsedPreview.description}</p>
                    </div>
                  )}
                  {parsedPreview.personality && (
                    <div>
                      <span className="text-slate-400">Personality:</span>
                      <p className="text-slate-300 mt-1">{parsedPreview.personality}</p>
                    </div>
                  )}
                  {parsedPreview.traits?.length > 0 && (
                    <div>
                      <span className="text-slate-400">Traits:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {parsedPreview.traits.map((trait, i) => (
                          <span key={i} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded">
                            {trait}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {parsedPreview.voice_description && (
                    <div>
                      <span className="text-slate-400">Voice:</span>
                      <p className="text-slate-300 mt-1">{parsedPreview.voice_description}</p>
                    </div>
                  )}
                  {parsedPreview.logline && (
                    <div>
                      <span className="text-slate-400">Logline:</span>
                      <p className="text-slate-300 mt-1 italic">{parsedPreview.logline}</p>
                    </div>
                  )}
                  {parsedPreview.synopsis && (
                    <div>
                      <span className="text-slate-400">Synopsis:</span>
                      <p className="text-slate-300 mt-1">{parsedPreview.synopsis}</p>
                    </div>
                  )}
                  {parsedPreview.content && (
                    <div>
                      <span className="text-slate-400">Content:</span>
                      <p className="text-slate-300 mt-1">{parsedPreview.content}</p>
                    </div>
                  )}
                  {parsedPreview.atmosphere && (
                    <div>
                      <span className="text-slate-400">Atmosphere:</span>
                      <p className="text-slate-300 mt-1">{parsedPreview.atmosphere}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setParsedPreview(null)}
                  className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Create
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionModal({ character, characters, onClose, onCreate }) {
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableCharacters = characters.filter(c => c.id !== character.id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCharacter || !relationshipType) return;

    setIsSubmitting(true);

    const relType = RELATIONSHIP_TYPES.find(r => r.value === relationshipType);

    await onCreate({
      character_a_id: character.id,
      character_b_id: selectedCharacter,
      relationship_type: relationshipType,
      is_directional: relType?.directional || false,
      reverse_relationship_type: relType?.reverse || null
    });

    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-medium text-slate-100">Add Connection</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Connect "{character.name}" to:
            </label>
            <select
              required
              value={selectedCharacter}
              onChange={(e) => setSelectedCharacter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="">Select character...</option>
              {availableCharacters.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Relationship Type
            </label>
            <select
              required
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="">Select relationship...</option>
              {RELATIONSHIP_TYPES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedCharacter || !relationshipType}
              className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50 text-white rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  Connect
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
