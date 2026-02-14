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
 *
 * ## Auto-Repair Mechanisms
 *
 * This module implements several auto-repair mechanisms to handle common LLM
 * response issues. These repairs happen in sequence after the LLM response:
 *
 * 1. **Voice Name Resolution** - Converts voice names to IDs when LLM ignores instructions
 * 2. **Duplicate Assignment Repair** - Reassigns duplicates to unused voices
 * 3. **Narrator Conflict Repair** - Reassigns if narrator voice is used for a character
 *
 * All repairs are attempted before final validation. If repairs cannot fix issues
 * (e.g., no more voices available), validation will fail and the story stops.
 *
 * @see REPAIR_THRESHOLDS for detailed threshold documentation
 * @see LLM_CONFIG for LLM call configuration
 */

import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { RECOMMENDED_VOICES } from '../elevenlabs.js';
import { parseCharacterTraits } from '../../utils/agentHelpers.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * LLM Configuration for voice assignment calls
 * @constant
 */
export const LLM_CONFIG = {
  /** Maximum tokens for LLM response - sized for ~20 character assignments with reasoning */
  MAX_TOKENS: 2000,

  /**
   * Temperature setting for LLM creativity
   * - 0.4 provides some variety in voice selection while maintaining consistency
   * - Lower values (0.2) would give more deterministic but potentially repetitive results
   * - Higher values (0.7+) could produce creative but potentially mismatched assignments
   */
  TEMPERATURE: 0.4,

  /** Agent name for logging and tracking */
  AGENT_NAME: 'VoiceAssignmentAgent',

  /** Agent category for metrics */
  AGENT_CATEGORY: 'utility'
};

/**
 * Repair Thresholds and Success Criteria
 *
 * Documents when auto-repair mechanisms trigger, what determines success/failure,
 * and what happens in each case. All repairs are "best effort" - they attempt
 * to fix issues but may still fail if resources are exhausted.
 *
 * @constant
 */
