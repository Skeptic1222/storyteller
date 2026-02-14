/**
 * Hybrid Content Pipeline
 *
 * Combines Venice.ai (explicit content) with OpenAI (narrative polish)
 * to leverage the strengths of both models.
 *
 * ARCHITECTURE:
 * 1. Venice.ai generates content with <explicit>...</explicit> tags
 * 2. Extract explicit sections, replace with [EXPLICIT_MARKER_N] placeholders
 * 3. Send PG version to OpenAI for narrative polish/enhancement
 * 4. Restore explicit sections at markers
 * 5. Venice.ai final coherence check (optional)
 *
 * This allows OpenAI to improve story structure, pacing, dialogue
 * while preserving Venice's uncensored explicit content.
 */

import { logger } from '../utils/logger.js';
import { callAgent, parseJsonResponse } from './openai.js';
import llmProviders from './llmProviders.js';
const { callVenice, callOpenRouter, PROVIDERS, isProviderAvailable, detectRepetition } = llmProviders;
import { getCreativeModel, getUtilityModel } from './modelSelection.js';
// Phase 3.4: Import Venice prompt templates for quality improvements
import {
  veniceSceneGenerationPrompt,
  detectRepetition as veniceDetectRepetition,
  buildVeniceContext
} from './prompts/venicePromptTemplates.js';

/**
 * Call Venice (fail-loud)
 * Premium policy: no provider fallback except OpenAI->Venice (not vice-versa).
 */
async function callVeniceWithFallback(options) {
  const startTime = Date.now();
  logger.info('[Venice] CALLING Venice.ai', {
    model: options.model || 'default',
    maxTokens: options.max_tokens,
    promptLength: options.messages?.[0]?.content?.length || 0
  });

  try {
    const result = await callVenice(options);
    logger.info('[Venice] SUCCESS - Venice.ai responded', {
      responseLength: result.content?.length || 0,
      durationMs: Date.now() - startTime,
      provider: 'venice'
    });
    result.provider = 'venice';
    return result;
  } catch (veniceError) {
    logger.error(`[HybridPipeline] Venice failed (fail-loud policy): ${veniceError.message}`);
    throw veniceError;
  }
}

// Tag types for different explicit content
const EXPLICIT_TAGS = {
  SEX: { open: '<explicit-sex>', close: '</explicit-sex>' },
  GORE: { open: '<explicit-gore>', close: '</explicit-gore>' },
  VIOLENCE: { open: '<explicit-violence>', close: '</explicit-violence>' },
  // Generic explicit tag for any mature content
  GENERIC: { open: '<explicit>', close: '</explicit>' }
};

// ============================================================================
// PHASE 5.3: Semantic Placeholders (cryptic + context-aware)
// ============================================================================
// Instead of obvious [MATURE_SCENE_0], use semantic placeholders that:
// 1. Don't trigger OpenAI's content filters
// 2. Provide context for narrative flow
// 3. Include approximate word count for pacing
const PLACEHOLDER_FORMATS = {
  sex: (idx, wordCount, context) =>
    `[SCENE_TRANSITION_${idx}: emotional_intimate_moment ~${wordCount}w ${context || 'romantic_development'}]`,
  gore: (idx, wordCount, context) =>
    `[SCENE_TRANSITION_${idx}: intense_physical_consequence ~${wordCount}w ${context || 'visceral_impact'}]`,
  violence: (idx, wordCount, context) =>
    `[SCENE_TRANSITION_${idx}: dynamic_action_sequence ~${wordCount}w ${context || 'conflict_resolution'}]`,
  generic: (idx, wordCount, context) =>
    `[SCENE_TRANSITION_${idx}: dramatic_moment ~${wordCount}w ${context || 'narrative_climax'}]`
};

// Legacy format for backwards compatibility
const PLACEHOLDER_PREFIX = '[MATURE_SCENE_';
const PLACEHOLDER_SUFFIX = ']';

// Semantic placeholder pattern for extraction
const SEMANTIC_PLACEHOLDER_PATTERN = /\[SCENE_TRANSITION_(\d+):[^\]]+\]/g;

