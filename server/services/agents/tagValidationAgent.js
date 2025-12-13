/**
 * Tag Validation Agent
 *
 * 3-pass validation system for tagged prose:
 * - Pass 1: Tag balance (deterministic - no LLM)
 * - Pass 2: Speaker verification (LLM-assisted for fuzzy matching)
 * - Pass 3: Untagged dialogue detection (LLM-assisted)
 *
 * This is part of the bulletproof multi-voice architecture.
 * If validation fails, the pipeline MUST halt (FAIL LOUD).
 *
 * @module tagValidationAgent
 */

import { callLLM } from '../llmProviders.js';
import { logger } from '../../utils/logger.js';
import { validateTagBalance, extractSpeakers, hasCharacterTags } from './tagParser.js';

/**
 * Validate tagged prose with 3-pass approach
 *
 * @param {string} prose - Prose with [CHAR:Name]dialogue[/CHAR] tags
 * @param {Array} characterCast - Array of {name, gender, role} objects
 * @param {string} sessionId - Session ID for LLM tracking
 * @returns {Object} {valid: boolean, speakers: string[], errors: string[], repairs: Object}
 */
export async function validateTaggedProse(prose, characterCast = [], sessionId = null) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const repairs = {};

  logger.info(`[TagValidation] ========== TAG VALIDATION START ==========`);
  logger.info(`[TagValidation] INPUT | proseLength: ${prose?.length || 0} | castSize: ${characterCast?.length || 0}`);

  // Early exit if no prose
  if (!prose || typeof prose !== 'string' || prose.trim().length === 0) {
    return {
      valid: true, // Empty prose is technically valid
      speakers: [],
      errors: [],
      warnings: ['Empty prose provided'],
      repairs: {},
      elapsed: Date.now() - startTime
    };
  }

  // Check if prose even has character tags
  if (!hasCharacterTags(prose)) {
    // This might be narrator-only content, which is valid
    logger.info(`[TagValidation] NO_TAGS_FOUND | prose has no [CHAR] tags (narrator-only content)`);
    return {
      valid: true,
      speakers: [],
      errors: [],
      warnings: ['No character dialogue tags found - treating as narrator-only content'],
      repairs: {},
      elapsed: Date.now() - startTime
    };
  }

  // ========== PASS 1: Tag Balance (Deterministic) ==========
  logger.info(`[TagValidation] PASS_1_START | checking tag balance`);

  const balanceResult = validateTagBalance(prose);
  if (!balanceResult.valid) {
    errors.push(...balanceResult.errors);
    logger.error(`[TagValidation] PASS_1_FAILED | errors: ${balanceResult.errors.join('; ')}`);
    // Continue to other passes for complete error report
  } else {
    logger.info(`[TagValidation] PASS_1_PASSED | tags balanced`);
  }

  // ========== PASS 2: Speaker Verification ==========
  logger.info(`[TagValidation] PASS_2_START | verifying speakers`);

  const speakersFromTags = extractSpeakers(prose);
  logger.info(`[TagValidation] SPEAKERS_IN_PROSE | count: ${speakersFromTags.length} | names: ${speakersFromTags.join(', ')}`);

  // Build cast name lookup (case-insensitive)
  const castNames = characterCast.map(c => ({
    original: c.name,
    lower: c.name.toLowerCase(),
    gender: c.gender,
    role: c.role
  }));

  // Find unknown speakers (not in cast)
  const unknownSpeakers = speakersFromTags.filter(speaker =>
    !castNames.some(c => c.lower === speaker.toLowerCase())
  );

  if (unknownSpeakers.length > 0) {
    logger.info(`[TagValidation] UNKNOWN_SPEAKERS | count: ${unknownSpeakers.length} | names: ${unknownSpeakers.join(', ')}`);

    // Use LLM to determine if these are:
    // 1. Nicknames/aliases for known characters (map them)
    // 2. New minor characters (add them)
    // 3. Actual errors (flag them)
    try {
      const speakerAnalysis = await analyzeSpeakers(unknownSpeakers, characterCast, prose, sessionId);

      if (speakerAnalysis.mappings && Object.keys(speakerAnalysis.mappings).length > 0) {
        repairs.speakerMappings = speakerAnalysis.mappings;
        logger.info(`[TagValidation] SPEAKER_MAPPINGS | ${JSON.stringify(speakerAnalysis.mappings)}`);
      }

      if (speakerAnalysis.newCharacters && speakerAnalysis.newCharacters.length > 0) {
        repairs.newCharacters = speakerAnalysis.newCharacters;
        logger.info(`[TagValidation] NEW_CHARACTERS | ${speakerAnalysis.newCharacters.map(c => c.name).join(', ')}`);
      }

      if (speakerAnalysis.errors && speakerAnalysis.errors.length > 0) {
        errors.push(...speakerAnalysis.errors.map(e => `UNKNOWN_SPEAKER: ${e}`));
        logger.error(`[TagValidation] SPEAKER_ERRORS | ${speakerAnalysis.errors.join(', ')}`);
      }
    } catch (llmError) {
      // If LLM fails, treat all unknown speakers as warnings (not errors)
      logger.warn(`[TagValidation] SPEAKER_ANALYSIS_FAILED | ${llmError.message}`);
      warnings.push(...unknownSpeakers.map(s => `Unknown speaker "${s}" (LLM analysis unavailable)`));
    }
  } else {
    logger.info(`[TagValidation] PASS_2_PASSED | all speakers known`);
  }

  // ========== PASS 3: Untagged Dialogue Detection ==========
  logger.info(`[TagValidation] PASS_3_START | checking for untagged dialogue`);

  try {
    const untaggedResult = await detectUntaggedDialogue(prose, sessionId);

    if (untaggedResult.untaggedDialogue && untaggedResult.untaggedDialogue.length > 0) {
      for (const untagged of untaggedResult.untaggedDialogue) {
        warnings.push(`UNTAGGED_DIALOGUE: "${untagged.quote?.substring(0, 50)}..." near "${untagged.context?.substring(0, 30)}..."`);
      }
      repairs.untaggedDialogue = untaggedResult.untaggedDialogue;
      logger.warn(`[TagValidation] UNTAGGED_FOUND | count: ${untaggedResult.untaggedDialogue.length}`);
    } else {
      logger.info(`[TagValidation] PASS_3_PASSED | all dialogue tagged`);
    }
  } catch (llmError) {
    logger.warn(`[TagValidation] UNTAGGED_CHECK_FAILED | ${llmError.message}`);
    warnings.push('Untagged dialogue check failed (LLM error)');
  }

  // ========== Summary ==========
  const elapsed = Date.now() - startTime;
  const isValid = errors.length === 0;

  logger.info(`[TagValidation] ========== VALIDATION COMPLETE ==========`);
  logger.info(`[TagValidation] RESULT | valid: ${isValid} | errors: ${errors.length} | warnings: ${warnings.length} | elapsed: ${elapsed}ms`);
  if (errors.length > 0) {
    logger.error(`[TagValidation] ERRORS | ${errors.join('; ')}`);
  }
  if (warnings.length > 0) {
    logger.warn(`[TagValidation] WARNINGS | ${warnings.join('; ')}`);
  }

  return {
    valid: isValid,
    speakers: speakersFromTags,
    errors,
    warnings,
    repairs,
    elapsed
  };
}

