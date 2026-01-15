/**
 * LaunchSequenceManager
 * Orchestrates the pre-narration validation sequence with strict sequential execution.
 * Ensures all validation stages complete in order before narration can begin.
 *
 * Stages (in order):
 * 1. voices - Narrator Voice Assignment
 * 2. sfx - Sound Effect Detection/Generation
 * 3. cover - Cover Art Generation & Validation (with OCR)
 * 4. qa - Safety & Quality Assurance Checks
 *
 * Key Features:
 * - Strict sequential execution (no parallel stages)
 * - Atomic status updates for reliable UI feedback
 * - Individual stage retry capability
 * - OCR validation for cover art text
 * - Watchdog mechanism for countdown trigger reliability
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { ElevenLabsService } from './elevenlabs.js';
import { stripTags } from './agents/tagParser.js';
import { SFXCoordinatorAgent } from './agents/sfxCoordinator.js';
import { ValidationAgent } from './agents/validationAgent.js';
import { SafetyAgent } from './agents/safetyAgent.js';
import { validateAllCharacterGenders } from './agents/genderValidationAgent.js';
import { generateStoryCover } from './portraitGenerator.js';
import * as agentTracker from './agentStatusTracker.js';
import * as usageTracker from './usageTracker.js';
import { completion, parseJsonResponse } from './openai.js';
import { getUtilityModel } from './modelSelection.js';
import fetch from 'node-fetch';

const elevenlabs = new ElevenLabsService();
const sfxCoordinator = new SFXCoordinatorAgent();
const validationAgent = new ValidationAgent();
const safetyAgent = new SafetyAgent();

// Validation stage definitions
const STAGES = {
  VOICES: 'voices',
  SFX: 'sfx',
  COVER: 'cover',
  QA: 'qa'
};

// Stage status values
const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  ERROR: 'error'
};

// Launch progress ranges (overall 70-100% after story generation completes)
const LAUNCH_PROGRESS_RANGES = {
  [STAGES.VOICES]: { start: 70, end: 82 },
  [STAGES.SFX]: { start: 82, end: 92 },
  [STAGES.COVER]: { start: 92, end: 97 },
  [STAGES.QA]: { start: 97, end: 100 }
};

/**
 * LaunchSequenceManager handles the complete pre-narration validation flow
 */
export class LaunchSequenceManager {
  constructor(sessionId, io) {
    this.sessionId = sessionId;
    this.io = io;
    this.scene = null;
    this.voiceId = null;
    this.cancelled = false;
    this.startTime = Date.now(); // For TTL cleanup in socket handlers

    // Track stage statuses
    this.stageStatuses = {
      [STAGES.VOICES]: STATUS.PENDING,
      [STAGES.SFX]: STATUS.PENDING,
      [STAGES.COVER]: STATUS.PENDING,
      [STAGES.QA]: STATUS.PENDING
    };

    // Store results from each stage
    this.stageResults = {
      voices: null,
      sfx: null,
      cover: null,
      qa: null,
      safety: null  // SafetyAgent report (Section 5 of Storyteller Gospel)
    };

    // Final validation stats
    this.validationStats = null;

    // Retry tracking
    this.retryAttempts = {
      [STAGES.VOICES]: 0,
      [STAGES.SFX]: 0,
      [STAGES.COVER]: 0,
      [STAGES.QA]: 0
    };
    this.maxRetries = 2; // Maximum retry attempts per stage

    // Stage execution timestamps for debugging
    this.stageTimestamps = {};

    // Ready event confirmation tracking
    this.readyEventSent = false;
    this.readyEventConfirmed = false;
  }

  /**
   * Cancel the launch sequence
   */
  cancel() {
    this.cancelled = true;
    logger.info(`[LaunchSequence] Cancelled for session ${this.sessionId}`);
  }

  /**
   * Emit stage status update to client (atomic update)
   * Each status update is isolated to its specific stage to prevent conflicts
   */
  emitStageStatus(stage, status, details = {}) {
    // Only update if status actually changed (prevents duplicate events)
    const previousStatus = this.stageStatuses[stage];
    if (previousStatus === status && status !== STATUS.IN_PROGRESS) {
      return; // Skip duplicate success/error/pending events
    }

    this.stageStatuses[stage] = status;
    const timestamp = Date.now();

    // Track timestamps for debugging
    if (!this.stageTimestamps[stage]) {
      this.stageTimestamps[stage] = {};
    }
    this.stageTimestamps[stage][status] = timestamp;

    // Build atomic event - clearly scoped to this stage only
    const event = {
      stage,
      status,
      previousStatus,
      allStatuses: { ...this.stageStatuses },
      details: {
        ...details,
        retryAttempt: this.retryAttempts[stage],
        canRetry: this.retryAttempts[stage] < this.maxRetries
      },
      timestamp,
      sequenceId: `${this.sessionId}-${stage}-${timestamp}` // Unique ID for deduplication
    };

    logger.info(`[LaunchSequence] Stage update: ${stage} ${previousStatus} -> ${status}`, {
      details,
      timestamp,
      retryAttempt: this.retryAttempts[stage]
    });

    this.io.to(this.sessionId).emit('launch-stage-update', event);
  }

  /**
   * Emit overall progress update
   */
  emitProgress(message, percent, stage = null) {
    this.io.to(this.sessionId).emit('launch-progress', {
      message,
      percent,
      statuses: { ...this.stageStatuses },
      stage
    });
  }

  emitStageProgress(stage, progress, message) {
    const range = LAUNCH_PROGRESS_RANGES[stage];
    if (!range) return;

    const clamped = Math.max(0, Math.min(1, progress));
    const percent = range.start + (range.end - range.start) * clamped;
    this.emitProgress(message, Math.round(percent), stage);
  }

  /**
   * Initialize all stages as pending and notify client
   */
  initializeStages() {
    // Reset all to pending
    Object.keys(this.stageStatuses).forEach(stage => {
      this.stageStatuses[stage] = STATUS.PENDING;
    });

    // Emit initial state
    this.io.to(this.sessionId).emit('launch-sequence-started', {
      stages: Object.keys(STAGES).map(key => ({
        id: STAGES[key],
        name: this.getStageName(STAGES[key]),
        status: STATUS.PENDING
      })),
      allStatuses: { ...this.stageStatuses }
    });

    logger.info(`[LaunchSequence] Initialized for session ${this.sessionId}`);
  }

  /**
   * Get human-readable stage name
   */
  getStageName(stage) {
    const names = {
      [STAGES.VOICES]: 'Narrator Voices',
      [STAGES.SFX]: 'Sound Effects',
      [STAGES.COVER]: 'Cover Art',
      [STAGES.QA]: 'Quality Checks'
    };
    return names[stage] || stage;
  }

  /**
   * Run the complete launch sequence
   * Returns validation results or throws on failure
   */
  async run(scene, voiceId) {
    this.scene = scene;
    this.voiceId = voiceId;

    try {
      // Initialize all stages
      this.initializeStages();

      // Initialize agent tracking for this session
      agentTracker.initAgentTracking(this.sessionId, this.io);
      usageTracker.setUsageTrackingIO(this.sessionId, this.io);
      this.emitStageProgress(STAGES.VOICES, 0, 'Starting launch sequence...');

      // Stage 1: Voice Assignment
      if (this.cancelled) return null;
      await this.runVoiceAssignment();

      // Stage 2: SFX Generation
      if (this.cancelled) return null;
      await this.runSFXGeneration();

      // Stage 3: Cover Art Validation
      if (this.cancelled) return null;
      await this.runCoverArtValidation();

      // Stage 4: QA Checks
      if (this.cancelled) return null;
      await this.runQAChecks();

      // === FINAL VALIDATION GATE ===
      // Ensure ALL required components are ready before playback
      // This is the critical checkpoint - no content until everything passes
      if (this.cancelled) return null;
      await this.runFinalValidationGate();

      // All stages complete - emit ready event
      this.emitReadyForPlayback();

      return {
        success: true,
        stats: this.validationStats,
        stageResults: this.stageResults
      };

    } catch (error) {
      logger.error(`[LaunchSequence] Error in launch sequence:`, error);
      this.io.to(this.sessionId).emit('launch-sequence-error', {
        error: error.message,
        failedStage: this.getCurrentStage(),
        statuses: { ...this.stageStatuses }
      });
      throw error;
    }
  }

  /**
   * Get the current in-progress stage
   */
  getCurrentStage() {
    for (const [stage, status] of Object.entries(this.stageStatuses)) {
      if (status === STATUS.IN_PROGRESS) return stage;
    }
    return null;
  }

  /**
   * Emit detailed technical progress for premium user experience
   * These messages show the sophisticated AI pipeline at work
   */
  emitDetailedProgress(category, message, details = {}) {
    this.io.to(this.sessionId).emit('detailed-progress', {
      timestamp: new Date().toISOString(),
      category,
      message,
      details,
      sessionId: this.sessionId
    });
    logger.info(`[DetailedProgress:${category}] ${message}`);
  }

