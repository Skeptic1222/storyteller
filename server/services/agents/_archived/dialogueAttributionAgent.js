/**
 * ============================================================================
 * ⚠️  DEPRECATED - DO NOT USE AS PRIMARY ATTRIBUTION SOURCE  ⚠️
 * ============================================================================
 *
 * THIS FILE IS DEPRECATED AS OF 2025-12-09
 *
 * USE INSTEAD: dialogueTaggingAgent.js
 *
 * This file is kept ONLY as a fallback for edge cases where:
 * 1. dialogue_map was not computed during scene generation
 * 2. The DialogueTaggingAgent failed and we need emergency fallback
 *
 * WHY DEPRECATED:
 * - This agent runs AFTER story generation (post-hoc attribution)
 * - dialogueTaggingAgent.js runs DURING story generation (at source)
 * - At-source attribution is more accurate and efficient
 *
 * DO NOT:
 * - Use this as the primary attribution method
 * - Remove this file (it's still used as fallback)
 * - Modify this to be the default
 *
 * SEE: DIALOGUE_TAGGING_SYSTEM.md for full documentation
 *
 * ============================================================================
 * ORIGINAL DESCRIPTION (for reference):
 * ============================================================================
 *
 * Dialogue Attribution Agent (LEGACY FALLBACK)
 *
 * Uses LLM to accurately attribute dialogue to speakers by:
 * 1. Understanding pronouns (he/she/they) in context
 * 2. Tracking conversation flow and turn-taking
 * 3. Using surrounding narrative context
 * 4. Validating gender consistency between speaker and pronouns
 *
 * This is a PREMIUM feature - it FAILS LOUDLY instead of using fallbacks.
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
      pronouns: char.gender === 'female' ? 'she/her' :
                char.gender === 'male' ? 'he/him' : 'they/them'
    };
  });
}

/**
 * System prompt for dialogue attribution
 */
function buildSystemPrompt() {
  return `You are an expert dialogue parser for audiobook production. Your job is to analyze scene text and determine EXACTLY who speaks each line of dialogue.

CRITICAL RULES:
1. Every quoted dialogue MUST be attributed to a specific character by name
2. Pay close attention to pronouns (he, she, they) - they refer to specific characters
3. Speech tags like "she mutters", "he said", "they replied" indicate the speaker
4. When a pronoun is used, determine which character it refers to based on:
   - The character's gender matching the pronoun
   - Who was most recently mentioned or acting in the scene
   - The flow of conversation (alternating speakers)
5. Consider the CONTENT of the dialogue - does it match what this character would say?
6. Track conversation flow - dialogues often alternate between two speakers

PRONOUN RESOLUTION:
- "she/her" → Look for female characters recently mentioned
- "he/him" → Look for male characters recently mentioned
- "they/them" → Could be any character, use context

OUTPUT FORMAT:
Return a JSON object:
{
  "dialogues": [
    {
      "index": 0,
      "quote": "the exact quoted text",
      "speaker": "Character Full Name",
      "confidence": "high|medium|low",
      "reasoning": "brief explanation",
      "emotion": "neutral|angry|sad|happy|scared|excited|whispered|shouted|etc"
    }
  ],
  "validation": {
    "all_attributed": true,
    "gender_consistent": true,
    "issues": []
  }
}

If you cannot confidently attribute a line, still provide your best guess but mark confidence as "low".`;
}

/**
 * Build user prompt with scene text and characters
 */
function buildUserPrompt(sceneText, characters) {
  const charContext = buildCharacterContext(characters);

  // Extract all quoted dialogues for reference
  const dialogueRegex = /[""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]/g;
  const dialogues = [];
  let match;
  let index = 0;
  while ((match = dialogueRegex.exec(sceneText)) !== null) {
    dialogues.push({
      index: index++,
      quote: match[1],
      position: match.index,
      fullMatch: match[0]
    });
  }

  return `CHARACTERS IN THIS SCENE:
${charContext.map(c => `- ${c.name} (${c.gender}, ${c.pronouns}) - ${c.role}${c.description ? ': ' + c.description : ''}`).join('\n')}

SCENE TEXT:
"""
${sceneText}
"""

DIALOGUES TO ATTRIBUTE (${dialogues.length} total):
${dialogues.map(d => `[${d.index}] "${d.quote.substring(0, 60)}${d.quote.length > 60 ? '...' : ''}"`).join('\n')}

For each dialogue, determine WHO is speaking based on:
1. The speech tag (e.g., "she mutters" = female character)
2. Pronouns in the surrounding text
3. The context and flow of conversation
4. What makes sense for each character to say

Return your analysis as JSON.`;
}

/**
 * Use LLM to attribute all dialogues in a scene to speakers
 *
 * @param {string} sceneText - The full scene text
 * @param {Array} characters - Array of character objects with name, gender, etc.
 * @param {string} sessionId - Session ID for tracking
 * @returns {Array} Array of {quote, speaker, emotion} objects
 */
