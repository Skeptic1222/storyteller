/**
 * Author Style Validator Agent
 * Post-generation LLM agent that scores how well a scene matches the requested
 * author style and optionally rewrites if the score is too low.
 *
 * Called AFTER scene generation, BEFORE TTS.
 * Ensures the prose genuinely reflects the chosen literary voice rather than
 * generic LLM output with a thin stylistic veneer.
 *
 * MODEL SELECTION:
 * - Scoring: UTILITY agent (fast, structured output)
 * - Rewriting: CREATIVE agent (quality prose transformation)
 */

import { logger } from '../../utils/logger.js';
import { callAgent, parseJsonResponse } from '../openai.js';
import { getAuthorStyle } from '../authorStyles.js';
import { getCreativeModel, getUtilityModel } from '../modelSelection.js';
import { pool } from '../../database/pool.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Style dimensions scored by the validator.
 * Each is rated 0-100 for how well the scene matches the target author.
 */
const STYLE_DIMENSIONS = [
  'sentence_structure',
  'vocabulary',
  'pov_consistency',
  'pacing',
  'tone',
  'thematic_elements'
];

/**
 * Minimum composite score before a rewrite is triggered.
 * Below this threshold the prose deviates too far from the requested style.
 */
const REWRITE_THRESHOLD = 55;

/**
 * Maximum rewrite attempts per scene to prevent runaway LLM loops.
 */
const MAX_REWRITE_ATTEMPTS = 1;

// ============================================================================
// SCORING
// ============================================================================

/**
 * Validate how well a scene's prose matches the requested author style.
 *
 * @param {string} sceneText - The generated scene prose
 * @param {string} authorStyleKey - Key into AUTHOR_STYLES (e.g. 'hemingway', 'austen')
 * @param {string} sessionId - Story session ID for logging/tracking
 * @returns {object} { score, breakdown, needsRewrite, reasoning, skipped }
 */
export async function validateAuthorStyle(sceneText, authorStyleKey, sessionId) {
  // If no author style requested, skip validation entirely
  if (!authorStyleKey) {
    logger.debug('[AuthorStyleValidator] No author style key provided, skipping validation');
    return {
      score: 100,
      breakdown: {},
      needsRewrite: false,
      reasoning: 'No author style requested; validation skipped.',
      skipped: true
    };
  }

  const authorStyle = getAuthorStyle(authorStyleKey);
  if (!authorStyle) {
    logger.warn(`[AuthorStyleValidator] Unknown author style key: "${authorStyleKey}", skipping`);
    return {
      score: 100,
      breakdown: {},
      needsRewrite: false,
      reasoning: `Unknown author style "${authorStyleKey}"; validation skipped.`,
      skipped: true
    };
  }

  // Truncate to avoid token limits while keeping enough for meaningful analysis
  const truncatedText = sceneText.length > 4000
    ? sceneText.substring(0, 4000) + '\n...[truncated for analysis]'
    : sceneText;

  const prompt = buildScoringPrompt(truncatedText, authorStyle);

  try {
    const result = await callAgent('style_validator', prompt, {
      sessionId,
      response_format: { type: 'json_object' }
    });

    const parsed = parseJsonResponse(result.content);

    // Extract and clamp individual dimension scores
    const breakdown = {};
    let totalScore = 0;
    let validDimensions = 0;

    for (const dim of STYLE_DIMENSIONS) {
      const raw = parsed[dim];
      const score = Math.min(100, Math.max(0, parseInt(raw, 10) || 0));
      breakdown[dim] = score;
      totalScore += score;
      validDimensions++;
    }

    const composite = validDimensions > 0
      ? Math.round(totalScore / validDimensions)
      : 0;

    const reasoning = parsed.reasoning || parsed.overall_reasoning || '';

    logger.info(`[AuthorStyleValidator] Style score for "${authorStyle.name}": ${composite}/100`, {
      sessionId,
      breakdown,
      needsRewrite: composite < REWRITE_THRESHOLD
    });

    return {
      score: composite,
      breakdown,
      needsRewrite: composite < REWRITE_THRESHOLD,
      reasoning,
      skipped: false
    };

  } catch (error) {
    logger.error('[AuthorStyleValidator] Scoring failed:', error.message);
    // Fail open -- do not block generation on validator errors
    return {
      score: 75,
      breakdown: {},
      needsRewrite: false,
      reasoning: `Scoring error: ${error.message}. Defaulting to passing score.`,
      skipped: false,
      error: true
    };
  }
}

// ============================================================================
// REWRITING
// ============================================================================

/**
 * Rewrite a scene to better match the requested author style.
 * Preserves all plot events, character actions, and dialogue --
 * only changes HOW things are expressed (vocabulary, sentence structure,
 * pacing, narrative voice).
 *
 * @param {string} sceneText - Original scene prose
 * @param {string} authorStyleKey - Key into AUTHOR_STYLES
 * @param {object} validationResult - Output from validateAuthorStyle()
 * @param {string} sessionId - Story session ID
 * @returns {object} { rewrittenText, originalScore, newScore }
 */
