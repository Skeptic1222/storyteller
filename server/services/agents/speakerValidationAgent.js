/**
 * ============================================================================
 * SPEAKER VALIDATION TEACHER AGENT - OPTION E ARCHITECTURE
 * ============================================================================
 *
 * VERSION: 1.0.0
 * DATE: 2025-12-10
 * STATUS: PRODUCTION - BULLETPROOF VOICE CASTING
 *
 * ============================================================================
 * PURPOSE
 * ============================================================================
 *
 * This agent validates that ALL speakers in a dialogue_map either:
 * 1. Exist in the character database, OR
 * 2. Are new minor characters that need to be created
 *
 * It acts as a TEACHER/QC layer after scene generation to ensure:
 * - Every speaker can be assigned a voice
 * - No "unknown speaker" errors during audio generation
 * - Minor characters are properly tracked and voiced
 *
 * ============================================================================
 * WHEN TO USE
 * ============================================================================
 *
 * Called by orchestrator AFTER generateSceneWithDialogue() returns.
 * The flow is:
 *
 * 1. generateSceneWithDialogue() returns { content, dialogue_map, new_characters }
 * 2. THIS AGENT validates the output
 * 3. Creates any new minor characters in the database
 * 4. Assigns voices to new characters
 * 5. Returns validated dialogue_map with guaranteed speaker coverage
 *
 * ============================================================================
 * FAIL LOUD POLICY
 * ============================================================================
 *
 * This is a PREMIUM service. If validation cannot be completed:
 * - THROW an error (do not fall back to narrator)
 * - Log detailed diagnostics
 * - The story generation stops rather than producing bad audio
 *
 * ============================================================================
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import { assignVoicesByLLM } from './voiceAssignmentAgent.js';

/**
 * Validate and reconcile speakers in a dialogue_map
 *
 * @param {string} sessionId - Story session ID
 * @param {Array} dialogueMap - The dialogue_map from generateSceneWithDialogue
 * @param {Array} newCharacters - New minor characters from scene generation
 * @param {Array} existingCharacters - Characters already in the database
 * @param {Object} storyContext - Story context for voice assignment
 * @param {string} narratorVoiceId - Narrator voice to exclude from character assignment
 * @returns {Object} { validatedDialogueMap, createdCharacters, voiceAssignments }
 */