/**
 * Analyze unknown speakers using LLM
 *
 * @param {string[]} unknownSpeakers - Speakers not in character cast
 * @param {Array} characterCast - Known characters
 * @param {string} prose - Full prose for context
 * @param {string} sessionId - Session ID
 * @returns {Object} {mappings, newCharacters, errors}
 */
async function analyzeSpeakers(unknownSpeakers, characterCast, prose, sessionId) {
  const prompt = `Analyze these unknown speaker names from a story.

UNKNOWN SPEAKERS: ${unknownSpeakers.join(', ')}

KNOWN CHARACTER CAST:
${characterCast.map(c => `- ${c.name} (${c.gender || 'unknown'}) - ${c.role || 'character'}`).join('\n')}

PROSE CONTEXT (first 500 chars):
${prose.substring(0, 500)}...

For each unknown speaker, determine:
1. Is this a nickname/alias for a known character? (map it to the known name)
2. Is this a new minor character? (describe them)
3. Is this an error? (typo, impossible speaker)

Return JSON:
{
  "mappings": { "Unknown Name": "Known Character Name" },
  "newCharacters": [
    { "name": "Speaker Name", "gender": "male|female|unknown", "role": "minor", "description": "brief description" }
  ],
  "errors": ["Speaker names that are definitely wrong"]
}

Rules:
- Only map if you're confident it's the same character
- Create new characters for guards, merchants, minor roles
- Mark as error only if completely implausible`;

  const response = await callLLM({
    messages: [{ role: 'user', content: prompt }],
    agent_name: 'speaker_validation',
    agent_category: 'coherence',
    temperature: 0.2,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
    sessionId
  });

  try {
    const parsed = JSON.parse(response.content);
    return {
      mappings: parsed.mappings || {},
      newCharacters: parsed.newCharacters || [],
      errors: parsed.errors || []
    };
  } catch (parseError) {
    logger.error(`[TagValidation] SPEAKER_ANALYSIS_PARSE_ERROR | ${parseError.message}`);
    return { mappings: {}, newCharacters: [], errors: [] };
  }
}

