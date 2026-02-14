/**
 * Input Processing Functions
 * Handles voice input and configuration processing.
 *
 * Extracted from orchestrator.js for better maintainability.
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import { callAgent, parseJsonResponse } from '../openai.js';
import { sanitizeForPrompt } from '../../utils/promptSecurity.js';

/**
 * Process configuration input (voice, text, or structured config)
 * @param {string} sessionId
 * @param {object} session - Session object with config_json
 * @param {string} input - User's voice/text input or JSON config string
 * @param {string} inputType - 'text', 'voice', or 'config' (JSON from Configure page)
 * @returns {object} Processing result
 */
export async function processConfiguration(sessionId, session, input, inputType = 'text') {
  // CRITICAL FIX: Handle structured config from Configure page directly
  // When inputType='config', input is a JSON string that should be saved directly
  // instead of being parsed by an LLM as natural language
  if (inputType === 'config') {
    try {
      const configData = typeof input === 'string' ? JSON.parse(input) : input;

      logger.info(`[InputProcessors] Processing structured config (inputType=config)`);
      logger.info(`[InputProcessors] Config keys: ${Object.keys(configData).join(', ')}`);

      // Merge with existing config (structured config takes precedence)
      const currentConfig = session.config_json || {};
      const newConfig = { ...currentConfig, ...configData };

      // Save the merged config to the database
      await pool.query(
        'UPDATE story_sessions SET config_json = $1 WHERE id = $2',
        [JSON.stringify(newConfig), sessionId]
      );

      logger.info(`[InputProcessors] Saved structured config for session ${sessionId}`);
      logger.info(`[InputProcessors] Genres: ${JSON.stringify(newConfig.genres || {})}`);
      logger.info(`[InputProcessors] Audience: ${newConfig.audience || 'general'}`);
      logger.info(`[InputProcessors] Story Request: "${(newConfig.story_request || newConfig.custom_prompt || 'None').substring(0, 100)}..."`);

      return {
        understood: true,
        message: 'Configuration saved successfully',
        preferences: newConfig,
        ready_to_generate: true
      };

    } catch (parseError) {
      logger.error(`[InputProcessors] Failed to parse config JSON: ${parseError.message}`);
      logger.error(`[InputProcessors] Input was: ${typeof input === 'string' ? input.substring(0, 200) : JSON.stringify(input).substring(0, 200)}...`);
      return {
        understood: false,
        message: 'Failed to parse configuration. Please try again.',
        preferences: null,
        ready_to_generate: false
      };
    }
  }

  // For text/voice input, use LLM to extract preferences
  // Sanitize user input to prevent prompt injection attacks
  const safeInput = sanitizeForPrompt(input, { maxLength: 1000 });

  const advocateResponse = await callAgent('advocate', `
    The user said: "${safeInput}"

    Extract story preferences from this input. Consider:
    - Genre preferences (fantasy, adventure, mystery, etc.)
    - Setting requests (forest, space, underwater, etc.)
    - Character requests (dragons, pirates, princesses, etc.)
    - Tone preferences (funny, scary, calm, etc.)
    - Any specific story elements mentioned

    Return JSON:
    {
      "understood": true/false,
      "preferences": {
        "genres": {"fantasy": 0-100, ...},
        "setting_hints": ["list of setting keywords"],
        "character_hints": ["list of character keywords"],
        "tone": "calm|exciting|funny|mysterious|scary",
        "special_requests": ["any specific requests"]
      },
      "clarification_needed": "question to ask if unclear",
      "summary": "brief summary of what you understood"
    }
  `, { userPreferences: session.config_json });

  try {
    const parsed = parseJsonResponse(advocateResponse.content);

    // Update session config
    if (parsed.understood && parsed.preferences) {
      const currentConfig = session.config_json || {};
      const newConfig = { ...currentConfig, ...parsed.preferences };

      await pool.query(
        'UPDATE story_sessions SET config_json = $1 WHERE id = $2',
        [JSON.stringify(newConfig), sessionId]
      );
    }

    return {
      understood: parsed.understood,
      message: parsed.summary || parsed.clarification_needed,
      preferences: parsed.preferences,
      ready_to_generate: parsed.understood && !parsed.clarification_needed
    };

  } catch (e) {
    logger.warn(`[InputProcessors] Failed to parse advocate response: ${e.message}`);
    return {
      understood: false,
      message: "I'd love to create a story with you. What kind of world do you want to dive into?",
      preferences: null,
      ready_to_generate: false
    };
  }
}

