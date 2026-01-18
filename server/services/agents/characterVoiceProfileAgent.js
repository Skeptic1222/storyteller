/**
 * Character Voice Profile Agent
 *
 * Generates voice direction profiles for individual characters based on
 * their personality, role, and the story context. Maps character traits
 * to specific ElevenLabs V3 voice parameters and emotional presets.
 *
 * This agent is called during outline creation to establish character
 * voice profiles that persist throughout the story.
 */

import { callLLM } from '../llmProviders.js';
import { getCharacterTypeProfile } from '../genreVoiceProfiles.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {Object} EmotionalRange
 * @property {string} default - Default emotional state
 * @property {string} when_stressed - Emotion under stress
 * @property {string} when_happy - Emotion when happy
 * @property {string} when_angry - Emotion when angry
 * @property {string} when_sad - Emotion when sad
 */

/**
 * @typedef {Object} SpeechPatterns
 * @property {boolean} uses_dramatic_pauses - Character pauses for effect
 * @property {boolean} speaks_quickly_when_nervous - Speed increases under stress
 * @property {boolean} whispers_secrets - Uses whisper for important info
 * @property {boolean} shouts_in_anger - Raises voice when angry
 * @property {boolean} trails_off_when_uncertain - Voice fades with doubt
 * @property {boolean} emphasizes_key_words - Stresses important words
 */

/**
 * @typedef {Object} CharacterVoiceProfile
 * @property {string} voiceArchetype - Character archetype (hero, mentor, villain, etc.)
 * @property {Object} baseSettings - Default voice settings
 * @property {number} baseSettings.stability - ElevenLabs stability 0.0-1.0
 * @property {number} baseSettings.style - ElevenLabs style 0.0-1.0
 * @property {number} baseSettings.speedModifier - Speed adjustment 0.85-1.15
 * @property {EmotionalRange} emotionalRange - How emotions manifest
 * @property {SpeechPatterns} speechPatterns - Behavioral patterns
 * @property {string} signatureDelivery - Overall delivery style
 * @property {string[]} characteristicTags - V3 tags this character often uses
 * @property {string} voiceDescription - Text description for voice casting
 */

const CHARACTER_VOICE_PROMPT = `You are a voice director creating a detailed voice profile for a character.

Analyze this character and create a voice direction profile that captures their personality through speech.

CHARACTER DETAILS:
- Name: {name}
- Role: {role}
- Description: {description}
- Personality: {personality}
- Traits: {traits}
- Gender: {gender}

STORY CONTEXT:
- Genre: {genre}
- Overall Mood: {mood}
- Themes: {themes}

AVAILABLE ELEVENLABS V3 EMOTIONS: excited, sad, angry, calm, fearful, surprised, whisper, shouting
VOICE ARCHETYPES: hero, mentor, villain, trickster, innocent, lover, sage, rebel, caregiver, everyman, jester, ruler, explorer, creator, magician

Return ONLY valid JSON with this structure:
{
  "voice_archetype": "hero|mentor|villain|trickster|innocent|lover|sage|rebel|caregiver|everyman|jester|ruler|explorer|creator|magician",
  "base_settings": {
    "stability": 0.0-1.0,
    "style": 0.0-1.0,
    "speed_modifier": 0.85-1.15
  },
  "emotional_range": {
    "default": "calm|excited|sad|etc",
    "when_stressed": "fearful|angry|etc",
    "when_happy": "excited|calm|etc",
    "when_angry": "angry|shouting|etc",
    "when_sad": "sad|whisper|etc"
  },
  "speech_patterns": {
    "uses_dramatic_pauses": true|false,
    "speaks_quickly_when_nervous": true|false,
    "whispers_secrets": true|false,
    "shouts_in_anger": true|false,
    "trails_off_when_uncertain": true|false,
    "emphasizes_key_words": true|false
  },
  "signature_delivery": "measured|rapid|contemplative|passionate|clipped|flowing|etc",
  "characteristic_tags": ["[calm]", "[pause:0.5s]", "etc - up to 4 tags this character often uses"],
  "voice_description": "Brief description of how this character's voice should sound (for voice casting)"
}

Make the profile specific to this character's personality. A nervous character should have lower stability. An authoritative character should have higher stability. Consider how their emotions manifest in their speech patterns.`;

/**
 * Generate a voice profile for a character
 * @param {Object} character - Character data
 * @param {string} character.name - Character name
 * @param {string} character.role - Character role (protagonist, villain, etc.)
 * @param {string} character.description - Character description
 * @param {string} character.personality - Personality description
 * @param {string[]} character.traits - Character traits
 * @param {string} character.gender - Character gender
 * @param {Object} storyContext - Story context
 * @param {string} storyContext.genre - Story genre
 * @param {string} storyContext.mood - Overall story mood
 * @param {string[]} storyContext.themes - Story themes
 * @returns {Promise<CharacterVoiceProfile>} Generated voice profile
 */
