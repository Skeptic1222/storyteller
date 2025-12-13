/**
 * ============================================================================
 * DIALOGUE TAGGING AGENT - PREMIUM MULTI-VOICE ATTRIBUTION SYSTEM
 * ============================================================================
 *
 * VERSION: 1.0.0
 * DATE: 2025-12-09
 * STATUS: PRODUCTION - DO NOT MODIFY WITHOUT THOROUGH TESTING
 *
 * ============================================================================
 * CRITICAL: READ BEFORE MODIFYING
 * ============================================================================
 *
 * This agent is the AUTHORITATIVE source for dialogue speaker attribution.
 * It replaced the broken regex-based system that caused:
 * - Male voices for female characters ("she mutters" → wrong character)
 * - Pronoun resolution failures
 * - Gender mismatches in multi-voice narration
 *
 * DO NOT:
 * - Re-enable regex-based parseDialogueSegments() in openai.js
 * - Add "silent fallbacks" - system must FAIL LOUDLY
 * - Skip calling this agent after scene generation
 * - Use dialogueAttributionAgent.js as primary (it's deprecated fallback)
 *
 * ============================================================================
 * HOW IT WORKS
 * ============================================================================
 *
 * This agent runs IMMEDIATELY after scene generation to capture WHO speaks
 * each line of dialogue. Unlike post-hoc attribution, this agent tags
 * dialogue AT THE SOURCE while context is fresh.
 *
 * FLOW:
 * 1. Scene Writer generates prose with dialogue
 * 2. Scene saved to database (story_scenes table)
 * 3. ★ THIS AGENT runs with GPT-5.1 ★
 * 4. dialogue_map stored in story_scenes.dialogue_map
 * 5. Audio generation reads pre-computed map (no duplicate LLM calls)
 *
 * KEY PRINCIPLES:
 * 1. Uses GPT-5.1 (coherence tier) for premium accuracy - NO FALLBACKS
 * 2. Captures speaker metadata during story creation, not TTS generation
 * 3. Stores dialogue_map in database for all downstream consumers
 * 4. FAILS LOUDLY if attribution cannot be completed
 *
 * ============================================================================
 * OUTPUT FORMAT (dialogue_map)
 * ============================================================================
 *
 * [
 *   {
 *     "quote": "exact quoted text",
 *     "speaker": "Character Full Name",
 *     "emotion": "neutral|angry|sad|happy|scared|whispered|shouted|etc",
 *     "delivery": "description of how the line should be delivered",
 *     "start_char": 123,  // position in scene text
 *     "end_char": 156,
 *     "confidence": "high|medium|low",
 *     "reasoning": "brief explanation"
 *   }
 * ]
 *
 * ============================================================================
 * SEE ALSO: DIALOGUE_TAGGING_SYSTEM.md for full documentation
 * ============================================================================
 */

import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { parseCharacterTraits } from '../../utils/agentHelpers.js';

/**
 * Build character context for the LLM
 */
function buildCharacterContext(characters) {
  return characters.map(char => {
    const traits = parseCharacterTraits(char);

    return {
      name: char.name,
      gender: char.gender || 'unknown',
      role: char.role || 'character',
      description: char.description || '',
      personality: traits.personality || traits.traits || [],
      pronouns: char.gender === 'female' ? 'she/her' :
                char.gender === 'male' ? 'he/him' : 'they/them',
      voice_description: traits.voice_description || null
    };
  });
}

/**
 * Extract dialogue positions from scene text
 * Returns array of {quote, start_char, end_char} for each quoted segment
 */
function extractDialoguePositions(sceneText) {
  const dialogues = [];
  const dialogueRegex = /[""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]/g;
  let match;

  while ((match = dialogueRegex.exec(sceneText)) !== null) {
    dialogues.push({
      quote: match[1],
      start_char: match.index,
      end_char: match.index + match[0].length,
      full_match: match[0]
    });
  }

  return dialogues;
}

/**
 * System prompt for dialogue tagging
 * Emphasizes that this is DURING story creation, not post-hoc analysis
 */