/**
 * Process voice input during story playback
 * @param {object} options
 * @param {string} options.transcript - Voice transcript
 * @param {object} options.session - Session object
 * @param {Function} options.processConfig - Config processing function
 * @returns {object} Processing result with type and action
 */
export function processVoiceInput({ transcript, session, processConfig }) {
  const lowered = transcript.toLowerCase().trim();

  // Check for control commands
  if (lowered.includes('pause') || lowered.includes('stop')) {
    return { type: 'command', action: 'pause', text: null, generateAudio: false };
  }

  if (lowered.includes('continue') || lowered.includes('next') || lowered.includes('go on')) {
    return { type: 'command', action: 'continue', text: null, generateAudio: false };
  }

  if (lowered.includes('end') || lowered.includes('finish') || lowered.includes('the end')) {
    return { type: 'command', action: 'end', text: null, generateAudio: false };
  }

  // Check for CYOA choice - supports multiple voice patterns
  if (session.cyoa_enabled) {
    const choiceResult = matchVoiceChoice(lowered);
    if (choiceResult) {
      return choiceResult;
    }
  }

  // During planning, process as configuration
  if (session.current_status === 'planning') {
    return { type: 'config', processConfig: true };
  }

  // During narration, acknowledge but continue
  return {
    type: 'acknowledgment',
    message: "I hear you! Let me continue the story...",
    text: null,
    generateAudio: false
  };
}

/**
 * Match voice input to CYOA choice
 * @param {string} lowered - Lowercased voice input
 * @returns {object|null} Choice result or null
 */
export function matchVoiceChoice(lowered) {
  // Pattern 1: Letter-based - "choice A", "option A", "pick A", "A"
  const letterMatch = lowered.match(/(?:choice\s+)?([a-d])\b|(?:option\s+)?([a-d])\b|(?:pick\s+)?([a-d])\b/);
  if (letterMatch) {
    const choice = (letterMatch[1] || letterMatch[2] || letterMatch[3]).toUpperCase();
    return { type: 'choice', choice_key: choice, text: null, generateAudio: false };
  }

  // Pattern 2: Number-based - "one", "two", "three", "first", "second", "option 1"
  const numberWords = {
    'one': 'A', 'first': 'A', '1': 'A', 'first option': 'A', 'option one': 'A', 'option 1': 'A',
    'two': 'B', 'second': 'B', '2': 'B', 'second option': 'B', 'option two': 'B', 'option 2': 'B',
    'three': 'C', 'third': 'C', '3': 'C', 'third option': 'C', 'option three': 'C', 'option 3': 'C',
    'four': 'D', 'fourth': 'D', '4': 'D', 'fourth option': 'D', 'option four': 'D', 'option 4': 'D'
  };

  for (const [pattern, choiceKey] of Object.entries(numberWords)) {
    if (lowered.includes(pattern)) {
      return { type: 'choice', choice_key: choiceKey, text: null, generateAudio: false };
    }
  }

  // Pattern 3: Natural phrases that indicate choice - "I want to", "let's", "I choose"
  const naturalPatterns = [
    /i (?:want to|wanna|choose to|pick|select)\s+(.+)/,
    /let'?s?\s+(.+)/,
    /(?:go with|take)\s+(.+)/
  ];

  for (const pattern of naturalPatterns) {
    const match = lowered.match(pattern);
    if (match) {
      // Return the phrase for text-based matching in the client
      return { type: 'choice', choice_text: match[1].trim(), text: null, generateAudio: false };
    }
  }

  return null;
}

/**
 * Extract character hints from custom prompt
 * @param {string} customPrompt - User's story request
 * @returns {Array} Character hint keywords
 */
