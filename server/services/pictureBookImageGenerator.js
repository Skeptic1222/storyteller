/**
 * Picture Book Image Generator Service
 *
 * Generates 3-5 character-consistent images per scene using FALAI,
 * synchronized with narration timing for animated storybook experience.
 *
 * KEY FEATURES:
 * - Uses character reference images for consistency across all images
 * - LLM creates image breakpoints at narrative moments
 * - Syncs image transitions to word timing data from ElevenLabs
 * - Three-tier prompt system (like cover art) for content safety
 */

import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';
import * as falAI from './falAI.js';
import { completion, parseJsonResponse } from './openai.js';
import { getUtilityModel } from './modelSelection.js';
import { trackFalAIUsage } from './usageTracker.js';

// Configuration
const IMAGES_PER_SCENE = { min: 3, max: 5, default: 4 };
const IMAGE_SIZE = '1024x1024'; // Square for storybook
const STYLE_PRESETS = {
  storybook: "children's book illustration, warm colors, friendly, whimsical, watercolor style",
  fantasy: 'fantasy art, rich colors, magical lighting, detailed background',
  anime: 'anime style, expressive, vibrant colors, clean lines',
  realistic: 'photorealistic illustration, cinematic lighting',
  gothic: 'gothic art style, dark atmospheric, moody lighting',
  scifi: 'science fiction art, futuristic, sleek design, neon accents'
};

/**
 * Generate image breakpoints for a scene
 * LLM identifies 3-5 key visual moments in the narrative
 */
