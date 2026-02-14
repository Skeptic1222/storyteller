/**
 * Age-Based Emotion Profiles
 *
 * Provides age-appropriate emotional defaults for voice direction.
 * This prevents children from defaulting to [calm] (flat delivery)
 * and ensures appropriate emotional range for each age group.
 *
 * Used by:
 * - voiceDirectorAgent.js (context-aware emotion defaults)
 * - characterVoiceProfileAgent.js (profile generation)
 * - voiceSelectionService.js (voice matching)
 *
 * @module ageEmotionProfiles
 */

import { logger } from '../../utils/logger.js';

/**
 * Comprehensive age-based emotion profiles
 * Each profile defines:
 * - emotionBias: Emotions this age group naturally gravitates toward
 * - avoidEmotions: Emotions that sound unnatural for this age
 * - defaultEmotion: Fallback when no context available
 * - stabilityModifier: Adjustment to base stability (negative = more expressive)
 * - styleModifier: Adjustment to base style
 * - deliveryNotes: Guidance for voice direction
 * - speechPatterns: Common speech characteristics
 */
export const AGE_EMOTION_PROFILES = {
  child: {
    ageRange: '0-12',
    emotionBias: ['excited', 'surprised', 'fearful'],
    avoidEmotions: ['whisper', 'calm'],  // Children are rarely calm/whispery
    defaultEmotion: 'excited',
    stabilityModifier: -0.15,  // More expressive variation
    styleModifier: 0.1,        // Slightly more stylized
    deliveryNotes: 'High energy, enthusiastic, bigger emotional swings. Voice should convey wonder and innocence.',
    speechPatterns: {
      sentenceLength: 'short',
      vocabulary: 'simple',
      mayStumbleOverBigWords: true,
      usesFillerWords: true,  // "um", "like"
      exclamatoryFrequency: 'high'
    },
    characteristicTags: ['[excitedly]', '[in awe]', '[wide-eyed]', '[bouncing with energy]'],
    stabilityRange: { min: 0.25, max: 0.45, default: 0.35 },
    v3Preferences: {
      preferredTags: ['excited', 'surprised', 'fearful'],
      avoidTags: ['calm', 'whisper'],
      pauseFrequency: 'low'  // Children don't use dramatic pauses often
    }
  },

  teen: {
    ageRange: '13-17',
    emotionBias: ['excited', 'angry', 'sad'],
    avoidEmotions: [],  // Teens can use full range, just more dramatically
    defaultEmotion: 'excited',
    stabilityModifier: -0.10,  // Emotionally volatile
    styleModifier: 0.15,       // More dramatic
    deliveryNotes: 'Dramatic reactions, emotional volatility, may shift rapidly between extremes. Sarcasm common.',
    speechPatterns: {
      sentenceLength: 'variable',
      vocabulary: 'casual',
      usesSarcasm: true,
      dramaticEmphasis: true,
      mayAttemptMatureVoice: true
    },
    characteristicTags: ['[with dramatic emphasis]', '[rolling eyes]', '[sighing heavily]', '[with teenage intensity]'],
    stabilityRange: { min: 0.30, max: 0.55, default: 0.40 },
    v3Preferences: {
      preferredTags: ['excited', 'angry', 'sad', 'surprised'],
      avoidTags: [],
      pauseFrequency: 'medium'
    }
  },

  young_adult: {
    ageRange: '18-29',
    emotionBias: ['excited', 'calm', 'surprised'],
    avoidEmotions: [],
    defaultEmotion: 'calm',
    stabilityModifier: 0,  // Neutral
    styleModifier: 0,
    deliveryNotes: 'Finding their voice. May overcompensate with confidence. Full emotional range available.',
    speechPatterns: {
      sentenceLength: 'moderate',
      vocabulary: 'standard',
      professionalAttempts: true,
      casualWithPeers: true
    },
    characteristicTags: [],  // No specific defaults
    stabilityRange: { min: 0.40, max: 0.60, default: 0.50 },
    v3Preferences: {
      preferredTags: ['calm', 'excited', 'surprised'],
      avoidTags: [],
      pauseFrequency: 'medium'
    }
  },

  adult: {
    ageRange: '30-55',
    emotionBias: ['calm', 'angry', 'sad'],
    avoidEmotions: [],
    defaultEmotion: 'calm',
    stabilityModifier: 0.05,  // Slightly more controlled
    styleModifier: 0,
    deliveryNotes: 'Measured and controlled, but can access full emotional range when triggered. Experience shows in voice.',
    speechPatterns: {
      sentenceLength: 'moderate',
      vocabulary: 'developed',
      measuredDelivery: true,
      emotionalControl: 'high'
    },
    characteristicTags: ['[with quiet authority]', '[measured]', '[firmly]'],
    stabilityRange: { min: 0.45, max: 0.70, default: 0.55 },
    v3Preferences: {
      preferredTags: ['calm', 'angry', 'sad'],
      avoidTags: [],
      pauseFrequency: 'medium'
    }
  },

  middle_aged: {
    ageRange: '45-65',
    emotionBias: ['calm', 'sad', 'angry'],
    avoidEmotions: ['excited'],  // Less likely to be overly excited
    defaultEmotion: 'calm',
    stabilityModifier: 0.08,
    styleModifier: -0.05,  // More naturalistic
    deliveryNotes: 'Weathered wisdom, experienced delivery. May carry weariness or determination. Deep emotional resonance.',
    speechPatterns: {
      sentenceLength: 'deliberate',
      vocabulary: 'rich',
      lifeLessonsEvident: true,
      measuredPace: true
    },
    characteristicTags: ['[with weathered wisdom]', '[resignedly]', '[with quiet determination]'],
    stabilityRange: { min: 0.50, max: 0.70, default: 0.60 },
    v3Preferences: {
      preferredTags: ['calm', 'sad', 'whisper'],
      avoidTags: ['excited', 'shouting'],
      pauseFrequency: 'medium-high'
    }
  },

  elderly: {
    ageRange: '65+',
    emotionBias: ['calm', 'sad', 'whisper'],
    avoidEmotions: ['shouting', 'excited'],  // Less energy for extremes
    defaultEmotion: 'calm',
    stabilityModifier: 0.12,  // More consistent delivery
    styleModifier: -0.1,      // Very naturalistic
    deliveryNotes: 'Slow, measured pace. Wisdom in tone. May tire vocally. Warmth or weariness depending on character.',
    speechPatterns: {
      sentenceLength: 'deliberate',
      vocabulary: 'traditional',
      storiesAndAnecdotes: true,
      vocalFatigue: 'possible',
      wisdomInTone: true
    },
    characteristicTags: ['[wearily]', '[with aged wisdom]', '[warmly]', '[with quiet authority]', '[reminiscently]'],
    stabilityRange: { min: 0.55, max: 0.80, default: 0.65 },
    v3Preferences: {
      preferredTags: ['calm', 'sad', 'whisper'],
      avoidTags: ['shouting', 'excited'],
      pauseFrequency: 'high'
    }
  }
};

