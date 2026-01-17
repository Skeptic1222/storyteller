/**
 * Emotion Validator Agent
 *
 * Uses LLM to determine the appropriate emotional delivery for each dialogue line
 * based on story context, scene mood, character personality, and dialogue content.
 *
 * This replaces simple regex-based detection with intelligent context-aware analysis.
 */

import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { parseCharacterTraits } from '../../utils/agentHelpers.js';

// Available emotion presets that map to voice settings
const EMOTION_PRESETS = [
  'warm',        // Friendly, welcoming, gentle
  'playful',     // Light, teasing, fun
  'dramatic',    // Theatrical, intense, revelatory
  'angry',       // Furious, confrontational
  'horror',      // Terrified, screaming
  'fearful',     // Scared, trembling, anxious
  'mysterious',  // Cryptic, ominous, secretive
  'threatening', // Menacing, warning, dangerous
  'sad',         // Grieving, sorrowful, broken
  'tender',      // Loving, intimate, soft
  'excited',     // Enthusiastic, triumphant
  'sarcastic',   // Dry, ironic, deadpan
  'neutral'      // Default, conversational
];

function extractBracketTags(value) {
  if (!value) return [];
  const str = String(value).trim();
  if (!str) return [];
  return str.match(/\[[^\]]+\]/g) || [];
}

function normalizeDeliveryToTags(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';

  const tags = extractBracketTags(str);
  if (tags.length > 0) return tags.join('');

  // If the model returns a plain direction, wrap as a single tag.
  return `[${str.toLowerCase()}]`;
}

function mergeDeliveryTags(existing, incoming, maxTags = 4) {
  const existingTags = extractBracketTags(normalizeDeliveryToTags(existing));
  const incomingTags = extractBracketTags(normalizeDeliveryToTags(incoming));

  const seen = new Set();
  const merged = [];
  for (const tag of [...existingTags, ...incomingTags]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
    if (merged.length >= maxTags) break;
  }
  return merged.join('');
}

/**
 * Build the system prompt for emotion detection
 * @param {boolean} includeNarrator - Whether to include narrator segment analysis
 */
function buildSystemPrompt(includeNarrator = false) {
  const narratorSection = includeNarrator ? `

NARRATOR SEGMENTS:
- Narrator lines carry the story's emotional weight through pacing and tone
- Match narrator delivery to scene content - action scenes need energy, quiet moments need softness
- Consider what just happened or is about to happen in dialogue
- Transitions ("Meanwhile...", "Later that night...") should feel distinct from action ("The blade struck true!")
- Use tags like [ominously], [with building tension], [gently], [urgently], [with wonder]
- Narrator lines SHOULD vary in emotion throughout a scene - don't make them all the same` : '';

  return `You are an expert voice director for audiobook narration. Your job is to analyze ${includeNarrator ? 'all segments (dialogue AND narrator)' : 'dialogue segments'} and determine the most appropriate emotional delivery for each line.

You must consider:
1. **Story Context**: Genre, overall tone, target audience
2. **Scene Context**: What's happening in the scene - is it tense, romantic, comedic, scary?
3. **Character Personality**: Is this character naturally sarcastic? Nervous? Confident? Brooding?
4. **Dialogue Content**: What is being said and any explicit attribution (e.g., "she whispered fearfully")
5. **Subtext**: What emotions might be hidden beneath the surface?

Available emotional presets (choose ONE per line):
- warm: Friendly greetings, welcoming, gentle comfort
- playful: Teasing, joking, light-hearted banter
- dramatic: Revelations, accusations, theatrical intensity
- angry: Shouting, fury, confrontation
- horror: Terror, screaming, extreme fear
- fearful: Trembling, anxious, worried
- mysterious: Cryptic hints, ominous warnings, secrets
- threatening: Menacing, dangerous promises, intimidation
- sad: Grief, sorrow, heartbreak, regret
- tender: Love, intimacy, soft affection
- excited: Triumph, discovery, enthusiasm
- sarcastic: Dry wit, irony, deadpan delivery
- neutral: Default conversational tone

IMPORTANT RULES:
- If attribution explicitly states emotion (e.g., "she shouted angrily"), respect it
- If no explicit attribution, infer from ALL available context
- Consider character consistency - a nervous character stays nervous unless story changes them
- Scene mood affects all characters - a horror scene makes even casual lines feel tense
- Match intensity to genre - children's stories stay lighter, horror goes darker

AUDIENCE-SPECIFIC CONSTRAINTS:
- **Kids/Children**: Use warm, playful, excited, tender emotions primarily. Avoid horror/threatening/angry extremes.
- **General/Family**: Full emotional range but keep intensity appropriate for family viewing.
- **Mature/Adult**: Full emotional range including intense horror, threatening, and dramatic extremes.
  Can use darker, more visceral delivery. Scene mood should push boundaries when appropriate.${narratorSection}

ElevenLabs v3 Audio Tags:
- Also output a short "delivery" field per line as 0-4 bracket tags, e.g. "[breathlessly][long pause]" or "".
- Keep tags actor-like and minimal; avoid over-tagging.
- Output ONLY bracket tags in "delivery" (no SSML/XML).`;
}

