/**
 * Audience Limits Utilities
 * Handles audience-based content intensity adjustments
 */

/**
 * Audience types
 * @type {Object}
 */
export const AUDIENCE_TYPES = {
  CHILDREN: 'children',
  GENERAL: 'general',
  MATURE: 'mature'
};

/**
 * Default intensity limits per category
 * @type {Object}
 */
export const DEFAULT_LIMITS = {
  violence: 20,
  gore: 0,
  scary: 30,
  romance: 20,
  language: 10,
  adultContent: 0  // Explicit sexual content - 0 by default
};

/**
 * Maximum limits for children's content
 * Very restrictive to ensure age-appropriate content
 * @type {Object}
 */
export const CHILDREN_MAX_LIMITS = {
  violence: 10,
  gore: 0,
  scary: 10,
  romance: 0,
  language: 0,
  adultContent: 0  // NEVER allow adult content for children
};

/**
 * Emotion constraints by audience type
 * Defines which emotions are blocked for each audience
 * @type {Object}
 */
export const AUDIENCE_EMOTION_CONSTRAINTS = {
  children: {
    // Blocked emotions - too intense for children
    blocked: ['horror', 'threatening', 'angry'],
    // Fallback emotions when blocked emotion is detected
    fallback: {
      horror: 'fearful',      // Tone down terror to mild fear
      threatening: 'mysterious', // Tone down menace to mystery
      angry: 'dramatic'       // Tone down fury to intensity
    },
    // Preferred emotions for children's content
    preferred: ['warm', 'playful', 'excited', 'tender']
  },
  general: {
    // No blocked emotions for general audience, but moderate intensity
    blocked: [],
    fallback: {},
    preferred: ['warm', 'playful', 'dramatic', 'excited', 'mysterious']
  },
  mature: {
    // Full emotional range for mature audience
    blocked: [],
    fallback: {},
    preferred: [] // No preference - allow full range
  }
};

/**
 * Get emotion fallback for audience
 * Returns the appropriate emotion if the original is blocked for the audience
 *
 * @param {string} emotion - Original emotion to check
 * @param {string} audience - Target audience ('children', 'general', 'mature')
 * @returns {{ emotion: string, wasFiltered: boolean }} Result with emotion and filter flag
 */
export function filterEmotionForAudience(emotion, audience = 'general') {
  const constraints = AUDIENCE_EMOTION_CONSTRAINTS[audience] || AUDIENCE_EMOTION_CONSTRAINTS.general;

  if (constraints.blocked.includes(emotion)) {
    const fallback = constraints.fallback[emotion] || 'neutral';
    return { emotion: fallback, wasFiltered: true, original: emotion };
  }

  return { emotion, wasFiltered: false };
}

/**
 * Check if an emotion is appropriate for the audience
 *
 * @param {string} emotion - Emotion to check
 * @param {string} audience - Target audience
 * @returns {boolean} True if emotion is allowed
 */
export function isEmotionAllowedForAudience(emotion, audience = 'general') {
  const constraints = AUDIENCE_EMOTION_CONSTRAINTS[audience] || AUDIENCE_EMOTION_CONSTRAINTS.general;
  return !constraints.blocked.includes(emotion);
}

/**
 * Get multiplier based on audience type.
 * - Children: 0 (forces minimums)
 * - General: 1 (no change)
 * - Mature: 1.5 (allows higher intensity)
 *
 * @param {string} audience - 'children', 'general', or 'mature'
 * @returns {number} Multiplier value (0, 1, or 1.5)
 */
export function getAudienceMultiplier(audience) {
  switch (audience) {
    case AUDIENCE_TYPES.CHILDREN:
      return 0;
    case AUDIENCE_TYPES.MATURE:
      return 1.5;
    default:
      return 1;
  }
}