/**
 * Get emotion profile for an age group
 * @param {string} ageGroup - Age group identifier
 * @returns {Object} Age emotion profile
 */
export function getAgeProfile(ageGroup) {
  const normalizedAge = (ageGroup || 'adult').toLowerCase().replace(/[^a-z_]/g, '');
  return AGE_EMOTION_PROFILES[normalizedAge] || AGE_EMOTION_PROFILES.adult;
}

/**
 * Get the default emotion for an age group
 * @param {string} ageGroup - Age group identifier
 * @returns {string} Default V3 emotion tag content (without brackets)
 */
export function getAgeDefaultEmotion(ageGroup) {
  const profile = getAgeProfile(ageGroup);
  return profile.defaultEmotion;
}

/**
 * Get stability adjustment for an age group
 * @param {string} ageGroup - Age group identifier
 * @param {number} baseStability - Base stability value (0-1)
 * @returns {number} Adjusted stability value (clamped 0-1)
 */
export function getAgeAdjustedStability(ageGroup, baseStability = 0.5) {
  const profile = getAgeProfile(ageGroup);
  const adjusted = baseStability + profile.stabilityModifier;
  return Math.max(profile.stabilityRange.min, Math.min(profile.stabilityRange.max, adjusted));
}

/**
 * Check if an emotion is appropriate for an age group
 * @param {string} ageGroup - Age group identifier
 * @param {string} emotion - V3 emotion to check
 * @returns {boolean} Whether the emotion is appropriate
 */