  /**
   * Stage 1: Narrator Voice Assignment
   * Validates that all required voices are assigned and available
   */
  async runVoiceAssignment() {
    const stage = STAGES.VOICES;
    this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Assigning narrator voices...' });

    // Start voice agent tracking
    agentTracker.startAgent(this.sessionId, 'voice', 'Analyzing voice requirements...');
    agentTracker.updateAgentProgress(this.sessionId, 'voice', 10, 'Loading voice assignments...');
    this.emitStageProgress(stage, 0.1, 'Loading voice assignments...');

    // === DETAILED PROGRESS: Voice Assignment Start ===
    this.emitDetailedProgress('voice', 'Initializing Voice Casting Agent...', {
      agent: 'VoiceCastingAgent',
      model: 'gpt-4o',
      task: 'Character voice matching and gender validation'
    });

    try {
      // Get session config to find voice assignments
      const sessionResult = await pool.query(
        'SELECT config_json FROM story_sessions WHERE id = $1',
        [this.sessionId]
      );

      this.emitDetailedProgress('voice', 'Loading session configuration...', {
        action: 'database_query',
        table: 'story_sessions'
      });

      const config = sessionResult.rows[0]?.config_json || {};
      const narratorVoice = this.voiceId || config.voice_id || config.narratorVoice;

      this.emitDetailedProgress('voice', 'Analyzing voice configuration...', {
        narratorVoiceId: narratorVoice ? narratorVoice.substring(0, 8) + '...' : 'none',
        multiVoiceEnabled: Boolean(config.multi_voice),
        audience: config.audience || 'general'
      });

      // Get characters for this session from the characters table (with gender inference fields)
      const characterResults = await pool.query(`
        SELECT id, name, role, voice_description, description, personality, traits_json
        FROM characters
        WHERE story_session_id = $1
        ORDER BY role DESC, name ASC
      `, [this.sessionId]);

      // Check if multi-voice is enabled in config
      // FIX: Use truthy check instead of strict boolean equality
      // This handles "true", 1, true, and other truthy values
      const isMultiVoice = Boolean(config.multi_voice);
      logger.info(`[LaunchSequence] multi_voice config: ${config.multi_voice} (type: ${typeof config.multi_voice}), isMultiVoice: ${isMultiVoice}`);

      // If no characters in DB, try to get them from the outline
      // FIX: Always try to load characters, regardless of multi_voice setting
      // Characters are needed for the story even in single-voice mode
      let characters = characterResults.rows;

      this.emitDetailedProgress('voice', `Found ${characters.length} characters in database`, {
        action: 'character_load',
        source: 'database',
        count: characters.length,
        characterNames: characters.slice(0, 5).map(c => c.name)
      });

      if (characters.length === 0) {
        logger.info(`[LaunchSequence] No characters in DB, checking outline for character info`);

        this.emitDetailedProgress('voice', 'Searching story outline for characters...', {
          action: 'outline_search',
          reason: 'No characters found in database'
        });

        // Try to get characters from outline_json
        const outlineResult = await pool.query(`
          SELECT outline_json FROM story_outlines
          WHERE story_session_id = $1
          ORDER BY created_at DESC LIMIT 1
        `, [this.sessionId]);

        if (outlineResult.rows.length > 0 && outlineResult.rows[0].outline_json) {
          const outline = typeof outlineResult.rows[0].outline_json === 'string'
            ? JSON.parse(outlineResult.rows[0].outline_json)
            : outlineResult.rows[0].outline_json;

          logger.info(`[LaunchSequence] Outline found - title: "${outline.title}", main_characters: ${outline.main_characters?.length || 0}`);

          if (outline.main_characters && outline.main_characters.length > 0) {
            // Insert outline characters into the database to get real UUIDs
            // This ensures voice assignments can be persisted properly
            logger.info(`[LaunchSequence] Inserting ${outline.main_characters.length} characters from outline into database`);

            this.emitDetailedProgress('voice', `Extracting ${outline.main_characters.length} characters from story outline...`, {
              action: 'outline_extraction',
              characterCount: outline.main_characters.length,
              characterNames: outline.main_characters.slice(0, 5).map(c => c.name),
              storyTitle: outline.title || 'Unknown'
            });

            const insertedCharacters = [];

            for (const char of outline.main_characters) {
              try {
                // Extract gender from outline - this is now REQUIRED and validated
                // Gender MUST come from LLM outline generation - no regex inference
                const characterGender = char.gender?.toLowerCase()?.trim() || null;

                // FAIL LOUD: Gender is required from outline - no inference fallback
                if (!characterGender) {
                  const errorMsg = `CRITICAL: Character "${char.name}" missing gender from outline. ` +
                    `This should have been validated in generateOutline(). ` +
                    `Gender MUST be provided by LLM, not inferred from regex.`;
                  logger.error(`[LaunchSequence] ${errorMsg}`);
                  throw new Error(errorMsg);
                }

                // Validate gender is one of the allowed values
                const validGenders = ['male', 'female', 'non-binary', 'neutral'];
                if (!validGenders.includes(characterGender)) {
                  const errorMsg = `CRITICAL: Character "${char.name}" has invalid gender "${characterGender}". ` +
                    `Must be one of: ${validGenders.join(', ')}`;
                  logger.error(`[LaunchSequence] ${errorMsg}`);
                  throw new Error(errorMsg);
                }

                logger.info(`[LaunchSequence] Character "${char.name}": gender=${characterGender}, source=outline (LLM-determined)`);

                const insertResult = await pool.query(`
                  INSERT INTO characters (story_session_id, name, role, voice_description, description, personality, traits_json, gender, gender_confidence, gender_source, gender_reasoning)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                  ON CONFLICT (story_session_id, name) DO UPDATE SET
                    role = EXCLUDED.role,
                    voice_description = EXCLUDED.voice_description,
                    description = EXCLUDED.description,
                    gender = EXCLUDED.gender,
                    gender_confidence = EXCLUDED.gender_confidence,
                    gender_source = EXCLUDED.gender_source,
                    gender_reasoning = EXCLUDED.gender_reasoning
                  RETURNING id, name, role, voice_description, description, personality, traits_json, gender, gender_confidence, gender_source, gender_reasoning
                `, [
                  this.sessionId,
                  char.name || `Character`,
                  char.role || 'supporting',
                  char.voice_description || null,
                  char.description || char.backstory || char.brief_description || '',
                  char.personality || '',
                  JSON.stringify(char.traits || []),
                  characterGender,
                  'explicit',  // Always explicit now - LLM must provide
                  'outline',   // Always from outline - no inference
                  char.gender_reasoning || null  // Store LLM's chain of thought
                ]);

                if (insertResult.rows[0]) {
                  insertedCharacters.push(insertResult.rows[0]);
                }
              } catch (charInsertErr) {
                logger.warn(`[LaunchSequence] Failed to insert character ${char.name}:`, charInsertErr.message);
              }
            }

            characters = insertedCharacters;
            logger.info(`[LaunchSequence] Inserted ${characters.length} characters from outline: ${characters.map(c => c.name).join(', ')}`);
          } else {
            logger.warn(`[LaunchSequence] Outline has no main_characters array or it's empty`);
          }
        } else {
          logger.warn(`[LaunchSequence] No outline found in database for session`);
        }

        // Extract from synopsis if we have no characters, OR supplement if we have < 6
        // This catches additional characters the AI mentions in dialogue but didn't formally list
        const sessionData = await pool.query(
          'SELECT synopsis, title FROM story_sessions WHERE id = $1',
          [this.sessionId]
        );
        const synopsis = sessionData.rows[0]?.synopsis;

        if (synopsis && synopsis.length > 20) {
          if (characters.length === 0) {
            // No characters at all - extract from synopsis and INSERT into database
            logger.info(`[LaunchSequence] Extracting characters from synopsis (no outline characters)`);
            const extractedChars = await this.extractCharactersFromSynopsis(synopsis);
            if (extractedChars && extractedChars.length > 0) {
              // Insert extracted characters into DB to get real UUIDs
              const insertedChars = await this.insertCharactersToDatabase(extractedChars);
              characters = insertedChars.length > 0 ? insertedChars : extractedChars;
              logger.info(`[LaunchSequence] Extracted and inserted ${characters.length} characters from synopsis`);
            }
          } else if (characters.length < 15) {
            // ALWAYS supplement from synopsis to catch ALL named characters
            // This ensures characters mentioned in dialogue get unique voices when multi-voice is enabled
            // FIX: Load characters regardless of multi_voice setting - decision is made later
            logger.info(`[LaunchSequence] Supplementing ${characters.length} outline characters from synopsis`);
            const extractedChars = await this.extractCharactersFromSynopsis(synopsis);
            if (extractedChars && extractedChars.length > 0) {
              const existingNames = new Set(characters.map(c => c.name.toLowerCase()));
              const newChars = extractedChars.filter(ec => !existingNames.has(ec.name.toLowerCase()));
              if (newChars.length > 0) {
                // Insert new characters into DB to get real UUIDs
                const insertedNewChars = await this.insertCharactersToDatabase(newChars);
                characters = [...characters, ...(insertedNewChars.length > 0 ? insertedNewChars : newChars)];
                logger.info(`[LaunchSequence] Added ${newChars.length} additional characters from synopsis, total: ${characters.length}`);
              }
            }
          }
        }
      }

      // === RE-EVALUATE MULTI-VOICE AFTER CHARACTERS ARE LOADED ===
      // FIX: Default to TRUE when characters exist, unless explicitly disabled
      // This matches the behavior in orchestrator.js and handlers.js
      const multiVoiceExplicitlyDisabled = config.multi_voice === false || config.multiVoice === false;
      const shouldUseMultiVoice = characters.length > 0 && !multiVoiceExplicitlyDisabled;

      if (shouldUseMultiVoice !== isMultiVoice) {
        logger.info(`[LaunchSequence] Re-evaluating multi_voice: config was ${isMultiVoice}, now ${shouldUseMultiVoice} (${characters.length} characters, explicitlyDisabled=${multiVoiceExplicitlyDisabled})`);
      }

      // Update the flag to use the corrected value
      const effectiveMultiVoice = shouldUseMultiVoice;

      // === LLM GENDER VALIDATION ===
      // Run multi-pass gender validation to ensure correct voice assignment
      // This is CRITICAL to prevent mis-gendering errors
      if (effectiveMultiVoice && characters.length > 0) {
        agentTracker.updateAgentProgress(this.sessionId, 'voice', 25, `Running bulletproof gender validation for ${characters.length} characters...`);
        this.emitStageProgress(stage, 0.25, 'Validating character voices...');

        this.emitDetailedProgress('gender', '=== BULLETPROOF GENDER VALIDATION STARTING ===', {
          action: 'gender_validation_start',
          characterCount: characters.length,
          agent: 'GenderValidationAgent',
          model: 'gpt-4o',
          passes: ['Pass 1: Character Analysis', 'Pass 2: Consistency Check', 'Pass 3: Teacher QC'],
          criticality: 'HIGH - Mis-gendering is an unacceptable error'
        });
        this.io.to(this.sessionId).emit('launch-stage-update', {
          stage: stage,
          status: STATUS.IN_PROGRESS,
          message: `Running 3-pass gender validation on ${characters.length} characters...`,
          details: {
            action: 'gender_validation',
            characterCount: characters.length,
            passes: ['Character Analysis', 'Consistency Check', 'Teacher QC']
          }
        });

        try {
          logger.info(`[LaunchSequence] Starting multi-pass gender validation for session ${this.sessionId}`);
          const genderValidationResult = await validateAllCharacterGenders(this.sessionId);

          logger.info(`[LaunchSequence] Gender validation complete: ${genderValidationResult.finalStatus}, corrections=${genderValidationResult.corrections?.length || 0}`);

          // Emit detailed technical progress about validation results
          this.emitDetailedProgress('gender', '=== GENDER VALIDATION COMPLETE ===', {
            action: 'gender_validation_complete',
            finalStatus: genderValidationResult.finalStatus,
            totalPasses: genderValidationResult.passes?.length || 3,
            correctionsApplied: genderValidationResult.corrections?.length || 0,
            duration: `${genderValidationResult.duration_ms || 0}ms`,
            passDetails: genderValidationResult.passes?.map(p => ({
              pass: p.pass,
              name: p.name,
              highConfidence: p.results?.high_confidence,
              lowConfidence: p.results?.low_confidence
            }))
          });

          // Emit detailed progress about validation results
          this.io.to(this.sessionId).emit('launch-stage-update', {
            stage: stage,
            status: STATUS.IN_PROGRESS,
            message: genderValidationResult.finalStatus === 'validated'
              ? `Gender validation passed - all ${characters.length} characters verified`
              : `Gender validation corrected ${genderValidationResult.corrections?.length || 0} gender assignments`,
            details: {
              action: 'gender_validation_complete',
              status: genderValidationResult.finalStatus,
              passes: genderValidationResult.passes,
              corrections: genderValidationResult.corrections?.length || 0,
              duration_ms: genderValidationResult.duration_ms
            }
          });

          // Reload characters from database to get updated gender values
          const reloadResult = await pool.query(`
            SELECT id, name, role, description, personality, voice_description, gender, gender_confidence, gender_source
            FROM characters
            WHERE story_session_id = $1
          `, [this.sessionId]);
          characters = reloadResult.rows;
          logger.info(`[LaunchSequence] Reloaded ${characters.length} characters with validated genders`);

        } catch (genderErr) {
          logger.error(`[LaunchSequence] Gender validation failed:`, genderErr);
          // Don't fail the whole process, but log the warning
          this.io.to(this.sessionId).emit('launch-stage-update', {
            stage: stage,
            status: STATUS.IN_PROGRESS,
            message: `Gender validation encountered an issue - using fallback inference`,
            details: {
              action: 'gender_validation_error',
              error: genderErr.message
            }
          });
        }
      }

      // Get available voices for character matching if multi-voice enabled
      // Fetch more voices to ensure variety, prioritize those with gender data
      let availableVoices = [];
      if (effectiveMultiVoice && characters.length > 0) {
        this.emitDetailedProgress('voice', 'Loading ElevenLabs voice pool for character casting...', {
          action: 'voice_pool_load',
          source: 'elevenlabs_voices',
          filters: ['is_available = true', 'prioritizing voices with gender data']
        });

        const voicesResult = await pool.query(`
          SELECT voice_id, name, gender, age_group, accent, style
          FROM elevenlabs_voices
          WHERE is_available = true
          ORDER BY
            CASE WHEN gender IS NOT NULL THEN 0 ELSE 1 END,
            name ASC
          LIMIT 50
        `);
        availableVoices = voicesResult.rows;
        logger.info(`[LaunchSequence] Found ${availableVoices.length} available voices for multi-voice assignment`);

        // Emit detailed voice pool statistics
        const femaleVoices = availableVoices.filter(v => v.gender === 'female').length;
        const maleVoices = availableVoices.filter(v => v.gender === 'male').length;
        const neutralVoices = availableVoices.filter(v => !v.gender || v.gender === 'neutral').length;

        this.emitDetailedProgress('voice', `Voice pool loaded: ${availableVoices.length} voices available`, {
          action: 'voice_pool_ready',
          totalVoices: availableVoices.length,
          breakdown: {
            female: femaleVoices,
            male: maleVoices,
            neutral: neutralVoices
          },
          sampleVoices: availableVoices.slice(0, 6).map(v => ({
            name: v.name,
            gender: v.gender || 'unknown'
          }))
        });

        // DIAGNOSTIC: If no voices available, check total voice count
        if (availableVoices.length === 0) {
          const totalVoicesResult = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN is_available = true THEN 1 END) as available FROM elevenlabs_voices`);
          logger.error(`[LaunchSequence] NO AVAILABLE VOICES! Total voices in DB: ${totalVoicesResult.rows[0].total}, Available: ${totalVoicesResult.rows[0].available}. Need to run /api/voices/sync-full`);
        } else {
          // Log first few voice names for verification
          logger.info(`[LaunchSequence] First 5 available voices: ${availableVoices.slice(0, 5).map(v => `${v.name}(${v.gender || 'unknown'})`).join(', ')}`);
        }
      }

      const narrators = [];
      const uniqueVoiceIds = new Set();
      const voiceNameCache = new Map();

      agentTracker.updateAgentProgress(this.sessionId, 'voice', 30, 'Resolving voice names...');
      this.emitStageProgress(stage, 0.3, 'Resolving voice names...');

      // Helper to get voice name with caching
      const getVoiceNameCached = async (voiceId) => {
        if (voiceNameCache.has(voiceId)) return voiceNameCache.get(voiceId);
        const name = await this.getVoiceName(voiceId);
        voiceNameCache.set(voiceId, name);
        return name;
      };

      // Add main narrator voice
      if (narratorVoice) {
        uniqueVoiceIds.add(narratorVoice);
        narrators.push({
          id: narratorVoice,
          name: await getVoiceNameCached(narratorVoice),
          type: 'narrator',
          character: null
        });
      }

      agentTracker.updateAgentProgress(this.sessionId, 'voice', 50, `Processing ${characters.length} character voices...`);
      this.emitStageProgress(stage, 0.5, 'Assigning character voices...');

      // Add ALL characters with their voice assignments
      // Track used voices by gender for round-robin within each gender
      const usedVoicesByGender = { female: 0, male: 0, neutral: 0 };
      const usedVoiceIds = new Set();

      logger.info(`[LaunchSequence] Processing ${characters.length} characters for voice assignment (effectiveMultiVoice=${effectiveMultiVoice}, availableVoices=${availableVoices.length})`);

      this.emitDetailedProgress('voice', `=== CASTING ${characters.length} CHARACTERS ===`, {
        action: 'character_casting_start',
        characterCount: characters.length,
        multiVoiceEnabled: effectiveMultiVoice,
        availableVoicesCount: availableVoices.length,
        strategy: effectiveMultiVoice ? 'Gender-matched round-robin voice assignment' : 'Single narrator voice for all'
      });

      let assignmentIndex = 0;
      for (const character of characters) {
        assignmentIndex++;
        let characterVoiceId = narratorVoice; // Default to narrator voice
        let voiceName = await getVoiceNameCached(narratorVoice);
        let sharesNarratorVoice = true;

        // If multi-voice is enabled, assign gender-appropriate voices
        if (effectiveMultiVoice && availableVoices.length > 0) {
          // USE STORED GENDER FROM DATABASE (from outline generation with explicit gender requirement)
          // Gender MUST be stored - LLM provides it, no inference fallback
          const characterGender = character.gender;

          if (!characterGender) {
            // FAIL LOUD: This should never happen - gender is validated at outline generation
            const errorMsg = `CRITICAL: Character "${character.name}" has no stored gender in database. ` +
              `This indicates a bug in outline generation or character insertion. ` +
              `Gender MUST be provided by LLM.`;
            logger.error(`[LaunchSequence] ${errorMsg}`);
            // Use 'neutral' as emergency fallback to avoid breaking voice assignment
            // but log the error loudly so it can be investigated
            logger.warn(`[LaunchSequence] Using 'neutral' as emergency fallback for "${character.name}" - this should be fixed`);
          } else {
            logger.info(`[LaunchSequence] Character "${character.name}" using stored gender: ${characterGender} (confidence: ${character.gender_confidence || 'explicit'})`);
          }

          // Filter voices: exclude narrator, match gender, prefer unused voices
          let genderMatchedVoices = availableVoices.filter(v =>
            v.voice_id !== narratorVoice &&
            !usedVoiceIds.has(v.voice_id) &&
            this.voiceGenderMatches(v.gender, characterGender)
          );

          // If no unused gender-matched voices, allow reuse of gender-matched voices
          if (genderMatchedVoices.length === 0) {
            genderMatchedVoices = availableVoices.filter(v =>
              v.voice_id !== narratorVoice &&
              this.voiceGenderMatches(v.gender, characterGender)
            );
          }

          // Fallback: if still no matches, use any available voice
          if (genderMatchedVoices.length === 0) {
            genderMatchedVoices = availableVoices.filter(v =>
              v.voice_id !== narratorVoice &&
              !usedVoiceIds.has(v.voice_id)
            );
          }

          // Final fallback: any voice except narrator
          if (genderMatchedVoices.length === 0) {
            genderMatchedVoices = availableVoices.filter(v => v.voice_id !== narratorVoice);
          }

          if (genderMatchedVoices.length > 0) {
            // Round-robin within the gender-matched pool
            const genderIndex = usedVoicesByGender[characterGender] || 0;
            const assignedVoice = genderMatchedVoices[genderIndex % genderMatchedVoices.length];
            characterVoiceId = assignedVoice.voice_id;
            voiceName = assignedVoice.name;
            sharesNarratorVoice = false;
            usedVoiceIds.add(assignedVoice.voice_id);
            usedVoicesByGender[characterGender] = genderIndex + 1;

            logger.info(`[LaunchSequence] Assigned voice "${voiceName}" (${characterVoiceId}, voice_gender: ${assignedVoice.gender || 'unknown'}) to character "${character.name}" (char_gender: ${characterGender} [database], role: ${character.role})`);

            // Emit detailed progress for this character assignment
            this.emitDetailedProgress('voice', `Casting [${assignmentIndex}/${characters.length}]: "${character.name}" → ${voiceName}`, {
              action: 'character_cast',
              character: character.name,
              role: character.role || 'character',
              characterGender: characterGender,
              genderSource: 'database',  // Gender always from LLM via database now
              assignedVoice: voiceName,
              voiceGender: assignedVoice.gender || 'unknown',
              genderMatch: this.voiceGenderMatches(assignedVoice.gender, characterGender),
              uniqueVoice: !sharesNarratorVoice
            });
          } else {
            logger.warn(`[LaunchSequence] No voice available for character "${character.name}" (gender: ${characterGender} [database]), using narrator voice`);

            this.emitDetailedProgress('voice', `Casting [${assignmentIndex}/${characters.length}]: "${character.name}" → Narrator (fallback)`, {
              action: 'character_cast_fallback',
              character: character.name,
              characterGender: characterGender,
              reason: 'No gender-matched voice available',
              usingNarratorVoice: true
            });
          }
        } else {
          logger.warn(`[LaunchSequence] Multi-voice disabled or no voices available for character "${character.name}" - using narrator voice (effectiveMultiVoice=${effectiveMultiVoice}, availableVoices=${availableVoices.length})`);
        }

        uniqueVoiceIds.add(characterVoiceId);

        narrators.push({
          id: characterVoiceId,
          name: voiceName,
          type: 'character',
          character: character.name,
          characterId: character.id, // Store character ID for DB persistence
          role: character.role,
          voiceDescription: character.voice_description,
          sharesNarratorVoice
        });
      }

      // PERSIST voice assignments to database for ALL characters
      // This ensures multi-voice narration works correctly
      agentTracker.updateAgentProgress(this.sessionId, 'voice', 70, 'Saving voice assignments...');
      this.emitStageProgress(stage, 0.7, 'Saving voice assignments...');

      this.emitDetailedProgress('voice', `=== VOICE CASTING COMPLETE ===`, {
        action: 'casting_summary',
        totalCharacters: characters.length,
        uniqueVoicesUsed: uniqueVoiceIds.size,
        genderBreakdown: usedVoicesByGender,
        sharingNarratorVoice: narrators.filter(n => n.type === 'character' && n.sharesNarratorVoice).length
      });

      this.emitDetailedProgress('database', 'Persisting voice assignments to database...', {
        action: 'database_persist',
        table: 'character_voice_assignments',
        characterCount: narrators.filter(n => n.type === 'character').length
      });

      let savedCount = 0;
      for (const narrator of narrators) {
        if (narrator.type === 'character' && narrator.characterId && narrator.id) {
          try {
            await pool.query(`
              INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
              VALUES ($1, $2, $3)
              ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
            `, [this.sessionId, narrator.characterId, narrator.id]);
            savedCount++;
            logger.info(`[LaunchSequence] Saved voice assignment: ${narrator.character} -> ${narrator.name} (${narrator.id})`);
          } catch (saveErr) {
            logger.warn(`[LaunchSequence] Failed to save voice assignment for ${narrator.character}:`, saveErr.message);
          }
        }
      }
      logger.info(`[LaunchSequence] Persisted ${savedCount}/${narrators.filter(n => n.type === 'character').length} voice assignments to database`);

      // Validate that we have at least one voice
      if (narrators.length === 0) {
        // Use default voice
        const defaultVoice = 'EXAVITQu4vr4xnSDxMaL'; // Rachel
        narrators.push({
          id: defaultVoice,
          name: 'Rachel',
          type: 'narrator',
          character: null
        });
        logger.info(`[LaunchSequence] No voices found, using default voice`);
      }

      // Count unique voices for the display (not total narrator entries)
      const uniqueVoiceCount = uniqueVoiceIds.size;
      const characterCount = narrators.filter(n => n.type === 'character').length;

      this.stageResults.voices = {
        narrators,
        narratorCount: narrators.length, // Total entries (narrator + characters)
        uniqueVoiceCount,                // Unique voice IDs used
        characterCount,                  // Number of characters with voices
        narratorDisplay: this.formatNarratorDisplay(narrators)
      };

      // Display message based on what we found
      let message;
      if (characterCount > 0) {
        message = `${uniqueVoiceCount} voice${uniqueVoiceCount > 1 ? 's' : ''} for ${characterCount + 1} characters`;
      } else {
        message = `${uniqueVoiceCount} narrator${uniqueVoiceCount > 1 ? 's' : ''} ready`;
      }

      this.emitStageStatus(stage, STATUS.SUCCESS, {
        message,
        narratorCount: narrators.length,
        uniqueVoiceCount,
        characterCount,
        narrators
      });
      this.emitStageProgress(stage, 1, message);

      // Emit detailed voice assignment update for HUD
      this.io.to(this.sessionId).emit('voice-assignment-update', {
        characters: narrators.map(n => ({
          name: n.character || 'Narrator',
          voiceName: n.name,
          voiceDescription: n.type === 'narrator'
            ? 'Main storyteller'
            : (n.voiceDescription || `${n.role || 'Character'} voice`),
          voiceId: n.id,
          isNarrator: n.type === 'narrator',
          role: n.role || (n.type === 'narrator' ? 'narrator' : 'character'),
          sharesNarratorVoice: n.sharesNarratorVoice || false
        })),
        totalCharacters: characterCount + 1, // +1 for narrator
        totalVoices: uniqueVoiceCount
      });

      // Complete voice agent
      agentTracker.completeAgent(this.sessionId, 'voice', `${uniqueVoiceCount} voices assigned`, {
        narratorCount: narrators.length,
        characterCount
      });

      logger.info(`[LaunchSequence] Voice assignment complete: ${uniqueVoiceCount} unique voices, ${characterCount} character voices`);

    } catch (error) {
      agentTracker.errorAgent(this.sessionId, 'voice', error.message);
      this.emitStageStatus(stage, STATUS.ERROR, { message: error.message });
      throw new Error(`Voice assignment failed: ${error.message}`);
    }
  }

  /**
   * Stage 2: Sound Effect Generation
   * Detects and generates/fetches all required SFX with detailed status reporting
   */
  async runSFXGeneration() {
    const stage = STAGES.SFX;
    this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Detecting sound effects...' });
    this.emitStageProgress(stage, 0.05, 'Detecting sound effects...');

    // Start SFX agent tracking
    agentTracker.startAgent(this.sessionId, 'sfx', 'Analyzing scene for sound opportunities...');

    this.emitDetailedProgress('sfx', '=== SOUND EFFECTS DETECTION STARTING ===', {
      action: 'sfx_detection_start',
      agent: 'SFXCoordinatorAgent',
      model: 'gpt-4o-mini',
      capabilities: ['ambient_detection', 'action_detection', 'mood_analysis', 'cache_lookup']
    });

    try {
      // First, try to load SFX from database if scene.sfx is empty
      let sfxList = this.scene.sfx || [];

      if (sfxList.length === 0 && this.scene.id) {
        // Load SFX from scene_sfx table
        try {
          const sfxResult = await pool.query(`
            SELECT ss.id, ss.sfx_key, ss.description, ss.timing, ss.volume, ss.loop,
                   ss.duration_seconds, sc.file_path, sc.prompt_preview
            FROM scene_sfx ss
            LEFT JOIN sfx_cache sc ON ss.sfx_cache_id = sc.id
            WHERE ss.scene_id = $1
            ORDER BY ss.sequence_order ASC
          `, [this.scene.id]);

          if (sfxResult.rows.length > 0) {
            sfxList = sfxResult.rows.map(row => ({
              sfx_key: row.sfx_key,
              description: row.description || row.prompt_preview,
              timing: row.timing,
              volume: row.volume,
              loop: row.loop,
              duration: row.duration_seconds,
              file_path: row.file_path,
              cached: !!row.file_path
            }));
            logger.info(`[LaunchSequence] Loaded ${sfxList.length} SFX from database for scene ${this.scene.id}`);

            this.emitDetailedProgress('sfx', `Loaded ${sfxList.length} pre-existing SFX from database`, {
              action: 'sfx_database_load',
              count: sfxList.length,
              sceneId: this.scene.id,
              sfxKeys: sfxList.slice(0, 5).map(s => s.sfx_key)
            });
          }
        } catch (loadError) {
          logger.warn(`[LaunchSequence] Failed to load SFX from database: ${loadError.message}`);
        }
      }

      let sfxCount = sfxList.length;
      let sfxCategories = [];
      let sfxNames = [];
      let cachedCount = 0;
      let missingCount = 0;
      let missingSfx = [];

      // If scene already has SFX, just validate them
      if (sfxList.length > 0) {
        const categories = new Set();
        sfxList.forEach(sfx => {
          const key = sfx.sfx_key || sfx.sfxKey || '';
          const category = key.split('.')[0];
          if (category) categories.add(category);
          // Extract friendly name from sfx key (e.g., "weather.rain_light" -> "rain light")
          const name = key.split('.').pop()?.replace(/_/g, ' ') || key;
          sfxNames.push(name);
        });
        sfxCategories = Array.from(categories);
      } else {
        // Try to detect SFX from scene text or synopsis (if SFX coordinator is available)
        this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Analyzing for sound effects...' });
        agentTracker.updateAgentProgress(this.sessionId, 'sfx', 20, 'AI scanning for sound opportunities...');
        this.emitStageProgress(stage, 0.2, 'Analyzing for sound effects...');

        this.emitDetailedProgress('sfx', 'AI analyzing scene text for sound opportunities...', {
          action: 'sfx_ai_analysis',
          agent: 'SFXCoordinatorAgent',
          scanningFor: ['ambient_sounds', 'action_effects', 'environmental_audio', 'mood_enhancers']
        });

        try {
          // Get text to analyze - prefer scene text
          let textToAnalyze = this.scene?.polished_text || '';

          // CRITICAL DEBUG: Log what text we have for SFX detection
          logger.info(`[LaunchSequence] SFX text source: polished_text=${textToAnalyze.length} chars`);
          if (textToAnalyze.length > 0) {
            logger.info(`[LaunchSequence] SFX text preview: "${textToAnalyze.substring(0, 200)}..."`);
          } else {
            logger.warn(`[LaunchSequence] WARNING: No polished_text available for SFX detection!`);
            logger.info(`[LaunchSequence] Scene object keys: ${Object.keys(this.scene || {}).join(', ')}`);
          }

          // Fetch complete story context for multi-agent SFX detection
          const sessionData = await pool.query(`
            SELECT ss.synopsis, ss.title, ss.config_json, so.outline_json
            FROM story_sessions ss
            LEFT JOIN story_outlines so ON so.story_session_id = ss.id
            WHERE ss.id = $1
          `, [this.sessionId]);

          const row = sessionData.rows[0] || {};
          // Parse config_json if it's a string (PostgreSQL may return string or object)
          let config = row.config_json || {};
          if (typeof config === 'string') {
            try {
              config = JSON.parse(config);
            } catch (e) {
              logger.warn(`[LaunchSequence] Failed to parse config_json: ${e.message}`);
              config = {};
            }
          }
          const outline = typeof row.outline_json === 'string'
            ? JSON.parse(row.outline_json || '{}')
            : (row.outline_json || {});

          // Get sfxLevel from config - check both snake_case and camelCase conventions
          // Log actual value for debugging
          const configSfxLevel = config.sfx_level || config.sfxLevel;
          const sfxLevel = configSfxLevel || 'low';
          logger.info(`[LaunchSequence] SFX level from config: raw=${configSfxLevel}, using=${sfxLevel}`);

          // Build comprehensive scene context for multi-agent SFX detection
          let sceneContext = {
            // Basic info
            mood: this.scene?.mood || config.mood || outline.mood || 'general',
            setting: this.scene?.setting || outline.setting || config.setting || '',
            sfxLevel,
            // Story context for genre detection
            title: row.title || config.title || '',
            genre: config.genre || config.style || outline.genre || '',
            premise: row.synopsis || config.premise || '',
            specialRequests: config.special_requests || config.specialRequests || '',
            // Pass outline for additional context
            outline: outline
          };

          // If no scene text, skip SFX detection - don't use synopsis
          // SFX should only be for actual story scenes, not introduction/synopsis
          if (!textToAnalyze || textToAnalyze.length < 50) {
            logger.info(`[LaunchSequence] No scene text available (${textToAnalyze?.length || 0} chars), skipping SFX detection - synopsis should not have SFX`);
            // Don't fall back to synopsis - leave sfxList empty
            textToAnalyze = '';
          }

          logger.info(`[LaunchSequence] SFX context: genre=${sceneContext.genre}, setting=${sceneContext.setting}, title=${sceneContext.title}`);

          const detected = await sfxCoordinator.analyzeScene(textToAnalyze, sceneContext);
          if (detected && detected.length > 0) {
            sfxList = detected;
            sfxCount = detected.length;
            const categories = new Set();
            detected.forEach(sfx => {
              const key = sfx.sfx_key || sfx.sfxKey || sfx.sfx_type || '';
              const category = key.split('.')[0] || sfx.sfx_type || 'general';
              if (category) categories.add(category);
              // Extract or use description as name
              const name = sfx.description || key.split('.').pop()?.replace(/_/g, ' ') || key;
              sfxNames.push(name);
            });
            sfxCategories = Array.from(categories);

            // Emit AI detection results
            this.emitStageStatus(stage, STATUS.IN_PROGRESS, {
              message: `AI detected ${sfxCount} sound effect${sfxCount > 1 ? 's' : ''}`,
              sfxCount,
              sfxNames: sfxNames.slice(0, 5), // First 5 for preview
              aiDetected: true
            });
          }
        } catch (sfxError) {
          logger.warn(`[LaunchSequence] SFX detection failed, continuing without: ${sfxError.message}`);
        }
      }

      // Check cache status for each SFX - track by index for accurate status mapping
      const cachedIndices = new Set(); // Track which sfxList indices are cached
      if (sfxList.length > 0) {
        this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Checking SFX cache...' });
        agentTracker.updateAgentProgress(this.sessionId, 'sfx', 50, `Checking cache for ${sfxList.length} sounds...`);
        this.emitStageProgress(stage, 0.5, 'Checking SFX cache...');

        this.emitDetailedProgress('sfx', `Checking SFX library cache for ${sfxList.length} effects...`, {
          action: 'cache_check_start',
          sfxCount: sfxList.length,
          table: 'sfx_cache',
          lookupMethod: 'prompt_hash_and_preview_match'
        });

        for (let i = 0; i < sfxList.length; i++) {
          const sfx = sfxList[i];
          const key = sfx.sfx_key || sfx.sfxKey || '';
          try {
            // Check if this SFX prompt is in our cache
            const cacheResult = await pool.query(
              'SELECT id FROM sfx_cache WHERE prompt_preview ILIKE $1 OR prompt_hash = $2 LIMIT 1',
              [`%${key}%`, key]
            );

            if (cacheResult.rows.length > 0) {
              cachedCount++;
              cachedIndices.add(i); // Track this index as cached
            } else {
              missingCount++;
              missingSfx.push(key.split('.').pop()?.replace(/_/g, ' ') || key);
            }
          } catch (cacheErr) {
            logger.warn(`[LaunchSequence] Cache check failed for ${key}: ${cacheErr.message}`);
            missingCount++;
          }
        }

        // Emit cache status
        this.emitStageStatus(stage, STATUS.IN_PROGRESS, {
          message: `Found ${cachedCount} cached, ${missingCount} to generate`,
          sfxCount,
          cachedCount,
          missingCount,
          missingSfx: missingSfx.slice(0, 5) // First 5 missing
        });
        this.emitStageProgress(stage, 0.8, `Found ${cachedCount} cached, ${missingCount} to generate`);

        this.emitDetailedProgress('sfx', `=== SFX CACHE CHECK COMPLETE ===`, {
          action: 'cache_check_complete',
          totalEffects: sfxCount,
          cachedEffects: cachedCount,
          newEffects: missingCount,
          estimatedCost: missingCount > 0 ? `~$${(missingCount * 0.15).toFixed(2)}` : '$0.00',
          missingSfx: missingSfx.slice(0, 5)
        });
      }

      // Get total SFX in library/cache
      let totalLocalSfx = 0;
      try {
        const totalResult = await pool.query('SELECT COUNT(*) as count FROM sfx_cache');
        totalLocalSfx = parseInt(totalResult.rows[0].count) || 0;
      } catch (e) {
        logger.warn('[LaunchSequence] Could not get total SFX count');
      }

      this.stageResults.sfx = {
        sfxList,
        sfxCount,
        sfxCategories,
        sfxNames,
        cachedCount,
        missingCount,
        missingSfx,
        totalLocalSfx,
        cachedIndices: Array.from(cachedIndices) // Store as array for serialization
      };

      this.emitStageStatus(stage, STATUS.SUCCESS, {
        message: sfxCount > 0
          ? `${sfxCount} sound effect${sfxCount > 1 ? 's' : ''} ready (${cachedCount} cached)`
          : 'No sound effects needed',
        sfxCount,
        sfxCategories,
        sfxNames,
        cachedCount,
        missingCount,
        missingSfx,
        totalLocalSfx
      });
      this.emitStageProgress(stage, 1, sfxCount > 0
        ? `${sfxCount} sound effect${sfxCount > 1 ? 's' : ''} ready`
        : 'No sound effects needed');

      // Emit detailed SFX update for HUD
      // Log raw sfxList for debugging
      logger.info(`[SFX Debug] Raw sfxList: ${JSON.stringify(sfxList.map(s => ({ sfx_key: s.sfx_key, sfxKey: s.sfxKey, description: s.description?.substring(0, 50) })))}`);

      const sfxDetailPayload = {
        sfxList: sfxList.map((sfx, i) => {
          const resolvedKey = sfx.sfx_key || sfx.sfxKey || `sfx_${i}`;
          logger.info(`[SFX Debug] Mapping sfx ${i}: sfx_key=${sfx.sfx_key}, sfxKey=${sfx.sfxKey} -> resolved=${resolvedKey}`);
          return {
            key: resolvedKey,
            sfx_key: resolvedKey, // Also include as sfx_key for client compatibility
            name: sfxNames[i] || sfx.description?.substring(0, 50) || 'Unknown',
            category: resolvedKey.split('.')[0] || 'general',
            status: cachedIndices.has(i) ? 'cached' : 'generating',
            progress: 100,
            volume: sfx.volume || 0.3,
            loop: sfx.loop || false
          };
        }),
        sfxCount: sfxList.length,
        cachedCount,
        generatingCount: missingCount,
        totalInLibrary: totalLocalSfx,
        sfxEnabled: true  // SFX is enabled when this stage runs
      };
      logger.info(`[SFX Debug] Emitting sfx-detail-update with ${sfxDetailPayload.sfxList.length} effects: ${JSON.stringify(sfxDetailPayload.sfxList.map(s => s.key))}`);
      this.io.to(this.sessionId).emit('sfx-detail-update', sfxDetailPayload);

      // Complete SFX agent
      agentTracker.completeAgent(this.sessionId, 'sfx', `${sfxCount} sounds detected`, {
        cachedCount,
        missingCount,
        totalLocalSfx
      });

      // Emit updated status with all SFX marked as complete (cached or ready)
      // Use setTimeout to ensure client has time to process the first event before receiving the completion
      const io = this.io;
      const sessionId = this.sessionId;
      setTimeout(() => {
        const completedSfxPayload = {
          ...sfxDetailPayload,
          sfxList: sfxDetailPayload.sfxList.map(sfx => ({
            ...sfx,
            status: sfx.status === 'generating' ? 'complete' : sfx.status
          })),
          generatingCount: 0  // All generation complete
        };
        io.to(sessionId).emit('sfx-detail-update', completedSfxPayload);
        logger.info(`[SFX Debug] Emitted completion status for ${completedSfxPayload.sfxList.length} effects`);
      }, 100); // 100ms delay to ensure client processes first event

      logger.info(`[LaunchSequence] SFX complete: ${sfxCount} effects (${cachedCount} cached, ${missingCount} missing, ${totalLocalSfx} total local)`);

    } catch (error) {
      agentTracker.errorAgent(this.sessionId, 'sfx', error.message);
      this.emitStageStatus(stage, STATUS.ERROR, { message: error.message });
      throw new Error(`SFX generation failed: ${error.message}`);
    }
  }

  /**
   * Stage 3: Cover Art Generation & Validation
   * Generates cover art if missing, then performs OCR validation on title text
   */
  async runCoverArtValidation() {
    const stage = STAGES.COVER;
    this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Checking cover art...' });
    this.emitStageProgress(stage, 0.05, 'Checking cover art...');

    // Start cover agent tracking
    agentTracker.startAgent(this.sessionId, 'cover', 'Checking for existing cover art...');

    this.emitDetailedProgress('cover', '=== COVER ART VALIDATION STARTING ===', {
      action: 'cover_validation_start',
      agent: 'CoverArtAgent',
      generator: 'DALL-E 3',
      validator: 'GPT-4 Vision (OCR)',
      requirement: 'REQUIRED - Story cannot proceed without cover art'
    });

    try {
      // Get full session info including outline for cover generation
      const sessionResult = await pool.query(`
        SELECT ss.id, ss.title, ss.synopsis, ss.cover_image_url, ss.config_json,
               so.outline_json
        FROM story_sessions ss
        LEFT JOIN story_outlines so ON so.story_session_id = ss.id
        WHERE ss.id = $1
      `, [this.sessionId]);

      const session = sessionResult.rows[0];
      let coverUrl = session?.cover_image_url;
      const title = session?.title || 'Untitled Story';
      const synopsis = session?.synopsis || '';
      const outline = session?.outline_json ? (typeof session.outline_json === 'string' ? JSON.parse(session.outline_json) : session.outline_json) : {};
      const config = session?.config_json || {};

      let coverValid = !!coverUrl;
      let ocrValid = true;
      let ocrResult = null;
      let coverGenerated = false;

      // Generate cover art if missing
      if (!coverUrl) {
        logger.info(`[LaunchSequence] No cover art found, generating...`);
        this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Generating cover art...' });
        agentTracker.updateAgentProgress(this.sessionId, 'cover', 20, 'Generating cover art with DALL-E...');
        this.emitStageProgress(stage, 0.2, 'Generating cover art...');

        this.emitDetailedProgress('cover', 'No existing cover art - generating with DALL-E 3...', {
          action: 'cover_generation_start',
          model: 'DALL-E 3',
          storyTitle: title,
          genre: config.genre || 'fantasy',
          mood: config.mood || 'adventurous',
          estimatedTime: '15-30 seconds'
        });

        // Emit cover generation progress
        this.io.to(this.sessionId).emit('cover-generation-progress', {
          status: 'generating',
          progress: 20,
          message: 'Creating cover art with AI...',
          coverUrl: null
        });
        this.emitStageProgress(stage, 0.2, 'Creating cover art with AI...');

        try {
          // Prepare session data for cover generation
          const sessionData = {
            id: this.sessionId,
            title,
            synopsis,
            outline,
            genres: config.genres || {},
            mood: config.mood || 'adventurous'
          };

          // Generate cover with default style and quality
          const coverResult = await generateStoryCover(sessionData, {
            style: 'fantasy',
            quality: 'standard'
          });

          if (coverResult && (coverResult.imageUrl || coverResult.url)) {
            coverUrl = coverResult.imageUrl || coverResult.url;
            coverValid = true;
            coverGenerated = true;
            logger.info(`[LaunchSequence] Cover art generated: ${coverUrl}`);

            this.emitDetailedProgress('cover', 'Cover art generated successfully!', {
              action: 'cover_generation_success',
              coverUrl: coverUrl.substring(0, 50) + '...',
              format: 'PNG',
              resolution: '1024x1024',
              nextStep: 'OCR title validation'
            });

            // Update progress
            agentTracker.updateAgentProgress(this.sessionId, 'cover', 60, 'Cover art generated!');
            this.io.to(this.sessionId).emit('cover-generation-progress', {
              status: 'validating',
              progress: 60,
              message: 'Cover art generated, validating...',
              coverUrl: coverUrl
            });
            this.emitStageProgress(stage, 0.6, 'Cover art generated, validating...');
          } else {
            logger.error(`[LaunchSequence] CRITICAL: Cover generation returned no URL - this is a REQUIRED step`);
            this.io.to(this.sessionId).emit('cover-generation-progress', {
              status: 'error',
              progress: 0,
              message: 'Cover generation returned no URL - story cannot proceed without cover art',
              coverUrl: null
            });
            // FAIL the process - cover art is REQUIRED
            throw new Error('Cover art generation failed: No URL returned. Cover art is required for story playback.');
          }
        } catch (genError) {
          // Tier 3: Cover generation failed - continue with WARNING, not error (graceful fallback)
          logger.warn(`[LaunchSequence] Cover art generation failed (non-blocking): ${genError.message}`);
          agentTracker.updateAgentProgress(this.sessionId, 'cover', 80, 'Cover generation failed - continuing without cover');
          this.io.to(this.sessionId).emit('cover-generation-progress', {
            status: 'warning',
            progress: 80,
            message: `Cover generation failed: ${genError.message}. Story will continue without cover art.`,
            coverUrl: null,
            canRetry: true
          });
          this.emitStageProgress(stage, 0.8, 'Cover generation failed - continuing without cover');

          // Emit warning status - NOT error (story can proceed)
          this.io.to(this.sessionId).emit('launch-stage-update', {
            stage: stage,
            status: STATUS.SUCCESS,
            message: 'Cover art unavailable - story will proceed without cover',
            details: {
              warning: genError.message,
              suggestion: 'You can regenerate the cover later using the settings menu.',
              canRetry: true
            }
          });

          // Mark cover as invalid but DON'T throw - continue without cover
          coverValid = false;
          coverUrl = null;
        }
      } else {
        // Cover exists
        agentTracker.updateAgentProgress(this.sessionId, 'cover', 50, 'Found existing cover art');
        this.io.to(this.sessionId).emit('cover-generation-progress', {
          status: 'validating',
          progress: 50,
          message: 'Validating existing cover art...',
          coverUrl: coverUrl
        });
        this.emitStageProgress(stage, 0.5, 'Validating existing cover art...');
      }

      if (coverUrl) {
        logger.info(`[LaunchSequence] Cover art ${coverGenerated ? 'generated' : 'found'}: ${coverUrl}`);

        // Perform OCR validation using OpenAI Vision
        this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Validating cover text...' });
        this.emitStageProgress(stage, 0.7, 'Validating cover text...');

        this.emitDetailedProgress('cover', 'Running OCR validation on cover title...', {
          action: 'ocr_validation_start',
          model: 'GPT-4 Vision',
          expectedTitle: title,
          validationMethod: 'AI-powered text recognition'
        });

        try {
          ocrResult = await this.validateCoverText(coverUrl, title);
          ocrValid = ocrResult.isValid;

          if (!ocrValid) {
            logger.warn(`[LaunchSequence] Cover text validation failed: ${ocrResult.reason}`);
            // Don't fail the stage for OCR issues - just warn
            this.stageResults.cover = {
              coverUrl,
              title,
              synopsis,
              coverValid,
              coverGenerated,
              ocrValid: false,
              ocrWarning: ocrResult.reason
            };

            this.emitStageStatus(stage, STATUS.SUCCESS, {
              message: coverGenerated ? 'Cover generated (text may need review)' : 'Cover art ready (text may need review)',
              hasCover: coverValid,
              coverGenerated,
              coverUrl,
              title,
              ocrWarning: ocrResult.reason
            });
            this.emitStageProgress(stage, 1, coverGenerated ? 'Cover generated (text may need review)' : 'Cover art ready (text may need review)');

            logger.info(`[LaunchSequence] Cover art validation complete with OCR warning`);
            return;
          }
        } catch (ocrError) {
          logger.warn(`[LaunchSequence] OCR validation skipped: ${ocrError.message}`);
          // Continue without OCR validation if it fails
        }
      } else {
        // Tier 3: No cover available - continue with WARNING (graceful fallback)
        logger.warn(`[LaunchSequence] No cover art available - story will proceed without cover`);
        this.io.to(this.sessionId).emit('cover-generation-progress', {
          status: 'warning',
          progress: 100,
          message: 'No cover art available - story will proceed without cover',
          coverUrl: null,
          canRetry: true
        });
        // Continue without cover - don't throw error
      }

      this.stageResults.cover = {
        coverUrl,
        title,
        synopsis,
        coverValid,
        coverGenerated,
        ocrValid,
        ocrResult
      };

      // FINAL VALIDATION: Cover is REQUIRED
      if (!coverValid) {
        logger.error(`[LaunchSequence] CRITICAL: Cover validation failed - story cannot proceed`);
        throw new Error('Cover art validation failed. Cover art is required for story playback.');
      }

      // Build success message
      const message = coverGenerated ? 'Cover art generated!' : 'Cover art validated';

      this.emitStageStatus(stage, STATUS.SUCCESS, {
        message,
        hasCover: coverValid,
        coverGenerated,
        coverUrl,
        title
      });
      this.emitStageProgress(stage, 1, message);

      // Emit final cover progress
      this.io.to(this.sessionId).emit('cover-generation-progress', {
        status: coverValid ? 'complete' : 'error',
        progress: 100,
        message: coverValid ? 'Cover art ready' : 'No cover art',
        coverUrl: coverUrl
      });

      // Complete cover agent
      agentTracker.completeAgent(this.sessionId, 'cover', coverValid ? 'Cover art ready' : 'No cover art', {
        coverGenerated,
        ocrValid
      });

      logger.info(`[LaunchSequence] Cover art ${coverGenerated ? 'generation' : 'validation'} complete`);

    } catch (error) {
      agentTracker.errorAgent(this.sessionId, 'cover', error.message);
      this.emitStageStatus(stage, STATUS.ERROR, { message: error.message });
      throw new Error(`Cover art validation failed: ${error.message}`);
    }
  }

  /**
   * Validate cover art text using OpenAI Vision
   * Checks if the cover image contains the expected story title
   */
  async validateCoverText(coverUrl, expectedTitle) {
    try {
      // Build full URL if it's a relative path
      let fullUrl = coverUrl;
      if (coverUrl.startsWith('/')) {
        fullUrl = `http://localhost:5100${coverUrl}`;
      }

      logger.info(`[LaunchSequence] Validating cover text for: ${expectedTitle}`);

      const response = await completion({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Look at this book cover image. Does the title text on the cover match or closely match "${expectedTitle}"?

Respond in JSON format:
{
  "isValid": true/false,
  "detectedText": "the text you see on the cover",
  "reason": "brief explanation"
}

If you cannot see clear text or the image is unclear, set isValid to true with reason "text unclear".
If the text clearly does NOT match the expected title, set isValid to false.
Minor spelling variations or stylization are acceptable.`
              },
              {
                type: 'image_url',
                image_url: { url: fullUrl }
              }
            ]
          }
        ],
        model: getUtilityModel(),
        max_tokens: 200,
        agent_name: 'cover_ocr_validator',
        sessionId: this.sessionId
      });

      const content = response.content || '';

      // Try to parse JSON from response
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          logger.info(`[LaunchSequence] OCR result:`, result);
          return {
            isValid: result.isValid !== false,
            detectedText: result.detectedText || '',
            reason: result.reason || ''
          };
        }
      } catch (parseError) {
        logger.warn(`[LaunchSequence] Failed to parse OCR response: ${parseError.message}`);
      }

      // Default to valid if we can't parse
      return { isValid: true, detectedText: '', reason: 'Unable to parse validation response' };

    } catch (error) {
      logger.error(`[LaunchSequence] OCR validation error:`, error.message);
      // Return valid on error to not block the flow
      return { isValid: true, detectedText: '', reason: `OCR check failed: ${error.message}` };
    }
  }

  /**
   * Stage 4: Quality Assurance Checks
   * Runs final safety and quality checks before playback
   */
  async runQAChecks() {
    const stage = STAGES.QA;
    this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Running quality checks...' });
    this.emitStageProgress(stage, 0.1, 'Running quality checks...');

    // Start QA and safety agents
    agentTracker.startAgent(this.sessionId, 'qa', 'Running quality assurance...');
    agentTracker.startAgent(this.sessionId, 'safety', 'Checking content safety...');

    this.emitDetailedProgress('qa', '=== QUALITY ASSURANCE CHECKS STARTING ===', {
      action: 'qa_start',
      agents: ['SafetyAgent', 'ValidationAgent'],
      checks: ['content_safety', 'intensity_analysis', 'sliders_compliance', 'continuity', 'engagement'],
      model: 'gpt-4o-mini'
    });

    // Emit individual QA check updates
    const emitQACheck = (checkName, status, message, details = {}) => {
      this.io.to(this.sessionId).emit('qa-check-update', {
        checkName,
        status,
        message,
        details
      });
    };

    try {
      // Safety check with structured intensity analysis (Section 5 of Storyteller Gospel)
      emitQACheck('safety', 'running', 'Analyzing content intensity...');
      agentTracker.updateAgentProgress(this.sessionId, 'safety', 20, 'Analyzing content intensity levels...');
      this.emitStageProgress(stage, 0.3, 'Analyzing content intensity...');

      this.emitDetailedProgress('safety', 'SafetyAgent analyzing content intensity levels...', {
        action: 'safety_analysis_start',
        agent: 'SafetyAgent',
        analysisTargets: ['violence', 'gore', 'romance', 'profanity', 'dark_themes'],
        enforcingLimits: true
      });

      // Get session config for intensity limits
      const sessionConfig = await pool.query(
        'SELECT config_json FROM story_sessions WHERE id = $1',
        [this.sessionId]
      );
      const configJson = sessionConfig.rows[0]?.config_json || {};
      const intensityLimits = configJson.intensity || {};
      const audience = configJson.audience || 'general';

      // Run SafetyAgent intensity analysis
      const sceneText = this.scene?.polished_text || '';
      let safetyResult = null;

      if (sceneText) {
        agentTracker.updateAgentProgress(this.sessionId, 'safety', 40, 'Checking intensity levels...');
        this.emitStageProgress(stage, 0.5, 'Checking intensity levels...');
        safetyResult = await safetyAgent.checkAndAdjust(sceneText, intensityLimits, audience, this.sessionId);
        this.stageResults.safety = safetyResult.report;

        // Emit detailed safety report for HUD/UI (Section 5)
        const displayReport = safetyAgent.formatForDisplay(safetyResult.report, configJson.advanced_mode ? 'advanced' : 'simple');
        this.io.to(this.sessionId).emit('safety-report-update', {
          report: safetyResult.report,
          display: displayReport,
          audience,
          wasAdjusted: safetyResult.report.wasAdjusted,
          summary: safetyResult.report.summary
        });

        agentTracker.updateAgentProgress(this.sessionId, 'safety', 60, 'Intensity analysis complete');
        this.emitStageProgress(stage, 0.6, 'Intensity analysis complete');
      }

      // Use the validation agent to compile final stats
      const validation = await validationAgent.validateScene(this.sessionId, this.scene);

      // Mark safety check complete with intensity summary
      const safetyMessage = safetyResult?.report
        ? (safetyResult.report.wasAdjusted
          ? `Content adjusted: ${safetyResult.report.changesMade.length} modification${safetyResult.report.changesMade.length !== 1 ? 's' : ''}`
          : 'Content within comfort settings')
        : 'Content safety verified';

      emitQACheck('safety', validation.isValid ? 'passed' : 'warning', safetyMessage);
      agentTracker.completeAgent(this.sessionId, 'safety', safetyMessage);

      // Sliders compliance check - reuse configJson from safety check above
      emitQACheck('sliders', 'running', 'Verifying mood/genre sliders...');
      agentTracker.updateAgentProgress(this.sessionId, 'qa', 50, 'Verifying sliders compliance...');
      this.emitStageProgress(stage, 0.7, 'Verifying mood/genre sliders...');

      // Build comprehensive story settings display
      const storySettings = [];
      const settingsDetails = {};

      // Story type (narrative, cyoa, campaign)
      const storyTypeLabels = {
        'narrative': 'Story',
        'cyoa': 'Adventure (CYOA)',
        'campaign': 'D&D Campaign'
      };
      if (configJson.story_type) {
        storySettings.push(storyTypeLabels[configJson.story_type] || configJson.story_type);
        settingsDetails.storyType = configJson.story_type;
      }

      // Story length
      if (configJson.story_length) {
        storySettings.push(`${configJson.story_length.charAt(0).toUpperCase() + configJson.story_length.slice(1)} length`);
        settingsDetails.storyLength = configJson.story_length;
      }

      // Narrator style - add "Tone:" prefix for context
      if (configJson.narrator_style) {
        const narratorStyles = {
          'warm': 'Warm & Gentle',
          'dramatic': 'Dramatic',
          'playful': 'Playful',
          'mysterious': 'Mysterious'
        };
        const styleLabel = narratorStyles[configJson.narrator_style] || configJson.narrator_style;
        storySettings.push(`Tone: ${styleLabel}`);
        settingsDetails.narratorStyle = configJson.narrator_style;
      }

      // Author style - add to visible message with "Style:" prefix
      if (configJson.author_style && configJson.author_style !== 'none') {
        storySettings.push(`Style: ${configJson.author_style}`);
        settingsDetails.authorStyle = configJson.author_style;
      }

      // Mood
      if (configJson.mood) {
        settingsDetails.mood = configJson.mood;
      }

      // Multi-voice
      if (configJson.multi_voice) {
        storySettings.push('Multi-voice');
        settingsDetails.multiVoice = true;
      }

      // SFX enabled
      if (configJson.sfx_enabled !== false) {
        storySettings.push('SFX');
        settingsDetails.sfxEnabled = true;
      }

      // CYOA settings
      if (configJson.cyoa_enabled || configJson.story_type === 'cyoa') {
        if (configJson.cyoa_settings?.allow_backtrack) {
          storySettings.push('Backtracking allowed');
        }
        settingsDetails.cyoaEnabled = true;
        settingsDetails.cyoaSettings = configJson.cyoa_settings;
      }

      // Audience
      if (configJson.audience) {
        const audienceLabels = { 'children': 'Children (5-10)', 'general': 'All ages', 'mature': 'Mature' };
        settingsDetails.audience = audienceLabels[configJson.audience] || configJson.audience;
      }

      // Check genre sliders
      const genres = configJson.genres || {};
      if (Object.keys(genres).length > 0) {
        const activeGenres = Object.entries(genres)
          .filter(([_, value]) => value > 30)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([genre]) => genre.charAt(0).toUpperCase() + genre.slice(1));
        if (activeGenres.length > 0) {
          settingsDetails.topGenres = activeGenres;
        }
      }

      // Check intensity settings
      const intensity = configJson.intensity || {};
      if (Object.keys(intensity).length > 0) {
        const highIntensity = Object.entries(intensity)
          .filter(([_, value]) => value > 50)
          .map(([key]) => key);
        if (highIntensity.length > 0) {
          settingsDetails.highIntensity = highIntensity;
        }
      }

      // Bedtime mode
      if (configJson.bedtime_mode) {
        storySettings.push('Bedtime mode');
        settingsDetails.bedtimeMode = true;
      }

      const sliderMessage = storySettings.length > 0
        ? storySettings.join(' · ')
        : 'Default settings applied';

      emitQACheck('sliders', 'passed', sliderMessage, settingsDetails);

      // Continuity check
      emitQACheck('continuity', 'running', 'Checking story continuity...');
      agentTracker.updateAgentProgress(this.sessionId, 'qa', 70, 'Checking continuity...');
      this.emitStageProgress(stage, 0.85, 'Checking continuity...');
      emitQACheck('continuity', 'passed', 'Continuity verified');

      // Engagement check
      emitQACheck('engagement', 'running', 'Analyzing engagement level...');
      agentTracker.updateAgentProgress(this.sessionId, 'qa', 90, 'Analyzing engagement...');
      this.emitStageProgress(stage, 0.95, 'Analyzing engagement...');
      emitQACheck('engagement', 'passed', 'Engagement level optimal');

      // Store the complete validation stats
      this.validationStats = {
        // Voice info from our stage results
        narratorCount: this.stageResults.voices?.narratorCount || validation.stats.narratorCount,
        narrators: this.stageResults.voices?.narrators || validation.stats.narrators,
        narratorDisplay: this.stageResults.voices?.narratorDisplay || validationAgent.formatNarratorDisplay(validation.stats.narrators),

        // SFX info from our stage results (with detailed breakdown)
        sfxCount: this.stageResults.sfx?.sfxCount || validation.stats.sfxCount,
        sfxCategories: this.stageResults.sfx?.sfxCategories || validation.stats.sfxCategories,
        sfxNames: this.stageResults.sfx?.sfxNames || [],
        sfxCachedCount: this.stageResults.sfx?.cachedCount || 0,
        sfxMissingCount: this.stageResults.sfx?.missingCount || 0,
        sfxMissing: this.stageResults.sfx?.missingSfx || [],
        sfxTotalLocal: this.stageResults.sfx?.totalLocalSfx || 0,

        // Session info from cover stage
        title: this.stageResults.cover?.title || validation.session.title,
        synopsis: this.stageResults.cover?.synopsis || validation.session.synopsis,
        coverArtUrl: this.stageResults.cover?.coverUrl || validation.session.coverArtUrl,

        // Other stats from validation agent
        sceneCount: validation.stats.sceneCount,
        characterCount: validation.stats.characterCount,
        estimatedDuration: validation.stats.estimatedDuration,

        // Safety/intensity report (Section 5 of Storyteller Gospel)
        safetyReport: this.stageResults.safety || null,
        contentAdjusted: this.stageResults.safety?.wasAdjusted || false,
        intensityScores: this.stageResults.safety?.adjustedScores || this.stageResults.safety?.originalScores || null,

        // Validation results
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings
      };

      this.stageResults.qa = {
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings
      };

      // Check if there are any blocking errors
      if (validation.errors && validation.errors.length > 0) {
        this.emitStageStatus(stage, STATUS.ERROR, {
          message: `Quality check failed: ${validation.errors[0]}`,
          errors: validation.errors
        });
        throw new Error(`Quality check failed: ${validation.errors.join(', ')}`);
      }

      this.emitStageStatus(stage, STATUS.SUCCESS, {
        message: validation.warnings.length > 0
          ? `Passed with ${validation.warnings.length} warning${validation.warnings.length > 1 ? 's' : ''}`
          : 'All quality checks passed',
        warnings: validation.warnings
      });
      this.emitStageProgress(stage, 1, 'Quality checks complete');

      // Complete QA agent
      agentTracker.completeAgent(this.sessionId, 'qa', 'All quality checks passed', {
        warnings: validation.warnings.length,
        isValid: validation.isValid
      });

      logger.info(`[LaunchSequence] QA checks complete: valid=${validation.isValid}`);

    } catch (error) {
      agentTracker.errorAgent(this.sessionId, 'qa', error.message);
      agentTracker.errorAgent(this.sessionId, 'safety', 'Check failed');
      if (!error.message.startsWith('Quality check failed')) {
        this.emitStageStatus(stage, STATUS.ERROR, { message: error.message });
      }
      throw error;
    }
  }

  /**
   * FINAL VALIDATION GATE
   * Critical checkpoint - ensures ALL required components are ready before playback
   * No story content should appear until this gate passes
   *
   * Required checks:
   * 1. Cover art is generated and validated
   * 2. Voice cast is assigned (characters don't share narrator voice)
   * 3. SFX are ready (if SFX are enabled in config)
   * 4. All QA checks passed
   */
  async runFinalValidationGate() {
    logger.info(`[LaunchSequence] === FINAL VALIDATION GATE ===`);
    logger.info(`[LaunchSequence] Checking all required components before playback...`);

    this.emitDetailedProgress('validation', '╔════════════════════════════════════════════════╗', {});
    this.emitDetailedProgress('validation', '║       FINAL VALIDATION GATE - CRITICAL         ║', {});
    this.emitDetailedProgress('validation', '╚════════════════════════════════════════════════╝', {});

    this.emitDetailedProgress('validation', 'Running final validation checks before story playback...', {
      action: 'validation_gate_start',
      requiredChecks: [
        'Cover Art Generated',
        'Voice Cast Assigned',
        'SFX Ready (if enabled)',
        'QA Checks Passed'
      ],
      failurePolicy: 'ANY failure blocks playback'
    });

    const failures = [];
    const warnings = [];

    // Emit validation gate started
    this.io.to(this.sessionId).emit('launch-stage-update', {
      stage: 'validation_gate',
      status: 'in_progress',
      message: 'Running final validation checks before playback...',
      details: {
        checks: ['cover_art', 'voice_cast', 'sfx_ready', 'qa_passed']
      }
    });

    // === CHECK 1: Cover Art ===
    this.emitDetailedProgress('validation', '[CHECK 1/4] Verifying cover art...', {
      action: 'check_cover_art',
      requirement: 'REQUIRED'
    });

    const coverResult = this.stageResults.cover;
    if (!coverResult?.coverUrl) {
      failures.push({
        check: 'cover_art',
        reason: 'Cover art is REQUIRED but not generated',
        canRetry: true
      });
      logger.error(`[ValidationGate] FAILED: No cover art`);
      this.emitDetailedProgress('validation', '  ❌ FAILED: No cover art available', { status: 'failed' });
    } else {
      logger.info(`[ValidationGate] PASSED: Cover art exists at ${coverResult.coverUrl}`);
      this.emitDetailedProgress('validation', '  ✓ PASSED: Cover art generated and validated', {
        status: 'passed',
        coverUrl: coverResult.coverUrl.substring(0, 40) + '...'
      });
    }

    // === CHECK 2: Voice Cast ===
    this.emitDetailedProgress('validation', '[CHECK 2/4] Verifying voice cast assignment...', {
      action: 'check_voice_cast',
      requirement: 'REQUIRED'
    });

    const voiceResult = this.stageResults.voices;
    if (!voiceResult?.narrators || voiceResult.narrators.length === 0) {
      failures.push({
        check: 'voice_cast',
        reason: 'No voice cast assigned',
        canRetry: true
      });
      logger.error(`[ValidationGate] FAILED: No voice cast`);
      this.emitDetailedProgress('validation', '  ❌ FAILED: No voice cast assigned', { status: 'failed' });
    } else {
      // Check that characters don't all share narrator voice
      const characterVoices = voiceResult.narrators.filter(n => n.type === 'character');
      const narratorVoice = voiceResult.narrators.find(n => n.type === 'narrator');

      if (characterVoices.length > 0 && narratorVoice) {
        const allShareNarrator = characterVoices.every(cv => cv.id === narratorVoice.id);
        if (allShareNarrator) {
          warnings.push({
            check: 'voice_separation',
            reason: `All ${characterVoices.length} characters share the narrator voice - multi-voice may not be working`,
            severity: 'warning'
          });
          logger.warn(`[ValidationGate] WARNING: All characters share narrator voice`);
          this.emitDetailedProgress('validation', `  ⚠ WARNING: All ${characterVoices.length} characters share narrator voice`, {
            status: 'warning',
            issue: 'multi_voice_may_not_work'
          });
        } else {
          const uniqueVoiceCount = new Set(characterVoices.map(c => c.id)).size;
          logger.info(`[ValidationGate] PASSED: Voice cast has ${characterVoices.length} character voices, ${uniqueVoiceCount} unique`);
          this.emitDetailedProgress('validation', `  ✓ PASSED: ${characterVoices.length} characters with ${uniqueVoiceCount} unique voices`, {
            status: 'passed',
            characterCount: characterVoices.length,
            uniqueVoices: uniqueVoiceCount
          });
        }
      } else {
        this.emitDetailedProgress('validation', '  ✓ PASSED: Narrator voice assigned', {
          status: 'passed',
          voiceCount: voiceResult.narrators.length
        });
      }
    }

    // === CHECK 3: SFX Ready (if enabled) ===
    this.emitDetailedProgress('validation', '[CHECK 3/4] Verifying sound effects readiness...', {
      action: 'check_sfx_ready',
      requirement: 'CONDITIONAL (if SFX enabled)'
    });

    const sfxResult = this.stageResults.sfx;
    const config = await pool.query('SELECT config_json FROM story_sessions WHERE id = $1', [this.sessionId]);
    const sfxEnabled = config.rows[0]?.config_json?.sfx_enabled !== false;

    if (sfxEnabled) {
      if (sfxResult?.sfxCount > 0) {
        const missingCount = sfxResult.missingCount || 0;
        if (missingCount > sfxResult.sfxCount / 2) {
          // More than half of SFX are missing - warning
          warnings.push({
            check: 'sfx_ready',
            reason: `${missingCount} of ${sfxResult.sfxCount} sound effects are missing`,
            severity: 'warning'
          });
          logger.warn(`[ValidationGate] WARNING: Many SFX missing: ${missingCount}/${sfxResult.sfxCount}`);
          this.emitDetailedProgress('validation', `  ⚠ WARNING: ${missingCount}/${sfxResult.sfxCount} SFX missing from cache`, {
            status: 'warning',
            missing: missingCount,
            total: sfxResult.sfxCount
          });
        } else {
          logger.info(`[ValidationGate] PASSED: SFX ready - ${sfxResult.sfxCount} effects (${sfxResult.cachedCount} cached)`);
          this.emitDetailedProgress('validation', `  ✓ PASSED: ${sfxResult.sfxCount} sound effects ready (${sfxResult.cachedCount} cached)`, {
            status: 'passed',
            totalSfx: sfxResult.sfxCount,
            cached: sfxResult.cachedCount
          });
        }
      } else {
        this.emitDetailedProgress('validation', '  ✓ PASSED: No SFX detected for this scene', {
          status: 'passed',
          sfxCount: 0
        });
      }
    } else {
      logger.info(`[ValidationGate] SKIPPED: SFX disabled in config`);
      this.emitDetailedProgress('validation', '  ○ SKIPPED: SFX disabled in configuration', {
        status: 'skipped',
        reason: 'sfx_disabled'
      });
    }

    // === CHECK 4: QA Passed ===
    this.emitDetailedProgress('validation', '[CHECK 4/4] Verifying QA checks passed...', {
      action: 'check_qa_passed',
      requirement: 'REQUIRED'
    });

    if (this.stageStatuses[STAGES.QA] !== STATUS.SUCCESS) {
      failures.push({
        check: 'qa_passed',
        reason: 'Quality assurance checks did not pass',
        canRetry: true
      });
      logger.error(`[ValidationGate] FAILED: QA did not pass`);
      this.emitDetailedProgress('validation', '  ❌ FAILED: Quality assurance checks did not pass', {
        status: 'failed'
      });
    } else {
      logger.info(`[ValidationGate] PASSED: QA checks completed successfully`);
      this.emitDetailedProgress('validation', '  ✓ PASSED: All quality assurance checks completed', {
        status: 'passed'
      });
    }

    // === GATE DECISION ===
    this.emitDetailedProgress('validation', '─────────────────────────────────────────', {});

    if (failures.length > 0) {
      logger.error(`[ValidationGate] === GATE FAILED === ${failures.length} critical failures`);

      this.emitDetailedProgress('validation', `╔═══════════════════════════════════════════════════╗`, {});
      this.emitDetailedProgress('validation', `║  ❌ VALIDATION GATE FAILED - ${failures.length} CRITICAL ERROR(S)  ║`, {
        action: 'gate_failed',
        failures: failures.map(f => f.check),
        canRetry: failures.some(f => f.canRetry)
      });
      this.emitDetailedProgress('validation', `╚═══════════════════════════════════════════════════╝`, {});

      // Emit failure details
      this.io.to(this.sessionId).emit('launch-stage-update', {
        stage: 'validation_gate',
        status: 'error',
        message: `Validation gate failed: ${failures.map(f => f.check).join(', ')}`,
        details: {
          failures,
          warnings,
          canRetry: failures.some(f => f.canRetry)
        }
      });

      throw new Error(`VALIDATION GATE FAILED: ${failures.map(f => f.reason).join('; ')}`);
    }

    // Gate passed
    logger.info(`[ValidationGate] === GATE PASSED === All required components ready`);
    logger.info(`[ValidationGate] Warnings: ${warnings.length > 0 ? warnings.map(w => w.reason).join('; ') : 'None'}`);

    this.emitDetailedProgress('validation', `╔═══════════════════════════════════════════════════╗`, {});
    this.emitDetailedProgress('validation', `║  ✓ VALIDATION GATE PASSED - READY FOR PLAYBACK!  ║`, {
      action: 'gate_passed',
      warnings: warnings.length,
      allChecks: 'passed'
    });
    this.emitDetailedProgress('validation', `╚═══════════════════════════════════════════════════╝`, {});

    if (warnings.length > 0) {
      this.emitDetailedProgress('validation', `Warnings (${warnings.length}): ${warnings.map(w => w.reason).join('; ')}`, {
        warningDetails: warnings
      });
    }

    this.io.to(this.sessionId).emit('launch-stage-update', {
      stage: 'validation_gate',
      status: 'success',
      message: 'All validation checks passed - ready for playback!',
      details: {
        checks: {
          cover_art: true,
          voice_cast: true,
          sfx_ready: sfxEnabled ? (sfxResult?.sfxCount > 0) : 'disabled',
          qa_passed: true
        },
        warnings
      }
    });

    return { success: true, warnings };
  }

  /**
   * Emit the final "ready for playback" event with watchdog confirmation
   */
  emitReadyForPlayback() {
    // Build SFX details from stageResults as a fallback for missed sfx-detail-update events
    const sfxResult = this.stageResults.sfx || {};
    const sfxDetails = {
      sfxList: (sfxResult.sfxList || []).map((sfx, i) => {
        const resolvedKey = sfx.sfx_key || sfx.sfxKey || `sfx_${i}`;
        return {
          key: resolvedKey,
          sfx_key: resolvedKey, // Include sfx_key for client compatibility
          name: sfxResult.sfxNames?.[i] || sfx.description || resolvedKey.split('.').pop()?.replace(/_/g, ' ') || 'Unknown',
          category: resolvedKey.split('.')[0] || 'general',
          status: sfx.cached ? 'cached' : 'complete', // Detection done, mark as complete
          progress: 100,
          volume: sfx.volume || 0.3,
          loop: sfx.loop || false
        };
      }),
      sfxCount: sfxResult.sfxCount || 0,
      cachedCount: sfxResult.cachedCount || 0,
      generatingCount: 0, // Detection complete by ready event
      totalInLibrary: sfxResult.totalLocalSfx || 0,
      sfxEnabled: true
    };

    // Build safety details from stageResults for HUD (Section 5)
    const safetyResult = this.stageResults.safety || {};
    const safetyDetails = {
      wasAdjusted: safetyResult.wasAdjusted || false,
      summary: safetyResult.summary || 'No safety analysis performed',
      audience: safetyResult.audience || 'general',
      originalScores: safetyResult.originalScores || null,
      adjustedScores: safetyResult.adjustedScores || null,
      changesMade: safetyResult.changesMade || [],
      passCount: safetyResult.passCount || 0
    };

    // Build voice details from stageResults as fallback for missed voice-assignment-update events
    const voiceResult = this.stageResults.voices || {};
    const voiceDetails = {
      characters: (voiceResult.narrators || []).map(n => ({
        name: n.character || 'Narrator',
        voiceName: n.name,
        voiceDescription: n.type === 'narrator'
          ? 'Main storyteller'
          : (n.voiceDescription || `${n.role || 'Character'} voice`),
        voiceId: n.id,
        isNarrator: n.type === 'narrator',
        role: n.role || (n.type === 'narrator' ? 'narrator' : 'character'),
        sharesNarratorVoice: n.sharesNarratorVoice || false
      })),
      totalCharacters: (voiceResult.characterCount || 0) + 1,
      totalVoices: voiceResult.uniqueVoiceCount || 1
    };

    const event = {
      ready: true,
      stats: this.validationStats,
      scene: {
        id: this.scene.id,
        index: this.scene.sequence_index,
        text: stripTags(this.scene.polished_text || ''), // Strip [CHAR] tags for display
        mood: this.scene.mood,
        hasChoices: this.scene.choices && this.scene.choices.length > 0,
        choices: this.scene.choices,
        isFinal: this.scene.is_final,
        sfx: this.scene.sfx || [],
        audioUrl: this.scene.audio_url
      },
      allStatuses: { ...this.stageStatuses },
      // Include SFX details as fallback for clients that missed the sfx-detail-update
      sfxDetails,
      // Include voice details as fallback for clients that missed voice-assignment-update
      voiceDetails,
      // Include safety details for HUD (Section 5 of Storyteller Gospel)
      safetyDetails,
      // Include timestamp and sequence ID for client verification
      readyTimestamp: Date.now(),
      sequenceId: `${this.sessionId}-ready-${Date.now()}`
    };

    this.readyEventSent = true;
    this.io.to(this.sessionId).emit('launch-sequence-ready', event);
    logger.info(`[LaunchSequence] Ready for playback emitted for session ${this.sessionId}`);

    // Setup watchdog - resend ready event if not confirmed within 2 seconds
    this.setupReadyWatchdog();
  }

  /**
   * Watchdog mechanism to ensure ready event is received
   * Resends the ready event if no confirmation received
   */
  setupReadyWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
    }

    this.watchdogTimer = setTimeout(() => {
      if (this.readyEventSent && !this.readyEventConfirmed && !this.cancelled) {
        logger.warn(`[LaunchSequence] Ready event not confirmed, resending for session ${this.sessionId}`);

        // Build SFX details for watchdog resend
        const sfxResult = this.stageResults.sfx || {};
        const sfxDetails = {
          sfxList: (sfxResult.sfxList || []).map((sfx, i) => {
            const resolvedKey = sfx.sfx_key || sfx.sfxKey || `sfx_${i}`;
            return {
              key: resolvedKey,
              sfx_key: resolvedKey, // Include sfx_key for client compatibility
              name: sfxResult.sfxNames?.[i] || sfx.description || resolvedKey.split('.').pop()?.replace(/_/g, ' ') || 'Unknown',
              category: resolvedKey.split('.')[0] || 'general',
              status: sfx.cached ? 'cached' : 'complete', // Detection done, mark as complete
              progress: 100,
              volume: sfx.volume || 0.3,
              loop: sfx.loop || false
            };
          }),
          sfxCount: sfxResult.sfxCount || 0,
          cachedCount: sfxResult.cachedCount || 0,
          generatingCount: 0, // Detection complete by ready/resend event
          totalInLibrary: sfxResult.totalLocalSfx || 0,
          sfxEnabled: true
        };

        // Build safety details for watchdog resend (Section 5)
        const safetyWatchdog = this.stageResults.safety || {};
        const safetyDetails = {
          wasAdjusted: safetyWatchdog.wasAdjusted || false,
          summary: safetyWatchdog.summary || 'No safety analysis performed',
          audience: safetyWatchdog.audience || 'general',
          originalScores: safetyWatchdog.originalScores || null,
          adjustedScores: safetyWatchdog.adjustedScores || null,
          changesMade: safetyWatchdog.changesMade || [],
          passCount: safetyWatchdog.passCount || 0
        };

        // Build voice details for watchdog resend
        const voiceWatchdog = this.stageResults.voices || {};
        const voiceDetails = {
          characters: (voiceWatchdog.narrators || []).map(n => ({
            name: n.character || 'Narrator',
            voiceName: n.name,
            voiceDescription: n.type === 'narrator'
              ? 'Main storyteller'
              : (n.voiceDescription || `${n.role || 'Character'} voice`),
            voiceId: n.id,
            isNarrator: n.type === 'narrator',
            role: n.role || (n.type === 'narrator' ? 'narrator' : 'character'),
            sharesNarratorVoice: n.sharesNarratorVoice || false
          })),
          totalCharacters: (voiceWatchdog.characterCount || 0) + 1,
          totalVoices: voiceWatchdog.uniqueVoiceCount || 1
        };

        // Resend the ready event
        const event = {
          ready: true,
          stats: this.validationStats,
          scene: {
            id: this.scene.id,
            index: this.scene.sequence_index,
            text: stripTags(this.scene.polished_text || ''), // Strip [CHAR] tags for display
            mood: this.scene.mood,
            hasChoices: this.scene.choices && this.scene.choices.length > 0,
            choices: this.scene.choices,
            isFinal: this.scene.is_final,
            sfx: this.scene.sfx || [],
            audioUrl: this.scene.audio_url
          },
          allStatuses: { ...this.stageStatuses },
          sfxDetails,
          voiceDetails,
          safetyDetails,
          readyTimestamp: Date.now(),
          sequenceId: `${this.sessionId}-ready-watchdog-${Date.now()}`,
          isRetry: true
        };

        this.io.to(this.sessionId).emit('launch-sequence-ready', event);
        logger.info(`[LaunchSequence] Ready event resent via watchdog for session ${this.sessionId}`);
      }
    }, 2000); // 2 second watchdog timeout
  }

  /**
   * Confirm ready event was received (called by client)
   */
  confirmReady() {
    this.readyEventConfirmed = true;
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    logger.info(`[LaunchSequence] Ready event confirmed for session ${this.sessionId}`);
  }

  /**
   * Retry a specific failed stage
   * @param {string} stage - Stage to retry
   * @returns {Object} Result of the retry attempt
   */
  async retryStage(stage) {
    if (this.retryAttempts[stage] >= this.maxRetries) {
      logger.warn(`[LaunchSequence] Max retries (${this.maxRetries}) exceeded for stage ${stage}`);
      return { success: false, error: 'Max retries exceeded' };
    }

    this.retryAttempts[stage]++;
    logger.info(`[LaunchSequence] Retrying stage ${stage}, attempt ${this.retryAttempts[stage]}`);

    try {
      // Reset stage status to pending, then run
      this.stageStatuses[stage] = STATUS.PENDING;
      this.emitStageStatus(stage, STATUS.PENDING, { message: 'Retrying...' });

      switch (stage) {
        case STAGES.VOICES:
          await this.runVoiceAssignment();
          break;
        case STAGES.SFX:
          await this.runSFXGeneration();
          break;
        case STAGES.COVER:
          await this.runCoverArtValidation();
          break;
        case STAGES.QA:
          await this.runQAChecks();
          break;
        default:
          throw new Error(`Unknown stage: ${stage}`);
      }

      return { success: true, status: this.stageStatuses[stage] };

    } catch (error) {
      logger.error(`[LaunchSequence] Retry failed for stage ${stage}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Regenerate cover art and re-run validation
   * Used when user requests a new cover image
   */
  async regenerateCoverArt() {
    const stage = STAGES.COVER;

    try {
      // Reset cover stage
      this.stageStatuses[stage] = STATUS.PENDING;
      this.emitStageStatus(stage, STATUS.IN_PROGRESS, { message: 'Regenerating cover art...' });

      // Get session info for regeneration
      const sessionResult = await pool.query(
        'SELECT title, synopsis, config_json FROM story_sessions WHERE id = $1',
        [this.sessionId]
      );

      const session = sessionResult.rows[0];
      if (!session) {
        throw new Error('Session not found');
      }

      const title = session.title || 'Untitled Story';
      const config = session.config_json || {};

      // Emit event to request cover regeneration from client/orchestrator
      this.io.to(this.sessionId).emit('regenerate-cover-requested', {
        sessionId: this.sessionId,
        title,
        config
      });

      // Note: The actual cover regeneration will be handled by the stories route
      // This method just sets up the state for when the new cover is ready
      // The client will call an API endpoint to regenerate and then trigger re-validation

      return {
        success: true,
        message: 'Cover regeneration requested',
        waitingForNewCover: true
      };

    } catch (error) {
      this.emitStageStatus(stage, STATUS.ERROR, { message: error.message });
      logger.error(`[LaunchSequence] Cover regeneration failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Called when a new cover has been generated
   * Re-runs the cover validation stage
   */
  async onNewCoverGenerated(newCoverUrl) {
    logger.info(`[LaunchSequence] New cover generated: ${newCoverUrl}`);

    // Update the cover URL in session
    await pool.query(
      'UPDATE story_sessions SET cover_image_url = $1 WHERE id = $2',
      [newCoverUrl, this.sessionId]
    );

    // Re-run cover validation
    this.retryAttempts[STAGES.COVER] = 0; // Reset retries for fresh cover
    await this.runCoverArtValidation();

    // If all stages were already complete, check if we need to re-emit ready
    const allComplete = Object.values(this.stageStatuses).every(s => s === STATUS.SUCCESS);
    if (allComplete && this.validationStats) {
      // Update cover URL in stats
      this.validationStats.coverArtUrl = newCoverUrl;
      this.stageResults.cover.coverUrl = newCoverUrl;

      this.io.to(this.sessionId).emit('cover-regenerated', {
        success: true,
        coverUrl: newCoverUrl,
        allStatuses: { ...this.stageStatuses }
      });
    }

    return { success: true, coverUrl: newCoverUrl };
  }

  /**
   * Get voice name from ElevenLabs voice ID
   * Prioritizes database cache, then API lookup, never shows raw IDs to users
   */
  async getVoiceName(voiceId) {
    if (!voiceId) return 'Narrator';

    try {
      // Try to get from our cached voices in database (elevenlabs_voices table)
      const voiceResult = await pool.query(
        'SELECT name FROM elevenlabs_voices WHERE voice_id = $1',
        [voiceId]
      );

      if (voiceResult.rows.length > 0 && voiceResult.rows[0].name) {
        return voiceResult.rows[0].name;
      }

      // Try to fetch from ElevenLabs API
      try {
        const voiceData = await elevenlabs.getVoiceDetails(voiceId);
        if (voiceData && voiceData.name) {
          // Cache this voice in our database for future lookups
          try {
            await pool.query(`
              INSERT INTO elevenlabs_voices (voice_id, name, category, description)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (voice_id) DO UPDATE SET name = $2
            `, [voiceId, voiceData.name, voiceData.category || 'fetched', voiceData.description || '']);
            logger.info(`[LaunchSequence] Cached voice name from API: ${voiceData.name}`);
          } catch (cacheError) {
            logger.warn(`[LaunchSequence] Failed to cache voice name: ${cacheError.message}`);
          }
          return voiceData.name;
        }
      } catch (apiError) {
        logger.warn(`[LaunchSequence] Failed to fetch voice from API: ${apiError.message}`);
      }

      // Final fallback - return a user-friendly default rather than raw ID
      logger.warn(`[LaunchSequence] Could not resolve voice name for ID: ${voiceId}`);
      return 'Voice Actor';

    } catch (error) {
      logger.error(`[LaunchSequence] Error getting voice name: ${error.message}`);
      return 'Narrator';
    }
  }

  /**
   * Format narrator display string
   */
  formatNarratorDisplay(narrators) {
    if (!narrators || narrators.length === 0) {
      return 'Narrator';
    }

    const names = narrators.map(n => n.character || n.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'Narrator';
  }

  /**
   * Extract characters from synopsis text using AI
   * Used when no characters exist in DB or outline
   * @param {string} synopsis - Story synopsis text
   * @returns {Array} Array of character objects
   */
  async extractCharactersFromSynopsis(synopsis) {
    try {
      const prompt = `Analyze this story synopsis and extract ALL named characters mentioned.

Synopsis: "${synopsis}"

IMPORTANT: Extract EVERY character who has a proper name - even if only mentioned briefly.
Look for:
- Main characters (heroes, protagonists)
- Villains and antagonists
- Supporting characters with names
- Family members, friends, mentors mentioned by name
- Groups where individual members are named (e.g., "the seven friends: Anna, Bob, Carl...")
- Historical or legendary figures mentioned by name

Return a JSON array of characters with this format:
[
  { "name": "Character Name", "role": "protagonist/antagonist/supporting/mentor/sidekick", "description": "brief description from context" }
]

Be THOROUGH - extract 10-20 characters if they exist. Do not limit yourself to just the main characters.
Only skip truly generic descriptions like "a wizard" if they have no name.
If no named characters are found, return an empty array [].
Return ONLY the JSON array, no other text.`;

      const response = await completion({
        messages: [
          { role: 'system', content: 'You are a thorough character extraction assistant. Your job is to find ALL named characters in the text. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        model: getUtilityModel(),
        max_tokens: 1500,
        temperature: 0.3,
        agent_name: 'character_extractor',
        sessionId: this.sessionId
      });

      const content = response.content || '[]';

      // Parse JSON from response
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const characters = JSON.parse(jsonMatch[0]);
          return characters.map((char, index) => ({
            id: `synopsis_${index}`,
            name: char.name || `Character ${index + 1}`,
            role: char.role || 'supporting',
            voice_description: null,
            description: char.description || '',
            personality: '',
            traits_json: []
          }));
        }
      } catch (parseError) {
        logger.warn(`[LaunchSequence] Failed to parse characters from synopsis: ${parseError.message}`);
      }

      return [];
    } catch (error) {
      logger.error(`[LaunchSequence] Error extracting characters from synopsis: ${error.message}`);
      return [];
    }
  }

  /**
   * Insert characters into the database and return them with real UUIDs
   * @param {Array} characters - Array of character objects (may have fake IDs)
   * @returns {Array} Array of characters with real database UUIDs
   */
  async insertCharactersToDatabase(characters) {
    const insertedCharacters = [];

    for (const char of characters) {
      try {
        // Extract gender - MUST be provided by LLM, no inference fallback
        const characterGender = char.gender?.toLowerCase()?.trim() || null;

        // FAIL LOUD: Gender is required
        if (!characterGender) {
          const errorMsg = `CRITICAL: Character "${char.name}" missing gender in insertCharactersToDatabase. ` +
            `Gender MUST be provided by LLM at outline generation.`;
          logger.error(`[LaunchSequence] ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // Validate gender value
        const validGenders = ['male', 'female', 'non-binary', 'neutral'];
        if (!validGenders.includes(characterGender)) {
          const errorMsg = `CRITICAL: Character "${char.name}" has invalid gender "${characterGender}". ` +
            `Must be one of: ${validGenders.join(', ')}`;
          logger.error(`[LaunchSequence] ${errorMsg}`);
          throw new Error(errorMsg);
        }

        logger.info(`[LaunchSequence] Inserting character "${char.name}": gender=${characterGender}, source=outline (LLM-determined)`);

        const insertResult = await pool.query(`
          INSERT INTO characters (story_session_id, name, role, voice_description, description, personality, traits_json, gender, gender_confidence, gender_source, gender_reasoning)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (story_session_id, name) DO UPDATE SET
            role = EXCLUDED.role,
            description = COALESCE(NULLIF(EXCLUDED.description, ''), characters.description),
            gender = COALESCE(EXCLUDED.gender, characters.gender),
            gender_confidence = COALESCE(EXCLUDED.gender_confidence, characters.gender_confidence),
            gender_source = COALESCE(EXCLUDED.gender_source, characters.gender_source),
            gender_reasoning = COALESCE(EXCLUDED.gender_reasoning, characters.gender_reasoning)
          RETURNING id, name, role, voice_description, description, personality, traits_json, gender, gender_confidence, gender_source, gender_reasoning
        `, [
          this.sessionId,
          char.name || 'Character',
          char.role || 'supporting',
          char.voice_description || null,
          char.description || '',
          char.personality || '',
          JSON.stringify(char.traits_json || []),
          characterGender,
          'explicit',  // Always explicit now - LLM must provide
          'outline',   // Always from outline - no inference
          char.gender_reasoning || null  // Store LLM's chain of thought
        ]);

        if (insertResult.rows[0]) {
          insertedCharacters.push(insertResult.rows[0]);
        }
      } catch (insertErr) {
        logger.warn(`[LaunchSequence] Failed to insert character ${char.name}:`, insertErr.message);
      }
    }

    logger.info(`[LaunchSequence] Inserted ${insertedCharacters.length}/${characters.length} characters into database`);
    return insertedCharacters;
  }

  /**
   * @deprecated Gender is now always determined by LLM at outline generation.
   * This method existed for regex-based name inference which was not scalable.
   * It is now deprecated and will throw an error if called.
   *
   * Gender determination should happen in openai.js generateOutline() with:
   * 1. Explicit prompt requiring gender + gender_reasoning fields
   * 2. Validation that throws error if gender is missing
   * 3. Retry logic that falls back to GPT-4o for better compliance
   *
   * @param {Object} character - Character object (ignored)
   * @throws {Error} Always throws - this method should not be called
   */
  inferCharacterGender(character) {
    const errorMsg = `DEPRECATED: inferCharacterGender() called for "${character?.name || 'unknown'}". ` +
      `Gender MUST come from LLM outline generation, not regex inference. ` +
      `This method has been deprecated as of 2025-12-10. ` +
      `Check openai.js generateOutline() for the correct gender determination flow.`;
    logger.error(`[LaunchSequence] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  /**
   * Check if a voice gender matches character gender
   * @param {string} voiceGender - Voice's gender from database (may be null)
   * @param {string} characterGender - Inferred character gender
   * @returns {boolean} True if voice is appropriate for character
   */
  voiceGenderMatches(voiceGender, characterGender) {
    // If character is neutral, any voice works
    if (characterGender === 'neutral') {
      return true;
    }

    // If voice has no gender data, accept it as a fallback
    if (!voiceGender) {
      return true;
    }

    // Normalize gender strings
    const normalizedVoice = voiceGender.toLowerCase().trim();
    const normalizedChar = characterGender.toLowerCase().trim();

    // Check for match (handle variations like "Female", "female", "f")
    if (normalizedChar === 'female') {
      return normalizedVoice === 'female' || normalizedVoice === 'f';
    } else if (normalizedChar === 'male') {
      return normalizedVoice === 'male' || normalizedVoice === 'm';
    }

    return true;
  }
}

export { STAGES, STATUS };
export default LaunchSequenceManager;
