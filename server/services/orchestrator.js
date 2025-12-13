/**
 * ============================================================================
 * Story Orchestrator Service
 * ============================================================================
 *
 * Coordinates all agents to create cohesive stories with multi-voice narration.
 *
 * C+E ARCHITECTURE FOR VOICE CASTING (Updated 2025-12-11):
 * ============================================================================
 *
 * This orchestrator uses the C+E architecture for bulletproof voice casting:
 *
 * 1. ★ Option C: generateSceneWithDialogue() ★
 *    - Scene writer outputs prose WITH dialogue_map in same LLM call
 *    - All speakers are named at creation time (no post-hoc attribution)
 *
 * 2. ★ Option E: validateAndReconcileSpeakers() ★
 *    - Validates all speakers exist in character database
 *    - Creates minor characters automatically
 *    - Assigns voices to all speakers BEFORE audio generation
 *
 * 3. dialogue_map stored in story_scenes.dialogue_map
 *
 * 4. Audio generation uses pre-computed dialogue_map
 *    - FAIL LOUD if dialogue_map is missing (no fallbacks!)
 *
 * UTILITIES:
 *   - convertDialogueMapToSegments() from dialogueSegmentUtils.js
 *
 * ARCHIVED (no longer used):
 *   - dialogueTaggingAgent.js → moved to _archived/
 *   - dialogueAttributionAgent.js → moved to _archived/
 *
 * SEE: server/services/agents/DIALOGUE_TAGGING_SYSTEM.md for full documentation
 *
 * ============================================================================
 */

import { pool, withTransaction } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { sanitizeForPrompt } from '../utils/promptSecurity.js';
import {
  callAgent,
  generateOutline,
  generateScene,
  generateSceneWithDialogue, // ★ NEW: Option C - scene writer outputs dialogue_map
  polishForNarration,
  checkSafety,
  generateChoices,
  checkLoreConsistency,
  parseJsonResponse,
  parseDialogueSegments, // ⚠️ DEPRECATED - kept only for emergency fallback
  assignCharacterVoices,
  summarizeContext,
  countTokens,
  extractStoryFacts,
  determineComplexity,
  validateStoryText
} from './openai.js';
import { ElevenLabsService, getVoiceNameById } from './elevenlabs.js';
import { CHARACTER_VOICE_SUGGESTIONS } from './conversationEngine.js';
import { LorebookService } from './lorebook.js';
import { SoundEffectsService } from './soundEffects.js';
import { SFXCoordinatorAgent } from './agents/sfxCoordinator.js';
import { recordingService } from './recording.js';
import * as usageTracker from './usageTracker.js';
import { assignVoicesByLLM, validateExistingAssignments } from './agents/voiceAssignmentAgent.js';

// ★ C+E ARCHITECTURE: BULLETPROOF VOICE CASTING ★
// Option C: Scene writer outputs dialogue_map directly (generateSceneWithDialogue)
// Option E: Speaker validation teacher ensures all speakers have voices
// SEE: server/services/agents/DIALOGUE_TAGGING_SYSTEM.md
// NOTE: Deprecated fallbacks (dialogueAttributionAgent, dialogueTaggingAgent) have been archived.
//       System will now FAIL LOUD if dialogue_map is missing - no silent fallbacks.
import { validateAndReconcileSpeakers, quickValidateSpeakers } from './agents/speakerValidationAgent.js';
import { convertDialogueMapToSegments } from './agents/dialogueSegmentUtils.js';
import { filterSpeechTagsWithLLM } from './agents/speechTagFilterAgent.js';

// ★ TAG-BASED MULTI-VOICE: Bulletproof dialogue extraction (Phase 7) ★
// Uses [CHAR:Name]dialogue[/CHAR] tags instead of position-based dialogue_map
// 100% reliable extraction - no indexOf/slice position calculation bugs
import { parseTaggedProse, validateTagBalance, extractSpeakers, stripTags, hasCharacterTags } from './agents/tagParser.js';
import { validateTaggedProse } from './agents/tagValidationAgent.js';

const elevenlabs = new ElevenLabsService();
const sfxService = new SoundEffectsService();
const sfxCoordinator = new SFXCoordinatorAgent();

// Token budget for context management (from research insights)
const MAX_CONTEXT_TOKENS = 120000; // Leave room for response
const CONTEXT_SUMMARY_THRESHOLD = 0.8;

// Speech tag filtering is now handled by LLM-based agent (speechTagFilterAgent.js)
// The old regex-based filterSpeechTags function has been removed in favor of
// the more robust LLM approach that can handle cultural names, complex titles,
// and context-dependent speech attribution patterns.

export class Orchestrator {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.session = null;
    this.outline = null;
    this.characters = [];
    this.lore = [];
    this.storyBible = null; // Persistent story knowledge base
    this.contextSummary = null; // Compressed context for long sessions
    this.lorebook = new LorebookService(sessionId); // Lorebook with keyword triggers
    this.activeRecording = null; // For recording capture
    this.recordingEnabled = true; // Toggle for recording feature