export function isEmotionAppropriate(ageGroup, emotion) {
  const profile = getAgeProfile(ageGroup);
  const emotionLower = (emotion || '').toLowerCase().replace(/[\[\]]/g, '');

  // Check if explicitly avoided
  if (profile.avoidEmotions.includes(emotionLower)) {
    return false;
  }

  return true;
}

/**
 * Get an age-appropriate alternative for an inappropriate emotion
 * @param {string} ageGroup - Age group identifier
 * @param {string} emotion - V3 emotion that was deemed inappropriate
 * @returns {string} Alternative emotion
 */
export function getAlternativeEmotion(ageGroup, emotion) {
  const profile = getAgeProfile(ageGroup);

  // Map inappropriate emotions to age-appropriate alternatives
  const alternatives = {
    calm: profile.emotionBias[0] || 'excited',  // For children who shouldn't be calm
    whisper: profile.emotionBias[0] || 'excited',
    shouting: profile.emotionBias.includes('angry') ? 'angry' : 'calm',
    excited: profile.emotionBias[0] || 'calm'
  };

  const emotionLower = (emotion || '').toLowerCase().replace(/[\[\]]/g, '');
  return alternatives[emotionLower] || profile.defaultEmotion;
}

/**
 * Apply age modifiers to voice settings
 * @param {string} ageGroup - Age group identifier
 * @param {Object} voiceSettings - Base voice settings
 * @returns {Object} Modified voice settings
 */
export function applyAgeModifiers(ageGroup, voiceSettings = {}) {
  const profile = getAgeProfile(ageGroup);

  const baseStability = voiceSettings.stability ?? 0.5;
  const baseStyle = voiceSettings.style ?? 0.3;

  return {
    ...voiceSettings,
    stability: getAgeAdjustedStability(ageGroup, baseStability),
    style: Math.max(0, Math.min(1, baseStyle + profile.styleModifier)),
    ageProfile: profile  // Include profile for reference
  };
}

/**
 * Get characteristic tags for an age group
 * @param {string} ageGroup - Age group identifier
 * @returns {Array<string>} Array of characteristic audio tags
 */
export function getCharacteristicTags(ageGroup) {
  const profile = getAgeProfile(ageGroup);
  return profile.characteristicTags || [];
}

/**
 * Log age profile application for debugging
 * @param {string} characterName - Character name
 * @param {string} ageGroup - Applied age group
 * @param {Object} settings - Final settings
 */
export function logAgeProfileApplication(characterName, ageGroup, settings) {
  const profile = getAgeProfile(ageGroup);
  logger.debug(`[AgeEmotionProfile] ${characterName} | age: ${ageGroup} | ` +
    `default: ${profile.defaultEmotion} | stability: ${settings.stability?.toFixed(2)} | ` +
    `bias: ${profile.emotionBias.join(', ')}`);
}

export default {
  AGE_EMOTION_PROFILES,
  getAgeProfile,
  getAgeDefaultEmotion,
  getAgeAdjustedStability,
  isEmotionAppropriate,
  getAlternativeEmotion,
  applyAgeModifiers,
  getCharacteristicTags,
  logAgeProfileApplication
};