export async function validateAndReconcileSpeakers(
  sessionId,
  dialogueMap,
  newCharacters,
  existingCharacters,
  storyContext,
  narratorVoiceId
) {
  logger.info(`[SpeakerValidation] ============================================================`);
  logger.info(`[SpeakerValidation] VALIDATING SPEAKERS FOR SESSION ${sessionId}`);
  logger.info(`[SpeakerValidation] Dialogue entries: ${dialogueMap?.length || 0}`);
  logger.info(`[SpeakerValidation] New characters from scene: ${newCharacters?.length || 0}`);
  logger.info(`[SpeakerValidation] Existing characters: ${existingCharacters?.length || 0}`);
  logger.info(`[SpeakerValidation] ============================================================`);

  if (!dialogueMap || dialogueMap.length === 0) {
    logger.info(`[SpeakerValidation] No dialogue to validate - returning empty result`);
    return {
      validatedDialogueMap: [],
      createdCharacters: [],
      voiceAssignments: {}
    };
  }

  // Build a map of existing character names (lowercase for matching)
  const existingCharacterNames = new Set(
    existingCharacters.map(c => c.name.toLowerCase())
  );

  // Collect all unique speakers from dialogue_map
  const allSpeakers = [...new Set(
    dialogueMap
      .filter(d => d.speaker && d.speaker.toLowerCase() !== 'narrator')
      .map(d => d.speaker)
  )];

  logger.info(`[SpeakerValidation] Unique speakers in dialogue: ${allSpeakers.join(', ')}`);

  // Categorize speakers
  const knownSpeakers = [];
  const unknownSpeakers = [];

  for (const speaker of allSpeakers) {
    if (existingCharacterNames.has(speaker.toLowerCase())) {
      knownSpeakers.push(speaker);
    } else {
      unknownSpeakers.push(speaker);
    }
  }

  logger.info(`[SpeakerValidation] Known speakers: ${knownSpeakers.join(', ') || 'none'}`);
  logger.info(`[SpeakerValidation] Unknown speakers: ${unknownSpeakers.join(', ') || 'none'}`);

  // For unknown speakers, check if they're in new_characters from scene generation
  const charactersToCreate = [];
  const stillUnknown = [];

  for (const speaker of unknownSpeakers) {
    const newChar = newCharacters?.find(
      c => c.name.toLowerCase() === speaker.toLowerCase()
    );

    if (newChar) {
      charactersToCreate.push(newChar);
      logger.info(`[SpeakerValidation] Will create minor character: ${newChar.name} (${newChar.gender})`);
    } else {
      stillUnknown.push(speaker);
    }
  }

  // FAIL LOUD: If we have speakers not in ANY list, this is a critical error
  if (stillUnknown.length > 0) {
    const errorMsg = `SPEAKER VALIDATION FAILED: The following speakers are not in the character list ` +
      `and were not declared as new characters: [${stillUnknown.join(', ')}]. ` +
      `This indicates a bug in generateSceneWithDialogue() - every speaker must be accounted for.`;
    logger.error(`[SpeakerValidation] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Create new minor characters in the database
  const createdCharacters = [];
  for (const charData of charactersToCreate) {
    try {
      const result = await pool.query(`
        INSERT INTO characters (story_session_id, name, gender, role, description, traits_json)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        sessionId,
        charData.name,
        charData.gender || 'unknown',
        charData.role || 'minor',
        charData.description || `Minor character: ${charData.name}`,
        JSON.stringify({ created_by: 'speaker_validation_agent', scene_introduced: true })
      ]);

      createdCharacters.push(result.rows[0]);
      logger.info(`[SpeakerValidation] Created minor character: ${charData.name} (ID: ${result.rows[0].id})`);
    } catch (dbError) {
      // Character might already exist (race condition) - try to find it
      if (dbError.code === '23505') { // unique_violation
        logger.warn(`[SpeakerValidation] Character ${charData.name} already exists - using existing`);
        const existing = await pool.query(
          'SELECT * FROM characters WHERE story_session_id = $1 AND LOWER(name) = LOWER($2)',
          [sessionId, charData.name]
        );
        if (existing.rows.length > 0) {
          createdCharacters.push(existing.rows[0]);
        }
      } else {
        throw dbError;
      }
    }
  }

  // Get updated character list
  const allCharactersResult = await pool.query(
    'SELECT * FROM characters WHERE story_session_id = $1',
    [sessionId]
  );
  const allCharacters = allCharactersResult.rows;

  // Get existing voice assignments for ALL characters
  const existingVoicesResult = await pool.query(
    'SELECT c.name, cva.elevenlabs_voice_id FROM character_voice_assignments cva ' +
    'JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
    [sessionId]
  );

  const existingVoices = {};
  for (const row of existingVoicesResult.rows) {
    existingVoices[row.name.toLowerCase()] = row.elevenlabs_voice_id;
  }

  logger.info(`[SpeakerValidation] Existing voice assignments: ${Object.keys(existingVoices).length}`);

  // Find ALL characters (existing + newly created) that need voice assignment
  // This handles the case where main characters exist but don't have voices yet
  const allCharsForVoices = [...existingCharacters, ...createdCharacters];
  const charactersNeedingVoices = allCharsForVoices.filter(
    c => !existingVoices[c.name.toLowerCase()]
  );

  let voiceAssignments = {};
  if (charactersNeedingVoices.length > 0) {
    logger.info(`[SpeakerValidation] Assigning voices to ${charactersNeedingVoices.length} characters: ${charactersNeedingVoices.map(c => c.name).join(', ')}`);

    // Use LLM to assign voices to characters without voices
    const newVoiceAssignments = await assignVoicesByLLM(
      charactersNeedingVoices,
      storyContext,
      narratorVoiceId,
      sessionId
    );

    // Save new voice assignments to database
    for (const char of charactersNeedingVoices) {
      const voiceId = newVoiceAssignments[char.name.toLowerCase()];
      if (voiceId) {
        await pool.query(`
          INSERT INTO character_voice_assignments (story_session_id, character_id, elevenlabs_voice_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (story_session_id, character_id) DO UPDATE SET elevenlabs_voice_id = $3
        `, [sessionId, char.id, voiceId]);

        voiceAssignments[char.name.toLowerCase()] = voiceId;
        logger.info(`[SpeakerValidation] Assigned voice ${voiceId} to ${char.name}`);
      }
    }
  }

  // Final validation: ensure ALL speakers now have voice coverage
  const allVoicesResult = await pool.query(
    'SELECT c.name, cva.elevenlabs_voice_id FROM character_voice_assignments cva ' +
    'JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
    [sessionId]
  );

  const allVoiceMap = {};
  for (const row of allVoicesResult.rows) {
    allVoiceMap[row.name.toLowerCase()] = row.elevenlabs_voice_id;
  }

  // Check that every speaker has a voice
  const speakersWithoutVoices = allSpeakers.filter(
    s => !allVoiceMap[s.toLowerCase()]
  );

  if (speakersWithoutVoices.length > 0) {
    const errorMsg = `SPEAKER VALIDATION FAILED: The following speakers still have no voice assigned: ` +
      `[${speakersWithoutVoices.join(', ')}]. Voice pool may be exhausted.`;
    logger.error(`[SpeakerValidation] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  logger.info(`[SpeakerValidation] ============================================================`);
  logger.info(`[SpeakerValidation] VALIDATION COMPLETE - ALL SPEAKERS HAVE VOICES`);
  logger.info(`[SpeakerValidation] Created ${createdCharacters.length} new minor characters`);
  logger.info(`[SpeakerValidation] Assigned ${Object.keys(voiceAssignments).length} new voices`);
  logger.info(`[SpeakerValidation] ============================================================`);

  return {
    validatedDialogueMap: dialogueMap,
    createdCharacters,
    voiceAssignments: allVoiceMap
  };
}

/**
 * Quick validation check - does every speaker have a voice?
 * Use this for pre-flight checks before audio generation.
 *
 * @param {string} sessionId - Story session ID
 * @param {Array} dialogueMap - The dialogue_map to check
 * @returns {Object} { valid: boolean, missingSpeakers: string[] }
 */
export async function quickValidateSpeakers(sessionId, dialogueMap) {
  if (!dialogueMap || dialogueMap.length === 0) {
    return { valid: true, missingSpeakers: [] };
  }

  // Get all speakers from dialogue
  const speakers = [...new Set(
    dialogueMap
      .filter(d => d.speaker && d.speaker.toLowerCase() !== 'narrator')
      .map(d => d.speaker.toLowerCase())
  )];

  // Get all voice assignments for this session
  const voicesResult = await pool.query(
    'SELECT LOWER(c.name) as name FROM character_voice_assignments cva ' +
    'JOIN characters c ON c.id = cva.character_id WHERE cva.story_session_id = $1',
    [sessionId]
  );

  const voicedCharacters = new Set(voicesResult.rows.map(r => r.name));

  // Find speakers without voices
  const missingSpeakers = speakers.filter(s => !voicedCharacters.has(s));

  return {
    valid: missingSpeakers.length === 0,
    missingSpeakers
  };
}

export default {
  validateAndReconcileSpeakers,
  quickValidateSpeakers
};