/**
 * Intent Validation - Analyze user's prompt to understand explicit content requirements
 * This helps ensure Venice.ai generates content matching user expectations
 */
export async function validateUserIntent(userPrompt, config) {
  const adultContent = config?.intensity?.adultContent || 0;
  const romance = config?.intensity?.romance || 0;
  const violence = config?.intensity?.violence || 0;
  const gore = config?.intensity?.gore || 0;
  const audience = config?.audience || 'general';

  // Only validate for mature content
  // P1 FIX: Include violence and gore in the check - these also need Venice.ai
  // Previously only checked adultContent and romance, ignoring violent/gory content requests
  if (audience !== 'mature' || (adultContent < 50 && romance < 50 && violence < 60 && gore < 60)) {
    return {
      requiresExplicit: false,
      explicitTypes: [],
      intensity: 'none',
      userExpectations: null
    };
  }

  logger.info('[IntentValidation] Explicit content check triggered', {
    audience, adultContent, romance, violence, gore,
    reason: adultContent >= 50 ? 'adultContent' : romance >= 50 ? 'romance' : violence >= 60 ? 'violence' : 'gore'
  });

  // Analyze the user's prompt for intent
  const intentPrompt = `Analyze this story request and determine what explicit content the user expects:

USER'S STORY REQUEST:
"${userPrompt}"

USER'S INTENSITY SETTINGS:
- Adult Content: ${adultContent}/100
- Romance: ${romance}/100
- Violence: ${violence}/100
- Gore: ${gore}/100
- Audience: ${audience}

Analyze what the user ACTUALLY wants. Be specific about:
1. What type of explicit content they expect (sexual, violent, etc.)
2. How explicit they want it (mild, moderate, hardcore)
3. Key elements they mentioned that MUST be included
4. Pacing expectations (immediate action vs buildup)

Return JSON:
{
  "explicit_types": ["sex", "violence", "gore"], // which types apply
  "intensity_level": "hardcore|explicit|moderate|mild",
  "must_include": ["specific elements user mentioned"],
  "pacing": "immediate|gradual|buildup",
  "user_intent_summary": "One sentence summary of what user wants",
  "generation_guidance": "Specific instructions for the content generator"
}`;

  try {
    // Use Venice for intent analysis since it understands explicit content
    // Falls back to OpenRouter (Claude) if Venice fails
    const result = await callVeniceWithFallback({
      messages: [{ role: 'user', content: intentPrompt }],
      model: 'llama-3.3-70b',
      temperature: 0.3,
      max_tokens: 1000
    });

    const parsed = parseJsonResponse(result.content);

    logger.info('[IntentValidation] User intent analyzed:', {
      types: parsed.explicit_types,
      intensity: parsed.intensity_level,
      pacing: parsed.pacing
    });

    return {
      requiresExplicit: true,
      explicitTypes: parsed.explicit_types || [],
      intensity: parsed.intensity_level || 'explicit',
      mustInclude: parsed.must_include || [],
      pacing: parsed.pacing || 'gradual',
      summary: parsed.user_intent_summary,
      guidance: parsed.generation_guidance,
      raw: parsed
    };
  } catch (error) {
    logger.error('[IntentValidation] Failed to analyze intent:', error.message);

    // P1 FIX: Default to explicit based on ALL intensity settings, not just adultContent
    // Calculate intensity based on the highest setting
    const maxSexual = Math.max(adultContent, romance);
    const maxViolent = Math.max(violence, gore);
    const maxIntensity = Math.max(maxSexual, maxViolent);

    let intensity = 'none';
    if (maxIntensity >= 80) {
      intensity = 'hardcore';
    } else if (maxIntensity >= 70) {
      intensity = 'explicit';
    } else if (maxIntensity >= 60) {
      intensity = 'moderate';
    } else if (maxIntensity >= 50 || violence >= 60 || gore >= 60) {
      intensity = 'mild';
    }

    // Determine which explicit types based on settings
    const explicitTypes = [];
    if (adultContent >= 50 || romance >= 50) explicitTypes.push('sex');
    if (violence >= 60) explicitTypes.push('violence');
    if (gore >= 60) explicitTypes.push('gore');

    // Determine if any setting requires explicit handling
    const requiresExplicit = adultContent >= 50 || romance >= 50 || violence >= 60 || gore >= 60;

    return {
      requiresExplicit,
      explicitTypes,
      intensity,
      mustInclude: [],
      pacing: 'gradual',
      summary: `Mature content requested (intensity: ${intensity}) | adult:${adultContent} romance:${romance} violence:${violence} gore:${gore}`,
      guidance: null
    };
  }
}

