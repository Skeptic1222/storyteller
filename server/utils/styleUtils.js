/**
 * Style Utilities
 * Helper functions for voice style settings normalization
 */

/**
 * Normalizes a style value to the 0-1 range expected by ElevenLabs API.
 *
 * ElevenLabs expects style values between 0 and 1, but our UI often uses
 * percentage values (0-100) for better UX. This function handles both:
 * - Values > 1 are treated as percentages and divided by 100
 * - Values <= 1 are returned as-is (already normalized)
 *
 * @param {number} rawStyle - The raw style value (0-100 or 0-1)
 * @param {number} defaultValue - Default value if rawStyle is undefined (default: 30)
 * @returns {number} Normalized style value between 0 and 1
 *
 * @example
 * normalizeStyleValue(30)    // Returns 0.30
 * normalizeStyleValue(0.3)   // Returns 0.30
 * normalizeStyleValue(100)   // Returns 1.00
 * normalizeStyleValue()      // Returns 0.30 (default)
 */
export function normalizeStyleValue(rawStyle, defaultValue = 30) {
  const value = rawStyle !== undefined ? rawStyle : defaultValue;
  return value > 1 ? value / 100 : value;
}

/**
 * Normalizes an entire voice settings object.
 * Converts style from percentage (0-100) to decimal (0-1) if needed.
 *
 * @param {object} settings - Voice settings object
 * @param {number} settings.stability - Voice stability (0-1)
 * @param {number} settings.similarity_boost - Voice similarity (0-1)
 * @param {number} settings.style - Voice style (0-100 or 0-1)
 * @param {boolean} settings.use_speaker_boost - Speaker boost toggle
 * @returns {object} Normalized settings object
 */
export function normalizeVoiceSettings(settings = {}) {
  return {
    stability: settings.stability ?? 0.5,
    similarity_boost: settings.similarity_boost ?? 0.75,
    style: normalizeStyleValue(settings.style, 30),
    use_speaker_boost: settings.use_speaker_boost ?? true
  };
}

export default {
  normalizeStyleValue,
  normalizeVoiceSettings
};
