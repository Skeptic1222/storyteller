/**
 * Content Intensity Validator Agent
 * Compares generated content intensity vs. user slider settings.
 *
 * This agent is called AFTER content generation, BEFORE TTS.
 * Its purpose is to ensure the story matches the user's intensity expectations.
 *
 * Key insight from user: "81% must mean MORE than 80%" - each percentage point matters.
 *
 * MODEL: This is a UTILITY agent - uses GPT-4o-mini for fast analysis
 */

import { logger } from '../../utils/logger.js';
import { callAgent, parseJsonResponse } from '../openai.js';
import { getUtilityModel } from '../modelSelection.js';
import { logIntensityMismatch } from '../../utils/qaLogger.js';

/**
 * Intensity dimensions we validate
 */
const INTENSITY_DIMENSIONS = [
  'violence',
  'gore',
  'romance',
  'adultContent',
  'sensuality',
  'explicitness',
  'language',
  'scary',
  'bleakness',
  'sexualViolence'
];

/**
 * MEDIUM-15 FIX: Per-dimension tolerance modifiers
 * Some content types require stricter validation than others:
 * - Gore/sexualViolence: STRICT (these are the most sensitive)
 * - AdultContent/explicitness: STRICT (legal concerns)
 * - Violence/romance/sensuality: MODERATE
 * - Language/scary/bleakness: LENIENT (artistic license)
 */
const DIMENSION_TOLERANCE_MODIFIERS = {
  // STRICT: Reduce base tolerance by 4 points (sensitive content)
  gore: -4,
  sexualViolence: -4,
  adultContent: -3,
  explicitness: -3,

  // MODERATE: Use base tolerance (default)
  violence: 0,
  romance: 0,
  sensuality: 0,

  // LENIENT: Increase base tolerance by 3 points (artistic variance OK)
  language: 3,
  scary: 3,
  bleakness: 5  // Bleakness is very subjective
};

/**
 * Base tolerance thresholds for mismatch detection
 * These define how much variance we accept before flagging
 * Actual tolerance = base + dimension modifier
 */
const BASE_TOLERANCE = {
  // For low settings (0-30%), allow ±10% variance
  low: { range: [0, 30], tolerance: 10 },
  // For medium settings (31-60%), allow ±12% variance
  medium: { range: [31, 60], tolerance: 12 },
  // For high settings (61-100%), allow ±15% variance
  // Higher tolerance because extreme content is harder to calibrate
  high: { range: [61, 100], tolerance: 15 }
};

// Legacy alias for backwards compatibility
const TOLERANCE = BASE_TOLERANCE;

/**
 * Get tolerance for a given intensity level and dimension
 * MEDIUM-15 FIX: Now applies per-dimension modifiers
 *
 * @param {number} level - The intensity level (0-100)
 * @param {string} dimension - The content dimension (e.g., 'gore', 'language')
 * @returns {number} The tolerance threshold
 */
function getToleranceForLevel(level, dimension = null) {
  // Get base tolerance from level
  let baseTolerance;
  if (level <= TOLERANCE.low.range[1]) {
    baseTolerance = TOLERANCE.low.tolerance;
  } else if (level <= TOLERANCE.medium.range[1]) {
    baseTolerance = TOLERANCE.medium.tolerance;
  } else {
    baseTolerance = TOLERANCE.high.tolerance;
  }

  // Apply dimension-specific modifier if dimension provided
  if (dimension && DIMENSION_TOLERANCE_MODIFIERS[dimension] !== undefined) {
    baseTolerance = Math.max(3, baseTolerance + DIMENSION_TOLERANCE_MODIFIERS[dimension]);
  }

  return baseTolerance;
}

/**
 * Validation result structure
 */
function createValidationResult() {
  return {
    valid: true,
    timestamp: new Date().toISOString(),
    analyzed: {},
    expected: {},
    mismatches: [],
    shouldRegenerate: false,
    summary: ''
  };
}

export class ContentIntensityValidator {
  constructor() {
    this.model = getUtilityModel();
  }