/**
 * Build the user prompt for batch emotion detection
 * @param {boolean} includeNarrator - Whether to include narrator segment analysis
 */
function buildUserPrompt(segments, context, includeNarrator = false) {
  const { genre, mood, audience, sceneDescription, characters } = context;

  // Build character reference
  let characterInfo = '';
  if (characters && characters.length > 0) {
    characterInfo = '\n\nCHARACTER REFERENCE:\n';
    characters.forEach(char => {
      const traits = parseCharacterTraits(char);
      const traitList = traits.personality || traits.traits || [];
      characterInfo += `- ${char.name}: ${char.role || 'character'}`;
      if (traitList.length > 0) {
        characterInfo += ` (${Array.isArray(traitList) ? traitList.join(', ') : traitList})`;
      }
      if (char.description) {
        characterInfo += ` - ${char.description.substring(0, 100)}`;
      }
      characterInfo += '\n';
    });
  }

  // Build segments list - include narrator if requested
  const segmentLabel = includeNarrator ? 'ALL SEGMENTS TO ANALYZE' : 'DIALOGUE SEGMENTS TO ANALYZE';
  let segmentList = `\n${segmentLabel}:\n`;
  segments.forEach((seg, idx) => {
    if (includeNarrator || seg.speaker !== 'narrator') {
      const speakerLabel = seg.speaker === 'narrator' ? 'NARRATOR' : seg.speaker;
      segmentList += `\n[${idx}] Speaker: ${speakerLabel}`;
      if (seg.attribution) {
        segmentList += `\n    Attribution: "${seg.attribution}"`;
      }
      // Truncate long narrator segments to save tokens
      const textPreview = seg.text.length > 200 ? seg.text.substring(0, 200) + '...' : seg.text;
      segmentList += `\n    Text: ${textPreview}`;
    }
  });

  const narratorInstruction = includeNarrator
    ? 'Include BOTH dialogue AND narrator segments. For narrator, focus on pacing and tone variety.'
    : 'Only include dialogue segments (skip narrator segments).';

  return `STORY CONTEXT:
- Genre: ${genre || 'general fiction'}
- Overall Mood: ${mood || 'neutral'}
- Audience: ${audience || 'general'}
- Scene Description: ${sceneDescription || 'No specific scene context provided'}
${characterInfo}
${segmentList}

For each segment [index], respond with a JSON object containing:
{
  "emotions": [
    { "index": 0, "speaker": "CharacterName or NARRATOR", "emotion": "chosen_emotion", "delivery": "[tag][tag]", "reasoning": "brief explanation" },
    ...
  ]
}

${narratorInstruction} Choose the single most appropriate emotion from the preset list.

The "delivery" field should be either "" or a concatenation of bracket tags like "[whispers][nervously]" or "[with building tension][ominously]".`;
}