async function generateImageBreakpoints(sceneText, characters, sessionId) {
  const prompt = `You are an illustrated storybook art director. Analyze this scene and identify ${IMAGES_PER_SCENE.default} key visual moments that should be illustrated.

SCENE TEXT:
${sceneText}

CHARACTERS IN STORY:
${characters.map(c => `- ${c.name}: ${c.description || c.role}`).join('\n')}

For each image breakpoint, provide:
1. word_index: Approximate word position where this image should appear (0 = start)
2. description: What should be shown in the illustration (1-2 sentences)
3. characters: Which characters appear (use exact names from the list)
4. mood: The emotional tone (warm, tense, joyful, mysterious, etc.)
5. focus: What's the visual focus (character close-up, action, environment, etc.)

Return JSON:
{
  "breakpoints": [
    {
      "word_index": 0,
      "description": "Description of what to illustrate...",
      "characters": ["Character Name"],
      "mood": "warm",
      "focus": "establishing_shot"
    }
  ]
}`;

  try {
    const response = await completion({
      model: getUtilityModel(),
      messages: [
        { role: 'system', content: 'You are a visual storytelling expert. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
      agent_name: 'image_breakpoint_generator',
      sessionId
    });

    const result = parseJsonResponse(response.content);
    return result.breakpoints || [];

  } catch (error) {
    logger.error('[PictureBook] Failed to generate breakpoints:', error);
    // Fallback: evenly distribute images
    const wordCount = sceneText.split(/\s+/).length;
    const defaultBreakpoints = [];
    for (let i = 0; i < IMAGES_PER_SCENE.default; i++) {
      defaultBreakpoints.push({
        word_index: Math.floor((wordCount / IMAGES_PER_SCENE.default) * i),
        description: `Scene moment ${i + 1}`,
        characters: characters.slice(0, 2).map(c => c.name),
        mood: 'neutral',
        focus: i === 0 ? 'establishing_shot' : 'action'
      });
    }
    return defaultBreakpoints;
  }
}

/**
 * Generate three-tier image prompts (like cover art)
 * Each tier is progressively more abstract for FALAI safety fallback
 */
async function generateImagePrompts(breakpoint, characters, style, sessionId) {
  const characterDescriptions = characters
    .filter(c => breakpoint.characters.includes(c.name))
    .map(c => `${c.name}: ${c.appearance || c.description || 'a person'}`)
    .join('; ');

  const stylePrompt = STYLE_PRESETS[style] || STYLE_PRESETS.storybook;

  const prompt = `Create THREE image prompts for this storybook illustration with increasing abstraction:

SCENE: ${breakpoint.description}
CHARACTERS: ${characterDescriptions}
MOOD: ${breakpoint.mood}
STYLE: ${stylePrompt}

TIER 1 (Direct): Illustrate the scene literally with characters visible
TIER 2 (Symbolic): More abstract, use silhouettes or distant views
TIER 3 (Abstract): Pure mood/atmosphere - safe for any content filter

Return JSON:
{
  "prompts": [
    { "tier": 1, "prompt": "..." },
    { "tier": 2, "prompt": "..." },
    { "tier": 3, "prompt": "..." }
  ]
}`;

  try {
    const response = await completion({
      model: getUtilityModel(),
      messages: [
        { role: 'system', content: 'You are an art director. Create safe, family-friendly image prompts.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
      agent_name: 'image_prompt_generator',
      sessionId
    });

    const result = parseJsonResponse(response.content);
    return result.prompts || [];

  } catch (error) {
    logger.error('[PictureBook] Failed to generate prompts:', error);
    return [
      { tier: 1, prompt: `${breakpoint.description}, ${stylePrompt}` },
      { tier: 2, prompt: `Silhouette scene showing ${breakpoint.mood} atmosphere, ${style} style` },
      { tier: 3, prompt: `Abstract ${breakpoint.mood} atmosphere, beautiful colors, artistic` }
    ];
  }
}

/**
 * Generate a single scene image using FALAI with character reference
 */
async function generateSceneImage(prompt, characterRef, sessionId, tier = 1) {
  try {
    if (characterRef?.reference_image_url) {
      // Use FALAI for character-consistent image
      const result = await falAI.generateWithCharacterReference({
        prompt: prompt,
        referenceImageUrl: characterRef.reference_image_url,
        size: IMAGE_SIZE,
        saveLocally: true,
        maxRetries: 2
      });

      trackFalAIUsage(sessionId, 'instant-character');

      return {
        success: true,
        imageUrl: result.imageUrl,
        provider: 'fal-ai',
        tier
      };

    } else {
      // Fallback to DALL-E if no character reference
      logger.warn('[PictureBook] No character reference, would fall back to DALL-E');
      return null;
    }

  } catch (error) {
    logger.error(`[PictureBook] Image generation failed (tier ${tier}):`, error);
    return null;
  }
}

/**
 * Generate all images for a scene with fallback tiers
 */
async function generateSceneImages(sceneId, sceneText, characters, wordTimings, options = {}) {
  const { sessionId, style = 'storybook' } = options;

  logger.info(`[PictureBook] Generating images for scene ${sceneId}`);

  // Get characters with reference images
  const charactersWithRefs = characters.filter(c => c.reference_image_url);
  if (charactersWithRefs.length === 0) {
    logger.warn('[PictureBook] No character references available, skipping image generation');
    return [];
  }

  // Step 1: Generate breakpoints
  const breakpoints = await generateImageBreakpoints(sceneText, characters, sessionId);
  logger.info(`[PictureBook] Generated ${breakpoints.length} breakpoints`);

  // Step 2: Calculate actual word timings for each breakpoint
  const wordArray = wordTimings?.words || [];
  const enhancedBreakpoints = breakpoints.map(bp => ({
    ...bp,
    trigger_time_ms: wordArray[bp.word_index]?.start_ms || 0
  }));

  // Step 3: Generate images for each breakpoint
  const generatedImages = [];
  const startTime = Date.now();

  for (let i = 0; i < enhancedBreakpoints.length; i++) {
    const breakpoint = enhancedBreakpoints[i];

    // Find the primary character for this image
    const primaryCharName = breakpoint.characters?.[0];
    const primaryChar = charactersWithRefs.find(c => c.name === primaryCharName) || charactersWithRefs[0];

    // Generate three-tier prompts
    const prompts = await generateImagePrompts(breakpoint, characters, style, sessionId);

    // Try each tier until one succeeds
    let imageResult = null;
    for (const promptData of prompts) {
      imageResult = await generateSceneImage(
        promptData.prompt,
        primaryChar,
        sessionId,
        promptData.tier
      );

      if (imageResult?.success) {
        break;
      }
    }

    if (imageResult?.success) {
      // Save to database
      const insertResult = await pool.query(`
        INSERT INTO scene_images (
          story_session_id, scene_id, image_url, prompt, prompt_abstract_level,
          sequence_index, trigger_word_index, trigger_time_ms,
          primary_character_id, characters_in_image, provider, model
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        sessionId,
        sceneId,
        imageResult.imageUrl,
        prompts[imageResult.tier - 1]?.prompt || '',
        imageResult.tier,
        i,
        breakpoint.word_index,
        breakpoint.trigger_time_ms,
        primaryChar?.id,
        breakpoint.characters,
        imageResult.provider,
        'instant-character'
      ]);

      generatedImages.push({
        id: insertResult.rows[0].id,
        sequence_index: i,
        image_url: imageResult.imageUrl,
        trigger_word_index: breakpoint.word_index,
        trigger_time_ms: breakpoint.trigger_time_ms,
        tier_used: imageResult.tier
      });

      logger.info(`[PictureBook] Image ${i + 1}/${enhancedBreakpoints.length} generated (tier ${imageResult.tier})`);

    } else {
      logger.error(`[PictureBook] Failed to generate image ${i + 1} after all tiers`);
    }
  }

  const totalTime = Date.now() - startTime;
  logger.info(`[PictureBook] Completed: ${generatedImages.length}/${breakpoints.length} images generated in ${totalTime}ms`);
  return generatedImages;
}

/**
 * Pre-generate character reference portraits for picture book mode
 * Called during launch sequence before story generation begins
 */
async function preGenerateCharacterReferences(sessionId, characters, style = 'storybook') {
  const results = [];

  for (const character of characters) {
    if (character.reference_image_url) {
      // Already has reference
      results.push({ characterId: character.id, success: true, existing: true });
      continue;
    }

    try {
      // Generate portrait using existing portrait generator
      const { generateAndStoreCharacterReference } = await import('./portraitGenerator.js');

      const result = await generateAndStoreCharacterReference(
        character.id,
        sessionId,
        { style }
      );

      results.push({
        characterId: character.id,
        characterName: character.name,
        success: result?.success || false,
        imageUrl: result?.imageUrl
      });

      logger.info(`[PictureBook] Generated reference for ${character.name}`);

    } catch (error) {
      logger.error(`[PictureBook] Failed to generate reference for ${character.name}:`, error);
      results.push({
        characterId: character.id,
        characterName: character.name,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Get scene images for playback
 */
async function getSceneImages(sceneId) {
  const result = await pool.query(`
    SELECT id, image_url, sequence_index, trigger_word_index, trigger_time_ms
    FROM scene_images
    WHERE scene_id = $1
    ORDER BY sequence_index
  `, [sceneId]);

  return result.rows;
}

/**
 * Check if picture book mode is enabled for a session
 */
async function isPictureBookMode(sessionId) {
  const result = await pool.query(
    'SELECT visual_mode, config_json FROM story_sessions WHERE id = $1',
    [sessionId]
  );

  if (result.rows.length === 0) return false;

  const session = result.rows[0];
  const config = session.config_json || {};

  return session.visual_mode === 'picture_book' ||
         config.story_format === 'picture_book';
}

export {
  generateSceneImages,
  generateImageBreakpoints,
  generateImagePrompts,
  preGenerateCharacterReferences,
  getSceneImages,
  isPictureBookMode,
  IMAGES_PER_SCENE,
  STYLE_PRESETS
};

export default {
  generateSceneImages,
  generateImageBreakpoints,
  preGenerateCharacterReferences,
  getSceneImages,
  isPictureBookMode
};
