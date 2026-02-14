/**
 * Portrait Generation API Routes
 */

import express from 'express';
import {
  generatePortrait,
  generateAndSavePortrait,
  generateStoryCover,
  generateSceneIllustration,
  getPortraitStyles,
  generateSceneBackground
} from '../services/portraitGenerator.js';
import { removeBackground } from '../services/falAI.js';
import {
  compositeCharacterOnBackground,
  compositeMultipleCharacters,
  composeScene,
  getPositionPresets
} from '../services/imageCompositor.js';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken, requireAuth);

async function verifySessionOwnership(sessionId, userId, isAdmin) {
  const result = await pool.query(
    'SELECT user_id FROM story_sessions WHERE id = $1',
    [sessionId]
  );
  if (result.rows.length === 0) return { error: 'Session not found', status: 404 };
  if (result.rows[0].user_id !== userId && !isAdmin) return { error: 'Not authorized', status: 403 };
  return null;
}

/**
 * GET /api/portraits/styles
 * Get available portrait styles
 */
router.get('/styles', (req, res) => {
  try {
    const styles = getPortraitStyles();
    res.json({
      success: true,
      styles
    });
  } catch (error) {
    logger.error('Error fetching portrait styles:', error);
    res.status(500).json({ error: 'Failed to fetch styles' });
  }
});

/**
 * POST /api/portraits/generate
 * Generate a portrait from character data (not saved to DB)
 */
router.post('/generate', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const { character, style = 'fantasy', size = '1024x1024', quality = 'standard' } = req.body;

    if (!character) {
      return res.status(400).json({ error: 'Character data required' });
    }

    const result = await generatePortrait(character, { style, size, quality });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error generating portrait:', error);
    res.status(500).json({ error: 'Failed to generate portrait' });
  }
});

/**
 * POST /api/portraits/character/:characterId
 * Generate and save portrait for an existing character
 */
router.post('/character/:characterId', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const { characterId } = req.params;
    const { sessionId, style = 'fantasy' } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const ownershipError = await verifySessionOwnership(sessionId, req.user.id, req.user.is_admin);
    if (ownershipError) return res.status(ownershipError.status).json({ error: ownershipError.error });

    const result = await generateAndSavePortrait(characterId, sessionId, { style });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error generating character portrait:', error);
    res.status(500).json({ error: 'Failed to generate character portrait' });
  }
});

/**
 * POST /api/portraits/session/:sessionId/cover
 * Generate cover image for a story session
 */