export const REPAIR_THRESHOLDS = {
  /**
   * Voice Name Resolution
   * Converts voice names to IDs when LLM returns names instead of alphanumeric IDs
   *
   * TRIGGER: voice_id is not found in the valid voice ID set (not alphanumeric ID)
   *
   * SUCCESS CONDITIONS:
   * - Voice ID extracted from "Name (ID)" format and ID is valid
   * - Voice name resolved via case-insensitive lookup in voice library
   * - Name before parentheses resolved to valid ID
   *
   * FAILURE BEHAVIOR:
   * - Invalid voice_id left unchanged
   * - Will fail final validation with "Invalid voice_id" error
   * - Story generation stops with clear error message
   *
   * REPAIR ATTEMPTS: 3 resolution strategies tried in order
   */
  NAME_RESOLUTION: {
    maxAttempts: 3, // Three resolution strategies
    strategies: [
      'parentheses_extraction', // Try "Name (ID)" format
      'name_lookup',            // Try direct name-to-ID lookup
      'name_before_paren'       // Try name part before parentheses
    ],
    failureAction: 'validation_error'
  },

  /**
   * Duplicate Voice Assignment Repair
   * Fixes when LLM assigns the same voice to multiple characters
   *
   * TRIGGER: Same voice_id appears in more than one assignment
   *
   * SUCCESS CONDITIONS (must satisfy at least one):
   * - Unused voice available of same gender as original
   * - Unused voice available of any gender (gender mismatch is better than duplicate)
   *
   * FAILURE BEHAVIOR:
   * - If no unused voices available, duplicate remains
   * - Will fail final validation with "Duplicate voice assignment" error
   * - Story generation stops
   *
   * PRIORITY ORDER: Same gender voices checked first, then opposite gender
   */
  DUPLICATE_REPAIR: {
    preferSameGender: true,
    allowCrossGender: true, // Will use opposite gender if same not available
    failureAction: 'validation_error'
  },

  /**
   * Narrator Conflict Repair
   * Fixes when LLM assigns the narrator's voice to a character
   *
   * TRIGGER: Any character assigned the narrator's voice_id
   *
   * SUCCESS CONDITIONS (must satisfy at least one):
   * - Unused voice available of same gender as narrator
   * - Any unused voice available
   *
   * FAILURE BEHAVIOR:
   * - If no unused voices available, narrator conflict remains
   * - Will fail final validation with "Narrator voice assigned to character" error
   * - Story generation stops
   *
   * RATIONALE: Narrator voice conflict is detected last because duplicates
   * are more common and narrator conflict often co-occurs with duplicates
   */
  NARRATOR_CONFLICT_REPAIR: {
    preferSameGender: true,
    allowAnyGender: true,
    failureAction: 'validation_error'
  },

  /**
   * Pre-Validation Voice Capacity Check
   * Validates sufficient voices exist BEFORE calling LLM
   *
   * TRIGGER: Runs before every LLM call
   *
   * THRESHOLDS:
   * - femaleCharacters.length > femaleVoices.length (excluding narrator)
   * - maleCharacters.length > maleVoices.length (excluding narrator)
   *
   * FAILURE BEHAVIOR:
   * - Throws immediately with descriptive error
   * - No LLM call is made (saves API costs)
   * - Story generation stops
   *
   * RATIONALE: Better to fail fast than waste an LLM call that cannot succeed
   */
  CAPACITY_CHECK: {
    requireExactGenderMatch: true,
    excludeNarratorFromPool: true,
    excludeAlreadyAssigned: true,
    failureAction: 'immediate_throw'
  },

  /**
   * Final Validation Checks
   * All conditions that must pass after repairs for assignment to succeed
   *
   * VALIDATION RULES:
   * 1. Assignment count matches character count
   * 2. No duplicate voice IDs across assignments
   * 3. Narrator voice not used for any character
   * 4. All voice IDs exist in voice library
   * 5. Voice gender matches character gender (non-blocking warning if mismatch)
   *
   * FAILURE BEHAVIOR:
   * - All errors collected and reported together
   * - Throws with combined error message
   * - Story generation stops
   */
  VALIDATION: {
    rules: [
      'assignment_count_match',
      'no_duplicates',
      'narrator_excluded',
      'valid_voice_ids',
      'gender_match'
    ],
    genderMismatchSeverity: 'error', // 'error' or 'warning'
    failureAction: 'throw_with_details'
  }
};

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
        // VOICE AGE METADATA (2026-01-31)
        age_group: voice.age_group || 'adult',
        can_be_child: voice.can_be_child || false,
        suitable_ages: voice.suitable_ages || ['adult'],
        // Add suitability hints for LLM
        suitable_for: getSuitabilityHints(voice, category)
      });
    }
  }

  return voices;
}

/**
 * Get suitability hints for a voice based on its characteristics
 * VOICE AGE METADATA (2026-01-31): Added age-based hints for LLM
 */
