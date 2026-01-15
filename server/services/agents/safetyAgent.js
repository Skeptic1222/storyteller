/**
 * Safety Agent
 * Content safety checking and adjustment with detailed reporting
 *
 * Section 5 of Storyteller Gospel:
 * - Output structured intensity reports
 * - Track what changes were made
 * - Surface summary in HUD/UI
 *
 * MODEL: This is a UTILITY agent - uses GPT-4o-mini
 */

import { logger } from '../../utils/logger.js';
import { callAgent, parseJsonResponse } from '../openai.js';
import { getUtilityModel } from '../modelSelection.js';
import { calculateEffectiveLimits, getAudienceContext } from '../../utils/audienceLimits.js';

/**
 * Create empty safety report structure
 */
function createSafetyReport() {
  return {
    timestamp: new Date().toISOString(),
    originalScores: {
      violence: 0,
      gore: 0,
      scary: 0,
      romance: 0,
      language: 0
    },
    targetLevels: {
      violence: 0,
      gore: 0,
      scary: 0,
      romance: 0,
      language: 0
    },
    adjustedScores: {
      violence: 0,
      gore: 0,
      scary: 0,
      romance: 0,
      language: 0
    },
    passCount: 0,
    changesMade: [],
    wasAdjusted: false,
    audience: 'general',
    summary: ''
  };
}

export class SafetyAgent {
  constructor() {
    this.model = getUtilityModel();
  }

  /**
   * Analyze content and generate intensity scores
   * @param {string} text - Content to analyze
   * @param {string} audience - 'children', 'general', or 'mature'
   * @returns {object} Intensity scores (0-100 for each category)
   */
  async analyzeIntensity(text, audience = 'general') {
    const prompt = `Analyze this story content and rate its intensity levels on a 0-100 scale:

CONTENT:
${text}

AUDIENCE CONTEXT: ${getAudienceContext(audience)}

Rate each category from 0 (none) to 100 (extreme):

Return JSON only:
{
  "violence": <0-100, physical conflict, fighting, harm>,
  "gore": <0-100, blood, injury descriptions, body horror>,
  "scary": <0-100, fear, tension, horror elements>,
  "romance": <0-100, romantic content, physical affection>,
  "language": <0-100, profanity, crude language>,
  "reasoning": {
    "violence": "brief explanation",
    "gore": "brief explanation",
    "scary": "brief explanation",
    "romance": "brief explanation",
    "language": "brief explanation"
  }
}`;

    try {
      const result = await callAgent('safety', prompt, { sessionId: null });
      const parsed = parseJsonResponse(result.content);

      return {
        violence: Math.min(100, Math.max(0, parsed.violence || 0)),
        gore: Math.min(100, Math.max(0, parsed.gore || 0)),
        scary: Math.min(100, Math.max(0, parsed.scary || 0)),
        romance: Math.min(100, Math.max(0, parsed.romance || 0)),
        language: Math.min(100, Math.max(0, parsed.language || 0)),
        reasoning: parsed.reasoning || {}
      };
    } catch (error) {
      logger.warn('[SafetyAgent] Intensity analysis failed:', error.message);
      return { violence: 0, gore: 0, scary: 0, romance: 0, language: 0, reasoning: {} };
    }
  }

  /**
   * Check if content exceeds target limits
   * @param {object} scores - Current intensity scores
   * @param {object} limits - Target intensity limits
   * @returns {object} { exceeds: boolean, exceededCategories: [] }
   */
  checkExceedsLimits(scores, limits) {
    const exceededCategories = [];

    for (const category of ['violence', 'gore', 'scary', 'romance', 'language']) {
      const score = scores[category] || 0;
      const limit = limits[category] ?? 50; // Default to 50 if not specified

      if (score > limit) {
        exceededCategories.push({
          category,
          score,
          limit,
          excess: score - limit
        });
      }
    }

    return {
      exceeds: exceededCategories.length > 0,
      exceededCategories
    };
  }

  /**
   * Adjust content to meet intensity limits
   * @param {string} text - Content to adjust
   * @param {object} limits - Target intensity limits
   * @param {object} exceededCategories - Categories that need adjustment
   * @returns {object} { adjustedText, changesMade }
   */
  async adjustContent(text, limits, exceededCategories) {
    const adjustmentInstructions = exceededCategories.map(cat => {
      const action = cat.category === 'violence' ? 'soften physical conflict, reduce harm descriptions'
        : cat.category === 'gore' ? 'remove blood/injury details, use implication instead of description'
        : cat.category === 'scary' ? 'reduce tension, add reassurance, soften scary elements'
        : cat.category === 'romance' ? 'reduce romantic intensity, keep affection age-appropriate'
        : 'remove strong language, use family-friendly alternatives';

      return `- ${cat.category.toUpperCase()}: Currently ${cat.score}/100, target ${cat.limit}/100. Action: ${action}`;
    }).join('\n');

    const prompt = `Rewrite this story content to meet the safety limits while preserving the narrative:

ORIGINAL CONTENT:
${text}

ADJUSTMENTS NEEDED:
${adjustmentInstructions}

RULES:
- Preserve the story's plot, characters, and key events
- Only modify the specific elements that exceed limits
- Use implication and suggestion instead of explicit description
- Maintain the story's tone and pacing where possible
- Keep the same approximate length

Return JSON:
{
  "adjusted_text": "the rewritten content",
  "changes_made": [
    "Description of specific change 1",
    "Description of specific change 2"
  ]
}`;

    try {
      const result = await callAgent('safety', prompt, { sessionId: null });
      const parsed = parseJsonResponse(result.content);

      return {
        adjustedText: parsed.adjusted_text || text,
        changesMade: parsed.changes_made || []
      };
    } catch (error) {
      logger.error('[SafetyAgent] Content adjustment failed:', error.message);
      return { adjustedText: text, changesMade: [] };
    }
  }