export async function rewriteForStyle(sceneText, authorStyleKey, validationResult, sessionId) {
  const authorStyle = getAuthorStyle(authorStyleKey);
  if (!authorStyle) {
    logger.warn(`[AuthorStyleValidator] Cannot rewrite: unknown style "${authorStyleKey}"`);
    return {
      rewrittenText: sceneText,
      originalScore: validationResult?.score ?? 0,
      newScore: validationResult?.score ?? 0,
      rewritten: false
    };
  }

  const prompt = buildRewritePrompt(sceneText, authorStyle, validationResult);

  try {
    const result = await callAgent('author_style', prompt, {
      sessionId,
      maxTokens: 4000
    });

    const rewrittenText = extractProseFromResponse(result.content);

    if (!rewrittenText || rewrittenText.length < 50) {
      logger.warn('[AuthorStyleValidator] Rewrite produced empty or too-short output, keeping original');
      return {
        rewrittenText: sceneText,
        originalScore: validationResult.score,
        newScore: validationResult.score,
        rewritten: false
      };
    }

    // Re-score the rewritten text (single attempt, no recursive rewrites)
    const revalidation = await validateAuthorStyle(rewrittenText, authorStyleKey, sessionId);

    logger.info(`[AuthorStyleValidator] Rewrite complete for "${authorStyle.name}":`, {
      sessionId,
      originalScore: validationResult.score,
      newScore: revalidation.score,
      improved: revalidation.score > validationResult.score
    });

    return {
      rewrittenText,
      originalScore: validationResult.score,
      newScore: revalidation.score,
      rewritten: true
    };

  } catch (error) {
    logger.error('[AuthorStyleValidator] Rewrite failed:', error.message);
    // Return original text on failure -- never lose content
    return {
      rewrittenText: sceneText,
      originalScore: validationResult.score,
      newScore: validationResult.score,
      rewritten: false,
      error: error.message
    };
  }
}

// ============================================================================
// DATABASE PERSISTENCE
// ============================================================================

/**
 * Save the style adherence score to the database for analytics/display.
 *
 * @param {string} sceneId - UUID of the story_scenes row
 * @param {number} score - Composite style score (0-100)
 * @param {string} sessionId - Story session ID (for logging only)
 */
export async function saveStyleScore(sceneId, score, sessionId) {
  if (!sceneId) {
    logger.warn('[AuthorStyleValidator] Cannot save style score: no sceneId provided');
    return;
  }

  try {
    const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
    await pool.query(
      'UPDATE story_scenes SET style_score = $1 WHERE id = $2',
      [clampedScore, sceneId]
    );
    logger.debug(`[AuthorStyleValidator] Saved style_score=${clampedScore} for scene ${sceneId}`, { sessionId });
  } catch (error) {
    logger.error(`[AuthorStyleValidator] Failed to save style score for scene ${sceneId}:`, error.message);
    // Non-fatal -- do not throw
  }
}

// ============================================================================
// PROMPT BUILDERS (private)
// ============================================================================

/**
 * Build the scoring prompt that asks the LLM to rate style adherence.
 * The prompt is specific about what each dimension means for the given author.
 */
function buildScoringPrompt(sceneText, authorStyle) {
  const { name, style, promptTemplate } = authorStyle;

  return `You are a literary critic specializing in author voice analysis. Score how well the following scene matches the writing style of ${name}.

TARGET AUTHOR: ${name}

TARGET STYLE CHARACTERISTICS:
- Point of View: ${style.pov}
- Pacing: ${style.pacing}
- Language: ${style.language}
- Tone: ${style.tone}
- Themes: ${style.themes.join(', ')}

STYLE REFERENCE:
${promptTemplate}

SCENE TO ANALYZE:
---
${sceneText}
---

Score each dimension from 0-100 where:
- 0-20: No resemblance to ${name}'s style
- 21-40: Faint echoes but fundamentally different voice
- 41-60: Some stylistic elements present but inconsistent
- 61-80: Clearly influenced by ${name}, recognizable style
- 81-100: Could pass as authentic ${name} prose

DIMENSION DEFINITIONS FOR ${name.toUpperCase()}:

1. sentence_structure: Does the sentence length, complexity, and rhythm match ${name}? ${getSentenceStructureGuidance(style)}
2. vocabulary: Does the word choice reflect ${name}'s lexicon? ${getVocabularyGuidance(style)}
3. pov_consistency: Is the point of view handled as ${name} would? Expected: ${style.pov}
4. pacing: Does the narrative rhythm match? Expected: ${style.pacing}
5. tone: Does the emotional register match? Expected: ${style.tone}
6. thematic_elements: Are ${name}'s characteristic themes present or at least compatible? Expected themes: ${style.themes.join(', ')}

Return ONLY valid JSON:
{
  "sentence_structure": <0-100>,
  "vocabulary": <0-100>,
  "pov_consistency": <0-100>,
  "pacing": <0-100>,
  "tone": <0-100>,
  "thematic_elements": <0-100>,
  "reasoning": "2-3 sentence overall assessment of style adherence"
}`;
}