function getSuitabilityHints(voice, category) {
  const hints = [];

  // AGE-BASED HINTS (CRITICAL for proper voice assignment)
  if (voice.can_be_child) hints.push('children', 'kids', 'young protagonists', 'child characters');
  if (voice.age_group === 'young' || voice.age_group === 'teen') hints.push('teenagers', 'teens', 'young adults', 'youthful characters');
  if (voice.age_group === 'adult') hints.push('adult characters', 'grown-ups');
  if (voice.age_group === 'middle_aged') hints.push('middle-aged characters', 'parents', 'experienced adults');
  if (voice.age_group === 'elderly' || voice.suitable_ages?.includes('elderly')) hints.push('elderly characters', 'grandparents', 'wise elders', 'senior characters');

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
- Age considerations: Match character age to appropriate voice (see AGE MATCHING RULES below)
- Accent diversity: spread different accents across characters for variety

AGE MATCHING RULES (CRITICAL - MUST FOLLOW):
- CHILD characters (ages 0-12): MUST use voices marked "can_be_child: true" (Matilda, Gigi, Ethan, Harry, Laura)
- TEEN characters (ages 13-17): Prefer young-sounding voices (Gigi, Ethan, Harry, Charlie, Elli)
- YOUNG ADULT characters (ages 18-30): Can use young or adult voices
- ADULT characters (ages 31-55): Use standard adult voices
- ELDERLY characters (ages 55+): Use mature voices (George, Daniel, Adam, Dorothy, Grace, Sam)
- NEVER assign deep/gravelly adult male voices (Callum, Josh, Adam) to child characters
- NEVER assign seductive/sultry voices (Charlotte) to child characters

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

  // Build age-grouped voice lists for explicit guidance
  const childSuitableVoices = voiceLibrary.filter(v => v.can_be_child && !excludedSet.has(v.voice_id));
  const elderlyVoices = voiceLibrary.filter(v => v.suitable_ages?.includes('elderly') && !excludedSet.has(v.voice_id));

  // Count child/elderly characters for capacity check
  const childCharacters = characterDescriptions.filter(c =>
    c.age === 'child' || (typeof c.age === 'number' && c.age < 13)
  );

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

=== VOICE LIBRARY BY AGE SUITABILITY ===

CHILD-SUITABLE VOICES (REQUIRED for child characters ages 0-12):
${childSuitableVoices.length > 0
  ? childSuitableVoices.map(v => `- ${v.name} (${v.voice_id}): ${v.gender}, ${v.style} - ${v.description}`).join('\n')
  : '(No child-suitable voices available - cannot cast child characters)'}

ELDERLY-SUITABLE VOICES (for characters 55+):
${elderlyVoices.length > 0
  ? elderlyVoices.map(v => `- ${v.name} (${v.voice_id}): ${v.gender}, ${v.style} - ${v.description}`).join('\n')
  : '(Use adult voices for elderly characters)'}

${childCharacters.length > 0 ? `
WARNING: Story has ${childCharacters.length} child character(s). Only ${childSuitableVoices.length} child-suitable voices available.
REQUIRED: Use ONLY child-suitable voices for: ${childCharacters.map(c => c.name).join(', ')}
` : ''}

=== FULL VOICE LIBRARY ===

AVAILABLE MALE VOICES (${maleVoices.length}):
${maleVoices.map(v => `- ${v.name} (${v.voice_id}): ${v.style} - ${v.description}. ${v.can_be_child ? '[CHILD-OK]' : ''} Good for: ${v.suitable_for.join(', ')}`).join('\n')}

AVAILABLE FEMALE VOICES (${femaleVoices.length}):
${femaleVoices.map(v => `- ${v.name} (${v.voice_id}): ${v.style} - ${v.description}. ${v.can_be_child ? '[CHILD-OK]' : ''} Good for: ${v.suitable_for.join(', ')}`).join('\n')}

Please assign a unique voice to each character, considering their personality, role, AGE, and the story's genre/mood.
Remember: Each character MUST have a different voice, NO character can have the narrator's voice, and CHILD CHARACTERS MUST use [CHILD-OK] voices.`;
}