  /**
   * Full safety check and adjustment pipeline
   * Returns detailed report for HUD display
   *
   * IMPORTANT: For mature audiences with high intensity settings (adultContent >= 50),
   * skip most safety adjustments. Only check for truly harmful content.
   *
   * @param {string} text - Content to check
   * @param {object} limits - Target intensity limits
   * @param {string} audience - Audience type
   * @param {string} sessionId - For tracking
   * @returns {object} SafetyReport with adjustedText if needed
   */
  async checkAndAdjust(text, limits = {}, audience = 'general', sessionId = null) {
    const report = createSafetyReport();
    report.audience = audience;

    // Check for mature audience with high adult content - skip most safety checks
    const adultContentLevel = limits.adultContent ?? limits.romance ?? 0;
    const isMatureWithExplicit = audience === 'mature' && adultContentLevel >= 50;

    if (isMatureWithExplicit) {
      // For mature audiences with explicit content enabled, don't modify the text
      // Only log for monitoring purposes
      logger.info(`[SafetyAgent] SKIPPING adjustments for mature content (adultContent: ${adultContentLevel}/100)`);

      // Set target levels to maximum (100) since explicit content is allowed
      report.targetLevels = {
        violence: limits.violence ?? 100,
        gore: limits.gore ?? 100,
        scary: limits.scary ?? 100,
        romance: 100, // Maximum allowed
        language: limits.language ?? 100
      };

      report.wasAdjusted = false;
      report.summary = 'Mature content - explicit material permitted per user settings';
      report.originalScores = { violence: 0, gore: 0, scary: 0, romance: 0, language: 0 }; // Skip analysis
      report.adjustedScores = { ...report.originalScores };

      return { report, adjustedText: text };
    }

    // Apply audience-based limit adjustments (uses audienceLimits.js)
    const effectiveLimits = calculateEffectiveLimits(limits, audience);
    report.targetLevels = { ...effectiveLimits };

    logger.info(`[SafetyAgent] Checking content for session ${sessionId}, audience: ${audience}`);

    // Pass 1: Analyze original content
    report.passCount = 1;
    const originalScores = await this.analyzeIntensity(text, audience);
    report.originalScores = {
      violence: originalScores.violence,
      gore: originalScores.gore,
      scary: originalScores.scary,
      romance: originalScores.romance,
      language: originalScores.language
    };

    // Check if adjustments needed
    const limitCheck = this.checkExceedsLimits(originalScores, effectiveLimits);

    if (!limitCheck.exceeds) {
      // Content is within limits
      report.adjustedScores = { ...report.originalScores };
      report.wasAdjusted = false;
      report.summary = 'Content within comfort settings';

      logger.info('[SafetyAgent] Content passed safety check without adjustments');
      return { report, adjustedText: text };
    }

    // Pass 2: Adjust content
    report.passCount = 2;
    logger.info(`[SafetyAgent] Adjusting ${limitCheck.exceededCategories.length} categories`);

    const adjustment = await this.adjustContent(text, effectiveLimits, limitCheck.exceededCategories);
    report.changesMade = adjustment.changesMade;

    // Pass 3: Verify adjusted content (optional, for quality)
    const verifyScores = await this.analyzeIntensity(adjustment.adjustedText, audience);
    report.adjustedScores = {
      violence: verifyScores.violence,
      gore: verifyScores.gore,
      scary: verifyScores.scary,
      romance: verifyScores.romance,
      language: verifyScores.language
    };
    report.passCount = 3;

    report.wasAdjusted = true;

    // Generate summary for HUD
    const adjustedCategories = limitCheck.exceededCategories.map(c => c.category);
    report.summary = `Content adjusted: ${adjustedCategories.join(', ')} reduced to meet comfort settings`;

    logger.info('[SafetyAgent] Content adjusted:', {
      categories: adjustedCategories,
      changes: report.changesMade.length,
      passes: report.passCount
    });

    return { report, adjustedText: adjustment.adjustedText };
  }

  /**
   * Generate display-friendly summary for UI
   * @param {object} report - Safety report
   * @param {string} mode - 'simple' or 'advanced'
   * @returns {object} Display-ready summary
   */
  formatForDisplay(report, mode = 'simple') {
    if (mode === 'simple') {
      return {
        message: report.wasAdjusted
          ? 'Content adjusted to your comfort settings'
          : 'Content matches your comfort settings',
        wasAdjusted: report.wasAdjusted,
        changeCount: report.changesMade.length
      };
    }

    // Advanced mode - detailed breakdown
    const categoryChanges = [];
    for (const cat of ['violence', 'gore', 'scary', 'romance', 'language']) {
      if (report.originalScores[cat] > report.targetLevels[cat]) {
        categoryChanges.push({
          category: cat,
          original: report.originalScores[cat],
          target: report.targetLevels[cat],
          final: report.adjustedScores[cat],
          reduced: report.originalScores[cat] > report.adjustedScores[cat]
        });
      }
    }

    return {
      message: report.wasAdjusted
        ? `Safety: ${categoryChanges.length} adjustment${categoryChanges.length > 1 ? 's' : ''} made`
        : 'Safety: All checks passed',
      wasAdjusted: report.wasAdjusted,
      passCount: report.passCount,
      categoryChanges,
      changesMade: report.changesMade,
      audience: report.audience
    };
  }
  // NOTE: Using shared parseJsonResponse from openai.js instead of internal method
}

export default SafetyAgent;