/**
 * Validate and detect emotions for a batch of dialogue segments using LLM
 *
 * @param {Array} segments - Array of dialogue segments from parseDialogueSegments
 * @param {Object} context - Story/scene context
 * @param {string} context.genre - Story genre
 * @param {string} context.mood - Overall story mood
 * @param {string} context.audience - Target audience
 * @param {string} context.sceneDescription - Brief description of current scene
 * @param {Array} context.characters - Character information array
 * @param {string} sessionId - Session ID for tracking
 * @param {Object} options - Additional options
 * @param {boolean} options.includeNarrator - Whether to analyze narrator segments (default: false)
 * @returns {Promise<Array>} Segments with emotion field added
 */
export async function detectEmotionsForSegments(segments, context, sessionId = null, options = {}) {
  const { includeNarrator = false } = options;

  // Filter segments based on options
  const targetSegments = includeNarrator
    ? segments
    : segments.filter(seg => seg.speaker !== 'narrator');

  if (targetSegments.length === 0) {
    logger.info('[EmotionValidator] No segments to analyze');
    return segments; // Return unchanged
  }

  const segmentType = includeNarrator ? 'all' : 'dialogue';
  logger.info(`[EmotionValidator] Analyzing ${targetSegments.length} ${segmentType} segments for session ${sessionId}`);

  try {
    const systemPrompt = buildSystemPrompt(includeNarrator);
    const userPrompt = buildUserPrompt(segments, context, includeNarrator);

    logger.info(`[EmotionValidator] Calling LLM for emotion detection (utility model)`);

    // Use utility model for fast emotion detection
    const response = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      agent_name: 'EmotionValidator',
      agent_category: 'utility',
      contentSettings: { audience: context.audience || 'general' },
      max_tokens: 1000,
      temperature: 0.3, // Lower temperature for consistent analysis
      response_format: { type: 'json_object' },
      sessionId
    });

    const content = response?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const result = JSON.parse(content);
    const emotions = result.emotions || [];

    // Create a map of index -> emotion
    const emotionMap = new Map();
    emotions.forEach(e => {
      if (EMOTION_PRESETS.includes(e.emotion)) {
        emotionMap.set(e.index, {
          emotion: e.emotion,
          delivery: normalizeDeliveryToTags(e.delivery),
          reasoning: e.reasoning,
          llmValidated: true
        });
        logger.debug(`[EmotionValidator] Segment[${e.index}] ${e.speaker}: ${e.emotion} - ${e.reasoning}`);
      } else {
        logger.warn(`[EmotionValidator] Invalid emotion "${e.emotion}" for segment ${e.index}, using neutral`);
        emotionMap.set(e.index, { emotion: 'neutral', reasoning: 'fallback', llmValidated: true });
      }
    });

    // Apply emotions to segments
    // IMPORTANT: Preserve specific delivery emotions (whispered, shouted, etc.) from DialogueTaggingAgent
    // Only enhance with LLM emotion if segment doesn't already have a specific delivery-type emotion
    const DELIVERY_EMOTIONS = ['whispered', 'hushed', 'murmured', 'shouted', 'yelled', 'bellowed'];

    const enhancedSegments = segments.map((seg, idx) => {
      // Handle narrator segments - only if includeNarrator is true
      if (seg.speaker === 'narrator') {
        if (!includeNarrator) {
          return { ...seg, emotion: 'neutral', llmValidated: false };
        }
        // Apply LLM emotion to narrator segment
        const emotionData = emotionMap.get(idx);
        if (emotionData) {
          logger.debug(`[EmotionValidator] Narrator[${idx}]: ${emotionData.emotion} | delivery: ${emotionData.delivery || 'none'}`);
          return {
            ...seg,
            emotion: emotionData.emotion,
            delivery: emotionData.delivery || '',
            emotionReasoning: emotionData.reasoning,
            llmValidated: true
          };
        }
        return { ...seg, emotion: 'neutral', llmValidated: false };
      }

      const emotionData = emotionMap.get(idx);

      // If segment already has a specific delivery emotion from DialogueTaggingAgent,
      // preserve it as it maps directly to Audio Tags (e.g., "whispered" -> "[whispers]")
      if (seg.emotion && DELIVERY_EMOTIONS.includes(seg.emotion.toLowerCase())) {
        logger.debug(`[EmotionValidator] Preserving delivery emotion "${seg.emotion}" for segment ${idx}`);
        return {
          ...seg,
          delivery: mergeDeliveryTags(seg.delivery, emotionData?.delivery),
          emotionReasoning: emotionData?.reasoning || `Preserved from dialogue tagging: ${seg.emotion}`,
          llmValidated: true  // Mark as validated since we explicitly preserved it
        };
      }

      if (emotionData) {
        return {
          ...seg,
          emotion: emotionData.emotion,
          delivery: mergeDeliveryTags(seg.delivery, emotionData.delivery),
          emotionReasoning: emotionData.reasoning,
          llmValidated: true
        };
      }

      // Fallback for segments not in LLM response
      return { ...seg, emotion: 'neutral', llmValidated: false };
    });

    logger.info(`[EmotionValidator] Successfully analyzed ${emotions.length} segments`);
    return enhancedSegments;

  } catch (error) {
    logger.error(`[EmotionValidator] LLM emotion detection failed: ${error.message}`);

    // Fallback: use simple heuristics for explicit attributions only
    return segments.map(seg => {
      if (seg.speaker === 'narrator') {
        return { ...seg, emotion: 'neutral', llmValidated: false };
      }

      // Only use regex fallback for very explicit cases
      const emotion = detectExplicitEmotion(seg.text, seg.attribution);
      return { ...seg, emotion, llmValidated: false };
    });
  }
}