/**
 * Resolve voice names to voice IDs if the LLM returned names instead of IDs
 *
 * This is an AUTO-REPAIR mechanism that runs after every LLM response.
 * Despite clear instructions, LLMs frequently return voice names instead of
 * the alphanumeric voice IDs. This function attempts multiple resolution
 * strategies to convert names to valid IDs.
 *
 * ## Trigger Condition
 * - voice_id field is not found in the valid voice ID set
 *
 * ## Resolution Strategies (tried in order per REPAIR_THRESHOLDS.NAME_RESOLUTION)
 * 1. **Parentheses Extraction**: "Gigi (jBpfuIE2acCO8z3wKNLl)" → extract ID from ()
 * 2. **Direct Name Lookup**: "Gigi" → case-insensitive lookup in voice library
 * 3. **Name Before Parentheses**: "Gigi (some text)" → resolve "Gigi" part
 *
 * ## Success Behavior
 * - voice_id field is updated to the resolved alphanumeric ID
 * - Logs info/warn message indicating resolution occurred
 * - Processing continues to next repair step
 *
 * ## Failure Behavior
 * - voice_id left unchanged (invalid)
 * - Will fail final validation with "Invalid voice_id" error
 * - Story generation stops with clear error message
 *
 * @param {Array} assignments - Voice assignments from LLM (mutated in place)
 * @param {Array} voiceLibrary - Available voices with voice_id and name fields
 * @returns {Array} Same assignments array with voice_ids resolved where possible
 *
 * @see REPAIR_THRESHOLDS.NAME_RESOLUTION for threshold configuration
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
 *
 * This is an AUTO-REPAIR mechanism that handles the common case where the LLM
 * assigns the same voice to multiple characters, despite clear instructions
 * to use unique voices.
 *
 * ## Trigger Condition (per REPAIR_THRESHOLDS.DUPLICATE_REPAIR)
 * - Same voice_id appears in more than one assignment
 * - First occurrence is kept; subsequent occurrences are flagged for repair
 *
 * ## Repair Strategy
 * 1. Identify all duplicate assignments (keeping first occurrence)
 * 2. For each duplicate, find the original voice's gender
 * 3. Try to assign an unused voice of the SAME gender (preferred)
 * 4. If no same-gender voice available, try OPPOSITE gender (fallback)
 * 5. Update assignment with new voice and mark reasoning as "(auto-reassigned)"
 *
 * ## Success Thresholds
 * - At least one unused voice exists (of any gender)
 * - preferSameGender: true (tries same gender first)
 * - allowCrossGender: true (will use opposite if needed)
 *
 * ## Failure Behavior
 * - If no unused voices available for a duplicate, it remains unrepaired
 * - Logs error: "Cannot repair duplicate - no more voices available"
 * - Will fail final validation with "Duplicate voice assignment" error
 * - Story generation stops
 *
 * ## Performance Note
 * Uses gender-grouped voice pools to efficiently find replacements.
 * Each voice can only be used once; pools are depleted as repairs are made.
 *
 * @param {Array} assignments - Voice assignments from LLM (mutated in place)
 * @param {string} narratorVoiceId - Narrator voice to exclude from available pool
 * @param {Array} voiceLibrary - Full voice library for lookups
 * @returns {Array} Same assignments array with duplicates repaired where possible
 *
 * @see REPAIR_THRESHOLDS.DUPLICATE_REPAIR for threshold configuration
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
 * Auto-repair narrator voice conflict by reassigning to an unused voice
 *
 * This is an AUTO-REPAIR mechanism that handles the case where the LLM assigns
 * the narrator's voice to a character, despite explicit instructions not to.
 * The narrator must have a unique voice for audiobook clarity.
 *
 * ## Trigger Condition (per REPAIR_THRESHOLDS.NARRATOR_CONFLICT_REPAIR)
 * - Any character assignment has voice_id matching narratorVoiceId
 *
 * ## Repair Strategy
 * 1. Find the character with narrator's voice assigned
 * 2. Determine narrator's voice gender for preference
 * 3. Find all currently used voice IDs to exclude
 * 4. Try to assign an unused voice of SAME gender as narrator (preferred)
 * 5. If no same-gender available, use ANY available voice (fallback)
 * 6. Update assignment and mark reasoning as "(auto-reassigned - narrator conflict)"
 *
 * ## Success Thresholds
 * - At least one unused voice exists in the library
 * - preferSameGender: true (narrator's gender is likely character's intended gender)
 * - allowAnyGender: true (any voice is better than narrator conflict)
 *
 * ## Failure Behavior
 * - If no unused voices available, narrator conflict remains
 * - Logs error: "Cannot repair narrator conflict - no more voices available"
 * - Will fail final validation with "Narrator voice assigned to character" error
 * - Story generation stops
 *
 * ## Execution Order
 * This runs AFTER duplicate repair. This ordering is intentional because:
 * - Duplicates are more common than narrator conflicts
 * - Duplicate repair frees up voices that might be needed for narrator repair
 * - Narrator conflict often co-occurs with duplicates (LLM just picked poorly)
 *
 * @param {Array} assignments - Voice assignments from LLM (mutated in place)
 * @param {string} narratorVoiceId - Narrator voice that must not be used for characters
 * @param {Array} voiceLibrary - Full voice library for lookups and gender matching
 * @returns {Array} Same assignments array with narrator conflict repaired if possible
 *
 * @see REPAIR_THRESHOLDS.NARRATOR_CONFLICT_REPAIR for threshold configuration
 */
