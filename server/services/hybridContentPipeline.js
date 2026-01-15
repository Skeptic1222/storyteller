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
const { callVenice, callOpenRouter, PROVIDERS, isProviderAvailable } = llmProviders;
import { getCreativeModel, getUtilityModel } from './modelSelection.js';

/**
 * Call Venice with OpenRouter fallback
 * If Venice fails, tries OpenRouter with Claude 3.5 Sonnet
 */
async function callVeniceWithFallback(options) {
  try {
    return await callVenice(options);
  } catch (veniceError) {
    logger.warn(`[HybridPipeline] Venice failed: ${veniceError.message}, trying OpenRouter fallback`);

    if (isProviderAvailable(PROVIDERS.OPENROUTER)) {
      try {
        const result = await callOpenRouter({
          ...options,
          model: 'anthropic/claude-3.5-sonnet'  // Claude is excellent for creative writing
        });
        result.wasOpenRouterFallback = true;
        return result;
      } catch (openRouterError) {
        logger.error(`[HybridPipeline] OpenRouter fallback also failed: ${openRouterError.message}`);
        throw openRouterError;
      }
    }

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

// Placeholder format for OpenAI processing
const PLACEHOLDER_PREFIX = '[MATURE_SCENE_';
const PLACEHOLDER_SUFFIX = ']';

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
  if (audience !== 'mature' || (adultContent < 50 && romance < 50)) {
    return {
      requiresExplicit: false,
      explicitTypes: [],
      intensity: 'none',
      userExpectations: null
    };
  }

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
    // Default to explicit based on settings with granular intensity levels
    let intensity = 'none';
    if (adultContent >= 80) {
      intensity = 'hardcore';
    } else if (adultContent >= 70) {
      intensity = 'explicit';
    } else if (adultContent >= 60) {
      intensity = 'moderate';
    } else if (adultContent >= 50) {
      intensity = 'mild';
    }

    return {
      requiresExplicit: adultContent >= 50,
      explicitTypes: adultContent >= 50 ? ['sex'] : [],
      intensity,
      mustInclude: [],
      pacing: 'gradual',
      summary: `Mature content requested (intensity: ${intensity}) based on adult content setting: ${adultContent}/100`,
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

  // Build explicit content instructions based on intent analysis
  let explicitInstructions = '';

  if (intentAnalysis?.requiresExplicit) {
    const intensityGuide = {
      'hardcore': 'Write PORNOGRAPHIC, extremely graphic content with explicit anatomical detail. No limits.',
      'explicit': 'Write graphic, detailed explicit content without holding back.',
      'moderate': 'Write sensual, erotic content with clear physical descriptions.',
      'mild': 'Write suggestive content with some intimate detail.'
    };

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
The content INSIDE the tags should be maximally explicit per the user's settings (${adultContent}/100 adult, ${romance}/100 romance).`;

  try {
    const result = await callVeniceWithFallback({
      messages: [{ role: 'user', content: taggedPrompt }],
      model: 'llama-3.3-70b',
      temperature: 0.85,
      max_tokens: 8000
    });

    logger.info('[HybridPipeline] Generated tagged content:', {
      length: result.content?.length,
      hasSexTags: result.content?.includes('<explicit-sex>'),
      hasGoreTags: result.content?.includes('<explicit-gore>'),
      hasViolenceTags: result.content?.includes('<explicit-violence>')
    });

    return result.content;
  } catch (error) {
    logger.error('[HybridPipeline] Venice generation failed:', error.message);
    throw error;
  }
}

/**
 * Extract explicit sections and replace with placeholders
 * Returns the PG content and a map of extracted sections
 */
export function extractExplicitSections(content) {
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
      const marker = `${PLACEHOLDER_PREFIX}${markerIndex}${PLACEHOLDER_SUFFIX}`;
      extractedSections.push({
        marker,
        index: markerIndex,
        type: type.toLowerCase(),
        content: explicitContent.trim(),
        originalMatch: match
      });
      markerIndex++;

      // Replace with a PG placeholder description
      const pgReplacement = getPGReplacement(type, explicitContent);
      return `${marker} ${pgReplacement} ${marker}`;
    });
  }

  logger.info('[HybridPipeline] Extracted explicit sections:', {
    count: extractedSections.length,
    types: extractedSections.map(s => s.type)
  });

  return {
    pgContent,
    extractedSections,
    hasExplicitContent: extractedSections.length > 0
  };
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
 */
export async function polishWithOpenAI(pgContent, config, sessionId) {
  const narratorStyle = config?.narrator_style || 'engaging';

  const polishPrompt = `You are enhancing a story's narrative quality. The story contains placeholder markers for mature scenes that should NOT be modified.

STORY TO ENHANCE:
${pgContent}

ENHANCEMENT GOALS:
1. Improve prose quality and flow
2. Enhance descriptive language
3. Smooth transitions between scenes
4. Strengthen character voice in dialogue
5. Maintain consistent tone and pacing

CRITICAL RULES:
- DO NOT modify any [MATURE_SCENE_X] markers - leave them exactly as they are
- DO NOT add content inside or around the markers
- Focus on the non-marked sections only
- Keep the same overall length
- Preserve the story's structure

Narrator style: ${narratorStyle}

Return the enhanced story with all markers intact.`;

  try {
    const result = await callAgent('narrator', polishPrompt, { sessionId });

    // Verify markers are preserved
    const originalMarkers = pgContent.match(/\[MATURE_SCENE_\d+\]/g) || [];
    const polishedMarkers = result.content.match(/\[MATURE_SCENE_\d+\]/g) || [];

    if (originalMarkers.length !== polishedMarkers.length) {
      logger.warn('[HybridPipeline] OpenAI modified markers, using original content');
      return pgContent;
    }

    logger.info('[HybridPipeline] OpenAI polish complete, markers preserved');
    return result.content;
  } catch (error) {
    logger.warn('[HybridPipeline] OpenAI polish failed, using original:', error.message);
    return pgContent;
  }
}

/**
 * Restore explicit sections by replacing markers with original content
 */
export function restoreExplicitSections(polishedContent, extractedSections) {
  let restoredContent = polishedContent;

  for (const section of extractedSections) {
    // Replace the marker and its PG description with the original explicit content
    const markerPattern = new RegExp(
      `${escapeRegex(section.marker)}[^\\[]*${escapeRegex(section.marker)}`,
      'g'
    );

    restoredContent = restoredContent.replace(markerPattern, section.content);
  }

  // Also handle single markers (in case format changed)
  for (const section of extractedSections) {
    restoredContent = restoredContent.replace(
      new RegExp(escapeRegex(section.marker), 'g'),
      section.content
    );
  }

  logger.info('[HybridPipeline] Restored explicit sections:', {
    sectionsRestored: extractedSections.length
  });

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
 */
export async function runHybridPipeline(prompt, config, options = {}) {
  const {
    sessionId,
    skipOpenAIPolish = false,
    skipCoherenceCheck = false,
    userPrompt = null // Original user prompt for intent analysis
  } = options;

  const startTime = Date.now();
  logger.info('[HybridPipeline] Starting hybrid content pipeline');

  try {
    // Step 1: Analyze user intent (if user prompt provided)
    let intentAnalysis = null;
    if (userPrompt && config?.audience === 'mature') {
      intentAnalysis = await validateUserIntent(userPrompt, config);
      logger.info('[HybridPipeline] Intent analysis complete:', intentAnalysis.summary);
    }

    // Step 2: Generate content with explicit tags via Venice.ai
    const taggedContent = await generateWithExplicitTags(prompt, config, intentAnalysis);

    // Step 3: Extract explicit sections
    const { pgContent, extractedSections, hasExplicitContent } = extractExplicitSections(taggedContent);

    // If no explicit content found, return as-is (Venice may not have used tags)
    if (!hasExplicitContent) {
      logger.info('[HybridPipeline] No tagged explicit content, returning raw Venice output');
      return {
        content: taggedContent,
        wasHybridProcessed: false,
        explicitSections: 0,
        intentAnalysis,
        duration: Date.now() - startTime
      };
    }

    // Step 4: Polish PG content with OpenAI (optional)
    let polishedContent = pgContent;
    if (!skipOpenAIPolish) {
      polishedContent = await polishWithOpenAI(pgContent, config, sessionId);
    }

    // Step 5: Restore explicit sections
    const restoredContent = restoreExplicitSections(polishedContent, extractedSections);

    // Step 6: Final coherence check (optional)
    let finalContent = restoredContent;
    let coherenceResult = { isCoherent: true, issues: [] };
    if (!skipCoherenceCheck) {
      coherenceResult = await validateCoherence(restoredContent, config);
      finalContent = coherenceResult.content;
    }

    const duration = Date.now() - startTime;
    logger.info('[HybridPipeline] Pipeline complete:', {
      duration: `${duration}ms`,
      explicitSections: extractedSections.length,
      wasPolished: !skipOpenAIPolish,
      isCoherent: coherenceResult.isCoherent
    });

    return {
      content: finalContent,
      wasHybridProcessed: true,
      explicitSections: extractedSections.length,
      explicitTypes: [...new Set(extractedSections.map(s => s.type))],
      intentAnalysis,
      coherenceIssues: coherenceResult.issues,
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
  EXPLICIT_TAGS
};
