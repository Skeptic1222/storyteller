/**
 * Validation Agent
 * Pre-playback validation and stats compilation
 *
 * This agent performs final quality checks before audio playback,
 * compiles stats (SFX count, narrators, etc.), and ensures all
 * components are ready for a smooth playback experience.
 *
 * DATABASE SCHEMA REFERENCE (verified against schema.sql + migrations):
 * - story_sessions: id, title, synopsis, cover_image_url, config_json, current_status
 * - story_scenes: id, story_session_id (NOT session_id), sequence_index, polished_text, mood
 * - characters: id, story_session_id (NOT session_id), name, role, voice_description (NO voice_id)
 * - character_voice_assignments: story_session_id, character_id, elevenlabs_voice_id
 * - scene_sfx: scene_id, sfx_key, volume
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import { ALL_VOICES } from '../conversationEngine.js';

/**
 * Validation result structure
 */
const createValidationResult = () => ({
  isValid: false,
  timestamp: new Date().toISOString(),
  session: {
    id: null,
    title: null,
    synopsis: null,
    coverArtUrl: null
  },
  stats: {
    sfxCount: 0,
    sfxCategories: [],
    narratorCount: 0,
    narrators: [],
    sceneCount: 0,
    characterCount: 0,
    estimatedDuration: 0
  },
  scene: {
    id: null,
    index: 0,
    text: null,
    mood: null,
    hasChoices: false,
    choiceCount: 0
  },
  errors: [],
  warnings: []
});

export class ValidationAgent {
  constructor() {
    this.voiceLookup = this.buildVoiceLookup();
  }

  /**
   * Build a lookup table for voice names from ALL_VOICES
   */
  buildVoiceLookup() {
    const lookup = {};
    if (ALL_VOICES) {
      for (const [key, voice] of Object.entries(ALL_VOICES)) {
        if (voice && voice.id) {
          lookup[voice.id] = voice.name || key.charAt(0).toUpperCase() + key.slice(1);
        }
      }
    }
    return lookup;
  }

  /**
   * Get voice name from voice ID
   */
  getVoiceName(voiceId) {
    return this.voiceLookup[voiceId] || 'Narrator';
  }

