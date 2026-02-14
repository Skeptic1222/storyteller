/**
 * Test Story Runner
 *
 * Executes test fixtures through the voice pipeline without expensive LLM story generation.
 * Creates real database rows, then runs voice assignment, segment building, speech tag
 * filtering, voice direction, and optionally TTS.
 *
 * Cost per run:
 * - With LLM voice assignment: ~600 tokens + ~300 ElevenLabs chars
 * - With hardcoded voices (skipVoiceAssignment): 0 LLM tokens + ~300 ElevenLabs chars
 * - With skipTTS: 0 ElevenLabs chars (pipeline-only test)
 */

import { pool, withTransaction } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { TEST_FIXTURES, HARDCODED_VOICE_MAP, validateFixture } from './testFixtures.js';
import { validateAndReconcileSpeakers } from './agents/speakerValidationAgent.js';
import { convertDialogueMapToSegments } from './agents/dialogueSegmentUtils.js';
import { filterSpeechTagsSmart, filterSpeechTagsLightTouch } from './agents/speechTagFilterAgent.js';
import { directVoiceActing } from './agents/voiceDirectorAgent.js';
import { DEFAULT_NARRATOR_VOICE_ID } from '../constants/voices.js';

/**
 * Run a test fixture through the voice pipeline.
 *
 * @param {string} fixtureName - Key from TEST_FIXTURES
 * @param {Object} options
 * @param {boolean} options.skipTTS - Skip ElevenLabs TTS (default: true)
 * @param {boolean} options.skipVoiceDirection - Skip voice director LLM call
 * @param {boolean} options.skipSpeechTagFilter - Skip speech tag filter
 * @param {boolean} options.useHardcodedVoices - Use hardcoded voice map (no LLM call)
 * @param {string} options.narratorVoice - Override narrator voice ID
 * @param {string} options.userId - User ID for session ownership
 * @returns {Object} { sessionId, results, timings }
 */