/**
 * Calculate effective content limits based on audience.
 * Applies multiplier and enforces children's maximums.
 *
 * IMPORTANT: For mature audiences with high adultContent (>=50), limits are set to maximum
 * to allow explicit content as requested by the user.
 *
 * @param {Object} baseLimits - Base intensity limits from session config
 * @param {number} baseLimits.violence - Violence level (0-100)
 * @param {number} baseLimits.gore - Gore level (0-100)
 * @param {number} baseLimits.scary - Scary level (0-100)
 * @param {number} baseLimits.romance - Romance level (0-100)
 * @param {number} baseLimits.language - Language level (0-100)
 * @param {number} baseLimits.adultContent - Adult/explicit content level (0-100)
 * @param {string} audience - Target audience ('children', 'general', 'mature')
 * @returns {Object} Adjusted limits capped appropriately for audience
 *
 * @example
 * // For children's content - returns very low limits
 * calculateEffectiveLimits({ violence: 50, gore: 20 }, 'children')
 * // => { violence: 10, gore: 0, scary: 10, romance: 0, language: 0, adultContent: 0 }
 *
 * @example
 * // For mature content with high adultContent - returns maximum limits
 * calculateEffectiveLimits({ adultContent: 100, romance: 100 }, 'mature')
 * // => { violence: 100, gore: 100, scary: 100, romance: 100, language: 100, adultContent: 100 }
 */
export function calculateEffectiveLimits(baseLimits = {}, audience = 'general') {
  const multiplier = getAudienceMultiplier(audience);
  const isChildren = audience === AUDIENCE_TYPES.CHILDREN;
  const isMature = audience === AUDIENCE_TYPES.MATURE;

  // Check if mature audience with high adult content - if so, maximize all limits
  const adultContentLevel = baseLimits.adultContent ?? 0;
  const isMatureWithExplicit = isMature && adultContentLevel >= 50;

  if (isMatureWithExplicit) {
    // User wants explicit content - set all limits to what they specified or max
    return {
      violence: baseLimits.violence ?? 100,
      gore: baseLimits.gore ?? 100,
      scary: baseLimits.scary ?? 100,
      romance: baseLimits.romance ?? 100,
      language: baseLimits.language ?? 100,
      adultContent: baseLimits.adultContent ?? 100
    };
  }

  return {
    violence: Math.min(
      (baseLimits.violence ?? DEFAULT_LIMITS.violence) * multiplier,
      isChildren ? CHILDREN_MAX_LIMITS.violence : 100
    ),
    gore: Math.min(
      (baseLimits.gore ?? DEFAULT_LIMITS.gore) * multiplier,
      isChildren ? CHILDREN_MAX_LIMITS.gore : 100
    ),
    scary: Math.min(
      (baseLimits.scary ?? DEFAULT_LIMITS.scary) * multiplier,
      isChildren ? CHILDREN_MAX_LIMITS.scary : 100
    ),
    romance: Math.min(
      (baseLimits.romance ?? DEFAULT_LIMITS.romance) * multiplier,
      isChildren ? CHILDREN_MAX_LIMITS.romance : 100
    ),
    language: Math.min(
      (baseLimits.language ?? DEFAULT_LIMITS.language) * multiplier,
      isChildren ? CHILDREN_MAX_LIMITS.language : 100
    ),
    adultContent: isChildren ? 0 : Math.min(
      (baseLimits.adultContent ?? DEFAULT_LIMITS.adultContent) * multiplier,
      100
    )
  };
}

/**
 * Get audience context string for LLM prompts
 *
 * @param {string} audience - Target audience
 * @returns {string} Human-readable audience description
 */
export function getAudienceContext(audience) {
  switch (audience) {
    case AUDIENCE_TYPES.CHILDREN:
      return 'Children (ages 3-10)';
    case AUDIENCE_TYPES.MATURE:
      return 'Mature audiences';
    default:
      return 'General/family audience';
  }
}

/**
 * Content intensity to emotion intensity mapping
 * Maps high content intensity settings to appropriate voice delivery intensity
 *
 * @param {Object} contentLimits - Content intensity limits from session config
 * @param {number} contentLimits.violence - Violence level (0-100)
 * @param {number} contentLimits.gore - Gore level (0-100)
 * @param {number} contentLimits.scary - Scary level (0-100)
 * @param {number} contentLimits.romance - Romance level (0-100)
 * @param {number} contentLimits.adultContent - Adult content level (0-100)
 * @param {number} contentLimits.sensuality - Sensuality level (0-100)
 * @param {number} contentLimits.explicitness - Explicitness level (0-100)
 * @returns {Object} Intensity modifier with multiplier and preferred emotions
 *
 * @example
 * // High violence content
 * getEmotionIntensityModifier({ violence: 80, gore: 60 })
 * // => { intensityMultiplier: 1.4, preferredEmotions: ['angry', 'threatening', 'dramatic', 'terrified'], intensityCategories: { violence: 'high', gore: 'medium' }, deliveryGuidance: '...' }
 */