  /**
   * Analyze the intensity of generated content using LLM
   *
   * @param {string} content - The generated story content
   * @param {object} options - Analysis options
   * @returns {object} Intensity scores for each dimension (0-100)
   */
  async analyzeIntensity(content, options = {}) {
    const { sessionId = null, sceneIndex = 0 } = options;

    // Truncate content to avoid token limits (keep first 3000 chars)
    const truncatedContent = content.length > 3000
      ? content.substring(0, 3000) + '...[truncated for analysis]'
      : content;

    const prompt = `Analyze this story content and rate its intensity levels on a precise 0-100 scale.

CONTENT TO ANALYZE:
${truncatedContent}

RATING SCALE GUIDANCE:
- 0-10: None/minimal (safe for all ages)
- 11-30: Light (PG-rated, implied rather than shown)
- 31-50: Moderate (PG-13, some detail but not graphic)
- 51-70: Strong (R-rated, explicit but not extreme)
- 71-90: Intense (graphic depictions, mature audiences only)
- 91-100: Extreme (very graphic, potentially disturbing)

IMPORTANT: Be precise. Differentiate between 80% and 81% - each point matters.

Return ONLY valid JSON:
{
  "violence": <0-100>,
  "gore": <0-100>,
  "romance": <0-100>,
  "adultContent": <0-100>,
  "sensuality": <0-100>,
  "explicitness": <0-100>,
  "language": <0-100>,
  "scary": <0-100>,
  "bleakness": <0-100>,
  "reasoning": {
    "violence": "brief explanation of rating",
    "gore": "brief explanation",
    "romance": "brief explanation",
    "adultContent": "brief explanation",
    "sensuality": "brief explanation",
    "explicitness": "brief explanation",
    "language": "brief explanation",
    "scary": "brief explanation",
    "bleakness": "brief explanation"
  }
}`;

    try {
      const result = await callAgent('intensity_validator', prompt, { sessionId });
      const parsed = parseJsonResponse(result.content);

      // Normalize scores to 0-100 range
      const normalized = {};
      for (const dim of INTENSITY_DIMENSIONS) {
        const score = parsed[dim];
        normalized[dim] = Math.min(100, Math.max(0, parseInt(score) || 0));
      }

      logger.debug(`[IntensityValidator] Analyzed scene ${sceneIndex}:`, normalized);

      return {
        ...normalized,
        reasoning: parsed.reasoning || {}
      };
    } catch (error) {
      logger.error('[IntensityValidator] Analysis failed:', error.message);
      // Return neutral scores on failure (don't block generation)
      return INTENSITY_DIMENSIONS.reduce((acc, dim) => {
        acc[dim] = 50; // Neutral
        return acc;
      }, { reasoning: { error: error.message } });
    }
  }

  /**
   * Compare analyzed intensity against user slider settings
   *
   * @param {object} analyzed - LLM-analyzed intensity scores
   * @param {object} sliderSettings - User's slider settings from config
   * @returns {Array} Array of mismatch objects
   */
  findMismatches(analyzed, sliderSettings) {
    const mismatches = [];

    for (const dim of INTENSITY_DIMENSIONS) {
      const expected = sliderSettings[dim] ?? 0;
      const actual = analyzed[dim] ?? 0;
      // MEDIUM-15: Pass dimension for per-type tolerance modifiers
      const tolerance = getToleranceForLevel(expected, dim);
      const delta = actual - expected;

      // Check if mismatch exceeds tolerance
      if (Math.abs(delta) > tolerance) {
        const severity = Math.abs(delta) > 30 ? 'high' : 'medium';
        const direction = delta > 0 ? 'over' : 'under';

        mismatches.push({
          dimension: dim,
          expected,
          actual,
          delta,
          tolerance,
          severity,
          direction,
          description: this.getMismatchDescription(dim, expected, actual, direction)
        });
      }
    }

    return mismatches;
  }

  /**
   * Get human-readable description of a mismatch
   */
  getMismatchDescription(dimension, expected, actual, direction) {
    const descriptions = {
      violence: {
        over: `Content more violent than requested (${actual}% vs ${expected}%)`,
        under: `Content less violent than requested (${actual}% vs ${expected}%)`
      },
      gore: {
        over: `Graphic content exceeds settings (${actual}% vs ${expected}%)`,
        under: `Gore level below user expectation (${actual}% vs ${expected}%)`
      },
      romance: {
        over: `Romance more intense than requested (${actual}% vs ${expected}%)`,
        under: `Romance less intense than expected (${actual}% vs ${expected}%)`
      },
      adultContent: {
        over: `Adult content exceeds settings (${actual}% vs ${expected}%)`,
        under: `Adult content below user expectation (${actual}% vs ${expected}%)`
      },
      sensuality: {
        over: `Sensuality exceeds settings (${actual}% vs ${expected}%)`,
        under: `Sensuality below expectation (${actual}% vs ${expected}%)`
      },
      explicitness: {
        over: `Explicit content exceeds settings (${actual}% vs ${expected}%)`,
        under: `Explicit content below expectation (${actual}% vs ${expected}%)`
      },
      language: {
        over: `Language stronger than requested (${actual}% vs ${expected}%)`,
        under: `Language milder than expected (${actual}% vs ${expected}%)`
      },
      scary: {
        over: `Scarier than requested (${actual}% vs ${expected}%)`,
        under: `Less scary than expected (${actual}% vs ${expected}%)`
      },
      bleakness: {
        over: `Story darker/more hopeless than requested (${actual}% vs ${expected}%)`,
        under: `Story more hopeful than expected (${actual}% vs ${expected}%)`
      },
      sexualViolence: {
        over: `Sexual violence content exceeds settings (${actual}% vs ${expected}%) - CRITICAL`,
        under: `Sexual violence content below user expectation (${actual}% vs ${expected}%)`
      }
    };

    return descriptions[dimension]?.[direction] || `${dimension}: ${actual}% vs expected ${expected}%`;
  }

