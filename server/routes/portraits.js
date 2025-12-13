/**
 * Portrait Generation API Routes
 */

import express from 'express';
import {
  generatePortrait,
  generateAndSavePortrait,
  generateStoryCover,
  generateSceneIllustration,
  getPortraitStyles
} from '../services/portraitGenerator.js';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

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
router.post('/generate', async (req, res) => {
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
router.post('/character/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;
    const { sessionId, style = 'fantasy' } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

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
router.post('/session/:sessionId/cover', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { style = 'painterly', quality = 'hd' } = req.body;

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
router.post('/scene', async (req, res) => {
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
 */
router.post('/batch', async (req, res) => {
  try {
    const { sessionId, characterIds, style = 'fantasy' } = req.body;

    if (!sessionId || !characterIds || !Array.isArray(characterIds)) {
      return res.status(400).json({ error: 'Session ID and character IDs required' });
    }

    const results = [];
    const errors = [];

    // Process sequentially to avoid rate limits
    for (const charId of characterIds) {
      try {
        const result = await generateAndSavePortrait(charId, sessionId, { style });
        results.push({
          characterId: charId,
          ...result
        });
      } catch (error) {
        errors.push({
          characterId: charId,
          error: error.message
        });
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.json({
      success: true,
      generated: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error) {
    logger.error('Error in batch portrait generation:', error);
    res.status(500).json({ error: 'Failed to generate portraits' });
  }
});

export default router;
