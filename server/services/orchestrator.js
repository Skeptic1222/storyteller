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
 * MODULAR STRUCTURE:
 *   - orchestrator/contextManager.js: Session/context loading
 *   - orchestrator/sceneHelpers.js: Scene utilities
 *   - orchestrator/inputProcessors.js: Voice/config input processing
 *   - orchestrator/voiceHelpers.js: Voice selection utilities
 *   - orchestrator/audioHelpers.js: Audio generation helpers
 *
 * ============================================================================
 */

import { pool, withTransaction } from '../database/pool.js';
import { logger, logAlert } from '../utils/logger.js';
import { DEFAULT_NARRATOR_VOICE_ID, DM_VOICE_ID } from '../constants/voices.js';
import { normalizeStyleValue } from '../utils/styleUtils.js';
import { calculateEffectiveLimits } from '../utils/audienceLimits.js';
import { runHybridPipeline, validateUserIntent } from './hybridContentPipeline.js';

// Import orchestrator modules
import {
  loadSessionData,
  loadOutline,
  loadCharacters,
  loadLore,
  loadStoryBibleSession,
  loadStoryBible,
  updateStoryBible as updateStoryBibleDB,
  loadContextSummary,
  manageContextWindow,
  getOptimizedContext,
  buildAdvancedModeContext
} from './orchestrator/contextManager.js';

import {
  getSceneCount,
  getPreviousScene,
  getTargetSceneCount,
  determineMood,
  saveScene,
  saveDialogueMap,
  markDialogueTaggingFailed,
  markDialogueTaggingSkipped,
  saveChoices,
  updateSessionAfterScene,
  saveSceneAudio,
  getSceneForAudio,
  buildScenePreferences
} from './orchestrator/sceneHelpers.js';

import {
  processConfiguration as processConfigInput,
  processVoiceInput as processVoiceInputHelper,
  buildOutlinePreferences
} from './orchestrator/inputProcessors.js';

import {
  getEffectiveVoiceId,
  shouldHideSpeechTags,
  shouldUseMultiVoice,
  convertTagSegmentsToTTS,
  logSegmentAnalysis,
  buildVoiceAssignmentsMap,
  buildVoiceAssignmentContext
} from './orchestrator/voiceHelpers.js';

import {
  logVoiceUsage,
  buildEmotionContext,
  mapToAudioSegments,
  logCharacterVoiceMap,
  buildAudioGenerationOptions,
  logSingleVoiceNarration
} from './orchestrator/audioHelpers.js';

// OpenAI agents
import {
  callAgent,
  generateOutline,
  generateSceneWithDialogue,
  generateScaffoldedScene,
  polishForNarration,
  checkSafety,
  generateChoices,
  checkLoreConsistency,
  countTokens,
  extractStoryFacts,
  determineComplexity,
  validateStoryText
} from './openai.js';

// Venice Scaffolding Pipeline - OpenAI creates structure, Venice enhances explicit content
import { shouldUseScaffoldingPipeline } from './prompts/scaffoldPromptTemplates.js';
import { runScaffoldingPipeline } from './veniceEnhancer.js';
import { getAuthorStyle } from './authorStyles.js';

// External services
import { ElevenLabsService, getVoiceNameById } from './elevenlabs.js';
import { LorebookService } from './lorebook.js';
import { SoundEffectsService } from './soundEffects.js';
import { SFXCoordinatorAgent } from './agents/sfxCoordinator.js';
import { getNarratorDeliveryDirectives } from './agents/narratorDeliveryAgent.js';
import { recordingService } from './recording.js';
import * as usageTracker from './usageTracker.js';

// Voice and dialogue agents
import { assignVoicesByLLM, validateExistingAssignments } from './agents/voiceAssignmentAgent.js';
import { validateAndReconcileSpeakers } from './agents/speakerValidationAgent.js';
import { convertDialogueMapToSegments } from './agents/dialogueSegmentUtils.js';
import { filterSpeechTagsSmart } from './agents/speechTagFilterAgent.js';
import { extractSpeakers, stripTags, parseTaggedProse } from './agents/tagParser.js';
import { directVoiceActing } from './agents/voiceDirectorAgent.js';

// Voice profile agents - generate mood and character voice profiles at story creation
import { generateStoryMoodProfile } from './agents/storyMoodProfileAgent.js';
import { generateCharacterVoiceProfiles, validateVoiceConsistencyBatch } from './agents/characterVoiceProfileAgent.js';

// Picture book character consistency - pre-generate FalAI character references
import { preGenerateCharacterReferences } from './pictureBookImageGenerator.js';

// P1 FIX: Minimum word count for chapters to ensure quality content
// Picture books use a lower threshold (150 words), all others use 1500
const MIN_CHAPTER_WORDS = {
  picture_book: 150,
  short_story: 1000,
  default: 1500
};

// Voice consistency check configuration
// Check character voice consistency every VOICE_CONSISTENCY_CHECK_INTERVAL words
const VOICE_CONSISTENCY_CHECK_INTERVAL = 10000; // 10k words

/**
 * Get minimum word count for story format
 * @param {string} storyFormat - Story format from config
 * @returns {number} Minimum word count
 */
function getMinWordCount(storyFormat) {
  return MIN_CHAPTER_WORDS[storyFormat] || MIN_CHAPTER_WORDS.default;
}

/**
 * Check if scene text meets minimum word count
 * @param {string} text - Scene text
 * @param {string} storyFormat - Story format
 * @returns {{ passes: boolean, wordCount: number, minRequired: number }}
 */
function checkMinimumWordCount(text, storyFormat = 'default') {
  const wordCount = text?.split(/\s+/).filter(w => w.length > 0).length || 0;
  const minRequired = getMinWordCount(storyFormat);
  return {
    passes: wordCount >= minRequired,
    wordCount,
    minRequired
  };
}

/**
 * Validate chapter length and request regeneration if too short
 * FIX: Chapters were reported as 4-5x too short - this adds retry logic
 *
 * @param {string} text - Scene text to validate
 * @param {string} storyFormat - Story format (default, short_story, picture_book)
 * @param {Function} regenerateFunc - Async function to regenerate content
 * @param {Object} context - Additional context for regeneration
 * @param {number} maxAttempts - Maximum regeneration attempts (default 2)
 * @returns {Promise<{content: string, attempt: number, isRegenerated: boolean, wordCount: number}>}
 */
async function validateAndRegenerateIfShort(text, storyFormat, regenerateFunc, context = {}, maxAttempts = 2) {
  const minWords = getMinWordCount(storyFormat);
  let currentText = text;
  let attempt = 0;

  while (attempt < maxAttempts) {
    const wordCount = currentText?.split(/\s+/).filter(w => w.length > 0).length || 0;

    if (wordCount >= minWords) {
      if (attempt > 0) {
        logger.info(`[ValidateRegenerate] SUCCESS after ${attempt} regeneration(s) | wordCount: ${wordCount} | minRequired: ${minWords}`);
      }
      return {
        content: currentText,
        attempt: attempt + 1,
        isRegenerated: attempt > 0,
        wordCount
      };
    }

    attempt++;

    if (attempt < maxAttempts && regenerateFunc) {
      logger.warn(`[ValidateRegenerate] REGENERATING | wordCount: ${wordCount} | minRequired: ${minWords} | attempt: ${attempt}/${maxAttempts}`);

      try {
        // Call regeneration function with enhanced context
        const enhancedContext = {
          ...context,
          isRetryAttempt: true,
          previousWordCount: wordCount,
          minRequiredWords: minWords,
          retryReason: `Chapter was ${wordCount} words but needs at least ${minWords} words`
        };

        currentText = await regenerateFunc(enhancedContext);
      } catch (regenError) {
        logger.error(`[ValidateRegenerate] Regeneration attempt ${attempt} failed: ${regenError.message}`);
        break;
      }
    } else if (!regenerateFunc) {
      logger.warn(`[ValidateRegenerate] No regenerate function provided, cannot retry`);
      break;
    }
  }

  // Final word count check
  const finalWordCount = currentText?.split(/\s+/).filter(w => w.length > 0).length || 0;
  logger.warn(`[ValidateRegenerate] FINAL | wordCount: ${finalWordCount} | minRequired: ${minWords} | attempts: ${attempt} | passed: ${finalWordCount >= minWords}`);

  return {
    content: currentText,
    attempt: attempt,
    isRegenerated: attempt > 0,
    wordCount: finalWordCount,
    passedMinimum: finalWordCount >= minWords
  };
}

/**
 * Extract dialogue from scene content, with optional graceful fallback.
 * Attempts to parse [CHAR:Name]dialogue[/CHAR] tags first.
 *
 * @param {string} content - The prose content
 * @param {Array} characters - Known characters
 * @param {Object} options - Configuration options
 * @param {boolean} options.allowEmptyDialogue - If true, return empty dialogue map instead of throwing on missing tags
 * @param {string} options.sourceType - Source pipeline type for logging ('scaffold', 'hybrid', 'standard')
 * @returns {Object} { dialogueMap, newCharacters, format }
 */
function extractDialogueFromContent(content, characters, options = {}) {
  const { allowEmptyDialogue = false, sourceType = 'unknown' } = options;

  // Try to extract dialogue using tag parser (if Venice used tags)
  const segments = parseTaggedProse(content);

  if (segments && segments.length > 0) {
    // Tags were found - convert segments to dialogue map format
    const dialogueMap = [];
    const speakersFound = new Set();

    segments.forEach((segment, index) => {
      if (segment.type === 'dialogue') {
        speakersFound.add(segment.speaker);
        dialogueMap.push({
          speaker: segment.speaker,
          text: segment.text,
          index: index
        });
      }
    });

    // Find new characters (not in known characters)
    const knownNames = new Set(characters.map(c => c.name.toLowerCase()));
    const newCharacters = [...speakersFound]
      .filter(name => !knownNames.has(name.toLowerCase()))
      .map(name => ({
        name,
        gender: 'unknown',
        role: 'minor',
        description: 'Character introduced in scene'
      }));

    logger.info(`[extractDialogueFromContent] Found ${dialogueMap.length} dialogue entries via tags, ${newCharacters.length} new characters`);

    return {
      dialogueMap,
      newCharacters,
      format: 'tag_based'
    };
  }

  // No tags found - check if graceful fallback is allowed
  if (allowEmptyDialogue) {
    logger.warn(`[extractDialogueFromContent] No dialogue tags found in ${sourceType} output - returning narrator-only content. ` +
      `This may result in single-voice audio. Content length: ${content.length} chars`);

    return {
      dialogueMap: [],
      newCharacters: [],
      format: 'narrator_only',
      narratorSegments: [{ type: 'narrator', text: content }]
    };
  }

  // Fail loud (premium policy) - no graceful fallback allowed
  const errMsg = '[extractDialogueFromContent] Dialogue tags missing; refusing regex/quote fallback. Regenerate scene with dialogue_map tags.';
  logger.error(errMsg);
  throw new Error(errMsg);
}