export async function runTestFixture(fixtureName, options = {}) {
  const {
    skipTTS = true,
    skipVoiceDirection = false,
    skipSpeechTagFilter = false,
    useHardcodedVoices = false,
    narratorVoice = DEFAULT_NARRATOR_VOICE_ID,
    userId = null
  } = options;

  const fixture = TEST_FIXTURES[fixtureName];
  if (!fixture) {
    throw new Error(`Unknown test fixture: ${fixtureName}. Available: ${Object.keys(TEST_FIXTURES).join(', ')}`);
  }

  // Validate fixture integrity first
  const validation = validateFixture(fixtureName);
  if (!validation.valid) {
    throw new Error(`Fixture ${fixtureName} has invalid positions: ${JSON.stringify(validation.errors)}`);
  }

  const timings = {};
  const results = {
    fixture: fixtureName,
    fixtureName: fixture.name,
    characters_created: 0,
    voice_assignments: {},
    segments: [],
    speech_tags_filtered: null,
    voice_direction: null,
    tts: null,
    errors: []
  };

  logger.info(`[TestRunner] ============================================================`);
  logger.info(`[TestRunner] RUNNING TEST FIXTURE: ${fixture.name}`);
  logger.info(`[TestRunner] Options: skipTTS=${skipTTS}, skipVoiceDirection=${skipVoiceDirection}, skipSpeechTagFilter=${skipSpeechTagFilter}, useHardcodedVoices=${useHardcodedVoices}`);
  logger.info(`[TestRunner] ============================================================`);

  let sessionId;

  try {
    // ==========================================================================
    // STEP 1: Create session, outline, characters, scene in database
    // ==========================================================================
    const dbStart = Date.now();

    sessionId = await withTransaction(async (client) => {
      // Create session
      const sessionResult = await client.query(`
        INSERT INTO story_sessions (user_id, config_json, current_status, title)
        VALUES ($1, $2, 'finished', $3)
        RETURNING id
      `, [
        userId,
        JSON.stringify({ ...fixture.config, is_test: true, test_fixture: fixtureName }),
        `[TEST] ${fixture.outline.title}`
      ]);
      const sid = sessionResult.rows[0].id;

      // Create outline
      await client.query(`
        INSERT INTO story_outlines (story_session_id, outline_json, themes)
        VALUES ($1, $2, $3)
      `, [
        sid,
        JSON.stringify({
          title: fixture.outline.title,
          synopsis: fixture.outline.synopsis,
          setting: fixture.outline.setting,
          themes: fixture.outline.themes
        }),
        fixture.outline.themes
      ]);

      // Create characters
      for (const char of fixture.characters) {
        await client.query(`
          INSERT INTO characters (story_session_id, name, gender, role, description, traits_json)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          sid,
          char.name,
          char.gender,
          char.role,
          char.description,
          JSON.stringify({ created_by: 'test_fixture', fixture: fixtureName, age_group: char.age_group })
        ]);
      }

      // Create scene with dialogue_map
      await client.query(`
        INSERT INTO story_scenes (story_session_id, sequence_index, raw_text, polished_text, summary, mood, dialogue_map)
        VALUES ($1, 0, $2, $3, $4, $5, $6)
      `, [
        sid,
        fixture.scene.polished_text,
        fixture.scene.polished_text,
        fixture.scene.summary,
        fixture.scene.mood,
        JSON.stringify(fixture.scene.dialogue_map)
      ]);

      return sid;
    });

    timings.db_setup = Date.now() - dbStart;
    results.characters_created = fixture.characters.length;
    logger.info(`[TestRunner] DB setup complete in ${timings.db_setup}ms. Session: ${sessionId}`);

    // Load characters from DB (needed for voice assignment)
    const charsResult = await pool.query(
      `SELECT id, name, role, description, traits_json, gender, age_group,
              voice_description, appearance, portrait_url
       FROM characters WHERE story_session_id = $1`,
      [sessionId]
    );
    const characters = charsResult.rows;

    // ==========================================================================
    // STEP 2: Voice Assignment
    // ==========================================================================
    const voiceStart = Date.now();

    if (useHardcodedVoices) {
      // Zero-cost path: use pre-defined voice mappings
      logger.info(`[TestRunner] Using hardcoded voice map (zero LLM cost)`);
      for (const char of characters) {
        const voiceId = HARDCODED_VOICE_MAP[char.name.toLowerCase()];
        if (voiceId) {
          await pool.query(`
            INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
          `, [sessionId, char.id, voiceId]);
          results.voice_assignments[char.name.toLowerCase()] = voiceId;
        } else {
          results.errors.push(`No hardcoded voice for ${char.name}`);
        }
      }
    } else {
      // LLM path: use speaker validation agent (includes voice assignment)
      const storyContext = {
        genre: fixture.config.genre,
        mood: fixture.config.mood,
        synopsis: fixture.outline.synopsis,
        setting: fixture.outline.setting,
        themes: fixture.outline.themes
      };

      const validationResult = await validateAndReconcileSpeakers(
        sessionId,
        fixture.scene.dialogue_map,
        [], // no new characters (all pre-created)
        characters,
        storyContext,
        narratorVoice
      );
      results.voice_assignments = validationResult.voiceAssignments;
    }

    timings.voice_assignment = Date.now() - voiceStart;
    logger.info(`[TestRunner] Voice assignment complete in ${timings.voice_assignment}ms`);

    // ==========================================================================
    // STEP 3: Build segments from dialogue_map
    // ==========================================================================
    const segmentStart = Date.now();

    const segments = convertDialogueMapToSegments(
      fixture.scene.polished_text,
      fixture.scene.dialogue_map
    );

    timings.segment_building = Date.now() - segmentStart;
    logger.info(`[TestRunner] Built ${segments.length} segments in ${timings.segment_building}ms`);

    // ==========================================================================
    // STEP 4: Speech Tag Filtering (optional)
    // ==========================================================================
    if (!skipSpeechTagFilter) {
      const filterStart = Date.now();

      const context = {
        hideSpeechTagsPreGen: fixture.config.hide_speech_tags,
        genre: fixture.config.genre
      };

      // Use light-touch (regex-based) for test mode to avoid LLM cost
      const filteredSegments = await filterSpeechTagsLightTouch(segments, { trustPreGen: false });

      // Count what changed
      let removed = 0;
      let stripped = 0;
      for (let i = 0; i < segments.length; i++) {
        if (i < filteredSegments.length) {
          if (filteredSegments[i].text !== segments[i].text) {
            if (filteredSegments[i].text.length === 0) removed++;
            else stripped++;
          }
        }
      }

      results.speech_tags_filtered = { removed, stripped };
      timings.speech_tag_filter = Date.now() - filterStart;
      logger.info(`[TestRunner] Speech tag filter complete in ${timings.speech_tag_filter}ms: ${removed} removed, ${stripped} stripped`);

      // Use filtered segments going forward
      results.segments = filteredSegments.map(s => ({
        speaker: s.speaker,
        text: s.text.substring(0, 100) + (s.text.length > 100 ? '...' : ''),
        emotion: s.emotion,
        delivery: s.delivery,
        voice_role: s.voice_role
      }));
    } else {
      results.segments = segments.map(s => ({
        speaker: s.speaker,
        text: s.text.substring(0, 100) + (s.text.length > 100 ? '...' : ''),
        emotion: s.emotion,
        delivery: s.delivery,
        voice_role: s.voice_role
      }));
    }

    // ==========================================================================
    // STEP 5: Voice Direction (optional)
    // ==========================================================================
    if (!skipVoiceDirection) {
      const directionStart = Date.now();

      const context = {
        genre: fixture.config.genre,
        mood: fixture.config.mood,
        audience: fixture.config.audience
      };

      const directedSegments = await directVoiceActing(segments, context, sessionId);

      // Check what direction was added
      let directedCount = 0;
      for (const seg of directedSegments) {
        if (seg.voice_direction || seg.audio_tags) directedCount++;
      }

      results.voice_direction = { directed_segments: directedCount, total_segments: directedSegments.length };
      timings.voice_direction = Date.now() - directionStart;
      logger.info(`[TestRunner] Voice direction complete in ${timings.voice_direction}ms: ${directedCount}/${directedSegments.length} directed`);
    }

    // ==========================================================================
    // STEP 6: TTS Generation (optional - costs ElevenLabs tokens)
    // ==========================================================================
    if (!skipTTS) {
      results.tts = { skipped: false, note: 'TTS integration available but not yet wired to test runner' };
      timings.tts_generation = 0;
      logger.info(`[TestRunner] TTS generation: not yet implemented in test runner (use full pipeline)`);
    } else {
      results.tts = { skipped: true };
      timings.tts_generation = 0;
    }

    // Calculate total timing
    timings.total = Object.values(timings).reduce((sum, t) => sum + t, 0);

    logger.info(`[TestRunner] ============================================================`);
    logger.info(`[TestRunner] TEST COMPLETE: ${fixture.name}`);
    logger.info(`[TestRunner] Session: ${sessionId}`);
    logger.info(`[TestRunner] Characters: ${results.characters_created}`);
    logger.info(`[TestRunner] Voice assignments: ${Object.keys(results.voice_assignments).length}`);
    logger.info(`[TestRunner] Segments: ${results.segments.length}`);
    logger.info(`[TestRunner] Total time: ${timings.total}ms`);
    logger.info(`[TestRunner] ============================================================`);

    return { sessionId, results, timings };

  } catch (error) {
    logger.error(`[TestRunner] FAILED: ${error.message}`);

    // Cleanup on failure
    if (sessionId) {
      try {
        await pool.query('DELETE FROM story_sessions WHERE id = $1', [sessionId]);
        logger.info(`[TestRunner] Cleaned up failed session: ${sessionId}`);
      } catch (cleanupError) {
        logger.warn(`[TestRunner] Cleanup failed: ${cleanupError.message}`);
      }
    }

    throw error;
  }
}

/**
 * Clean up a test session and all related data.
 */
export async function cleanupTestSession(sessionId) {
  // Verify this is actually a test session
  const result = await pool.query(
    "SELECT config_json FROM story_sessions WHERE id = $1",
    [sessionId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const config = typeof result.rows[0].config_json === 'string'
    ? JSON.parse(result.rows[0].config_json)
    : result.rows[0].config_json;

  if (!config?.is_test) {
    throw new Error(`Session ${sessionId} is not a test session - refusing to delete`);
  }

  // CASCADE delete handles all child tables
  await pool.query('DELETE FROM story_sessions WHERE id = $1', [sessionId]);
  logger.info(`[TestRunner] Cleaned up test session: ${sessionId}`);
  return { deleted: true, sessionId };
}

/**
 * Get test results for a session.
 */
export async function getTestResults(sessionId) {
  const session = await pool.query(
    `SELECT s.id, s.title, s.config_json, s.created_at,
            (SELECT COUNT(*) FROM characters WHERE story_session_id = s.id) as char_count,
            (SELECT COUNT(*) FROM story_scenes WHERE story_session_id = s.id) as scene_count
     FROM story_sessions s WHERE s.id = $1`,
    [sessionId]
  );

  if (session.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const voices = await pool.query(
    `SELECT c.name, cva.elevenlabs_voice_id
     FROM character_voice_assignments cva
     JOIN characters c ON c.id = cva.character_id
     WHERE cva.story_session_id = $1`,
    [sessionId]
  );

  const scenes = await pool.query(
    `SELECT id, sequence_index, summary, mood, dialogue_map, polished_text
     FROM story_scenes WHERE story_session_id = $1 ORDER BY sequence_index`,
    [sessionId]
  );

  return {
    session: session.rows[0],
    voice_assignments: voices.rows.reduce((acc, v) => {
      acc[v.name] = v.elevenlabs_voice_id;
      return acc;
    }, {}),
    scenes: scenes.rows.map(s => ({
      id: s.id,
      sequence_index: s.sequence_index,
      summary: s.summary,
      mood: s.mood,
      dialogue_count: s.dialogue_map?.length || 0,
      text_length: s.polished_text?.length || 0
    }))
  };
}

export default {
  runTestFixture,
  cleanupTestSession,
  getTestResults
};