/**
 * Generate content with explicit tags using Venice.ai
 * Venice wraps explicit sections in tags for later extraction
 */
export async function generateWithExplicitTags(prompt, config, intentAnalysis) {
  const adultContent = config?.intensity?.adultContent || 0;
  const romance = config?.intensity?.romance || 0;
  const violence = config?.intensity?.violence || 0;
  const gore = config?.intensity?.gore || 0;

  // Build explicit content instructions based on intent analysis
  let explicitInstructions = '';

  if (intentAnalysis?.requiresExplicit) {
    // P1 FIX: Separate guides for sexual vs violent content
    const sexualIntensityGuide = {
      'hardcore': 'Write PORNOGRAPHIC, extremely graphic content with explicit anatomical detail. No limits.',
      'explicit': 'Write graphic, detailed explicit content without holding back.',
      'moderate': 'Write sensual, erotic content with clear physical descriptions.',
      'mild': 'Write suggestive content with some intimate detail.'
    };

    const violenceIntensityGuide = {
      'hardcore': 'Write EXTREMELY GRAPHIC violence - dismemberment, torture, visceral detail of wounds and death. No limits.',
      'explicit': 'Write graphic, detailed violence - blood, bone, screams of agony, brutal combat with consequences.',
      'moderate': 'Write intense violence with visible injuries and emotional impact.',
      'mild': 'Write action violence with some blood and injury detail.'
    };

    // Select appropriate guide based on which explicit types are requested
    const hasViolentContent = intentAnalysis.explicitTypes?.includes('violence') || intentAnalysis.explicitTypes?.includes('gore');
    const hasSexualContent = intentAnalysis.explicitTypes?.includes('sex');
    const intensityGuide = hasViolentContent && !hasSexualContent ? violenceIntensityGuide : sexualIntensityGuide;

    explicitInstructions = `
★★★ EXPLICIT CONTENT REQUIREMENTS ★★★

USER INTENT: ${intentAnalysis.summary || 'Explicit mature content requested'}
INTENSITY: ${intentAnalysis.intensity?.toUpperCase() || 'EXPLICIT'}
${intentAnalysis.guidance ? `SPECIFIC GUIDANCE: ${intentAnalysis.guidance}` : ''}
${intentAnalysis.mustInclude?.length > 0 ? `MUST INCLUDE: ${intentAnalysis.mustInclude.join(', ')}` : ''}
${intentAnalysis.pacing === 'immediate' ? 'PACING: Jump directly into the action - NO buildup or setup needed.' : ''}

${intensityGuide[intentAnalysis.intensity] || intensityGuide.explicit}

CRITICAL TAGGING REQUIREMENT:
You MUST wrap ALL explicit content in tags:
- Sexual content: <explicit-sex>content here</explicit-sex>
- Gore/body horror: <explicit-gore>content here</explicit-gore>
- Graphic violence: <explicit-violence>content here</explicit-violence>

Example of proper tagging:
"She walked into the bedroom and found him waiting. <explicit-sex>He pulled her close, his hands sliding under her dress as she gasped. Their bodies pressed together as he pushed her onto the bed, his cock already hard against her thigh...</explicit-sex> Afterwards, they lay together in the moonlight."

The tags allow our system to process the content correctly. You MUST use them for any explicit material.
DO NOT hold back within the tags - write the most graphic version the user requested.`;
  }

  const taggedPrompt = `${prompt}

${explicitInstructions}

Remember: Wrap explicit content in the appropriate tags (<explicit-sex>, <explicit-gore>, <explicit-violence>).
The content INSIDE the tags should be maximally explicit per the user's settings:
- Adult/Sexual: ${adultContent}/100
- Romance: ${romance}/100
- Violence: ${violence}/100
- Gore: ${gore}/100`;

  try {
    const result = await callVeniceWithFallback({
      messages: [{ role: 'user', content: taggedPrompt }],
      model: 'llama-3.3-70b',
      temperature: 0.75,
      frequency_penalty: 0.6,
      max_tokens: 8000
    });

    logger.info('[HybridPipeline] Generated tagged content:', {
      length: result.content?.length,
      hasSexTags: result.content?.includes('<explicit-sex>'),
      hasGoreTags: result.content?.includes('<explicit-gore>'),
      hasViolenceTags: result.content?.includes('<explicit-violence>')
    });

    // Phase 3.4: Quality check for repetition issues
    if (result.content) {
      const repetitionCheck = detectRepetition(result.content);
      if (repetitionCheck.count > 3) {
        logger.warn('[HybridPipeline] High repetition detected in Venice output:', {
          count: repetitionCheck.count,
          severity: repetitionCheck.severity,
          warnings: repetitionCheck.warnings.slice(0, 3)
        });
      }
    }

    return result.content;
  } catch (error) {
    logger.error('[HybridPipeline] Venice generation failed:', error.message);
    throw error;
  }
}

