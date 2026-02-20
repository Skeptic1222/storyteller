import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, Sparkles, Volume2, MessageCircle, Shield, Swords, Users, BookOpen, Library, Bookmark, GitBranch, PenTool, ChevronDown, ChevronUp, Waves, Zap, Settings, FileText, ExternalLink, Palette } from 'lucide-react';
import GenreSlider from '../components/GenreSlider';
import VoiceSelector from '../components/VoiceSelector';
import VoiceRecorder from '../components/VoiceRecorder';
import UserProfile from '../components/UserProfile';
import { useAuth } from '../context/AuthContext';
import ProviderIndicator from '../components/ProviderIndicator';
import AccessibleToggle from '../components/ui/AccessibleToggle';
import { apiCall } from '../config';
import { PROVIDER_THRESHOLDS } from '../constants/authorStyles';
import { AuthorStylePicker } from '../components/configure';
import DirectorStylePicker from '../components/configure/DirectorStylePicker';
import { configLog } from '../utils/clientLogger';
import AdvancedConfigureStory from '../components/configure/AdvancedConfigureStory';

// Reusable Accordion Section for grouping related settings
function AccordionSection({ id, title, icon: Icon, expanded, onToggle, children, badge, className = '' }) {
  return (
    <div className={`rounded-2xl border border-slate-700 overflow-hidden ${className}`}>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800/70 transition-colors"
        aria-expanded={expanded}
        aria-controls={`accordion-${id}`}
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-5 h-5 text-golden-400" />}
          <span className="text-lg font-medium text-slate-100">{title}</span>
          {badge && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-golden-400/20 text-golden-400">{badge}</span>
          )}
        </div>
        <div className={`transform transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDown className="w-5 h-5 text-slate-400" />
        </div>
      </button>
      <div
        id={`accordion-${id}`}
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="p-4 space-y-6 bg-slate-900/30">
          {children}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_GENRES = {
  fantasy: 70,
  adventure: 50,
  mystery: 30,
  scifi: 20,
  romance: 10,
  horror: 20,
  humor: 40,
  fairytale: 30
};

const DEFAULT_INTENSITY = {
  violence: 20,
  gore: 0,
  scary: 30,
  romance: 10,
  language: 10,
  adultContent: 0,
  sensuality: 0,
  explicitness: 0,
  bleakness: 25,
  sexualViolence: 0
};

const RESET_GENRES = {
  fantasy: 0,
  adventure: 0,
  mystery: 0,
  scifi: 0,
  romance: 0,
  horror: 0,
  humor: 0,
  fairytale: 0
};

const RESET_INTENSITY = {
  violence: 0,
  gore: 0,
  scary: 0,
  romance: 0,
  language: 0,
  adultContent: 0,
  sensuality: 0,
  explicitness: 0,
  bleakness: 25,
  sexualViolence: 0
};

const SUPPORTED_STORY_FORMATS = new Set(['picture_book', 'short_story', 'novella', 'novel', 'series']);
const STORY_FORMAT_ALIASES = {
  novel_chapter: 'novel',
  bedtime_story: 'short_story'
};

const AUDIENCE_ALIASES = {
  children: 'children',
  child: 'children',
  young_adult: 'general',
  all_ages: 'general',
  family: 'general',
  general: 'general',
  adult: 'mature',
  mature: 'mature'
};

function clampPercent(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeNumericMap(baseValues = {}, incomingValues = {}) {
  const normalized = { ...baseValues };
  if (!incomingValues || typeof incomingValues !== 'object') {
    return normalized;
  }

  Object.entries(incomingValues).forEach(([key, value]) => {
    const fallback = typeof normalized[key] === 'number' ? normalized[key] : 0;
    normalized[key] = clampPercent(value, fallback);
  });

  return normalized;
}

function normalizeAudienceValue(value, fallback = 'general') {
  const normalizedFallback = AUDIENCE_ALIASES[String(fallback || '').toLowerCase()] || 'general';
  if (!value) return normalizedFallback;
  return AUDIENCE_ALIASES[String(value).toLowerCase()] || normalizedFallback;
}

function normalizeStoryFormatValue(value, fallback = 'short_story') {
  const raw = String(value || '').toLowerCase();
  const mapped = STORY_FORMAT_ALIASES[raw] || raw;
  if (SUPPORTED_STORY_FORMATS.has(mapped)) return mapped;
  return SUPPORTED_STORY_FORMATS.has(fallback) ? fallback : 'short_story';
}

function enforceAudienceSafety(config, audienceOverride = null) {
  const audience = normalizeAudienceValue(audienceOverride || config?.audience, config?.audience || 'general');
  const intensity = normalizeNumericMap(DEFAULT_INTENSITY, config?.intensity || {});
  const genres = normalizeNumericMap(DEFAULT_GENRES, config?.genres || {});
  const safeConfig = {
    ...config,
    audience,
    intensity,
    genres
  };

  if (audience === 'children') {
    safeConfig.intensity = {
      ...safeConfig.intensity,
      violence: Math.min(safeConfig.intensity.violence, 10),
      gore: 0,
      scary: Math.min(safeConfig.intensity.scary, 15),
      romance: 0,
      language: 0,
      adultContent: 0,
      sensuality: 0,
      explicitness: 0,
      bleakness: Math.min(safeConfig.intensity.bleakness || 25, 25),
      sexualViolence: 0
    };
    safeConfig.genres = {
      ...safeConfig.genres,
      horror: Math.min(safeConfig.genres.horror, 10),
      romance: 0
    };
    return safeConfig;
  }

  if (audience === 'general') {
    safeConfig.intensity = {
      ...safeConfig.intensity,
      gore: 0,
      adultContent: 0,
      sensuality: 0,
      explicitness: 0,
      sexualViolence: 0
    };
    return safeConfig;
  }

  if (audience === 'mature') {
    safeConfig.intensity = {
      ...safeConfig.intensity,
      violence: Math.max(safeConfig.intensity.violence, 30),
      adultContent: safeConfig.intensity.adultContent || 0,
      sensuality: safeConfig.intensity.sensuality || 0,
      explicitness: safeConfig.intensity.explicitness || 0,
      bleakness: safeConfig.intensity.bleakness || 25,
      sexualViolence: safeConfig.intensity.sexualViolence || 0
    };
  }

  return safeConfig;
}

function normalizeIncomingConfig(baseConfig, incomingConfig = {}, options = {}) {
  const { resetGenres = false, resetIntensity = false } = options;
  const base = baseConfig || {};
  const incoming = incomingConfig || {};

  const normalizedBaseGenres = normalizeNumericMap(DEFAULT_GENRES, base.genres || {});
  const normalizedBaseIntensity = normalizeNumericMap(DEFAULT_INTENSITY, base.intensity || {});

  const merged = {
    ...base,
    ...incoming,
    story_format: normalizeStoryFormatValue(incoming.story_format ?? base.story_format, base.story_format || 'short_story'),
    audience: normalizeAudienceValue(incoming.audience ?? base.audience, base.audience || 'general'),
    genres: normalizeNumericMap(
      resetGenres ? DEFAULT_GENRES : normalizedBaseGenres,
      incoming.genres || {}
    ),
    intensity: normalizeNumericMap(
      resetIntensity ? DEFAULT_INTENSITY : normalizedBaseIntensity,
      incoming.intensity || {}
    )
  };

  return enforceAudienceSafety(merged, merged.audience);
}

function Configure() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();

  // ADVANCED MODE DETECTION - When coming from Story Bible
  const outlineId = searchParams.get('outline');
  const libraryId = searchParams.get('library');
  const isAdvancedMode = !!(outlineId && libraryId);

  // Standard mode continues below...
  // Generation summary is now display-only (no confirmation step)
  const [urlOutlineApplied, setUrlOutlineApplied] = useState(false);

  const [config, setConfig] = useState({
    // Story Type
    story_type: 'narrative', // 'narrative', 'cyoa'

    // Story Format
    story_format: 'short_story', // 'picture_book', 'short_story', 'novella', 'novel', 'series'

    // Genre Mix
    genres: { ...DEFAULT_GENRES },

    // Content Intensity (0-100)
    intensity: { ...DEFAULT_INTENSITY },

    // Audience Level
    audience: 'general', // 'children', 'general', 'mature'

    // Story settings
    story_length: 'medium',
    mood: 'calm', // Story mood: calm, exciting, scary, funny, mysterious, dramatic
    narrator_style: 'warm',
    cover_art_style: 'fantasy', // Cover art style: fantasy, storybook, painterly, anime, realistic, watercolor

    // Voice settings
    voice_id: null,
    multi_voice: false, // Voice acting (different voices for each character's dialogue)
    hide_speech_tags: false, // Hide speech attributions ("Ortiz suggests", "she whispered") when voice acting - OFF by default
    sfx_enabled: false, // Ambient sound effects (rain, footsteps, etc.) - OFF by default
    sfx_level: 'low', // SFX intensity: 'low' (default), 'medium' (more sounds), 'high' (lots of sounds)

    // CYOA settings
    cyoa_enabled: false,
    cyoa_settings: {
      auto_checkpoint: true,       // Auto-save at choice points
      show_choice_history: true,   // Show breadcrumb of past choices
      structure_type: 'diamond',   // 'linear', 'branching', 'diamond' (expand then converge)
      allow_backtrack: true,       // Allow going back to previous choices
      max_branches: 3              // Number of choices per decision point
    },

    // Series settings (for novels/series)
    series_settings: {
      protect_protagonist: true,   // Don't kill the main character
      recurring_characters: true,  // Allow characters to return in sequels
      open_ending: false,          // Leave threads for continuation
      character_growth: true,      // Track character development across entries
      series_name: ''              // Name for the series if applicable
    },

    // Plot structure settings
    plot_settings: {
      structure: 'three_act',      // 'three_act', 'hero_journey', 'episodic', 'anthology'
      ensure_resolution: true,     // Story must have proper ending
      cliffhanger_allowed: false   // For series: allow cliffhangers between entries
    },

    // Custom prompt - user's special requests
    custom_prompt: '', // e.g., "Write like Stephen King", "Include dragons", "Set in medieval Japan"

    // Author writing style (e.g., 'shakespeare', 'tolkien', 'king')
    author_style: 'none',

    // Director style for VAD production vision (e.g., 'hitchcock', 'spielberg')
    director_style: null
  });

  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [voicePrompt, setVoicePrompt] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);

  // Story Bible outlines
  const [storyBibleOutlines, setStoryBibleOutlines] = useState([]);
  const [selectedOutline, setSelectedOutline] = useState(null);
  const [showOutlineDropdown, setShowOutlineDropdown] = useState(false);

  // Auto-Select state - which sections should AI configure automatically
  const [autoSelect, setAutoSelect] = useState({
    story_type: true,
    story_format: true,
    story_length: true,
    genres: true,
    intensity: true,
    mood: true,
    narrator_style: true,
    narrator_voice: true,  // Smart voice selection based on genre
    writing_style: true
  });

  // Track which sections are currently being animated during auto-config
  const [animatingSections, setAnimatingSections] = useState({});

  // Accordion section states - collapsed by default on mobile for better UX
  const [expandedSections, setExpandedSections] = useState(() => {
    // On mobile (< 640px), start with sections collapsed
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    return {
      formatAndType: !isMobile,
      genreAndMood: !isMobile,
      styleAndVoice: !isMobile,
      advanced: false // Always start collapsed
    };
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Sync voice selection with config
  useEffect(() => {
    if (selectedVoice) {
      setConfig(prev => ({
        ...prev,
        voice_id: selectedVoice.voice_id || selectedVoice.key
      }));
    }
  }, [selectedVoice]);

  // Handle voice transcript and get AI suggestions
  const handleVoiceTranscript = async (transcript) => {
    setVoicePrompt(transcript);
    setIsProcessingVoice(true);

    try {
      const response = await apiCall('/config/interpret', {
        method: 'POST',
        body: JSON.stringify({ prompt: transcript, current_config: config })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.suggestion) {
          setAiSuggestion(data.suggestion);
        }
        if (data.config_updates) {
          setConfig(prev => normalizeIncomingConfig(prev, data.config_updates));
          if (data.config_updates.audience) {
            const normalizedAudience = normalizeAudienceValue(data.config_updates.audience, config.audience);
            setShowAdvanced(normalizedAudience === 'mature');
          }
        }
      }
    } catch (error) {
      console.error('Failed to interpret voice:', error);
      setAiSuggestion("I heard you! Use the controls below to configure your story.");
    } finally {
      setIsProcessingVoice(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadInitialData = async () => {
      await Promise.all([
        fetchDefaults(),
        fetchTemplates(),
        fetchStoryBibleOutlines(isMounted)
      ]);
    };
    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, []);

  const fetchDefaults = async () => {
    try {
      const response = await apiCall('/config/defaults');
      if (response.ok) {
        const data = await response.json();
        setConfig(prev => normalizeIncomingConfig(prev, data));
        const normalizedAudience = normalizeAudienceValue(data.audience, config.audience);
        setShowAdvanced(normalizedAudience === 'mature');
      }
    } catch (error) {
      console.error('Failed to fetch defaults:', error);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await apiCall('/config/templates');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.templates) {
          setTemplates(data.templates);
        }
      }
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    }
  };

  // Fetch outlines from Story Bible
  const fetchStoryBibleOutlines = async (isMounted = true) => {
    try {
      // First get all libraries
      const librariesResponse = await apiCall('/story-bible/libraries');
      if (!librariesResponse.ok || !isMounted) return;

      const librariesData = await librariesResponse.json();
      if (!librariesData.libraries || librariesData.libraries.length === 0) return;

      // For each library, fetch synopses with outlines
      const outlinesWithLibrary = [];
      for (const library of librariesData.libraries) {
        // Check if component is still mounted before each API call
        if (!isMounted) return;

        const synopsesResponse = await apiCall(`/story-bible/libraries/${library.id}/synopsis`);
        if (synopsesResponse.ok) {
          const synopsesData = await synopsesResponse.json();
          if (synopsesData.synopses) {
            // Filter synopses that have generated outlines
            const synopsesWithOutlines = synopsesData.synopses.filter(
              syn => syn.is_outline_generated && syn.outline_json
            );
            synopsesWithOutlines.forEach(synopsis => {
              outlinesWithLibrary.push({
                ...synopsis,
                library_name: library.name,
                library_id: library.id
              });
            });
          }
        }
      }

      // Only update state if component is still mounted
      if (isMounted) {
        setStoryBibleOutlines(outlinesWithLibrary);
      }
    } catch (error) {
      console.error('Failed to fetch Story Bible outlines:', error);
    }
  };

  // Auto-apply outline from URL parameter (when coming from Story Bible)
  useEffect(() => {
    const outlineId = searchParams.get('outline');
    if (outlineId && storyBibleOutlines.length > 0 && !urlOutlineApplied) {
      // Find the outline in our fetched list
      const outline = storyBibleOutlines.find(o => o.id === outlineId);
      if (outline) {
        console.log('[Configure] Auto-applying outline from URL:', outline.title || outline.id);
        applyStoryBibleOutline(outline);
        setUrlOutlineApplied(true);
      }
    }
  }, [searchParams, storyBibleOutlines, urlOutlineApplied]);

  // Apply selected outline from Story Bible
  const applyStoryBibleOutline = (outline) => {
    setSelectedOutline(outline);
    setShowOutlineDropdown(false);

    // Build a comprehensive premise from the outline
    let premiseText = '';

    // Add title if available
    if (outline.title) {
      premiseText += `Title: ${outline.title}\n\n`;
    }

    // Add logline/summary
    if (outline.logline) {
      premiseText += `${outline.logline}\n\n`;
    } else if (outline.summary) {
      premiseText += `${outline.summary}\n\n`;
    }

    // Add outline chapters if available
    if (outline.outline_json) {
      try {
        const outlineData = typeof outline.outline_json === 'string'
          ? JSON.parse(outline.outline_json)
          : outline.outline_json;

        if (outlineData.chapters && outlineData.chapters.length > 0) {
          premiseText += 'Outline:\n';
          outlineData.chapters.forEach((chapter, idx) => {
            premiseText += `${idx + 1}. ${chapter.title || `Chapter ${idx + 1}`}: ${chapter.summary || ''}\n`;
          });
        }
      } catch (e) {
        console.error('Failed to parse outline JSON:', e);
      }
    }

    // Update the config with the outline premise
    setConfig(prev => ({
      ...prev,
      custom_prompt: premiseText.trim(),
      // Store reference to the source outline
      story_bible_outline_id: outline.id,
      story_bible_library_id: outline.library_id
    }));

    // Clear any previous template selection
    setSelectedTemplate(null);

    // Show success message
    setAnalysisResult({
      success: true,
      reasoning: [
        `Using outline from Story Bible: "${outline.title || 'Untitled'}"`,
        `Library: ${outline.library_name}`,
        'Click "Craft Story" to auto-configure settings based on this outline'
      ],
      sectionsUpdated: ['premise']
    });
  };

  const applyTemplate = async (templateId) => {
    setIsApplyingTemplate(true);
    setSelectedTemplate(templateId);
    try {
      const response = await apiCall('/config/templates/apply', {
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId,
          current_config: config
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.config) {
          setConfig(prev => {
            const merged = normalizeIncomingConfig(prev, data.config);
            return {
              ...merged,
              // CYOA enabled ONLY if story_type is explicitly 'cyoa' - prevents false positives
              cyoa_enabled: merged.story_type === 'cyoa',
              multi_voice: data.config.voice_acted ?? data.config.multi_narrator ?? merged.multi_voice
            };
          });
          const normalizedAudience = normalizeAudienceValue(data.config.audience, config.audience);
          setShowAdvanced(normalizedAudience === 'mature');

          // Clear any premise analysis since we're using a template
          setAnalysisResult({
            success: true,
            reasoning: [`Applied template: ${data.template.name}`, data.template.description],
            sectionsUpdated: ['all']
          });
        }
      }
    } catch (error) {
      console.error('Failed to apply template:', error);
    } finally {
      setIsApplyingTemplate(false);
    }
  };

  // Analyze premise and auto-configure settings
  const analyzePremise = async () => {
    if (!config.custom_prompt || config.custom_prompt.trim().length < 10) {
      setAnalysisResult({ error: 'Please enter a story premise (at least 10 characters)' });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);

    // Start animation on enabled sections
    const sectionsToAnimate = {};
    Object.entries(autoSelect).forEach(([key, enabled]) => {
      if (enabled) sectionsToAnimate[key] = true;
    });
    setAnimatingSections(sectionsToAnimate);

    try {
      const response = await apiCall('/config/smart-interpret', {
        method: 'POST',
        body: JSON.stringify({
          premise: config.custom_prompt,
          current_config: config
        })
      });

      if (response.ok) {
        const data = await response.json();

        // ========== AUTO-DETECT DEBUG LOGGING (to server) ==========
        configLog.info(`AUTO_DETECT_RESPONSE | success: ${data.success} | voice_acted: ${data.suggestedConfig?.voice_acted ?? data.suggestedConfig?.multi_narrator} | sfx_enabled: ${data.suggestedConfig?.sfx_enabled} | sfx_level: ${data.suggestedConfig?.sfx_level}`);
        configLog.info(`AUTO_DETECT_FULL | ${JSON.stringify(data.suggestedConfig)}`);
        // ========== END AUTO-DETECT DEBUG LOGGING ==========

        if (data.success && data.suggestedConfig) {
          const suggestedAudience = data.suggestedConfig.audience
            ? normalizeAudienceValue(data.suggestedConfig.audience, config.audience)
            : null;
          const suggestedStoryFormat = data.suggestedConfig.story_format
            ? normalizeStoryFormatValue(data.suggestedConfig.story_format, config.story_format)
            : null;

          // Apply suggested configuration ONLY to sections with auto-select enabled
          setConfig(prev => {
            const newConfig = { ...prev };

            // RESET genres to defaults ALWAYS when auto-select is enabled
            // This ensures old values don't persist between Auto-Detect runs
            if (autoSelect.genres) {
              newConfig.genres = normalizeNumericMap(RESET_GENRES, data.suggestedConfig.genres || {});
            }

            // RESET intensity to defaults ALWAYS when auto-select is enabled
            if (autoSelect.intensity) {
              newConfig.intensity = normalizeNumericMap(RESET_INTENSITY, data.suggestedConfig.intensity || {});
            }

            // Only apply mood if auto-select enabled
            if (autoSelect.mood && data.suggestedConfig.mood) {
              newConfig.mood = data.suggestedConfig.mood;
            }

            // Only apply narrator_style if auto-select enabled
            if (autoSelect.narrator_style && data.suggestedConfig.narrator_style) {
              newConfig.narrator_style = data.suggestedConfig.narrator_style;
            }

            // Only apply audience if auto-select enabled (part of intensity section)
            if (autoSelect.intensity && suggestedAudience) {
              newConfig.audience = suggestedAudience;
            }

            // Only apply story_type if auto-select enabled
            if (autoSelect.story_type && data.suggestedConfig.story_type) {
              newConfig.story_type = data.suggestedConfig.story_type;
            }

            // Only apply story_format if auto-select enabled
            if (autoSelect.story_format && suggestedStoryFormat) {
              newConfig.story_format = suggestedStoryFormat;
            }

            // CYOA enabled - MUST be synchronized with story_type
            // Only enable CYOA if story_type is explicitly 'cyoa' - prevents false positives
            if (autoSelect.story_type) {
              newConfig.cyoa_enabled = (newConfig.story_type === 'cyoa');
            }

            // Writing style (author_style)
            if (autoSelect.writing_style && data.suggestedConfig.author_style) {
              newConfig.author_style = data.suggestedConfig.author_style;
            }

            // Voice acting (voice_acted/multi_narrator maps to multi_voice)
            // P0: Check for explicit negation FIRST, then enable
            const voiceActedDisabled = data.suggestedConfig.voice_acted_explicitly_disabled ?? data.suggestedConfig.multi_narrator_explicitly_disabled;
            const voiceActed = data.suggestedConfig.voice_acted ?? data.suggestedConfig.multi_narrator;

            if (voiceActedDisabled === true) {
              configLog.info('AUTO_DETECT_APPLY | voice_acting=false (explicitly disabled by negation)');
              newConfig.multi_voice = false;
              newConfig.hide_speech_tags = false;
            } else if (voiceActed) {
              configLog.info('AUTO_DETECT_APPLY | voice_acting=true | hide_speech_tags=true');
              newConfig.multi_voice = true;
              newConfig.hide_speech_tags = true; // Recommended for voice acting
            }

            // Sound effects
            // P0: Check for explicit negation FIRST, then enable
            if (data.suggestedConfig.sfx_explicitly_disabled === true) {
              configLog.info('AUTO_DETECT_APPLY | sfx_enabled=false (explicitly disabled by negation)');
              newConfig.sfx_enabled = false;
              newConfig.sfx_level = null;
            } else if (data.suggestedConfig.sfx_enabled) {
              configLog.info('AUTO_DETECT_APPLY | sfx_enabled=true');
              newConfig.sfx_enabled = true;
            }

            // SFX Level (Default/More/Lots) - only apply if SFX not explicitly disabled
            if (!data.suggestedConfig.sfx_explicitly_disabled && data.suggestedConfig.sfx_level) {
              configLog.info(`AUTO_DETECT_APPLY | sfx_level=${data.suggestedConfig.sfx_level}`);
              newConfig.sfx_level = data.suggestedConfig.sfx_level;
            }

            // Log the final config state after all auto-detect changes
            configLog.info(`AUTO_DETECT_FINAL | multi_voice: ${newConfig.multi_voice} | hide_speech_tags: ${newConfig.hide_speech_tags} | sfx_enabled: ${newConfig.sfx_enabled} | sfx_level: ${newConfig.sfx_level}`);

            // Story length - respect autoSelect
            if (autoSelect.story_length && data.suggestedConfig.story_length) {
              newConfig.story_length = data.suggestedConfig.story_length;
            }

            // Bedtime mode
            if (data.suggestedConfig.bedtime_mode) {
              newConfig.bedtime_mode = true;
            }

            // Character count estimation
            if (data.suggestedConfig.character_count) {
              newConfig.character_count = data.suggestedConfig.character_count;
            }

            // Narrator voice - apply recommended voice if auto-select enabled AND user hasn't manually selected a voice
            // This respects explicit user selection over AI recommendation
            if (autoSelect.narrator_voice && data.suggestedConfig.recommended_voice?.voice_id && !selectedVoice) {
              newConfig.voice_id = data.suggestedConfig.recommended_voice.voice_id;
            }

            return enforceAudienceSafety(newConfig, newConfig.audience);
          });

          // Also update selectedVoice state for VoiceSelector component (only if user hasn't manually selected)
          // This prevents autoSelect from overwriting explicit user voice selections
          if (autoSelect.narrator_voice && data.suggestedConfig.recommended_voice?.voice_id && !selectedVoice) {
            setSelectedVoice({
              voice_id: data.suggestedConfig.recommended_voice.voice_id,
              name: data.suggestedConfig.recommended_voice.name,
              gender: data.suggestedConfig.recommended_voice.gender
            });
          }

          // CRITICAL: Sync showAdvanced with auto-detected audience
          // If LLM suggests mature content, auto-expand advanced sliders including Sexual Violence
          if (autoSelect.intensity && suggestedAudience) {
            if (suggestedAudience === 'mature') {
              setShowAdvanced(true);
            } else {
              // Hide advanced sliders for children and general
              setShowAdvanced(false);
            }
          }

          // Build reasoning list based on what was actually updated
          const appliedReasons = [];
          if (autoSelect.story_type) appliedReasons.push(`Story type: ${data.suggestedConfig.story_type || 'narrative'}`);
          if (autoSelect.story_format) appliedReasons.push(`Format: ${suggestedStoryFormat || 'short_story'}`);
          if (autoSelect.mood) appliedReasons.push(`Mood: ${data.suggestedConfig.mood || 'exciting'}`);
          if (autoSelect.genres) appliedReasons.push('Genre mix adjusted');
          if (autoSelect.intensity) {
            appliedReasons.push('Content intensity calibrated');
            if (suggestedAudience === 'mature') {
              appliedReasons.push('Audience: Mature (auto-detected)');
            }
          }
          if (autoSelect.narrator_style) appliedReasons.push(`Narrator style: ${data.suggestedConfig.narrator_style || 'dramatic'}`);
          if (autoSelect.narrator_voice && data.suggestedConfig.recommended_voice?.name) {
            appliedReasons.push(`Narrator voice: ${data.suggestedConfig.recommended_voice.name} (${data.suggestedConfig.recommended_voice.reason || 'best fit for genre'})`);
          }
          if (data.suggestedConfig.voice_acted ?? data.suggestedConfig.multi_narrator) appliedReasons.push('Voice acting enabled (character voices)');
          if (data.suggestedConfig.sfx_enabled) appliedReasons.push('Sound effects enabled');
          if (autoSelect.story_length && data.suggestedConfig.story_length) appliedReasons.push(`Story length: ${data.suggestedConfig.story_length}`);
          if (data.suggestedConfig.bedtime_mode) appliedReasons.push('Calm mode enabled (softer, lower-intensity)');
          if (data.suggestedConfig.character_count) {
            const cc = data.suggestedConfig.character_count;
            appliedReasons.push(`Character count: ${cc.min === cc.max ? cc.min : `${cc.min}-${cc.max}`} (${cc.confidence} confidence)`);
          }

          setAnalysisResult({
            success: true,
            reasoning: data.reasoning?.length ? data.reasoning : appliedReasons,
            suggestedConfig: data.suggestedConfig,
            sectionsUpdated: Object.keys(autoSelect).filter(k => autoSelect[k]),
            degraded: data.analysis?.keyword_fallback || data.analysis?.llm_failed || false
          });
        }
      } else {
        setAnalysisResult({ error: 'Failed to analyze premise' });
      }
    } catch (error) {
      console.error('Error analyzing premise:', error);
      setAnalysisResult({ error: 'Failed to analyze premise' });
    } finally {
      setIsAnalyzing(false);

      // Clear animations after a delay
      setTimeout(() => {
        setAnimatingSections({});
      }, 2000);
    }
  };

  const updateGenre = (genre, value) => {
    setConfig(prev => ({
      ...prev,
      genres: { ...prev.genres, [genre]: value }
    }));
  };

  const updateIntensity = (key, value) => {
    setConfig(prev => ({
      ...prev,
      intensity: { ...prev.intensity, [key]: value }
    }));
  };

  const updateCyoaSetting = (key, value) => {
    setConfig(prev => ({
      ...prev,
      cyoa_settings: { ...prev.cyoa_settings, [key]: value }
    }));
  };

  const updateSeriesSetting = (key, value) => {
    setConfig(prev => ({
      ...prev,
      series_settings: { ...prev.series_settings, [key]: value }
    }));
  };

  const updatePlotSetting = (key, value) => {
    setConfig(prev => ({
      ...prev,
      plot_settings: { ...prev.plot_settings, [key]: value }
    }));
  };

  // Check if format supports series features
  const isSeriesFormat = ['novel', 'series'].includes(config.story_format);
  const isIllustratedFormat = config.story_format === 'picture_book';

  // Check if content is child-safe
  const isChildSafe = Object.values(config.intensity).every(v => v <= 10);

  // Auto-adjust for audience
  const setAudience = (audience) => {
    const normalizedAudience = normalizeAudienceValue(audience, config.audience);
    setConfig(prev => enforceAudienceSafety({ ...prev, audience: normalizedAudience }, normalizedAudience));

    // P1 FIX (Issues 20-21): Auto-show advanced content sliders for mature audience
    // This ensures adult content sliders are visible by default when Mature is selected
    if (normalizedAudience === 'mature') {
      setShowAdvanced(true);
    } else {
      // Hide advanced sliders for children AND general audiences
      // BUG FIX: Previously only children was explicitly handled, leaving general with stale state
      setShowAdvanced(false);
    }
  };

  const startStory = async () => {
    setIsStarting(true);
    try {
      let targetSessionId = sessionId;

      // Build the complete config object
      const fullConfig = {
        ...config,
        voice_id: selectedVoice?.voice_id || selectedVoice?.key || config.voice_id,
        // CYOA enabled ONLY if story_type is explicitly 'cyoa' - prevents false positives
        cyoa_enabled: config.story_type === 'cyoa',
        // Narrator style settings for ElevenLabs
        narratorStyleSettings: getNarratorStyleSettings(config.narrator_style)
      };

      // Remove null/undefined values that don't pass Zod schema validation
      // Schema uses .optional() which only accepts undefined, not null
      const nullKeys = Object.keys(fullConfig).filter(key => fullConfig[key] === null);
      console.log('[CONFIG NULL CLEANUP] Keys with null values BEFORE cleanup:', nullKeys);
      console.log('[CONFIG NULL CLEANUP] Full config BEFORE cleanup:', JSON.stringify(fullConfig, null, 2));

      Object.keys(fullConfig).forEach(key => {
        if (fullConfig[key] === null) {
          delete fullConfig[key];
        }
      });

      console.log('[CONFIG NULL CLEANUP] Keys with null values AFTER cleanup:',
        Object.keys(fullConfig).filter(key => fullConfig[key] === null));
      console.log('[CONFIG NULL CLEANUP] Full config AFTER cleanup:', JSON.stringify(fullConfig, null, 2));

      // ========== COMPREHENSIVE CONFIG DEBUG LOGGING (to server) ==========
      configLog.info('START_STORY | beginning config capture');

      // Critical toggles (most important for debugging)
      configLog.info(`CRITICAL_TOGGLES | multi_voice: ${config.multi_voice} | hide_speech_tags: ${config.hide_speech_tags} | sfx_enabled: ${config.sfx_enabled} | sfx_level: ${config.sfx_level || 'default'}`);

      // Text inputs summary
      configLog.info(`TEXT_INPUTS | premise_length: ${config.premise?.length || 0} | genre: ${config.genre || 'empty'} | audience: ${config.audience || 'empty'} | story_type: ${config.story_type || 'empty'}`);

      // Voice settings
      configLog.info(`VOICE | config_voice_id: ${config.voice_id || 'null'} | selected_voice_id: ${selectedVoice?.voice_id || selectedVoice?.key || 'null'} | final: ${fullConfig.voice_id || 'null'}`);

      // Intensity sliders
      configLog.info(`INTENSITY | violence: ${config.intensity?.violence} | gore: ${config.intensity?.gore} | scary: ${config.intensity?.scary} | romance: ${config.intensity?.romance} | language: ${config.intensity?.language} | adult: ${config.intensity?.adultContent}`);

      // Full config as JSON (compact)
      configLog.info(`FULL_CONFIG | ${JSON.stringify(fullConfig)}`);

      // Request body
      const requestBody = {
        mode: 'advanced',
        bedtime_mode: config.audience === 'children',
        cyoa_enabled: fullConfig.cyoa_enabled,
        config: fullConfig
      };
      configLog.info(`REQUEST_BODY | ${JSON.stringify(requestBody)}`);
      // ========== END CONFIG DEBUG LOGGING ==========

      // Create session if we don't have one
      if (!targetSessionId) {
        console.log('[API REQUEST] Sending to /stories/start:', JSON.stringify(requestBody, null, 2));

        const response = await apiCall('/stories/start', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });

        console.log('[API RESPONSE] Status:', response.status, response.statusText);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('[API VALIDATION ERROR] Error data:', errorData);
          const errorMessage = errorData.error?.message || errorData.error || errorData.message || response.statusText;
          const details = errorData.error?.details || [];
          const detailsText = details.length > 0
            ? ` | Details: ${details.map(d => `${d.field}: ${d.message}`).join('; ')}`
            : '';
          throw new Error(`Failed to create session: ${errorMessage}${detailsText}`);
        }
        const data = await response.json();
        console.log('[API RESPONSE] Success data:', data);
        targetSessionId = data.session_id;
      } else {
        // Update existing session config
        const configResponse = await apiCall(`/stories/${targetSessionId}/configure`, {
          method: 'POST',
          body: JSON.stringify({
            input: JSON.stringify(fullConfig),
            input_type: 'config'
          })
        });

        if (!configResponse.ok) {
          const errorData = await configResponse.json().catch(() => ({ error: 'Unknown error' }));
          const errorMessage = errorData.error?.message || errorData.error || errorData.message || configResponse.statusText;
          const details = errorData.error?.details || [];
          const detailsText = details.length > 0
            ? ` | Details: ${details.map(d => `${d.field}: ${d.message}`).join('; ')}`
            : '';
          throw new Error(`Failed to update session config: ${errorMessage}${detailsText}`);
        }
      }

      navigate(`/story/${targetSessionId}`);
    } catch (error) {
      console.error('Failed to start story:', error);
      setIsStarting(false);
    }
  };

  // Get narrator style settings for ElevenLabs V3
  // All 8 official styles + auto (LLM-determined)
  const getNarratorStyleSettings = (style) => {
    const settings = {
      // Original 4 styles (refined for V3)
      warm: { stability: 0.65, similarity_boost: 0.75, style: 20, v3_emotion: 'calm' },
      dramatic: { stability: 0.45, similarity_boost: 0.85, style: 50, v3_emotion: 'excited' },
      playful: { stability: 0.55, similarity_boost: 0.7, style: 40, v3_emotion: 'excited' },
      mysterious: { stability: 0.7, similarity_boost: 0.8, style: 35, v3_emotion: 'whisper' },
      // New styles for complete coverage
      horror: { stability: 0.75, similarity_boost: 0.85, style: 30, v3_emotion: 'fearful' },
      epic: { stability: 0.4, similarity_boost: 0.9, style: 60, v3_emotion: 'excited' },
      whimsical: { stability: 0.5, similarity_boost: 0.7, style: 45, v3_emotion: 'surprised' },
      noir: { stability: 0.8, similarity_boost: 0.75, style: 25, v3_emotion: 'calm' },
      // Auto mode - LLM will determine based on genre/mood
      auto: { stability: 0.55, similarity_boost: 0.8, style: 35, v3_emotion: 'auto' }
    };
    return settings[style] || settings.auto;
  };

  // If advanced mode, render the dedicated AdvancedConfigureStory component
  if (isAdvancedMode) {
    return <AdvancedConfigureStory outlineId={outlineId} libraryId={libraryId} />;
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center p-4 bg-slate-900/90 backdrop-blur">
        <button onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-6 h-6 text-slate-300" />
        </button>
        <h1 className="flex-1 text-center text-xl font-semibold text-golden-400">
          Configure Story
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/story-bible')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                       bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30"
            title="Advanced Mode - Story Bible & World Building"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Advanced</span>
          </button>
          <UserProfile />
        </div>
      </header>

      <main className="px-4 py-4 space-y-6 max-w-2xl mx-auto">
        {/* Story Premise - PRIMARY INPUT - first thing users see */}
        <section className="bg-gradient-to-br from-golden-400/10 to-slate-900/50 rounded-2xl p-4 border border-golden-400/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-medium text-golden-400 flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Story Premise
                {selectedOutline && (
                  <span className="text-xs text-purple-400 font-normal">(from Story Bible)</span>
                )}
              </h2>
              {/* Quick Auto-Detect button next to title */}
              <button
                onClick={analyzePremise}
                disabled={isAnalyzing || !config.custom_prompt || config.custom_prompt.trim().length < 10}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                  isAnalyzing
                    ? 'bg-golden-400 text-slate-900 animate-pulse'
                    : config.custom_prompt && config.custom_prompt.trim().length >= 10
                      ? 'bg-golden-400 hover:bg-golden-500 text-slate-900'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-3 h-3 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                    <span className="hidden sm:inline">Detecting...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    <span className="hidden sm:inline">Craft Story</span>
                    <span className="sm:hidden">Craft</span>
                  </>
                )}
              </button>
            </div>
          </div>
          <p className="text-slate-400 text-sm mb-3">
            Describe your story idea, then click <span className="text-golden-400 font-medium">Craft Story</span> to auto-configure.
          </p>
          <textarea
            value={config.custom_prompt}
            onChange={(e) => setConfig(prev => ({ ...prev, custom_prompt: e.target.value }))}
            placeholder="Examples:
• 5 men and 5 women debate which of them is an alien imposter in a violent horror scifi mystery
• A cozy low-stakes tale about a brave mouse who saves the forest
• Epic fantasy adventure with dragons, magic, and a kingdom in peril
• Interactive choose-your-own-adventure mystery in a haunted mansion"
            className="w-full h-28 px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-slate-100 placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-golden-400 focus:ring-1 focus:ring-golden-400/30"
          />

          {/* Quick tags */}
          <div className="mt-2 flex flex-wrap gap-2">
            {['Horror', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Interactive'].map(tag => (
              <button
                key={tag}
                onClick={() => {
                  const tagLower = tag.toLowerCase();
                  if (!config.custom_prompt.toLowerCase().includes(tagLower)) {
                    setConfig(prev => ({
                      ...prev,
                      custom_prompt: prev.custom_prompt
                        ? `${prev.custom_prompt} ${tagLower}`
                        : tagLower
                    }));
                  }
                }}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded-full text-slate-300 transition-all"
              >
                +{tag}
              </button>
            ))}
          </div>

          {/* Analysis result */}
          {analysisResult && (
            <div className={`mt-3 p-3 rounded-xl text-sm ${
              analysisResult.success && !analysisResult.degraded
                ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                : analysisResult.success && analysisResult.degraded
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                  : 'bg-red-500/10 border border-red-500/30 text-red-300'
            }`}>
              {analysisResult.success ? (
                <>
                  <div className="font-medium mb-1">
                    {analysisResult.degraded
                      ? 'Settings configured (keyword-based — AI temporarily unavailable)'
                      : 'Settings auto-configured!'}
                  </div>
                  {analysisResult.degraded && (
                    <div className="text-xs text-amber-400/80 mb-2">
                      AI analysis hit a rate limit. Settings were inferred from keywords in your premise and may be less precise. You can retry later or adjust manually.
                    </div>
                  )}
                  <ul className="text-xs space-y-1 text-slate-300">
                    {(Array.isArray(analysisResult.reasoning)
                      ? analysisResult.reasoning
                      : (analysisResult.reasoning || '').split('\n').filter(Boolean)
                    ).map((reason, i) => (
                      <li key={i}>• {reason}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <div>{analysisResult.error}</div>
              )}
            </div>
          )}
        </section>

        {/* Voice Configuration - Alternative input method */}
        <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 border border-slate-700">
          <div className="flex items-center gap-3 mb-3">
            <VoiceRecorder onTranscript={handleVoiceTranscript} size="large" />
            <div className="flex-1">
              <h2 className="text-lg font-medium text-golden-400 flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Tell me your story
              </h2>
              <p className="text-slate-400 text-sm">
                Tap the mic and describe what you want
              </p>
            </div>
          </div>

          {voicePrompt && (
            <div className="mt-3 p-3 bg-slate-900/50 rounded-xl">
              <p className="text-slate-300 text-sm italic">"{voicePrompt}"</p>
            </div>
          )}

          {aiSuggestion && (
            <div className="mt-3 p-3 bg-golden-400/10 rounded-xl border border-golden-400/30">
              <p className="text-slate-100 text-sm">{aiSuggestion}</p>
            </div>
          )}

          {isProcessingVoice && (
            <div className="mt-3 flex items-center gap-2 text-slate-400 text-sm">
              <div className="w-4 h-4 border-2 border-golden-400 border-t-transparent rounded-full animate-spin" />
              Thinking...
            </div>
          )}
        </section>

        {/* Story Bible Outline Selector - for advanced users with existing outlines */}
        {storyBibleOutlines.length > 0 && (
          <section className="bg-gradient-to-br from-purple-500/10 to-slate-900/50 rounded-2xl p-4 border border-purple-500/30">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-medium text-purple-400 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Or Use Story Bible Outline
              </h2>
              <button
                onClick={() => navigate('/story-bible')}
                className="text-xs text-purple-400/70 hover:text-purple-300 flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                Edit
              </button>
            </div>
            <p className="text-slate-400 text-sm mb-3">
              Select a pre-built outline from your Story Bible
            </p>

            <div className="relative">
              <button
                onClick={() => setShowOutlineDropdown(!showOutlineDropdown)}
                className={`w-full px-4 py-3 bg-slate-900 border rounded-xl text-left flex items-center justify-between transition-all ${
                  selectedOutline
                    ? 'border-purple-500 text-slate-100'
                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}
              >
                <span className="truncate">
                  {selectedOutline
                    ? `${selectedOutline.title || 'Untitled'} (${selectedOutline.library_name})`
                    : 'Select an outline...'}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showOutlineDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showOutlineDropdown && (
                <div className="absolute z-20 mt-2 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-xl overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {storyBibleOutlines.map(outline => (
                      <button
                        key={outline.id}
                        onClick={() => {
                          setSelectedOutline(outline);
                          setShowOutlineDropdown(false);
                          setConfig(prev => ({
                            ...prev,
                            custom_prompt: outline.full_synopsis || outline.logline || ''
                          }));
                        }}
                        className={`w-full p-3 text-left hover:bg-slate-700 border-b border-slate-700 last:border-b-0 ${
                          selectedOutline?.id === outline.id ? 'bg-purple-500/20' : ''
                        }`}
                      >
                        <div className="font-medium text-slate-100">{outline.title || 'Untitled'}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{outline.library_name}</div>
                        {outline.logline && (
                          <div className="text-xs text-slate-400 mt-1 line-clamp-2">{outline.logline}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {selectedOutline && (
              <div className="mt-3 p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                <p className="text-purple-200 text-sm font-medium mb-1">{selectedOutline.title || 'Untitled'}</p>
                <p className="text-slate-400 text-xs">
                  This outline will be used as your story premise. Click "Craft Story" above to auto-configure.
                </p>
              </div>
            )}
          </section>
        )}

        {/* Quick Templates / Presets */}
        {templates.length > 0 && (
          <section className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-2xl p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium text-slate-100 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                Quick Presets
              </h2>
              {selectedTemplate && (
                <button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setAnalysisResult(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 bg-slate-700 rounded"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-slate-400 text-sm mb-3">
              One-click story configurations for common scenarios
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {templates.map(template => (
                <button
                  key={template.id}
                  onClick={() => applyTemplate(template.id)}
                  disabled={isApplyingTemplate}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    selectedTemplate === template.id
                      ? 'border-amber-400 bg-amber-400/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800'
                  } ${isApplyingTemplate && selectedTemplate === template.id ? 'animate-pulse' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{template.icon}</span>
                    <span className="text-slate-100 text-sm font-medium truncate">{template.name}</span>
                  </div>
                  <div className="text-slate-500 text-xs line-clamp-2">{template.description}</div>
                </button>
              ))}
            </div>
            {isApplyingTemplate && (
              <div className="mt-3 flex items-center gap-2 text-amber-400 text-sm">
                <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                Applying template...
              </div>
            )}
          </section>
        )}

        {/* ACCORDION: Format & Type */}
        <AccordionSection
          id="formatAndType"
          title="Format & Type"
          icon={BookOpen}
          expanded={expandedSections.formatAndType}
          onToggle={toggleSection}
          badge={`${config.story_format?.replace(/_/g, ' ')} • ${config.audience}`}
        >
          {/* Story Type */}
          <section className={`transition-all duration-500 ${animatingSections.story_type ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-slate-100 flex items-center gap-2">
                <Swords className="w-4 h-4 text-golden-400" />
                Story Type
              </h3>
            </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'narrative', label: 'Story', desc: 'Listen & enjoy', icon: '📖' },
              { id: 'cyoa', label: 'Adventure', desc: 'You make choices', icon: '🔀' }
            ].map(type => (
              <button
                key={type.id}
                onClick={() => setConfig(prev => ({ ...prev, story_type: type.id }))}
                className={`p-4 rounded-xl border-2 transition-all ${
                  config.story_type === type.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-2xl mb-1">{type.icon}</div>
                <div className="text-slate-100 font-medium text-sm">{type.label}</div>
                <div className="text-slate-400 text-xs">{type.desc}</div>
              </button>
            ))}
          </div>
        </section>

          {/* Story Format */}
          <section className={`transition-all duration-500 ${animatingSections.story_format ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-slate-100 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-golden-400" />
                Story Format
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'picture_book', label: 'Picture Book', desc: 'Simple story with images, perfect for young children', icon: '🖼️', time: '~5 min' },
                { id: 'short_story', label: 'Short Story', desc: 'Complete tale in one sitting for a quick listen', icon: '📄', time: '5-15 min' },
                { id: 'novella', label: 'Novella', desc: 'Deeper plot and characters, multiple chapters', icon: '📖', time: '30-60 min' },
                { id: 'novel', label: 'Novel', desc: 'Full-length epic saga, saved across sessions', icon: '📚', time: 'Multi-session' },
                { id: 'series', label: 'Series', desc: 'Connected books with recurring characters', icon: '📚📚', time: 'Ongoing' }
              ].map(format => (
                <button
                  key={format.id}
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    story_format: format.id,
                    // Auto-sync length based on format
                    story_length: format.id === 'picture_book' ? 'short' :
                                  format.id === 'short_story' ? 'short' :
                                  format.id === 'novella' ? 'medium' :
                                  format.id === 'novel' ? 'long' :
                                  format.id === 'series' ? 'long' : prev.story_length
                  }))}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    config.story_format === format.id
                      ? 'border-golden-400 bg-slate-800'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{format.icon}</span>
                    <span className="text-slate-100 font-medium text-sm">{format.label}</span>
                  </div>
                  <div className="text-slate-400 text-xs">{format.desc}</div>
                  <div className="text-slate-500 text-xs mt-1">{format.time}</div>
                </button>
              ))}
            </div>
            {config.story_format === 'picture_book' && (
              <p className="text-golden-400/80 text-xs mt-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Will include AI-generated illustrations
              </p>
            )}
          </section>

        {/* Series Settings - only show for novel/series formats */}
        {isSeriesFormat && (
          <section className="bg-slate-800/50 rounded-2xl p-4 border border-emerald-500/30">
            <h2 className="text-lg font-medium text-emerald-300 mb-4 flex items-center gap-2">
              <Library className="w-5 h-5" />
              Series Settings
            </h2>

            {/* Series Name */}
            {config.story_format === 'series' && (
              <div className="mb-4">
                <label className="text-slate-300 text-sm mb-2 block">Series Name (optional)</label>
                <input
                  type="text"
                  value={config.series_settings.series_name}
                  onChange={(e) => updateSeriesSetting('series_name', e.target.value)}
                  placeholder="The Chronicles of..."
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-emerald-400 focus:outline-none"
                />
              </div>
            )}

            {/* Toggles */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-200 text-sm">Protect protagonist</span>
                  <p className="text-slate-500 text-xs">Main character survives for sequels</p>
                </div>
                <AccessibleToggle
                  enabled={config.series_settings.protect_protagonist}
                  onChange={(value) => updateSeriesSetting('protect_protagonist', value)}
                  label="Protect protagonist"
                  description="Main character survives for sequels"
                  colorOn="bg-emerald-500"
                  showLabel={true}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-200 text-sm">Recurring characters</span>
                  <p className="text-slate-500 text-xs">Characters can return in sequels</p>
                </div>
                <AccessibleToggle
                  enabled={config.series_settings.recurring_characters}
                  onChange={(value) => updateSeriesSetting('recurring_characters', value)}
                  label="Recurring characters"
                  description="Characters can return in sequels"
                  colorOn="bg-emerald-500"
                  showLabel={true}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-200 text-sm">Open ending</span>
                  <p className="text-slate-500 text-xs">Leave threads for continuation</p>
                </div>
                <AccessibleToggle
                  enabled={config.series_settings.open_ending}
                  onChange={(value) => updateSeriesSetting('open_ending', value)}
                  label="Open ending"
                  description="Leave threads for continuation"
                  colorOn="bg-emerald-500"
                  showLabel={true}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-200 text-sm">Character growth</span>
                  <p className="text-slate-500 text-xs">Track development across entries</p>
                </div>
                <AccessibleToggle
                  enabled={config.series_settings.character_growth}
                  onChange={(value) => updateSeriesSetting('character_growth', value)}
                  label="Character growth"
                  description="Track development across entries"
                  colorOn="bg-emerald-500"
                  showLabel={true}
                />
              </div>
            </div>

            {/* Famous Series Examples */}
            <div className="mt-4 pt-3 border-t border-slate-700">
              <p className="text-slate-400 text-xs mb-2">Think of series like:</p>
              <div className="flex flex-wrap gap-2">
                {['Harry Potter', 'Narnia', 'Lord of the Rings', 'Conan', 'Discworld'].map(example => (
                  <span key={example} className="px-2 py-1 bg-slate-700/50 rounded-full text-slate-400 text-xs">
                    {example}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

          {/* Audience Level */}
          <section>
            <h3 className="text-base font-medium text-slate-100 mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-golden-400" />
              Audience
            </h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'children', label: 'Children', desc: 'Age 5-10', icon: '👶' },
              { id: 'general', label: 'General', desc: 'All ages', icon: '👨‍👩‍👧' },
              { id: 'mature', label: 'Mature', desc: 'Adults', icon: '🔞' }
            ].map(aud => (
              <button
                key={aud.id}
                onClick={() => setAudience(aud.id)}
                className={`p-3 rounded-xl border-2 transition-all min-h-[80px] ${
                  config.audience === aud.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-xl mb-1">{aud.icon}</div>
                <div className="text-slate-100 font-medium text-xs sm:text-sm">{aud.label}</div>
                <div className="text-slate-400 text-[10px] sm:text-xs">{aud.desc}</div>
              </button>
            ))}
          </div>
          {isChildSafe && config.audience !== 'children' && (
            <p className="text-green-400 text-xs mt-2 flex items-center gap-1">
              <Shield className="w-3 h-3" /> Content is currently child-safe
            </p>
          )}
        </section>

          {/* Story Length */}
          <section>
            <h3 className="text-base font-medium text-slate-100 mb-4">Story Length</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'short', label: 'Short', desc: '~5 min' },
              { id: 'medium', label: 'Medium', desc: '~15 min' },
              { id: 'long', label: 'Long', desc: '~30 min' }
            ].map(option => (
              <button
                key={option.id}
                onClick={() => setConfig(prev => ({ ...prev, story_length: option.id }))}
                className={`p-3 rounded-xl border-2 transition-all min-h-[70px] ${
                  config.story_length === option.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-slate-100 font-medium text-sm">{option.label}</div>
                <div className="text-slate-400 text-xs">{option.desc}</div>
              </button>
            ))}
          </div>
          {/* Show length recommendation based on format */}
          {config.story_format && (
            <p className="text-slate-500 text-xs mt-2">
              {config.story_format === 'picture_book' && 'Picture books usually work best under ~10 min'}
              {config.story_format === 'short_story' && 'Short stories work best at 5-15 min'}
              {config.story_format === 'novella' && 'Novellas typically run 15-30 min'}
              {config.story_format === 'novel' && 'Novels are best for long, multi-session arcs'}
              {config.story_format === 'series' && 'Series format works best for ongoing multi-session stories'}
              {!['picture_book', 'short_story', 'novella', 'novel', 'series'].includes(config.story_format) &&
                `Current format: ${config.story_format.replace(/_/g, ' ')}`
              }
            </p>
          )}
          </section>
        </AccordionSection>

        {/* Cover Art Style */}
        <section>
          <h2 className="text-lg font-medium text-slate-100 mb-2 flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-400" />
            Cover Art Style
          </h2>
          <p className="text-slate-400 text-sm mb-3">Visual style for your story's cover and scene images</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { id: 'fantasy', label: 'Fantasy', desc: 'Magical art', icon: '✨' },
              { id: 'storybook', label: 'Storybook', desc: 'Classic', icon: '📖' },
              { id: 'painterly', label: 'Painterly', desc: 'Oil painting', icon: '🎨' },
              { id: 'anime', label: 'Anime', desc: 'Japanese', icon: '⛩️' },
              { id: 'realistic', label: 'Realistic', desc: 'Photorealistic', icon: '📷' },
              { id: 'watercolor', label: 'Watercolor', desc: 'Soft, dreamy', icon: '🌸' }
            ].map(style => (
              <button
                key={style.id}
                onClick={() => setConfig(prev => ({ ...prev, cover_art_style: style.id }))}
                className={`p-3 rounded-xl border-2 transition-all text-left min-h-[60px] ${
                  config.cover_art_style === style.id
                    ? 'border-purple-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-base">{style.icon}</span>
                  <span className="text-slate-100 font-medium text-xs sm:text-sm">{style.label}</span>
                </div>
                <div className="text-slate-400 text-[10px] sm:text-xs">{style.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* NOTE: Story Premise section moved to top of page - see above */}

        {/* Plot Structure */}
        <section>
            <h2 className="text-lg font-medium text-slate-100 mb-4">Plot Structure</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'three_act', label: 'Three Act', desc: 'Classic structure', icon: '🎭' },
                { id: 'hero_journey', label: "Hero's Journey", desc: 'Epic quest arc', icon: '🦸' },
                { id: 'episodic', label: 'Episodic', desc: 'Self-contained scenes', icon: '📺' },
                { id: 'anthology', label: 'Anthology', desc: 'Connected short tales', icon: '📚' }
              ].map(structure => (
                <button
                  key={structure.id}
                  onClick={() => updatePlotSetting('structure', structure.id)}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    config.plot_settings.structure === structure.id
                      ? 'border-golden-400 bg-slate-800'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{structure.icon}</span>
                    <span className="text-slate-100 font-medium text-sm">{structure.label}</span>
                  </div>
                  <div className="text-slate-400 text-xs">{structure.desc}</div>
                </button>
              ))}
            </div>

            {/* Plot options */}
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
                <div>
                  <span className="text-slate-200 text-sm">Ensure proper ending</span>
                  <p className="text-slate-500 text-xs">Story reaches satisfying resolution</p>
                </div>
                <AccessibleToggle
                  enabled={config.plot_settings.ensure_resolution}
                  onChange={(value) => updatePlotSetting('ensure_resolution', value)}
                  label="Ensure proper ending"
                  description="Story reaches satisfying resolution"
                  colorOn="bg-cyan-500"
                  showLabel={true}
                />
              </div>

              {isSeriesFormat && (
                <div className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
                  <div>
                    <span className="text-slate-200 text-sm">Allow cliffhangers</span>
                    <p className="text-slate-500 text-xs">End entries with suspense for next</p>
                  </div>
                  <AccessibleToggle
                    enabled={config.plot_settings.cliffhanger_allowed}
                    onChange={(value) => updatePlotSetting('cliffhanger_allowed', value)}
                    label="Allow cliffhangers"
                    description="End entries with suspense for next"
                    colorOn="bg-cyan-500"
                    showLabel={true}
                  />
                </div>
              )}

            </div>
          </section>

        {/* Genre Mix */}
        <section className={`transition-all duration-500 ${animatingSections.genres ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-golden-400" />
              Genre Mix
            </h2>
          </div>
          <div className="space-y-4">
            <GenreSlider
              label="Fantasy"
              icon="🧙"
              value={config.genres.fantasy}
              onChange={(v) => updateGenre('fantasy', v)}
              sliderType="fantasy"
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Adventure"
              icon="⚔️"
              value={config.genres.adventure}
              onChange={(v) => updateGenre('adventure', v)}
              sliderType="adventure"
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Mystery"
              icon="🔍"
              value={config.genres.mystery}
              onChange={(v) => updateGenre('mystery', v)}
              sliderType="mystery"
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Sci-Fi"
              icon="🚀"
              value={config.genres.scifi}
              onChange={(v) => updateGenre('scifi', v)}
              sliderType="scifi"
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Fairy Tale"
              icon="🏰"
              value={config.genres.fairytale}
              onChange={(v) => updateGenre('fairytale', v)}
              sliderType="fairytale"
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Humor"
              icon="😄"
              value={config.genres.humor}
              onChange={(v) => updateGenre('humor', v)}
              sliderType="humor"
              animating={animatingSections.genres}
            />
            {config.audience !== 'children' && (
              <>
                <GenreSlider
                  label="Horror"
                  icon="👻"
                  value={config.genres.horror}
                  onChange={(v) => updateGenre('horror', v)}
                  sliderType="horror"
                  max={config.audience === 'mature' ? 100 : 50}
                  animating={animatingSections.genres}
                />
                <GenreSlider
                  label="Romance"
                  icon="💕"
                  value={config.genres.romance}
                  onChange={(v) => updateGenre('romance', v)}
                  sliderType="romance"
                  max={config.audience === 'mature' ? 100 : 30}
                  animating={animatingSections.genres}
                />
              </>
            )}
          </div>
        </section>

        {/* Content Intensity */}
        <section className={`transition-all duration-500 ${animatingSections.intensity ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100">Content Intensity</h2>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-golden-400 text-sm"
            >
              {showAdvanced ? 'Hide details' : 'Show all'}
            </button>
          </div>

          <div className="space-y-4">
            <GenreSlider
              label="Scariness"
              icon="😨"
              value={config.intensity.scary}
              onChange={(v) => updateIntensity('scary', v)}
              max={config.audience === 'children' ? 15 : 100}
              sliderType="scary"
              animating={animatingSections.intensity}
            />

            {config.audience !== 'children' && (
              <GenreSlider
                label="Violence"
                icon="⚔️"
                value={config.intensity.violence}
                onChange={(v) => updateIntensity('violence', v)}
                max={config.audience === 'mature' ? 100 : 50}
                sliderType="violence"
                threshold={config.audience === 'mature' ? PROVIDER_THRESHOLDS.violence : null}
                showProvider={config.audience === 'mature'}
                animating={animatingSections.intensity}
              />
            )}

            {/* Bleakness slider - visible for general and mature audiences */}
            {config.audience !== 'children' && (
              <GenreSlider
                label="Bleakness"
                icon="🌑"
                value={config.intensity.bleakness}
                onChange={(v) => updateIntensity('bleakness', v)}
                max={100}
                colorClass="from-slate-400 to-slate-700"
                sliderType="bleakness"
                animating={animatingSections.intensity}
              />
            )}

            {showAdvanced && config.audience !== 'children' && (
              <>
                {config.audience === 'mature' && (
                  <GenreSlider
                    label="Gore"
                    icon="🩸"
                    value={config.intensity.gore}
                    onChange={(v) => updateIntensity('gore', v)}
                    max={100}
                    sliderType="gore"
                    threshold={PROVIDER_THRESHOLDS.gore}
                    showProvider={true}
                    animating={animatingSections.intensity}
                  />
                )}

                <GenreSlider
                  label="Romance Level"
                  icon="💋"
                  value={config.intensity.romance}
                  onChange={(v) => updateIntensity('romance', v)}
                  max={config.audience === 'mature' ? 100 : 20}
                  sliderType="romance"
                  threshold={config.audience === 'mature' ? PROVIDER_THRESHOLDS.romance : null}
                  showProvider={config.audience === 'mature'}
                  animating={animatingSections.intensity}
                />

                <GenreSlider
                  label="Strong Language"
                  icon="🤬"
                  value={config.intensity.language}
                  onChange={(v) => updateIntensity('language', v)}
                  max={config.audience === 'mature' ? 50 : 10}
                  colorClass="from-gray-400 to-gray-600"
                  sliderType="language"
                  animating={animatingSections.intensity}
                />

                {config.audience === 'mature' && (
                  <>
                    <GenreSlider
                      label="Adult Content"
                      icon="🔞"
                      value={config.intensity.adultContent}
                      onChange={(v) => updateIntensity('adultContent', v)}
                      max={100}
                      colorClass="from-rose-400 to-fuchsia-600"
                      sliderType="adultContent"
                      threshold={PROVIDER_THRESHOLDS.adultContent}
                      showProvider={true}
                      animating={animatingSections.intensity}
                    />

                    {/* P1 FIX (Issue 21): Additional sliders for sexual content granularity */}
                    <GenreSlider
                      label="Sensuality"
                      icon="💫"
                      value={config.intensity.sensuality}
                      onChange={(v) => updateIntensity('sensuality', v)}
                      max={100}
                      colorClass="from-pink-300 to-pink-500"
                      sliderType="sensuality"
                      threshold={PROVIDER_THRESHOLDS.sensuality}
                      showProvider={true}
                      animating={animatingSections.intensity}
                    />

                    <GenreSlider
                      label="Explicitness"
                      icon="🔥"
                      value={config.intensity.explicitness}
                      onChange={(v) => updateIntensity('explicitness', v)}
                      max={100}
                      colorClass="from-orange-400 to-red-600"
                      sliderType="explicitness"
                      threshold={PROVIDER_THRESHOLDS.explicitness}
                      showProvider={true}
                      animating={animatingSections.intensity}
                    />

                    {/* Sexual Violence slider - mature only with strong warning */}
                    <div className="mt-4 pt-4 border-t border-red-900/30">
                      <div className="mb-2 p-2 rounded bg-red-950/50 border border-red-800/50">
                        <p className="text-red-400 text-xs">
                          ⚠️ <strong>Content Warning:</strong> This slider controls depictions of sexual assault.
                          Default is 0 (absent). Only enable if your story specifically requires this content type.
                        </p>
                      </div>
                      <GenreSlider
                        label="Sexual Violence"
                        icon="⚠️"
                        value={config.intensity.sexualViolence}
                        onChange={(v) => updateIntensity('sexualViolence', v)}
                        max={100}
                        colorClass="from-red-800 to-red-950"
                        sliderType="sexualViolence"
                        threshold={PROVIDER_THRESHOLDS.sexualViolence}
                        showProvider={true}
                        animating={animatingSections.intensity}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <p className="text-slate-400 text-sm mt-2">
            {config.audience === 'children'
              ? 'Content limits enforced for young audiences'
              : 'Adjust how intense the story moments can be'}
          </p>

          {/* Provider split indicator for mature content */}
          <ProviderIndicator
            intensity={config.intensity}
            audience={config.audience}
            genres={config.genres}
          />
        </section>

        {/* Story Mood */}
        <section className={`transition-all duration-500 ${animatingSections.mood ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100">Story Mood</h2>
          </div>
          <p className="text-slate-400 text-sm mb-3">What feeling should the story evoke?</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { id: 'calm', label: 'Calm', icon: '😌' },
              { id: 'exciting', label: 'Exciting', icon: '⚡' },
              { id: 'scary', label: 'Scary', icon: '😨' },
              { id: 'funny', label: 'Funny', icon: '😄' },
              { id: 'mysterious', label: 'Mysterious', icon: '🔮' },
              { id: 'dramatic', label: 'Dramatic', icon: '🎭' }
            ].map(mood => (
              <button
                key={mood.id}
                onClick={() => setConfig(prev => ({ ...prev, mood: mood.id }))}
                className={`p-3 rounded-xl border-2 transition-all text-center min-h-[70px] ${
                  config.mood === mood.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-2xl mb-1">{mood.icon}</div>
                <div className="text-slate-100 text-xs sm:text-sm font-medium">{mood.label}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Author Writing Style */}
        <AuthorStylePicker
          selectedStyle={config.author_style}
          onStyleChange={(style) => setConfig(prev => ({ ...prev, author_style: style }))}
          isAnimating={animatingSections.writing_style}
        />

        {/* Narrator Style - All 8 styles + Auto */}
        <section className={`transition-all duration-500 ${animatingSections.narrator_style ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100">Narrator Voice Style</h2>
          </div>
          <p className="text-slate-400 text-sm mb-3">How should the narrator sound?</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'auto', label: 'Auto', desc: 'LLM chooses based on genre', icon: '🤖' },
              { id: 'warm', label: 'Warm', desc: 'Soothing & comforting', icon: '🌙' },
              { id: 'dramatic', label: 'Dramatic', desc: 'Intense & theatrical', icon: '🎭' },
              { id: 'playful', label: 'Playful', desc: 'Light & fun energy', icon: '✨' },
              { id: 'mysterious', label: 'Mysterious', desc: 'Intriguing & dark', icon: '🌑' },
              { id: 'horror', label: 'Horror', desc: 'Creepy & unsettling', icon: '👻' },
              { id: 'epic', label: 'Epic', desc: 'Grand & sweeping', icon: '⚔️' },
              { id: 'whimsical', label: 'Whimsical', desc: 'Quirky & charming', icon: '🎪' },
              { id: 'noir', label: 'Noir', desc: 'Cynical & hard-boiled', icon: '🕵️' }
            ].map(style => (
              <button
                key={style.id}
                onClick={() => setConfig(prev => ({ ...prev, narrator_style: style.id }))}
                className={`p-2.5 rounded-xl border-2 transition-all text-left ${
                  config.narrator_style === style.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm">{style.icon}</span>
                  <span className="text-slate-100 text-xs font-medium">{style.label}</span>
                </div>
                <div className="text-slate-400 text-[10px] leading-tight">{style.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Voice Selection */}
        <section className={`transition-all duration-500 ${animatingSections.narrator_voice ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100 flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-golden-400" />
              Narrator Voice
            </h2>
          </div>
          <VoiceSelector
            selectedVoice={selectedVoice}
            onSelect={setSelectedVoice}
            narratorStyle={config.narrator_style}
            skipAutoSelect={autoSelect.narrator_voice}
          />
        </section>

        {/* Voice Acting Toggle */}
        <section>
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
            <div>
              <div className="text-slate-100 font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-golden-400" />
                Voice Acting
              </div>
              <div className="text-slate-400 text-sm">Different voices for each character's dialogue</div>
            </div>
            <AccessibleToggle
              enabled={config.multi_voice}
              onChange={(value) => setConfig(prev => ({
                ...prev,
                multi_voice: value,
                hide_speech_tags: value
              }))}
              label="Voice Acting"
              description="Dialogue voiced by different speakers (standard for audiobooks)"
              colorOn="bg-golden-400"
              size="large"
              showLabel={true}
            />
          </div>
        </section>

        {/* Hide Speech Tags Toggle - Always visible, below Voice Acting */}
        <section>
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
            <div>
              <div className="text-slate-100 font-medium flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-purple-400" />
                Hide Speech Tags
                {config.multi_voice && (
                  <span className="text-xs text-purple-400/70 font-normal">(auto-enabled)</span>
                )}
              </div>
              <div className="text-slate-400 text-sm">Remove "she said", "he whispered" from narration</div>
            </div>
            <AccessibleToggle
              enabled={config.hide_speech_tags}
              onChange={(value) => setConfig(prev => ({ ...prev, hide_speech_tags: value }))}
              label="Hide Speech Tags"
              description="Remove dialogue attribution like 'she said' from narration"
              colorOn="bg-purple-400"
              size="large"
              showLabel={true}
            />
          </div>
        </section>

        {/* Director Style Picker - Only visible when Voice Acting is enabled */}
        {config.multi_voice && (
          <section>
            <DirectorStylePicker
              selectedDirector={config.director_style || null}
              onDirectorChange={(director) => setConfig(prev => ({ ...prev, director_style: director }))}
              genres={config.genres || {}}
              disabled={!config.multi_voice}
            />
          </section>
        )}

        {/* Ambient Sound Effects Toggle */}
        <section>
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
            <div>
              <div className="text-slate-100 font-medium flex items-center gap-2">
                <Waves className="w-4 h-4 text-cyan-400" />
                Ambient Sound Effects
              </div>
              <div className="text-slate-400 text-sm">Rain, footsteps, swords clashing & more</div>
            </div>
            <AccessibleToggle
              enabled={config.sfx_enabled}
              onChange={(value) => setConfig(prev => ({ ...prev, sfx_enabled: value }))}
              label="Ambient Sound Effects"
              description="Add atmospheric sounds like rain, footsteps, and ambient noise"
              colorOn="bg-cyan-400"
              size="large"
              showLabel={true}
            />
          </div>
          {config.sfx_enabled && (
            <div className="mt-3 space-y-2">
              <p className="text-cyan-400/70 text-xs px-1">
                AI will add atmospheric sounds matching the story scenes
              </p>
              {/* SFX Level Selector */}
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[
                  { id: 'low', name: 'Default', desc: 'Key moments' },
                  { id: 'medium', name: 'More', desc: 'Frequent sounds' },
                  { id: 'high', name: 'Lots', desc: 'Continuous audio' }
                ].map(level => (
                  <button
                    key={level.id}
                    onClick={() => setConfig(prev => ({ ...prev, sfx_level: level.id }))}
                    className={`py-2 px-3 rounded-lg text-xs transition-all ${
                      config.sfx_level === level.id
                        ? 'bg-cyan-500/30 border-2 border-cyan-400 text-cyan-300'
                        : 'bg-slate-700/50 border border-slate-600 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <div className="font-medium">{level.name}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{level.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* CYOA Settings - show when Adventure story type is selected */}
        {config.story_type === 'cyoa' && (
          <section>
            {/* CYOA Settings Panel - shown when Adventure (CYOA) story type is selected */}
            <div className="p-4 bg-slate-800/30 rounded-xl border border-amber-500/20 space-y-4">
              <h3 className="text-amber-400 text-sm font-medium flex items-center gap-2">
                <Bookmark className="w-4 h-4" />
                Customize Your Adventure
              </h3>
              <p className="text-slate-500 text-xs -mt-2">
                Fine-tune how your adventure unfolds
              </p>

                {/* Story Structure Type */}
                <div>
                  <label className="text-slate-300 text-xs mb-2 block">Branching Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'linear', label: 'Linear', desc: 'Few branches' },
                      { id: 'branching', label: 'Full Tree', desc: 'Many paths' },
                      { id: 'diamond', label: 'Diamond', desc: 'Converges' }
                    ].map(style => (
                      <button
                        key={style.id}
                        onClick={() => updateCyoaSetting('structure_type', style.id)}
                        className={`py-2 px-3 rounded-lg text-xs transition-all ${
                          config.cyoa_settings.structure_type === style.id
                            ? 'bg-amber-500 text-slate-900 font-medium'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        <div>{style.label}</div>
                        <div className="text-[10px] opacity-70">{style.desc}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-slate-500 text-xs mt-1">
                    {config.cyoa_settings.structure_type === 'diamond'
                      ? 'Branches expand then converge to limited endings (recommended)'
                      : config.cyoa_settings.structure_type === 'branching'
                      ? 'Each choice leads to completely different paths'
                      : 'Main story with occasional decision points'}
                  </p>
                </div>

                {/* Choices Per Decision */}
                <div>
                  <label className="text-slate-300 text-xs mb-2 block">Choices per decision: {config.cyoa_settings.max_branches}</label>
                  <input
                    type="range"
                    min="2"
                    max="4"
                    value={config.cyoa_settings.max_branches}
                    onChange={(e) => updateCyoaSetting('max_branches', parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="flex justify-between text-slate-500 text-xs mt-1">
                    <span>2 choices</span>
                    <span>4 choices</span>
                  </div>
                </div>

                {/* Bookmark/Checkpoint Settings */}
                <div className="space-y-3 pt-2 border-t border-slate-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-200 text-sm flex items-center gap-1">
                        <Bookmark className="w-3 h-3" /> Auto-checkpoint
                      </span>
                      <p className="text-slate-500 text-xs">Save at each choice (like putting a finger in the book)</p>
                    </div>
                    <AccessibleToggle
                      enabled={config.cyoa_settings.auto_checkpoint}
                      onChange={(value) => updateCyoaSetting('auto_checkpoint', value)}
                      label="Auto-checkpoint"
                      description="Automatically save progress at each choice point"
                      colorOn="bg-amber-500"
                      showLabel={true}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-200 text-sm">Allow backtracking</span>
                      <p className="text-slate-500 text-xs">Go back to previous choices if you don't like the outcome</p>
                    </div>
                    <AccessibleToggle
                      enabled={config.cyoa_settings.allow_backtrack}
                      onChange={(value) => updateCyoaSetting('allow_backtrack', value)}
                      label="Allow backtracking"
                      description="Go back to previous choices if you don't like the outcome"
                      colorOn="bg-amber-500"
                      showLabel={true}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-200 text-sm">Show choice history</span>
                      <p className="text-slate-500 text-xs">Display breadcrumb of past decisions</p>
                    </div>
                    <AccessibleToggle
                      enabled={config.cyoa_settings.show_choice_history}
                      onChange={(value) => updateCyoaSetting('show_choice_history', value)}
                      label="Show choice history"
                      description="Display a breadcrumb trail of your past decisions"
                      colorOn="bg-amber-500"
                      showLabel={true}
                    />
                  </div>
                </div>
            </div>
          </section>
        )}
      </main>

      {/* Start Button - Single Click to Create Story */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent">
        <div className="max-w-md mx-auto">
          {/* Create Story Button - Single click to start */}
          <button
              onClick={startStory}
              disabled={isStarting}
              className="w-full py-3 px-6 bg-golden-400 hover:bg-golden-500 rounded-xl
                         text-slate-900 font-semibold text-base transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2 shadow-lg shadow-golden-400/20"
            >
              {isStarting ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Create Story
                </>
              )}
            </button>
        </div>
      </div>
    </div>
  );
}

export default Configure;