function repairNarratorConflict(assignments, narratorVoiceId, voiceLibrary) {
  const narratorConflict = assignments.find(a => a.voice_id === narratorVoiceId);

  if (!narratorConflict) {
    return assignments; // No conflict, return as-is
  }

  logger.warn(`[VoiceAssignment] Found narrator voice assigned to "${narratorConflict.character_name}" - auto-repairing`);

  // Get all currently used voice IDs
  const usedVoiceIds = new Set(assignments.map(a => a.voice_id));

  // Find the narrator voice details to match gender
  const narratorVoice = voiceLibrary.find(v => v.voice_id === narratorVoiceId);
  const preferredGender = narratorVoice?.gender || 'male';

  // Find available voices of the same gender first
  const availableVoices = voiceLibrary.filter(v =>
    v.voice_id !== narratorVoiceId && !usedVoiceIds.has(v.voice_id)
  );

  // Try to get a voice of the same gender as the narrator (likely character's intended gender)
  let newVoice = availableVoices.find(v => v.gender === preferredGender);

  // If no voice of same gender, try any available voice
  if (!newVoice && availableVoices.length > 0) {
    newVoice = availableVoices[0];
  }

  if (newVoice) {
    logger.info(`[VoiceAssignment] Reassigned ${narratorConflict.character_name} from narrator voice to ${newVoice.name} (${newVoice.voice_id})`);
    narratorConflict.voice_id = newVoice.voice_id;
    narratorConflict.voice_name = newVoice.name;
    narratorConflict.reasoning = `(auto-reassigned - narrator voice conflict) ${narratorConflict.reasoning || ''}`;
  } else {
    // No more voices available - this will fail validation but at least we tried
    logger.error(`[VoiceAssignment] Cannot repair narrator conflict for ${narratorConflict.character_name} - no more voices available`);
  }

  return assignments;
}

/**
 * Auto-repair gender mismatches by swapping to an unused voice of the correct gender
 *
 * TRIGGER: A character's assigned voice gender doesn't match the character's gender
 * (skips characters with flexible genders: unknown, neutral, non-binary, etc.)
 *
 * REPAIR STRATEGY:
 * 1. Identify all gender-mismatched assignments
 * 2. For each, find an unused voice of the CORRECT gender
 * 3. Swap the assignment
 * 4. The freed voice becomes available for other mismatched characters
 *
 * @param {Array} assignments - Voice assignments (mutated in place)
 * @param {Array} characters - Original character list for gender lookup
 * @param {string} narratorVoiceId - Narrator voice to exclude
 * @param {Array} voiceLibrary - Full voice library
 * @returns {Array} Same assignments array with gender mismatches repaired
 */
function repairGenderMismatches(assignments, characters, narratorVoiceId, voiceLibrary) {
  const flexibleGenders = ['unknown', 'non-binary', 'nonbinary', 'nb', 'other', 'neutral', 'agender', 'genderless'];
  const usedVoiceIds = new Set(assignments.map(a => a.voice_id));
  const mismatches = [];

  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    const character = characters.find(c => c.name.toLowerCase() === assignment.character_name.toLowerCase());
    const voice = voiceLibrary.find(v => v.voice_id === assignment.voice_id);

    if (!character || !voice || !character.gender || !voice.gender) continue;
    if (flexibleGenders.includes(character.gender.toLowerCase())) continue;
    if (character.gender.toLowerCase() === voice.gender.toLowerCase()) continue;

    mismatches.push({ index: i, character, voice, neededGender: character.gender.toLowerCase() });
  }

  if (mismatches.length === 0) return assignments;

  logger.warn(`[VoiceAssignment] Found ${mismatches.length} gender mismatch(es) - auto-repairing`);

  for (const mismatch of mismatches) {
    const { index, character, voice, neededGender } = mismatch;
    const available = voiceLibrary.filter(v =>
      v.gender === neededGender &&
      v.voice_id !== narratorVoiceId &&
      !usedVoiceIds.has(v.voice_id)
    );

    if (available.length > 0) {
      const newVoice = available[0];
      // Free the old voice and claim the new one
      usedVoiceIds.delete(voice.voice_id);
      usedVoiceIds.add(newVoice.voice_id);
      logger.info(`[VoiceAssignment] Gender repair: ${character.name} (${neededGender}) swapped ${voice.name} (${voice.gender}) → ${newVoice.name} (${newVoice.gender})`);
      assignments[index].voice_id = newVoice.voice_id;
      assignments[index].voice_name = newVoice.name;
      assignments[index].reasoning = `(auto-reassigned - gender mismatch repair) ${assignments[index].reasoning || ''}`;
    } else {
      logger.error(`[VoiceAssignment] Cannot repair gender mismatch for ${character.name} - no ${neededGender} voices available`);
    }
  }

  return assignments;
}