/**
 * Extract explicit sections and replace with semantic placeholders
 * Returns the PG content and a map of extracted sections
 * PHASE 5.3: Uses semantic placeholders that don't trigger content filters
 */
export function extractExplicitSections(content, options = {}) {
  const { useSemanticPlaceholders = true } = options;
  const extractedSections = [];
  let pgContent = content;
  let markerIndex = 0;

  // Process each tag type
  for (const [type, tags] of Object.entries(EXPLICIT_TAGS)) {
    const regex = new RegExp(
      `${escapeRegex(tags.open)}([\\s\\S]*?)${escapeRegex(tags.close)}`,
      'gi'
    );

    pgContent = pgContent.replace(regex, (match, explicitContent) => {
      const wordCount = explicitContent.trim().split(/\s+/).length;
      const typeKey = type.toLowerCase();

      // Generate context hint from content (first few words, sanitized)
      const contextHint = generateContextHint(explicitContent, typeKey);

      // Create semantic or legacy placeholder
      let marker;
      if (useSemanticPlaceholders && PLACEHOLDER_FORMATS[typeKey]) {
        marker = PLACEHOLDER_FORMATS[typeKey](markerIndex, wordCount, contextHint);
      } else {
        marker = `${PLACEHOLDER_PREFIX}${markerIndex}${PLACEHOLDER_SUFFIX}`;
      }

      extractedSections.push({
        marker,
        index: markerIndex,
        type: typeKey,
        content: explicitContent.trim(),
        wordCount,
        contextHint,
        originalMatch: match,
        provider: 'venice' // Track provider attribution
      });
      markerIndex++;

      return marker;
    });
  }

  logger.info('[HybridPipeline] Extracted explicit sections:', {
    count: extractedSections.length,
    types: extractedSections.map(s => s.type),
    useSemanticPlaceholders
  });

  return {
    pgContent,
    extractedSections,
    hasExplicitContent: extractedSections.length > 0
  };
}

/**
 * Generate a context hint from explicit content for semantic placeholders
 * Extracts narrative context without revealing explicit details
 */
function generateContextHint(content, type) {
  // Look for narrative context clues
  const contextPatterns = {
    sex: [
      { pattern: /kiss|embrace|touch/i, hint: 'romantic_buildup' },
      { pattern: /bed|bedroom|night/i, hint: 'intimate_setting' },
      { pattern: /passion|desire|want/i, hint: 'emotional_intensity' },
      { pattern: /climax|finish|end/i, hint: 'resolution_moment' }
    ],
    gore: [
      { pattern: /blood|wound|injury/i, hint: 'physical_trauma' },
      { pattern: /death|die|kill/i, hint: 'fatal_consequence' },
      { pattern: /transform|change|mutate/i, hint: 'body_horror' }
    ],
    violence: [
      { pattern: /fight|battle|combat/i, hint: 'combat_sequence' },
      { pattern: /escape|flee|run/i, hint: 'chase_scene' },
      { pattern: /defend|protect|save/i, hint: 'defensive_action' }
    ]
  };

  const patterns = contextPatterns[type] || [];
  for (const { pattern, hint } of patterns) {
    if (pattern.test(content)) {
      return hint;
    }
  }

  // Default hints by type
  const defaults = {
    sex: 'intimate_development',
    gore: 'visceral_moment',
    violence: 'action_beat',
    generic: 'dramatic_beat'
  };

  return defaults[type] || 'narrative_moment';
}