/**
 * Build the rewrite prompt that transforms prose to better match the author's style.
 * Critical constraint: preserve ALL plot content, only change expression.
 */
function buildRewritePrompt(sceneText, authorStyle, validationResult) {
  const { name, style, promptTemplate } = authorStyle;
  const { breakdown, reasoning } = validationResult;

  // Identify weakest dimensions to focus the rewrite
  const weakDimensions = Object.entries(breakdown || {})
    .filter(([_, score]) => score < 60)
    .sort((a, b) => a[1] - b[1])
    .map(([dim, score]) => `${dim}: ${score}/100`);

  const weaknessSection = weakDimensions.length > 0
    ? `\nWEAKEST AREAS (focus your rewrite here):\n${weakDimensions.map(w => `- ${w}`).join('\n')}`
    : '';

  return `You are a master literary stylist who can rewrite prose to match any author's voice.

TASK: Rewrite the following scene in the authentic style of ${name}.

CRITICAL CONSTRAINTS:
- Preserve ALL plot events, character actions, and dialogue content
- Keep the same characters, settings, and story progression
- Do NOT add new plot points or remove existing ones
- Only change HOW things are expressed -- vocabulary, sentence structure, pacing, narrative voice
- Maintain the same approximate length (within 20%)
- If the scene contains [CHAR:Name] tags, preserve them exactly as they appear

TARGET STYLE: ${name}
- POV: ${style.pov}
- Pacing: ${style.pacing}
- Language: ${style.language}
- Tone: ${style.tone}

STYLE GUIDE:
${promptTemplate}
${weaknessSection}

${reasoning ? `\nVALIDATOR FEEDBACK: ${reasoning}\n` : ''}

ORIGINAL SCENE:
---
${sceneText}
---

Write the rewritten scene below. Output ONLY the rewritten prose, no commentary or explanations.`;
}

// ============================================================================
// HELPER FUNCTIONS (private)
// ============================================================================

/**
 * Extract guidance text for sentence structure scoring based on author style.
 */
function getSentenceStructureGuidance(style) {
  const lang = (style.language || '').toLowerCase();
  if (lang.includes('short') || lang.includes('minimal') || lang.includes('simple')) {
    return '(Expect short, declarative sentences with minimal subordination)';
  }
  if (lang.includes('elaborate') || lang.includes('long') || lang.includes('complex')) {
    return '(Expect long, complex sentences with multiple clauses)';
  }
  if (lang.includes('poetic') || lang.includes('lyrical')) {
    return '(Expect rhythmic, musical sentence construction)';
  }
  if (lang.includes('clear') || lang.includes('direct') || lang.includes('precise')) {
    return '(Expect clear, direct construction without ornamentation)';
  }
  return '(Match the characteristic sentence patterns of this author)';
}

/**
 * Extract guidance text for vocabulary scoring based on author style.
 */
function getVocabularyGuidance(style) {
  const lang = (style.language || '').toLowerCase();
  if (lang.includes('colloquial') || lang.includes('dialect') || lang.includes('slang')) {
    return '(Expect informal, regional, or dialectal word choices)';
  }
  if (lang.includes('elevated') || lang.includes('formal') || lang.includes('archaic')) {
    return '(Expect formal, elevated, possibly archaic diction)';
  }
  if (lang.includes('common') || lang.includes('simple') || lang.includes('plain')) {
    return '(Expect plain, everyday vocabulary -- no showing off)';
  }
  if (lang.includes('rich') || lang.includes('descriptive') || lang.includes('ornate')) {
    return '(Expect rich, varied, descriptive vocabulary)';
  }
  return '(Match the characteristic word choices of this author)';
}

/**
 * Extract prose from an LLM response, stripping any wrapping markdown or commentary.
 * The rewrite agent is instructed to output only prose, but LLMs sometimes add fences.
 */
function extractProseFromResponse(content) {
  if (!content) return '';

  let text = content.trim();

  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    const lines = text.split('\n');
    // Remove first line (```language) and last line (```)
    const startIdx = 1;
    let endIdx = lines.length - 1;
    if (lines[endIdx].trim() === '```') {
      endIdx--;
    }
    text = lines.slice(startIdx, endIdx + 1).join('\n').trim();
  }

  // Strip common LLM preamble patterns
  const preamblePatterns = [
    /^Here(?:'s| is) the rewritten (?:scene|text|prose)[:\s]*/i,
    /^Rewritten (?:scene|version)[:\s]*/i,
    /^---\s*/
  ];

  for (const pattern of preamblePatterns) {
    text = text.replace(pattern, '');
  }

  // Strip trailing separators
  text = text.replace(/\n---\s*$/, '').trim();

  return text;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  validateAuthorStyle,
  rewriteForStyle,
  saveStyleScore,
  STYLE_DIMENSIONS,
  REWRITE_THRESHOLD
};
