/**
 * Centralized Content Intensity Thresholds
 *
 * IMPORTANT: This file is the single source of truth for all content intensity
 * thresholds across the application. All provider selection, pipeline routing,
 * and content handling should import from here.
 *
 * Created: 2026-01-26
 * Purpose: Fix threshold inconsistencies (P0 Issue #4)
 *
 * Previous inconsistencies fixed:
 * - scaffoldPromptTemplates.js used romance >= 61
 * - llmProviders.js used romance >= 71
 * - hybridContentPipeline.js used romance >= 50
 *
 * Now unified with documented reasoning for each threshold.
 */

/**
 * Provider selection thresholds - determines when to use Venice vs OpenAI
 * These are the minimum values that trigger mature content handling
 */
export const PROVIDER_SELECTION = {
  // Triggers Venice for explicit adult content
  // Value: 50 (moderate+ adult content)
  adultContent: 50,

  // Triggers Venice for high romance (was inconsistent: 61 vs 71)
  // Using 65 as compromise - captures "steamy" content without flagging mild romance
  romance: 65,

  // Triggers intent validation for violence
  violence: 60,

  // Triggers explicit content handling for gore
  gore: 50,

  // High explicitness triggers Venice
  explicitness: 71,

  // High sensuality triggers Venice
  sensuality: 71
};

/**
 * Full hybrid pipeline thresholds - triggers the complete Venice hybrid pipeline
 * These represent "maximum explicit" settings where user wants fully explicit content
 */
export const FULL_HYBRID = {
  // Full hybrid for explicitly requested adult content
  adultContent: 80,

  // Full hybrid for maximum romance intensity
  romance: 80,

  // Full hybrid for extreme violence
  violence: 80,

  // Full hybrid for graphic gore
  gore: 80,

  // Full hybrid for maximum sensuality
  sensuality: 75
};

/**
 * Scaffolding pipeline thresholds - when to use scaffolding vs direct generation
 */
export const SCAFFOLDING = {
  // When to use coherence checking in scaffold pipeline
  coherenceCheck: 70,

  // Scene placeholder thresholds for intimate scenes
  intimateScene: {
    romance: 61,      // Slightly lower than provider selection
    adultContent: 50  // Same as provider selection
  },

  // Inline placeholder thresholds
  inlinePlaceholder: {
    romance: 51,      // Lower threshold for inline sensual details
    adultContent: 30  // Very low - catches most mature content
  },

  // Violence and language thresholds for scaffold
  violence: 61,
  gore: 61,
  language: 51
};

/**
 * Safety check thresholds - when to skip safety checks for mature content
 */
export const SAFETY = {
  // Skip most safety checks for mature audiences with high adult content
  skipChecksThreshold: 50
};

/**
 * Tiered content levels for graduated responses
 */
export const CONTENT_TIERS = {
  // Mild content (fade to black, suggestive only)
  MILD: {
    min: 30,
    max: 50
  },

  // Moderate content (descriptive but tasteful)
  MODERATE: {
    min: 50,
    max: 70
  },

  // Explicit content (fully descriptive)
  EXPLICIT: {
    min: 70,
    max: 85
  },

  // Maximum content (graphic, no holds barred)
  MAXIMUM: {
    min: 85,
    max: 100
  }
};

/**
 * Helper functions for threshold checking
 */

/**
 * Check if content settings require Venice provider
 * @param {Object} intensity - Content intensity settings
 * @returns {boolean}
 */
export function requiresVeniceProvider(intensity = {}) {
  const {
    adultContent = 0,
    romance = 0,
    violence = 0,
    gore = 0,
    explicitness = 0,
    sensuality = 0
  } = intensity;

  return (
    adultContent >= PROVIDER_SELECTION.adultContent ||
    romance >= PROVIDER_SELECTION.romance ||
    violence >= PROVIDER_SELECTION.violence ||
    gore >= PROVIDER_SELECTION.gore ||
    explicitness >= PROVIDER_SELECTION.explicitness ||
    sensuality >= PROVIDER_SELECTION.sensuality
  );
}

/**
 * Check if settings warrant full hybrid pipeline
 * @param {Object} intensity - Content intensity settings
 * @returns {boolean}
 */
export function requiresFullHybrid(intensity = {}) {
  const {
    adultContent = 0,
    romance = 0,
    violence = 0,
    gore = 0,
    sensuality = 0
  } = intensity;

  return (
    adultContent >= FULL_HYBRID.adultContent ||
    romance >= FULL_HYBRID.romance ||
    violence >= FULL_HYBRID.violence ||
    gore >= FULL_HYBRID.gore ||
    sensuality >= FULL_HYBRID.sensuality
  );
}

/**
 * Check if safety checks should be skipped for mature content
 * @param {string} audience - Audience setting ('general', 'mature', etc.)
 * @param {Object} intensity - Content intensity settings
 * @returns {boolean}
 */
export function shouldSkipSafetyChecks(audience, intensity = {}) {
  const adultContentLevel = intensity.adultContent ?? intensity.romance ?? 0;
  return audience === 'mature' && adultContentLevel >= SAFETY.skipChecksThreshold;
}

/**
 * Get content tier for a given intensity level
 * @param {number} level - Intensity level (0-100)
 * @returns {string} - Tier name: 'MILD', 'MODERATE', 'EXPLICIT', or 'MAXIMUM'
 */
export function getContentTier(level) {
  if (level >= CONTENT_TIERS.MAXIMUM.min) return 'MAXIMUM';
  if (level >= CONTENT_TIERS.EXPLICIT.min) return 'EXPLICIT';
  if (level >= CONTENT_TIERS.MODERATE.min) return 'MODERATE';
  return 'MILD';
}

/**
 * Get human-readable trigger reason for logging
 * @param {Object} intensity - Content intensity settings
 * @returns {string} - The reason for content triggering (e.g., 'adultContent', 'romance')
 */
export function getTriggerReason(intensity = {}) {
  const {
    adultContent = 0,
    romance = 0,
    violence = 0,
    gore = 0
  } = intensity;

  if (adultContent >= PROVIDER_SELECTION.adultContent) return 'adultContent';
  if (romance >= PROVIDER_SELECTION.romance) return 'romance';
  if (violence >= PROVIDER_SELECTION.violence) return 'violence';
  if (gore >= PROVIDER_SELECTION.gore) return 'gore';
  return 'none';
}

// Default export for convenience
export default {
  PROVIDER_SELECTION,
  FULL_HYBRID,
  SCAFFOLDING,
  SAFETY,
  CONTENT_TIERS,
  requiresVeniceProvider,
  requiresFullHybrid,
  shouldSkipSafetyChecks,
  getContentTier,
  getTriggerReason
};