/**
 * Generate a PG replacement description for explicit content
 * This gives OpenAI context about what happens without explicit details
 */
function getPGReplacement(type, content) {
  // Analyze the content to generate appropriate PG description
  const wordCount = content.split(/\s+/).length;

  switch (type.toUpperCase()) {
    case 'SEX':
      return `[An intimate scene unfolds between the characters - approximately ${wordCount} words of romantic content]`;
    case 'GORE':
      return `[A visceral scene of physical trauma occurs - approximately ${wordCount} words of intense imagery]`;
    case 'VIOLENCE':
      return `[An intense action sequence takes place - approximately ${wordCount} words of combat]`;
    default:
      return `[A mature scene continues - approximately ${wordCount} words]`;
  }
}

/**
 * Polish the PG content with OpenAI
 * OpenAI improves narrative structure, pacing, dialogue without seeing explicit content
 * PHASE 5.3: Enhanced with marker repair functionality
 */
export async function polishWithOpenAI(pgContent, config, sessionId, extractedSections = []) {
  const narratorStyle = config?.narrator_style || 'engaging';

  // Use semantic marker pattern for new format
  const polishPrompt = `You are enhancing a story's narrative quality. The story contains scene transition markers that should NOT be modified.

STORY TO ENHANCE:
${pgContent}

ENHANCEMENT GOALS:
1. Improve prose quality and flow
2. Enhance descriptive language
3. Smooth transitions between scenes
4. Strengthen character voice in dialogue
5. Maintain consistent tone and pacing

CRITICAL RULES:
- DO NOT modify any [SCENE_TRANSITION_X: ...] markers - copy them EXACTLY
- DO NOT add content inside the brackets
- Focus on the non-marked sections only
- Keep the same overall length
- Preserve the story's structure and all markers

Narrator style: ${narratorStyle}

Return the enhanced story with all markers intact exactly as they appear.`;

  try {
    const result = await callAgent('narrator', polishPrompt, { sessionId });

    // Extract markers from both versions
    const originalMarkers = extractAllMarkers(pgContent);
    const polishedMarkers = extractAllMarkers(result.content);

    // Check if markers are preserved
    if (originalMarkers.length !== polishedMarkers.length) {
      logger.warn(`[HybridPipeline] Marker count mismatch: ${originalMarkers.length} -> ${polishedMarkers.length}`);

      // PHASE 5.3: Attempt marker repair instead of falling back
      const repairedContent = attemptMarkerRepair(result.content, extractedSections, pgContent);

      if (repairedContent) {
        logger.info('[HybridPipeline] Successfully repaired markers');
        return {
          content: repairedContent,
          provider: 'openai',
          wasRepaired: true
        };
      }

      logger.warn('[HybridPipeline] Marker repair failed, using original content');
      return {
        content: pgContent,
        provider: 'openai',
        wasRepaired: false,
        markerLoss: true
      };
    }

    logger.info('[HybridPipeline] OpenAI polish complete, markers preserved');
    return {
      content: result.content,
      provider: 'openai',
      wasRepaired: false
    };
  } catch (error) {
    logger.warn('[HybridPipeline] OpenAI polish failed, using original:', error.message);
    return {
      content: pgContent,
      provider: 'openai',
      error: error.message
    };
  }
}

/**
 * Extract all markers (both semantic and legacy) from content
 */
function extractAllMarkers(content) {
  const markers = [];

  // Semantic format: [SCENE_TRANSITION_X: ...]
  const semanticMatches = content.match(/\[SCENE_TRANSITION_\d+:[^\]]+\]/g) || [];
  markers.push(...semanticMatches);

  // Legacy format: [MATURE_SCENE_X]
  const legacyMatches = content.match(/\[MATURE_SCENE_\d+\]/g) || [];
  markers.push(...legacyMatches);

  return markers;
}