export async function generateCharacterVoiceProfile(character, storyContext) {
  const startTime = Date.now();

  // Get genre-based defaults
  const genreDefaults = getCharacterTypeProfile(character.role, storyContext.genre);

  // Build prompt
  const prompt = CHARACTER_VOICE_PROMPT
    .replace('{name}', character.name || 'Unknown')
    .replace('{role}', character.role || 'supporting')
    .replace('{description}', character.description || 'No description provided')
    .replace('{personality}', character.personality || 'Not specified')
    .replace('{traits}', (character.traits || []).join(', ') || 'none specified')
    .replace('{gender}', character.gender || 'neutral')
    .replace('{genre}', storyContext.genre || 'general fiction')
    .replace('{mood}', storyContext.mood || 'neutral')
    .replace('{themes}', (storyContext.themes || []).join(', ') || 'not specified');

  try {
    logger.info('[CharacterVoiceAgent] Generating voice profile', {
      character: character.name,
      role: character.role
    });

    const response = await callLLM({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
      forceProvider: 'openai',
      agent_name: 'CharacterVoiceAgent',
      agent_category: 'voice_direction'
    });

    // Parse JSON response - callLLM returns { content, ... } object
    const responseText = response?.content || response;
    let profile;
    try {
      let jsonStr = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      profile = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.warn('[CharacterVoiceAgent] Failed to parse response, using defaults', {
        character: character.name,
        error: parseError.message
      });
      profile = getDefaultCharacterProfile(character, genreDefaults);
    }

    // Validate and sanitize
    const validatedProfile = validateCharacterProfile(profile, genreDefaults);

    const elapsed = Date.now() - startTime;
    logger.info('[CharacterVoiceAgent] Voice profile generated', {
      character: character.name,
      archetype: validatedProfile.voice_archetype,
      stability: validatedProfile.base_settings.stability,
      elapsed: `${elapsed}ms`
    });

    return validatedProfile;
  } catch (error) {
    logger.error('[CharacterVoiceAgent] Failed to generate profile', {
      character: character.name,
      error: error.message
    });

    return getDefaultCharacterProfile(character, genreDefaults);
  }
}

/**
 * Generate voice profiles for multiple characters in batch
 * @param {Object[]} characters - Array of character data
 * @param {Object} storyContext - Story context
 * @returns {Promise<Map<string, CharacterVoiceProfile>>} Map of character name to profile
 */
export async function generateCharacterVoiceProfiles(characters, storyContext) {
  const profiles = new Map();

  // Process in parallel with rate limiting
  const batchSize = 3;
  for (let i = 0; i < characters.length; i += batchSize) {
    const batch = characters.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(char => generateCharacterVoiceProfile(char, storyContext))
    );

    batch.forEach((char, idx) => {
      profiles.set(char.name, results[idx]);
    });
  }

  return profiles;
}

/**
 * Validate and sanitize a character voice profile
 */
function validateCharacterProfile(profile, genreDefaults) {
  const validEmotions = ['excited', 'sad', 'angry', 'calm', 'fearful', 'surprised', 'whisper', 'shouting'];
  const validArchetypes = ['hero', 'mentor', 'villain', 'trickster', 'innocent', 'lover', 'sage', 'rebel', 'caregiver', 'everyman', 'jester', 'ruler', 'explorer', 'creator', 'magician'];

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val || (min + max) / 2));
  const validateEmotion = (e) => validEmotions.includes(e) ? e : 'calm';

  const defaults = genreDefaults || {
    stability: 0.5,
    style: 0.6,
    emotionBias: ['calm', 'excited']
  };

  return {
    voice_archetype: validArchetypes.includes(profile.voice_archetype)
      ? profile.voice_archetype
      : 'everyman',
    base_settings: {
      stability: clamp(profile.base_settings?.stability, 0.2, 0.8) || defaults.stability,
      style: clamp(profile.base_settings?.style, 0.3, 0.9) || defaults.style,
      speed_modifier: clamp(profile.base_settings?.speed_modifier, 0.85, 1.15) || 1.0
    },
    emotional_range: {
      default: validateEmotion(profile.emotional_range?.default) || defaults.emotionBias?.[0] || 'calm',
      when_stressed: validateEmotion(profile.emotional_range?.when_stressed) || 'fearful',
      when_happy: validateEmotion(profile.emotional_range?.when_happy) || 'excited',
      when_angry: validateEmotion(profile.emotional_range?.when_angry) || 'angry',
      when_sad: validateEmotion(profile.emotional_range?.when_sad) || 'sad'
    },
    speech_patterns: {
      uses_dramatic_pauses: Boolean(profile.speech_patterns?.uses_dramatic_pauses),
      speaks_quickly_when_nervous: Boolean(profile.speech_patterns?.speaks_quickly_when_nervous),
      whispers_secrets: Boolean(profile.speech_patterns?.whispers_secrets),
      shouts_in_anger: Boolean(profile.speech_patterns?.shouts_in_anger),
      trails_off_when_uncertain: Boolean(profile.speech_patterns?.trails_off_when_uncertain),
      emphasizes_key_words: Boolean(profile.speech_patterns?.emphasizes_key_words)
    },
    signature_delivery: profile.signature_delivery || 'measured',
    characteristic_tags: (profile.characteristic_tags || [])
      .filter(tag => tag.match(/^\[(excited|sad|angry|calm|fearful|surprised|whisper|shouting|pause:\d+\.?\d*s)\]$/))
      .slice(0, 4),
    voice_description: (profile.voice_description || '').substring(0, 300)
  };
}