export function getEmotionIntensityModifier(contentLimits = {}) {
  const violence = contentLimits.violence ?? 0;
  const gore = contentLimits.gore ?? 0;
  const scary = contentLimits.scary ?? 0;
  const romance = contentLimits.romance ?? 0;
  const adultContent = contentLimits.adultContent ?? 0;
  const sensuality = contentLimits.sensuality ?? 0;
  const explicitness = contentLimits.explicitness ?? 0;

  // Categorize intensity levels
  const getIntensityLevel = (value) => {
    if (value >= 70) return 'high';
    if (value >= 40) return 'medium';
    return 'low';
  };

  const intensityCategories = {
    violence: getIntensityLevel(violence),
    gore: getIntensityLevel(gore),
    scary: getIntensityLevel(scary),
    romance: getIntensityLevel(romance),
    adultContent: getIntensityLevel(adultContent),
    sensuality: getIntensityLevel(sensuality),
    explicitness: getIntensityLevel(explicitness)
  };

  // Track which categories are at high intensity
  const highIntensityCategories = [];
  const preferredEmotions = new Set();
  const deliveryGuidances = [];

  // Violence/Gore: intense anger, brutality, visceral delivery
  if (violence >= 70 || gore >= 70) {
    highIntensityCategories.push('violence/gore');
    preferredEmotions.add('angry');
    preferredEmotions.add('furious');
    preferredEmotions.add('threatening');
    preferredEmotions.add('dramatic');
    preferredEmotions.add('menacing');
    deliveryGuidances.push(
      `VIOLENCE INTENSITY HIGH (${violence}/100, gore: ${gore}/100): ` +
      'Use visceral, brutal delivery. Characters should sound genuinely dangerous, ' +
      'terrified, or in pain. Allow shouting, snarling, desperate screaming. ' +
      'Narrator should build dread and convey impact of violence.'
    );
  } else if (violence >= 40 || gore >= 40) {
    preferredEmotions.add('dramatic');
    preferredEmotions.add('tense');
    deliveryGuidances.push(
      `MODERATE VIOLENCE (${violence}/100): Use tense, dramatic delivery for action scenes.`
    );
  }

  // Scary: horror, terror, dread
  if (scary >= 70) {
    highIntensityCategories.push('horror');
    preferredEmotions.add('horror');
    preferredEmotions.add('terrified');
    preferredEmotions.add('fearful');
    preferredEmotions.add('mysterious');
    preferredEmotions.add('threatening');
    deliveryGuidances.push(
      `SCARY INTENSITY HIGH (${scary}/100): ` +
      'Create genuine terror and dread. Allow trembling, whimpering, panicked delivery. ' +
      'Narrator should be ominous, creeping, building to horror peaks. ' +
      'Characters can scream in genuine terror.'
    );
  } else if (scary >= 40) {
    preferredEmotions.add('mysterious');
    preferredEmotions.add('fearful');
    deliveryGuidances.push(
      `MODERATE SCARY (${scary}/100): Use suspenseful, slightly fearful delivery.`
    );
  }

  // Romance/Sensuality: tender, intimate, passionate
  if (romance >= 70 || sensuality >= 60 || adultContent >= 50) {
    highIntensityCategories.push('romance');
    preferredEmotions.add('tender');
    preferredEmotions.add('loving');
    preferredEmotions.add('seductive');
    deliveryGuidances.push(
      `ROMANCE INTENSITY HIGH (romance: ${romance}/100, sensuality: ${sensuality}/100, adult: ${adultContent}/100): ` +
      'Use deeply intimate, charged delivery. Allow breathless, husky, passionate tones. ' +
      'Build emotional and physical tension through voice. ' +
      'Characters can express desire openly.'
    );
  } else if (romance >= 40) {
    preferredEmotions.add('tender');
    preferredEmotions.add('warm');
    deliveryGuidances.push(
      `MODERATE ROMANCE (${romance}/100): Use warm, affectionate delivery for romantic scenes.`
    );
  }

  // Explicit content: raw, intense, uninhibited
  if (explicitness >= 50 || adultContent >= 70) {
    highIntensityCategories.push('explicit');
    preferredEmotions.add('passionate');
    preferredEmotions.add('desperate');
    preferredEmotions.add('heated');
    deliveryGuidances.push(
      `EXPLICIT CONTENT (explicitness: ${explicitness}/100, adult: ${adultContent}/100): ` +
      'Deliver with raw, uninhibited emotional intensity. ' +
      'Allow moaning, gasping, breathless urgency where appropriate. ' +
      'Do not hold back on emotional/physical vocal expression.'
    );
  }

  // Calculate overall intensity multiplier (1.0 to 1.5)
  // Higher multiplier = more extreme/intense emotional delivery
  let intensityMultiplier = 1.0;
  if (highIntensityCategories.length > 0) {
    // Base boost for having any high intensity category
    intensityMultiplier = 1.2;

    // Additional boost for multiple high intensity categories
    intensityMultiplier += (highIntensityCategories.length - 1) * 0.1;

    // Cap at 1.5
    intensityMultiplier = Math.min(1.5, intensityMultiplier);
  } else {
    // Medium intensity categories get a smaller boost
    const mediumCount = Object.values(intensityCategories).filter(v => v === 'medium').length;
    if (mediumCount > 0) {
      intensityMultiplier = 1.0 + (mediumCount * 0.05);
      intensityMultiplier = Math.min(1.2, intensityMultiplier);
    }
  }

  // Build combined delivery guidance string
  const deliveryGuidance = deliveryGuidances.length > 0
    ? deliveryGuidances.join('\n\n')
    : 'Standard emotional delivery - match emotions to dialogue content naturally.';

  return {
    intensityMultiplier,
    preferredEmotions: Array.from(preferredEmotions),
    highIntensityCategories,
    intensityCategories,
    deliveryGuidance,
    // Quick flags for common checks
    hasHighIntensity: highIntensityCategories.length > 0,
    isViolent: violence >= 70 || gore >= 70,
    isScary: scary >= 70,
    isRomantic: romance >= 70 || sensuality >= 60,
    isExplicit: explicitness >= 50 || adultContent >= 70
  };
}