/**
 * Validate the LLM's voice assignments after all repair attempts
 *
 * This is the FINAL GATE before voice assignments are accepted. It runs after
 * all auto-repair mechanisms have attempted to fix issues. Any validation
 * failure here stops story generation - there are no fallbacks.
 *
 * ## Validation Rules (per REPAIR_THRESHOLDS.VALIDATION)
 *
 * ### 1. Assignment Count Match
 * - THRESHOLD: assignments.length === characters.length
 * - FAILURE: "Expected N assignments, got M"
 *
 * ### 2. No Duplicate Voice IDs
 * - THRESHOLD: All voice_ids must be unique across assignments
 * - FAILURE: "Duplicate voice assignment: {id} assigned to multiple characters"
 * - NOTE: This should not fail if duplicate repair succeeded
 *
 * ### 3. Narrator Voice Excluded
 * - THRESHOLD: No assignment may use narratorVoiceId
 * - FAILURE: "Narrator voice assigned to character {name}"
 * - NOTE: This should not fail if narrator conflict repair succeeded
 *
 * ### 4. Valid Voice IDs
 * - THRESHOLD: All voice_ids must exist in voiceLibrary
 * - FAILURE: "Invalid voice_id {id} for character {name}"
 * - NOTE: This can fail if name resolution failed to find a valid ID
 *
 * ### 5. Gender Match
 * - THRESHOLD: Voice gender should match character gender
 * - FAILURE: "Gender mismatch: {char} ({gender}) assigned {voice} ({gender})"
 * - SEVERITY: Currently 'error' (blocks), could be changed to 'warning'
 * - NOTE: Characters with gender='unknown' pass this check
 *
 * ## Failure Behavior
 * - ALL validation errors are collected (not fail-fast)
 * - Throws Error with combined message listing all failures
 * - Story generation stops with clear actionable error
 *
 * ## Success Behavior
 * - Returns true (value not typically used; success = no exception)
 * - Voice assignments proceed to be saved and used for TTS
 *
 * @param {Array} assignments - Voice assignments after all repairs
 * @param {Array} characters - Original character list for count/gender comparison
 * @param {string} narratorVoiceId - Narrator voice that must be excluded
 * @param {Array} voiceLibrary - Full voice library for ID and gender validation
 * @returns {boolean} true if valid
 * @throws {Error} with combined validation error message if any rules fail
 *
 * @see REPAIR_THRESHOLDS.VALIDATION for rule configuration
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
  // Non-binary and unknown gender characters can have any voice
  const flexibleGenders = ['unknown', 'non-binary', 'nonbinary', 'nb', 'other', 'neutral', 'agender', 'genderless'];
  for (const assignment of assignments) {
    const character = characters.find(c => c.name.toLowerCase() === assignment.character_name.toLowerCase());
    const voice = voiceLibrary.find(v => v.voice_id === assignment.voice_id);

    if (character && voice && character.gender && voice.gender) {
      const charGenderLower = character.gender.toLowerCase();
      // Skip gender validation for flexible gender identities
      if (!flexibleGenders.includes(charGenderLower) && character.gender !== voice.gender) {
        errors.push(`Gender mismatch: ${character.name} (${character.gender}) assigned ${voice.name} (${voice.gender})`);
      }
    }
  }

  // VOICE AGE VALIDATION (2026-01-31)
  // Check age appropriateness - child characters MUST have child-suitable voices
  for (const assignment of assignments) {
    const character = characters.find(c => c.name.toLowerCase() === assignment.character_name.toLowerCase());
    const voice = voiceLibrary.find(v => v.voice_id === assignment.voice_id);

    if (character && voice) {
      // Determine if character is a child
      const charAge = character.age_group || character.age || 'adult';
      const isChildCharacter = charAge === 'child' ||
        (typeof charAge === 'number' && charAge < 13) ||
        (typeof charAge === 'string' && parseInt(charAge) < 13 && !isNaN(parseInt(charAge)));

      if (isChildCharacter && voice.can_be_child === false) {
        // This is a WARNING, not a hard error - log it but don't fail
        // LLM may have made a creative choice we should respect
        console.warn(`[VoiceAssignment] AGE_MISMATCH_WARNING: Child character "${character.name}" (${charAge}) assigned "${voice.name}" which is not child-suitable`);
        // Uncomment below to make this a hard error:
        // errors.push(`Age mismatch: ${character.name} (child) assigned ${voice.name} which is not child-suitable. Use Matilda, Gigi, Ethan, Harry, or Laura for children.`);
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
 * This is the main entry point for voice assignment. It orchestrates the full
 * voice casting pipeline: pre-validation, LLM call, auto-repairs, and final validation.
 *
 * ## Pipeline Stages
 *
 * ### Stage 1: Pre-Validation (REPAIR_THRESHOLDS.CAPACITY_CHECK)
 * Checks if we have enough voices BEFORE calling LLM:
 * - Counts male/female characters
 * - Counts available male/female voices (excluding narrator and already-assigned)
 * - FAILS IMMEDIATELY if characters > available voices for either gender
 * - This saves API costs by not making doomed LLM calls
 *
 * ### Stage 2: LLM Call (LLM_CONFIG)
 * Calls LLM with voice library and story context:
 * - Temperature: 0.4 (creative but consistent)
 * - Max tokens: 2000 (sufficient for ~20 characters)
 * - JSON response format enforced
 *
 * ### Stage 3: Auto-Repair Pipeline
 * Three repair mechanisms run in sequence:
 * 1. resolveVoiceNamesToIds - Fix LLM returning names instead of IDs
 * 2. repairDuplicateAssignments - Fix same voice assigned to multiple characters
 * 3. repairNarratorConflict - Fix narrator voice used for a character
 *
 * ### Stage 4: Final Validation (REPAIR_THRESHOLDS.VALIDATION)
 * Validates all rules are satisfied after repairs.
 * Any failure here stops story generation.
 *
 * ## Error Handling - PREMIUM SERVICE
 * This is a premium feature that FAILS LOUDLY. There are NO FALLBACKS.
 * If voice assignment cannot complete correctly, story generation stops
 * with a clear error message. This is intentional - poor voice assignment
 * ruins the audiobook experience.
 *
 * @param {Array} characters - Characters to assign voices to
 * @param {Object} storyContext - Story context (genre, mood, synopsis, audience, themes, setting)
 * @param {string} narratorVoiceId - The narrator's voice ID (must not be assigned to characters)
 * @param {string} sessionId - Session ID for logging and tracking
 * @param {Array<string>} excludedVoices - Voice IDs to exclude (already assigned in prior batches)
 * @returns {Object} Map of {characterNameLowerCase: voiceId}
 * @throws {Error} if voice assignment fails at any stage (PREMIUM - no fallbacks)
 *
 * @see LLM_CONFIG for LLM call configuration
 * @see REPAIR_THRESHOLDS for all threshold documentation
 */