  /**
   * Validate a scene before playback and compile all stats
   * @param {string} sessionId - The story session ID
   * @param {object} scene - The scene data from orchestrator
   * @param {object} options - Additional validation options
   * @returns {object} Validation result with stats
   */
  async validateScene(sessionId, scene, options = {}) {
    const result = createValidationResult();

    try {
      // =====================================================================
      // 1. FETCH SESSION DATA
      // Columns: id, title, synopsis, cover_image_url, config_json, current_status
      // =====================================================================
      const sessionResult = await pool.query(`
        SELECT
          id,
          title,
          synopsis,
          cover_image_url,
          config_json,
          current_status
        FROM story_sessions
        WHERE id = $1
      `, [sessionId]);

      if (!sessionResult.rows[0]) {
        result.errors.push('Session not found');
        return result;
      }

      const session = sessionResult.rows[0];
      result.session.id = session.id;
      result.session.title = session.title;
      result.session.synopsis = session.synopsis;
      result.session.coverArtUrl = session.cover_image_url;

      // Validate title exists
      if (!session.title) {
        result.warnings.push('Story title not generated');
      }

      // Validate synopsis exists
      if (!session.synopsis) {
        result.warnings.push('Story synopsis not generated');
      }

      // Validate cover art
      if (!session.cover_image_url) {
        result.warnings.push('Cover art not generated');
      }

      // =====================================================================
      // 2. COMPILE SCENE INFO
      // =====================================================================
      result.scene.id = scene.id;
      result.scene.index = scene.sequence_index || 0;
      result.scene.text = scene.polished_text;
      result.scene.mood = scene.mood;
      result.scene.hasChoices = scene.choices && scene.choices.length > 0;
      result.scene.choiceCount = scene.choices?.length || 0;

      // =====================================================================
      // 3. COUNT SFX FROM SCENE DATA (if passed in scene object)
      // =====================================================================
      if (scene.sfx && scene.sfx.length > 0) {
        result.stats.sfxCount = scene.sfx.length;
        const categories = new Set();
        scene.sfx.forEach(sfx => {
          const key = sfx.sfx_key || sfx.sfxKey || '';
          const category = key.split('.')[0];
          if (category) categories.add(category);
        });
        result.stats.sfxCategories = Array.from(categories);
      }

      // =====================================================================
      // 4. COUNT SFX FROM DATABASE (scene_sfx table)
      // If scene.sfx wasn't populated, try to get from database
      // =====================================================================
      if (result.stats.sfxCount === 0 && scene.id) {
        try {
          const sfxResult = await pool.query(`
            SELECT sfx_key FROM scene_sfx WHERE scene_id = $1
          `, [scene.id]);

          if (sfxResult.rows.length > 0) {
            result.stats.sfxCount = sfxResult.rows.length;
            const categories = new Set();
            sfxResult.rows.forEach(row => {
              const category = row.sfx_key?.split('.')[0];
              if (category) categories.add(category);
            });
            result.stats.sfxCategories = Array.from(categories);
          }
        } catch (sfxErr) {
          logger.debug('[ValidationAgent] Could not query scene_sfx:', sfxErr.message);
        }
      }

      // =====================================================================
      // 5. GET NARRATOR INFO
      // Build from multiple sources: audio segments, character_voice_assignments, config
      // =====================================================================
      const narrators = new Set();
      const narratorDetails = [];

      // 5a. Check multi-voice audio segments (if passed in scene object)
      if (scene.audio_segments && scene.audio_segments.length > 0) {
        for (const segment of scene.audio_segments) {
          if (segment.voice_id && !narrators.has(segment.voice_id)) {
            narrators.add(segment.voice_id);
            narratorDetails.push({
              id: segment.voice_id,
              name: this.getVoiceName(segment.voice_id),
              character: segment.character || null,
              type: segment.type || 'dialogue'
            });
          }
        }
      }

      // 5b. Check character_voice_assignments table
      // Table: character_voice_assignments
      // Columns: story_session_id, character_id, elevenlabs_voice_id
      try {
        const voiceAssignmentsResult = await pool.query(`
          SELECT
            cva.elevenlabs_voice_id,
            c.name as character_name,
            c.role
          FROM character_voice_assignments cva
          JOIN characters c ON c.id = cva.character_id
          WHERE cva.story_session_id = $1
        `, [sessionId]);

        for (const va of voiceAssignmentsResult.rows) {
          if (va.elevenlabs_voice_id && !narrators.has(va.elevenlabs_voice_id)) {
            narrators.add(va.elevenlabs_voice_id);
            narratorDetails.push({
              id: va.elevenlabs_voice_id,
              name: this.getVoiceName(va.elevenlabs_voice_id),
              character: va.character_name,
              type: 'character'
            });
          }
        }
      } catch (vaErr) {
        // Character voice assignments table might not exist in older schemas - skip
        logger.debug('[ValidationAgent] Could not query character_voice_assignments:', vaErr.message);
      }

      // 5c. Add narrator voice from session config
      const config = session.config_json || {};
      if (config.voice_id && !narrators.has(config.voice_id)) {
        narrators.add(config.voice_id);
        narratorDetails.push({
          id: config.voice_id,
          name: this.getVoiceName(config.voice_id),
          character: null,
          type: 'narrator'
        });
      }

      result.stats.narratorCount = narrators.size;
      result.stats.narrators = narratorDetails;

      // =====================================================================
      // 6. GET TOTAL SCENE COUNT
      // Use story_session_id (NOT session_id)
      // =====================================================================
      const sceneCountResult = await pool.query(`
        SELECT COUNT(*) as count FROM story_scenes WHERE story_session_id = $1
      `, [sessionId]);
      result.stats.sceneCount = parseInt(sceneCountResult.rows[0]?.count || 1);

      // =====================================================================
      // 7. GET CHARACTER COUNT
      // Use story_session_id (NOT session_id)
      // =====================================================================
      const charCountResult = await pool.query(`
        SELECT COUNT(*) as count FROM characters WHERE story_session_id = $1
      `, [sessionId]);
      result.stats.characterCount = parseInt(charCountResult.rows[0]?.count || 0);

      // =====================================================================
      // 8. ESTIMATE DURATION
      // Based on text length (rough: 150 words/min = 2.5 words/sec)
      // =====================================================================
      const wordCount = (scene.polished_text || '').split(/\s+/).length;
      result.stats.estimatedDuration = Math.round((wordCount / 150) * 60); // in seconds

      // =====================================================================
      // 9. FINAL VALIDATION - isValid only if no errors
      // =====================================================================
      result.isValid = result.errors.length === 0;

      logger.info(`[ValidationAgent] Scene ${result.scene.index} validation:`, {
        valid: result.isValid,
        sfxCount: result.stats.sfxCount,
        narratorCount: result.stats.narratorCount,
        warnings: result.warnings.length
      });

      return result;

    } catch (error) {
      logger.error('[ValidationAgent] Validation error:', error);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Validate entire story session before any playback
   * @param {string} sessionId - The story session ID
   * @returns {object} Full session validation result
   */
  async validateSession(sessionId) {
    const result = createValidationResult();

    try {
      // =====================================================================
      // 1. GET SESSION WITH AGGREGATED DATA
      // Using story_session_id for joins (NOT session_id)
      // =====================================================================
      const sessionResult = await pool.query(`
        SELECT
          s.id,
          s.title,
          s.synopsis,
          s.cover_image_url,
          s.config_json,
          s.current_status,
          COUNT(DISTINCT sc.id) as scene_count,
          COUNT(DISTINCT c.id) as character_count
        FROM story_sessions s
        LEFT JOIN story_scenes sc ON sc.story_session_id = s.id
        LEFT JOIN characters c ON c.story_session_id = s.id
        WHERE s.id = $1
        GROUP BY s.id
      `, [sessionId]);

      if (!sessionResult.rows[0]) {
        result.errors.push('Session not found');
        return result;
      }

      const session = sessionResult.rows[0];
      result.session.id = session.id;
      result.session.title = session.title;
      result.session.synopsis = session.synopsis;
      result.session.coverArtUrl = session.cover_image_url;
      result.stats.sceneCount = parseInt(session.scene_count || 0);
      result.stats.characterCount = parseInt(session.character_count || 0);

      // =====================================================================
      // 2. GET ALL UNIQUE SFX ACROSS SCENES
      // Join through story_scenes using story_session_id
      // =====================================================================
      try {
        const sfxResult = await pool.query(`
          SELECT DISTINCT ss.sfx_key
          FROM scene_sfx ss
          JOIN story_scenes sc ON sc.id = ss.scene_id
          WHERE sc.story_session_id = $1
        `, [sessionId]);

        result.stats.sfxCount = sfxResult.rows.length;

        const categories = new Set();
        sfxResult.rows.forEach(row => {
          const category = row.sfx_key?.split('.')[0];
          if (category) categories.add(category);
        });
        result.stats.sfxCategories = Array.from(categories);
      } catch (sfxErr) {
        logger.debug('[ValidationAgent] Could not query scene_sfx:', sfxErr.message);
      }

      // =====================================================================
      // 3. GET ALL NARRATORS/VOICES
      // From character_voice_assignments table and session config
      // =====================================================================
      const narrators = [];
      const config = session.config_json || {};

      // 3a. Add narrator voice from config
      if (config.voice_id) {
        narrators.push({
          id: config.voice_id,
          name: this.getVoiceName(config.voice_id),
          character: null,
          type: 'narrator'
        });
      }

      // 3b. Add character voices from character_voice_assignments
      try {
        const voicesResult = await pool.query(`
          SELECT DISTINCT
            cva.elevenlabs_voice_id as voice_id,
            c.name as character_name
          FROM character_voice_assignments cva
          JOIN characters c ON c.id = cva.character_id
          WHERE cva.story_session_id = $1
        `, [sessionId]);

        for (const char of voicesResult.rows) {
          // Avoid duplicates if same voice used for narrator and character
          if (!narrators.some(n => n.id === char.voice_id)) {
            narrators.push({
              id: char.voice_id,
              name: this.getVoiceName(char.voice_id),
              character: char.character_name,
              type: 'character'
            });
          }
        }
      } catch (vaErr) {
        logger.debug('[ValidationAgent] Could not query character_voice_assignments for session:', vaErr.message);
      }

      result.stats.narratorCount = narrators.length;
      result.stats.narrators = narrators;

      // =====================================================================
      // 4. VALIDATION CHECKS
      // =====================================================================
      if (!session.title) result.warnings.push('No title');
      if (!session.synopsis) result.warnings.push('No synopsis');
      if (!session.cover_image_url) result.warnings.push('No cover art');
      if (result.stats.sceneCount === 0) result.errors.push('No scenes generated');
      if (result.stats.narratorCount === 0) result.warnings.push('No narrators assigned');

      result.isValid = result.errors.length === 0;

      logger.info(`[ValidationAgent] Session validation complete:`, {
        sessionId,
        valid: result.isValid,
        scenes: result.stats.sceneCount,
        sfx: result.stats.sfxCount,
        narrators: result.stats.narratorCount
      });

      return result;

    } catch (error) {
      logger.error('[ValidationAgent] Session validation error:', error);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Format narrators for display
   * @param {Array} narrators - Array of narrator objects
   * @returns {string} Formatted string like "Starring: Fred, Sam, Susie"
   */
  formatNarratorDisplay(narrators) {
    if (!narrators || narrators.length === 0) {
      return 'No narrators assigned';
    }

    const names = narrators.map(n => n.character || n.name);
    return names.join(', ');
  }
}

export default ValidationAgent;
