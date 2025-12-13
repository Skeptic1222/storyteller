/**
 * Sound Effects Routes
 * Handles ElevenLabs SFX generation and library access
 */

import { Router } from 'express';
import { pool } from '../database/pool.js';
import { SoundEffectsService, AMBIENT_SFX_LIBRARY, SFX_KEYWORD_MAP } from '../services/soundEffects.js';
import { GENRE_SFX_LIBRARY } from '../services/sfxAgents.js';
import { SFX_LEVELS } from '../services/agents/sfxCoordinator.js';
import { logger } from '../utils/logger.js';

const router = Router();
const sfxService = new SoundEffectsService();

/**
 * GET /api/sfx/library
 * Get the available sound effects library with cached items
 * Supports search, category filtering, and pagination
 */
router.get('/library', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50, include_cached = true } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build the predefined library (organized by category)
    let library = {};
    let libraryFlat = [];

    for (const [cat, effects] of Object.entries(AMBIENT_SFX_LIBRARY)) {
      // Apply category filter
      if (category && cat !== category) continue;

      library[cat] = {};
      for (const [effect, def] of Object.entries(effects)) {
        const sfxKey = `${cat}.${effect}`;
        const name = effect.replace(/_/g, ' ');

        // Apply search filter
        if (search && !name.toLowerCase().includes(search.toLowerCase()) &&
            !def.prompt?.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }

        library[cat][effect] = def;
        libraryFlat.push({
          sfx_key: sfxKey,
          name: name,
          category: cat,
          prompt: def.prompt,
          duration: def.duration,
          loop: def.loop,
          source: 'library'
        });
      }

      // Remove empty categories
      if (Object.keys(library[cat]).length === 0) {
        delete library[cat];
      }
    }

    // Optionally include cached SFX from database
    let cachedSfx = [];
    if (include_cached === 'true' || include_cached === true) {
      try {
        let cacheQuery = `
          SELECT id, prompt_hash, prompt_preview, file_path, duration_seconds,
                 file_size_bytes, access_count, created_at
          FROM sfx_cache
          WHERE file_path IS NOT NULL
        `;
        const queryParams = [];

        if (search) {
          queryParams.push(`%${search}%`);
          cacheQuery += ` AND prompt_preview ILIKE $${queryParams.length}`;
        }

        cacheQuery += ` ORDER BY access_count DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(parseInt(limit), offset);

        const cacheResult = await pool.query(cacheQuery, queryParams);
        cachedSfx = cacheResult.rows.map(row => ({
          sfx_key: `cached.${row.prompt_hash.substring(0, 8)}`,
          name: row.prompt_preview || 'Generated SFX',
          category: 'cached',
          prompt: row.prompt_preview,
          duration: row.duration_seconds,
          file_path: row.file_path,
          access_count: row.access_count,
          created_at: row.created_at,
          source: 'cache'
        }));
      } catch (cacheError) {
        logger.warn('Failed to fetch cached SFX:', cacheError.message);
      }
    }

    // Get total cached count for pagination
    let totalCached = 0;
    try {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM sfx_cache WHERE file_path IS NOT NULL');
      totalCached = parseInt(countResult.rows[0].count) || 0;
    } catch (e) {
      logger.warn('Failed to count cached SFX');
    }

    res.json({
      library,
      libraryFlat,
      cachedSfx,
      keywords: Object.keys(SFX_KEYWORD_MAP),
      categories: Object.keys(AMBIENT_SFX_LIBRARY),
      stats: {
        libraryCount: libraryFlat.length,
        cachedCount: cachedSfx.length,
        totalCached,
        totalCategories: Object.keys(AMBIENT_SFX_LIBRARY).length
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: cachedSfx.length === parseInt(limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching SFX library:', error);
    res.status(500).json({ error: 'Failed to fetch SFX library' });
  }
});

/**
 * POST /api/sfx/generate
 * Generate a custom sound effect from a text prompt
 */
router.post('/generate', async (req, res) => {
  try {
    const { prompt, duration, loop } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const options = {
      duration: Math.min(Math.max(duration || 10, 0.5), 30), // Clamp 0.5-30 seconds
      loop: !!loop
    };

    const audioBuffer = await sfxService.generateSoundEffect(prompt, options);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'X-SFX-Duration': options.duration,
      'X-SFX-Loop': options.loop,
      'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
    });

    res.send(audioBuffer);

  } catch (error) {
    logger.error('Error generating SFX:', error);
    res.status(500).json({ error: error.message || 'Failed to generate sound effect' });
  }
});

/**
 * POST /api/sfx/ambient
 * Get a predefined ambient sound effect by key
 * Checks both AMBIENT_SFX_LIBRARY (action-based categories) and GENRE_SFX_LIBRARY (genre-based categories)
 */
router.post('/ambient', async (req, res) => {
  try {
    const { sfx_key } = req.body;

    if (!sfx_key) {
      return res.status(400).json({ error: 'sfx_key is required' });
    }

    const [category, effect] = sfx_key.split('.');

    // Check AMBIENT_SFX_LIBRARY first (action-based categories: actions, combat, magic, etc.)
    let sfxDef = AMBIENT_SFX_LIBRARY[category]?.[effect];
    let sourceLibrary = 'ambient';

    // If not found, check GENRE_SFX_LIBRARY (genre-based categories: fantasy, scifi, western, etc.)
    if (!sfxDef) {
      sfxDef = GENRE_SFX_LIBRARY[category]?.[effect];
      sourceLibrary = 'genre';
    }

    if (!sfxDef) {
      logger.warn(`[SFX] Unknown SFX key: ${sfx_key} (checked both AMBIENT and GENRE libraries)`);
      return res.status(404).json({ error: `Unknown SFX: ${sfx_key}` });
    }

    logger.info(`[SFX] Found ${sfx_key} in ${sourceLibrary} library`);

    // Generate audio from the sfxDef prompt
    const audioBuffer = await sfxService.generateSoundEffect(sfxDef.prompt, {
      duration: sfxDef.duration,
      loop: sfxDef.loop
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'X-SFX-Key': sfx_key,
      'X-SFX-Duration': sfxDef.duration,
      'X-SFX-Loop': sfxDef.loop,
      'X-SFX-Source': sourceLibrary,
      'Cache-Control': 'public, max-age=86400'
    });

    res.send(audioBuffer);

  } catch (error) {
    logger.error('Error fetching ambient SFX:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch ambient sound' });
  }
});

/**
 * POST /api/sfx/detect
 * Analyze text and detect appropriate sound effects
 */
router.post('/detect', async (req, res) => {
  try {
    const { text, mood, genre } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const detected = sfxService.detectSceneSFX(text, { mood, genre });

    // Enrich with SFX definitions
    const enriched = detected.map(sfx => {
      const [category, effect] = sfx.sfxKey.split('.');
      const sfxDef = AMBIENT_SFX_LIBRARY[category]?.[effect];
      return {
        ...sfx,
        definition: sfxDef || null
      };
    });

    res.json({
      detected: enriched,
      count: enriched.length
    });

  } catch (error) {
    logger.error('Error detecting SFX:', error);
    res.status(500).json({ error: 'Failed to detect sound effects' });
  }
});

/**
 * POST /api/sfx/preview
 * Preview a sound effect (shorter duration for testing)
 */
router.post('/preview', async (req, res) => {
  try {
    const { sfx_key, prompt } = req.body;

    let audioBuffer;

    if (sfx_key) {
      // Generate short version of ambient sound
      const [category, effect] = sfx_key.split('.');
      const sfxDef = AMBIENT_SFX_LIBRARY[category]?.[effect];

      if (!sfxDef) {
        return res.status(404).json({ error: `Unknown SFX: ${sfx_key}` });
      }

      audioBuffer = await sfxService.generateSoundEffect(sfxDef.prompt, {
        duration: Math.min(sfxDef.duration, 5), // Max 5 seconds for preview
        loop: false
      });
    } else if (prompt) {
      audioBuffer = await sfxService.generateSoundEffect(prompt, {
        duration: 5,
        loop: false
      });
    } else {
      return res.status(400).json({ error: 'sfx_key or prompt is required' });
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=3600'
    });

    res.send(audioBuffer);

  } catch (error) {
    logger.error('Error generating SFX preview:', error);
    res.status(500).json({ error: error.message || 'Failed to generate preview' });
  }
});

/**
 * GET /api/sfx/scene/:sceneId
 * Get sound effects for a specific scene
 */
router.get('/scene/:sceneId', async (req, res) => {
  try {
    const { sceneId } = req.params;

    const result = await pool.query(`
      SELECT ss.*, sc.file_path, sc.prompt_preview
      FROM scene_sfx ss
      LEFT JOIN sfx_cache sc ON ss.sfx_cache_id = sc.id
      WHERE ss.scene_id = $1
      ORDER BY ss.start_offset_seconds
    `, [sceneId]);

    res.json({
      scene_id: sceneId,
      sfx: result.rows
    });

  } catch (error) {
    logger.error('Error fetching scene SFX:', error);
    res.status(500).json({ error: 'Failed to fetch scene sound effects' });
  }
});

/**
 * GET /api/sfx/test
 * Test SFX generation (for debugging)
 */
router.get('/test', async (req, res) => {
  try {
    const result = await sfxService.testGeneration();
    res.json(result);
  } catch (error) {
    logger.error('SFX test failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sfx/status
 * Check SFX service status
 */
router.get('/status', async (req, res) => {
  try {
    // Check cache stats
    const cacheStats = await pool.query(`
      SELECT
        COUNT(*) as total_cached,
        SUM(file_size_bytes) as total_bytes,
        SUM(access_count) as total_accesses
      FROM sfx_cache
    `);

    res.json({
      enabled: sfxService.enabled,
      cache: {
        count: parseInt(cacheStats.rows[0].total_cached) || 0,
        size_mb: Math.round((parseInt(cacheStats.rows[0].total_bytes) || 0) / 1024 / 1024 * 100) / 100,
        accesses: parseInt(cacheStats.rows[0].total_accesses) || 0
      },
      library: {
        categories: Object.keys(AMBIENT_SFX_LIBRARY).length,
        effects: Object.values(AMBIENT_SFX_LIBRARY).reduce((sum, cat) => sum + Object.keys(cat).length, 0)
      }
    });

  } catch (error) {
    logger.error('Error fetching SFX status:', error);
    res.status(500).json({ error: 'Failed to fetch SFX status' });
  }
});

/**
 * GET /api/sfx/levels
 * Get available SFX intensity levels
 * Returns the three levels: low (Default), medium (More Sounds), high (Lots of Sounds)
 */
router.get('/levels', (req, res) => {
  try {
    const levels = Object.entries(SFX_LEVELS).map(([key, config]) => ({
      key,
      name: config.name,
      description: config.description,
      targetEffects: config.targetEffects
    }));

    res.json({
      levels,
      default: 'low'
    });
  } catch (error) {
    logger.error('Error fetching SFX levels:', error);
    res.status(500).json({ error: 'Failed to fetch SFX levels' });
  }
});

export default router;
