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

export default {
  AUDIENCE_TYPES,
  DEFAULT_LIMITS,
  CHILDREN_MAX_LIMITS,
  getAudienceMultiplier,
  calculateEffectiveLimits,
  getAudienceContext
};
