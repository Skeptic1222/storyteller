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
    .slice(0, 4) // Keep it tight to avoid over-directing.
    .join('');
  return normalized;
}

function buildSystemPrompt() {
  return `You are an expert audiobook director.

Your job: choose a narrator delivery for the given scene so the performance feels premium, nuanced, and emotionally grounded.

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
- Prefer "neutral" emotion if the scene is mostly expository; use tags for nuance when needed.
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
 * @param {object} options.context - { genre, mood, audience }
 * @returns {Promise<{emotion: string, delivery: string, voiceSettingsOverride?: object, reasoning?: string}>}
 */
export async function getNarratorDeliveryDirectives({ sessionId, sceneText, context }) {
  const safeSessionId = sessionId || 'no_session';
  const trimmed = (sceneText || '').trim();
  const promptText = trimmed.length > 1400 ? trimmed.slice(0, 1400) : trimmed;

  const hash = crypto.createHash('sha256').update(promptText).digest('hex').slice(0, 16);
  const cacheKey = `narrator:delivery:${safeSessionId}:${hash}:${context?.mood || 'neutral'}`;

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
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt({ sceneText: promptText, context }) }
      ],
      agent_name: 'NarratorDelivery',
      agent_category: 'utility',
      contentSettings: { audience: context?.audience || 'general' },
      max_tokens: 350,
      temperature: 0.2,
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

    const result = {
      emotion: normalizedEmotion,
      delivery,
      voiceSettingsOverride: Object.keys(voiceSettingsOverride).length ? voiceSettingsOverride : undefined,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 120) : ''
    };

    try {
      await cache.set(cacheKey, result, 60 * 60); // 1h
    } catch (err) {
      logger.debug(`[NarratorDelivery] Cache set failed: ${err.message}`);
    }

    return result;
  } catch (error) {
    logger.warn(`[NarratorDelivery] LLM failed: ${error.message}`);
    return { emotion: 'neutral', delivery: '' };
  }
}

export default { getNarratorDeliveryDirectives };

