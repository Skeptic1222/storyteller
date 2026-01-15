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
import { logger } from '../utils/logger.js';
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
  polishForNarration,
  checkSafety,
  generateChoices,
  checkLoreConsistency,
  countTokens,
  extractStoryFacts,
  determineComplexity,
  validateStoryText
} from './openai.js';

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
import { filterSpeechTagsWithLLM } from './agents/speechTagFilterAgent.js';
import { extractSpeakers, stripTags, parseTaggedProse } from './agents/tagParser.js';

/**
 * Extract dialogue from hybrid pipeline content for multi-voice audio
 * Attempts to parse [CHAR:Name]dialogue[/CHAR] tags first, falls back to quote parsing
 *
 * @param {string} content - The prose content
 * @param {Array} characters - Known characters
 * @returns {Object} { dialogueMap, newCharacters, format }
 */
function extractDialogueFromContent(content, characters) {
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

  // No tags found - fall back to simple quote extraction
  // This is a best-effort approach when Venice didn't use tags
  logger.info('[extractDialogueFromContent] No tags found, using fallback quote extraction');

  const quotePattern = /"([^"]+)"/g;
  const dialogueMap = [];
  let match;

  while ((match = quotePattern.exec(content)) !== null) {
    dialogueMap.push({
      speaker: 'Unknown',
      text: match[1],
      index: dialogueMap.length
    });
  }

  return {
    dialogueMap,
    newCharacters: [],
    format: 'fallback_quotes'
  };
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
  }

  /**
   * Load all session data
   */
  async loadSession() {
    this.session = await loadSessionData(this.sessionId);

    logger.info(`[Orchestrator] Session loaded | id: ${this.sessionId} | hide_speech_tags: ${this.session.config_json?.hide_speech_tags} | multi_voice: ${this.session.config_json?.multi_voice}`);

    // Load Story Bible context for Advanced Mode
    this.storyBibleContext = await loadStoryBibleSession(this.sessionId);
    this.isAdvancedMode = !!this.storyBibleContext;

    // Load outline
    this.outline = await loadOutline(this.sessionId);
    if (!this.outline && this.storyBibleContext?.outline) {
      this.outline = this.storyBibleContext.outline;
    }

    // Load characters and lore
    this.characters = await loadCharacters(this.sessionId, this.storyBibleContext);
    this.lore = await loadLore(this.sessionId, this.storyBibleContext);

    // Load story bible and context summary
    this.storyBible = await loadStoryBible(this.sessionId);
    this.contextSummary = await loadContextSummary(this.sessionId);

    // Load lorebook entries
    await this.lorebook.loadEntries();

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
   */
  emitProgress(phase, detail = null) {
    logger.debug(`[Orchestrator] PROGRESS | sessionId: ${this.sessionId} | phase: ${phase}`);
    if (this.onProgress && typeof this.onProgress === 'function') {
      this.onProgress(phase, detail);
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
    await this.loadSession();

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
    this.emitProgress('outline_complete');
    logger.info(`Outline generated: ${outline.title}`);

    return outline;
  }

  /**
   * Generate the next scene
   */
  async generateNextScene(voiceId = null, options = {}) {
    const { deferAudio = false } = options;

    this.emitProgress('loading');
    await this.loadSession();

    if (!this.outline) {
      throw new Error('No outline found. Generate outline first.');
    }

    const sceneIndex = await getSceneCount(this.sessionId);
    const previousScene = sceneIndex > 0 ? await getPreviousScene(this.sessionId) : null;
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

    // Check multi-voice early
    const multiVoiceEnabled = this.session.config_json?.multi_voice === true || this.session.config_json?.multiVoice === true;
    const willUseMultiVoice = multiVoiceEnabled && this.characters.length > 0;

    logger.info(`[Orchestrator] MULTI-VOICE CHECK | config.multi_voice: ${this.session.config_json?.multi_voice} | characters: ${this.characters.length} | willUseMultiVoice: ${willUseMultiVoice}`);

    // ★ HYBRID PIPELINE: Intent Validation for Mature Content ★
    // Analyze user's intent to ensure Venice.ai generates appropriately explicit content
    const intensitySettings = this.session.config_json?.intensity || {};
    const audienceSetting = this.session.config_json?.audience || 'general';
    const adultContentSetting = intensitySettings.adultContent ?? intensitySettings.romance ?? 0;
    const useHybridPipeline = audienceSetting === 'mature' && adultContentSetting >= 50;

    logger.info(`[Orchestrator] HYBRID CHECK | audience: ${audienceSetting} | adultContent: ${adultContentSetting} | intensity: ${JSON.stringify(intensitySettings)} | useHybrid: ${useHybridPipeline}`);

    let intentAnalysis = null;
    if (useHybridPipeline) {
      this.emitProgress('analyzing_intent');
      const userPrompt = this.session.config_json?.custom_prompt || this.session.config_json?.premise || this.outline?.synopsis || '';
      intentAnalysis = await validateUserIntent(userPrompt, this.session.config_json);
      logger.info(`[Orchestrator] HYBRID PIPELINE | Intent analyzed: ${intentAnalysis.summary || 'Explicit content requested'}`);
    }

    // Generate scene with dialogue
    this.emitProgress('generating');
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

    // ★ HYBRID PIPELINE DECISION ★
    // For high explicit content (adultContent >= 80), use the full hybrid pipeline
    // which has Venice.ai generate with tags, then OpenAI polishes non-explicit sections
    const useFullHybridPipeline = useHybridPipeline &&
                                   (intensitySettings.adultContent >= 80 || intensitySettings.romance >= 80) &&
                                   intentAnalysis?.requiresExplicit;

    let sceneResult;

    if (useFullHybridPipeline) {
      // ★ HYBRID PIPELINE: Venice + Tag Extraction + OpenAI Polish + Restore ★
      logger.info(`[Orchestrator] ★ USING FULL HYBRID PIPELINE for explicit content (adultContent: ${intensitySettings.adultContent})`);
      this.emitProgress('hybrid_generating');

      // Build the scene generation prompt
      const scenePrompt = `Write scene ${sceneIndex + 1} of the story "${this.outline?.title || 'Untitled'}".

SETTING: ${this.outline?.setting || 'Not specified'}

${previousScene ? `PREVIOUS SCENE SUMMARY:\n${previousScene.substring(0, 500)}...\n` : 'This is the opening scene.'}

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
        // Extract [CHAR:Name]dialogue[/CHAR] tags if present, or parse quotes
        const dialogueExtracted = extractDialogueFromContent(hybridResult.content, this.characters);
        sceneResult.dialogue_map = dialogueExtracted.dialogueMap;
        sceneResult.new_characters = dialogueExtracted.newCharacters;
        sceneResult.prose_format = dialogueExtracted.format;
      }

    } else {
      // ★ NORMAL FLOW: generateSceneWithDialogue with provider routing to Venice ★
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
        storyBibleContext: this.isAdvancedMode ? buildAdvancedModeContext(this.storyBibleContext, this.lore) : null
      });
    }

    let rawText = sceneResult.content;
    const sceneDialogueMap = sceneResult.dialogue_map || [];
    const sceneNewCharacters = sceneResult.new_characters || [];
    const proseFormat = sceneResult.prose_format || 'position_based';
    const preComputedSegments = sceneResult.segments || null;

    logger.info(`[Orchestrator] Scene generated with ${sceneDialogueMap.length} dialogue entries, format: ${proseFormat}`);

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
    const validationResult = skipValidation ? { valid: true, fixed: false } : await validateStoryText(rawText, { outline: this.outline, characters: this.characters }, this.sessionId);

    if (!validationResult.valid && validationResult.fixed) {
      rawText = validationResult.text;
    }

    // Run parallel agent checks
    this.emitProgress('validating');
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
      [safetyResult, loreCheck, polishedText, storyFacts] = await Promise.all([
        checkSafety(rawText, { ...effectiveLimits, audience }, this.sessionId),
        checkLoreConsistency(rawText, { characters: this.characters, setting: this.outline.setting, previousEvents: previousScene, storyBible: this.storyBible }, this.sessionId),
        willUseMultiVoice ? Promise.resolve(rawText) : polishForNarration(rawText, { narrator_style: this.session.config_json?.narrator_style || 'warm', bedtime_mode: this.session.bedtime_mode }, this.sessionId),
        extractStoryFacts(rawText, { outline: this.outline, characters: this.characters }, this.sessionId)
      ]);
    }

    this.emitProgress('polishing');

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

    // Generate choices if CYOA
    let choices = [];
    if (this.session.cyoa_enabled && !isFinal && sceneIndex > 0) {
      this.emitProgress('choices');
      const cyoaSettings = this.session.config_json?.cyoa_settings || {};
      const choiceResult = await generateChoices(finalText, {
        outline: this.outline,
        characters: this.characters,
        max_choices: cyoaSettings.max_branches || 3,
        structure_type: cyoaSettings.structure_type || 'diamond',
        is_near_ending: sceneIndex >= targetScenes - 2
      }, this.sessionId);
      choices = choiceResult.choices || [];
    }

    const mood = determineMood(finalText);
    const displayText = stripTags(finalText);

    // Save scene
    this.emitProgress('saving');
    const scene = await saveScene({
      sessionId: this.sessionId,
      sceneIndex,
      rawText,
      displayText,
      mood
    });

    // Speaker validation (C+E architecture)
    let dialogueMap = sceneDialogueMap;

    if (this.characters.length > 0 && dialogueMap.length > 0) {
      try {
        this.emitProgress('validating_speakers');

        const storyContext = {
          genre: this.session.config_json?.genre || 'general fiction',
          mood: this.session.config_json?.mood || mood,
          audience: this.session.config_json?.audience || 'general',
          setting: this.outline?.setting || '',
          synopsis: this.outline?.synopsis || '',
          themes: this.outline?.themes || []
        };

        // Campaign mode removed - migrated to GameMaster project (2026-01-08)
        const narratorVoiceId = getEffectiveVoiceId({ voiceId: null, config: this.session.config_json, isCampaign: false });

        const speakerValidationResult = await validateAndReconcileSpeakers(this.sessionId, dialogueMap, sceneNewCharacters, this.characters, storyContext, narratorVoiceId);

        if (speakerValidationResult.createdCharacters.length > 0) {
          this.characters = [...this.characters, ...speakerValidationResult.createdCharacters];
        }

        const speakersExtracted = proseFormat === 'tag_based' ? extractSpeakers(rawText) : dialogueMap.map(d => d.speaker).filter((v, i, a) => a.indexOf(v) === i);
        await saveDialogueMap({ sceneId: scene.id, dialogueMap, proseFormat, speakersExtracted });

      } catch (validationError) {
        logger.error(`[SpeakerValidation] CRITICAL FAILURE: ${validationError.message}`);
        await markDialogueTaggingFailed(scene.id, validationError.message);
        throw validationError;
      }
    } else {
      await markDialogueTaggingSkipped(scene.id);
    }

    // Save choices
    if (choices.length > 0) {
      await saveChoices(this.sessionId, scene.id, choices);
    }

    // Update session
    await updateSessionAfterScene(this.sessionId);

    // Generate audio if not deferred
    let audioUrl = null;
    let audioSegments = [];
    let wordTimings = null;
    let audioBuffer;

    // Campaign mode removed - migrated to GameMaster project (2026-01-08)
    const effectiveVoiceId = getEffectiveVoiceId({ voiceId, config: this.session.config_json, isCampaign: false });
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

    // Generate SFX
    let sceneSfx = [];
    if (this.session.config_json?.sfx_enabled !== false && sfxService.enabled) {
      sceneSfx = await this._generateSFX(scene.id, finalText, mood, wordTimings);
    }

    // Recording segment
    if (this.activeRecording && audioUrl) {
      await this._addRecordingSegment(scene, sceneIndex, audioBuffer, audioUrl, wordTimings, finalText, sceneSfx, choices, mood, isFinal);
    }

    logger.info(`[Orchestrator] OUTPUT | sceneId: ${scene.id} | sceneIndex: ${sceneIndex} | multiVoice: ${willUseMultiVoice} | sfxCount: ${sceneSfx.length}`);

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

    // Filter speech tags if enabled
    if (shouldHideSpeechTags(this.session.config_json)) {
      segments = await filterSpeechTagsWithLLM(segments, { title: this.session.title, genre: this.session.config_json?.genre });
    }

    logSegmentAnalysis(segments, finalText);

    // Get voice assignments
    const existingAssignments = await pool.query(
      'SELECT c.name, cva.elevenlabs_voice_id FROM character_voice_assignments cva JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
      [this.sessionId]
    );

    let characterVoices = buildVoiceAssignmentsMap(existingAssignments.rows);

    if (existingAssignments.rows.length > 0) {
      const validation = validateExistingAssignments(characterVoices, effectiveVoiceId);
      if (!validation.valid) {
        characterVoices = {};
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
      speaker: 'narrator'
    };

    // v3 Prosody: LLM-directed narrator delivery (Audio Tags) for AAA performance.
    // Avoid brittle keyword heuristics; infer delivery from full scene context.
    try {
      const storyContext = buildEmotionContext({
        config: this.session.config_json,
        sceneText: text,
        characters: this.characters
      });

      const narratorDirectives = await getNarratorDeliveryDirectives({
        sessionId: this.sessionId,
        sceneText: text,
        context: storyContext
      });

      if (narratorDirectives?.emotion) {
        options.detectedEmotion = narratorDirectives.emotion;
      }
      if (narratorDirectives?.delivery) {
        options.delivery = narratorDirectives.delivery;
      }
      if (narratorDirectives?.voiceSettingsOverride?.stability != null) {
        options.stability = narratorDirectives.voiceSettingsOverride.stability;
      }
      if (narratorDirectives?.voiceSettingsOverride?.style != null) {
        options.style = narratorDirectives.voiceSettingsOverride.style;
      }
    } catch (err) {
      logger.warn(`[Orchestrator] Narrator delivery directives failed: ${err.message}`);
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
          const totalDuration = wordTimings?.duration_seconds || 30;

          switch (timing) {
            case 'beginning':
            case 'scene_start':
              triggerAtSeconds = 0;
              break;
            case 'middle':
              triggerAtSeconds = totalDuration / 2;
              break;
            case 'end':
              triggerAtSeconds = Math.max(0, totalDuration - 3);
              break;
            default:
              triggerAtSeconds = 0;
          }

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
      return {
        audioUrl: scene.audio_url,
        cached: true,
        wordTimings: scene.word_timings || null,
        durationSeconds: scene.audio_duration_seconds || null,
        voiceId: scene.voice_id || null
      };
    }

    const effectiveVoiceId = getEffectiveVoiceId({ voiceId, config: this.session.config_json, isCampaign: false });
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

    const audioHash = elevenlabs.generateHash(scene.polished_text, effectiveVoiceId);
    if (!audioUrl) {
      audioUrl = `/audio/${audioHash}.mp3`;
    }
    const durationSeconds = wordTimings?.total_duration_ms ? (wordTimings.total_duration_ms / 1000) : null;
    await saveSceneAudio(sceneId, audioUrl, { wordTimings, durationSeconds, voiceId: effectiveVoiceId });

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
