/**
 * Narrator Delivery Agent
 *
 * Produces high-level v3 Audio Tag direction for narrator delivery based on scene context.
 * Goal: AAA audiobook performance without brittle keyword rules.
 */

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { cache } from '../cache.js';
import { getArchetype, buildArchetypeDirectionPrompt } from '../narratorArchetypes.js';

// Configuration constants
const MAX_PROMPT_TEXT_LENGTH = 1400; // Max characters to send to LLM
const MAX_TOKENS = 350; // LLM response token limit
const TEMPERATURE = 0.2; // Low temperature for consistent delivery direction
const MAX_REASONING_LENGTH = 120; // Truncate reasoning to this length
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour cache TTL
const MAX_DELIVERY_TAGS = 4; // Maximum number of audio tags to keep

const ALLOWED_NARRATOR_EMOTIONS = [
  'neutral',
  // Narrator-specific style keys (mapped in EMOTION_TO_AUDIO_TAGS)
  'warm_gentle',
  'dramatic',
  'dramatic_theatrical',
  'mysterious',
  'mysterious_dark',
  'playful',
  'playful_energetic',
  // Scene mood keys (mapped in EMOTION_TO_AUDIO_TAGS)
  'action',
  'horror',
  'fearful',
  'sad',
  'tender',
  'excited',
  'threatening'
];

function clamp01(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function sanitizeDeliveryTags(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  // Extract bracket tags only (supports multiple tags); drop any surrounding text.
  const tags = str.match(/\[[^\]]+\]/g) || [];
  const normalized = tags
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, MAX_DELIVERY_TAGS) // Keep it tight to avoid over-directing.
    .join('');
  return normalized;
}