/**
 * PHASE 5.3: Attempt to repair damaged markers in polished content
 * Uses the extracted sections to intelligently restore markers
 */
function attemptMarkerRepair(polishedContent, extractedSections, originalPgContent) {
  if (!extractedSections || extractedSections.length === 0) {
    return null;
  }

  let repairedContent = polishedContent;
  let repairsAttempted = 0;
  let repairsSucceeded = 0;

  for (const section of extractedSections) {
    // Check if this section's marker exists in polished content
    const markerExists =
      repairedContent.includes(section.marker) ||
      repairedContent.includes(`[MATURE_SCENE_${section.index}]`) ||
      repairedContent.includes(`[SCENE_TRANSITION_${section.index}:`);

    if (!markerExists) {
      repairsAttempted++;

      // Try to find where the marker SHOULD be based on surrounding context
      // Look for text that appeared before/after the marker in original
      const markerPosition = originalPgContent.indexOf(section.marker);
      if (markerPosition === -1) continue;

      // Get context around the marker (50 chars before/after)
      const contextBefore = originalPgContent.substring(
        Math.max(0, markerPosition - 100),
        markerPosition
      ).trim().slice(-50);

      const contextAfter = originalPgContent.substring(
        markerPosition + section.marker.length,
        markerPosition + section.marker.length + 100
      ).trim().substring(0, 50);

      // Find similar context in polished content
      if (contextBefore.length > 20) {
        const beforeIndex = repairedContent.indexOf(contextBefore);
        if (beforeIndex !== -1) {
          // Insert marker after the context
          const insertPosition = beforeIndex + contextBefore.length;
          repairedContent =
            repairedContent.substring(0, insertPosition) +
            ' ' + section.marker + ' ' +
            repairedContent.substring(insertPosition);
          repairsSucceeded++;
          logger.debug(`[MarkerRepair] Restored marker ${section.index} using before-context`);
          continue;
        }
      }

      if (contextAfter.length > 20) {
        const afterIndex = repairedContent.indexOf(contextAfter);
        if (afterIndex !== -1) {
          // Insert marker before the context
          repairedContent =
            repairedContent.substring(0, afterIndex) +
            ' ' + section.marker + ' ' +
            repairedContent.substring(afterIndex);
          repairsSucceeded++;
          logger.debug(`[MarkerRepair] Restored marker ${section.index} using after-context`);
          continue;
        }
      }

      logger.warn(`[MarkerRepair] Could not restore marker ${section.index}`);
    }
  }

  if (repairsAttempted > 0) {
    logger.info(`[MarkerRepair] Attempted ${repairsAttempted} repairs, succeeded: ${repairsSucceeded}`);
  }

  // Verify repair was successful
  const repairedMarkers = extractAllMarkers(repairedContent);
  if (repairedMarkers.length >= extractedSections.length) {
    return repairedContent;
  }

  return null;
}

/**
 * Restore explicit sections by replacing markers with original content
 * PHASE 5.3: Handles both semantic and legacy marker formats
 */
