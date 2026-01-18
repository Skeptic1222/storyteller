/**
 * Voice Assignment Agent
 *
 * Uses LLM to intelligently assign voices to characters based on:
 * - Character traits, personality, role, gender
 * - Story genre, mood, and themes
 * - Story synopsis and setting
 * - Available voice library with detailed metadata
 *
 * This is a PREMIUM feature - it FAILS LOUDLY instead of using fallbacks.
 * If voice assignment cannot be completed properly, the story generation stops.
 */

import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { RECOMMENDED_VOICES } from '../elevenlabs.js';
import { parseCharacterTraits } from '../../utils/agentHelpers.js';

/**
 * Build the complete voice library with all metadata for LLM
 */
function buildVoiceLibrary() {
  const voices = [];

  // Flatten all voice categories into a single list with full metadata
  for (const [category, voiceList] of Object.entries(RECOMMENDED_VOICES)) {
    for (const voice of voiceList) {
      voices.push({
        voice_id: voice.voice_id,
        name: voice.name,
        gender: voice.gender,
        style: voice.style,
        description: voice.description,
        category: category,
        // Add suitability hints for LLM
        suitable_for: getSuitabilityHints(voice, category)
      });
    }
  }

  return voices;
}

/**
 * Get suitability hints for a voice based on its characteristics
 */
function getSuitabilityHints(voice, category) {
  const hints = [];

  // Based on category
  if (category === 'male_narrators') hints.push('narration', 'storytelling', 'authoritative roles');
  if (category === 'female_narrators') hints.push('narration', 'storytelling', 'gentle roles');
  if (category === 'character_voices') hints.push('character dialogue', 'supporting roles');
  if (category === 'expressive_voices') hints.push('emotional scenes', 'dynamic characters');

  // Based on style
  if (voice.style === 'warm') hints.push('friendly characters', 'mentors', 'kind figures');
  if (voice.style === 'authoritative') hints.push('leaders', 'authority figures', 'villains', 'heroic commanders', 'warlords');
  if (voice.style === 'gravelly') hints.push('rugged characters', 'warriors', 'authority figures', 'barbarians', 'sword & sorcery heroes');
  if (voice.style === 'deep') hints.push('serious characters', 'deep thinkers', 'antagonists', 'heroic fantasy protagonists', 'gladiators');
  if (voice.style === 'crisp') hints.push('professional characters', 'narrators');
  if (voice.style === 'raspy') hints.push('mysterious characters', 'rogues', 'shadowy figures', 'battle-scarred warriors');
  if (voice.style === 'middle') hints.push('generic characters', 'supporting roles', 'background characters');
  if (voice.style === 'soft') hints.push('gentle characters', 'nurturing roles', 'bedtime stories');
  if (voice.style === 'seductive') hints.push('romantic leads', 'femme fatales', 'charming characters', 'female warriors');
  if (voice.style === 'young') hints.push('young characters', 'sidekicks', 'youthful protagonists');
  if (voice.style === 'pleasant') hints.push('friendly characters', 'guides', 'helpers');
  if (voice.style === 'emotional') hints.push('dramatic roles', 'emotional scenes', 'tragic characters', 'passionate warriors');
  if (voice.style === 'gentle') hints.push('kind characters', 'healers', 'wise elders');
  if (voice.style === 'Australian') hints.push('adventurers', 'outdoorsy characters', 'friendly rogues');
  if (voice.style === 'friendly') hints.push('sidekicks', 'companions', 'helpful characters');
  if (voice.style === 'shouty') hints.push('action heroes', 'military characters', 'angry roles', 'berserkers', 'battle cries');
  if (voice.style === 'anxious') hints.push('nervous characters', 'comic relief', 'tension roles');
  if (voice.style === 'calm') hints.push('stoic characters', 'wise figures', 'peaceful roles');
  if (voice.style === 'conversational') hints.push('everyday characters', 'relatable roles');
  if (voice.style === 'upbeat') hints.push('energetic characters', 'optimists', 'cheerful roles');
  if (voice.style === 'articulate') hints.push('intelligent characters', 'scholars', 'professionals');
  if (voice.style === 'British') hints.push('nobility', 'wizards', 'cultured characters', 'fantasy royalty');

  return hints;
}