function buildSystemPrompt() {
  return `You are an expert dialogue tagger for audiobook production. Your job is to analyze scene text and determine EXACTLY who speaks each line of dialogue.

This is a PREMIUM SERVICE - accuracy is paramount. Every dialogue line MUST be correctly attributed.

CRITICAL RULES:
1. Every quoted dialogue MUST be attributed to a specific character BY FULL NAME
2. Pay close attention to pronouns (he, she, they) - they refer to specific characters
3. Speech tags like "she mutters", "he said", "they replied" indicate the speaker
4. When a pronoun is used, determine which character it refers to based on:
   - The character's gender matching the pronoun
   - Who was most recently mentioned or acting in the scene
   - The flow of conversation (alternating speakers in dialogue)
5. Consider the CONTENT of the dialogue - does it match the character's personality?
6. Track conversation flow - dialogues often alternate between speakers
7. If unsure, look at the 50 characters BEFORE and AFTER the quote for context clues

PRONOUN RESOLUTION (CRITICAL):
- "she/her" → Must be a FEMALE character recently mentioned
- "he/him" → Must be a MALE character recently mentioned
- "they/them" → Could be any character, use context

EMOTION DETECTION:
Analyze the speech tag and content to determine emotion:
- neutral: normal speech
- angry: said angrily, snapped, demanded, shouted in anger
- sad: said sadly, sighed, murmured with grief
- happy: said cheerfully, laughed, exclaimed with joy
- scared: whispered fearfully, stammered, said trembling
- excited: said eagerly, exclaimed, said breathlessly
- whispered: whispered, murmured, said quietly, said softly
- shouted: yelled, screamed, bellowed, roared
- sarcastic: said sarcastically, said dryly, said with irony
- questioning: asked, inquired, wondered aloud

DELIVERY NOTES:
Add a brief note on how the line should be delivered for voice acting:
- "defensive and uncertain"
- "warm and reassuring"
- "cold and threatening"
- "breathless with excitement"

OUTPUT FORMAT:
Return a JSON object with:
{
  "dialogues": [
    {
      "index": 0,
      "quote": "exact quoted text",
      "speaker": "Character Full Name",
      "emotion": "detected emotion",
      "delivery": "brief delivery direction",
      "confidence": "high|medium|low",
      "reasoning": "brief explanation of attribution"
    }
  ],
  "validation": {
    "all_attributed": true,
    "gender_consistent": true,
    "issues": []
  }
}

NEVER leave a dialogue unattributed. If you must guess, mark confidence as "low" but still provide your best attribution.`;
}

/**
 * Build user prompt with scene text and character context
 */
function buildUserPrompt(sceneText, characters, storyContext) {
  const charContext = buildCharacterContext(characters);
  const dialoguePositions = extractDialoguePositions(sceneText);

  // Extract surrounding context for each dialogue to help attribution
  const dialoguesWithContext = dialoguePositions.map((d, idx) => {
    const contextBefore = sceneText.slice(Math.max(0, d.start_char - 100), d.start_char).trim();
    const contextAfter = sceneText.slice(d.end_char, Math.min(sceneText.length, d.end_char + 100)).trim();
    return {
      index: idx,
      quote: d.quote.length > 100 ? d.quote.substring(0, 100) + '...' : d.quote,
      context_before: contextBefore.length > 60 ? '...' + contextBefore.slice(-60) : contextBefore,
      context_after: contextAfter.length > 60 ? contextAfter.substring(0, 60) + '...' : contextAfter
    };
  });

  return `STORY CONTEXT:
- Genre: ${storyContext?.genre || 'general fiction'}
- Mood: ${storyContext?.mood || 'neutral'}
- Setting: ${storyContext?.setting || 'not specified'}

CHARACTERS IN THIS SCENE (${characters.length} total):
${charContext.map(c => `- ${c.name} (${c.gender}, ${c.pronouns}) - ${c.role}${c.description ? ': ' + c.description : ''}${c.personality?.length ? ` | Personality: ${c.personality.join(', ')}` : ''}`).join('\n')}

FULL SCENE TEXT:
"""
${sceneText}
"""

DIALOGUES TO TAG (${dialoguePositions.length} total):
${dialoguesWithContext.map(d => `[${d.index}] Context: "${d.context_before}" | QUOTE: "${d.quote}" | After: "${d.context_after}"`).join('\n\n')}

For EACH dialogue line:
1. Identify the speaker by FULL NAME (must match a character above)
2. Detect the emotion from speech tags and content
3. Provide brief delivery direction for voice acting
4. Explain your reasoning (especially for pronoun resolution)

Return your analysis as JSON.`;
}