export function restoreExplicitSections(polishedContent, extractedSections, options = {}) {
  const { strict = false } = options;
  let restoredContent = polishedContent;
  let sectionsRestored = 0;

  for (const section of extractedSections) {
    let replaced = false;

    // Try exact marker match first (works for both formats)
    if (restoredContent.includes(section.marker)) {
      restoredContent = restoredContent.replace(section.marker, section.content);
      replaced = true;
    }

    // Try semantic pattern match: [SCENE_TRANSITION_N: ...]
    if (!replaced) {
      const semanticPattern = new RegExp(
        `\\[SCENE_TRANSITION_${section.index}:[^\\]]+\\]`,
        'g'
      );
      if (semanticPattern.test(restoredContent)) {
        restoredContent = restoredContent.replace(semanticPattern, section.content);
        replaced = true;
      }
    }

    // Try legacy pattern match: [MATURE_SCENE_N]
    if (!replaced) {
      const legacyMarker = `[MATURE_SCENE_${section.index}]`;
      if (restoredContent.includes(legacyMarker)) {
        restoredContent = restoredContent.replace(legacyMarker, section.content);
        replaced = true;
      }
    }

    // Try partial index match (in case marker was corrupted but index preserved)
    if (!replaced) {
      const indexPattern = new RegExp(
        `\\[(?:SCENE_TRANSITION|MATURE_SCENE)_${section.index}[^\\]]*\\]`,
        'g'
      );
      if (indexPattern.test(restoredContent)) {
        restoredContent = restoredContent.replace(indexPattern, section.content);
        replaced = true;
      }
    }

    if (replaced) {
      sectionsRestored++;
    } else {
      logger.warn(`[HybridPipeline] Could not restore section ${section.index} (type: ${section.type})`);
    }
  }

  logger.info('[HybridPipeline] Restored explicit sections:', {
    total: extractedSections.length,
    restored: sectionsRestored,
    failed: extractedSections.length - sectionsRestored
  });

  const failedRestores = extractedSections.length - sectionsRestored;
  if (strict && failedRestores > 0) {
    throw new Error(
      `[HybridPipeline] Explicit section restore failed: restored ${sectionsRestored}/${extractedSections.length} sections`
    );
  }

  return restoredContent;
}

/**
 * Final coherence check with Venice.ai
 * Ensures the merged content reads smoothly
 */
export async function validateCoherence(content, config) {
  const validationPrompt = `Review this story for coherence and smooth transitions. The story contains explicit content which is intentional.

STORY:
${content}

Check for:
1. Smooth transitions between scenes
2. Consistent character voice
3. Proper pacing
4. Any jarring cuts or disconnects

If the story flows well, return it unchanged.
If there are issues, fix them while preserving ALL explicit content exactly as written.

Return JSON:
{
  "is_coherent": true/false,
  "issues_found": ["list of issues if any"],
  "fixed_content": "the story, fixed if needed or unchanged if coherent"
}`;

  try {
    const result = await callVeniceWithFallback({
      messages: [{ role: 'user', content: validationPrompt }],
      model: 'llama-3.3-70b',
      temperature: 0.3,
      max_tokens: 10000
    });

    const parsed = parseJsonResponse(result.content);

    logger.info('[HybridPipeline] Coherence validation:', {
      isCoherent: parsed.is_coherent,
      issuesFound: parsed.issues_found?.length || 0
    });

    return {
      isCoherent: parsed.is_coherent !== false,
      issues: parsed.issues_found || [],
      content: parsed.fixed_content || content
    };
  } catch (error) {
    logger.warn('[HybridPipeline] Coherence check failed:', error.message);
    return { isCoherent: true, issues: [], content };
  }
}

/**
 * Main hybrid pipeline entry point
 * Orchestrates the full flow: Venice -> Extract -> OpenAI -> Restore -> Validate
 * PHASE 5.3: Enhanced with provider attribution and marker repair
 */