/**
 * Build the system prompt for voice assignment
 */
function buildSystemPrompt() {
  return `You are an expert voice casting director for audiobook productions. Your job is to assign the perfect voice to each character based on their traits, the story context, and the available voice library.

CRITICAL RULES:
1. EVERY character MUST get a UNIQUE voice - no two characters can share the same voice
2. The narrator voice (provided separately) MUST NOT be assigned to any character
3. Match voice gender to character gender - male characters get male voices, female characters get female voices
4. Consider personality, role, and story context when selecting voices
5. Avoid obvious mismatches (e.g., don't give a "shouty" voice to a gentle healer)

VOICE SELECTION CRITERIA:
- Genre affects voice tone: horror = darker voices, romance = warmer voices, comedy = more expressive voices
- Character role matters: protagonists need engaging voices, villains need distinct/menacing voices
- Personality traits should match voice style: anxious character → anxious voice style
- Age considerations: young characters → younger-sounding voices when available
- Accent diversity: spread different accents across characters for variety

GENRE-SPECIFIC VOICE PRIORITIES:
- Heroic Fantasy / Sword & Sorcery: Use "gravelly", "deep", "authoritative" voices for warriors and heroes.
  AVOID generic/middle voices for main characters. Prefer Callum, Josh, Daniel for male heroes.
- Epic Fantasy: Prefer "warm", "authoritative" British voices for nobility and wise characters
- Action / Adventure: Use "shouty", "authoritative" for action heroes. Patrick is great for warriors.
- Horror: Use "raspy", "deep", "mysterious" voices. Avoid cheerful voices.
- Romance: Use "warm", "seductive", "emotional" voices. Charlotte, Elli are good choices.
- Children's / Bedtime: Use "soft", "warm", "gentle" voices. Bella, Matilda, Grace work well.

OUTPUT FORMAT:
Return a JSON object with:
{
  "assignments": [
    {
      "character_name": "exact character name",
      "voice_id": "THE ALPHANUMERIC ID STRING (e.g., TxGEqnHWrfWFTfGW9XjX) - NOT THE NAME",
      "voice_name": "voice name for reference only",
      "reasoning": "brief explanation of why this voice fits"
    }
  ],
  "validation": {
    "all_unique": true/false,
    "gender_matched": true/false,
    "narrator_excluded": true/false
  }
}

CRITICAL: The voice_id field MUST contain the alphanumeric ID string shown in parentheses in the voice list (like "TxGEqnHWrfWFTfGW9XjX"), NOT the human-readable name (like "Josh"). The voice_name is just for reference.

If you CANNOT make a valid assignment (e.g., more characters than available voices of matching gender), return:
{
  "error": "Description of the problem",
  "assignments": []
}`;
}

/**
 * Build the user prompt with all context
 * @param {Array} excludedVoices - Voice IDs to exclude (already assigned to other characters)
 */
