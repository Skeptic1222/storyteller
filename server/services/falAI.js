/**
 * Fal AI Service for Character-Consistent Image Generation
 *
 * This service generates images with consistent character appearances across
 * multiple scenes using Fal AI's instant-character model.
 *
 * Use Cases:
 * - Storybook mode: Same characters appear throughout the story
 * - D&D campaigns: Player characters maintain consistent appearance
 * - Any story with recurring characters that need visual consistency
 *
 * Workflow:
 * 1. Generate initial character portrait using DALL-E (or provide existing image)
 * 2. Store reference image URL for each character
 * 3. Use Fal AI with reference image for subsequent scene images
 */

import { fal } from '@fal-ai/client';
import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';
import { trackFalAIUsage } from './usageTracker.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Fal AI client with API key
fal.config({ credentials: process.env.FAL_KEY });

// Image output directory
const IMAGES_DIR = path.join(__dirname, '..', '..', 'public', 'portraits');

// Size mapping for Fal AI models
const SIZE_MAPPING = {
  '1024x1024': 'square_hd',
  '1024x1792': 'portrait_4_3',
  '1792x1024': 'landscape_4_3',
  '1536x1536': 'square_hd',
  '512x512': 'square',
  '512x768': 'portrait_4_3'
};

/**
 * Validate image URL for security (prevent SSRF attacks)
 */
function validateImageUrl(url) {
  try {
    const parsed = new URL(url);

    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      logger.warn('[FalAI] Only HTTPS URLs allowed:', parsed.protocol);
      return false;
    }

    // Block internal/private IPs
    const hostname = parsed.hostname.toLowerCase();
    const privatePatterns = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      /^192\.168\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^169\.254\./,
      /^::1$/,
      /^fe80:/,
    ];

    for (const pattern of privatePatterns) {
      if (typeof pattern === 'string') {
        if (hostname === pattern) {
          logger.warn('[FalAI] Private IP blocked:', hostname);
          return false;
        }
      } else if (pattern.test(hostname)) {
        logger.warn('[FalAI] Private IP pattern matched:', hostname);
        return false;
      }
    }

    return true;
  } catch (err) {
    logger.error('[FalAI] Invalid URL:', err.message);
    return false;
  }
}

/**
 * Ensure images directory exists
 */
async function ensureImagesDir() {
  try {
    await fs.mkdir(IMAGES_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      logger.error('[FalAI] Failed to create images directory:', error);
    }
  }
}

/**
 * Generate a hash for caching purposes
 */