/**
 * Tag all dialogue in a scene with speaker information
 * This is called IMMEDIATELY after scene generation to capture metadata at source
 *
 * @param {string} sceneText - The polished scene text
 * @param {Array} characters - Character objects from the story
 * @param {Object} storyContext - Genre, mood, setting for context
 * @param {string} sessionId - Session ID for tracking
 * @returns {Array} dialogue_map ready for database storage
 */
export async function tagDialogue(sceneText, characters, storyContext = {}, sessionId = null) {
  if (!sceneText) {
    logger.warn('[DialogueTagging] No scene text provided');
    return [];
  }

  // Quick check - does the scene have any dialogue?
  const dialoguePositions = extractDialoguePositions(sceneText);
  if (dialoguePositions.length === 0) {
    logger.info('[DialogueTagging] No dialogue found in scene - returning empty map');
    return [];
  }

  if (!characters || characters.length === 0) {
    logger.warn('[DialogueTagging] No characters provided - dialogue cannot be attributed');
    // FAIL LOUDLY for premium service
    throw new Error('DIALOGUE TAGGING FAILED: No characters provided. Cannot attribute dialogue without character list.');
  }

  logger.info(`[DialogueTagging] Tagging ${dialoguePositions.length} dialogue lines for ${characters.length} characters using GPT-5.1`);

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(sceneText, characters, storyContext);

    // Use GPT-5.1 for premium accuracy - this is the coherence model
    const response = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      agent_name: 'DialogueTaggingAgent',
      agent_category: 'coherence', // Uses gpt-5.1 for premium accuracy
      contentSettings: { audience: storyContext?.audience || 'general' },
      max_tokens: 4000,
      temperature: 0.1, // Very low temperature for consistency
      sessionId
    });

    const content = response?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    // Parse JSON response - handle potential markdown wrapping
    let jsonContent = content;
    if (content.includes('```json')) {
      jsonContent = content.split('```json')[1].split('```')[0].trim();
    } else if (content.includes('```')) {
      jsonContent = content.split('```')[1].split('```')[0].trim();
    }

    const result = JSON.parse(jsonContent);

    if (!result.dialogues || !Array.isArray(result.dialogues)) {
      throw new Error('Invalid response structure - missing dialogues array');
    }

    // Validate all dialogues are attributed
    const unattributed = result.dialogues.filter(d => !d.speaker);
    if (unattributed.length > 0) {
      throw new Error(`DIALOGUE TAGGING FAILED: ${unattributed.length} dialogue lines have no speaker attribution`);
    }

    // Build dialogue_map with character positions from original extraction
    const dialogueMap = result.dialogues.map((d, idx) => {
      const position = dialoguePositions[d.index !== undefined ? d.index : idx];
      if (!position) {
        logger.warn(`[DialogueTagging] No position found for dialogue index ${idx}`);
      }

      return {
        quote: d.quote || position?.quote,
        speaker: d.speaker,
        emotion: d.emotion || 'neutral',
        delivery: d.delivery || null,
        start_char: position?.start_char || 0,
        end_char: position?.end_char || 0,
        confidence: d.confidence || 'medium',
        reasoning: d.reasoning || null
      };
    });

    // Validate gender consistency
    const characterGenders = new Map();
    for (const char of characters) {
      characterGenders.set(char.name.toLowerCase(), char.gender);
    }

    for (const d of dialogueMap) {
      const speakerGender = characterGenders.get(d.speaker?.toLowerCase());
      if (speakerGender && d.reasoning) {
        // Check if reasoning mentions wrong pronoun
        const mentionsShe = d.reasoning.toLowerCase().includes('she ') || d.reasoning.toLowerCase().includes('her ');
        const mentionsHe = d.reasoning.toLowerCase().includes('he ') || d.reasoning.toLowerCase().includes('him ');

        if (speakerGender === 'male' && mentionsShe && !mentionsHe) {
          logger.warn(`[DialogueTagging] Potential gender mismatch: ${d.speaker} is male but reasoning mentions "she/her"`);
          d.confidence = 'low';
        }
        if (speakerGender === 'female' && mentionsHe && !mentionsShe) {
          logger.warn(`[DialogueTagging] Potential gender mismatch: ${d.speaker} is female but reasoning mentions "he/him"`);
          d.confidence = 'low';
        }
      }
    }

    // Log results
    logger.info(`[DialogueTagging] Successfully tagged ${dialogueMap.length} dialogue lines:`);
    for (const d of dialogueMap) {
      logger.info(`[DialogueTagging]   "${d.quote?.substring(0, 30)}..." → ${d.speaker} (${d.emotion}, ${d.confidence})`);
    }

    // Check validation flags from LLM
    if (result.validation) {
      if (!result.validation.all_attributed) {
        logger.warn('[DialogueTagging] LLM reports not all dialogues attributed');
      }
      if (!result.validation.gender_consistent) {
        logger.warn('[DialogueTagging] LLM reports gender inconsistencies');
      }
      if (result.validation.issues?.length > 0) {
        for (const issue of result.validation.issues) {
          logger.warn(`[DialogueTagging] Issue: ${issue}`);
        }
      }
    }

    return dialogueMap;

  } catch (error) {
    // FAIL LOUDLY - this is a premium service
    logger.error(`[DialogueTagging] CRITICAL FAILURE: ${error.message}`);
    throw new Error(`DIALOGUE TAGGING FAILED: ${error.message}. Scene cannot be saved without dialogue attribution.`);
  }
}