function buildUserPrompt(characters, storyContext, narratorVoiceId, voiceLibrary, excludedVoices = []) {
  const { genre, mood, synopsis, audience, themes, setting } = storyContext;

  // Find narrator voice details
  const narratorVoice = voiceLibrary.find(v => v.voice_id === narratorVoiceId);

  // Build character descriptions using shared helper
  const characterDescriptions = characters.map(char => {
    const traits = parseCharacterTraits(char);

    return {
      name: char.name,
      role: char.role || 'supporting character',
      gender: char.gender || 'unknown',
      description: char.description || '',
      personality: traits.personality || traits.traits || [],
      // FIX: Read age from char.age_group (DB field) first, then traits, then default
      // char.age_group contains: 'child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elderly'
      age: char.age_group || char.age_specific || traits.age || 'adult'
    };
  });

  // Build available voices by gender, excluding narrator and already-assigned voices
  const excludedSet = new Set([narratorVoiceId, ...excludedVoices]);
  const maleVoices = voiceLibrary.filter(v => v.gender === 'male' && !excludedSet.has(v.voice_id));
  const femaleVoices = voiceLibrary.filter(v => v.gender === 'female' && !excludedSet.has(v.voice_id));

  return `STORY CONTEXT:
- Genre: ${genre || 'general fiction'}
- Mood/Tone: ${mood || 'neutral'}
- Target Audience: ${audience || 'general'}
- Setting: ${setting || 'Not specified'}
- Themes: ${themes ? (Array.isArray(themes) ? themes.join(', ') : themes) : 'Not specified'}

SYNOPSIS:
${synopsis || 'No synopsis provided'}

NARRATOR VOICE (DO NOT ASSIGN TO ANY CHARACTER):
- ID: ${narratorVoiceId}
- Name: ${narratorVoice?.name || 'Unknown'}
- Style: ${narratorVoice?.style || 'Unknown'}

CHARACTERS TO CAST (${characters.length} total):
${JSON.stringify(characterDescriptions, null, 2)}

AVAILABLE MALE VOICES (${maleVoices.length}):
${maleVoices.map(v => `- ${v.name} (${v.voice_id}): ${v.style} - ${v.description}. Good for: ${v.suitable_for.join(', ')}`).join('\n')}

AVAILABLE FEMALE VOICES (${femaleVoices.length}):
${femaleVoices.map(v => `- ${v.name} (${v.voice_id}): ${v.style} - ${v.description}. Good for: ${v.suitable_for.join(', ')}`).join('\n')}

Please assign a unique voice to each character, considering their personality, role, and the story's genre/mood.
Remember: Each character MUST have a different voice, and NO character can have the narrator's voice.`;
}

/**
 * Resolve voice names to voice IDs if the LLM returned names instead of IDs
 * This is a safety net in case the LLM doesn't follow instructions perfectly
 *
 * Handles multiple formats:
 * - Plain name: "Gigi" → looks up in nameToIdMap
 * - Name (ID) format: "Gigi (jBpfuIE2acCO8z3wKNLl)" → extracts ID from parentheses
 * - Already valid ID: "jBpfuIE2acCO8z3wKNLl" → keeps as-is
 */
function resolveVoiceNamesToIds(assignments, voiceLibrary) {
  const validVoiceIds = new Set(voiceLibrary.map(v => v.voice_id));
  const nameToIdMap = {};
  for (const v of voiceLibrary) {
    nameToIdMap[v.name.toLowerCase()] = v.voice_id;
  }

  for (const assignment of assignments) {
    // Skip if already a valid ID
    if (validVoiceIds.has(assignment.voice_id)) {
      continue;
    }

    // Try to extract ID from "Name (ID)" format - LLM often returns this format
    const parenMatch = assignment.voice_id.match(/\(([A-Za-z0-9]+)\)$/);
    if (parenMatch && validVoiceIds.has(parenMatch[1])) {
      logger.info(`[VoiceAssignment] Extracted voice ID from parentheses: "${parenMatch[1]}" for ${assignment.character_name}`);
      assignment.voice_id = parenMatch[1];
      continue;
    }

    // Try to resolve as a plain name
    const resolvedId = nameToIdMap[assignment.voice_id.toLowerCase()];
    if (resolvedId) {
      logger.warn(`[VoiceAssignment] Resolved voice name "${assignment.voice_id}" to ID "${resolvedId}" for ${assignment.character_name}`);
      assignment.voice_id = resolvedId;
      continue;
    }

    // Also try extracting just the name part before parentheses and resolving that
    const nameBeforeParen = assignment.voice_id.split('(')[0].trim().toLowerCase();
    if (nameBeforeParen && nameToIdMap[nameBeforeParen]) {
      logger.warn(`[VoiceAssignment] Resolved voice name part "${nameBeforeParen}" to ID "${nameToIdMap[nameBeforeParen]}" for ${assignment.character_name}`);
      assignment.voice_id = nameToIdMap[nameBeforeParen];
    }
  }

  return assignments;
}