/**
 * Simple fallback for explicit emotional cues only
 * Used when LLM is unavailable - very conservative matching
 */
function detectExplicitEmotion(text, attribution = '') {
  const attr = (attribution || '').toLowerCase();

  // Only match very explicit verbs
  if (/\b(shouted|yelled|screamed|roared|bellowed)\b/.test(attr)) return 'angry';
  if (/\b(whispered|murmured)\s+(fearfully|nervously|anxiously)\b/.test(attr)) return 'fearful';
  if (/\b(sobbed|wept|cried)\b/.test(attr)) return 'sad';
  if (/\b(whispered|murmured)\s+(tenderly|lovingly|softly)\b/.test(attr)) return 'tender';
  if (/\b(laughed|giggled|chuckled)\b/.test(attr)) return 'playful';
  if (/\b(hissed|growled|snarled)\b/.test(attr)) return 'threatening';
  if (/\b(shrieked|wailed|screamed\s+in\s+terror)\b/.test(attr)) return 'horror';

  // Default to neutral - let voice assignment handle basic expressiveness
  return 'neutral';
}

/**
 * Quick emotion detection for a single line (used in real-time scenarios)
 * Falls back to LLM only if context suggests complex emotion
 */
export async function detectSingleLineEmotion(segment, context, sessionId = null) {
  // For single lines, check if attribution is explicit enough
  const explicitEmotion = detectExplicitEmotion(segment.text, segment.attribution);

  if (explicitEmotion !== 'neutral') {
    logger.debug(`[EmotionValidator] Explicit emotion detected: ${explicitEmotion}`);
    return { ...segment, emotion: explicitEmotion, llmValidated: false };
  }

  // For ambiguous cases, use LLM
  const results = await detectEmotionsForSegments([segment], context, sessionId);
  return results[0];
}

export default {
  detectEmotionsForSegments,
  detectSingleLineEmotion,
  EMOTION_PRESETS
};