// Service instances
const elevenlabs = new ElevenLabsService();
const sfxService = new SoundEffectsService();
const sfxCoordinator = new SFXCoordinatorAgent();

export class Orchestrator {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.session = null;
    this.outline = null;
    this.characters = [];
    this.lore = [];
    this.storyBible = null;
    this.contextSummary = null;
    this.lorebook = new LorebookService(sessionId);
    this.activeRecording = null;
    this.recordingEnabled = true;

    // Advanced Mode (Story Bible context)
    this.storyBibleContext = null;
    this.isAdvancedMode = false;

    // Initialize usage tracking
    usageTracker.initSessionUsage(sessionId);
    logger.info(`[Orchestrator] Usage tracking initialized for session ${sessionId}`);

    // Heartbeat mechanism for long-running operations
    this._heartbeatInterval = null;
    this._heartbeatCount = 0;

    // Voice consistency tracking
    // Track cumulative word count across scenes for consistency checks
    this._cumulativeWordCount = 0;
    this._lastConsistencyCheckWordCount = 0;
    this._characterDialogueBuffer = new Map(); // Character name -> array of dialogue strings
    this._voiceConsistencyResults = new Map(); // Character name -> last consistency result
  }

  /**
   * Load all session data
   * OPTIMIZED: Parallelized independent loads for faster startup
   */
  async loadSession() {
    // OPTIMIZATION: Batch 1 - Load independent data in parallel
    const [sessionData, storyBibleSession, outline, storyBible, contextSummary] = await Promise.all([
      loadSessionData(this.sessionId),
      loadStoryBibleSession(this.sessionId),
      loadOutline(this.sessionId),
      loadStoryBible(this.sessionId),
      loadContextSummary(this.sessionId)
    ]);

    this.session = sessionData;
    this.storyBibleContext = storyBibleSession;
    this.isAdvancedMode = !!this.storyBibleContext;
    this.storyBible = storyBible;
    this.contextSummary = contextSummary;

    // Set outline (use storyBibleContext fallback if needed)
    this.outline = outline;
    if (!this.outline && this.storyBibleContext?.outline) {
      this.outline = this.storyBibleContext.outline;
    }

    logger.info(`[Orchestrator] Session loaded | id: ${this.sessionId} | hide_speech_tags: ${this.session.config_json?.hide_speech_tags} | multi_voice: ${this.session.config_json?.multi_voice}`);

    // OPTIMIZATION: Batch 2 - Load characters and lore in parallel (depend on storyBibleContext)
    const [characters, lore] = await Promise.all([
      loadCharacters(this.sessionId, this.storyBibleContext),
      loadLore(this.sessionId, this.storyBibleContext)
    ]);

    this.characters = characters;
    this.lore = lore;

    // Load lorebook entries (depends on sessionId only)
    await this.lorebook.loadEntries();

    // Load voice profiles from config_json if they exist (generated during outline creation)
    const config = this.session.config_json || {};
    if (config.story_mood_profile) {
      this.storyMoodProfile = config.story_mood_profile;
      logger.info(`[Orchestrator] Loaded story mood profile: ${this.storyMoodProfile.overall_mood}, pacing=${this.storyMoodProfile.pacing}`);
    }

    if (config.character_voice_profiles) {
      // Convert from JSON object back to Map for easier lookup
      this.characterVoiceProfiles = new Map();
      for (const [name, profile] of Object.entries(config.character_voice_profiles)) {
        this.characterVoiceProfiles.set(name, profile);
      }
      logger.info(`[Orchestrator] Loaded ${this.characterVoiceProfiles.size} character voice profiles`);
    }

    return this.session;
  }

  /**
   * Update story bible with new facts
   */
  async updateStoryBible(updates) {
    if (!this.storyBible) {
      this.storyBible = await loadStoryBible(this.sessionId);
    }
    this.storyBible = await updateStoryBibleDB(this.sessionId, this.storyBible, updates);
  }

  /**
   * Get optimized context for scene generation
   */
  getOptimizedContext() {
    return getOptimizedContext({
      contextSummary: this.contextSummary,
      storyBible: this.storyBible,
      characters: this.characters,
      lore: this.lore
    });
  }

  /**
   * Emit progress event if callback is registered
   * Enhanced with timing data for accurate progress bar
   */
  emitProgress(phase, detail = null) {
    const timestamp = Date.now();
    const elapsed = this._progressStartTime ? timestamp - this._progressStartTime : 0;

    // Log with timing for backend analysis
    logger.info(`[Orchestrator] PROGRESS | sessionId: ${this.sessionId} | phase: ${phase} | elapsed: ${elapsed}ms${detail ? ` | ${detail}` : ''}`);

    if (this.onProgress && typeof this.onProgress === 'function') {
      this.onProgress(phase, detail);
    }
  }

  /**
   * Start progress tracking timer
   */
  startProgressTimer() {
    this._progressStartTime = Date.now();
    logger.info(`[Orchestrator] ========== GENERATION STARTED | sessionId: ${this.sessionId} ==========`);
  }

  /**
   * Log elapsed time for a sub-operation
   */
  logTiming(operation, startTime) {
    const duration = Date.now() - startTime;
    logger.info(`[Orchestrator] TIMING | ${operation} | duration: ${duration}ms`);
    return duration;
  }

  /**
   * Start heartbeat progress updates for long-running operations
   * Emits progress every 30 seconds to prevent stall detection false positives
   * @param {string} phase - The progress phase name
   * @param {string} baseMessage - Base message to display (will be appended with elapsed time)
   */
  startHeartbeat(phase, baseMessage) {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    this._heartbeatCount = 0;
    const startTime = Date.now();

    // Emit immediately
    this.emitProgress(phase, baseMessage);

    // Then emit every 30 seconds
    this._heartbeatInterval = setInterval(() => {
      this._heartbeatCount++;
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      const elapsedMin = Math.floor(elapsedSeconds / 60);
      const elapsedSec = elapsedSeconds % 60;
      const timeStr = elapsedMin > 0 ? `${elapsedMin}m ${elapsedSec}s` : `${elapsedSec}s`;

      // Cycle through encouraging messages
      const messages = [
        `${baseMessage} (${timeStr} elapsed)`,
        `Still working... complex stories take time (${timeStr})`,
        `Processing characters and dialogue (${timeStr})`,
        `Building your story (${timeStr} elapsed)`,
        `Almost there... finalizing content (${timeStr})`
      ];
      const messageIndex = this._heartbeatCount % messages.length;

      this.emitProgress(phase, messages[messageIndex]);
      logger.info(`[Orchestrator] HEARTBEAT | phase: ${phase} | count: ${this._heartbeatCount} | elapsed: ${timeStr}`);
    }, 30000); // 30 seconds

    logger.info(`[Orchestrator] Heartbeat started for phase: ${phase}`);
  }

  /**
   * Stop heartbeat progress updates
   */
  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
      this._heartbeatCount = 0;
      logger.info(`[Orchestrator] Heartbeat stopped`);
    }
  }

  /**
   * Track dialogue and check voice consistency for long narratives.
   * Called after each scene is generated to accumulate dialogue and
   * trigger consistency checks every 10,000 words.
   *
   * @param {string} sceneText - The full scene text
   * @param {Array} dialogueMap - The dialogue map with speaker assignments
   * @returns {Promise<Object|null>} Consistency check results if run, null otherwise
   */
  async _trackAndCheckVoiceConsistency(sceneText, dialogueMap) {
    // Skip if no voice profiles are available
    if (!this.characterVoiceProfiles || this.characterVoiceProfiles.size === 0) {
      return null;
    }

    // Calculate scene word count
    const sceneWordCount = sceneText?.split(/\s+/).filter(w => w.length > 0).length || 0;
    this._cumulativeWordCount += sceneWordCount;

    // Accumulate dialogue by character
    if (dialogueMap && dialogueMap.length > 0) {
      for (const entry of dialogueMap) {
        const speaker = entry.speaker?.toLowerCase();
        if (speaker && speaker !== 'narrator') {
          if (!this._characterDialogueBuffer.has(speaker)) {
            this._characterDialogueBuffer.set(speaker, []);
          }
          this._characterDialogueBuffer.get(speaker).push(entry.text || '');
        }
      }
    }

    logger.info(`[VoiceConsistency] Word count tracking | cumulative: ${this._cumulativeWordCount} | lastCheck: ${this._lastConsistencyCheckWordCount} | threshold: ${VOICE_CONSISTENCY_CHECK_INTERVAL}`);

    // Check if we've crossed the consistency check threshold
    const wordsSinceLastCheck = this._cumulativeWordCount - this._lastConsistencyCheckWordCount;
    if (wordsSinceLastCheck < VOICE_CONSISTENCY_CHECK_INTERVAL) {
      return null;
    }

    // Time for a consistency check
    logger.info(`[VoiceConsistency] Triggering mid-story voice consistency check at ${this._cumulativeWordCount} words`);

    // Build character dialogue map for validation (use recent ~2000 words per character)
    const characterDialogueForCheck = new Map();
    for (const [charName, dialogueArray] of this._characterDialogueBuffer.entries()) {
      // Join dialogue and take last ~2000 words
      const fullDialogue = dialogueArray.join(' ');
      const words = fullDialogue.split(/\s+/);
      const recentWords = words.slice(-2000);
      const recentDialogue = recentWords.join(' ');

      if (recentDialogue.length > 100) {
        characterDialogueForCheck.set(charName, recentDialogue);
      }
    }

    // Skip if no substantial dialogue to check
    if (characterDialogueForCheck.size === 0) {
      logger.info('[VoiceConsistency] No substantial character dialogue to validate');
      this._lastConsistencyCheckWordCount = this._cumulativeWordCount;
      return null;
    }

    try {
      // Run the batch consistency check (non-blocking to story generation)
      const consistencyResults = await validateVoiceConsistencyBatch(
        characterDialogueForCheck,
        this.characterVoiceProfiles,
        this.sessionId
      );

      // Update tracking
      this._lastConsistencyCheckWordCount = this._cumulativeWordCount;
      this._voiceConsistencyResults = consistencyResults;

      // Log summary
      const driftSummary = [];
      for (const [charName, result] of consistencyResults.entries()) {
        if (result.driftScore > 0) {
          driftSummary.push({
            character: charName,
            driftScore: result.driftScore,
            isConsistent: result.isConsistent,
            summary: result.summary
          });
        }
      }

      if (driftSummary.length > 0) {
        logger.info('[VoiceConsistency] Mid-story consistency check complete', {
          sessionId: this.sessionId,
          cumulativeWords: this._cumulativeWordCount,
          charactersChecked: consistencyResults.size,
          driftSummary
        });
      }

      // Store drift metrics in session for potential UI display
      try {
        const driftMetrics = {
          lastCheckWordCount: this._cumulativeWordCount,
          lastCheckTime: new Date().toISOString(),
          results: Object.fromEntries(
            Array.from(consistencyResults.entries()).map(([name, result]) => [
              name,
              {
                driftScore: result.driftScore,
                isConsistent: result.isConsistent,
                summary: result.summary
              }
            ])
          )
        };

        await pool.query(`
          UPDATE story_sessions
          SET config_json = jsonb_set(
            COALESCE(config_json, '{}'::jsonb),
            '{voice_consistency_metrics}',
            $2::jsonb
          )
          WHERE id = $1
        `, [this.sessionId, JSON.stringify(driftMetrics)]);

      } catch (dbError) {
        logger.warn(`[VoiceConsistency] Failed to store drift metrics: ${dbError.message}`);
        // Non-critical - don't fail for metrics storage
      }

      return {
        cumulativeWordCount: this._cumulativeWordCount,
        charactersChecked: consistencyResults.size,
        results: Object.fromEntries(consistencyResults)
      };

    } catch (error) {
      // Voice consistency check is enhancement only - don't fail generation
      logger.error(`[VoiceConsistency] Check failed (non-fatal): ${error.message}`);
      this._lastConsistencyCheckWordCount = this._cumulativeWordCount;
      return null;
    }
  }

  /**
   * Process configuration input
   */
  async processConfiguration(input) {
    await this.loadSession();
    return processConfigInput(this.sessionId, this.session, input);
  }

  /**
   * Process voice input during story
   */
  async processVoiceInput(transcript) {
    await this.loadSession();

    const result = processVoiceInputHelper({
      transcript,
      session: this.session,
      processConfig: null
    });

    // Handle config processing
    if (result.type === 'config' && result.processConfig) {
      return await this.processConfiguration(transcript);
    }

    return result;
  }

  /**
   * Generate story outline
   */
  async generateOutline() {
    this.emitProgress('outline_loading');

    // PHASE 2 FIX: Add try-catch around loadSession for better error context
    try {
      await this.loadSession();
    } catch (loadError) {
      logger.error(`[Orchestrator] Failed to load session ${this.sessionId}:`, {
        error: loadError.message,
        stack: loadError.stack
      });
      throw new Error(`Failed to load session: ${loadError.message}`);
    }

    const config = this.session.config_json || {};
    const preferences = buildOutlinePreferences(this.session, config);

    logger.info(`Generating outline for session ${this.sessionId}`, { preferences });

    // Generate outline
    this.emitProgress('outline_generating');
    const outline = await generateOutline(preferences, this.sessionId);
    this.emitProgress('outline_validating');

    // Validate outline
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

    // Save in transaction
    this.emitProgress('outline_saving');
    const result = await withTransaction(async (client) => {
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

      await client.query(
        `UPDATE story_sessions SET title = $1, synopsis = $2, current_status = 'narrating', last_activity_at = NOW() WHERE id = $3`,
        [outline.title, outline.synopsis || '', this.sessionId]
      );

      // Create characters
      if (outline.main_characters?.length > 0) {
        for (const char of outline.main_characters) {
          await client.query(`
            INSERT INTO characters (story_session_id, name, role, description, traits_json)
            VALUES ($1, $2, $3, $4, $5)
          `, [this.sessionId, char.name || 'Unknown', char.role || 'supporting', char.description || '', JSON.stringify(char.traits || [])]);
        }
      }

      // Create initial lore
      if (outline.setting) {
        await client.query(`
          INSERT INTO lore_entries (story_session_id, entry_type, title, content, importance)
          VALUES ($1, 'location', 'Main Setting', $2, 100)
        `, [this.sessionId, outline.setting]);
      }

      return outlineResult.rows[0];
    });

    this.outline = { ...result, ...outline };

    // ★ NEW: Generate voice profiles for better emotional narration ★
    // This runs in parallel to avoid slowing down outline generation too much
    try {
      this.emitProgress('outline_analyzing_mood');

      const config = this.session.config_json || {};
      const genreForProfile = config.genre || config.genres?.primary || 'general fiction';
      const themes = outline.themes || config.themes || [];
      const audience = config.audience || 'general';

      // Calculate average intensity from all intensity settings
      const intensity = config.intensity || {};
      const intensityValues = [
        intensity.violence || 0,
        intensity.romance || 0,
        intensity.adultContent || 0,
        intensity.gore || 0
      ];
      const avgIntensity = intensityValues.reduce((a, b) => a + b, 0) / intensityValues.length;

      // Generate story mood profile
      const storyMoodProfile = await generateStoryMoodProfile({
        synopsis: outline.synopsis || '',
        genre: genreForProfile,
        themes,
        targetAudience: audience,
        intensityLevel: avgIntensity
      });

      logger.info(`[Orchestrator] Story mood profile generated: ${storyMoodProfile.overall_mood}, pacing=${storyMoodProfile.pacing}`);

      // Generate character voice profiles for all main characters
      const characterVoiceProfiles = new Map();
      if (outline.main_characters?.length > 0) {
        const storyContext = {
          genre: genreForProfile,
          mood: storyMoodProfile.overall_mood,
          themes
        };

        const profiles = await generateCharacterVoiceProfiles(outline.main_characters, storyContext);
        for (const [name, profile] of profiles) {
          characterVoiceProfiles.set(name, profile);
        }

        logger.info(`[Orchestrator] Character voice profiles generated for ${profiles.size} characters`);
      }

      // Store profiles in config_json for later use during audio generation
      // Convert Map to object for JSON storage
      const characterProfilesObj = {};
      for (const [name, profile] of characterVoiceProfiles) {
        characterProfilesObj[name] = profile;
      }

      await pool.query(`
        UPDATE story_sessions
        SET config_json = jsonb_set(
          jsonb_set(config_json, '{story_mood_profile}', $2::jsonb),
          '{character_voice_profiles}', $3::jsonb
        )
        WHERE id = $1
      `, [
        this.sessionId,
        JSON.stringify(storyMoodProfile),
        JSON.stringify(characterProfilesObj)
      ]);

      // Store on instance for immediate use
      this.storyMoodProfile = storyMoodProfile;
      this.characterVoiceProfiles = characterVoiceProfiles;

      logger.info('[Orchestrator] Voice profiles stored in session config');

    } catch (profileError) {
      // Don't fail outline generation if voice profiles fail - they're enhancement only
      logger.warn(`[Orchestrator] Voice profile generation failed (continuing without): ${profileError.message}`);
      this.storyMoodProfile = null;
      this.characterVoiceProfiles = new Map();
    }

    // Pre-generate FalAI character references for picture book mode
    // This enables consistent character appearance across all scene images
    if (config.story_format === 'picture_book' && outline.main_characters?.length > 0) {
      try {
        const artStyle = config.cover_art_style || 'storybook';
        logger.info(`[Orchestrator] Pre-generating character references for ${outline.main_characters.length} characters (style: ${artStyle})`);
        this.emitProgress('generating_character_references');

        await preGenerateCharacterReferences(this.sessionId, outline.main_characters, artStyle);

        logger.info('[Orchestrator] Character reference images generated for picture book mode');
      } catch (charRefError) {
        // Don't fail outline generation - character refs are enhancement only
        logger.warn(`[Orchestrator] Character reference generation failed (continuing without): ${charRefError.message}`);
      }
    }

    this.emitProgress('outline_complete');
    logger.info(`Outline generated: ${outline.title}`);

    return outline;
  }

  /**
   * Generate the next scene
   */
  async generateNextScene(voiceId = null, options = {}) {
    const { deferAudio = false } = options;

    // Start progress timer for accurate elapsed tracking
    this.startProgressTimer();

    this.emitProgress('loading', 'Starting session load');
    const loadStartTime = Date.now();
    await this.loadSession();
    this.logTiming('loadSession', loadStartTime);

    if (!this.outline) {
      throw new Error('No outline found. Generate outline first.');
    }

    // HIGH-1 FIX: Context window management for long stories
    // Check if context needs summarization to stay within token limits
    const contextWindowResult = await manageContextWindow(this.sessionId, {
      characters: this.characters,
      outline: this.outline,
      previousSummary: await loadContextSummary(this.sessionId)
    });

    if (contextWindowResult.summarized) {
      logger.info(`[Orchestrator] Context window summarized - story is getting long`);
      // Store the summary for use in scene generation
      this.contextSummary = contextWindowResult.summary;
    } else {
      logger.debug(`[Orchestrator] Context window OK - ${contextWindowResult.tokens || 'N/A'} tokens estimated`);
    }

    // OPTIMIZATION: Parallelize scene count and previous scene queries
    const [sceneIndex, previousSceneResult] = await Promise.all([
      getSceneCount(this.sessionId),
      getPreviousScene(this.sessionId)
    ]);
    const previousScene = sceneIndex > 0 ? previousSceneResult : null;
    const targetScenes = getTargetSceneCount(this.session.config_json);
    const isFinal = sceneIndex >= targetScenes - 1;

    logger.info(`[Orchestrator] INPUT | sessionId: ${this.sessionId} | sceneIndex: ${sceneIndex} | targetScenes: ${targetScenes} | isFinal: ${isFinal}`);

    // Determine complexity
    const complexity = determineComplexity(this.outline, sceneIndex, {
      targetScenes,
      cyoa_enabled: this.session.cyoa_enabled,
      activeCharacters: this.characters.length
    });

    // Find lorebook entries
    let lorebookContext = '';
    if (previousScene) {
      const triggeredEntries = this.lorebook.findTriggeredEntries(previousScene);
      if (triggeredEntries.length > 0) {
        lorebookContext = this.lorebook.generateContextInjection(triggeredEntries);
      }
    }

    // Check multi-voice early - BUG FIX: Use same logic as voiceHelpers.shouldUseMultiVoice
    // Previously this was inconsistent: orchestrator required explicit true, voiceHelpers defaulted to enabled
    // Now both use the same logic: enabled if explicitly true OR if characters exist (unless explicitly false)
    const willUseMultiVoice = shouldUseMultiVoice({
      config: this.session.config_json,
      characters: this.characters
    });

    logger.info(`[Orchestrator] MULTI-VOICE CHECK | config.multi_voice: ${this.session.config_json?.multi_voice} | config.multiVoice: ${this.session.config_json?.multiVoice} | characters: ${this.characters.length} | willUseMultiVoice: ${willUseMultiVoice}`);

    // ★ HYBRID PIPELINE: Intent Validation for Mature Content ★
    // Analyze user's intent to ensure Venice.ai generates appropriately explicit content
    const intensitySettings = this.session.config_json?.intensity || {};
    const audienceSetting = this.session.config_json?.audience || 'general';

    // P1 FIX: Check ALL intensity settings, not just adultContent/romance
    // Violence and gore ALSO need Venice.ai for graphic content
    const adultContentSetting = intensitySettings.adultContent || 0;
    const romanceSetting = intensitySettings.romance || 0;
    const violenceSetting = intensitySettings.violence || 0;
    const goreSetting = intensitySettings.gore || 0;

    // Trigger hybrid pipeline for ANY high-intensity mature content
    const useHybridPipeline = audienceSetting === 'mature' && (
      adultContentSetting >= 50 ||
      romanceSetting >= 50 ||
      violenceSetting >= 60 ||
      goreSetting >= 60
    );

    const triggerReason = adultContentSetting >= 50 ? 'adultContent' :
                          romanceSetting >= 50 ? 'romance' :
                          violenceSetting >= 60 ? 'violence' :
                          goreSetting >= 60 ? 'gore' : 'none';

    logger.info(`[Orchestrator] HYBRID CHECK | audience: ${audienceSetting} | adult:${adultContentSetting} romance:${romanceSetting} violence:${violenceSetting} gore:${goreSetting} | useHybrid: ${useHybridPipeline} | trigger: ${triggerReason}`);

    let intentAnalysis = null;
    if (useHybridPipeline) {
      this.emitProgress('analyzing_intent', 'Analyzing content intent');
      const intentStartTime = Date.now();
      const userPrompt = this.session.config_json?.custom_prompt || this.session.config_json?.premise || this.outline?.synopsis || '';
      intentAnalysis = await validateUserIntent(userPrompt, this.session.config_json);
      this.logTiming('validateUserIntent', intentStartTime);
      logger.info(`[Orchestrator] HYBRID PIPELINE | Intent analyzed: ${intentAnalysis.summary || 'Explicit content requested'}`);
    }

    // Generate scene with dialogue
    this.emitProgress('generating', 'Starting scene generation (this may take 2-5 minutes)');
    const sceneGenStartTime = Date.now();
    const scenePreferences = buildScenePreferences({
      config: this.session.config_json,
      isFinal,
      sceneIndex,
      targetScenes
    });

    // Add intent analysis to preferences for explicit content guidance
    if (intentAnalysis) {
      scenePreferences.intentAnalysis = intentAnalysis;
      scenePreferences.explicitGuidance = intentAnalysis.guidance;
      scenePreferences.mustInclude = intentAnalysis.mustInclude;
      scenePreferences.pacing = intentAnalysis.pacing;
    }

    // ★ SCAFFOLDING PIPELINE DECISION ★
    // The scaffolding pipeline is the PREFERRED approach for mature content:
    // 1. OpenAI generates structure with placeholders (leverages its strength)
    // 2. Venice expands placeholders with explicit content (leverages its strength)
    // 3. Content is stitched and optionally polished
    const useScaffoldingPipeline = shouldUseScaffoldingPipeline(audienceSetting, intensitySettings);

    // ★ HYBRID PIPELINE DECISION ★ (Legacy fallback)
    // For high explicit content, use the full hybrid pipeline
    // which has Venice.ai generate with tags, then OpenAI polishes non-explicit sections
    // P1 FIX: Include violence and gore in the full hybrid pipeline trigger
    // NOTE: Scaffolding pipeline is now preferred over hybrid pipeline
    const useFullHybridPipeline = !useScaffoldingPipeline &&
                                   useHybridPipeline &&
                                   (intensitySettings.adultContent >= 80 ||
                                    intensitySettings.romance >= 80 ||
                                    intensitySettings.violence >= 80 ||
                                    intensitySettings.gore >= 80) &&
                                   intentAnalysis?.requiresExplicit;

    let sceneResult;

    if (useScaffoldingPipeline) {
      // ★ SCAFFOLDING PIPELINE: OpenAI Scaffold + Venice Expansion + Stitch ★
      logger.info(`[Orchestrator] ★ USING SCAFFOLDING PIPELINE for mature content | adult:${intensitySettings.adultContent} romance:${intensitySettings.romance} violence:${intensitySettings.violence} gore:${intensitySettings.gore} language:${intensitySettings.language || 50}`);
      this.emitProgress('scaffold_generating', 'Generating story structure...');

      try {
        // Get author style for consistent voice throughout
        const authorStyleId = this.session.config_json?.author_style || 'default';
        const authorStyle = getAuthorStyle(authorStyleId);

        // Build story context for the scaffold
        const scaffoldContext = {
          outline: {
            title: this.outline?.title,
            setting: this.outline?.setting,
            scenes: this.outline?.scenes || this.outline?.acts,
            synopsis: this.storyBibleContext?.synopsis?.synopsis || this.outline?.synopsis
          },
          sceneIndex,
          previousScene,
          characters: this.characters,
          preferences: scenePreferences,
          lorebookContext,
          storyBibleContext: this.isAdvancedMode ? buildAdvancedModeContext(this.storyBibleContext, this.lore) : null,
          contextSummary: this.contextSummary,
          complexity,
          sessionId: this.sessionId,
          customPrompt: this.session.config_json?.custom_prompt
        };

        // Phase 1: Generate scaffold with OpenAI (can take 30-60 seconds)
        // START HEARTBEAT to prevent stall detection false positives
        this.startHeartbeat('scaffold_structure', 'Creating narrative structure...');
        const scaffoldContent = await generateScaffoldedScene(scaffoldContext, intensitySettings, authorStyle);
        this.stopHeartbeat();

        // Phase 2-4: Expand placeholders with Venice and stitch (can take 2-3 minutes)
        this.startHeartbeat('scaffold_expanding', 'Enhancing mature content...');
        const pipelineResult = await runScaffoldingPipeline(scaffoldContent, scaffoldContext, authorStyle, {
          logPrefix: `[Orchestrator:Scaffold:${this.sessionId}]`,
          parallel: true,
          coherencePass: (intensitySettings.adultContent >= 70 || intensitySettings.violence >= 70 || intensitySettings.gore >= 70),
          maxConcurrent: 3,
          onProgress: (progress) => {
            if (progress.phase === 'expanding') {
              this.emitProgress('scaffold_expanding', `Expanding placeholder ${progress.current}/${progress.total}`);
            } else if (progress.phase === 'coherence') {
              this.emitProgress('scaffold_coherence', 'Polishing transitions...');
            }
          }
        });

        // STOP HEARTBEAT after pipeline completes
        this.stopHeartbeat();

        logger.info(`[Orchestrator] Scaffolding pipeline complete:`, {
          placeholdersExpanded: pipelineResult.stats.placeholdersExpanded,
          byType: pipelineResult.stats.byType,
          coherenceApplied: pipelineResult.stats.coherencePassApplied,
          duration: pipelineResult.duration
        });

        // Convert to scene result format
        sceneResult = {
          content: pipelineResult.content,
          dialogue_map: [],  // Will be extracted below if multi-voice needed
          new_characters: [],
          prose_format: 'scaffold',
          wasScaffoldProcessed: true,
          scaffoldStats: pipelineResult.stats
        };

        // If multi-voice is enabled, extract dialogue from the scaffolded content
        if (willUseMultiVoice && this.characters.length > 0) {
          logger.info('[Orchestrator] Extracting dialogue from scaffolded content for multi-voice');
          // Allow empty dialogue for scaffold pipeline - graceful degradation to narrator-only
          const dialogueExtracted = extractDialogueFromContent(pipelineResult.content, this.characters, {
            allowEmptyDialogue: true,
            sourceType: 'scaffold'
          });
          sceneResult.dialogue_map = dialogueExtracted.dialogueMap;
          sceneResult.new_characters = dialogueExtracted.newCharacters;
          sceneResult.prose_format = dialogueExtracted.format;
          if (dialogueExtracted.narratorSegments) {
            sceneResult.narratorSegments = dialogueExtracted.narratorSegments;
          }
        }

      } catch (scaffoldError) {
        // STOP HEARTBEAT on error
        this.stopHeartbeat();
        // FAIL-LOUD: Scaffolding failures should not silently fall back
        logger.error(`[Orchestrator] Scaffolding pipeline failed:`, scaffoldError);
        throw new Error(`Scene scaffolding failed: ${scaffoldError.message}`);
      }
    }

    if (!sceneResult && useFullHybridPipeline) {
      // ★ HYBRID PIPELINE: Venice + Tag Extraction + OpenAI Polish + Restore ★
      logger.info(`[Orchestrator] ★ USING FULL HYBRID PIPELINE for explicit content | adult:${intensitySettings.adultContent} romance:${intensitySettings.romance} violence:${intensitySettings.violence} gore:${intensitySettings.gore}`);
      // START HEARTBEAT for hybrid pipeline (can take 2-4 minutes)
      this.startHeartbeat('hybrid_generating', 'Running hybrid content pipeline...');

      // Build the scene generation prompt
      const scenePrompt = `Write scene ${sceneIndex + 1} of the story "${this.outline?.title || 'Untitled'}".

SETTING: ${this.outline?.setting || 'Not specified'}

${previousScene ? `PREVIOUS SCENE SUMMARY:\n${previousScene.substring(0, 1200)}...\n` : 'This is the opening scene.'}

CHARACTERS:
${this.characters.map(c => `- ${c.name} (${c.gender}) - ${c.role}: ${c.description || 'No description'}`).join('\n')}

STORY SYNOPSIS:
${this.storyBibleContext?.synopsis?.synopsis || this.outline?.synopsis || 'Continue the story naturally.'}

${lorebookContext ? `WORLD DETAILS:\n${lorebookContext}\n` : ''}

Write 3200-4800 words of rich, immersive prose with detailed descriptions, character development, and natural dialogue.
${scenePreferences.is_final ? 'This is the final scene - bring the story to a satisfying conclusion.' : ''}`;

      // Run the hybrid pipeline
      const hybridResult = await runHybridPipeline(scenePrompt, this.session.config_json, {
        sessionId: this.sessionId,
        userPrompt: this.session.config_json?.custom_prompt || this.session.config_json?.premise || this.outline?.synopsis,
        skipOpenAIPolish: false,  // Let OpenAI improve non-explicit narrative sections
        skipCoherenceCheck: false // Validate final coherence via Venice
      });

      // STOP HEARTBEAT after hybrid pipeline completes
      this.stopHeartbeat();

      logger.info(`[Orchestrator] Hybrid pipeline complete:`, {
        wasHybridProcessed: hybridResult.wasHybridProcessed,
        explicitSections: hybridResult.explicitSections,
        explicitTypes: hybridResult.explicitTypes,
        duration: hybridResult.duration
      });

      // Convert to scene result format
      // Note: Hybrid pipeline doesn't do dialogue mapping yet, so we extract afterwards if needed
      sceneResult = {
        content: hybridResult.content,
        dialogue_map: [],  // Will be extracted below if multi-voice needed
        new_characters: [],
        prose_format: 'hybrid',
        wasHybridProcessed: true,
        explicitSections: hybridResult.explicitSections,
        explicitTypes: hybridResult.explicitTypes
      };

      // If multi-voice is enabled, extract dialogue from the hybrid content
      if (willUseMultiVoice && this.characters.length > 0) {
        logger.info('[Orchestrator] Extracting dialogue from hybrid content for multi-voice');
        // Allow empty dialogue for hybrid pipeline - graceful degradation to narrator-only
        const dialogueExtracted = extractDialogueFromContent(hybridResult.content, this.characters, {
          allowEmptyDialogue: true,
          sourceType: 'hybrid'
        });
        sceneResult.dialogue_map = dialogueExtracted.dialogueMap;
        sceneResult.new_characters = dialogueExtracted.newCharacters;
        sceneResult.prose_format = dialogueExtracted.format;
        if (dialogueExtracted.narratorSegments) {
          sceneResult.narratorSegments = dialogueExtracted.narratorSegments;
        }
      }

    }

    // ★ NORMAL FLOW: Fallback if scaffolding/hybrid not used or failed ★
    if (!sceneResult) {
      // Normal flow: generateSceneWithDialogue with provider routing to Venice
      logger.info(`[Orchestrator] Using normal scene generation flow`);
      // START HEARTBEAT for normal scene generation (can take 30-90 seconds)
      this.startHeartbeat('generating', 'Generating scene content...');
      sceneResult = await generateSceneWithDialogue({
        outline: {
          title: this.outline?.title,
          setting: this.outline?.setting,
          acts: this.outline?.acts,
          synopsis: this.storyBibleContext?.synopsis?.synopsis || this.outline?.synopsis
        },
        sceneIndex,
        previousScene,
        characters: this.characters,
        preferences: scenePreferences,
        lorebookContext,
        storyBible: this.storyBible,
        contextSummary: this.contextSummary,
        complexity,
        sessionId: this.sessionId,
        storyBibleContext: this.isAdvancedMode ? buildAdvancedModeContext(this.storyBibleContext, this.lore) : null,
        customPrompt: this.session.config_json?.custom_prompt // P0 FIX: Include user's original premise
      });
      // STOP HEARTBEAT after scene generation
      this.stopHeartbeat();
    }

    let rawText = sceneResult.content;
    const sceneDialogueMap = sceneResult.dialogue_map || [];
    const sceneNewCharacters = sceneResult.new_characters || [];
    const proseFormat = sceneResult.prose_format || 'position_based';
    const preComputedSegments = sceneResult.segments || null;

    this.logTiming('generateSceneWithDialogue', sceneGenStartTime);
    this.emitProgress('scene_generated', `Scene generated with ${sceneDialogueMap.length} dialogue entries`);
    logger.info(`[Orchestrator] Scene generated with ${sceneDialogueMap.length} dialogue entries, format: ${proseFormat}`);

    // P1 FIX: Check minimum word count and regenerate if too short
    const storyFormat = this.session.config_json?.story_format || 'default';

    // Create regeneration callback that can generate a longer chapter
    const regenerateChapter = async (enhancedContext) => {
      logger.info(`[Orchestrator] REGENERATING chapter for length | reason: ${enhancedContext.retryReason}`);

      // Enhance preferences with explicit length requirements
      const lengthEnhancedPreferences = {
        ...scenePreferences,
        minimumWords: enhancedContext.minRequiredWords,
        lengthInstruction: `CRITICAL: The previous generation was only ${enhancedContext.previousWordCount} words but this chapter MUST be at least ${enhancedContext.minRequiredWords} words. Write a FULL chapter with rich detail, expanded dialogue, deeper character introspection, vivid scene descriptions, and thorough development of the plot. Do NOT abbreviate or summarize - write every moment in full prose.`,
        isRetryForLength: true
      };

      // START HEARTBEAT for regeneration (can take 30-90 seconds)
      this.startHeartbeat('regenerating', `Regenerating chapter (was ${enhancedContext.previousWordCount} words, need ${enhancedContext.minRequiredWords})...`);

      // Skip hybrid pipeline for regeneration - use normal flow for better control
      const regenResult = await generateSceneWithDialogue({
        outline: {
          title: this.outline?.title,
          setting: this.outline?.setting,
          acts: this.outline?.acts,
          synopsis: this.storyBibleContext?.synopsis?.synopsis || this.outline?.synopsis
        },
        sceneIndex,
        previousScene,
        characters: this.characters,
        preferences: lengthEnhancedPreferences,
        lorebookContext,
        storyBible: this.storyBible,
        contextSummary: this.contextSummary,
        complexity,
        sessionId: this.sessionId,
        storyBibleContext: this.isAdvancedMode ? buildAdvancedModeContext(this.storyBibleContext, this.lore) : null,
        customPrompt: this.session.config_json?.custom_prompt // P0 FIX: Include user's original premise
      });

      // STOP HEARTBEAT after regeneration
      this.stopHeartbeat();

      return regenResult.content;
    };

    // Validate and regenerate if needed (max 2 attempts)
    const validationResult = await validateAndRegenerateIfShort(
      rawText,
      storyFormat,
      regenerateChapter,
      { sceneIndex, sessionId: this.sessionId },
      2
    );

    // Update rawText with potentially regenerated content
    rawText = validationResult.content;

    if (validationResult.isRegenerated) {
      logger.info(`[Orchestrator] Chapter regenerated for length | finalWordCount: ${validationResult.wordCount} | attempts: ${validationResult.attempt}`);
    } else {
      logger.info(`[Orchestrator] Word count OK | wordCount: ${validationResult.wordCount} | minRequired: ${getMinWordCount(storyFormat)}`);
    }

    // Check if mature content with high adult content - skip OpenAI-based validation
    const intensityConfig = this.session.config_json?.intensity || {};
    const audienceConfig = this.session.config_json?.audience || 'general';
    const adultContentLevelCheck = intensityConfig.adultContent ?? intensityConfig.romance ?? 0;
    const isMatureWithExplicitContent = audienceConfig === 'mature' && adultContentLevelCheck >= 50;

    // Validate story text (skip for multi-voice OR mature explicit content)
    const skipValidation = willUseMultiVoice || isMatureWithExplicitContent;
    if (isMatureWithExplicitContent) {
      logger.info(`[Orchestrator] SKIPPING story validation for mature content (adultContent: ${adultContentLevelCheck})`);
    }
    const storyValidationResult = skipValidation ? { valid: true, fixed: false } : await validateStoryText(rawText, { outline: this.outline, characters: this.characters }, this.sessionId);

    if (!storyValidationResult.valid && storyValidationResult.fixed) {
      rawText = storyValidationResult.text;
    }

    // Run parallel agent checks (safety, lore, polish, facts)
    this.emitProgress('validating', 'Running content validation agents');
    const validationStartTime = Date.now();
    const audience = this.session.config_json?.audience || 'general';
    const intensity = this.session.config_json?.intensity || {};
    const effectiveLimits = calculateEffectiveLimits(intensity, audience);

    // Check if mature content with high adult content - skip OpenAI utility agents
    const adultContentLevel = intensity.adultContent ?? intensity.romance ?? 0;
    const isMatureWithExplicit = audience === 'mature' && adultContentLevel >= 50;

    let safetyResult, loreCheck, polishedText, storyFacts;

    if (isMatureWithExplicit) {
      // SKIP OpenAI utility agents for mature content - they will block/return empty
      logger.info(`[Orchestrator] SKIPPING OpenAI utility agents for mature content (adultContent: ${adultContentLevel})`);
      safetyResult = { safe: true, concerns: [], exceeded_limits: {} };
      loreCheck = { consistent: true, issues: [] };
      polishedText = rawText; // Use raw text without OpenAI polishing
      storyFacts = {}; // Skip fact extraction for now
    } else {
      // Normal flow - run all utility agents
      // =======================================================================
      // MEDIUM-10: ERROR HANDLING POLICY (Intentionally Tiered)
      // =======================================================================
      // CRITICAL (FAIL-LOUD):   Safety check - cannot proceed without validation
      // NON-CRITICAL (FALLBACK): Lore → defaults to "inconsistent" (conservative)
      //                          Polish → falls back to raw text (acceptable)
      //                          Facts → falls back to empty object (acceptable)
      // Use Promise.allSettled so one failing agent doesn't crash story generation
      // =======================================================================
      const agentResults = await Promise.allSettled([
        checkSafety(rawText, { ...effectiveLimits, audience }, this.sessionId),
        checkLoreConsistency(rawText, { characters: this.characters, setting: this.outline.setting, previousEvents: previousScene, storyBible: this.storyBible }, this.sessionId),
        willUseMultiVoice ? Promise.resolve(rawText) : polishForNarration(rawText, { narrator_style: this.session.config_json?.narrator_style || 'warm', bedtime_mode: this.session.bedtime_mode }, this.sessionId),
        extractStoryFacts(rawText, { outline: this.outline, characters: this.characters }, this.sessionId)
      ]);

      // FAIL-LOUD: Safety check failure must not default to safe:true
      if (agentResults[0].status === 'rejected') {
        logger.error(`[Orchestrator] Safety check failed: ${agentResults[0].reason?.message || agentResults[0].reason}`);
        throw new Error(`Safety check failed - cannot proceed without safety validation: ${agentResults[0].reason?.message}`);
      }
      safetyResult = agentResults[0].value;

      // Lore check failure defaults to inconsistent (conservative)
      loreCheck = agentResults[1].status === 'fulfilled' ? agentResults[1].value : { consistent: false, issues: ['Lore check failed - review manually'] };

      // Polish failure uses raw text (acceptable fallback)
      polishedText = agentResults[2].status === 'fulfilled' ? agentResults[2].value : rawText;

      // Story facts failure uses empty object (acceptable fallback)
      storyFacts = agentResults[3].status === 'fulfilled' ? agentResults[3].value : {};

      // Log any non-critical agent failures
      if (agentResults[1].status === 'rejected') {
        logger.warn(`[Orchestrator] checkLoreConsistency failed:`, agentResults[1].reason?.message || agentResults[1].reason);
      }
      if (agentResults[2].status === 'rejected') {
        logger.warn(`[Orchestrator] polishForNarration failed:`, agentResults[2].reason?.message || agentResults[2].reason);
      }
      if (agentResults[3].status === 'rejected') {
        logger.warn(`[Orchestrator] extractStoryFacts failed:`, agentResults[3].reason?.message || agentResults[3].reason);
      }
    }

    this.logTiming('validationAgents (parallel)', validationStartTime);
    this.emitProgress('polishing', 'Processing validation results');

    // Process results
    if (!safetyResult.safe) {
      logger.warn(`Scene ${sceneIndex + 1} flagged for safety: ${safetyResult.concerns?.join(', ')}`);
    }
    if (!loreCheck.consistent) {
      logger.warn(`Lore inconsistency: ${loreCheck.issues?.join(', ')}`);
    }

    // Update story bible (non-blocking)
    if (storyFacts && Object.keys(storyFacts).some(k => Array.isArray(storyFacts[k]) ? storyFacts[k].length > 0 : Object.keys(storyFacts[k] || {}).length > 0)) {
      this.updateStoryBible(storyFacts).catch(e => logger.error('Failed to update story bible:', e));
    }

    // Determine final text
    let finalText = willUseMultiVoice ? rawText : polishedText;

    // Generate choices if CYOA (allow choices from Scene 1 - sceneIndex 0)
    let choices = [];
    if (this.session.cyoa_enabled && !isFinal) {
      this.emitProgress('choices', 'Generating story choices');
      const choicesStartTime = Date.now();
      const cyoaSettings = this.session.config_json?.cyoa_settings || {};
      const choiceResult = await generateChoices(finalText, {
        outline: this.outline,
        characters: this.characters,
        max_choices: cyoaSettings.max_branches || 3,
        structure_type: cyoaSettings.structure_type || 'diamond',
        is_near_ending: sceneIndex >= targetScenes - 2
      }, this.sessionId);
      choices = choiceResult.choices || [];
      this.logTiming('generateChoices', choicesStartTime);
    }

    const mood = determineMood(finalText);
    const displayText = stripTags(finalText);

    // Save scene to database
    this.emitProgress('saving', 'Saving scene to database');
    const saveStartTime = Date.now();
    const scene = await saveScene({
      sessionId: this.sessionId,
      sceneIndex,
      rawText,
      displayText,
      mood,
      multiVoice: willUseMultiVoice
    });
    this.logTiming('saveScene', saveStartTime);

    // Speaker validation (C+E architecture)
    let dialogueMap = sceneDialogueMap;

    if (this.characters.length > 0 && dialogueMap.length > 0) {
      try {
        this.emitProgress('validating_speakers', 'Validating speaker assignments');
        const speakerValidationStartTime = Date.now();

        const storyContext = {
          genre: this.session.config_json?.genre || 'general fiction',
          mood: this.session.config_json?.mood || mood,
          audience: this.session.config_json?.audience || 'general',
          setting: this.outline?.setting || '',
          synopsis: this.outline?.synopsis || '',
          themes: this.outline?.themes || []
        };

        // Campaign mode removed - migrated to GameMaster project (2026-01-08)
        const narratorVoiceId = getEffectiveVoiceId({ voiceId: null, config: this.session.config_json });

        const speakerValidationResult = await validateAndReconcileSpeakers(this.sessionId, dialogueMap, sceneNewCharacters, this.characters, storyContext, narratorVoiceId);

        if (speakerValidationResult.createdCharacters.length > 0) {
          this.characters = [...this.characters, ...speakerValidationResult.createdCharacters];
        }
        this.logTiming('validateAndReconcileSpeakers', speakerValidationStartTime);

        const speakersExtracted = proseFormat === 'tag_based' ? extractSpeakers(rawText) : dialogueMap.map(d => d.speaker).filter((v, i, a) => a.indexOf(v) === i);
        await saveDialogueMap({ sceneId: scene.id, dialogueMap, proseFormat, speakersExtracted });
        logger.info(`[Orchestrator] Dialogue map saved with ${dialogueMap.length} entries`);

      } catch (validationError) {
        logger.error(`[SpeakerValidation] CRITICAL FAILURE: ${validationError.message}`);
        await markDialogueTaggingFailed(scene.id, validationError.message);
        throw validationError;
      }
    } else {
      await markDialogueTaggingSkipped(scene.id);
    }

    // Voice consistency check for long narratives (every 10k words)
    // This is non-blocking - errors won't fail scene generation
    const voiceConsistencyResult = await this._trackAndCheckVoiceConsistency(finalText, dialogueMap);
    if (voiceConsistencyResult) {
      logger.info(`[Orchestrator] Voice consistency check completed at ${voiceConsistencyResult.cumulativeWordCount} words`);
    }

    // OPTIMIZATION: Batch DB writes in parallel (saveChoices + updateSessionAfterScene)
    const postSceneDbWrites = [updateSessionAfterScene(this.sessionId)];
    if (choices.length > 0) {
      postSceneDbWrites.push(saveChoices(this.sessionId, scene.id, choices));
    }
    await Promise.all(postSceneDbWrites);

    // Generate audio if not deferred
    let audioUrl = null;
    let audioSegments = [];
    let wordTimings = null;
    let audioBuffer;

    // Campaign mode removed - migrated to GameMaster project (2026-01-08)
    const effectiveVoiceId = getEffectiveVoiceId({ voiceId, config: this.session.config_json });
    const shouldRecord = this.recordingEnabled;

    // Initialize recording
    if (shouldRecord && !this.activeRecording && sceneIndex === 0) {
      try {
        const { recording } = await recordingService.startRecording(this.sessionId, {
          title: this.outline?.title || 'Story',
          voiceSnapshot: { voice_id: voiceId || this.session.config_json?.voice_id, voice_name: 'narrator' }
        });
        this.activeRecording = recording;
        logger.info(`[Recording] Started recording ${recording.id}`);
      } catch (recErr) {
        logger.error('[Recording] Failed to start:', recErr);
      }
    }

    if (!deferAudio) {
      try {
        const normalizedStyle = normalizeStyleValue(this.session.config_json?.narratorStyleSettings?.style);

        if (willUseMultiVoice) {
          const result = await this._generateMultiVoiceAudio({
            finalText,
            proseFormat,
            preComputedSegments,
            dialogueMap,
            effectiveVoiceId,
            normalizedStyle
          });
          audioBuffer = result.audioBuffer;
          wordTimings = result.wordTimings;
          audioSegments = result.audioSegments;
        } else {
          const result = await this._generateSingleVoiceAudio({
            text: finalText,
            voiceId: effectiveVoiceId,
            normalizedStyle,
            withTimestamps: true
          });
          audioBuffer = result.audioBuffer;
          wordTimings = result.wordTimings;
        }

        // Save audio (+ karaoke word timings) to the scene for reload-safe playback.
        const audioHash = elevenlabs.generateHash(finalText, effectiveVoiceId + (willUseMultiVoice ? '-multi' : ''));
        audioUrl = `/audio/${audioHash}.mp3`;
        const durationSeconds = wordTimings?.total_duration_ms ? (wordTimings.total_duration_ms / 1000) : null;
        await saveSceneAudio(scene.id, audioUrl, { wordTimings, durationSeconds, voiceId: effectiveVoiceId });

      } catch (e) {
        logger.error('Audio generation failed:', e);
      }
    }

    // Generate SFX - P1 FIX: Only generate when EXPLICITLY enabled
    let sceneSfx = [];
    if (this.session.config_json?.sfx_enabled === true && sfxService.enabled) {
      sceneSfx = await this._generateSFX(scene.id, finalText, mood, wordTimings);
    }

    // Recording segment
    if (this.activeRecording && audioUrl) {
      await this._addRecordingSegment(scene, sceneIndex, audioBuffer, audioUrl, wordTimings, finalText, sceneSfx, choices, mood, isFinal);
    }

    // Log final completion with total elapsed time
    const totalElapsed = this._progressStartTime ? Date.now() - this._progressStartTime : 0;
    logger.info(`[Orchestrator] ========== GENERATION COMPLETE ==========`);
    logger.info(`[Orchestrator] OUTPUT | sceneId: ${scene.id} | sceneIndex: ${sceneIndex} | multiVoice: ${willUseMultiVoice} | sfxCount: ${sceneSfx.length} | totalElapsed: ${totalElapsed}ms`);

    // Update generation_state for session handoff (Phase 7)
    try {
      const generationState = {
        lastCompletedScene: sceneIndex,
        lastSceneId: scene.id,
        currentPhase: 'scene_complete',
        voiceAssignments: this.characterVoiceAssignments ? Object.fromEntries(this.characterVoiceAssignments) : {},
        totalScenes: targetScenes,
        isMultiVoice: willUseMultiVoice,
        hasSfx: sceneSfx.length > 0,
        hasRecording: !!this.activeRecording,
        isFinal,
        nextAction: isFinal ? 'story_complete' : `generate_scene_${sceneIndex + 2}`,
        lastUpdated: new Date().toISOString()
      };
      await pool.query(
        `UPDATE story_sessions SET generation_state = $1, generation_updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(generationState), this.sessionId]
      );
      logger.info(`[Orchestrator] Session handoff state updated: scene ${sceneIndex + 1}/${targetScenes}`);
    } catch (stateErr) {
      logger.warn(`[Orchestrator] Failed to update generation_state: ${stateErr.message}`);
      // Non-critical - don't fail the scene for handoff state update
    }

    return {
      id: scene.id,
      sequence_index: sceneIndex,
      polished_text: displayText,
      summary: scene.summary,
      mood,
      choices,
      is_final: isFinal,
      audio_url: audioUrl,
      multi_voice: willUseMultiVoice,
      audio_segments: audioSegments,
      sfx: sceneSfx,
      word_timings: wordTimings,
      has_recording: !!this.activeRecording
    };
  }

  /**
   * Generate multi-voice audio
   * @private
   */
  async _generateMultiVoiceAudio({ finalText, proseFormat, preComputedSegments, dialogueMap, effectiveVoiceId, normalizedStyle, onProgress = null }) {
    logger.info(`[Orchestrator] Generating MULTI-VOICE audio`);

    // Get segments
    let segments;
    if (proseFormat === 'tag_based' && preComputedSegments?.length > 0) {
      segments = convertTagSegmentsToTTS(preComputedSegments);
    } else if (dialogueMap?.length > 0) {
      segments = convertDialogueMapToSegments(finalText, dialogueMap);
    } else {
      throw new Error('MULTI-VOICE FAILED: No dialogue data');
    }

    // Filter speech tags if enabled - use smart filter that auto-selects light-touch vs full LLM
    if (shouldHideSpeechTags(this.session.config_json)) {
      try {
        segments = await filterSpeechTagsSmart(segments, {
          title: this.session.title,
          genre: this.session.config_json?.genre,
          hideSpeechTagsPreGen: true  // Story was generated with hide_speech_tags enabled
        });
        logger.info(`[Orchestrator] Speech tags filtered successfully (${segments.length} segments)`);
      } catch (error) {
        logger.warn(`[Orchestrator] Speech tag filtering failed: ${error.message}. Continuing with unfiltered segments.`);
        // Don't crash - continue with original segments
      }
    }

    logSegmentAnalysis(segments, finalText);

    // P1 FIX: Enhance ALL segments with voice direction for better emotion/prosody
    // BUG FIX: Include narrator (not just dialogue), use correct field names, replace segments entirely
    try {
      const storyContext = {
        title: this.session.title || this.outline?.title,
        // BUG FIX: Use 'genre' (singular string), not 'genres' (plural object)
        genre: this.session.config_json?.genre || this.session.config_json?.genres?.primary || 'general fiction',
        mood: this.session.config_json?.mood || this.session.config_json?.story_mood || 'neutral',
        audience: this.session.config_json?.audience || 'general',
        characters: this.characters,
        // Pass character voice profiles if available
        characterProfiles: this.characterVoiceProfiles || {}
      };

      // BUG FIX: Direct ALL segments including narrator - narrator emotion matters!
      if (segments.length > 0) {
        // directVoiceActing returns NEW segments with v3AudioTags, voiceStability, voiceStyle already applied
        const directedSegments = await directVoiceActing(segments, storyContext, this.sessionId);

        // BUG FIX: Replace segments entirely instead of trying to match and apply manually
        // The voiceDirectorAgent returns segments with:
        // - v3AudioTags (ElevenLabs V3 tags)
        // - voiceStability (0.0-1.0)
        // - voiceStyle (0.0-1.0)
        // - voiceSpeedModifier (0.85-1.15)
        // - voiceDirected (boolean)
        // - emotion (for preset lookup)
        if (directedSegments && directedSegments.length > 0) {
          segments = directedSegments;
          const directedCount = segments.filter(s => s.voiceDirected).length;
          logger.info(`[Orchestrator] Voice direction applied to ${directedCount}/${segments.length} segments (including narrator)`);
        }
      }
    } catch (error) {
      // FAIL-LOUD: Voice direction is critical for expressiveness - don't silently use flat defaults
      logger.error(`[Orchestrator] Voice direction failed: ${error.message}`);
      throw new Error(`Voice direction failed: ${error.message}`);
    }

    // Get voice assignments
    const existingAssignments = await pool.query(
      'SELECT c.name, cva.elevenlabs_voice_id FROM character_voice_assignments cva JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
      [this.sessionId]
    );

    let characterVoices = buildVoiceAssignmentsMap(existingAssignments.rows);

    if (existingAssignments.rows.length > 0) {
      const validation = validateExistingAssignments(characterVoices, effectiveVoiceId);
      if (!validation.valid) {
        // ★ TARGETED REPAIR - Don't nuke everything!
        logger.warn(`[VoiceValidation] Validation failed, attempting repair: ${validation.errors.join('; ')}`);

        // Find and fix specific problems - track which need reassignment
        const fixedVoices = { ...characterVoices };
        const needsReassignment = []; // Track removed characters for partial reassignment
        let hadProblems = false;

        // Fix 1: Remove characters using narrator voice
        for (const [charName, voiceId] of Object.entries(fixedVoices)) {
          if (voiceId === effectiveVoiceId) {
            logger.info(`[VoiceValidation] Removing ${charName} (was using narrator voice ${voiceId})`);
            needsReassignment.push(charName);
            delete fixedVoices[charName];
            hadProblems = true;
          }
        }

        // Fix 2: Remove characters with null/undefined voices
        for (const [charName, voiceId] of Object.entries(fixedVoices)) {
          if (!voiceId) {
            logger.info(`[VoiceValidation] Removing ${charName} (had null/undefined voice)`);
            needsReassignment.push(charName);
            delete fixedVoices[charName];
            hadProblems = true;
          }
        }

        // Fix 3: Handle duplicate voice assignments
        // Keep first occurrence, mark others for reassignment
        const voiceToCharacters = {};
        for (const [charName, voiceId] of Object.entries(fixedVoices)) {
          if (!voiceToCharacters[voiceId]) {
            voiceToCharacters[voiceId] = [];
          }
          voiceToCharacters[voiceId].push(charName);
        }

        for (const [voiceId, charNames] of Object.entries(voiceToCharacters)) {
          if (charNames.length > 1) {
            // Keep first, remove others
            const keep = charNames[0];
            const remove = charNames.slice(1);
            logger.info(`[VoiceValidation] Resolving duplicate voice ${voiceId.slice(-4)}: keeping ${keep}, removing ${remove.join(', ')}`);

            for (const charName of remove) {
              needsReassignment.push(charName);
              delete fixedVoices[charName];
              hadProblems = true;
            }
          }
        }

        // Use fixed assignments and request partial reassignment for removed characters
        if (hadProblems && Object.keys(fixedVoices).length > 0) {
          characterVoices = fixedVoices;
          logger.info(`[VoiceValidation] Repair successful: kept ${Object.keys(fixedVoices).length} valid, ${needsReassignment.length} need reassignment`);

          // Partial reassignment: get new voices for removed characters
          if (needsReassignment.length > 0) {
            const charactersToReassign = this.characters.filter(c =>
              needsReassignment.includes(c.name.toLowerCase())
            );
            if (charactersToReassign.length > 0) {
              const storyContext = buildVoiceAssignmentContext({ session: this.session, outline: this.outline, characters: this.characters });
              const newAssignments = await assignVoicesByLLM(charactersToReassign, storyContext, effectiveVoiceId, this.sessionId, Object.values(fixedVoices));

              // Merge new assignments with existing
              for (const [charName, voiceId] of Object.entries(newAssignments)) {
                if (voiceId && voiceId !== effectiveVoiceId) {
                  characterVoices[charName] = voiceId;
                  // Also save to DB
                  const char = this.characters.find(c => c.name.toLowerCase() === charName);
                  if (char) {
                    await pool.query(`
                      INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
                      VALUES ($1, $2, $3)
                      ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
                    `, [this.sessionId, char.id, voiceId]);
                  }
                }
              }
              logger.info(`[VoiceValidation] Partial reassignment complete: ${Object.keys(newAssignments).length} new assignments`);
            }
          }
        } else {
          // If no assignments remain after repair, clear for full reassignment
          logger.info(`[VoiceValidation] No valid assignments after repair, requesting full reassignment`);
          characterVoices = {};
        }
      } else {
        logger.debug(`[VoiceValidation] Validation passed: ${Object.keys(characterVoices).length} assignments are valid`);
      }
    }

    // Assign voices if needed
    if (Object.keys(characterVoices).length === 0 && this.characters.length > 0) {
      const storyContext = buildVoiceAssignmentContext({ session: this.session, outline: this.outline, characters: this.characters });
      characterVoices = await assignVoicesByLLM(this.characters, storyContext, effectiveVoiceId, this.sessionId);

      for (const char of this.characters) {
        const charVoiceId = characterVoices[char.name.toLowerCase()];
        if (charVoiceId) {
          await pool.query(`
            INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
          `, [this.sessionId, char.id, charVoiceId]);
        }
      }
    }

    await logCharacterVoiceMap(characterVoices, effectiveVoiceId, '[MultiVoice]');

    // Prepare and generate audio
    const preparedSegments = elevenlabs.prepareSegmentsWithVoices(segments, characterVoices, effectiveVoiceId);
    await logVoiceUsage(preparedSegments, '[MultiVoice]');

    const audioSegments = mapToAudioSegments(preparedSegments);
    const storyContext = buildEmotionContext({ config: this.session.config_json, sceneText: finalText, characters: this.characters });
    const audioOptions = {
      ...buildAudioGenerationOptions({ config: this.session.config_json, sessionId: this.sessionId, normalizedStyle }),
      ...(typeof onProgress === 'function' ? { onProgress } : {})
    };

    const multiVoiceResult = await elevenlabs.generateMultiVoiceAudio(preparedSegments, audioOptions, storyContext);

    // Cache audio
    const multiVoiceHash = elevenlabs.generateHash(finalText, effectiveVoiceId + '-multi');
    await elevenlabs.cacheMultiVoiceAudio(multiVoiceHash, multiVoiceResult.audio);

    return {
      audioBuffer: multiVoiceResult.audio,
      wordTimings: multiVoiceResult.wordTimings,
      audioSegments
    };
  }

  /**
   * Generate single voice audio
   * @private
   */
  async _generateSingleVoiceAudio({ text, voiceId, normalizedStyle, withTimestamps = true }) {
    await logSingleVoiceNarration(voiceId, text, { withTimestamps });

    const options = {
      stability: this.session.config_json?.narratorStyleSettings?.stability || 0.5,
      style: normalizedStyle,
      sessionId: this.sessionId,
      speaker: 'narrator',
      quality_tier: 'premium'  // CRITICAL: Use eleven_v3 model for Audio Tags support
    };

    // v3 Prosody: Use full voiceDirectorAgent for narrator (50+ emotions vs 14)
    // This gives narrator access to v3AudioTags, per-segment speed modulation, and refinement
    try {
      const config = this.session.config_json || {};
      const context = {
        genre: config.genre || 'general',
        mood: config.mood || 'neutral',
        audience: config.audience || 'general',
        characterProfiles: this.characterVoiceProfiles || new Map()
      };

      // Create narrator segment for voice direction
      const narratorSegment = [{
        speaker: 'narrator',
        text: text,
        index: 0,
        type: 'narrator'
      }];

      // Use voiceDirectorAgent for rich emotion/v3 tags (same as multi-voice)
      const directedSegments = await directVoiceActing(narratorSegment, context, this.sessionId);
      const directives = directedSegments?.[0];

      if (directives) {
        // Extract v3AudioTags for ElevenLabs TTS
        if (directives.v3AudioTags) {
          options.v3AudioTags = directives.v3AudioTags;
        }
        // Extract delivery for logging/debugging
        if (directives.delivery) {
          options.delivery = directives.delivery;
          options.detectedEmotion = directives.delivery; // For backward compat
        }
        // Apply stability/style from voiceDirector
        if (typeof directives.voiceStability === 'number') {
          options.stability = directives.voiceStability;
        }
        if (typeof directives.voiceStyle === 'number') {
          options.style = directives.voiceStyle;
        }
        // Apply speed modifier if present
        if (typeof directives.voiceSpeedModifier === 'number' && directives.voiceSpeedModifier !== 1.0) {
          options.speedModifier = directives.voiceSpeedModifier;
        }

        logger.info(`[Orchestrator] Narrator voice direction: ${directives.v3AudioTags || directives.delivery || 'neutral'}`);
      }
    } catch (err) {
      logger.warn(`[Orchestrator] Voice direction for narrator failed, using defaults: ${err.message}`);
    }

    if (withTimestamps) {
      const result = await elevenlabs.textToSpeechWithTimestamps(text, voiceId, options);
      return { audioBuffer: result.audio, wordTimings: result.wordTimings };
    }

    const audioBuffer = await elevenlabs.textToSpeech(text, voiceId, options);
    return { audioBuffer, wordTimings: null };
  }

  /**
   * Generate SFX for scene
   * @private
   */
  async _generateSFX(sceneId, text, mood, wordTimings) {
    const sceneSfx = [];

    try {
      const detectedSfx = await sfxCoordinator.analyzeScene(text, {
        mood,
        genre: this.session.config_json?.genre,
        setting: this.outline?.setting
      });

      if (detectedSfx?.length > 0) {
        for (const sfx of detectedSfx) {
          const sfxKey = sfx.sfxKey || sfx.sfx_key || sfx.matched_sfx;
          if (!sfxKey) continue;

          const volume = sfx.volume || (sfxKey.startsWith('atmosphere') ? 0.2 : 0.3);
          const isLooping = sfx.loop !== undefined ? sfx.loop : sfxKey.includes('ambient');
          const timing = sfx.timing || 'scene_start';

          let triggerAtSeconds = 0;
          // Calculate total duration: try total_duration_ms first, then duration_seconds, then default to 30
          let totalDuration = 30;
          if (wordTimings?.total_duration_ms) {
            totalDuration = wordTimings.total_duration_ms / 1000;
          } else if (wordTimings?.duration_seconds) {
            totalDuration = wordTimings.duration_seconds;
          }

          // ============================================================
          // TIMING CONVERSION: Normalize AI timing strings to seconds
          // ============================================================
          switch (timing?.toLowerCase?.()) {
            // ★ Start of scene (0 seconds)
            case 'beginning':
            case 'scene_start':
            case 'start':
            case 'intro':
              triggerAtSeconds = 0;
              break;

            // ★ Middle of scene (50% duration)
            case 'middle':
            case 'mid':
            case 'midway':
              triggerAtSeconds = Math.round(totalDuration / 2);
              break;

            // ★ End of scene (near the finish, leave 2-3 seconds)
            case 'end':
            case 'ending':
            case 'finish':
            case 'conclusion':
              triggerAtSeconds = Math.max(0, totalDuration - 3);
              break;

            // ★ During action/specific moments (60-70% through)
            case 'during_action':
            case 'action_moment':
            case 'on_action':
            case 'climax':
            case 'peak':
              // Place at 60% through the scene for dramatic moments
              triggerAtSeconds = Math.round(totalDuration * 0.6);
              break;

            // ★ Contextual/environmental (30% through, subtle)
            case 'contextual':
            case 'environmental':
            case 'ambient':
            case 'atmosphere':
            case 'background':
              // Place early and let it play through
              triggerAtSeconds = Math.round(totalDuration * 0.3);
              break;

            // ★ Continuous sounds (play from start with looping)
            case 'continuous':
            case 'loop':
            case 'throughout':
            case 'constant':
              triggerAtSeconds = 0;
              // Note: isLooping should already be true for these
              break;

            // ★ Unknown timing - use sensible default (25% through)
            default:
              triggerAtSeconds = Math.round(totalDuration * 0.25);
              logger.warn(`[SFX] Unknown timing value "${timing}" for ${sfxKey}, using 25% position`);
          }

          // ============================================================
          // Sanity check: ensure trigger time doesn't exceed scene
          // ============================================================
          triggerAtSeconds = Math.max(0, Math.min(triggerAtSeconds, totalDuration - 1));

          await pool.query(`
            INSERT INTO scene_sfx (scene_id, sfx_key, detected_keyword, detection_reason, volume)
            VALUES ($1, $2, $3, $4, $5)
          `, [sceneId, sfxKey, sfx.keyword || sfx.description?.substring(0, 100), sfx.reason || sfx.description, volume]);

          sceneSfx.push({
            sfx_key: sfxKey,
            keyword: sfx.keyword,
            reason: sfx.reason,
            volume,
            loop: isLooping,
            timing,
            trigger_at_seconds: triggerAtSeconds
          });
        }
      }
    } catch (sfxError) {
      logger.error('SFX detection failed:', sfxError);
    }

    return sceneSfx;
  }

  /**
   * Add recording segment
   * @private
   */
  async _addRecordingSegment(scene, sceneIndex, audioBuffer, audioUrl, wordTimings, text, sceneSfx, choices, mood, isFinal) {
    try {
      const sfxData = sceneSfx.map(sfx => ({
        sfx_id: `${Date.now()}_${sfx.sfx_key}`,
        sfx_key: sfx.sfx_key,
        audio_url: `/audio/sfx/${sfx.sfx_key.replace(/\./g, '_')}.mp3`,
        trigger_at_seconds: sfx.trigger_at_seconds || 0,
        fade_in_ms: 2000,
        fade_out_ms: 2000,
        duration_seconds: 30,
        volume: sfx.volume || 0.3,
        loop: sfx.loop || false
      }));

      await recordingService.addSegment(this.activeRecording.id, {
        sceneId: scene.id,
        sequenceIndex: sceneIndex,
        audioBuffer,
        audioUrl,
        wordTimings,
        sceneText: text,
        sceneSummary: scene.summary,
        sfxData,
        choicesAtEnd: choices.length > 0 ? choices : null,
        mood,
        chapterNumber: sceneIndex + 1,
        chapterTitle: `Chapter ${sceneIndex + 1}`
      });

      if (isFinal) {
        await recordingService.completeRecording(this.activeRecording.id);
        this.activeRecording = null;
      }
    } catch (recErr) {
      logger.error('[Recording] Failed to add segment:', recErr);
    }
  }

  /**
   * Generate audio for a scene on-demand
   */
  async generateSceneAudio(sceneId, voiceId = null, options = {}) {
    await this.loadSession();

    const scene = await getSceneForAudio(sceneId, this.sessionId);
    if (!scene) {
      throw new Error('Scene not found');
    }

    const forceRegenerate = options?.forceRegenerate === true;

    if (scene.audio_url && !forceRegenerate) {
      // Log cached wordTimings
      logger.info(`[generateSceneAudio] Using CACHED audio: wordTimings type=${typeof scene.word_timings}, hasWords=${!!scene.word_timings?.words}, count=${scene.word_timings?.words?.length || 0}`);
      return {
        audioUrl: scene.audio_url,
        cached: true,
        wordTimings: scene.word_timings || null,
        durationSeconds: scene.audio_duration_seconds || null,
        voiceId: scene.voice_id || null
      };
    }

    const effectiveVoiceId = getEffectiveVoiceId({ voiceId, config: this.session.config_json });
    const useMultiVoice = shouldUseMultiVoice({ config: this.session.config_json, characters: this.characters });
    const normalizedStyle = normalizeStyleValue(this.session.config_json?.narratorStyleSettings?.style);
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;

    logger.info(`[Orchestrator] Generating on-demand audio for scene ${sceneId}`);

    let audioBuffer, wordTimings;
    let audioUrl;

    if (useMultiVoice && this.characters.length > 0) {
      if (!scene.dialogue_map?.length) {
        throw new Error(`MULTI-VOICE FAILED: No dialogue_map for scene ${scene.id}`);
      }

      const result = await this._generateMultiVoiceAudio({
        finalText: scene.polished_text,
        proseFormat: 'position_based',
        preComputedSegments: null,
        dialogueMap: scene.dialogue_map,
        effectiveVoiceId,
        normalizedStyle,
        onProgress
      });
      audioBuffer = result.audioBuffer;
      wordTimings = result.wordTimings;
      audioUrl = result.audioUrl; // cached path from cacheMultiVoiceAudio
    } else {
      const result = await this._generateSingleVoiceAudio({
        text: scene.polished_text,
        voiceId: effectiveVoiceId,
        normalizedStyle,
        withTimestamps: true
      });
      audioBuffer = result.audioBuffer;
      wordTimings = result.wordTimings;

      // Persist audio to cache/disk with word timings
      try {
        const cacheResult = await elevenlabs.cacheAudioWithTimestamps(
          scene.polished_text,
          effectiveVoiceId,
          audioBuffer,
          wordTimings,
          result.checksum || null
        );
        audioUrl = cacheResult?.audioUrl || null;
      } catch (err) {
        logger.warn(`[Orchestrator] Failed to cache single-voice audio: ${err.message}`);
      }
    }

    if (!wordTimings?.words || wordTimings.words.length === 0) {
      throw new Error(`KARAOKE FAILED: No word timings generated for scene ${scene.id}`);
    }

    if (wordTimings.total_duration_ms && wordTimings.words?.length) {
      const finalEnd = wordTimings.words[wordTimings.words.length - 1].end_ms || 0;
      const drift = Math.abs(wordTimings.total_duration_ms - finalEnd);
      if (drift > 250) {
        const msg = `[generateSceneAudio] Word timing drift detected: total=${wordTimings.total_duration_ms}ms lastEnd=${finalEnd}ms (scene ${scene.id})`;
        logAlert('error', msg, { sceneId });
        throw new Error(msg);
      }
    }

    const audioHash = elevenlabs.generateHash(scene.polished_text, effectiveVoiceId);
    if (!audioUrl) {
      audioUrl = `/audio/${audioHash}.mp3`;
    }
    const durationSeconds = wordTimings?.total_duration_ms ? (wordTimings.total_duration_ms / 1000) : null;
    await saveSceneAudio(sceneId, audioUrl, { wordTimings, durationSeconds, voiceId: effectiveVoiceId });

    // Log wordTimings before return
    logger.info(`[generateSceneAudio] Returning wordTimings: type=${typeof wordTimings}, hasWords=${!!wordTimings?.words}, count=${wordTimings?.words?.length || 0}, durationMs=${wordTimings?.total_duration_ms || 'N/A'}`);

    return { audioUrl, cached: false, audioBuffer, wordTimings };
  }

  /**
   * Regenerate synopsis
   */
  async regenerateSynopsis() {
    await this.loadSession();

    const summaryPrompt = `
      Based on the story outline and existing scenes, create a new compelling synopsis.
      Title: ${this.outline?.title || 'Story'}
      Setting: ${this.outline?.setting || 'Unknown'}
      Characters: ${this.characters.map(c => c.name).join(', ')}

      Write a 2-3 sentence synopsis that captures the essence of the story.
    `;

    const result = await callAgent('narrator', summaryPrompt, { outline: this.outline });

    const newSynopsis = result.content?.trim() || 'A tale of adventure and discovery.';

    await pool.query(
      'UPDATE story_sessions SET synopsis = $1 WHERE id = $2',
      [newSynopsis, this.sessionId]
    );

    return newSynopsis;
  }

  /**
   * Submit CYOA choice
   */
  async submitChoice(choiceIdOrKey) {
    await this.loadSession();

    // Find choice by ID or key
    const choiceResult = await pool.query(
      `SELECT * FROM story_choices
       WHERE (id = $1 OR choice_key = $2)
       AND story_session_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [choiceIdOrKey, choiceIdOrKey, this.sessionId]
    );

    if (choiceResult.rows.length === 0) {
      throw new Error('Choice not found');
    }

    const choice = choiceResult.rows[0];

    // Mark as selected
    await pool.query(
      'UPDATE story_choices SET selected = true WHERE id = $1',
      [choice.id]
    );

    // Get next scene number
    const sceneCount = await getSceneCount(this.sessionId);

    return {
      choice,
      nextSceneNumber: sceneCount + 1
    };
  }

  /**
   * End the story gracefully
   */
  async endStory() {
    await this.loadSession();

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