function generateHash(text, voiceId = '') {
  return crypto
    .createHash('sha256')
    .update(`${text}_${voiceId}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Download and save image locally
 */
async function downloadAndSaveImage(imageUrl, prefix = 'fal') {
  await ensureImagesDir();

  const imageResponse = await fetch(imageUrl);
  const arrayBuffer = await imageResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
  const localPath = path.join(IMAGES_DIR, filename);

  await fs.writeFile(localPath, buffer);
  const publicPath = `/storyteller/portraits/${filename}`;

  logger.info(`[FalAI] Image saved to ${publicPath}`);
  return publicPath;
}

/**
 * Generate character-consistent image using Fal AI
 *
 * @param {Object} params
 * @param {string} params.prompt - Scene description
 * @param {string} params.referenceImageUrl - HTTPS URL to character reference image
 * @param {string} params.size - Image dimensions (e.g., '1024x1024')
 * @param {boolean} params.faceCentric - Use face-focused model (optional)
 * @param {number} params.seed - Random seed for reproducibility (optional)
 * @param {string} params.negativePrompt - What to avoid (optional)
 * @param {boolean} params.saveLocally - Whether to download and save locally (default: true)
 * @returns {Promise<Object>} Image result
 */
async function generateWithCharacterReference(params) {
  const {
    prompt,
    referenceImageUrl,
    size = '1024x1024',
    faceCentric = false,
    seed,
    negativePrompt,
    saveLocally = true,
    maxRetries = 3
  } = params;

  // Validate inputs
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Valid prompt required for Fal AI');
  }

  if (prompt.length > 4000) {
    throw new Error('Prompt too long (max 4000 characters)');
  }

  if (!referenceImageUrl) {
    throw new Error('Reference image URL required for character-consistent generation');
  }

  // Security: Validate URL
  if (!validateImageUrl(referenceImageUrl)) {
    throw new Error('Invalid or unsafe reference image URL');
  }

  // Select model
  const model = faceCentric
    ? (process.env.FAL_MODEL_MINIMAX || 'fal-ai/minimax/image-01/subject-reference')
    : (process.env.FALAI_MODEL || 'fal-ai/instant-character');

  // Map size
  const imageSize = SIZE_MAPPING[size] || 'portrait_4_3';

  logger.info(`[FalAI] Generating character-consistent image`);
  logger.info(`[FalAI] Model: ${model}`);
  logger.debug(`[FalAI] Prompt: ${prompt.substring(0, 100)}...`);

  const startTime = Date.now();
  let lastError;

  // Retry loop
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger.info(`[FalAI] Attempt ${attempt + 1}/${maxRetries}`);

      const result = await fal.subscribe(model, {
        input: {
          prompt: prompt.trim(),
          image_url: referenceImageUrl,
          image_size: imageSize,
          seed: seed,
          num_inference_steps: parseInt(process.env.FAL_INFERENCE_STEPS) || 28,
          guidance_scale: parseFloat(process.env.FAL_GUIDANCE_SCALE) || 3.5,
          scale: parseFloat(process.env.FAL_CHARACTER_SCALE) || 1.2, // Character prominence (0-2, higher = more faithful to reference)
          negative_prompt: negativePrompt || "low quality, deformed, blurry, text, watermark, signature",
          output_format: "png",
          enable_safety_checker: true
        },
        logs: false
      });

      const imageUrl = result?.data?.images?.[0]?.url;
      if (!imageUrl) {
        throw new Error('Fal AI returned no image URL in response');
      }

      const duration = Date.now() - startTime;
      logger.info(`[FalAI] Success in ${duration}ms`);

      // Download and save locally if requested
      let localPath = null;
      if (saveLocally) {
        localPath = await downloadAndSaveImage(imageUrl, 'character');
      }

      return {
        success: true,
        imageUrl: localPath || imageUrl,
        originalUrl: imageUrl,
        provider: 'fal-ai',
        model: model,
        duration: duration,
        cached: false
      };

    } catch (error) {
      lastError = error;
      const errorMsg = error.message || String(error);
      logger.error(`[FalAI] Attempt ${attempt + 1} failed:`, errorMsg);

      // Check for non-retryable errors
      const nonRetryable = ['content policy', 'invalid input', 'authentication', 'api_key'];
      if (nonRetryable.some(p => errorMsg.toLowerCase().includes(p))) {
        logger.error('[FalAI] Non-retryable error, aborting');
        throw error;
      }

      // Exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(`[FalAI] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Generate scene illustration with character consistency
 * Uses stored character reference images to maintain appearance
 *
 * @param {string} sessionId - Story session ID
 * @param {string} sceneText - Scene description text
 * @param {Array} characters - Characters appearing in the scene
 * @param {Object} options - Generation options
 */
async function generateSceneWithCharacters(sessionId, sceneText, characters = [], options = {}) {
  const {
    style = 'storybook',
    size = '1792x1024'
  } = options;

  // If no characters with reference images, fall back to standard generation
  const charactersWithRefs = characters.filter(c => c.reference_image_url);

  if (charactersWithRefs.length === 0) {
    logger.info('[FalAI] No character references found, falling back to DALL-E');
    return null; // Signal to use DALL-E instead
  }

  // Use the first character's reference image (primary character in scene)
  const primaryCharacter = charactersWithRefs[0];

  // Build prompt with character context
  let prompt = `${sceneText}`;

  // Add style suffix
  const stylePrompts = {
    storybook: 'children\'s book illustration style, warm, friendly, whimsical',
    fantasy: 'fantasy art style, detailed, magical lighting, rich colors',
    watercolor: 'watercolor painting style, soft edges, gentle colors',
    realistic: 'photorealistic, detailed, professional lighting'
  };

  prompt += `. ${stylePrompts[style] || stylePrompts.storybook}`;

  try {
    const result = await generateWithCharacterReference({
      prompt,
      referenceImageUrl: primaryCharacter.reference_image_url,
      size,
      saveLocally: true
    });

    // Track usage if successful
    if (result && result.success) {
      trackFalAIUsage(sessionId, result.model || 'instant-character');
    }

    return result;

  } catch (error) {
    logger.error('[FalAI] Scene generation failed:', error);
    return null; // Signal to fall back to DALL-E
  }
}

/**
 * Store character reference image in database
 * Call this after generating the initial portrait for a character
 */
async function storeCharacterReference(sessionId, characterId, referenceImageUrl) {
  try {
    await pool.query(`
      UPDATE characters
      SET reference_image_url = $1
      WHERE id = $2 AND story_session_id = $3
    `, [referenceImageUrl, characterId, sessionId]);

    logger.info(`[FalAI] Stored reference image for character ${characterId}`);
    return true;
  } catch (error) {
    logger.error('[FalAI] Failed to store character reference:', error);
    return false;
  }
}

/**
 * Get characters with reference images for a session
 */
async function getCharactersWithReferences(sessionId) {
  try {
    const result = await pool.query(`
      SELECT id, name, reference_image_url
      FROM characters
      WHERE story_session_id = $1 AND reference_image_url IS NOT NULL
    `, [sessionId]);

    return result.rows;
  } catch (error) {
    logger.error('[FalAI] Failed to get character references:', error);
    return [];
  }
}

/**
 * Check if Fal AI is available and configured
 */
function isAvailable() {
  return !!process.env.FAL_KEY;
}

/**
 * Determine which image provider to use based on context
 *
 * @param {Object} context
 * @param {string} context.storyType - 'standard', 'storybook', 'campaign'
 * @param {boolean} context.hasRecurringCharacters - Whether characters appear multiple times
 * @param {boolean} context.hasReferenceImages - Whether character references exist
 * @returns {'fal-ai' | 'dall-e'} Provider to use
 */
function selectProvider(context) {
  const { storyType, hasRecurringCharacters, hasReferenceImages } = context;

  // Use Fal AI for storybook mode or campaigns with reference images
  if ((storyType === 'storybook' || storyType === 'campaign') &&
      hasRecurringCharacters &&
      hasReferenceImages &&
      isAvailable()) {
    return 'fal-ai';
  }

  // Use DALL-E for everything else
  return 'dall-e';
}

export {
  generateWithCharacterReference,
  generateSceneWithCharacters,
  storeCharacterReference,
  getCharactersWithReferences,
  isAvailable,
  selectProvider,
  validateImageUrl,
  downloadAndSaveImage
};

export default {
  generateWithCharacterReference,
  generateSceneWithCharacters,
  storeCharacterReference,
  getCharactersWithReferences,
  isAvailable,
  selectProvider
};