/**
 * Get emotion alternatives for intensity scaling
 * Maps base emotions to more intense variants when content intensity is high
 *
 * @param {string} baseEmotion - The base emotion detected
 * @param {Object} intensityModifier - Result from getEmotionIntensityModifier
 * @returns {string} The emotion to use (may be more intense variant)
 */
export function getIntenseEmotionVariant(baseEmotion, intensityModifier) {
  if (!intensityModifier?.hasHighIntensity) {
    return baseEmotion;
  }

  // Map base emotions to more intense variants
  const intensityScaling = {
    // Anger spectrum
    'angry': intensityModifier.isViolent ? 'furious' : 'angry',
    'dramatic': intensityModifier.isViolent ? 'threatening' : 'dramatic',

    // Fear spectrum
    'fearful': intensityModifier.isScary ? 'terrified' : 'fearful',
    'nervous': intensityModifier.isScary ? 'fearful' : 'nervous',
    'mysterious': intensityModifier.isScary ? 'threatening' : 'mysterious',

    // Romance spectrum
    'tender': intensityModifier.isRomantic ? 'loving' : 'tender',
    'warm': intensityModifier.isRomantic ? 'tender' : 'warm',

    // Keep these as-is (already intense)
    'furious': 'furious',
    'terrified': 'terrified',
    'horror': 'horror',
    'threatening': 'threatening',
    'loving': 'loving',
    'seductive': 'seductive'
  };

  return intensityScaling[baseEmotion] || baseEmotion;
}

export default {
  AUDIENCE_TYPES,
  DEFAULT_LIMITS,
  CHILDREN_MAX_LIMITS,
  AUDIENCE_EMOTION_CONSTRAINTS,
  getAudienceMultiplier,
  calculateEffectiveLimits,
  getAudienceContext,
  filterEmotionForAudience,
  isEmotionAllowedForAudience,
  getEmotionIntensityModifier,
  getIntenseEmotionVariant
};