    // Initialize usage tracking for this session
    usageTracker.initSessionUsage(sessionId);
    logger.info(`[Orchestrator] Usage tracking initialized for session ${sessionId}`);
  }

  /**
   * Load session data from database
   */
  async loadSession() {
    const result = await pool.query(
      'SELECT * FROM story_sessions WHERE id = $1',
      [this.sessionId]
    );

    if (result.rows.length === 0) {
      throw new Error('Session not found');
    }

    this.session = result.rows[0];

    // Debug: Log config_json to diagnose hide_speech_tags issue
    logger.info(`[Orchestrator] Session loaded | id: ${this.sessionId} | config_json type: ${typeof this.session.config_json} | hide_speech_tags: ${this.session.config_json?.hide_speech_tags} | multi_voice: ${this.session.config_json?.multi_voice}`);

    // Load outline
    const outlineResult = await pool.query(
      'SELECT * FROM story_outlines WHERE story_session_id = $1 ORDER BY version DESC LIMIT 1',
      [this.sessionId]
    );
    if (outlineResult.rows.length > 0) {
      const row = outlineResult.rows[0];
      // Merge outline_json with row metadata
      this.outline = { ...row, ...(row.outline_json || {}) };
    }

    // Load characters
    const charsResult = await pool.query(
      'SELECT * FROM characters WHERE story_session_id = $1',
      [this.sessionId]
    );
    this.characters = charsResult.rows;

    // Load lore
    const loreResult = await pool.query(
      'SELECT * FROM lore_entries WHERE story_session_id = $1',
      [this.sessionId]
    );
    this.lore = loreResult.rows;

    // Load story bible if exists
    await this.loadStoryBible();

    // Load context summary if exists
    await this.loadContextSummary();

    // Load lorebook entries (keyword-triggered context injection)
    await this.lorebook.loadEntries();

    return this.session;
  }

  /**
   * Load or initialize story bible (persistent story knowledge base)
   */
  async loadStoryBible() {
    const result = await pool.query(
      'SELECT bible_json FROM story_outlines WHERE story_session_id = $1 ORDER BY version DESC LIMIT 1',
      [this.sessionId]
    );

    if (result.rows.length > 0 && result.rows[0].bible_json) {
      this.storyBible = result.rows[0].bible_json;
    } else {
      // Initialize empty story bible
      this.storyBible = {
        world_rules: [],
        character_facts: {},
        established_events: [],
        important_locations: [],
        recurring_themes: [],
        user_preferences: {}
      };
    }
  }

  /**
   * Update story bible with new facts
   */
  async updateStoryBible(updates) {
    if (!this.storyBible) await this.loadStoryBible();

    // Merge updates
    if (updates.world_rules) {
      this.storyBible.world_rules = [...new Set([...this.storyBible.world_rules, ...updates.world_rules])];
    }
    if (updates.character_facts) {
      for (const [char, facts] of Object.entries(updates.character_facts)) {
        this.storyBible.character_facts[char] = {
          ...this.storyBible.character_facts[char],
          ...facts
        };
      }
    }
    if (updates.established_events) {
      this.storyBible.established_events.push(...updates.established_events);
    }
    if (updates.important_locations) {
      this.storyBible.important_locations = [...new Set([...this.storyBible.important_locations, ...updates.important_locations])];
    }
    if (updates.recurring_themes) {
      this.storyBible.recurring_themes = [...new Set([...this.storyBible.recurring_themes, ...updates.recurring_themes])];
    }

    // Persist to database
    await pool.query(
      'UPDATE story_outlines SET bible_json = $1 WHERE story_session_id = $2',
      [JSON.stringify(this.storyBible), this.sessionId]
    );

    logger.info(`Story bible updated for session ${this.sessionId}`);
  }

  /**
   * Load context summary from database
   */
  async loadContextSummary() {
    const result = await pool.query(
      'SELECT context_summary FROM story_sessions WHERE id = $1',
      [this.sessionId]
    );

    if (result.rows.length > 0 && result.rows[0].context_summary) {
      this.contextSummary = result.rows[0].context_summary;
    }
  }

  /**
   * Check and manage context window (from research insights)
   * Summarizes context when approaching token limit
   */
  async manageContextWindow() {
    // Get all scenes for context estimation
    const scenesResult = await pool.query(
      'SELECT polished_text FROM story_scenes WHERE story_session_id = $1 ORDER BY sequence_index',
      [this.sessionId]
    );

    const allText = scenesResult.rows.map(r => r.polished_text).join('\n\n');
    const estimatedTokens = countTokens(allText);

    logger.info(`Context estimation: ${estimatedTokens} tokens (threshold: ${MAX_CONTEXT_TOKENS * CONTEXT_SUMMARY_THRESHOLD})`);

    // If approaching limit, summarize
    if (estimatedTokens > MAX_CONTEXT_TOKENS * CONTEXT_SUMMARY_THRESHOLD) {
      logger.info('Context threshold exceeded, generating summary...');

      const summary = await summarizeContext({
        scenes: scenesResult.rows.map(r => r.polished_text),
        characters: this.characters,
        outline: this.outline,
        previousSummary: this.contextSummary
      });

      this.contextSummary = summary;

      // Persist summary
      await pool.query(
        'UPDATE story_sessions SET context_summary = $1 WHERE id = $2',
        [summary, this.sessionId]
      );

      logger.info('Context summarized and persisted');
      return { summarized: true, summary };
    }

    return { summarized: false, tokens: estimatedTokens };
  }

  /**
   * Get optimized context for scene generation
   * Uses summary if available, otherwise recent scenes
   */
  getOptimizedContext() {
    if (this.contextSummary) {
      return {
        type: 'summary',
        content: this.contextSummary,
        storyBible: this.storyBible
      };
    }

    return {
      type: 'full',
      characters: this.characters,
      lore: this.lore,
      storyBible: this.storyBible
    };
  }

  /**
   * Process configuration input (voice or text)
   */
  async processConfiguration(input) {
    await this.loadSession();

    // Use advocate agent to interpret user preferences
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
    `, { userPreferences: this.session.config_json });

    try {
      const parsed = parseJsonResponse(advocateResponse.content);

      // Update session config
      if (parsed.understood && parsed.preferences) {
        const currentConfig = this.session.config_json || {};
        const newConfig = { ...currentConfig, ...parsed.preferences };

        await pool.query(
          'UPDATE story_sessions SET config_json = $1 WHERE id = $2',
          [JSON.stringify(newConfig), this.sessionId]
        );
      }

      return {
        understood: parsed.understood,
        message: parsed.summary || parsed.clarification_needed,
        preferences: parsed.preferences,
        ready_to_generate: parsed.understood && !parsed.clarification_needed
      };

    } catch (e) {
      return {
        understood: false,
        message: "I'd love to create a story for you! What kind of adventure would you like tonight?",
        ready_to_generate: false
      };
    }
  }

  /**
   * Process voice input during story
   */
  async processVoiceInput(transcript) {
    await this.loadSession();

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
    if (this.session.cyoa_enabled) {
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
    }

    // Otherwise, treat as story configuration or question
    if (this.session.current_status === 'planning') {
      return await this.processConfiguration(transcript);
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
   * Generate story outline
   */
  async generateOutline() {
    await this.loadSession();

    const config = this.session.config_json || {};

    // Build genres from RTC-style config (single genre) or advanced config (multiple genres)
    let genres = config.genres;
    if (!genres && config.genre) {
      // Convert single genre from RTC to genres object
      genres = { [config.genre]: 100 };
    }
    genres = genres || { fantasy: 70, adventure: 50 };

    // Map mood to tone for consistency
    const tone = config.tone || config.mood || 'calm';

    // Handle story type from RTC (narrative, cyoa, campaign)
    const storyType = config.type || config.story_type || 'narrative';
    const isCYOA = storyType === 'cyoa' || this.session.cyoa_enabled;
    const isCampaign = storyType === 'campaign';

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
      structure_type: 'diamond', // diamond structure recommended per CYOA research
      allow_backtrack: true,
      max_branches: 3
    };

    // Extract character/setting hints from custom_prompt if not already provided
    // This handles Advanced mode where user types their request instead of speaking it
    let characterHints = config.character_hints || [];
    let settingHints = config.setting_hints || [];
    const customPrompt = config.custom_prompt || '';

    if (customPrompt && characterHints.length === 0) {
      // Character patterns - same as in realtimeConversation.js
      const characterPatterns = [
        /\b(conan|aragorn|frodo|gandalf|harry|hermione|sherlock|watson|dracula|frankenstein)\b/gi,
        /\b(dragon|princess|prince|knight|wizard|witch|warrior|pirate|vampire|werewolf|elf|dwarf|orc|goblin|fairy|demon|angel|ghost|zombie|robot|alien|detective|spy|assassin|thief|merchant|king|queen|emperor|empress)\b/gi,
        /\b(brave|young|old|wise|evil|dark|noble|fallen|lost|wandering|mysterious|ancient)\s+(hero|heroine|warrior|mage|knight|prince|princess|king|queen|stranger|traveler)\b/gi
      ];

      for (const pattern of characterPatterns) {
        const matches = customPrompt.match(pattern);
        if (matches) {
          characterHints.push(...matches.map(m => m.toLowerCase()));
        }
      }
      characterHints = [...new Set(characterHints)];
      if (characterHints.length > 0) {
        logger.info(`[Orchestrator] Extracted character hints from custom_prompt: ${characterHints.join(', ')}`);
      }
    }

    if (customPrompt && settingHints.length === 0) {
      const settingPatterns = [
        /\b(forest|castle|dungeon|cave|mountain|ocean|sea|desert|city|village|kingdom|realm|space|planet|ship|island|swamp|jungle|arctic|underground|underwater)\b/gi,
        /\b(medieval|futuristic|modern|ancient|victorian|steampunk|cyberpunk|post-apocalyptic|magical|enchanted|haunted|cursed)\b/gi
      ];

      for (const pattern of settingPatterns) {
        const matches = customPrompt.match(pattern);
        if (matches) {
          settingHints.push(...matches.map(m => m.toLowerCase()));
        }
      }
      settingHints = [...new Set(settingHints)];
    }

    const preferences = {
      genres,
      setting_hints: settingHints,
      character_hints: characterHints,
      tone,
      story_type: storyType,
      story_format: storyFormat,
      is_campaign: isCampaign,
      bedtime_mode: this.session.bedtime_mode,
      cyoa_enabled: isCYOA,
      cyoa_settings: cyoaSettings,
      target_length: config.length || config.story_length || 'medium',
      audience: config.audience || 'general',
      intensity: config.intensity || {},
      campaign_settings: config.campaign_settings || {},
      // New story structure settings
      plot_settings: plotSettings,
      series_settings: seriesSettings,
      // Author style for writing voice
      author_style: config.author_style || null,
      // CRITICAL: Pass user's raw story request so planner knows exactly what they asked for
      // e.g., "I want a Conan the Cimmerian story" - this tells the planner to use Conan as protagonist
      // Falls back to custom_prompt from Advanced mode
      story_request: config.story_request || customPrompt || null,
      // Character count from smart config detection (e.g., "10 astronauts" = { min: 10, max: 10, estimated: 10 })
      character_count: config.character_count || null
    };

    logger.info(`Generating outline for session ${this.sessionId}`, { config, preferences });

    // Generate outline using planner agent (pass sessionId for usage tracking)
    const outline = await generateOutline(preferences, this.sessionId);

    // CRITICAL VALIDATION: Ensure outline has required fields before saving
    // This prevents "Untitled Story" with 0 characters from reaching the database
    if (!outline || typeof outline !== 'object') {
      throw new Error('Outline generation failed: received invalid outline object');
    }
    if (!outline.title || outline.title === 'Untitled Story' || outline.title.trim() === '') {
      logger.error('[Orchestrator] Outline missing title:', JSON.stringify(outline).substring(0, 500));
      throw new Error('Outline generation failed: no valid title generated');
    }
    if (!outline.main_characters || !Array.isArray(outline.main_characters) || outline.main_characters.length === 0) {
      logger.error('[Orchestrator] Outline missing characters:', JSON.stringify(outline).substring(0, 500));
      throw new Error('Outline generation failed: no characters generated');
    }
    logger.info(`[Orchestrator] Outline validated: "${outline.title}" with ${outline.main_characters.length} characters`);

    // CRITICAL FIX: Wrap all database operations in a transaction for atomicity
    // This ensures outline, session update, characters, and lore are saved together or not at all
    const result = await withTransaction(async (client) => {
      // Save outline to database (using outline_json JSONB column per schema)
      const outlineResult = await client.query(`
        INSERT INTO story_outlines (story_session_id, outline_json, themes, target_duration_minutes)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        this.sessionId,
        JSON.stringify(outline),
        outline.themes || [],
        outline.target_length === 'short' ? 5 : outline.target_length === 'long' ? 30 : 15
      ]);

      // Update session with title, synopsis, and other metadata for library display
      await client.query(
        `UPDATE story_sessions SET
          title = $1,
          synopsis = $2,
          current_status = 'narrating',
          last_activity_at = NOW()
         WHERE id = $3`,
        [outline.title, outline.synopsis || '', this.sessionId]
      );

      // Create characters
      if (outline.main_characters && outline.main_characters.length > 0) {
        for (const char of outline.main_characters) {
          await client.query(`
            INSERT INTO characters (story_session_id, name, role, description, traits_json)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            this.sessionId,
            char.name || 'Unknown',
            char.role || 'supporting',
            char.description || '',
            JSON.stringify(char.traits || [])
          ]);
        }
      }

      // Create initial lore entries
      if (outline.setting) {
        await client.query(`
          INSERT INTO lore_entries (story_session_id, entry_type, title, content, importance)
          VALUES ($1, 'location', 'Main Setting', $2, 100)
        `, [this.sessionId, outline.setting]);
      }

      return outlineResult.rows[0];
    });

    this.outline = { ...result, ...outline };

    // Verify characters were created
    const charCount = await pool.query(
      'SELECT COUNT(*) FROM characters WHERE story_session_id = $1',
      [this.sessionId]
    );
    logger.info(`[Orchestrator] Verified ${charCount.rows[0].count} characters in database`);

    logger.info(`Outline generated: ${outline.title}`);

    return outline;
  }

  /**
   * Generate the next scene
   */
  /**
   * Emit progress event if callback is registered
   */
  emitProgress(phase, detail = null) {
    logger.debug(`[Orchestrator] PROGRESS | sessionId: ${this.sessionId} | phase: ${phase} | detail: ${detail || 'none'}`);
    if (this.onProgress && typeof this.onProgress === 'function') {
      this.onProgress(phase, detail);
    }
  }

  async generateNextScene(voiceId = null, options = {}) {
    const { deferAudio = false } = options; // If true, skip TTS generation (save credits)

    this.emitProgress('loading');
    await this.loadSession();

    if (!this.outline) {
      throw new Error('No outline found. Generate outline first.');
    }

    // Get current scene count
    const sceneCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM story_scenes WHERE story_session_id = $1',
      [this.sessionId]
    );
    const sceneIndex = parseInt(sceneCountResult.rows[0].count);

    // Get previous scene for context
    let previousScene = null;
    if (sceneIndex > 0) {
      const prevResult = await pool.query(`
        SELECT summary, polished_text FROM story_scenes
        WHERE story_session_id = $1
        ORDER BY sequence_index DESC LIMIT 1
      `, [this.sessionId]);
      if (prevResult.rows.length > 0) {
        previousScene = prevResult.rows[0].summary || prevResult.rows[0].polished_text?.substring(0, 300);
      }
    }

    // Determine if this is the final scene
    const targetScenes = this.getTargetSceneCount();
    const isFinal = sceneIndex >= targetScenes - 1;

    logger.info(`[Orchestrator] INPUT | sessionId: ${this.sessionId} | sceneIndex: ${sceneIndex} | targetScenes: ${targetScenes} | isFinal: ${isFinal} | deferAudio: ${deferAudio}`);
    logger.info(`Generating scene ${sceneIndex + 1} of ~${targetScenes}`);

    // Determine scene complexity for thinking budget (from research insights)
    const complexity = determineComplexity(this.outline, sceneIndex, {
      targetScenes,
      cyoa_enabled: this.session.cyoa_enabled,
      activeCharacters: this.characters.length
    });
    logger.info(`Scene complexity: ${complexity.toFixed(2)}`);

    // Find triggered lorebook entries from previous scene context
    let lorebookContext = '';
    if (previousScene) {
      const triggeredEntries = this.lorebook.findTriggeredEntries(previousScene);
      if (triggeredEntries.length > 0) {
        lorebookContext = this.lorebook.generateContextInjection(triggeredEntries);
        logger.info(`Lorebook triggered ${triggeredEntries.length} entries`);
      }
    }

    // Get story format and settings
    const config = this.session.config_json || {};
    const plotSettings = config.plot_settings || { structure: 'three_act', ensure_resolution: true };
    const seriesSettings = config.series_settings || { protect_protagonist: true };
    const cyoaSettings = config.cyoa_settings || { structure_type: 'diamond', max_branches: 3 };
    const storyFormat = config.story_format || 'short_story';

    // ============================================================================
    // ★ C+E ARCHITECTURE: BULLETPROOF VOICE CASTING ★
    // ============================================================================
    // Option C: generateSceneWithDialogue outputs BOTH prose AND dialogue_map
    // Option E: validateAndReconcileSpeakers ensures all speakers have voices
    //
    // This guarantees 100% voice casting success by:
    // 1. Making the scene writer responsible for naming ALL speaking characters
    // 2. Creating minor characters in the database if they speak dialogue
    // 3. Assigning voices to all characters BEFORE audio generation
    // ============================================================================

    this.emitProgress('generating');
    logger.info(`[Orchestrator] Using C+E architecture for bulletproof voice casting`);

    // Use the NEW generateSceneWithDialogue that outputs dialogue metadata
    const sceneResult = await generateSceneWithDialogue({
      outline: {
        title: this.outline.title,
        setting: this.outline.setting,
        acts: this.outline.acts
      },
      sceneIndex,
      previousScene,
      characters: this.characters,
      preferences: {
        bedtime_mode: this.session.bedtime_mode,
        is_final: isFinal,
        // Plot structure for narrative arc
        plot_structure: plotSettings.structure,
        ensure_resolution: plotSettings.ensure_resolution,
        subplot_count: plotSettings.subplot_count || 1,
        // Series settings for character protection
        protect_protagonist: seriesSettings.protect_protagonist,
        open_ending: seriesSettings.open_ending,
        is_series: storyFormat === 'series' || storyFormat === 'novel',
        // Story format for scene length/style
        story_format: storyFormat,
        // CYOA structure type (diamond converges to ending)
        cyoa_structure: this.session.cyoa_enabled ? cyoaSettings.structure_type : null,
        // Author writing style (e.g., 'shakespeare', 'tolkien', 'king')
        author_style: config.author_style || null
      },
      // Research insights additions
      lorebookContext,
      storyBible: this.storyBible,
      contextSummary: this.contextSummary,
      complexity,
      sessionId: this.sessionId // For usage tracking
    });

    let rawText = sceneResult.content;

    // C+E: Extract dialogue_map and new_characters from scene result
    const sceneDialogueMap = sceneResult.dialogue_map || [];
    const sceneNewCharacters = sceneResult.new_characters || [];

    // ★ TAG-BASED MULTI-VOICE: Extract new fields from scene result ★
    const proseFormat = sceneResult.prose_format || 'position_based';
    const preComputedSegments = sceneResult.segments || null;

    logger.info(`[Orchestrator] Scene generated with ${sceneDialogueMap.length} dialogue entries, ${sceneNewCharacters.length} new characters`);
    logger.info(`[Orchestrator] Prose format: ${proseFormat} | Pre-computed segments: ${preComputedSegments ? preComputedSegments.length : 'none'}`);

    // CRITICAL FIX (2025-12-12): Determine early if multi-voice will be used
    // Use SESSION CONFIG to determine multi-voice, not dialogue_map length!
    // The previous check `sceneDialogueMap.length > 0` was too restrictive and never triggered
    // If multi_voice is enabled in config AND we have characters, skip text modifications
    const multiVoiceEnabled = this.session.config_json?.multi_voice === true || this.session.config_json?.multiVoice === true;
    const willUseMultiVoice = multiVoiceEnabled && this.characters.length > 0;

    // Log the decision factors for debugging
    logger.info(`[Orchestrator] MULTI-VOICE CHECK | config.multi_voice: ${this.session.config_json?.multi_voice} | characters: ${this.characters.length} | dialogueMap: ${sceneDialogueMap.length} | willUseMultiVoice: ${willUseMultiVoice}`);

    if (willUseMultiVoice) {
      logger.info(`[Orchestrator] MULTI-VOICE ENABLED: Skipping polishing/validation to preserve dialogue positions`);
    }

    // STORY VALIDATION: Check for missing words, placeholders, garbled text
    // User feedback: "the story had missing words 'He picked up the * * amulet'"
    // IMPORTANT: Skip validation for multi-voice to preserve dialogue positions
    const validationResult = willUseMultiVoice ? { valid: true, fixed: false } : await validateStoryText(rawText, {
      outline: this.outline,
      characters: this.characters
    }, this.sessionId);

    if (!validationResult.valid) {
      if (validationResult.fixed) {
        logger.info(`Story validator fixed ${validationResult.issues.length} issue(s)`);
        rawText = validationResult.text;
      } else {
        logger.warn('Story validation issues could not be auto-fixed:', validationResult.issues);
      }
    }

    // PARALLEL EXECUTION: Run independent checks simultaneously (from research insights)
    // These tasks don't depend on each other, so we can run them in parallel
    this.emitProgress('validating');
    logger.info('Running parallel agent checks...');
    const parallelStart = Date.now();

    // Get audience-adjusted intensity limits
    const audience = this.session.config_json?.audience || 'general';
    const audienceMultiplier = audience === 'children' ? 0 : audience === 'mature' ? 1.5 : 1;
    const intensity = this.session.config_json?.intensity || {};

    // FAIL LOUD wrapper - add context to failures so we know exactly which agent failed
    const withAgentContext = (name, promise) =>
      promise.catch(error => {
        const enhancedError = new Error(`[${name}] ${error.message}`);
        enhancedError.agent = name;
        enhancedError.originalError = error;
        enhancedError.stack = error.stack;
        throw enhancedError;
      });

    const [safetyResult, loreCheck, polishedText, storyFacts] = await Promise.all([
      // Safety check with audience-adjusted limits
      withAgentContext('SafetyAgent', checkSafety(rawText, {
        gore: Math.min((intensity.gore || 0) * audienceMultiplier, audience === 'children' ? 0 : 100),
        scary: Math.min((intensity.scary || 30) * audienceMultiplier, audience === 'children' ? 10 : 100),
        romance: Math.min((intensity.romance || 20) * audienceMultiplier, audience === 'children' ? 0 : 100),
        violence: Math.min((intensity.violence || 20) * audienceMultiplier, audience === 'children' ? 10 : 100),
        language: Math.min((intensity.language || 10) * audienceMultiplier, audience === 'children' ? 0 : 100),
        audience
      }, this.sessionId)),
      // Lore consistency check
      withAgentContext('LoreAgent', checkLoreConsistency(rawText, {
        characters: this.characters,
        setting: this.outline.setting,
        previousEvents: previousScene,
        storyBible: this.storyBible
      }, this.sessionId)),
      // Polish for narration - SKIP for multi-voice to preserve dialogue positions
      willUseMultiVoice
        ? Promise.resolve(rawText)  // Skip polishing - use raw text as-is
        : withAgentContext('PolishAgent', polishForNarration(rawText, {
            narrator_style: this.session.config_json?.narrator_style || 'warm',
            bedtime_mode: this.session.bedtime_mode
          }, this.sessionId)),
      // Extract story facts for bible
      withAgentContext('StoryFactsAgent', extractStoryFacts(rawText, {
        outline: this.outline,
        characters: this.characters
      }, this.sessionId))
    ]);

    logger.info(`Parallel checks completed in ${Date.now() - parallelStart}ms`);
    this.emitProgress('polishing');

    // Process results
    if (!safetyResult.safe) {
      logger.warn(`Scene ${sceneIndex + 1} flagged for safety: ${safetyResult.concerns.join(', ')}`);
      // Could regenerate or modify here
    }

    if (!loreCheck.consistent) {
      logger.warn(`Lore inconsistency: ${loreCheck.issues.join(', ')}`);
    }

    // Update story bible with new facts (non-blocking)
    if (storyFacts && Object.keys(storyFacts).some(k =>
      Array.isArray(storyFacts[k]) ? storyFacts[k].length > 0 : Object.keys(storyFacts[k] || {}).length > 0
    )) {
      this.updateStoryBible(storyFacts).catch(e =>
        logger.error('Failed to update story bible:', e)
      );
    }

    // Manage context window for long sessions
    if (sceneIndex > 5 && sceneIndex % 3 === 0) {
      this.manageContextWindow().catch(e =>
        logger.error('Context management failed:', e)
      );
    }

    // POST-POLISH VALIDATION: Catch any placeholders/artifacts introduced by polishing
    // Gap identified: polishForNarration could add new issues not caught by raw text validation
    // CRITICAL: Skip ALL validation for multi-voice - any text modification breaks dialogue positions
    let finalText = polishedText;

    if (willUseMultiVoice) {
      // Multi-voice: Use raw text EXACTLY as generated to preserve dialogue positions
      finalText = rawText;
      logger.info(`[Orchestrator] MULTI-VOICE: Using raw text (${rawText.length} chars) - no polishing or validation`);
    } else {
      // Non-multi-voice: Normal polishing and validation flow
      const postPolishValidation = await validateStoryText(polishedText, {
        outline: this.outline,
        characters: this.characters
      }, this.sessionId);

      if (!postPolishValidation.valid) {
        logger.warn(`Post-polish validation failed: ${postPolishValidation.issues.join(', ')}`);
        // Use the fixed text if available (property is 'text', not 'fixedText')
        if (postPolishValidation.fixed && postPolishValidation.text && postPolishValidation.text !== polishedText) {
          logger.info('Using auto-fixed polished text');
          finalText = postPolishValidation.text;
        } else if (validationResult.valid) {
          // Raw text was valid, use it as fallback
          logger.info('Falling back to raw text due to polish issues');
          finalText = rawText;
        }
      }
    }

    // Generate CYOA choices if enabled and not final
    // IMPORTANT: Don't show choices on the FIRST scene - let the story establish itself first
    // User feedback: "choose your own adventure started with showing the choices before even starting the story"
    let choices = [];
    const shouldGenerateChoices = this.session.cyoa_enabled &&
                                  !isFinal &&
                                  sceneIndex > 0; // Skip choices on first scene

    if (shouldGenerateChoices) {
      this.emitProgress('choices');
      const choiceResult = await generateChoices(finalText, {
        outline: this.outline,
        characters: this.characters,
        // Pass CYOA settings for choice generation
        max_choices: cyoaSettings.max_branches || 3,
        structure_type: cyoaSettings.structure_type || 'diamond',
        is_near_ending: sceneIndex >= targetScenes - 2 // Converge choices near ending
      }, this.sessionId);
      choices = choiceResult.choices || [];
    }

    // Determine mood
    const mood = this.determineMood(finalText);

    // ★ ALWAYS strip [CHAR] tags for display text ★
    // raw_text: Keep tags for reference/debugging
    // polished_text: Strip tags for user-facing display
    // SAFETY: Always strip tags regardless of proseFormat to prevent tag leakage
    const displayText = stripTags(finalText);

    // Save scene to database
    this.emitProgress('saving');
    const sceneRecord = await pool.query(`
      INSERT INTO story_scenes (
        story_session_id, sequence_index, branch_key, raw_text, polished_text,
        summary, mood, word_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      this.sessionId,
      sceneIndex,
      'main',
      rawText, // Keep tags in raw_text for reference
      displayText, // Strip tags for polished_text (user sees this)
      displayText.substring(0, 200),
      mood,
      displayText.split(/\s+/).length
    ]);

    logger.info(`[Orchestrator] Scene saved | raw: ${rawText.length} chars | display: ${displayText.length} chars | format: ${proseFormat}`);

    const scene = sceneRecord.rows[0];

    // ==========================================================================
    // ★ C+E ARCHITECTURE: SPEAKER VALIDATION (Option E)
    // ==========================================================================
    // The dialogue_map was already generated by generateSceneWithDialogue (Option C)
    // Now we validate and reconcile speakers to ensure 100% voice coverage
    // ==========================================================================
    let dialogueMap = sceneDialogueMap; // From Option C scene generation
    let speakerValidationResult = null;

    if (this.characters && this.characters.length > 0 && dialogueMap.length > 0) {
      try {
        this.emitProgress('validating_speakers');
        logger.info(`[SpeakerValidation] Validating ${dialogueMap.length} dialogue entries for voice coverage`);

        // Build story context for voice assignment
        const storyContext = {
          genre: this.session.config_json?.genre || 'general fiction',
          mood: this.session.config_json?.mood || mood,
          audience: this.session.config_json?.audience || 'general',
          setting: this.outline?.setting || this.session.config_json?.setting || '',
          synopsis: this.outline?.synopsis || '',
          themes: this.outline?.themes || []
        };

        // Get effective narrator voice for validation
        const configVoiceId = this.session.config_json?.voice_id || this.session.config_json?.narratorVoice;
        const isCampaign = this.session.config_json?.story_type === 'campaign';
        const DM_VOICE_ID = 'N2lVS1w4EtoT3dr4eOWO';
        const DEFAULT_NARRATOR_ID = 'JBFqnCBsd6RMkjVDRZzb';
        const narratorVoiceId = configVoiceId || (isCampaign ? DM_VOICE_ID : DEFAULT_NARRATOR_ID);

        // ★ OPTION E: Validate and reconcile speakers ★
        // This creates minor characters in DB and assigns voices
        speakerValidationResult = await validateAndReconcileSpeakers(
          this.sessionId,
          dialogueMap,
          sceneNewCharacters, // New characters from scene generation
          this.characters,
          storyContext,
          narratorVoiceId
        );

        // Update our character list with any newly created characters
        if (speakerValidationResult.createdCharacters.length > 0) {
          this.characters = [...this.characters, ...speakerValidationResult.createdCharacters];
          logger.info(`[SpeakerValidation] Added ${speakerValidationResult.createdCharacters.length} minor characters to story`);
        }

        // Save dialogue_map to database with prose_format
        const tagValidationStatus = proseFormat === 'tag_based' ? 'validated' : 'legacy';
        const speakersExtracted = proseFormat === 'tag_based'
          ? extractSpeakers(rawText)
          : dialogueMap.map(d => d.speaker).filter((v, i, a) => a.indexOf(v) === i);

        await pool.query(`
          UPDATE story_scenes
          SET dialogue_map = $1,
              dialogue_tagging_status = 'completed',
              prose_format = $2,
              tag_validation_status = $3,
              speakers_extracted = $4
          WHERE id = $5
        `, [JSON.stringify(dialogueMap), proseFormat, tagValidationStatus, speakersExtracted, scene.id]);
        logger.info(`[SpeakerValidation] Saved ${dialogueMap.length} dialogue attributions for scene ${scene.id} (format: ${proseFormat})`);
        logger.info(`[SpeakerValidation] Speakers extracted: ${speakersExtracted.join(', ')}`);

      } catch (validationError) {
        // ★ FAIL LOUD: This is a PREMIUM service - no fallbacks ★
        logger.error(`[SpeakerValidation] CRITICAL FAILURE for scene ${sceneIndex + 1}: ${validationError.message}`);
        await pool.query(`
          UPDATE story_scenes
          SET dialogue_tagging_status = 'failed', dialogue_tagging_error = $1
          WHERE id = $2
        `, [validationError.message, scene.id]);
        // RE-THROW: Stop the story generation rather than produce bad audio
        throw validationError;
      }
    } else if (dialogueMap.length === 0) {
      // No dialogue in scene - mark as skipped
      logger.info(`[SpeakerValidation] No dialogue found in scene ${sceneIndex + 1} - skipped`);
      await pool.query(`
        UPDATE story_scenes
        SET dialogue_tagging_status = 'skipped'
        WHERE id = $1
      `, [scene.id]);
    } else {
      // No characters - skip validation
      logger.info(`[SpeakerValidation] Skipped - no characters in story`);
      await pool.query(`
        UPDATE story_scenes
        SET dialogue_tagging_status = 'skipped'
        WHERE id = $1
      `, [scene.id]);
    }

    // Save choices
    if (choices.length > 0) {
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        await pool.query(`
          INSERT INTO story_choices (
            story_session_id, scene_id, choice_index, choice_key, choice_text, choice_description
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          this.sessionId,
          scene.id,
          i, // choice_index (0, 1, 2, 3)
          choice.key,
          choice.text,
          choice.description
        ]);
      }
    }

    // Update session
    await pool.query(`
      UPDATE story_sessions
      SET total_scenes = total_scenes + 1, last_activity_at = NOW()
      WHERE id = $1
    `, [this.sessionId]);

    // Generate audio if voice specified
    let audioUrl = null;
    let audioSegments = [];
    let wordTimings = null; // For karaoke/Read Along feature
    // Multi-voice determined earlier (willUseMultiVoice) - use same value here
    const useMultiVoice = willUseMultiVoice;

    if (useMultiVoice) {
      logger.info(`[Orchestrator] Multi-voice ENABLED: ${this.characters.length} characters available`);
    } else {
      logger.info(`[Orchestrator] Multi-voice disabled: characters=${this.characters.length}, config.multi_voice=${this.session.config_json?.multi_voice}`);
    }
    const isCampaign = this.session.config_json?.story_type === 'campaign' || this.session.config_json?.is_campaign;

    // Recording is disabled for campaigns (dynamic dice rolls make them uncacheable)
    const shouldRecord = this.recordingEnabled && !isCampaign;

    // Initialize recording if enabled and not already active
    if (shouldRecord && !this.activeRecording && sceneIndex === 0) {
      try {
        const pathSignature = this.session.cyoa_enabled ? null : null; // CYOA path will be built as choices are made
        const { recording } = await recordingService.startRecording(this.sessionId, {
          title: this.outline?.title || 'Story',
          voiceSnapshot: {
            voice_id: voiceId || this.session.config_json?.voice_id,
            voice_name: 'narrator',
            settings: this.session.config_json?.narratorStyleSettings
          }
        });
        this.activeRecording = recording;
        logger.info(`[Recording] Started recording ${recording.id} for session ${this.sessionId}`);
      } catch (recErr) {
        logger.error('[Recording] Failed to start recording:', recErr);
      }
    }

    // VOICE PRIORITY: 1) Explicit voiceId param, 2) Session config (voice_id or narratorVoice for backwards compat), 3) Campaign default, 4) Default narrator
    // Bug fix: Now checks both voice_id and narratorVoice for backwards compatibility
    // Bug fix: NEVER use null - null narrator breaks multi-voice character matching
    const configVoiceId = this.session.config_json?.voice_id || this.session.config_json?.narratorVoice;
    const DM_VOICE_ID = 'N2lVS1w4EtoT3dr4eOWO'; // Callum - authoritative Dungeon Master voice
    const DEFAULT_NARRATOR_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George - warm British narrator
    const effectiveVoiceId = voiceId || configVoiceId || (isCampaign ? DM_VOICE_ID : DEFAULT_NARRATOR_ID);

    logger.info(`[Orchestrator] Voice selection: param=${voiceId}, config=${configVoiceId}, effective=${effectiveVoiceId || 'SERVICE_DEFAULT'}`);

    // Generate audio unless deferAudio option is set (saves ElevenLabs credits)
    if (!deferAudio) {
      try {
        let audioBuffer;

        if (useMultiVoice) {
          // Multi-voice narration: parse dialogue and assign different voices
          logger.info(`Generating multi-voice audio for scene (campaign: ${isCampaign})`);

          // ================================================================
          // SEGMENT CREATION: TAG-BASED or POSITION-BASED
          // ================================================================
          // Tag-based: Use pre-parsed segments from tag parser (100% reliable)
          // Position-based (legacy): Use convertDialogueMapToSegments
          // ================================================================
          let segments;

          if (proseFormat === 'tag_based' && preComputedSegments && preComputedSegments.length > 0) {
            // ★ TAG-BASED: Use pre-parsed segments directly ★
            // The tagParser already extracted segments deterministically
            // No position calculation needed - 100% reliable
            logger.info(`[MultiVoice] ★ TAG-BASED MODE ★ Using ${preComputedSegments.length} pre-parsed segments`);

            // Convert tagParser segments to the format expected by TTS
            segments = preComputedSegments.map(seg => ({
              speaker: seg.speaker,
              text: seg.text,
              voice_role: seg.voice_role || (seg.type === 'narrator' ? 'narrator' : 'dialogue'),
              emotion: seg.emotion || 'neutral',
              type: seg.type
            }));

            // Strip tags from narrator segments (they contain the [CHAR] tags)
            // But only if hide_speech_tags will handle narration separately
            // Actually, for display we want to strip tags from the displayed text
            // but keep them for processing. The TTS will use stripped text.

            logger.info(`[MultiVoice] TAG-BASED | narrator: ${segments.filter(s => s.type === 'narrator').length} | dialogue: ${segments.filter(s => s.type === 'dialogue').length}`);
          } else if (dialogueMap && dialogueMap.length > 0) {
            // ★ POSITION-BASED (Legacy): Use dialogue_map with position calculation ★
            logger.info(`[MultiVoice] POSITION-BASED MODE | Using dialogue_map with ${dialogueMap.length} attributions`);
            segments = convertDialogueMapToSegments(finalText, dialogueMap);
            logger.info(`[MultiVoice] Converted dialogue_map to ${segments.length} segments`);
          } else {
            // FAIL LOUD: No fallback - dialogue data is REQUIRED for multi-voice
            // The C+E architecture (generateSceneWithDialogue + speakerValidationAgent)
            // should always produce dialogue data. If we get here, something is broken.
            logger.error(`[MultiVoice] CRITICAL: No dialogue data available - C+E architecture failure`);
            logger.error(`[MultiVoice] proseFormat: ${proseFormat} | preComputedSegments: ${preComputedSegments?.length || 0} | dialogueMap: ${dialogueMap?.length || 0}`);
            throw new Error(`MULTI-VOICE FAILED: No dialogue data. The scene writer (Option C) must produce dialogue metadata.`);
          }

          // ================================================================
          // SPEECH TAG FILTERING (when hide_speech_tags is enabled)
          // Uses LLM to intelligently identify and remove speech attributions
          // like "Ortiz suggests", "she whispered", "he said", etc.
          // ================================================================
          // FIX (Bug 14): Handle both boolean true and string "true"
          const hideSpeechTagsRaw = this.session.config_json?.hide_speech_tags;
          const hideSpeechTags = hideSpeechTagsRaw === true || hideSpeechTagsRaw === 'true';
          logger.info(`[MultiVoice] hide_speech_tags setting: ${hideSpeechTags} (raw value: ${hideSpeechTagsRaw}, type: ${typeof hideSpeechTagsRaw})`);
          if (hideSpeechTags) {
            const originalCount = segments.length;
            const originalText = segments.map(s => s.text).join('');
            logger.info(`[MultiVoice] Running LLM-based speech tag filter on ${originalCount} segments...`);

            // FAIL LOUD: This will throw if LLM returns empty or invalid results
            segments = await filterSpeechTagsWithLLM(segments, {
              title: this.session.title,
              genre: this.session.config_json?.genre
            });

            const removed = originalCount - segments.length;
            const newText = segments.map(s => s.text).join('');

            // FIX (Bug 15): Verify speech tag filter actually worked
            if (removed > 0) {
              logger.info(`[MultiVoice] LLM filtered ${removed} speech tag segments (hide_speech_tags=true)`);
            } else if (originalText === newText) {
              // No segments removed AND no text changed - filter may have failed silently
              logger.warn(`[MultiVoice] WARN: Speech tag filter made NO changes - this may indicate a problem`);
              logger.warn(`[MultiVoice] If this scene has speech attribution, it will be spoken by the narrator`);
            } else {
              logger.info(`[MultiVoice] Speech tag filter modified text content (no segments fully removed)`);
            }
          }

          logger.info(`[MultiVoice] ========== DIALOGUE PARSING RESULTS ==========`);
          logger.info(`[MultiVoice] Input text length: ${finalText.length} chars`);
          logger.info(`[MultiVoice] Parsed ${segments.length} dialogue segments`);
          let totalSegmentChars = 0;
          segments.forEach((seg, idx) => {
            totalSegmentChars += seg.text.length;
            logger.info(`[MultiVoice] Segment[${idx}] ${seg.speaker}: "${seg.text.substring(0, 80)}${seg.text.length > 80 ? '...' : ''}" (${seg.text.length} chars)`);
          });
          logger.info(`[MultiVoice] Total segment chars: ${totalSegmentChars} (input was ${finalText.length} chars)`);
          if (totalSegmentChars < finalText.length * 0.9) {
            logger.warn(`[MultiVoice] WARNING: Significant text loss detected! Only ${Math.round(totalSegmentChars/finalText.length*100)}% of input preserved`);
          }
          logger.info(`[MultiVoice] ===============================================`);

          // FIX: Load existing voice assignments from database first
          // This ensures consistent voices across all scenes
          let characterVoices = {};
          const existingAssignments = await pool.query(
            'SELECT c.name, cva.elevenlabs_voice_id FROM character_voice_assignments cva JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
            [this.sessionId]
          );

          if (existingAssignments.rows.length > 0) {
            // Use existing voice assignments
            for (const row of existingAssignments.rows) {
              characterVoices[row.name.toLowerCase()] = row.elevenlabs_voice_id;
            }
            logger.info(`[MultiVoice] Loaded ${existingAssignments.rows.length} existing voice assignments`);

            // VALIDATE existing assignments - fail if they're broken
            const validation = validateExistingAssignments(characterVoices, effectiveVoiceId);
            if (!validation.valid) {
              logger.error(`[MultiVoice] CRITICAL: Existing voice assignments are invalid: ${validation.errors.join('; ')}`);
              logger.info(`[MultiVoice] Re-running LLM voice assignment to fix...`);
              // Clear invalid assignments and re-run
              characterVoices = {};
              // Fall through to new assignment below
            }
          }

          // If no valid assignments, use LLM to assign voices
          if (Object.keys(characterVoices).length === 0 && this.characters && this.characters.length > 0) {
            // Build full story context for LLM voice assignment
            const storyContext = {
              genre: this.session.config_json?.genre || 'general fiction',
              mood: this.session.config_json?.mood || 'neutral',
              audience: this.session.config_json?.audience || 'general',
              synopsis: this.outline?.synopsis || this.session.config_json?.synopsis || '',
              themes: this.outline?.themes || this.session.config_json?.themes || [],
              setting: this.outline?.setting || this.session.config_json?.setting || ''
            };

            logger.info(`[MultiVoice] Using LLM-based voice assignment with full story context`);
            logger.info(`[MultiVoice] Context: genre=${storyContext.genre}, mood=${storyContext.mood}, audience=${storyContext.audience}`);

            // PREMIUM: LLM-based voice assignment - FAILS LOUDLY on error
            characterVoices = await assignVoicesByLLM(
              this.characters,
              storyContext,
              effectiveVoiceId,
              this.sessionId
            );

            // Persist voice assignments to database
            for (const char of this.characters) {
              const voiceId = characterVoices[char.name.toLowerCase()];
              if (voiceId) {
                await pool.query(`
                  INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
                  VALUES ($1, $2, $3)
                  ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
                `, [this.sessionId, char.id, voiceId]);
              } else {
                // FAIL LOUDLY - every character MUST have a voice
                throw new Error(`VOICE ASSIGNMENT FAILED: Character "${char.name}" has no voice assigned. This should not happen with LLM assignment.`);
              }
            }
            logger.info(`[MultiVoice] Persisted ${Object.keys(characterVoices).length} LLM-assigned voices to database`);
          }

          // Log character voices map for debugging with voice NAMES
          logger.info(`[MultiVoice] ========== CHARACTER VOICE MAP ==========`);
          const narratorVoiceName = await getVoiceNameById(effectiveVoiceId);
          logger.info(`[MultiVoice] Narrator: "${narratorVoiceName}" (${effectiveVoiceId})`);
          logger.info(`[MultiVoice] Character assignments:`);
          for (const [charName, voiceId] of Object.entries(characterVoices)) {
            const voiceName = await getVoiceNameById(voiceId);
            logger.info(`[MultiVoice]   - ${charName} → "${voiceName}" (${voiceId})`);
          }

          // Log each segment's speaker for debugging
          for (const seg of segments) {
            const matchedVoice = characterVoices[seg.speaker.toLowerCase()];
            logger.info(`[MultiVoice] Segment: speaker="${seg.speaker}", matched_voice=${matchedVoice || 'NONE (using narrator)'}, text="${seg.text.substring(0, 40)}..."`);
          }

          // VALIDATION: Ensure characterVoices is not empty when we have dialogue
          // PREMIUM: FAIL LOUDLY - no fallbacks
          const hasDialogueSpeakers = segments.some(s => s.speaker !== 'narrator');
          if (hasDialogueSpeakers && Object.keys(characterVoices).length === 0) {
            const speakers = [...new Set(segments.filter(s => s.speaker !== 'narrator').map(s => s.speaker))];
            throw new Error(`VOICE ASSIGNMENT FAILED: Dialogue exists for speakers [${speakers.join(', ')}] but no character voices are assigned. ` +
              `Characters in story: ${this.characters?.length || 0}. This indicates a critical voice casting failure.`);
          }

          // Prepare segments with voice IDs
          const preparedSegments = elevenlabs.prepareSegmentsWithVoices(
            segments,
            characterVoices,
            effectiveVoiceId // narrator/DM voice
          );

          // Count voices actually used and log with names
          const voiceUsageCounts = {};
          for (const seg of preparedSegments) {
            voiceUsageCounts[seg.voice_id] = (voiceUsageCounts[seg.voice_id] || 0) + 1;
          }
          logger.info(`[MultiVoice] ========== VOICE USAGE SUMMARY ==========`);
          logger.info(`[MultiVoice] ${Object.keys(voiceUsageCounts).length} unique voices used:`);
          for (const [voiceId, count] of Object.entries(voiceUsageCounts)) {
            const voiceName = await getVoiceNameById(voiceId);
            logger.info(`[MultiVoice]   - "${voiceName}" (${voiceId}): ${count} segment(s)`);
          }

          audioSegments = preparedSegments.map(s => ({
            speaker: s.speaker,
            voice_id: s.voice_id,
            text_preview: s.text.substring(0, 50)
          }));

          // Normalize style value from 0-100 to 0.0-1.0 if needed
          const rawStyle = this.session.config_json?.narratorStyleSettings?.style || 30;
          const normalizedStyle = rawStyle > 1 ? rawStyle / 100 : rawStyle;

          // Build story context for LLM emotion detection
          const storyContext = {
            genre: this.session.config_json?.genre || this.session.config_json?.primaryGenre || 'general fiction',
            mood: this.session.config_json?.mood || this.session.config_json?.storyMood || 'neutral',
            audience: this.session.config_json?.audience || 'general',
            sceneDescription: finalText.substring(0, 300), // Use scene text as context
            characters: this.characters || []
          };

          // Generate combined multi-voice audio WITH timestamps for karaoke
          const multiVoiceResult = await elevenlabs.generateMultiVoiceAudio(preparedSegments, {
            stability: this.session.config_json?.narratorStyleSettings?.stability || 0.5,
            style: normalizedStyle,
            sessionId: this.sessionId // For usage tracking
          }, storyContext);

          // Extract audio buffer and word timings from result
          audioBuffer = multiVoiceResult.audio;
          wordTimings = multiVoiceResult.wordTimings;

          logger.info(`Multi-voice audio generated with ${segments.length} segments, ${wordTimings?.words?.length || 0} word timestamps`);

          // Cache the combined multi-voice audio to disk
          const multiVoiceHash = elevenlabs.generateHash(finalText, effectiveVoiceId + '-multi');
          await elevenlabs.cacheMultiVoiceAudio(multiVoiceHash, audioBuffer);
        } else {
          // Normalize style value from 0-100 to 0.0-1.0 if needed
          const rawStyle = this.session.config_json?.narratorStyleSettings?.style || 30;
          const normalizedStyle = rawStyle > 1 ? rawStyle / 100 : rawStyle;

          // Log single voice narration with voice NAME
          const singleVoiceName = await getVoiceNameById(effectiveVoiceId);
          logger.info(`[Orchestrator] ========== SINGLE VOICE NARRATION ==========`);
          logger.info(`[Orchestrator] Narrator: "${singleVoiceName}" (${effectiveVoiceId})`);
          logger.info(`[Orchestrator] Text preview: "${finalText.substring(0, 60)}..."`);
          logger.info(`[Orchestrator] Recording mode: ${shouldRecord ? 'YES (with timestamps)' : 'NO'}`);

          // Single voice narration - use timestamps API for karaoke if recording enabled
          if (shouldRecord) {
            const result = await elevenlabs.textToSpeechWithTimestamps(finalText, effectiveVoiceId, {
              stability: this.session.config_json?.narratorStyleSettings?.stability || 0.5,
              style: normalizedStyle,
              sessionId: this.sessionId, // For usage tracking
              speaker: 'narrator' // For logging
            });
            audioBuffer = result.audio;
            wordTimings = result.wordTimings;
            logger.info(`[Recording] Generated audio with ${wordTimings?.word_count || 0} word timestamps`);
            logger.info(`[VOICE_PLAYED] narrator → "${singleVoiceName}" (${effectiveVoiceId}) [ORCHESTRATOR]`);
          } else {
            audioBuffer = await elevenlabs.textToSpeech(finalText, effectiveVoiceId, {
              stability: this.session.config_json?.narratorStyleSettings?.stability || 0.5,
              style: normalizedStyle,
              sessionId: this.sessionId, // For usage tracking
              speaker: 'narrator' // For logging
            });
            logger.info(`[VOICE_PLAYED] narrator → "${singleVoiceName}" (${effectiveVoiceId}) [ORCHESTRATOR]`);
          }
          logger.info(`[Orchestrator] ============================================`);
        }

        // Save audio file
        const audioHash = elevenlabs.generateHash(finalText, effectiveVoiceId + (useMultiVoice ? '-multi' : ''));
        audioUrl = `/audio/${audioHash}.mp3`;

        await pool.query(
          'UPDATE story_scenes SET audio_url = $1 WHERE id = $2',
          [audioUrl, scene.id]
        );
      } catch (e) {
        logger.error('Audio generation failed:', e);
      }
    } else {
      logger.info('[Orchestrator] Audio generation deferred (deferAudio=true) - will generate on playback');
    }

    // Generate ambient sound effects if enabled (using AI-powered SFX Coordinator)
    let sceneSfx = [];
    const sfxEnabled = this.session.config_json?.sfx_enabled !== false; // Default to enabled

    if (sfxEnabled && sfxService.enabled) {
      try {
        // Use AI-powered SFX Coordinator for smarter sound selection
        const detectedSfx = await sfxCoordinator.analyzeScene(finalText, {
          mood,
          genre: this.session.config_json?.genre,
          setting: this.outline?.setting,
          sceneIndex
        });

        if (detectedSfx && detectedSfx.length > 0) {
          logger.info(`[SFX] AI detected ${detectedSfx.length} sound effects for scene`);

          // Save SFX references to database (don't generate audio yet - client will fetch on demand)
          for (const sfx of detectedSfx) {
            try {
              // Handle both AI coordinator format and fallback keyword format
              const sfxKey = sfx.sfxKey || sfx.sfx_key || sfx.matched_sfx;
              const volume = sfx.volume || (sfxKey?.startsWith('atmosphere') ? 0.2 : 0.3);
              const isLooping = sfx.loop !== undefined ? sfx.loop : sfxKey?.includes('ambient') || sfxKey?.includes('atmosphere');

              if (!sfxKey) {
                logger.warn('[SFX] Skipping SFX with no key:', sfx);
                continue;
              }

              await pool.query(`
                INSERT INTO scene_sfx (scene_id, sfx_key, detected_keyword, detection_reason, volume)
                VALUES ($1, $2, $3, $4, $5)
              `, [
                scene.id,
                sfxKey,
                sfx.keyword || sfx.description?.substring(0, 100),
                sfx.reason || sfx.description,
                volume
              ]);

              sceneSfx.push({
                sfx_key: sfxKey,
                keyword: sfx.keyword || sfx.description?.substring(0, 50),
                reason: sfx.reason || sfx.description,
                volume,
                loop: isLooping,
                timing: sfx.timing || 'scene_start'
              });
            } catch (sfxDbError) {
              logger.error('Failed to save scene SFX:', sfxDbError);
            }
          }
        }
      } catch (sfxError) {
        logger.error('SFX detection failed:', sfxError);
        // Continue without SFX - not critical
      }
    }

    // Capture recording segment if recording is active
    if (this.activeRecording && audioUrl) {
      try {
        // Prepare SFX data for recording
        const sfxDataForRecording = sceneSfx.map(sfx => ({
          sfx_id: `${Date.now()}_${sfx.sfx_key}`,
          sfx_key: sfx.sfx_key,
          audio_url: `/audio/sfx/${sfx.sfx_key.replace(/\./g, '_')}.mp3`,
          trigger_at_seconds: 0,
          fade_in_ms: 2000,
          fade_out_ms: 2000,
          duration_seconds: 30,
          volume: sfx.volume || 0.3,
          loop: sfx.loop || false,
          keyword: sfx.keyword,
          reason: sfx.reason
        }));

        // Add recording segment
        await recordingService.addSegment(this.activeRecording.id, {
          sceneId: scene.id,
          sequenceIndex: sceneIndex,
          audioUrl,
          wordTimings,
          sceneText: finalText,
          sceneSummary: scene.summary,
          imageUrl: scene.image_url || null,
          sfxData: sfxDataForRecording,
          choicesAtEnd: choices.length > 0 ? choices : null,
          mood,
          chapterNumber: sceneIndex + 1,
          chapterTitle: `Chapter ${sceneIndex + 1}`
        });

        logger.info(`[Recording] Added segment ${sceneIndex} to recording ${this.activeRecording.id}`);

        // Complete recording if this is the final scene
        if (isFinal) {
          await recordingService.completeRecording(this.activeRecording.id);
          logger.info(`[Recording] Completed recording ${this.activeRecording.id}`);
          this.activeRecording = null;
        }
      } catch (recErr) {
        logger.error('[Recording] Failed to add segment:', recErr);
      }
    }

    // OUTPUT summary logging
    logger.info(`[Orchestrator] OUTPUT | sceneId: ${scene.id} | sceneIndex: ${sceneIndex} | textChars: ${finalText?.length || 0} | multiVoice: ${useMultiVoice} | sfxCount: ${sceneSfx?.length || 0} | hasAudio: ${!!audioUrl} | isFinal: ${isFinal}`);

    return {
      id: scene.id,
      sequence_index: sceneIndex,
      polished_text: stripTags(finalText), // CRITICAL: Strip [CHAR] tags before returning to client
      summary: scene.summary,
      mood,
      choices,
      is_final: isFinal,
      audio_url: audioUrl,
      multi_voice: useMultiVoice,
      audio_segments: audioSegments,
      sfx: sceneSfx, // Include detected SFX for client to fetch
      word_timings: wordTimings, // Include word timings for karaoke
      has_recording: !!this.activeRecording // Indicate if recording is active
    };
  }

  /**
   * Get target scene count based on story length and format
   */
  getTargetSceneCount() {
    const config = this.session.config_json || {};
    const length = config.story_length || 'medium';
    const format = config.story_format || 'short_story';

    // Base counts by length
    const baseCounts = {
      short: 3,
      medium: 8,
      long: 15
    };

    // Adjust for story format
    const formatMultipliers = {
      picture_book: 0.5,    // Fewer scenes, more illustrations
      short_story: 1,       // Standard
      novella: 1.5,         // More scenes
      novel: 2,             // Many more scenes
      series: 1             // Per entry, standard length
    };

    const baseCount = baseCounts[length] || 8;
    const multiplier = formatMultipliers[format] || 1;

    return Math.max(3, Math.round(baseCount * multiplier));
  }

  /**
   * Determine scene mood from text
   */
  determineMood(text) {
    const lowered = text.toLowerCase();

    if (lowered.includes('laugh') || lowered.includes('giggle') || lowered.includes('funny')) {
      return 'playful';
    }
    if (lowered.includes('dark') || lowered.includes('shadow') || lowered.includes('creep')) {
      return 'mysterious';
    }
    if (lowered.includes('battle') || lowered.includes('fight') || lowered.includes('ran')) {
      return 'exciting';
    }
    if (lowered.includes('sleep') || lowered.includes('dream') || lowered.includes('peaceful')) {
      return 'calm';
    }
    if (lowered.includes('sad') || lowered.includes('tear') || lowered.includes('miss')) {
      return 'emotional';
    }

    return 'neutral';
  }

  /**
   * Generate audio for a scene on-demand (for deferred audio)
   * Used when scene was created with deferAudio=true
   * Now supports multi-voice narration!
   */
  async generateSceneAudio(sceneId, voiceId = null) {
    await this.loadSession();

    // Get scene text and pre-computed dialogue_map
    const sceneResult = await pool.query(
      'SELECT id, polished_text, audio_url, dialogue_map, dialogue_tagging_status FROM story_scenes WHERE id = $1 AND story_session_id = $2',
      [sceneId, this.sessionId]
    );

    if (sceneResult.rows.length === 0) {
      throw new Error('Scene not found');
    }

    const scene = sceneResult.rows[0];

    // If audio already exists, return it
    if (scene.audio_url) {
      logger.info(`[Orchestrator] Scene ${sceneId} already has audio: ${scene.audio_url}`);
      return { audioUrl: scene.audio_url, cached: true };
    }

    // Get effective voice ID (narrator voice) - NEVER null, breaks multi-voice matching
    const configVoiceId = this.session.config_json?.voice_id || this.session.config_json?.narratorVoice;
    const DEFAULT_NARRATOR_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George - warm British narrator
    const effectiveVoiceId = voiceId || configVoiceId || DEFAULT_NARRATOR_ID;

    // Check if multi-voice is enabled
    // FIX: Match generateNextScene behavior - default to TRUE when characters exist, unless explicitly disabled
    const multiVoiceExplicitlyDisabled = this.session.config_json?.multi_voice === false || this.session.config_json?.multiVoice === false;
    const useMultiVoice = this.characters.length > 0 && !multiVoiceExplicitlyDisabled;

    logger.info(`[Orchestrator] Generating on-demand audio for scene ${sceneId}`);
    logger.info(`[Orchestrator] multi_voice: characters=${this.characters.length}, explicitlyDisabled=${multiVoiceExplicitlyDisabled}, resolved=${useMultiVoice}`);
    logger.info(`[Orchestrator] narrator voice=${effectiveVoiceId}`);

    try {
      // Normalize style value
      const rawStyle = this.session.config_json?.narratorStyleSettings?.style || 30;
      const normalizedStyle = rawStyle > 1 ? rawStyle / 100 : rawStyle;

      let audioBuffer;
      let wordTimings = null; // For karaoke/Read Along feature

      if (useMultiVoice && this.characters.length > 0) {
        // Multi-voice narration: parse dialogue and assign different voices
        logger.info(`[Orchestrator] Generating MULTI-VOICE audio for scene (${this.characters.length} characters)`);

        // ================================================================
        // USE PRE-COMPUTED DIALOGUE MAP (from DialogueTaggingAgent)
        // Check if dialogue_map exists in database from scene generation
        // ================================================================
        let segments;
        const storedDialogueMap = scene.dialogue_map;

        if (storedDialogueMap && Array.isArray(storedDialogueMap) && storedDialogueMap.length > 0) {
          // Use pre-computed dialogue map - no LLM call needed!
          logger.info(`[MultiVoice-OnDemand] Using pre-computed dialogue_map with ${storedDialogueMap.length} attributions`);
          segments = convertDialogueMapToSegments(scene.polished_text, storedDialogueMap);
          logger.info(`[MultiVoice-OnDemand] Converted dialogue_map to ${segments.length} segments`);
        } else {
          // FAIL LOUD: No fallback - dialogue_map is REQUIRED for multi-voice
          // The C+E architecture should have produced a dialogue_map during scene generation.
          logger.error(`[MultiVoice-OnDemand] CRITICAL: No dialogue_map available (status: ${scene.dialogue_tagging_status}) - C+E architecture failure`);
          throw new Error(`MULTI-VOICE FAILED: No dialogue_map for scene ${scene.id}. Regenerate the scene to fix.`);
        }

        // ================================================================
        // SPEECH TAG FILTERING (when hide_speech_tags is enabled)
        // Uses LLM to intelligently identify and remove speech attributions
        // ================================================================
        const hideSpeechTagsOnDemand = this.session.config_json?.hide_speech_tags === true;
        logger.info(`[MultiVoice-OnDemand] hide_speech_tags setting: ${hideSpeechTagsOnDemand} (config_json.hide_speech_tags = ${this.session.config_json?.hide_speech_tags})`);
        if (hideSpeechTagsOnDemand) {
          const originalCountOnDemand = segments.length;
          logger.info(`[MultiVoice-OnDemand] Running LLM-based speech tag filter on ${originalCountOnDemand} segments...`);
          segments = await filterSpeechTagsWithLLM(segments, {
            title: this.session.title,
            genre: this.session.config_json?.genre
          });
          const removedOnDemand = originalCountOnDemand - segments.length;
          if (removedOnDemand > 0) {
            logger.info(`[MultiVoice-OnDemand] LLM filtered ${removedOnDemand} speech tag segments (hide_speech_tags=true)`);
          }
        }

        logger.info(`[MultiVoice-OnDemand] ========== DIALOGUE PARSING RESULTS ==========`);
        logger.info(`[MultiVoice-OnDemand] Input text length: ${scene.polished_text.length} chars`);
        logger.info(`[MultiVoice-OnDemand] Parsed ${segments.length} dialogue segments`);
        let totalSegmentCharsOnDemand = 0;
        segments.forEach((seg, idx) => {
          totalSegmentCharsOnDemand += seg.text.length;
          logger.info(`[MultiVoice-OnDemand] Segment[${idx}] ${seg.speaker}: "${seg.text.substring(0, 80)}${seg.text.length > 80 ? '...' : ''}" (${seg.text.length} chars)`);
        });
        logger.info(`[MultiVoice-OnDemand] Total segment chars: ${totalSegmentCharsOnDemand} (input was ${scene.polished_text.length} chars)`);
        if (totalSegmentCharsOnDemand < scene.polished_text.length * 0.9) {
          logger.warn(`[MultiVoice-OnDemand] WARNING: Significant text loss detected! Only ${Math.round(totalSegmentCharsOnDemand/scene.polished_text.length*100)}% of input preserved`);
        }
        logger.info(`[MultiVoice-OnDemand] ===============================================`);

        // Load existing voice assignments from database
        let characterVoices = {};
        const existingAssignments = await pool.query(
          'SELECT c.name, cva.elevenlabs_voice_id FROM character_voice_assignments cva JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
          [this.sessionId]
        );

        logger.info(`[MultiVoice-OnDemand] Voice assignment query returned ${existingAssignments.rows.length} rows`);

        if (existingAssignments.rows.length > 0) {
          for (const row of existingAssignments.rows) {
            characterVoices[row.name.toLowerCase()] = row.elevenlabs_voice_id;
            logger.info(`[MultiVoice-OnDemand] Assignment: "${row.name}" -> ${row.elevenlabs_voice_id}`);
          }
          logger.info(`[MultiVoice-OnDemand] Loaded ${existingAssignments.rows.length} existing voice assignments`);

          // VALIDATE existing assignments - FAIL LOUDLY if invalid
          const validation = validateExistingAssignments(characterVoices, effectiveVoiceId);
          if (!validation.valid) {
            logger.error(`[MultiVoice-OnDemand] CRITICAL: Existing voice assignments are invalid: ${validation.errors.join('; ')}`);
            logger.info(`[MultiVoice-OnDemand] Re-running LLM voice assignment to fix...`);
            // Clear invalid assignments and re-run
            characterVoices = {};
          }
        }

        // If no valid assignments, use LLM to assign voices
        if (Object.keys(characterVoices).length === 0 && this.characters && this.characters.length > 0) {
          // Build full story context for LLM voice assignment
          const storyContextOnDemand = {
            genre: this.session.config_json?.genre || 'general fiction',
            mood: this.session.config_json?.mood || 'neutral',
            audience: this.session.config_json?.audience || 'general',
            synopsis: this.outline?.synopsis || this.session.config_json?.synopsis || '',
            themes: this.outline?.themes || this.session.config_json?.themes || [],
            setting: this.outline?.setting || this.session.config_json?.setting || ''
          };

          logger.info(`[MultiVoice-OnDemand] Using LLM-based voice assignment with full story context`);

          // PREMIUM: LLM-based voice assignment - FAILS LOUDLY on error
          characterVoices = await assignVoicesByLLM(
            this.characters,
            storyContextOnDemand,
            effectiveVoiceId,
            this.sessionId
          );

          // Persist voice assignments to database
          for (const char of this.characters) {
            const charVoiceId = characterVoices[char.name.toLowerCase()];
            if (charVoiceId) {
              await pool.query(`
                INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
              `, [this.sessionId, char.id, charVoiceId]);
            } else {
              throw new Error(`VOICE ASSIGNMENT FAILED: Character "${char.name}" has no voice assigned.`);
            }
          }
          logger.info(`[MultiVoice-OnDemand] Persisted ${Object.keys(characterVoices).length} LLM-assigned voices to database`);
        }

        // Log for debugging with voice NAMES
        logger.info(`[MultiVoice-OnDemand] ========== CHARACTER VOICE MAP ==========`);
        const onDemandNarratorName = await getVoiceNameById(effectiveVoiceId);
        logger.info(`[MultiVoice-OnDemand] Narrator: "${onDemandNarratorName}" (${effectiveVoiceId})`);
        logger.info(`[MultiVoice-OnDemand] Character assignments:`);
        for (const [charName, voiceId] of Object.entries(characterVoices)) {
          const voiceName = await getVoiceNameById(voiceId);
          logger.info(`[MultiVoice-OnDemand]   - ${charName} → "${voiceName}" (${voiceId})`);
        }

        // Log each segment's speaker
        for (const seg of segments) {
          const matchedVoice = characterVoices[seg.speaker.toLowerCase()];
          logger.info(`[MultiVoice-OnDemand] Segment: speaker="${seg.speaker}", voice=${matchedVoice || 'NARRATOR'}, text="${seg.text.substring(0, 40)}..."`);
        }

        // VALIDATION: Ensure characterVoices is not empty when we have dialogue
        // PREMIUM: FAIL LOUDLY - no fallbacks
        const hasDialogueSpeakersOnDemand = segments.some(s => s.speaker !== 'narrator');
        if (hasDialogueSpeakersOnDemand && Object.keys(characterVoices).length === 0) {
          const speakersOnDemand = [...new Set(segments.filter(s => s.speaker !== 'narrator').map(s => s.speaker))];
          throw new Error(`VOICE ASSIGNMENT FAILED: Dialogue exists for speakers [${speakersOnDemand.join(', ')}] but no character voices are assigned. ` +
            `Characters in story: ${this.characters?.length || 0}. This indicates a critical voice casting failure.`);
        }

        // Prepare segments with voice IDs
        const preparedSegments = elevenlabs.prepareSegmentsWithVoices(
          segments,
          characterVoices,
          effectiveVoiceId // narrator voice
        );

        // Log voice usage with names
        const voiceUsageCounts = {};
        for (const seg of preparedSegments) {
          voiceUsageCounts[seg.voice_id] = (voiceUsageCounts[seg.voice_id] || 0) + 1;
        }
        logger.info(`[MultiVoice-OnDemand] ========== VOICE USAGE SUMMARY ==========`);
        logger.info(`[MultiVoice-OnDemand] ${Object.keys(voiceUsageCounts).length} unique voices used:`);
        for (const [voiceId, count] of Object.entries(voiceUsageCounts)) {
          const voiceName = await getVoiceNameById(voiceId);
          logger.info(`[MultiVoice-OnDemand]   - "${voiceName}" (${voiceId}): ${count} segment(s)`);
        }

        // Build story context for LLM emotion detection
        const storyContext = {
          genre: this.session.config_json?.genre || this.session.config_json?.primaryGenre || 'general fiction',
          mood: this.session.config_json?.mood || this.session.config_json?.storyMood || 'neutral',
          audience: this.session.config_json?.audience || 'general',
          sceneDescription: scene.polished_text?.substring(0, 300) || '',
          characters: this.characters || []
        };

        // Generate combined multi-voice audio WITH timestamps for karaoke
        const multiVoiceResult = await elevenlabs.generateMultiVoiceAudio(preparedSegments, {
          stability: this.session.config_json?.narratorStyleSettings?.stability || 0.5,
          style: normalizedStyle,
          sessionId: this.sessionId
        }, storyContext);

        // Extract audio buffer and word timings from result
        audioBuffer = multiVoiceResult.audio;
        wordTimings = multiVoiceResult.wordTimings;

        logger.info(`[MultiVoice-OnDemand] Multi-voice audio generated with ${segments.length} segments, ${wordTimings?.words?.length || 0} word timestamps`);

        // Cache the combined multi-voice audio
        const multiVoiceHash = elevenlabs.generateHash(scene.polished_text, effectiveVoiceId + '-multi');
        await elevenlabs.cacheMultiVoiceAudio(multiVoiceHash, audioBuffer);

      } else {
        // Single voice narration with voice name logging
        const onDemandSingleVoiceName = await getVoiceNameById(effectiveVoiceId);
        logger.info(`[Orchestrator-OnDemand] ========== SINGLE VOICE NARRATION ==========`);
        logger.info(`[Orchestrator-OnDemand] Narrator: "${onDemandSingleVoiceName}" (${effectiveVoiceId})`);
        logger.info(`[Orchestrator-OnDemand] Text preview: "${scene.polished_text.substring(0, 60)}..."`);

        audioBuffer = await elevenlabs.textToSpeech(scene.polished_text, effectiveVoiceId, {
          stability: this.session.config_json?.narratorStyleSettings?.stability || 0.5,
          style: normalizedStyle,
          sessionId: this.sessionId,
          speaker: 'narrator' // For logging
        });
        logger.info(`[VOICE_PLAYED] narrator → "${onDemandSingleVoiceName}" (${effectiveVoiceId}) [ON-DEMAND]`);
        logger.info(`[Orchestrator-OnDemand] ============================================`);
      }

      // Save audio file
      const audioHash = elevenlabs.generateHash(scene.polished_text, effectiveVoiceId || 'default');
      const audioUrl = `/audio/${audioHash}.mp3`;

      await pool.query(
        'UPDATE story_scenes SET audio_url = $1 WHERE id = $2',
        [audioUrl, sceneId]
      );

      logger.info(`[Orchestrator] On-demand audio generated: ${audioUrl}, ${wordTimings?.words?.length || 0} word timings`);
      return { audioUrl, cached: false, audioBuffer, wordTimings };

    } catch (error) {
      logger.error(`[Orchestrator] On-demand audio generation failed for scene ${sceneId}:`, error);
      throw error;
    }
  }

  /**
   * End the story gracefully
   */
  async endStory() {
    await this.loadSession();

    // Generate ending summary
    const summaryPrompt = `
      Summarize this story session:
      Title: ${this.outline?.title || 'Story'}
      Scenes: ${this.session.total_scenes}

      Create a brief, warm closing that fits the story's tone.
    `;

    const summaryResult = await callAgent('narrator', summaryPrompt, {
      outline: this.outline,
      userPreferences: { bedtime_mode: this.session.bedtime_mode }
    });

    // Update session
    await pool.query(`
      UPDATE story_sessions
      SET current_status = 'finished', ended_at = NOW()
      WHERE id = $1
    `, [this.sessionId]);

    return {
      message: 'Story completed',
      closing: summaryResult.content,
      stats: {
        title: this.outline?.title,
        scenes: this.session.total_scenes
      }
    };
  }
}

export default Orchestrator;
