import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, Sparkles, Volume2, MessageCircle, Shield, Swords, Users, BookOpen, Library, Bookmark, GitBranch, PenTool, ChevronDown, ChevronUp, Waves, Zap, Settings, FileText, ExternalLink } from 'lucide-react';
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
import { configLog } from '../utils/clientLogger';
import AdvancedConfigureStory from '../components/configure/AdvancedConfigureStory';

function Configure() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();

  // ADVANCED MODE DETECTION - When coming from Story Bible
  const outlineId = searchParams.get('outline');
  const libraryId = searchParams.get('library');
  const isAdvancedMode = !!(outlineId && libraryId);

  // If advanced mode, render the dedicated AdvancedConfigureStory component
  if (isAdvancedMode) {
    return <AdvancedConfigureStory outlineId={outlineId} libraryId={libraryId} />;
  }

  // Standard mode continues below...
  // Generation summary is now display-only (no confirmation step)
  const [urlOutlineApplied, setUrlOutlineApplied] = useState(false);

  const [config, setConfig] = useState({
    // Story Type
    story_type: 'narrative', // 'narrative', 'cyoa'

    // Story Format
    story_format: 'short_story', // 'picture_book', 'short_story', 'novella', 'novel', 'series'

    // Genre Mix
    genres: {
      fantasy: 70,
      adventure: 50,
      mystery: 30,
      scifi: 20,
      romance: 10,
      horror: 20,
      humor: 40,
      fairytale: 30
    },

    // Content Intensity (0-100)
    intensity: {
      violence: 20,
      gore: 0,
      scary: 30,
      romance: 10,
      language: 10,
      adultContent: 0  // Nudity/sexual content (50+ triggers Venice.ai)
    },

    // Audience Level
    audience: 'general', // 'children', 'general', 'mature'

    // Story settings
    story_length: 'medium',
    mood: 'calm', // Story mood: calm, exciting, scary, funny, mysterious, dramatic
    narrator_style: 'warm',

    // Voice settings
    voice_id: null,
    multi_voice: false, // Multi-narrator (different voices for characters)
    hide_speech_tags: false, // Hide speech attributions ("Ortiz suggests", "she whispered") when using multi-voice - OFF by default
    sfx_enabled: true, // Ambient sound effects (rain, footsteps, etc.)
    sfx_level: 'low', // SFX intensity: 'low' (default), 'medium' (more sounds), 'high' (lots of sounds)

    // Playback settings
    autoplay: false, // Auto-play audio when ready (default: disabled, user must click to start)

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
      cliffhanger_allowed: false,  // For series: allow cliffhangers between entries
      subplot_count: 1             // Number of subplots (0-3)
    },

    // Custom prompt - user's special requests
    custom_prompt: '', // e.g., "Write like Stephen King", "Include dragons", "Set in medieval Japan"

    // Author writing style (e.g., 'shakespeare', 'tolkien', 'king')
    author_style: 'none'
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
          setConfig(prev => ({ ...prev, ...data.config_updates }));
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
    fetchDefaults();
    fetchTemplates();
    fetchStoryBibleOutlines();
  }, []);

  const fetchDefaults = async () => {
    try {
      const response = await apiCall('/config/defaults');
      if (response.ok) {
        const data = await response.json();
        setConfig(prev => ({ ...prev, ...data }));
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
  const fetchStoryBibleOutlines = async () => {
    try {
      // First get all libraries
      const librariesResponse = await apiCall('/story-bible/libraries');
      if (!librariesResponse.ok) return;

      const librariesData = await librariesResponse.json();
      if (!librariesData.libraries || librariesData.libraries.length === 0) return;

      // For each library, fetch synopses with outlines
      const outlinesWithLibrary = [];
      for (const library of librariesData.libraries) {
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

      setStoryBibleOutlines(outlinesWithLibrary);
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
          // Apply the merged config
          setConfig(prev => ({
            ...prev,
            ...data.config,
            genres: { ...prev.genres, ...data.config.genres },
            intensity: { ...prev.intensity, ...data.config.intensity },
            // CYOA enabled ONLY if story_type is explicitly 'cyoa' - prevents false positives
            cyoa_enabled: data.config.story_type === 'cyoa',
            multi_voice: data.config.multi_narrator || prev.multi_voice
          }));

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
        configLog.info(`AUTO_DETECT_RESPONSE | success: ${data.success} | multi_narrator: ${data.suggestedConfig?.multi_narrator} | sfx_enabled: ${data.suggestedConfig?.sfx_enabled} | sfx_level: ${data.suggestedConfig?.sfx_level}`);
        configLog.info(`AUTO_DETECT_FULL | ${JSON.stringify(data.suggestedConfig)}`);
        // ========== END AUTO-DETECT DEBUG LOGGING ==========

        if (data.success && data.suggestedConfig) {
          // Define defaults for full reset
          const defaultGenres = {
            fantasy: 0, adventure: 0, mystery: 0, scifi: 0,
            romance: 0, horror: 0, humor: 0, fairytale: 0
          };
          const defaultIntensity = {
            violence: 0, gore: 0, scary: 0, romance: 0, language: 0, adultContent: 0
          };

          // Apply suggested configuration ONLY to sections with auto-select enabled
          setConfig(prev => {
            const newConfig = { ...prev };

            // RESET genres to defaults ALWAYS when auto-select is enabled
            // This ensures old values don't persist between Auto-Detect runs
            if (autoSelect.genres) {
              newConfig.genres = { ...defaultGenres, ...(data.suggestedConfig.genres || {}) };
            }

            // RESET intensity to defaults ALWAYS when auto-select is enabled
            if (autoSelect.intensity) {
              newConfig.intensity = { ...defaultIntensity, ...(data.suggestedConfig.intensity || {}) };
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
            if (autoSelect.intensity && data.suggestedConfig.audience) {
              newConfig.audience = data.suggestedConfig.audience;
            }

            // Only apply story_type if auto-select enabled
            if (autoSelect.story_type && data.suggestedConfig.story_type) {
              newConfig.story_type = data.suggestedConfig.story_type;
            }

            // Only apply story_format if auto-select enabled
            if (autoSelect.story_format && data.suggestedConfig.story_format) {
              newConfig.story_format = data.suggestedConfig.story_format;
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

            // Multi-voice narration (multi_narrator maps to multi_voice)
            // P0: Check for explicit negation FIRST, then enable
            if (data.suggestedConfig.multi_narrator_explicitly_disabled === true) {
              configLog.info('AUTO_DETECT_APPLY | multi_voice=false (explicitly disabled by negation)');
              newConfig.multi_voice = false;
              newConfig.hide_speech_tags = false;
            } else if (data.suggestedConfig.multi_narrator) {
              configLog.info('AUTO_DETECT_APPLY | multi_voice=true | hide_speech_tags=true');
              newConfig.multi_voice = true;
              newConfig.hide_speech_tags = true; // Recommended for multi-voice
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

            // Narrator voice - apply recommended voice if auto-select enabled
            if (autoSelect.narrator_voice && data.suggestedConfig.recommended_voice?.voice_id) {
              newConfig.voice_id = data.suggestedConfig.recommended_voice.voice_id;
            }

            return newConfig;
          });

          // Also update selectedVoice state for VoiceSelector component
          if (autoSelect.narrator_voice && data.suggestedConfig.recommended_voice?.voice_id) {
            setSelectedVoice({
              voice_id: data.suggestedConfig.recommended_voice.voice_id,
              name: data.suggestedConfig.recommended_voice.name,
              gender: data.suggestedConfig.recommended_voice.gender
            });
          }

          // Build reasoning list based on what was actually updated
          const appliedReasons = [];
          if (autoSelect.story_type) appliedReasons.push(`Story type: ${data.suggestedConfig.story_type || 'narrative'}`);
          if (autoSelect.story_format) appliedReasons.push(`Format: ${data.suggestedConfig.story_format || 'short_story'}`);
          if (autoSelect.mood) appliedReasons.push(`Mood: ${data.suggestedConfig.mood || 'exciting'}`);
          if (autoSelect.genres) appliedReasons.push('Genre mix adjusted');
          if (autoSelect.intensity) {
            appliedReasons.push('Content intensity calibrated');
            if (data.suggestedConfig.audience === 'mature') {
              appliedReasons.push('Audience: Mature (auto-detected)');
            }
          }
          if (autoSelect.narrator_style) appliedReasons.push(`Narrator style: ${data.suggestedConfig.narrator_style || 'dramatic'}`);
          if (autoSelect.narrator_voice && data.suggestedConfig.recommended_voice?.name) {
            appliedReasons.push(`Narrator voice: ${data.suggestedConfig.recommended_voice.name} (${data.suggestedConfig.recommended_voice.reason || 'best fit for genre'})`);
          }
          if (data.suggestedConfig.multi_narrator) appliedReasons.push('Multi-voice narration enabled');
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
            sectionsUpdated: Object.keys(autoSelect).filter(k => autoSelect[k])
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
    setConfig(prev => {
      const newConfig = { ...prev, audience };

      if (audience === 'children') {
        // Enforce child-safe limits
        newConfig.intensity = {
          violence: Math.min(prev.intensity.violence, 10),
          gore: 0,
          scary: Math.min(prev.intensity.scary, 15),
          romance: 0,
          language: 0,
          adultContent: 0
        };
        newConfig.genres = {
          ...prev.genres,
          horror: Math.min(prev.genres.horror, 10),
          romance: 0
        };
      } else if (audience === 'general') {
        // General audience - reset mature content
        newConfig.intensity = {
          ...prev.intensity,
          gore: 0,
          adultContent: 0
        };
      } else if (audience === 'mature') {
        // Allow higher limits
        newConfig.intensity = {
          violence: Math.max(prev.intensity.violence, 30),
          gore: prev.intensity.gore,
          scary: prev.intensity.scary,
          romance: prev.intensity.romance,
          language: prev.intensity.language,
          adultContent: prev.intensity.adultContent || 0
        };
      }

      return newConfig;
    });
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
        const response = await apiCall('/stories/start', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          const errorMessage = errorData.error?.message || errorData.error || errorData.message || response.statusText;
          const details = errorData.error?.details || [];
          const detailsText = details.length > 0
            ? ` | Details: ${details.map(d => `${d.field}: ${d.message}`).join('; ')}`
            : '';
          throw new Error(`Failed to create session: ${errorMessage}${detailsText}`);
        }
        const data = await response.json();
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

  // Get narrator style settings for ElevenLabs
  const getNarratorStyleSettings = (style) => {
    const settings = {
      warm: { stability: 0.65, similarity_boost: 0.75, style: 20 },
      dramatic: { stability: 0.45, similarity_boost: 0.85, style: 50 },
      playful: { stability: 0.55, similarity_boost: 0.7, style: 40 },
      mysterious: { stability: 0.7, similarity_boost: 0.8, style: 35 }
    };
    return settings[style] || settings.warm;
  };

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
        {/* Voice Configuration */}
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

        {/* Story Bible Outline Selector - shown if outlines exist */}
        {storyBibleOutlines.length > 0 && (
          <section className="bg-gradient-to-br from-purple-500/10 to-slate-900/50 rounded-2xl p-4 border border-purple-500/30">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-medium text-purple-400 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Use Story Bible Outline
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
              Select a pre-built outline from your Story Bible instead of typing a premise
            </p>

            {/* Dropdown */}
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

              {/* Dropdown Menu */}
              {showOutlineDropdown && (
                <div className="absolute z-20 mt-2 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-xl overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {storyBibleOutlines.map(outline => (
                      <button
                        key={outline.id}
                        onClick={() => applyStoryBibleOutline(outline)}
                        className={`w-full px-4 py-3 text-left hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-b-0 ${
                          selectedOutline?.id === outline.id ? 'bg-purple-500/20' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-slate-100 font-medium truncate">
                            {outline.title || 'Untitled'}
                          </span>
                          <span className="text-slate-500 text-xs ml-2 shrink-0">
                            {outline.library_name}
                          </span>
                        </div>
                        {outline.logline && (
                          <p className="text-slate-400 text-xs mt-1 line-clamp-2">
                            {outline.logline}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Clear selection option */}
                  {selectedOutline && (
                    <button
                      onClick={() => {
                        setSelectedOutline(null);
                        setShowOutlineDropdown(false);
                        setConfig(prev => ({
                          ...prev,
                          custom_prompt: '',
                          story_bible_outline_id: null,
                          story_bible_library_id: null
                        }));
                        setAnalysisResult(null);
                      }}
                      className="w-full px-4 py-2 text-red-400 hover:bg-red-500/10 text-sm border-t border-slate-600"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Selected outline info */}
            {selectedOutline && (
              <div className="mt-3 p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                <p className="text-purple-300 text-sm font-medium mb-1">
                  Selected: {selectedOutline.title || 'Untitled'}
                </p>
                <p className="text-slate-400 text-xs">
                  The outline will be used as your story premise. Click "Craft Story" to auto-configure settings.
                </p>
              </div>
            )}
          </section>
        )}

        {/* Story Premise - PRIMARY INPUT - moved to top */}
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
              analysisResult.success
                ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                : 'bg-red-500/10 border border-red-500/30 text-red-300'
            }`}>
              {analysisResult.success ? (
                <>
                  <div className="font-medium mb-1">Settings auto-configured!</div>
                  <ul className="text-xs space-y-1 text-slate-300">
                    {analysisResult.reasoning.map((reason, i) => (
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

        {/* Story Type */}
        <section className={`transition-all duration-500 ${animatingSections.story_type ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100 flex items-center gap-2">
              <Swords className="w-5 h-5 text-golden-400" />
              Story Type
            </h2>
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
              <h2 className="text-lg font-medium text-slate-100 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-golden-400" />
                Story Format
              </h2>
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
          <h2 className="text-lg font-medium text-slate-100 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-golden-400" />
            Audience
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'children', label: 'Children', desc: 'Age 5-10', icon: '👶' },
              { id: 'general', label: 'General', desc: 'All ages', icon: '👨‍👩‍👧' },
              { id: 'mature', label: 'Mature', desc: 'Adult themes', icon: '🔞' }
            ].map(aud => (
              <button
                key={aud.id}
                onClick={() => setAudience(aud.id)}
                className={`p-4 rounded-xl border-2 transition-all ${
                  config.audience === aud.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-2xl mb-1">{aud.icon}</div>
                <div className="text-slate-100 font-medium text-sm">{aud.label}</div>
                <div className="text-slate-400 text-xs">{aud.desc}</div>
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
          <h2 className="text-lg font-medium text-slate-100 mb-4">Story Length</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'short', label: 'Short', desc: '~5 min' },
              { id: 'medium', label: 'Medium', desc: '~15 min' },
              { id: 'long', label: 'Long', desc: '~30 min' }
            ].map(option => (
              <button
                key={option.id}
                onClick={() => setConfig(prev => ({ ...prev, story_length: option.id }))}
                className={`p-4 rounded-xl border-2 transition-all ${
                  config.story_length === option.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-slate-100 font-medium">{option.label}</div>
                <div className="text-slate-400 text-sm">{option.desc}</div>
              </button>
            ))}
          </div>
          {/* Show length recommendation based on format */}
          {config.story_format && (
            <p className="text-slate-500 text-xs mt-2">
              {config.story_format === 'short_story' && 'Short stories work best at 5-15 min'}
              {config.story_format === 'novella' && 'Novellas typically run 15-30 min'}
              {config.story_format === 'novel_chapter' && 'Chapters work well at any length'}
              {config.story_format === 'bedtime_story' && 'Quick listens work best under ~5 min'}
              {!['short_story', 'novella', 'novel_chapter', 'bedtime_story'].includes(config.story_format) &&
                `Current format: ${config.story_format.replace(/_/g, ' ')}`
              }
            </p>
          )}
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

              {/* Subplot count */}
              <div className="p-3 bg-slate-800/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-200 text-sm">Subplots</span>
                  <span className="text-slate-400 text-xs">{config.plot_settings.subplot_count === 0 ? 'None' : config.plot_settings.subplot_count}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="3"
                  value={config.plot_settings.subplot_count}
                  onChange={(e) => updatePlotSetting('subplot_count', parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-golden-400"
                />
                <div className="flex justify-between text-slate-500 text-xs mt-1">
                  <span>Simple</span>
                  <span>Complex</span>
                </div>
              </div>
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
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Adventure"
              icon="⚔️"
              value={config.genres.adventure}
              onChange={(v) => updateGenre('adventure', v)}
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Mystery"
              icon="🔍"
              value={config.genres.mystery}
              onChange={(v) => updateGenre('mystery', v)}
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Sci-Fi"
              icon="🚀"
              value={config.genres.scifi}
              onChange={(v) => updateGenre('scifi', v)}
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Fairy Tale"
              icon="🏰"
              value={config.genres.fairytale}
              onChange={(v) => updateGenre('fairytale', v)}
              animating={animatingSections.genres}
            />
            <GenreSlider
              label="Humor"
              icon="😄"
              value={config.genres.humor}
              onChange={(v) => updateGenre('humor', v)}
              animating={animatingSections.genres}
            />
            {config.audience !== 'children' && (
              <>
                <GenreSlider
                  label="Horror"
                  icon="👻"
                  value={config.genres.horror}
                  onChange={(v) => updateGenre('horror', v)}
                  max={config.audience === 'mature' ? 100 : 50}
                  animating={animatingSections.genres}
                />
                <GenreSlider
                  label="Romance"
                  icon="💕"
                  value={config.genres.romance}
                  onChange={(v) => updateGenre('romance', v)}
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
              colorClass="from-green-500 to-orange-500"
              animating={animatingSections.intensity}
            />

            {config.audience !== 'children' && (
              <GenreSlider
                label="Violence"
                icon="⚔️"
                value={config.intensity.violence}
                onChange={(v) => updateIntensity('violence', v)}
                max={config.audience === 'mature' ? 100 : 50}
                colorClass="from-yellow-500 to-red-500"
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
                    colorClass="from-red-400 to-red-700"
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
                  colorClass="from-pink-400 to-rose-600"
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
                  animating={animatingSections.intensity}
                />

                {config.audience === 'mature' && (
                  <GenreSlider
                    label="Adult Content"
                    icon="🔞"
                    value={config.intensity.adultContent}
                    onChange={(v) => updateIntensity('adultContent', v)}
                    max={100}
                    colorClass="from-rose-400 to-fuchsia-600"
                    threshold={PROVIDER_THRESHOLDS.adultContent}
                    showProvider={true}
                    animating={animatingSections.intensity}
                  />
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
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'calm', label: 'Calm', icon: '😌', desc: 'Peaceful' },
              { id: 'exciting', label: 'Exciting', icon: '⚡', desc: 'Action-packed' },
              { id: 'scary', label: 'Scary', icon: '😨', desc: 'Suspenseful' },
              { id: 'funny', label: 'Funny', icon: '😄', desc: 'Humorous' },
              { id: 'mysterious', label: 'Mysterious', icon: '🔮', desc: 'Intriguing' },
              { id: 'dramatic', label: 'Dramatic', icon: '🎭', desc: 'Emotional' }
            ].map(mood => (
              <button
                key={mood.id}
                onClick={() => setConfig(prev => ({ ...prev, mood: mood.id }))}
                className={`p-3 rounded-xl border-2 transition-all text-center ${
                  config.mood === mood.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="text-xl mb-1">{mood.icon}</div>
                <div className="text-slate-100 text-sm font-medium">{mood.label}</div>
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

        {/* Narrator Style */}
        <section className={`transition-all duration-500 ${animatingSections.narrator_style ? 'ring-2 ring-golden-400/50 rounded-2xl p-4 -m-4 bg-golden-400/5' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-100">Narrator Voice Style</h2>
          </div>
          <p className="text-slate-400 text-sm mb-3">How should the narrator sound?</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'warm', label: 'Warm & Gentle', desc: 'Soothing, low-intensity delivery', icon: '🌙' },
              { id: 'dramatic', label: 'Dramatic', desc: 'Epic & theatrical delivery', icon: '🎭' },
              { id: 'playful', label: 'Playful', desc: 'Fun & whimsical energy', icon: '✨' },
              { id: 'mysterious', label: 'Mysterious', desc: 'Dark & intriguing tone', icon: '🌑' }
            ].map(style => (
              <button
                key={style.id}
                onClick={() => setConfig(prev => ({ ...prev, narrator_style: style.id }))}
                className={`p-3 rounded-xl border-2 transition-all text-left ${
                  config.narrator_style === style.id
                    ? 'border-golden-400 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span>{style.icon}</span>
                  <span className="text-slate-100 text-sm font-medium">{style.label}</span>
                </div>
                <div className="text-slate-400 text-xs">{style.desc}</div>
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

        {/* Multi-Voice Toggle */}
        <section>
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
            <div>
              <div className="text-slate-100 font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-golden-400" />
                Multi-Voice Narration
              </div>
              <div className="text-slate-400 text-sm">Different voices for characters</div>
            </div>
            <AccessibleToggle
              enabled={config.multi_voice}
              onChange={(value) => setConfig(prev => ({
                ...prev,
                multi_voice: value,
                hide_speech_tags: value
              }))}
              label="Multi-Voice Narration"
              description="Different voices for each character in the story"
              colorOn="bg-golden-400"
              size="large"
              showLabel={true}
            />
          </div>
        </section>

        {/* Hide Speech Tags Toggle - Always visible, below Multi-Voice */}
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
          <div className="flex items-center gap-3">
            {/* Auto-Play Toggle */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 rounded-xl border border-slate-700">
              <AccessibleToggle
                enabled={config.autoplay}
                onChange={(value) => setConfig(prev => ({ ...prev, autoplay: value }))}
                label="Auto-Play"
                description="Automatically continue to the next scene"
                colorOn="bg-green-500"
                size="small"
                showLabel={true}
              />
              <span className="text-slate-400 text-xs whitespace-nowrap">
                Auto-Play
              </span>
            </div>

            {/* Create Story Button - Single click to start */}
            <button
              onClick={startStory}
              disabled={isStarting}
              className="flex-1 py-3 px-6 bg-golden-400 hover:bg-golden-500 rounded-xl
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
    </div>
  );
}

export default Configure;