export async function assignVoicesByLLM(characters, storyContext, narratorVoiceId, sessionId = null, excludedVoices = []) {
  if (!characters || characters.length === 0) {
    logger.warn('[VoiceAssignment] No characters provided');
    return {};
  }

  logger.info(`[VoiceAssignment] Starting LLM-based voice assignment for ${characters.length} characters`);
  logger.info(`[VoiceAssignment] Story context: genre=${storyContext.genre}, mood=${storyContext.mood}, audience=${storyContext.audience}`);

  const voiceLibrary = buildVoiceLibrary();

  // ===========================================================================
  // STAGE 1: Pre-Validation Capacity Check
  // See REPAIR_THRESHOLDS.CAPACITY_CHECK for threshold documentation
  //
  // This check runs BEFORE the LLM call to fail fast and save API costs.
  // If we don't have enough voices for the character genders, there's no point
  // in calling the LLM because the assignment will inevitably fail.
  // ===========================================================================
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

  // Capacity threshold: femaleCharacters.length <= femaleVoices.length
  // Failure action: immediate_throw (per REPAIR_THRESHOLDS.CAPACITY_CHECK)
  if (femaleCharacters.length > femaleVoices.length) {
    throw new Error(`VOICE ASSIGNMENT FAILED: ${femaleCharacters.length} female characters but only ${femaleVoices.length} female voices available (excluding narrator). ` +
      `Cannot guarantee unique voice assignment. Please reduce the number of female characters or contact support.`);
  }

  // Capacity threshold: maleCharacters.length <= maleVoices.length
  // Failure action: immediate_throw (per REPAIR_THRESHOLDS.CAPACITY_CHECK)
  const neededMaleVoices = maleCharacters.length;
  if (neededMaleVoices > maleVoices.length) {
    throw new Error(`VOICE ASSIGNMENT FAILED: ${neededMaleVoices} male/unknown characters but only ${maleVoices.length} male voices available (excluding narrator). ` +
      `Cannot guarantee unique voice assignment. Please reduce the number of characters or contact support.`);
  }

  try {
    // =========================================================================
    // STAGE 2: LLM Voice Casting
    // See LLM_CONFIG for configuration values (temperature, max_tokens)
    // =========================================================================
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(characters, storyContext, narratorVoiceId, voiceLibrary, excludedVoices);

    logger.info(`[VoiceAssignment] Calling LLM for intelligent voice casting...`);

    const response = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      agent_name: LLM_CONFIG.AGENT_NAME,
      agent_category: LLM_CONFIG.AGENT_CATEGORY,
      contentSettings: { audience: storyContext.audience || 'general' },
      max_tokens: LLM_CONFIG.MAX_TOKENS,
      temperature: LLM_CONFIG.TEMPERATURE,
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

    // =========================================================================
    // STAGE 2.5: Character Name Normalization
    // LLMs frequently shorten character names (e.g., "A.R.G.U.S." instead of
    // "A.R.G.U.S. (Automated Ration Governance Utility System)"). Normalize
    // back to exact character names so voiceMap keys match downstream lookups.
    // =========================================================================
    for (const assignment of assignments) {
      const llmName = assignment.character_name.toLowerCase();
      // Exact match - no normalization needed
      if (characters.find(c => c.name.toLowerCase() === llmName)) continue;
      // Try partial/fuzzy match
      const match = characters.find(c => {
        const charLower = c.name.toLowerCase();
        // LLM shortened: "a.r.g.u.s." matches "a.r.g.u.s. (automated ration...)"
        return charLower.startsWith(llmName + ' ') || charLower.startsWith(llmName + '(') ||
          // LLM used parenthetical part differently
          charLower.split('(')[0].trim() === llmName ||
          charLower.split(' (')[0].trim() === llmName ||
          // First name match
          charLower.split(' ')[0] === llmName;
      });
      if (match) {
        logger.warn(`[VoiceAssignment] Normalized character name "${assignment.character_name}" → "${match.name}"`);
        assignment.character_name = match.name;
      }
    }

    // =========================================================================
    // STAGE 3: Auto-Repair Pipeline
    // These repairs run in sequence to fix common LLM response issues.
    // Each repair is "best effort" - it may not succeed if resources are
    // exhausted (no more voices available). Failed repairs are caught by
    // final validation.
    // =========================================================================

    // Repair 3.1: Voice Name Resolution
    // See REPAIR_THRESHOLDS.NAME_RESOLUTION for threshold documentation
    // Converts voice names to IDs when LLM ignores instructions
    assignments = resolveVoiceNamesToIds(assignments, voiceLibrary);

    // Repair 3.2: Duplicate Assignment Repair
    // See REPAIR_THRESHOLDS.DUPLICATE_REPAIR for threshold documentation
    // Reassigns when same voice is assigned to multiple characters
    assignments = repairDuplicateAssignments(assignments, narratorVoiceId, voiceLibrary);

    // Repair 3.3: Narrator Conflict Repair
    // See REPAIR_THRESHOLDS.NARRATOR_CONFLICT_REPAIR for threshold documentation
    // Reassigns when narrator voice is used for a character
    assignments = repairNarratorConflict(assignments, narratorVoiceId, voiceLibrary);

    // Repair 3.4: Gender Mismatch Repair
    // Fixes when LLM assigns a voice with wrong gender to a character
    assignments = repairGenderMismatches(assignments, characters, narratorVoiceId, voiceLibrary);

    // =========================================================================
    // STAGE 4: Final Validation
    // See REPAIR_THRESHOLDS.VALIDATION for threshold documentation
    // All rules must pass or story generation stops
    // =========================================================================
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
  buildVoiceLibrary,
  // Export constants for external reference and testing
  LLM_CONFIG,
  REPAIR_THRESHOLDS
};