/**
 * Convert stored dialogue_map to segments for TTS generation
 * This is used by audio generation to get pre-computed speaker info
 *
 * @param {string} sceneText - Original scene text
 * @param {Array} dialogueMap - Pre-computed dialogue_map from database
 * @returns {Array} Segments in format [{speaker, text, voice_role, emotion}]
 */
export function convertDialogueMapToSegments(sceneText, dialogueMap) {
  if (!dialogueMap || dialogueMap.length === 0) {
    // No dialogue - return entire text as narration
    return [{
      speaker: 'narrator',
      text: sceneText,
      voice_role: 'narrator',
      emotion: 'neutral'
    }];
  }

  // Check if any dialogues have estimated positions (couldn't find actual position)
  const hasEstimatedPositions = dialogueMap.some(d => d.position_estimated);

  if (hasEstimatedPositions) {
    // Some positions are estimated - re-locate dialogues in the actual text
    // to get accurate positions for segment splitting
    // IMPORTANT: Search from last known position to maintain order and avoid matching wrong occurrences
    let searchStart = 0;
    const relocatedMap = dialogueMap.map(d => {
      if (!d.position_estimated) {
        // Update searchStart to after this non-estimated position
        searchStart = Math.max(searchStart, d.end_char);
        return d;
      }

      // Try to find this quote in the scene text FROM searchStart position
      const quotePatterns = [
        `"${d.quote}"`,
        `"${d.quote}"`,
        `"${d.quote}"`,
        d.quote
      ];

      for (const pattern of quotePatterns) {
        const idx = sceneText.indexOf(pattern, searchStart);
        if (idx !== -1) {
          const endPos = idx + pattern.length;
          searchStart = endPos; // Update for next search
          logger.info(`[SegmentBuilder] Re-located quote "${d.quote?.substring(0, 30)}..." at position ${idx}`);
          return {
            ...d,
            start_char: idx,
            end_char: endPos,
            position_estimated: false
          };
        }
      }

      // Still can't find it - keep original estimated position and advance searchStart
      logger.warn(`[SegmentBuilder] Could not re-locate quote "${d.quote?.substring(0, 30)}..." - keeping estimated position ${d.start_char}`);
      searchStart = Math.max(searchStart, d.end_char);
      return d;
    });

    // Sort and use relocated map
    const sortedMap = [...relocatedMap].sort((a, b) => a.start_char - b.start_char);
    return buildSegmentsFromMap(sceneText, sortedMap);
  }

  // Sort dialogue map by position
  const sortedMap = [...dialogueMap].sort((a, b) => a.start_char - b.start_char);
  return buildSegmentsFromMap(sceneText, sortedMap);
}

/**
 * Helper to build segments from a sorted dialogue map
 * ENHANCED: Added detailed logging to diagnose overlap/repetition issues
 */