export async function attributeDialoguesWithLLM(sceneText, characters, sessionId = null) {
  if (!sceneText || !characters || characters.length === 0) {
    logger.warn('[DialogueAttribution] No scene text or characters provided');
    return [];
  }

  // Quick check - does the scene have any dialogue?
  const hasDialogue = /[""\u201C\u201D]/.test(sceneText);
  if (!hasDialogue) {
    logger.info('[DialogueAttribution] No dialogue found in scene');
    return [];
  }

  logger.info(`[DialogueAttribution] Attributing dialogues for ${characters.length} characters`);

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(sceneText, characters);

    const response = await callLLM({
      agent_category: 'utility',
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      contentSettings: { audience: 'general' },
      max_tokens: 3000,
      temperature: 0.2, // Low temperature for consistency
      response_format: { type: 'json_object' },
      sessionId
    });

    const content = response?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const result = JSON.parse(content);

    if (!result.dialogues || !Array.isArray(result.dialogues)) {
      throw new Error('Invalid response structure - missing dialogues array');
    }

    // Log attribution results
    for (const d of result.dialogues) {
      logger.info(`[DialogueAttribution] "${d.quote?.substring(0, 30)}..." → ${d.speaker} (${d.confidence}, ${d.emotion || 'neutral'})`);
    }

    // Check validation
    if (result.validation) {
      if (!result.validation.all_attributed) {
        logger.warn('[DialogueAttribution] Some dialogues could not be attributed');
      }
      if (!result.validation.gender_consistent) {
        logger.warn('[DialogueAttribution] Gender inconsistencies detected');
      }
      if (result.validation.issues?.length > 0) {
        for (const issue of result.validation.issues) {
          logger.warn(`[DialogueAttribution] Issue: ${issue}`);
        }
      }
    }

    return result.dialogues;

  } catch (error) {
    logger.error(`[DialogueAttribution] LLM attribution failed: ${error.message}`);
    throw new Error(`DIALOGUE ATTRIBUTION FAILED: ${error.message}`);
  }
}

/**
 * Validate that speaker genders match their assigned voices
 *
 * @param {Array} attributedDialogues - From attributeDialoguesWithLLM
 * @param {Object} characterVoices - Map of characterName → voiceId
 * @param {Array} characters - Character objects with gender info
 * @param {Object} voiceLibrary - Voice metadata including gender
 */
export function validateSpeakerVoiceGenders(attributedDialogues, characterVoices, characters, voiceLibrary) {
  const errors = [];
  const charGenderMap = new Map();

  // Build character gender lookup
  for (const char of characters) {
    charGenderMap.set(char.name.toLowerCase(), char.gender);
  }

  // Build voice gender lookup
  const voiceGenderMap = new Map();
  for (const voice of voiceLibrary) {
    voiceGenderMap.set(voice.voice_id, voice.gender);
  }

  // Check each dialogue
  for (const dialogue of attributedDialogues) {
    const speakerName = dialogue.speaker?.toLowerCase();
    const charGender = charGenderMap.get(speakerName);
    const voiceId = characterVoices[speakerName];
    const voiceGender = voiceId ? voiceGenderMap.get(voiceId) : null;

    if (charGender && voiceGender && charGender !== voiceGender) {
      errors.push({
        speaker: dialogue.speaker,
        quote: dialogue.quote?.substring(0, 50),
        characterGender: charGender,
        voiceGender: voiceGender,
        message: `${dialogue.speaker} is ${charGender} but assigned a ${voiceGender} voice`
      });
    }
  }

  if (errors.length > 0) {
    logger.error(`[DialogueAttribution] Gender mismatches found:`, errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Convert LLM attributions back to segment format for TTS generation
 *
 * @param {string} sceneText - Original scene text
 * @param {Array} attributedDialogues - From attributeDialoguesWithLLM
 * @returns {Array} Segments in format [{speaker, text, voice_role, emotion}]
 */
export function convertAttributionsToSegments(sceneText, attributedDialogues) {
  const segments = [];
  let lastIndex = 0;

  // Build a map of quote → attribution
  const attributionMap = new Map();
  for (const d of attributedDialogues) {
    attributionMap.set(d.quote, d);
  }

  // Find all dialogues in order
  const dialogueRegex = /[""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]/g;
  let match;

  while ((match = dialogueRegex.exec(sceneText)) !== null) {
    const quote = match[1];
    const dialogueStart = match.index;
    const dialogueEnd = match.index + match[0].length;

    // Add narration before this dialogue
    if (dialogueStart > lastIndex) {
      const narration = sceneText.slice(lastIndex, dialogueStart).trim();
      if (narration) {
        segments.push({
          speaker: 'narrator',
          text: narration,
          voice_role: 'narrator'
        });
      }
    }

    // Find attribution for this quote
    const attribution = attributionMap.get(quote);

    if (attribution) {
      segments.push({
        speaker: attribution.speaker,
        text: quote,
        voice_role: 'dialogue',
        emotion: attribution.emotion || 'neutral'
      });
    } else {
      // Fallback - shouldn't happen with proper LLM attribution
      logger.warn(`[DialogueAttribution] No attribution found for quote: "${quote.substring(0, 30)}..."`);
      segments.push({
        speaker: 'Unknown',
        text: quote,
        voice_role: 'dialogue',
        emotion: 'neutral'
      });
    }

    lastIndex = dialogueEnd;
  }

  // Add remaining narration
  if (lastIndex < sceneText.length) {
    const remaining = sceneText.slice(lastIndex).trim();
    if (remaining) {
      segments.push({
        speaker: 'narrator',
        text: remaining,
        voice_role: 'narrator'
      });
    }
  }

  return segments;
}

export default {
  attributeDialoguesWithLLM,
  validateSpeakerVoiceGenders,
  convertAttributionsToSegments
};