export function extractCharacterHints(customPrompt) {
  if (!customPrompt) return [];

  const characterPatterns = [
    /\b(conan|aragorn|frodo|gandalf|harry|hermione|sherlock|watson|dracula|frankenstein)\b/gi,
    /\b(dragon|princess|prince|knight|wizard|witch|warrior|pirate|vampire|werewolf|elf|dwarf|orc|goblin|fairy|demon|angel|ghost|zombie|robot|alien|detective|spy|assassin|thief|merchant|king|queen|emperor|empress)\b/gi,
    /\b(brave|young|old|wise|evil|dark|noble|fallen|lost|wandering|mysterious|ancient)\s+(hero|heroine|warrior|mage|knight|prince|princess|king|queen|stranger|traveler)\b/gi
  ];

  const hints = [];
  for (const pattern of characterPatterns) {
    const matches = customPrompt.match(pattern);
    if (matches) {
      hints.push(...matches.map(m => m.toLowerCase()));
    }
  }

  return [...new Set(hints)];
}

/**
 * Extract setting hints from custom prompt
 * @param {string} customPrompt - User's story request
 * @returns {Array} Setting hint keywords
 */
export function extractSettingHints(customPrompt) {
  if (!customPrompt) return [];

  const settingPatterns = [
    /\b(forest|castle|dungeon|cave|mountain|ocean|sea|desert|city|village|kingdom|realm|space|planet|ship|island|swamp|jungle|arctic|underground|underwater)\b/gi,
    /\b(medieval|futuristic|modern|ancient|victorian|steampunk|cyberpunk|post-apocalyptic|magical|enchanted|haunted|cursed)\b/gi
  ];

  const hints = [];
  for (const pattern of settingPatterns) {
    const matches = customPrompt.match(pattern);
    if (matches) {
      hints.push(...matches.map(m => m.toLowerCase()));
    }
  }

  return [...new Set(hints)];
}

/**
 * Build outline generation preferences from session config
 * @param {object} session - Session object
 * @param {object} config - Session config_json
 * @returns {object} Preferences for outline generation
 */
export function buildOutlinePreferences(session, config) {
  // Build genres from RTC-style config (single genre) or advanced config (multiple genres)
  let genres = config.genres;
  if (!genres && config.genre) {
    genres = { [config.genre]: 100 };
  }
  genres = genres || { fantasy: 70, adventure: 50 };

  // Map mood to tone for consistency
  const tone = config.tone || config.mood || 'calm';

  // Handle story type from RTC (narrative, cyoa)
  // NOTE: Campaign mode removed (2026-01-15) - migrated to GameMaster project
  const storyType = config.type || config.story_type || 'narrative';
  const isCYOA = storyType === 'cyoa' || session.cyoa_enabled;

  // Get story format settings
  const storyFormat = config.story_format || 'short_story';

  // Get plot structure settings
  const plotSettings = config.plot_settings || {
    structure: 'three_act',
    ensure_resolution: true,
    cliffhanger_allowed: false,
    subplot_count: 1
  };

  // Get series settings
  const seriesSettings = config.series_settings || {
    protect_protagonist: true,
    recurring_characters: true,
    open_ending: false,
    character_growth: true,
    series_name: ''
  };

  // Get CYOA settings
  const cyoaSettings = config.cyoa_settings || {
    auto_checkpoint: true,
    show_choice_history: true,
    structure_type: 'diamond',
    allow_backtrack: true,
    max_branches: 3
  };

  // Extract hints from custom prompt
  const customPrompt = config.custom_prompt || '';
  let characterHints = config.character_hints || [];
  let settingHints = config.setting_hints || [];

  if (customPrompt && characterHints.length === 0) {
    characterHints = extractCharacterHints(customPrompt);
    if (characterHints.length > 0) {
      logger.info(`[InputProcessors] Extracted character hints: ${characterHints.join(', ')}`);
    }
  }

  if (customPrompt && settingHints.length === 0) {
    settingHints = extractSettingHints(customPrompt);
  }

  return {
    genres,
    setting_hints: settingHints,
    character_hints: characterHints,
    tone,
    story_type: storyType,
    story_format: storyFormat,
    bedtime_mode: session.bedtime_mode,
    cyoa_enabled: isCYOA,
    cyoa_settings: cyoaSettings,
    target_length: config.length || config.story_length || 'medium',
    audience: config.audience || 'general',
    intensity: config.intensity || {},
    plot_settings: plotSettings,
    series_settings: seriesSettings,
    author_style: config.author_style || null,
    story_request: config.story_request || customPrompt || null,
    character_count: config.character_count || null
  };
}

export default {
  processConfiguration,
  processVoiceInput,
  matchVoiceChoice,
  extractCharacterHints,
  extractSettingHints,
  buildOutlinePreferences
};