/**
 * Auto-repair duplicate voice assignments by reassigning to unused voices
 * This handles the case where the LLM assigns the same voice to multiple characters
 *
 * @param {Array} assignments - Voice assignments from LLM
 * @param {string} narratorVoiceId - Narrator voice to exclude
 * @param {Array} voiceLibrary - Available voices
 * @returns {Array} Repaired assignments with unique voices
 */
function repairDuplicateAssignments(assignments, narratorVoiceId, voiceLibrary) {
  const usedVoiceIds = new Set();
  const duplicates = [];

  // First pass: identify duplicates
  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    if (usedVoiceIds.has(assignment.voice_id)) {
      duplicates.push(i);
    } else {
      usedVoiceIds.add(assignment.voice_id);
    }
  }

  if (duplicates.length === 0) {
    return assignments; // No duplicates, return as-is
  }

  logger.warn(`[VoiceAssignment] Found ${duplicates.length} duplicate voice assignments - auto-repairing`);

  // Build set of available voices (excluding narrator and already used voices)
  const availableVoices = voiceLibrary.filter(v =>
    v.voice_id !== narratorVoiceId && !usedVoiceIds.has(v.voice_id)
  );

  // Group available voices by gender for smarter reassignment
  const availableByGender = {
    male: availableVoices.filter(v => v.gender === 'male'),
    female: availableVoices.filter(v => v.gender === 'female')
  };

  // Second pass: repair duplicates
  for (const dupIndex of duplicates) {
    const assignment = assignments[dupIndex];
    const originalVoice = voiceLibrary.find(v => v.voice_id === assignment.voice_id);
    const preferredGender = originalVoice?.gender || 'male';

    // Try to get a voice of the same gender first
    let newVoice = availableByGender[preferredGender]?.shift();

    // If no voice of same gender, try any gender
    if (!newVoice) {
      const otherGender = preferredGender === 'male' ? 'female' : 'male';
      newVoice = availableByGender[otherGender]?.shift();
    }

    if (newVoice) {
      logger.info(`[VoiceAssignment] Reassigned ${assignment.character_name} from ${originalVoice?.name || assignment.voice_id} to ${newVoice.name}`);
      assignment.voice_id = newVoice.voice_id;
      assignment.voice_name = newVoice.name;
      assignment.reasoning = `(auto-reassigned to avoid duplicate) ${assignment.reasoning || ''}`;
      usedVoiceIds.add(newVoice.voice_id);
    } else {
      // No more voices available - this will fail validation but at least we tried
      logger.error(`[VoiceAssignment] Cannot repair duplicate for ${assignment.character_name} - no more voices available`);
    }
  }

  return assignments;
}

/**
 * Validate the LLM's voice assignments
 * @throws Error if validation fails
 */