  /**
   * Validate content intensity against slider settings
   *
   * @param {string} content - Generated story content
   * @param {object} sliderSettings - User's slider settings
   * @param {object} options - Validation options
   * @returns {object} Validation result with mismatches and recommendations
   */
  async validateContent(content, sliderSettings, options = {}) {
    const { sessionId = null, sceneIndex = 0, logErrors = true } = options;
    const result = createValidationResult();
    result.expected = { ...sliderSettings };

    logger.info(`[IntensityValidator] Validating content for session ${sessionId}, scene ${sceneIndex}`);

    try {
      // Step 1: Analyze content intensity
      const analyzed = await this.analyzeIntensity(content, { sessionId, sceneIndex });
      result.analyzed = { ...analyzed };
      delete result.analyzed.reasoning; // Don't include reasoning in result

      // Step 2: Find mismatches
      const mismatches = this.findMismatches(analyzed, sliderSettings);
      result.mismatches = mismatches;

      // Step 3: Determine if valid and if regeneration needed
      const highSeverityCount = mismatches.filter(m => m.severity === 'high').length;
      const totalMismatchCount = mismatches.length;

      result.valid = totalMismatchCount === 0;
      result.shouldRegenerate = highSeverityCount >= 2 || totalMismatchCount >= 4;

      // Step 4: Generate summary
      if (result.valid) {
        result.summary = 'Content intensity matches user settings';
      } else if (result.shouldRegenerate) {
        const dims = mismatches.map(m => m.dimension).join(', ');
        result.summary = `Significant intensity mismatch in: ${dims}. Regeneration recommended.`;
      } else {
        const dims = mismatches.map(m => m.dimension).join(', ');
        result.summary = `Minor intensity mismatch in: ${dims}. Within acceptable range.`;
      }

      // Step 5: Log to QA file if errors found and logging enabled
      if (!result.valid && logErrors) {
        await logIntensityMismatch(
          sessionId,
          sliderSettings,
          analyzed,
          mismatches,
          content
        );
      }

      logger.info(`[IntensityValidator] Validation result:`, {
        valid: result.valid,
        mismatchCount: totalMismatchCount,
        highSeverity: highSeverityCount,
        shouldRegenerate: result.shouldRegenerate
      });

      return result;

    } catch (error) {
      logger.error('[IntensityValidator] Validation error:', error);
      result.valid = true; // Don't block on validation errors
      result.summary = `Validation error: ${error.message}`;
      return result;
    }
  }

  /**
   * Generate intensity reinforcement instructions for prompts
   * This ensures the LLM knows exactly what intensity to target
   *
   * @param {object} sliderSettings - User's slider settings
   * @returns {string} Prompt instructions for intensity targeting
   */
  generateIntensityInstructions(sliderSettings) {
    const instructions = [];

    for (const dim of INTENSITY_DIMENSIONS) {
      const level = sliderSettings[dim] ?? 0;
      const tierDescription = this.getTierDescription(dim, level);

      if (tierDescription) {
        instructions.push(`- ${dim.toUpperCase()}: ${level}/100 - ${tierDescription}`);
      }
    }

    if (instructions.length === 0) {
      return '';
    }

    return `
CONTENT INTENSITY REQUIREMENTS (MANDATORY):
${instructions.join('\n')}

CRITICAL: The content MUST match these intensity levels EXACTLY.
A setting of 81% means MORE intense than 80%.
Each percentage point matters. Do NOT under-deliver or over-deliver.
`;
  }