/**
 * Detect untagged dialogue using LLM
 *
 * @param {string} prose - Tagged prose to analyze
 * @param {string} sessionId - Session ID
 * @returns {Object} {untaggedDialogue: Array, allDialogueTagged: boolean}
 */
async function detectUntaggedDialogue(prose, sessionId) {
  const prompt = `Analyze this prose for any dialogue that is NOT inside [CHAR:Name][/CHAR] tags.

PROSE:
${prose}

Look for:
1. Quoted speech without [CHAR] tags
2. Dialogue after closing tags that should be tagged
3. Missing opening or closing tags

Return JSON:
{
  "untaggedDialogue": [
    { "quote": "the untagged text", "context": "surrounding text for identification" }
  ],
  "allDialogueTagged": true
}

IMPORTANT:
- Only flag actual spoken dialogue, not thoughts or narrative descriptions
- If all dialogue is properly tagged, return empty array and allDialogueTagged: true
- Be precise about what is and isn't dialogue`;

  const response = await callLLM({
    messages: [{ role: 'user', content: prompt }],
    agent_name: 'dialogue_validation',
    agent_category: 'coherence',
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    sessionId
  });

  try {
    const parsed = JSON.parse(response.content);
    return {
      untaggedDialogue: parsed.untaggedDialogue || [],
      allDialogueTagged: parsed.allDialogueTagged !== false
    };
  } catch (parseError) {
    logger.error(`[TagValidation] UNTAGGED_CHECK_PARSE_ERROR | ${parseError.message}`);
    return { untaggedDialogue: [], allDialogueTagged: true };
  }
}

/**
 * Repair tagged prose based on validation results
 *
 * @param {string} prose - Original tagged prose
 * @param {Object} repairs - Repairs from validateTaggedProse
 * @returns {string} Repaired prose
 */
export function applyRepairs(prose, repairs) {
  if (!repairs || Object.keys(repairs).length === 0) {
    return prose;
  }

  let repairedProse = prose;

  // Apply speaker mappings (rename tags)
  if (repairs.speakerMappings) {
    for (const [unknown, known] of Object.entries(repairs.speakerMappings)) {
      const regex = new RegExp(`\\[CHAR:${escapeRegex(unknown)}\\]`, 'gi');
      repairedProse = repairedProse.replace(regex, `[CHAR:${known}]`);
      logger.info(`[TagRepair] SPEAKER_RENAMED | "${unknown}" → "${known}"`);
    }
  }

  return repairedProse;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Quick validation (Pass 1 only - deterministic)
 * Use this when you just need to check tag balance without LLM calls
 */
export function quickValidate(prose) {
  if (!prose || !hasCharacterTags(prose)) {
    return { valid: true, errors: [] };
  }
  return validateTagBalance(prose);
}

export default {
  validateTaggedProse,
  applyRepairs,
  quickValidate
};