function validateAssignments(assignments, characters, narratorVoiceId, voiceLibrary) {
  const errors = [];

  // Check we have assignments for all characters
  if (assignments.length !== characters.length) {
    errors.push(`Expected ${characters.length} assignments, got ${assignments.length}`);
  }

  // Check for duplicate voice IDs
  const usedVoiceIds = new Set();
  for (const assignment of assignments) {
    if (usedVoiceIds.has(assignment.voice_id)) {
      errors.push(`Duplicate voice assignment: ${assignment.voice_id} (${assignment.voice_name}) assigned to multiple characters`);
    }
    usedVoiceIds.add(assignment.voice_id);
  }

  // Check narrator voice not used
  const narratorUsed = assignments.find(a => a.voice_id === narratorVoiceId);
  if (narratorUsed) {
    errors.push(`Narrator voice assigned to character "${narratorUsed.character_name}" - this is not allowed`);
  }

  // Check voice IDs are valid
  const validVoiceIds = new Set(voiceLibrary.map(v => v.voice_id));
  for (const assignment of assignments) {
    if (!validVoiceIds.has(assignment.voice_id)) {
      errors.push(`Invalid voice_id "${assignment.voice_id}" for character "${assignment.character_name}"`);
    }
  }

  // Check gender matching
  for (const assignment of assignments) {
    const character = characters.find(c => c.name.toLowerCase() === assignment.character_name.toLowerCase());
    const voice = voiceLibrary.find(v => v.voice_id === assignment.voice_id);

    if (character && voice && character.gender && voice.gender) {
      if (character.gender !== voice.gender && character.gender !== 'unknown') {
        errors.push(`Gender mismatch: ${character.name} (${character.gender}) assigned ${voice.name} (${voice.gender})`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Voice assignment validation failed:\n- ${errors.join('\n- ')}`);
  }

  return true;
}

/**
 * Assign voices to characters using LLM intelligence
 *
 * @param {Array} characters - Characters to assign voices to
 * @param {Object} storyContext - Story context (genre, mood, synopsis, etc.)
 * @param {string} narratorVoiceId - The narrator's voice ID (must not be assigned to characters)
 * @param {string} sessionId - Session ID for tracking
 * @param {Array<string>} excludedVoices - Voice IDs to exclude (already assigned to other characters)
 * @returns {Object} Map of {characterName: voiceId}
 * @throws Error if voice assignment fails (PREMIUM - no fallbacks)
 */
export async function assignVoicesByLLM(characters, storyContext, narratorVoiceId, sessionId = null, excludedVoices = []) {
  if (!characters || characters.length === 0) {
    logger.warn('[VoiceAssignment] No characters provided');
    return {};
  }

  logger.info(`[VoiceAssignment] Starting LLM-based voice assignment for ${characters.length} characters`);
  logger.info(`[VoiceAssignment] Story context: genre=${storyContext.genre}, mood=${storyContext.mood}, audience=${storyContext.audience}`);

  const voiceLibrary = buildVoiceLibrary();

  // Pre-validation: Do we have enough voices?
  // Filter out narrator voice AND any excluded voices (already assigned to other characters)
  const excludedSet = new Set([narratorVoiceId, ...excludedVoices]);
  const maleCharacters = characters.filter(c => c.gender === 'male' || !c.gender);
  const femaleCharacters = characters.filter(c => c.gender === 'female');
  const maleVoices = voiceLibrary.filter(v => v.gender === 'male' && !excludedSet.has(v.voice_id));
  const femaleVoices = voiceLibrary.filter(v => v.gender === 'female' && !excludedSet.has(v.voice_id));

  if (excludedVoices.length > 0) {
    logger.info(`[VoiceAssignment] Excluding ${excludedVoices.length} already-assigned voices from pool`);
  }

  logger.info(`[VoiceAssignment] Character breakdown: ${maleCharacters.length} male/unknown, ${femaleCharacters.length} female`);
  logger.info(`[VoiceAssignment] Available voices: ${maleVoices.length} male, ${femaleVoices.length} female (excluding narrator)`);

  // FAIL LOUDLY if we don't have enough voices
  if (femaleCharacters.length > femaleVoices.length) {
    throw new Error(`VOICE ASSIGNMENT FAILED: ${femaleCharacters.length} female characters but only ${femaleVoices.length} female voices available (excluding narrator). ` +
      `Cannot guarantee unique voice assignment. Please reduce the number of female characters or contact support.`);
  }

  // For male/unknown, we have more flexibility
  const neededMaleVoices = maleCharacters.length;
  if (neededMaleVoices > maleVoices.length) {
    throw new Error(`VOICE ASSIGNMENT FAILED: ${neededMaleVoices} male/unknown characters but only ${maleVoices.length} male voices available (excluding narrator). ` +
      `Cannot guarantee unique voice assignment. Please reduce the number of characters or contact support.`);
  }

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(characters, storyContext, narratorVoiceId, voiceLibrary, excludedVoices);

    logger.info(`[VoiceAssignment] Calling LLM for intelligent voice casting...`);

    const response = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      agent_name: 'VoiceAssignmentAgent',
      agent_category: 'utility',
      contentSettings: { audience: storyContext.audience || 'general' },
      max_tokens: 2000,
      temperature: 0.4, // Some creativity but consistent results
      response_format: { type: 'json_object' },
      sessionId
    });

    const content = response?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    // ENHANCED LOGGING: Log raw LLM response for debugging voice casting issues
    logger.info(`[VoiceAssignment] Raw LLM response (first 500 chars): ${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`);
    logger.debug(`[VoiceAssignment] Full LLM response: ${content}`);

    const result = JSON.parse(content);

    // Check if LLM returned an error
    if (result.error) {
      throw new Error(`LLM voice assignment failed: ${result.error}`);
    }

    let assignments = result.assignments || [];

    // Resolve voice names to IDs if the LLM returned names instead of IDs
    assignments = resolveVoiceNamesToIds(assignments, voiceLibrary);

    // Auto-repair duplicate voice assignments before validation
    // The LLM sometimes assigns the same voice to multiple characters despite instructions
    assignments = repairDuplicateAssignments(assignments, narratorVoiceId, voiceLibrary);

    // Validate the assignments
    validateAssignments(assignments, characters, narratorVoiceId, voiceLibrary);

    // Convert to the expected format: {characterName: voiceId}
    const voiceMap = {};
    for (const assignment of assignments) {
      const charNameLower = assignment.character_name.toLowerCase();
      voiceMap[charNameLower] = assignment.voice_id;
      logger.info(`[VoiceAssignment] ${assignment.character_name} → ${assignment.voice_name} (${assignment.voice_id}): ${assignment.reasoning}`);
    }

    logger.info(`[VoiceAssignment] Successfully assigned ${Object.keys(voiceMap).length} unique voices`);

    return voiceMap;

  } catch (error) {
    // FAIL LOUDLY - no fallbacks for premium service
    logger.error(`[VoiceAssignment] CRITICAL FAILURE: ${error.message}`);
    throw new Error(`VOICE ASSIGNMENT FAILED: ${error.message}. Story generation cannot continue without proper voice casting.`);
  }
}

/**
 * Validate existing voice assignments for consistency
 * Used when loading from database to ensure integrity
 *
 * @param {Object} characterVoices - {charName: voiceId} map
 * @param {string} narratorVoiceId - Narrator voice to check against
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateExistingAssignments(characterVoices, narratorVoiceId) {
  const errors = [];
  const voiceIds = Object.values(characterVoices);

  // Check for duplicates
  const uniqueVoices = new Set(voiceIds);
  if (uniqueVoices.size !== voiceIds.length) {
    const duplicates = voiceIds.filter((v, i) => voiceIds.indexOf(v) !== i);
    errors.push(`Duplicate voice assignments detected: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Check narrator conflict
  for (const [charName, voiceId] of Object.entries(characterVoices)) {
    if (voiceId === narratorVoiceId) {
      errors.push(`Character "${charName}" has same voice as narrator`);
    }
  }

  // Check for null/undefined voices
  for (const [charName, voiceId] of Object.entries(characterVoices)) {
    if (!voiceId) {
      errors.push(`Character "${charName}" has null/undefined voice`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  assignVoicesByLLM,
  validateExistingAssignments,
  buildVoiceLibrary
};