function buildSegmentsFromMap(sceneText, sortedMap) {
  const segments = [];
  let lastIndex = 0;

  logger.info(`[SegmentBuilder] Building segments from ${sortedMap.length} dialogue entries`);
  logger.info(`[SegmentBuilder] Scene text length: ${sceneText.length} chars`);

  for (let i = 0; i < sortedMap.length; i++) {
    const dialogue = sortedMap[i];

    // Log position info for debugging
    logger.debug(`[SegmentBuilder] Dialogue[${i}]: "${dialogue.quote?.substring(0, 30)}..." at [${dialogue.start_char}-${dialogue.end_char}] by ${dialogue.speaker}`);

    // VALIDATION: Check what's actually at the position in the scene
    const actualTextAtPosition = sceneText.slice(dialogue.start_char, dialogue.end_char);
    logger.debug(`[SegmentBuilder]   Actual text at position: "${actualTextAtPosition}"`);

    // Check for position issues
    if (dialogue.start_char < lastIndex) {
      logger.warn(`[SegmentBuilder] OVERLAP DETECTED: Dialogue[${i}] starts at ${dialogue.start_char} but last segment ended at ${lastIndex}`);
      // Skip this dialogue to avoid duplicate content
      continue;
    }

    // Add narration before this dialogue
    if (dialogue.start_char > lastIndex) {
      const narration = sceneText.slice(lastIndex, dialogue.start_char).trim();
      if (narration) {
        // Check if narration contains any quoted text (likely an overlap bug)
        if (narration.includes('"') || narration.includes('"')) {
          logger.warn(`[SegmentBuilder] Narration segment [${lastIndex}-${dialogue.start_char}] contains quote marks - possible overlap!`);
          logger.warn(`[SegmentBuilder] Narration text: "${narration.substring(0, 100)}..."`);
        }
        segments.push({
          speaker: 'narrator',
          text: narration,
          voice_role: 'narrator',
          emotion: 'neutral'
        });
        logger.debug(`[SegmentBuilder]   → Narrator segment: "${narration.substring(0, 50)}..." (${narration.length} chars)`);
      }
    }

    // Use the quote from dialogue_map (what the character should say)
    // This is the cleaned text without quotes around it
    const dialogueText = dialogue.quote;

    // Add the dialogue
    segments.push({
      speaker: dialogue.speaker,
      text: dialogueText,
      voice_role: 'dialogue',
      emotion: dialogue.emotion || 'neutral',
      delivery: dialogue.delivery
    });
    logger.debug(`[SegmentBuilder]   → Dialogue segment: ${dialogue.speaker}: "${dialogueText?.substring(0, 50)}..." (${dialogueText?.length || 0} chars)`);

    lastIndex = dialogue.end_char;
  }

  // Add remaining narration
  if (lastIndex < sceneText.length) {
    const remaining = sceneText.slice(lastIndex).trim();
    if (remaining) {
      segments.push({
        speaker: 'narrator',
        text: remaining,
        voice_role: 'narrator',
        emotion: 'neutral'
      });
      logger.debug(`[SegmentBuilder]   → Final narrator segment: "${remaining.substring(0, 50)}..." (${remaining.length} chars)`);
    }
  }

  // Summary
  const narratorSegments = segments.filter(s => s.speaker === 'narrator').length;
  const dialogueSegments = segments.filter(s => s.speaker !== 'narrator').length;
  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);

  logger.info(`[SegmentBuilder] Built ${segments.length} segments: ${narratorSegments} narrator, ${dialogueSegments} dialogue`);
  logger.info(`[SegmentBuilder] Total chars in segments: ${totalChars} (scene was ${sceneText.length})`);

  if (totalChars > sceneText.length * 1.05) {
    logger.error(`[SegmentBuilder] TEXT DUPLICATION DETECTED: Segments total ${totalChars} chars but scene is only ${sceneText.length}`);
  }

  return segments;
}

/**
 * Validate a dialogue_map for consistency
 * Used to check stored maps before audio generation
 */
export function validateDialogueMap(dialogueMap, characters) {
  const errors = [];

  if (!dialogueMap || dialogueMap.length === 0) {
    return { valid: true, errors: [] }; // Empty map is valid (no dialogue)
  }

  const characterNames = new Set(characters.map(c => c.name.toLowerCase()));

  for (const d of dialogueMap) {
    // Check speaker exists in character list
    if (!d.speaker) {
      errors.push(`Dialogue "${d.quote?.substring(0, 30)}..." has no speaker`);
    } else if (!characterNames.has(d.speaker.toLowerCase())) {
      errors.push(`Speaker "${d.speaker}" not found in character list`);
    }

    // Check positions are valid
    if (d.start_char < 0 || d.end_char < d.start_char) {
      errors.push(`Invalid positions for dialogue "${d.quote?.substring(0, 30)}..."`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  tagDialogue,
  convertDialogueMapToSegments,
  validateDialogueMap,
  extractDialoguePositions
};