function buildSystemPrompt(archetype = null) {
  let archetypeConstraints = '';

  if (archetype) {
    const emotionalStrengths = archetype.emotionalStrengths?.join(', ') || 'none specified';
    const emotionalWeaknesses = archetype.emotionalWeaknesses?.join(', ') || 'none specified';
    const preferredTags = archetype.preferredV3Tags?.join(', ') || 'none specified';
    const avoidTags = archetype.avoidV3Tags?.join(', ') || 'none specified';

    archetypeConstraints = `
NARRATOR ARCHETYPE: ${archetype.name}
- Delivery style: ${archetype.deliveryNotes}
- Lean into these emotions: ${emotionalStrengths}
- Minimize/adapt these emotions: ${emotionalWeaknesses}
- PREFERRED tags: ${preferredTags}
- AVOID tags: ${avoidTags}
- Pause frequency: ${archetype.pauseFrequency}
`;
  }

  return `You are an expert audiobook director.

Your job: choose a narrator delivery for the given scene so the performance feels premium, nuanced, and emotionally grounded.
${archetypeConstraints}
This system uses ElevenLabs v3 Audio Tags. Output a SMALL set of tags to guide delivery (0-4 tags). Avoid over-tagging.

Return ONLY valid JSON with this shape:
{
  "emotion": "one_of_allowed",
  "delivery": "[tag][tag]" ,
  "voice_settings_override": { "stability": 0.0-1.0, "style": 0.0-1.0 },
  "reasoning": "short"
}

Rules:
- "emotion" MUST be one of: ${ALLOWED_NARRATOR_EMOTIONS.join(', ')}.
- "delivery" MUST be either "" or a concatenation of bracket tags like "[warmly][softly]" (no SSML, no XML).
- Keep delivery subtle and actor-like: pacing, intent, subtext, intensity, breath, pauses.
- Prefer "neutral" emotion if the scene is mostly expository; use tags for nuance when needed.${archetype ? `\n- Honor the archetype's delivery style and preferred/avoid tags.` : ''}
- Keep "reasoning" under 20 words.`;
}

function buildUserPrompt({ sceneText, context }) {
  const genre = context?.genre || context?.primaryGenre || 'general fiction';
  const mood = context?.mood || 'neutral';
  const audience = context?.audience || 'general';

  const excerpt = (sceneText || '').trim();

  return `STORY CONTEXT:
- Genre: ${genre}
- Mood: ${mood}
- Audience: ${audience}

SCENE EXCERPT (narration + dialogue, truncated):
"""
${excerpt}
"""`;
}

/**
 * Get narrator delivery directives for a scene (cached).
 *
 * @param {object} options
 * @param {string} options.sessionId
 * @param {string} options.sceneText - Full scene text (will be truncated for prompt)
 * @param {object} options.context - { genre, mood, audience, narratorArchetype }
 * @returns {Promise<{emotion: string, delivery: string, voiceSettingsOverride?: object, reasoning?: string, archetypeApplied?: string}>}
 */
export async function getNarratorDeliveryDirectives({ sessionId, sceneText, context }) {
  const safeSessionId = sessionId || 'no_session';
  const trimmed = (sceneText || '').trim();
  const promptText = trimmed.length > MAX_PROMPT_TEXT_LENGTH ? trimmed.slice(0, MAX_PROMPT_TEXT_LENGTH) : trimmed;

  // Load archetype if specified in context
  const archetypeId = context?.narratorArchetype || context?.narrator_archetype;
  const archetype = archetypeId ? getArchetype(archetypeId) : null;

  if (archetype) {
    logger.debug(`[NarratorDelivery] Using archetype: ${archetype.name} (${archetypeId})`);
  }

  const hash = crypto.createHash('sha256').update(promptText + (archetypeId || '')).digest('hex').slice(0, 16);
  const cacheKey = `narrator:delivery:${safeSessionId}:${hash}:${context?.mood || 'neutral'}:${archetypeId || 'none'}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached?.emotion) {
      return cached;
    }
  } catch (err) {
    logger.debug(`[NarratorDelivery] Cache get failed: ${err.message}`);
  }

  try {
    const response = await callLLM({
      messages: [
        { role: 'system', content: buildSystemPrompt(archetype) },
        { role: 'user', content: buildUserPrompt({ sceneText: promptText, context }) }
      ],
      agent_name: 'NarratorDelivery',
      agent_category: 'utility',
      contentSettings: { audience: context?.audience || 'general' },
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      response_format: { type: 'json_object' },
      sessionId
    });

    const raw = response?.content;
    if (!raw) throw new Error('Empty LLM response');

    const parsed = JSON.parse(raw);

    const emotion = String(parsed.emotion || 'neutral').toLowerCase().trim();
    const normalizedEmotion = ALLOWED_NARRATOR_EMOTIONS.includes(emotion) ? emotion : 'neutral';

    const delivery = sanitizeDeliveryTags(parsed.delivery);
    const stability = clamp01(parsed.voice_settings_override?.stability);
    const style = clamp01(parsed.voice_settings_override?.style);

    const voiceSettingsOverride = {};
    if (stability !== null) voiceSettingsOverride.stability = stability;
    if (style !== null) voiceSettingsOverride.style = style;

    // If archetype is present and no LLM voice settings, use archetype defaults
    if (archetype && Object.keys(voiceSettingsOverride).length === 0) {
      if (archetype.voiceSettings?.stability) {
        voiceSettingsOverride.stability = archetype.voiceSettings.stability;
      }
      if (archetype.voiceSettings?.style) {
        voiceSettingsOverride.style = archetype.voiceSettings.style;
      }
    }

    const result = {
      emotion: normalizedEmotion,
      delivery,
      voiceSettingsOverride: Object.keys(voiceSettingsOverride).length ? voiceSettingsOverride : undefined,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, MAX_REASONING_LENGTH) : '',
      archetypeApplied: archetype?.id || null,
      archetypeSpeedModifier: archetype?.voiceSettings?.speed || null
    };

    try {
      await cache.set(cacheKey, result, CACHE_TTL_SECONDS);
    } catch (err) {
      logger.debug(`[NarratorDelivery] Cache set failed: ${err.message}`);
    }

    return result;
  } catch (error) {
    logger.warn(`[NarratorDelivery] LLM failed: ${error.message}`);
    // Return archetype defaults on failure if available
    if (archetype) {
      return {
        emotion: 'neutral',
        delivery: '',
        voiceSettingsOverride: {
          stability: archetype.voiceSettings?.stability,
          style: archetype.voiceSettings?.style
        },
        archetypeApplied: archetype.id,
        archetypeSpeedModifier: archetype.voiceSettings?.speed || null
      };
    }
    return { emotion: 'neutral', delivery: '' };
  }
}

export default { getNarratorDeliveryDirectives };