  /**
   * Get tier description for a dimension at a specific level
   */
  getTierDescription(dimension, level) {
    const tiers = {
      violence: [
        { max: 10, desc: 'minimal physical conflict, no harm shown' },
        { max: 30, desc: 'mild action, cartoon-style violence' },
        { max: 50, desc: 'moderate combat, some visible conflict' },
        { max: 70, desc: 'intense action with consequences shown' },
        { max: 90, desc: 'graphic violence with blood and injuries' },
        { max: 100, desc: 'extreme brutality, unflinching depiction' }
      ],
      gore: [
        { max: 10, desc: 'no blood or injury details' },
        { max: 30, desc: 'minor scratches, implied injuries' },
        { max: 50, desc: 'visible blood, non-graphic wounds' },
        { max: 70, desc: 'detailed injuries, significant blood' },
        { max: 90, desc: 'graphic body horror, visceral descriptions' },
        { max: 100, desc: 'extreme gore, surgical detail' }
      ],
      romance: [
        { max: 10, desc: 'friendship only, no romantic elements' },
        { max: 30, desc: 'subtle romance, hand-holding, glances' },
        { max: 50, desc: 'kissing, declarations of love' },
        { max: 70, desc: 'passionate scenes, intimate moments' },
        { max: 90, desc: 'steamy content, fade-to-black' },
        { max: 100, desc: 'explicit romantic content' }
      ],
      adultContent: [
        { max: 10, desc: 'family-friendly, no adult themes' },
        { max: 30, desc: 'mild adult references, innuendo' },
        { max: 50, desc: 'moderate adult content, suggested situations' },
        { max: 70, desc: 'explicit adult content, detailed scenes' },
        { max: 90, desc: 'very explicit, graphic descriptions' },
        { max: 100, desc: 'extremely explicit, no restrictions' }
      ],
      sensuality: [
        { max: 10, desc: 'no sensual content' },
        { max: 30, desc: 'light sensuality, attraction described' },
        { max: 50, desc: 'sensual tension, physical awareness' },
        { max: 70, desc: 'detailed sensual descriptions' },
        { max: 90, desc: 'highly sensual, provocative content' },
        { max: 100, desc: 'maximally sensual throughout' }
      ],
      language: [
        { max: 10, desc: 'clean language, no profanity' },
        { max: 30, desc: 'mild language (damn, hell)' },
        { max: 50, desc: 'moderate profanity, some strong words' },
        { max: 70, desc: 'frequent strong language' },
        { max: 90, desc: 'heavy profanity, crude expressions' },
        { max: 100, desc: 'unrestricted language, maximum profanity' }
      ],
      scary: [
        { max: 10, desc: 'not scary, gentle tension at most' },
        { max: 30, desc: 'mildly spooky, kid-friendly scares' },
        { max: 50, desc: 'genuinely creepy, sustained tension' },
        { max: 70, desc: 'scary horror, disturbing imagery' },
        { max: 90, desc: 'intense horror, nightmare fuel' },
        { max: 100, desc: 'extreme horror, deeply unsettling' }
      ],
      explicitness: [
        { max: 10, desc: 'clean content, no explicit material' },
        { max: 30, desc: 'mild innuendo, implied situations' },
        { max: 50, desc: 'moderate explicit content, fade-to-black' },
        { max: 70, desc: 'detailed explicit scenes' },
        { max: 90, desc: 'very graphic, nothing hidden' },
        { max: 100, desc: 'maximally explicit, erotica focus' }
      ],
      bleakness: [
        { max: 12, desc: 'pure sunshine, guaranteed happy ending' },
        { max: 25, desc: 'hopeful, dark moments but hope wins' },
        { max: 37, desc: 'bittersweet, mixed outcomes with growth' },
        { max: 50, desc: 'realistic, joy and sorrow balanced' },
        { max: 62, desc: 'dark, pyrrhic victories, significant tragedy' },
        { max: 75, desc: 'grimdark lite, hope is rare' },
        { max: 87, desc: 'grimdark, existential despair' },
        { max: 100, desc: 'cosmic nihilism, no hope exists' }
      ],
      sexualViolence: [
        { max: 10, desc: 'topic completely absent from story' },
        { max: 20, desc: 'referenced in backstory only, never depicted' },
        { max: 30, desc: 'non-graphic mentions, implied threat' },
        { max: 40, desc: 'attempted assault, interrupted or prevented' },
        { max: 50, desc: 'assault occurs off-page, aftermath explored' },
        { max: 60, desc: 'on-page assault, not gratuitous' },
        { max: 70, desc: 'detailed assault scenes' },
        { max: 80, desc: 'graphic assault content' },
        { max: 90, desc: 'extreme graphic assault, torture combined' },
        { max: 100, desc: 'maximum graphic assault, no limits' }
      ]
    };

    const dimTiers = tiers[dimension];
    if (!dimTiers) return null;

    const tier = dimTiers.find(t => level <= t.max);
    return tier?.desc || dimTiers[dimTiers.length - 1].desc;
  }
}

export default ContentIntensityValidator;