router.post('/session/:sessionId/cover', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { style = 'painterly', quality = 'hd' } = req.body;

    const ownershipError = await verifySessionOwnership(sessionId, req.user.id, req.user.is_admin);
    if (ownershipError) return res.status(ownershipError.status).json({ error: ownershipError.error });

    // Get session details
    const sessionResult = await pool.query(
      `SELECT ss.*, so.outline_json
       FROM story_sessions ss
       LEFT JOIN story_outlines so ON so.story_session_id = ss.id
       WHERE ss.id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    const outline = session.outline_json ? JSON.parse(session.outline_json) : {};
    const config = session.config_json ? (typeof session.config_json === 'string' ? JSON.parse(session.config_json) : session.config_json) : {};

    // Build complete session data for cover art generation
    const sessionData = {
      id: session.id,
      title: session.title || outline.title,
      synopsis: session.synopsis || outline.synopsis || '',           // CRITICAL: synopsis for scene description
      genres: config.genres || { [outline.genre || 'fantasy']: 80 }, // CRITICAL: genres object for visual elements
      mood: config.mood || config.tone || 'adventurous',             // CRITICAL: mood for atmosphere
      setting: outline.setting || config.setting,
      themes: outline.themes || [],                                   // Use themes (plural)
      main_characters: outline.main_characters || outline.characters || []
    };

    logger.info(`[Portraits] Generating cover for "${sessionData.title}" with synopsis: ${sessionData.synopsis?.substring(0, 50)}...`);

    const result = await generateStoryCover(sessionData, { style, quality });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error generating story cover:', error);
    res.status(500).json({ error: 'Failed to generate story cover' });
  }
});

/**
 * POST /api/portraits/scene
 * Generate illustration for a scene
 */
router.post('/scene', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const { sceneText, sceneId, style = 'storybook' } = req.body;

    if (!sceneText) {
      return res.status(400).json({ error: 'Scene text required' });
    }

    const result = await generateSceneIllustration(sceneText, { style });

    // If sceneId provided, update the scene
    if (sceneId) {
      await pool.query(
        'UPDATE story_scenes SET illustration_url = $1 WHERE id = $2',
        [result.imageUrl, sceneId]
      );
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error generating scene illustration:', error);
    res.status(500).json({ error: 'Failed to generate scene illustration' });
  }
});

/**
 * GET /api/portraits/session/:sessionId/characters
 * Get all characters with portraits for a session
 */
router.get('/session/:sessionId/characters', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const ownershipError = await verifySessionOwnership(sessionId, req.user.id, req.user.is_admin);
    if (ownershipError) return res.status(ownershipError.status).json({ error: ownershipError.error });

    const result = await pool.query(
      `SELECT id, name, role, portrait_url, traits_json, appearance_json
       FROM characters
       WHERE story_session_id = $1
       ORDER BY created_at`,
      [sessionId]
    );

    const characters = result.rows.map(char => ({
      id: char.id,
      name: char.name,
      role: char.role,
      portraitUrl: char.portrait_url,
      hasPortrait: !!char.portrait_url,
      traits: char.traits_json,
      appearance: char.appearance_json
    }));

    res.json({
      success: true,
      characters
    });
  } catch (error) {
    logger.error('Error fetching session characters:', error);
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

/**
 * POST /api/portraits/batch
 * Generate portraits for multiple characters
 * Uses parallel execution with Promise.allSettled for 5x faster generation
 */
router.post('/batch', rateLimiters.strict, async (req, res) => {
  try {
    const { sessionId, characterIds, style = 'fantasy', parallel = true } = req.body;

    if (!sessionId || !characterIds || !Array.isArray(characterIds)) {
      return res.status(400).json({ error: 'Session ID and character IDs required' });
    }

    const ownershipError = await verifySessionOwnership(sessionId, req.user.id, req.user.is_admin);
    if (ownershipError) return res.status(ownershipError.status).json({ error: ownershipError.error });

    // Limit batch size to prevent abuse (max 10 portraits per request)
    const MAX_BATCH_SIZE = 10;
    const limitedIds = characterIds.slice(0, MAX_BATCH_SIZE);
    if (characterIds.length > MAX_BATCH_SIZE) {
      logger.warn(`[Portraits] Batch size limited from ${characterIds.length} to ${MAX_BATCH_SIZE}`);
    }

    logger.info(`[Portraits] Batch generating ${limitedIds.length} portraits (parallel: ${parallel})`);

    let settledResults;

    if (parallel) {
      // Parallel execution - much faster for multiple portraits
      settledResults = await Promise.allSettled(
        limitedIds.map(charId =>
          generateAndSavePortrait(charId, sessionId, { style })
            .then(result => ({ characterId: charId, ...result }))
        )
      );
    } else {
      // Sequential fallback if API rate limits are strict
      settledResults = [];
      for (const charId of limitedIds) {
        try {
          const result = await generateAndSavePortrait(charId, sessionId, { style });
          settledResults.push({ status: 'fulfilled', value: { characterId: charId, ...result } });
        } catch (error) {
          settledResults.push({ status: 'rejected', reason: error, characterId: charId });
        }
        // Small delay for sequential mode
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Process results
    const results = [];
    const errors = [];

    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        errors.push({
          characterId: settled.characterId || limitedIds[i],
          error: settled.reason?.message || 'Unknown error'
        });
      }
    }

    res.json({
      success: true,
      generated: results.length,
      failed: errors.length,
      truncated: characterIds.length > MAX_BATCH_SIZE,
      results,
      errors
    });
  } catch (error) {
    logger.error('Error in batch portrait generation:', error);
    res.status(500).json({ error: 'Failed to generate portraits' });
  }
});

// ============================================
// Picture Book Compositing Endpoints
// ============================================

/**
 * POST /api/portraits/remove-background
 * Remove background from an image using FalAI Bria RMBG
 */
router.post('/remove-background', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL required' });
    }

    logger.info(`[Portraits] Removing background from image`);
    const result = await removeBackground({ imageUrl, saveLocally: true });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error removing background:', error);
    res.status(500).json({ error: 'Failed to remove background' });
  }
});

/**
 * POST /api/portraits/generate-background
 * Generate a scene background without characters (for compositing)
 */
router.post('/generate-background', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const {
      sceneDescription,
      style = 'storybook',
      mood = 'neutral',
      size = '1792x1024'
    } = req.body;

    if (!sceneDescription) {
      return res.status(400).json({ error: 'Scene description required' });
    }

    logger.info(`[Portraits] Generating scene background: ${sceneDescription.substring(0, 50)}...`);
    const result = await generateSceneBackground({
      sceneDescription,
      style,
      mood,
      size
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error generating scene background:', error);
    res.status(500).json({ error: 'Failed to generate scene background' });
  }
});

/**
 * POST /api/portraits/compose
 * Composite character(s) onto a background
 */
router.post('/compose', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const {
      backgroundUrl,
      characters = [], // Array of {url, position, scale?}
      characterUrl,    // Single character alternative
      position = 'center'
    } = req.body;

    if (!backgroundUrl) {
      return res.status(400).json({ error: 'Background URL required' });
    }

    let result;

    if (characters.length > 0) {
      // Multiple characters
      logger.info(`[Portraits] Compositing ${characters.length} characters onto background`);
      result = await compositeMultipleCharacters({
        backgroundUrl,
        characters,
        addShadows: true
      });
    } else if (characterUrl) {
      // Single character
      logger.info(`[Portraits] Compositing single character onto background`);
      result = await compositeCharacterOnBackground({
        backgroundUrl,
        characterUrl,
        position,
        addShadow: true
      });
    } else {
      return res.status(400).json({ error: 'At least one character URL required' });
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error compositing image:', error);
    res.status(500).json({ error: 'Failed to composite image' });
  }
});

/**
 * POST /api/portraits/compose-scene
 * High-level scene composition for Picture Book mode
 * Handles the full workflow: background + characters with suggested Ken Burns
 */
router.post('/compose-scene', rateLimiters.imageGeneration, async (req, res) => {
  try {
    const {
      backgroundUrl,
      characters = [],
      sceneId = null,
      kenBurnsEffect = 'zoomIn'
    } = req.body;

    if (!backgroundUrl) {
      return res.status(400).json({ error: 'Background URL required' });
    }

    logger.info(`[Portraits] Composing scene with ${characters.length} characters`);
    const result = await composeScene({
      backgroundUrl,
      characters,
      sceneId,
      kenBurnsEffect
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error composing scene:', error);
    res.status(500).json({ error: 'Failed to compose scene' });
  }
});

/**
 * GET /api/portraits/position-presets
 * Get available character position presets for compositing
 */
router.get('/position-presets', (req, res) => {
  try {
    const presets = getPositionPresets();
    res.json({
      success: true,
      presets
    });
  } catch (error) {
    logger.error('Error fetching position presets:', error);
    res.status(500).json({ error: 'Failed to fetch position presets' });
  }
});

/**
 * POST /api/portraits/picture-book-pipeline
 * Full Picture Book image pipeline:
 * 1. Generate character portrait (or use existing)
 * 2. Remove background
 * 3. Generate scene background
 * 4. Composite together
 */
router.post('/picture-book-pipeline', rateLimiters.strict, async (req, res) => {
  try {
    const {
      characterPortraitUrl,     // Existing portrait URL (or null to generate)
      characterData = null,     // Character data if generating new portrait
      sceneDescription,
      style = 'storybook',
      mood = 'neutral',
      position = 'center',
      kenBurnsEffect = 'zoomIn'
    } = req.body;

    if (!sceneDescription) {
      return res.status(400).json({ error: 'Scene description required' });
    }

    const pipeline = {
      steps: [],
      finalImage: null
    };

    // Step 1: Get or generate character portrait
    let portraitUrl = characterPortraitUrl;
    if (!portraitUrl && characterData) {
      logger.info('[Portraits] Pipeline: Generating character portrait');
      const portraitResult = await generatePortrait(characterData, { style, saveLocally: true });
      portraitUrl = portraitResult.imageUrl;
      pipeline.steps.push({ step: 'generate_portrait', url: portraitUrl });
    }

    // Step 2: Remove background from character (if we have a portrait)
    let transparentCharacterUrl = null;
    if (portraitUrl) {
      logger.info('[Portraits] Pipeline: Removing background');
      // Need to convert local path to full URL for FalAI
      let fullUrl = portraitUrl;
      if (portraitUrl.startsWith('/')) {
        // Local path - need public URL for FalAI
        // This would need the server's public URL - for now, skip if local
        logger.warn('[Portraits] Pipeline: Local image, background removal requires public URL');
        transparentCharacterUrl = portraitUrl; // Use as-is for now
      } else {
        const bgResult = await removeBackground({ imageUrl: fullUrl, saveLocally: true });
        transparentCharacterUrl = bgResult.imageUrl;
      }
      pipeline.steps.push({ step: 'remove_background', url: transparentCharacterUrl });
    }

    // Step 3: Generate scene background
    logger.info('[Portraits] Pipeline: Generating scene background');
    const bgResult = await generateSceneBackground({
      sceneDescription,
      style,
      mood,
      size: '1792x1024'
    });
    pipeline.steps.push({ step: 'generate_background', url: bgResult.imageUrl });

    // Step 4: Composite (if we have a character)
    if (transparentCharacterUrl) {
      logger.info('[Portraits] Pipeline: Compositing character onto background');
      const composeResult = await compositeCharacterOnBackground({
        backgroundUrl: bgResult.imageUrl,
        characterUrl: transparentCharacterUrl,
        position,
        addShadow: true
      });
      pipeline.finalImage = composeResult.imageUrl;
      pipeline.steps.push({ step: 'composite', url: composeResult.imageUrl });
    } else {
      // No character - just return the background
      pipeline.finalImage = bgResult.imageUrl;
    }

    res.json({
      success: true,
      imageUrl: pipeline.finalImage,
      kenBurnsEffect,
      pipeline
    });
  } catch (error) {
    logger.error('Error in picture book pipeline:', error);
    res.status(500).json({ error: 'Picture book pipeline failed' });
  }
});

export default router;