export async function runHybridPipeline(prompt, config, options = {}) {
  const {
    sessionId,
    skipOpenAIPolish = false,
    skipCoherenceCheck = false,
    userPrompt = null, // Original user prompt for intent analysis
    useSemanticPlaceholders = true // PHASE 5.3: Use semantic placeholders
  } = options;

  const startTime = Date.now();
  logger.info('[HybridPipeline] Starting hybrid content pipeline');
  const intensity = config?.intensity || {};
  const requiresExplicitHandling = (
    config?.audience === 'mature' && (
      (intensity.adultContent || 0) >= 50 ||
      (intensity.romance || 0) >= 50 ||
      (intensity.violence || 0) >= 60 ||
      (intensity.gore || 0) >= 60
    )
  );

  // PHASE 5.3: Track provider attribution per segment
  const providerSegments = [];

  try {
    // Step 1: Analyze user intent (if user prompt provided)
    let intentAnalysis = null;
    if (userPrompt && config?.audience === 'mature') {
      intentAnalysis = await validateUserIntent(userPrompt, config);
      logger.info('[HybridPipeline] Intent analysis complete:', intentAnalysis.summary);
    }

    // Step 2: Generate content with explicit tags via Venice.ai
    const taggedContent = await generateWithExplicitTags(prompt, config, intentAnalysis);

    // Step 3: Extract explicit sections with semantic placeholders
    const { pgContent, extractedSections, hasExplicitContent } = extractExplicitSections(
      taggedContent,
      { useSemanticPlaceholders }
    );

    // Track Venice as provider for explicit sections
    for (const section of extractedSections) {
      providerSegments.push({
        index: section.index,
        type: section.type,
        provider: 'venice',
        wordCount: section.wordCount
      });
    }

    // If no explicit content found, return as-is (Venice may not have used tags)
    if (!hasExplicitContent) {
      if (requiresExplicitHandling) {
        const msg = '[HybridPipeline] Expected tagged explicit content for mature/high-intensity request but found none';
        logger.error(msg, {
          audience: config?.audience,
          adultContent: intensity.adultContent || 0,
          romance: intensity.romance || 0,
          violence: intensity.violence || 0,
          gore: intensity.gore || 0
        });
        throw new Error(`${msg}. Regenerate with explicit tags.`);
      }

      logger.info('[HybridPipeline] No tagged explicit content, returning raw Venice output');
      return {
        content: taggedContent,
        wasHybridProcessed: false,
        explicitSections: 0,
        intentAnalysis,
        providerSegments: [{ type: 'full_content', provider: 'venice' }],
        hasExplicitContent: false,
        duration: Date.now() - startTime
      };
    }

    // Step 4: Polish PG content with OpenAI (optional)
    let polishedContent = pgContent;
    let polishResult = { content: pgContent, provider: 'none', wasRepaired: false };

    if (!skipOpenAIPolish) {
      // PHASE 5.3: Pass extractedSections for marker repair
      polishResult = await polishWithOpenAI(pgContent, config, sessionId, extractedSections);
      polishedContent = polishResult.content;

      // Track OpenAI as provider for narrative sections
      providerSegments.push({
        type: 'narrative_polish',
        provider: polishResult.provider || 'openai',
        wasRepaired: polishResult.wasRepaired,
        markerLoss: polishResult.markerLoss
      });
    }

    // Step 5: Restore explicit sections
    const restoredContent = restoreExplicitSections(polishedContent, extractedSections, {
      strict: requiresExplicitHandling
    });

    // Step 6: Final coherence check (optional)
    let finalContent = restoredContent;
    let coherenceResult = { isCoherent: true, issues: [] };
    if (!skipCoherenceCheck) {
      coherenceResult = await validateCoherence(restoredContent, config);
      finalContent = coherenceResult.content;

      providerSegments.push({
        type: 'coherence_check',
        provider: 'venice',
        hadIssues: coherenceResult.issues?.length > 0
      });
    }

    const duration = Date.now() - startTime;
    logger.info('[HybridPipeline] Pipeline complete:', {
      duration: `${duration}ms`,
      explicitSections: extractedSections.length,
      wasPolished: !skipOpenAIPolish,
      wasRepaired: polishResult.wasRepaired,
      isCoherent: coherenceResult.isCoherent
    });

    return {
      content: finalContent,
      wasHybridProcessed: true,
      explicitSections: extractedSections.length,
      explicitTypes: [...new Set(extractedSections.map(s => s.type))],
      intentAnalysis,
      coherenceIssues: coherenceResult.issues,
      providerSegments,
      hasExplicitContent: true,
      wasRepaired: polishResult.wasRepaired,
      duration
    };

  } catch (error) {
    logger.error('[HybridPipeline] Pipeline failed:', error.message);
    throw error;
  }
}

/**
 * Utility: Escape regex special characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  validateUserIntent,
  generateWithExplicitTags,
  extractExplicitSections,
  polishWithOpenAI,
  restoreExplicitSections,
  validateCoherence,
  runHybridPipeline,
  EXPLICIT_TAGS,
  // PHASE 5.3: Additional exports
  PLACEHOLDER_FORMATS,
  extractAllMarkers,
  attemptMarkerRepair
};