/**
 * Get default character profile when LLM fails
 */
function getDefaultCharacterProfile(character, genreDefaults) {
  const roleToArchetype = {
    protagonist: 'hero',
    hero: 'hero',
    heroine: 'hero',
    villain: 'villain',
    antagonist: 'villain',
    mentor: 'mentor',
    guide: 'sage',
    sidekick: 'everyman',
    companion: 'caregiver',
    'love interest': 'lover',
    trickster: 'trickster',
    comic_relief: 'jester'
  };

  const defaults = genreDefaults || {
    stability: 0.5,
    style: 0.6,
    emotionBias: ['calm', 'excited']
  };

  const archetype = roleToArchetype[character.role?.toLowerCase()] || 'everyman';

  return {
    voice_archetype: archetype,
    base_settings: {
      stability: defaults.stability,
      style: defaults.style,
      speed_modifier: 1.0
    },
    emotional_range: {
      default: defaults.emotionBias?.[0] || 'calm',
      when_stressed: 'fearful',
      when_happy: 'excited',
      when_angry: 'angry',
      when_sad: 'sad'
    },
    speech_patterns: {
      uses_dramatic_pauses: archetype === 'villain' || archetype === 'sage',
      speaks_quickly_when_nervous: archetype === 'everyman' || archetype === 'trickster',
      whispers_secrets: archetype === 'trickster' || archetype === 'lover',
      shouts_in_anger: archetype === 'hero' || archetype === 'villain',
      trails_off_when_uncertain: archetype === 'innocent' || archetype === 'everyman',
      emphasizes_key_words: archetype === 'mentor' || archetype === 'ruler'
    },
    signature_delivery: 'measured',
    characteristic_tags: ['[calm]'],
    voice_description: `A ${character.gender || 'neutral'} voice suited for a ${character.role || 'supporting'} character.`
  };
}

/**
 * Get the appropriate emotion for a character given their emotional state
 * @param {CharacterVoiceProfile} profile - Character's voice profile
 * @param {string} emotionalState - Current emotional state (stressed, happy, angry, sad, neutral)
 * @returns {string} Appropriate ElevenLabs V3 emotion
 */
export function getCharacterEmotion(profile, emotionalState) {
  if (!profile || !profile.emotional_range) {
    return 'calm';
  }

  const stateMap = {
    stressed: profile.emotional_range.when_stressed,
    nervous: profile.emotional_range.when_stressed,
    anxious: profile.emotional_range.when_stressed,
    happy: profile.emotional_range.when_happy,
    joyful: profile.emotional_range.when_happy,
    excited: profile.emotional_range.when_happy,
    angry: profile.emotional_range.when_angry,
    furious: profile.emotional_range.when_angry,
    frustrated: profile.emotional_range.when_angry,
    sad: profile.emotional_range.when_sad,
    melancholy: profile.emotional_range.when_sad,
    grief: profile.emotional_range.when_sad,
    neutral: profile.emotional_range.default,
    default: profile.emotional_range.default
  };

  return stateMap[emotionalState?.toLowerCase()] || profile.emotional_range.default || 'calm';
}

/**
 * Get voice settings adjustments based on speech patterns
 * @param {CharacterVoiceProfile} profile - Character's voice profile
 * @param {Object} lineContext - Context about the current line
 * @param {boolean} lineContext.isSecret - Is this a secret/whispered line
 * @param {boolean} lineContext.isAngry - Is the character angry
 * @param {boolean} lineContext.isNervous - Is the character nervous
 * @param {boolean} lineContext.isUncertain - Is the character uncertain
 * @returns {Object} Voice setting adjustments and suggested tags
 */
export function getLineLevelAdjustments(profile, lineContext) {
  if (!profile) {
    return { adjustments: {}, tags: [] };
  }

  const adjustments = {};
  const tags = [];
  const patterns = profile.speech_patterns || {};

  // Apply speech pattern rules
  if (lineContext.isSecret && patterns.whispers_secrets) {
    tags.push('[whisper]');
    adjustments.stability = -0.1; // More variation for whispers
  }

  if (lineContext.isAngry && patterns.shouts_in_anger) {
    tags.push('[shouting]');
    adjustments.style = 0.2; // More expressive
  }

  if (lineContext.isNervous && patterns.speaks_quickly_when_nervous) {
    adjustments.speed = 0.1; // Slightly faster
    adjustments.stability = -0.1; // More variation
  }

  if (lineContext.isUncertain && patterns.trails_off_when_uncertain) {
    tags.push('[pause:0.5s]');
    adjustments.speed = -0.05; // Slightly slower
  }

  if (patterns.uses_dramatic_pauses && lineContext.isDramatic) {
    tags.push('[pause:1s]');
  }

  return { adjustments, tags };
}

export default {
  generateCharacterVoiceProfile,
  generateCharacterVoiceProfiles,
  getCharacterEmotion,
  getLineLevelAdjustments
};
