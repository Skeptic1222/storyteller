/**
 * Story Bible Routes
 * CRUD operations for reusable characters, worlds, lore, and synopsis
 * Supports freeform text input and file uploads (PDF, images, text)
 */

import { Router } from 'express';
import multer from 'multer';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken, requireAuth);
router.use((req, res, next) => {
  if (req.user?.id) {
    if (req.body && typeof req.body === 'object') {
      req.body.user_id = req.user.id;
    }
    if (req.query && typeof req.query === 'object') {
      req.query.user_id = req.user.id;
    }
  }
  next();
});

// Enforce library ownership for any route using :libraryId
router.param('libraryId', async (req, res, next, libraryId) => {
  try {
    if (req.user?.is_admin) {
      return next();
    }

    const result = await pool.query(
      'SELECT id FROM user_libraries WHERE id = $1 AND user_id = $2',
      [libraryId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Library not found or access denied' });
    }

    return next();
  } catch (error) {
    logger.error('[StoryBible] Error verifying library access:', error);
    return res.status(500).json({ error: 'Failed to verify library access' });
  }
});

// Enforce synopsis ownership/access for any route using /synopsis/:id
router.use('/synopsis/:id', async (req, res, next) => {
  try {
    const access = await getSynopsisAccess(req.params.id, req.user);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }
    req.synopsisAccess = access.synopsis;
    return next();
  } catch (error) {
    logger.error('[StoryBible] Error verifying synopsis access:', error);
    return res.status(500).json({ error: 'Failed to verify synopsis access' });
  }
});

// Valid entity types for SQL table name construction
const ENTITY_TABLE_MAP = {
  character: 'library_characters',
  world: 'library_worlds',
  location: 'library_locations',
  item: 'library_items',
  faction: 'library_factions',
  ability: 'library_abilities',
  lore: 'library_lore',
  event: 'library_events',
  synopsis: 'library_synopsis'
};
const VALID_ENTITY_TYPES = Object.keys(ENTITY_TABLE_MAP);

/**
 * Validates entity type to prevent SQL injection via dynamic table names
 * @param {string} entityType - The entity type to validate
 * @returns {string} - The validated table name
 * @throws {ValidationError} - If entity type is invalid
 */
function getValidatedTableName(entityType) {
  const table = ENTITY_TABLE_MAP[entityType];
  if (!table) {
    throw new ValidationError(`Invalid entity type: ${entityType}`);
  }
  return table;
}

async function verifyLibraryOwnership(libraryId, user) {
  if (!libraryId) {
    return { status: 400, error: 'library_id is required' };
  }

  const result = await pool.query(
    'SELECT user_id FROM user_libraries WHERE id = $1',
    [libraryId]
  );

  if (result.rows.length === 0) {
    return { status: 404, error: 'Library not found' };
  }

  const ownerId = result.rows[0].user_id;
  if (!user?.is_admin && ownerId !== user?.id) {
    return { status: 403, error: 'Not authorized to access this library' };
  }

  return null;
}

async function verifyEntityOwnershipByTable(tableName, entityId, user) {
  const result = await pool.query(
    `SELECT ul.user_id
     FROM ${tableName} e
     JOIN user_libraries ul ON ul.id = e.library_id
     WHERE e.id = $1`,
    [entityId]
  );

  if (result.rows.length === 0) {
    return { status: 404, error: 'Entity not found' };
  }

  const ownerId = result.rows[0].user_id;
  if (!user?.is_admin && ownerId !== user?.id) {
    return { status: 403, error: 'Not authorized to access this entity' };
  }

  return null;
}

function createEntityOwnershipMiddleware(tableName, idParam = 'id') {
  return async (req, res, next) => {
    try {
      const entityId = req.params[idParam];
      const ownershipError = await verifyEntityOwnershipByTable(tableName, entityId, req.user);
      if (ownershipError) {
        return res.status(ownershipError.status).json({ error: ownershipError.error });
      }
      return next();
    } catch (error) {
      if (error?.code === '22P02') {
        return res.status(400).json({ error: 'Invalid entity ID format' });
      }
      logger.error('[StoryBible] Error verifying entity access:', error);
      return res.status(500).json({ error: 'Failed to verify entity access' });
    }
  };
}

// Enforce ownership when callers explicitly target a library_id
router.use(async (req, res, next) => {
  try {
    const libraryId = req.body?.library_id || req.query?.library_id;
    if (!libraryId) {
      return next();
    }
    const ownershipError = await verifyLibraryOwnership(libraryId, req.user);
    if (ownershipError) {
      return res.status(ownershipError.status).json({ error: ownershipError.error });
    }
    return next();
  } catch (error) {
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid library_id format' });
    }
    logger.error('[StoryBible] Error verifying requested library_id access:', error);
    return res.status(500).json({ error: 'Failed to verify library access' });
  }
});

// Enforce ownership for entity-by-id routes across CRUD endpoints
router.use('/characters/:id', createEntityOwnershipMiddleware('library_characters'));
router.use('/worlds/:id', createEntityOwnershipMiddleware('library_worlds'));
router.use('/lore/:id', createEntityOwnershipMiddleware('library_lore'));
router.use('/locations/:id', createEntityOwnershipMiddleware('library_locations'));
router.use('/items/:id', createEntityOwnershipMiddleware('library_items'));
router.use('/factions/:id', createEntityOwnershipMiddleware('library_factions'));
router.use('/abilities/:id', createEntityOwnershipMiddleware('library_abilities'));
router.use('/events/:id', createEntityOwnershipMiddleware('library_events'));
router.use('/connections/:id', createEntityOwnershipMiddleware('character_connections'));
router.use('/memberships/:id', createEntityOwnershipMiddleware('character_faction_memberships'));
router.use('/character-items/:id', createEntityOwnershipMiddleware('character_items'));
router.use('/character-abilities/:id', createEntityOwnershipMiddleware('character_abilities'));
router.use('/event-participation/:id', createEntityOwnershipMiddleware('character_event_participation'));

// Enforce ownership for dynamic entity routes
router.use('/versions/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const table = getValidatedTableName(entityType);
    const ownershipError = await verifyEntityOwnershipByTable(table, entityId, req.user);
    if (ownershipError) {
      return res.status(ownershipError.status).json({ error: ownershipError.error });
    }
    return next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid entity ID format' });
    }
    logger.error('[StoryBible] Error verifying version route access:', error);
    return res.status(500).json({ error: 'Failed to verify entity access' });
  }
});

router.use('/refine/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const table = getValidatedTableName(entityType);
    const ownershipError = await verifyEntityOwnershipByTable(table, entityId, req.user);
    if (ownershipError) {
      return res.status(ownershipError.status).json({ error: ownershipError.error });
    }
    return next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid entity ID format' });
    }
    logger.error('[StoryBible] Error verifying refine route access:', error);
    return res.status(500).json({ error: 'Failed to verify entity access' });
  }
});

// Enforce synopsis ownership for non-/synopsis routes that still reference synopsis IDs
router.use('/outline-events/:synopsis_id', async (req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }
  try {
    const access = await getSynopsisAccess(req.params.synopsis_id, req.user);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }
    return next();
  } catch (error) {
    logger.error('[StoryBible] Error verifying outline-events synopsis access:', error);
    return res.status(500).json({ error: 'Failed to verify synopsis access' });
  }
});

router.use('/outline-events/:id', async (req, res, next) => {
  if (req.method !== 'DELETE') {
    return next();
  }
  try {
    const result = await pool.query(
      `SELECT ul.user_id
       FROM outline_chapter_events oce
       JOIN library_synopsis ls ON ls.id = oce.synopsis_id
       JOIN user_libraries ul ON ul.id = ls.library_id
       WHERE oce.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Outline event link not found' });
    }

    if (!req.user?.is_admin && result.rows[0].user_id !== req.user?.id) {
      return res.status(403).json({ error: 'Not authorized to modify this outline event link' });
    }

    return next();
  } catch (error) {
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid outline event link ID format' });
    }
    logger.error('[StoryBible] Error verifying outline event link access:', error);
    return res.status(500).json({ error: 'Failed to verify outline event link access' });
  }
});

router.use('/outline-events', async (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }
  try {
    const synopsisId = req.body?.synopsis_id;
    if (!synopsisId) {
      return next();
    }
    const access = await getSynopsisAccess(synopsisId, req.user);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }
    return next();
  } catch (error) {
    logger.error('[StoryBible] Error verifying synopsis ownership for outline-events mutation:', error);
    return res.status(500).json({ error: 'Failed to verify synopsis access' });
  }
});

/**
 * SECURITY: Whitelist of allowed columns per entity type
 * Prevents SQL injection via dynamic column names
 */
const ALLOWED_COLUMNS = {
  character: ['name', 'display_name', 'role', 'description', 'personality', 'traits_json', 'backstory', 'voice_description', 'gender', 'age_group', 'appearance', 'version', 'updated_at'],
  world: ['name', 'description', 'genre', 'time_period', 'magic_system', 'technology_level', 'society_structure', 'tone', 'themes', 'visual_style', 'version', 'updated_at'],
  location: ['name', 'location_type', 'description', 'atmosphere', 'notable_features', 'history', 'current_state', 'version', 'updated_at'],
  item: ['name', 'display_name', 'item_type', 'subtype', 'description', 'appearance', 'size', 'material', 'condition', 'magical_properties', 'mundane_properties', 'abilities', 'limitations', 'rarity', 'value_description', 'origin', 'creator', 'history', 'version', 'updated_at'],
  faction: ['name', 'faction_type', 'alignment', 'description', 'motto', 'symbol_description', 'leadership_type', 'leader_name', 'hierarchy', 'member_count', 'goals', 'methods', 'values', 'secrets', 'allies', 'enemies', 'headquarters', 'founding', 'history', 'current_state', 'version', 'updated_at'],
  ability: ['name', 'ability_type', 'school', 'description', 'effect', 'visual_description', 'prerequisites', 'requirements', 'limitations', 'cooldown', 'resource_cost', 'level', 'casting_time', 'range', 'components', 'duration', 'concentration', 'ritual', 'damage', 'saving_throw', 'source_type', 'version', 'updated_at'],
  lore: ['entry_type', 'title', 'content', 'tags', 'importance', 'version', 'updated_at'],
  event: ['name', 'description', 'event_type', 'importance', 'characters_involved', 'factions_involved', 'location_name', 'location_notes', 'suggested_timing', 'prerequisites', 'consequences', 'emotional_tone', 'stakes', 'conflict_type', 'key_elements', 'dialogue_hints', 'visual_details', 'notes', 'tags', 'version', 'updated_at'],
  synopsis: ['title', 'logline', 'synopsis', 'genre', 'target_audience', 'themes', 'mood', 'version', 'updated_at']
};

/**
 * SECURITY: Validate column name against whitelist to prevent SQL injection
 * @param {string} entityType - The entity type
 * @param {string} columnName - The column name to validate
 * @returns {boolean} - Whether the column is allowed
 */
function isAllowedColumn(entityType, columnName) {
  const allowed = ALLOWED_COLUMNS[entityType];
  if (!allowed) return false;
  return allowed.includes(columnName);
}

/**
 * SECURITY: Filter columns to only allowed ones for entity type
 * @param {string} entityType - The entity type
 * @param {Array<string>} columns - Array of column names to filter
 * @returns {Array<string>} - Filtered array of allowed columns
 */
function filterAllowedColumns(entityType, columns) {
  const allowed = ALLOWED_COLUMNS[entityType] || [];
  return columns.filter(col => allowed.includes(col));
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/story-bible');
    fs.mkdir(uploadDir, { recursive: true }).then(() => cb(null, uploadDir));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`), false);
    }
  }
});

// Default user ID for unauthenticated requests (guest user)
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

// =============================================================================
// USER LIBRARY (Container)
// =============================================================================

/**
 * GET /api/story-bible
 * Get user's library with counts for each entity type
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const requestedLibraryId = req.query.library_id;

    let library;

    if (requestedLibraryId) {
      // Fetch specific library by ID
      library = await pool.query(
        'SELECT * FROM user_libraries WHERE id = $1 AND user_id = $2',
        [requestedLibraryId, userId]
      );
    }

    // If no specific library requested or not found, get/create default
    if (!library || library.rows.length === 0) {
      library = await pool.query(
        'SELECT * FROM user_libraries WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [userId]
      );
    }

    if (library.rows.length === 0) {
      // Create library for user
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name, description)
        VALUES ($1, 'My Library', 'Your reusable story elements')
        RETURNING *
      `, [userId]);
    }

    const libraryId = library.rows[0].id;

    // Get counts for each type
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM library_characters WHERE library_id = $1) as characters,
        (SELECT COUNT(*) FROM library_worlds WHERE library_id = $1) as worlds,
        (SELECT COUNT(*) FROM library_locations WHERE library_id = $1) as locations,
        (SELECT COUNT(*) FROM library_items WHERE library_id = $1) as items,
        (SELECT COUNT(*) FROM library_factions WHERE library_id = $1) as factions,
        (SELECT COUNT(*) FROM library_lore WHERE library_id = $1) as lore,
        (SELECT COUNT(*) FROM library_synopsis WHERE library_id = $1) as synopsis
    `, [libraryId]);

    res.json({
      library: library.rows[0],
      counts: counts.rows[0]
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching library:', error);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

/**
 * GET /api/story-bible/libraries
 * Get all libraries for user (for Configure page dropdown)
 */
router.get('/libraries', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;

    // Get all libraries for user
    const libraries = await pool.query(`
      SELECT ul.*,
        (SELECT COUNT(*) FROM library_characters WHERE library_id = ul.id) as character_count,
        (SELECT COUNT(*) FROM library_synopsis WHERE library_id = ul.id) as synopsis_count
      FROM user_libraries ul
      WHERE ul.user_id = $1
      ORDER BY ul.updated_at DESC
    `, [userId]);

    res.json({
      libraries: libraries.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching libraries:', error);
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

/**
 * GET /api/story-bible/full-context/:libraryId
 * Get ALL Story Bible data for a library in a single call
 * Used by Advanced Configure Story mode
 */
router.get('/full-context/:libraryId', async (req, res) => {
  try {
    const { libraryId } = req.params;
    const synopsisId = req.query.synopsis_id;

    logger.info(`[StoryBible] Fetching full context for library ${libraryId}`);

    // Fetch all data in parallel
    // ERROR HANDLING FIX: Use Promise.allSettled so one failing query doesn't crash entire endpoint
    const queryResults = await Promise.allSettled([
      synopsisId
        ? pool.query('SELECT * FROM library_synopsis WHERE id = $1', [synopsisId])
        : pool.query('SELECT * FROM library_synopsis WHERE library_id = $1 ORDER BY updated_at DESC LIMIT 1', [libraryId]),
      // DB LIMIT PROTECTION: Reasonable limits for story bible entities
      pool.query('SELECT * FROM library_characters WHERE library_id = $1 ORDER BY role, name LIMIT 200', [libraryId]),
      pool.query('SELECT * FROM library_locations WHERE library_id = $1 ORDER BY name LIMIT 100', [libraryId]),
      pool.query('SELECT * FROM library_items WHERE library_id = $1 ORDER BY name LIMIT 100', [libraryId]),
      pool.query('SELECT * FROM library_factions WHERE library_id = $1 ORDER BY name LIMIT 50', [libraryId]),
      pool.query('SELECT * FROM library_lore WHERE library_id = $1 ORDER BY importance DESC, title LIMIT 100', [libraryId]),
      pool.query('SELECT * FROM library_events WHERE library_id = $1 ORDER BY sort_order, created_at LIMIT 500', [libraryId]),
      pool.query('SELECT * FROM library_worlds WHERE library_id = $1 LIMIT 1', [libraryId])
    ]);

    // Process allSettled results - provide empty results for failed queries
    const queryNames = ['synopsis', 'characters', 'locations', 'items', 'factions', 'lore', 'events', 'world'];
    const emptyResult = { rows: [] };
    const processedResults = queryResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        logger.warn(`[StoryBible] Query for ${queryNames[index]} failed:`, result.reason?.message || result.reason);
        return emptyResult;
      }
    });
    const [synopsisResult, charactersResult, locationsResult, itemsResult, factionsResult, loreResult, eventsResult, worldResult] = processedResults;

    const synopsis = synopsisResult.rows[0] || null;

    // Get beats for the synopsis if it exists
    let beats = [];
    let beatsByChapter = {};
    if (synopsis?.id) {
      // DB LIMIT PROTECTION: Limit chapters to 100 max
      const beatsResult = await pool.query(
        'SELECT * FROM chapter_beats WHERE synopsis_id = $1 ORDER BY chapter_number LIMIT 100',
        [synopsis.id]
      );
      beats = beatsResult.rows;

      // Organize beats by chapter number
      beatsResult.rows.forEach(row => {
        beatsByChapter[row.chapter_number] = typeof row.beats === 'string'
          ? JSON.parse(row.beats)
          : row.beats;
      });
    }

    // Get linked events for each chapter
    let chapterEventLinks = {};
    if (synopsis?.id) {
      const linksResult = await pool.query(`
        SELECT oce.chapter_number, array_agg(oce.event_id) as event_ids
        FROM outline_chapter_events oce
        WHERE oce.synopsis_id = $1
        GROUP BY oce.chapter_number
      `, [synopsis.id]);

      linksResult.rows.forEach(row => {
        chapterEventLinks[row.chapter_number] = row.event_ids;
      });
    }

    const fullContext = {
      library_id: libraryId,
      synopsis: synopsis,
      outline: synopsis?.outline_json || null,
      beats: beatsByChapter,
      beats_raw: beats,
      chapter_event_links: chapterEventLinks,
      characters: charactersResult.rows,
      locations: locationsResult.rows,
      items: itemsResult.rows,
      factions: factionsResult.rows,
      lore: loreResult.rows,
      events: eventsResult.rows,
      world: worldResult.rows[0] || null,
      counts: {
        characters: charactersResult.rows.length,
        locations: locationsResult.rows.length,
        items: itemsResult.rows.length,
        factions: factionsResult.rows.length,
        lore: loreResult.rows.length,
        events: eventsResult.rows.length,
        chapters: synopsis?.outline_json?.chapters?.length || 0,
        beats: beats.length
      }
    };

    logger.info(`[StoryBible] Full context loaded: ${fullContext.counts.characters} chars, ${fullContext.counts.locations} locs, ${fullContext.counts.events} events`);

    res.json(fullContext);

  } catch (error) {
    logger.error('[StoryBible] Error fetching full context:', error);
    res.status(500).json({ error: 'Failed to fetch full context' });
  }
});

/**
 * POST /api/story-bible/ai-detect-settings
 * Analyze full Story Bible context with GPT-5.2 and recommend optimal settings
 * This ensures the AI fully understands the story before generation begins
 */
router.post('/ai-detect-settings', async (req, res) => {
  try {
    const { storyContext } = req.body;

    if (!storyContext) {
      return res.status(400).json({ error: 'storyContext is required' });
    }

    logger.info('[StoryBible] AI-detecting settings from full context...');

    const { generateWithOpenAI } = await import('../services/openai.js');

    // Build a comprehensive analysis prompt
    const synopsis = storyContext.synopsis;
    const characters = storyContext.characters || [];
    const locations = storyContext.locations || [];
    const events = storyContext.events || [];
    const lore = storyContext.lore || [];
    const world = storyContext.world;

    const analysisPrompt = `Analyze this Story Bible and recommend optimal story generation settings.

SYNOPSIS:
Title: ${synopsis?.title || 'Untitled'}
Logline: ${synopsis?.logline || 'N/A'}
Synopsis: ${synopsis?.synopsis || 'N/A'}
Genre: ${synopsis?.genre || 'N/A'}
Mood: ${synopsis?.mood || 'N/A'}
Themes: ${JSON.stringify(synopsis?.themes || [])}

CHARACTERS (${characters.length}):
${characters.slice(0, 15).map(c => `- ${c.name} (${c.role}): ${c.description?.substring(0, 100) || 'N/A'}`).join('\n')}

LOCATIONS (${locations.length}):
${locations.slice(0, 10).map(l => `- ${l.name}: ${l.description?.substring(0, 80) || 'N/A'}`).join('\n')}

EVENTS (${events.length}):
${events.slice(0, 10).map(e => `- ${e.title} (${e.event_type || 'event'}): ${e.description?.substring(0, 80) || 'N/A'}`).join('\n')}

WORLD SETTING:
${world ? `${world.name}: ${world.description?.substring(0, 200) || 'N/A'}` : 'Not specified'}

LORE ENTRIES (${lore.length}):
${lore.slice(0, 5).map(l => `- ${l.title}: ${l.content?.substring(0, 100) || 'N/A'}`).join('\n')}

Based on this analysis, return a JSON object with recommended settings:
{
  "audience": "children" | "general" | "mature",
  "violence_level": 0-100,
  "romance_level": 0-100,
  "scary_level": 0-100,
  "adult_level": 0-100,
  "multi_voice": true | false,
  "sfx_enabled": true | false,
  "sfx_level": "low" | "medium" | "high",
  "mood": "calm" | "exciting" | "scary" | "funny" | "mysterious" | "dramatic",
  "narrator_style": "warm" | "dramatic" | "playful" | "mysterious",
  "story_length": "short" | "medium" | "long",
  "reasoning": ["array of 3-5 reasons for these recommendations"]
}

Consider:
- If there are violent events or horror themes, increase violence/scary levels
- If there are multiple speaking characters, enable multi_voice
- If there are atmospheric locations, enable sound effects
- Match mood to the overall story tone
- Recommend mature audience only if content warrants it`;

    const result = await generateWithOpenAI({
      systemPrompt: 'You are a story configuration expert. Analyze the provided Story Bible and recommend optimal settings for audio story generation. Return only valid JSON.',
      userPrompt: analysisPrompt,
      model: 'gpt-4o', // Use GPT-4o for now, will update to 5.2 when available
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    let settings;
    try {
      const cleanContent = result.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      settings = JSON.parse(cleanContent);
    } catch (e) {
      logger.error('[StoryBible] Failed to parse AI detection result:', e);
      return res.status(500).json({ error: 'Failed to parse AI analysis' });
    }

    logger.info(`[StoryBible] AI-detect complete: audience=${settings.audience}, multi_voice=${settings.multi_voice}, mood=${settings.mood}`);

    res.json({
      success: true,
      settings: {
        audience: settings.audience || 'general',
        multi_voice: settings.multi_voice ?? (characters.length > 1),
        hide_speech_tags: settings.multi_voice ?? (characters.length > 1),
        sfx_enabled: settings.sfx_enabled ?? true,
        sfx_level: settings.sfx_level || 'medium',
        mood: settings.mood || 'exciting',
        narrator_style: settings.narrator_style || 'dramatic',
        story_length: settings.story_length || 'medium',
        intensity: {
          violence: settings.violence_level || 0,
          romance: settings.romance_level || 0,
          scary: settings.scary_level || 0,
          adultContent: settings.adult_level || 0
        }
      },
      reasoning: settings.reasoning || []
    });

  } catch (error) {
    logger.error('[StoryBible] Error in AI-detect settings:', error);
    res.status(500).json({ error: 'AI detection failed: ' + error.message });
  }
});

/**
 * POST /api/story-bible/libraries
 * Create a new library (Story Bible)
 */
router.post('/libraries', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Library name is required' });
    }

    const result = await pool.query(`
      INSERT INTO user_libraries (user_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [userId, name.trim(), description || null]);

    logger.info(`[StoryBible] Created new library: ${result.rows[0].id} - "${name}"`);

    res.json({
      success: true,
      library: result.rows[0]
    });

  } catch (error) {
    logger.error('[StoryBible] Error creating library:', error);
    res.status(500).json({ error: 'Failed to create library' });
  }
});

/**
 * PATCH /api/story-bible/libraries/:id
 * Update a library (rename, update description)
 */
router.patch('/libraries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const { name, description } = req.body;

    // Verify ownership
    const existing = await pool.query(
      'SELECT id FROM user_libraries WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Library not found or access denied' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Library name cannot be empty' });
      }
      updates.push(`name = $${paramCount++}`);
      values.push(name.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(`
      UPDATE user_libraries
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, values);

    logger.info(`[StoryBible] Updated library: ${id}`);

    res.json({
      success: true,
      library: result.rows[0]
    });

  } catch (error) {
    logger.error('[StoryBible] Error updating library:', error);
    res.status(500).json({ error: 'Failed to update library' });
  }
});

/**
 * DELETE /api/story-bible/libraries/:id
 * Delete a library and all its contents
 * If deleting the last library, auto-creates a fresh empty "My Library"
 */
router.delete('/libraries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || DEFAULT_USER_ID;

    // Verify ownership
    const existing = await pool.query(
      'SELECT id, name FROM user_libraries WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Library not found or access denied' });
    }

    // Check if this is the user's only library
    const libraryCount = await pool.query(
      'SELECT COUNT(*) FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    const isLastLibrary = parseInt(libraryCount.rows[0].count) <= 1;

    // Delete library (cascades to all contents via foreign keys)
    await pool.query('DELETE FROM user_libraries WHERE id = $1', [id]);

    logger.info(`[StoryBible] Deleted library: ${id} - "${existing.rows[0].name}"`);

    let newLibrary = null;

    // If that was the last library, auto-create a fresh empty one
    if (isLastLibrary) {
      const createResult = await pool.query(`
        INSERT INTO user_libraries (user_id, name, description)
        VALUES ($1, 'My Library', 'Your reusable story elements')
        RETURNING *
      `, [userId]);

      newLibrary = createResult.rows[0];
      logger.info(`[StoryBible] Auto-created fresh library: ${newLibrary.id} for user ${userId}`);
    }

    res.json({
      success: true,
      message: isLastLibrary ? 'Library deleted and fresh library created' : 'Library deleted',
      newLibrary: newLibrary
    });

  } catch (error) {
    logger.error('[StoryBible] Error deleting library:', error);
    res.status(500).json({ error: 'Failed to delete library' });
  }
});

/**
 * GET /api/story-bible/libraries/:libraryId/synopsis
 * Get all synopses for a library (with outline info)
 */
router.get('/libraries/:libraryId/synopsis', async (req, res) => {
  try {
    const { libraryId } = req.params;

    const synopses = await pool.query(`
      SELECT ls.*,
        CASE WHEN ls.outline_json IS NOT NULL THEN true ELSE false END as has_outline,
        (SELECT COUNT(*) FROM chapter_beats WHERE synopsis_id = ls.id) as beat_count
      FROM library_synopsis ls
      WHERE ls.library_id = $1
      ORDER BY ls.updated_at DESC
    `, [libraryId]);

    res.json({
      synopses: synopses.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching synopses:', error);
    res.status(500).json({ error: 'Failed to fetch synopses' });
  }
});

// =============================================================================
// AI TEXT PARSING & BULK IMPORT
// =============================================================================

/**
 * POST /api/story-bible/parse-text
 * Parse freeform text into structured entity data using AI
 */
router.post('/parse-text', async (req, res) => {
  try {
    const { text, entity_type } = req.body;

    if (!text || !entity_type) {
      return res.status(400).json({ error: 'text and entity_type are required' });
    }

    const validTypes = ['character', 'world', 'location', 'lore', 'synopsis'];
    if (!validTypes.includes(entity_type)) {
      return res.status(400).json({ error: `Invalid entity_type. Must be one of: ${validTypes.join(', ')}` });
    }

    // Import OpenAI
    const { generateWithOpenAI } = await import('../services/openai.js');

    // Build prompt based on entity type
    const systemPrompt = buildParseSystemPrompt(entity_type);
    const userPrompt = `Parse this text and extract ${entity_type} information:\n\n${text}`;

    const result = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      model: 'gpt-4o-mini',
      temperature: 0.3,
      responseFormat: { type: 'json_object' }
    });

    const parsedData = JSON.parse(result.content);

    logger.info(`[StoryBible] Parsed text into ${entity_type}`);
    res.json({
      entity_type,
      parsed: parsedData,
      success: true
    });

  } catch (error) {
    logger.error('[StoryBible] Error parsing text:', error);
    res.status(500).json({ error: 'Failed to parse text' });
  }
});

/**
 * POST /api/story-bible/bulk-import
 * Parse a large text dump and create multiple entities from it
 */
router.post('/bulk-import', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const { text, auto_create } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const libraryId = library.rows[0].id;

    // Import OpenAI
    const { generateWithOpenAI } = await import('../services/openai.js');

    const systemPrompt = `You are a story bible parser. Analyze the provided text and extract ALL story elements into structured data.

Look for:
- Characters (names, descriptions, personalities, roles, relationships, gender, age)
- World/Setting (name, description, genre, time period, technology, magic)
- Locations (names, types, descriptions, atmosphere)
- Lore (history, rules, factions, mythology, items, events)
- Synopsis/Plot (story summary, themes, conflicts)

Be thorough - extract EVERYTHING mentioned, even brief references.
Infer details when reasonable (e.g., if someone is called "King", infer male gender and authority role).

Return JSON:
{
  "characters": [
    {
      "name": "string (required)",
      "display_name": "string or null",
      "gender": "male/female/non-binary/unknown",
      "age_group": "child/teen/young_adult/adult/middle_aged/elderly/unknown",
      "role": "protagonist/antagonist/supporting/minor/mentioned",
      "description": "string",
      "personality": "string",
      "traits": ["array of trait strings"],
      "backstory": "string or null",
      "appearance": "string or null",
      "voice_description": "string describing how they might sound"
    }
  ],
  "world": {
    "name": "string",
    "description": "string",
    "genre": "string",
    "time_period": "string",
    "technology_level": "string or null",
    "magic_system": "string or null",
    "society_structure": "string or null",
    "tone": "string",
    "themes": ["array"],
    "visual_style": "string"
  },
  "locations": [
    {
      "name": "string",
      "location_type": "planet/continent/country/region/city/town/village/building/room/wilderness/other",
      "description": "string",
      "atmosphere": "string",
      "parent_name": "string or null (name of containing location)"
    }
  ],
  "lore": [
    {
      "entry_type": "history/magic/religion/faction/item/creature/event/rule/custom",
      "title": "string",
      "content": "string",
      "importance": 1-100
    }
  ],
  "synopsis": {
    "title": "string (story title if found)",
    "logline": "string (one sentence summary)",
    "synopsis": "string (longer summary)",
    "genre": "string",
    "themes": ["array"],
    "mood": "string"
  },
  "relationships": [
    {
      "character_a": "string (name)",
      "character_b": "string (name)",
      "relationship_type": "married/parent/child/sibling/friend/enemy/rival/mentor/student/lover/colleague/acquaintance",
      "description": "string"
    }
  ]
}

Only include sections that have data. If no world info is found, omit the world object entirely.`;

    const userPrompt = `Parse this text and extract all story elements:\n\n${text}`;

    logger.info(`[StoryBible] Starting bulk import, text length: ${text.length}`);

    const result = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      model: 'gpt-4o',
      temperature: 0.3,
      responseFormat: { type: 'json_object' }
    });

    const parsed = JSON.parse(result.content);

    // If auto_create is true, create the entities in the database
    const created = {
      characters: [],
      world: null,
      locations: [],
      lore: [],
      synopsis: null,
      connections: []
    };

    if (auto_create) {
      // Create world first (if exists)
      if (parsed.world && parsed.world.name) {
        const worldResult = await pool.query(`
          INSERT INTO library_worlds (
            library_id, name, description, genre, time_period, technology_level,
            magic_system, society_structure, tone, themes, visual_style
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `, [
          libraryId,
          parsed.world.name,
          parsed.world.description,
          parsed.world.genre,
          parsed.world.time_period,
          parsed.world.technology_level,
          parsed.world.magic_system,
          parsed.world.society_structure,
          parsed.world.tone,
          parsed.world.themes || [],
          parsed.world.visual_style
        ]);
        created.world = worldResult.rows[0];

        // Link world to library
        await pool.query('UPDATE user_libraries SET world_id = $1 WHERE id = $2', [created.world.id, libraryId]);
      }

      // Create characters
      const characterNameToId = {};
      if (parsed.characters && parsed.characters.length > 0) {
        for (const char of parsed.characters) {
          const charResult = await pool.query(`
            INSERT INTO library_characters (
              library_id, name, display_name, role, description, personality,
              traits_json, backstory, voice_description, gender, age_group, appearance,
              is_deceased, death_context, is_historical
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
          `, [
            libraryId,
            char.name,
            char.display_name,
            char.role || 'supporting',
            char.description,
            char.personality,
            JSON.stringify(char.traits || []),
            char.backstory,
            char.voice_description,
            char.gender,
            char.age_group,
            char.appearance,
            char.is_deceased || false,
            char.death_context || null,
            char.is_historical || false
          ]);
          created.characters.push(charResult.rows[0]);
          characterNameToId[char.name.toLowerCase()] = charResult.rows[0].id;
        }
      }

      // Create locations
      const locationNameToId = {};
      if (parsed.locations && parsed.locations.length > 0) {
        // First pass: create all locations without parents
        for (const loc of parsed.locations) {
          const locResult = await pool.query(`
            INSERT INTO library_locations (
              library_id, world_id, name, location_type, description, atmosphere
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
          `, [
            libraryId,
            created.world?.id || null,
            loc.name,
            loc.location_type,
            loc.description,
            loc.atmosphere
          ]);
          created.locations.push(locResult.rows[0]);
          locationNameToId[loc.name.toLowerCase()] = locResult.rows[0].id;
        }

        // Second pass: link parent locations
        for (const loc of parsed.locations) {
          if (loc.parent_name && locationNameToId[loc.parent_name.toLowerCase()]) {
            const childId = locationNameToId[loc.name.toLowerCase()];
            const parentId = locationNameToId[loc.parent_name.toLowerCase()];
            await pool.query(
              'UPDATE library_locations SET parent_location_id = $1 WHERE id = $2',
              [parentId, childId]
            );
          }
        }
      }

      // Create lore
      if (parsed.lore && parsed.lore.length > 0) {
        for (const loreItem of parsed.lore) {
          const loreResult = await pool.query(`
            INSERT INTO library_lore (
              library_id, world_id, entry_type, title, content, importance
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
          `, [
            libraryId,
            created.world?.id || null,
            loreItem.entry_type,
            loreItem.title,
            loreItem.content,
            loreItem.importance || 50
          ]);
          created.lore.push(loreResult.rows[0]);
        }
      }

      // Create synopsis
      if (parsed.synopsis && parsed.synopsis.title) {
        const synResult = await pool.query(`
          INSERT INTO library_synopsis (
            library_id, world_id, title, logline, synopsis, genre, themes, mood
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          libraryId,
          created.world?.id || null,
          parsed.synopsis.title,
          parsed.synopsis.logline,
          parsed.synopsis.synopsis,
          parsed.synopsis.genre,
          parsed.synopsis.themes || [],
          parsed.synopsis.mood
        ]);
        created.synopsis = synResult.rows[0];
      }

      // Create character connections/relationships
      if (parsed.relationships && parsed.relationships.length > 0) {
        for (const rel of parsed.relationships) {
          const charAId = characterNameToId[rel.character_a?.toLowerCase()];
          const charBId = characterNameToId[rel.character_b?.toLowerCase()];

          if (charAId && charBId && charAId !== charBId) {
            try {
              const connResult = await pool.query(`
                INSERT INTO character_connections (
                  library_id, character_a_id, character_b_id, relationship_type, description
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING *
              `, [libraryId, charAId, charBId, rel.relationship_type, rel.description]);
              created.connections.push(connResult.rows[0]);
            } catch (e) {
              // Skip duplicate connections
              if (e.code !== '23505') throw e;
            }
          }
        }
      }
    }

    logger.info(`[StoryBible] Bulk import complete: ${created.characters.length} characters, ${created.locations.length} locations, ${created.lore.length} lore entries`);

    res.json({
      parsed,
      created: auto_create ? created : null,
      counts: {
        characters: parsed.characters?.length || 0,
        locations: parsed.locations?.length || 0,
        lore: parsed.lore?.length || 0,
        relationships: parsed.relationships?.length || 0,
        has_world: !!parsed.world,
        has_synopsis: !!parsed.synopsis
      },
      success: true
    });

  } catch (error) {
    logger.error('[StoryBible] Error bulk importing:', error);
    res.status(500).json({ error: 'Failed to bulk import' });
  }
});

/**
 * POST /api/story-bible/bulk-import-advanced
 * Multi-agent extraction with 5 passes for comprehensive document analysis
 * Returns a room ID for Socket.IO progress updates
 */
router.post('/bulk-import-advanced', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const libraryId = req.body.library_id;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    // Generate a unique room ID for this extraction
    const roomId = `extraction_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Use provided library_id or get/create one
    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      let library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );

      if (library.rows.length === 0) {
        library = await pool.query(`
          INSERT INTO user_libraries (user_id, name)
          VALUES ($1, 'My Library')
          RETURNING id
        `, [userId]);
      }
      targetLibraryId = library.rows[0].id;
    }

    // Store extraction config for later start (don't start yet - wait for client to join room)
    if (!req.app.locals.extractions) {
      req.app.locals.extractions = new Map();
    }

    // Store pending extraction - will be started when client emits 'start-extraction'
    req.app.locals.extractions.set(roomId, {
      status: 'pending',
      text,
      libraryId: targetLibraryId,
      userId,
      createdAt: new Date(),
      promise: null
    });

    // Clean up old extractions (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of req.app.locals.extractions) {
      if (value.createdAt.getTime() < oneHourAgo) {
        req.app.locals.extractions.delete(key);
      }
    }

    // Return room ID so client can join, then trigger start
    res.json({
      success: true,
      roomId,
      libraryId: targetLibraryId,
      message: 'Join the Socket.IO room, then emit start-extraction to begin.'
    });

  } catch (error) {
    logger.error('[StoryBible] Error preparing advanced import:', error);
    res.status(500).json({ error: 'Failed to prepare extraction' });
  }
});

/**
 * GET /api/story-bible/bulk-import-advanced/:roomId
 * Get extraction results (waits for completion if still running)
 */
router.get('/bulk-import-advanced/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!req.app.locals.extractions?.has(roomId)) {
      return res.status(404).json({ error: 'Extraction not found or expired' });
    }

    const extraction = req.app.locals.extractions.get(roomId);
    const result = await extraction.promise;

    res.json({
      success: result.success,
      data: result.data,
      metadata: result.metadata,
      libraryId: extraction.libraryId
    });

  } catch (error) {
    logger.error('[StoryBible] Error getting extraction results:', error);
    res.status(500).json({ error: 'Failed to get extraction results' });
  }
});

/**
 * POST /api/story-bible/bulk-import-advanced/save
 * Save extraction results to database (after user review/edit)
 */
router.post('/bulk-import-advanced/save', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const { libraryId, data } = req.body;

    if (!libraryId || !data) {
      return res.status(400).json({ error: 'libraryId and data are required' });
    }

    // Verify library belongs to user
    const library = await pool.query(
      'SELECT id, world_id FROM user_libraries WHERE id = $1 AND user_id = $2',
      [libraryId, userId]
    );

    if (library.rows.length === 0) {
      return res.status(403).json({ error: 'Library not found or access denied' });
    }

    const created = {
      characters: [],
      world: null,
      locations: [],
      items: [],
      factions: [],
      lore: [],
      events: [],  // PHASE 3 FIX: Add events tracking
      synopsis: null,
      connections: []
    };

    // Create world if provided
    if (data.world && data.world.name) {
      // Ensure themes is a proper array for PostgreSQL
      const themesArray = Array.isArray(data.world.themes) ? data.world.themes : [];
      const worldResult = await pool.query(`
        INSERT INTO library_worlds (library_id, name, description, genre, time_period,
          technology_level, magic_system, society_structure, tone, themes, visual_style)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        libraryId,
        data.world.name,
        data.world.description,
        data.world.genre,
        data.world.time_period,
        data.world.technology_level,
        data.world.magic_system,
        data.world.society_structure,
        data.world.tone,
        themesArray,  // pg-node handles array conversion automatically
        data.world.visual_style
      ]);
      created.world = worldResult.rows[0];

      // Link world to library
      await pool.query(
        'UPDATE user_libraries SET world_id = $1 WHERE id = $2',
        [created.world.id, libraryId]
      );
    }

    // Create characters with validation
    const characterNameToId = new Map();
    for (const char of (data.characters || [])) {
      try {
        // === PHASE 1 FIX: Validate and correct species/vital status ===
        const textToCheck = `${char.description || ''} ${char.backstory || ''} ${char.vital_status_summary || ''}`.toLowerCase();

        // Species correction - check description for animal indicators
        const animalPatterns = /\b(great dane|pitbull|pit bull|mastiff|retriever|shepherd|hound|canine|dog|cat|horse|owl|wolf|feline)\b/i;
        const animalMatch = textToCheck.match(animalPatterns);
        if (animalMatch && (!char.species || char.species === 'human')) {
          const detectedSpecies = animalMatch[0].toLowerCase().includes('dane') ||
                                  animalMatch[0].toLowerCase().includes('pitbull') ||
                                  animalMatch[0].toLowerCase().includes('pit bull') ||
                                  animalMatch[0].toLowerCase().includes('mastiff') ||
                                  animalMatch[0].toLowerCase().includes('retriever') ||
                                  animalMatch[0].toLowerCase().includes('shepherd') ||
                                  animalMatch[0].toLowerCase().includes('hound') ||
                                  animalMatch[0].toLowerCase().includes('canine') ? 'dog' : animalMatch[0].toLowerCase();
          logger.info(`[StoryBible] Correcting species for ${char.name}: human → ${detectedSpecies}`);
          char.species = detectedSpecies;
          char.is_animal_companion = true;
        }

        // Vital status correction - check for deceased indicators
        const deceasedPatterns = /\b(deceased|died|dead|killed|passed away|fallen|late father|late mother|parents.*deceased)\b/i;
        if (deceasedPatterns.test(textToCheck) && char.is_alive !== false) {
          logger.info(`[StoryBible] Correcting vital status for ${char.name}: alive → deceased`);
          char.is_alive = false;
          char.is_deceased = true;
          if (!char.vital_status_summary) {
            char.vital_status_summary = 'DECEASED - Mentioned as deceased in source material';
          }
        }

        // Ensure is_alive is set correctly based on is_deceased
        if (char.is_deceased === true) {
          char.is_alive = false;
        } else if (char.is_alive === undefined) {
          char.is_alive = true;
        }

        const result = await pool.query(`
          INSERT INTO library_characters (
            library_id, name, display_name, role, description, personality, traits_json, backstory,
            voice_description, gender, age_group, age_specific, appearance, clothing_style, physical_condition,
            species, is_animal_companion, companion_to_character_id,
            is_alive, is_deceased, vital_status_summary, death_details, death_context, is_historical,
            occupation, former_occupations, social_status, education, origin,
            abilities, skills, weaknesses, signature_moves,
            motivations, secrets, internal_conflicts, external_conflicts,
            enemies, allies, romantic_interests, family,
            dialogue_style, first_appearance_context, character_arc, symbolic_role,
            values_json, fears, flaws, strengths, faction_allegiance, confidence, extraction_notes
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21, $22, $23, $24,
            $25, $26, $27, $28, $29,
            $30, $31, $32, $33,
            $34, $35, $36, $37,
            $38, $39, $40, $41,
            $42, $43, $44, $45,
            $46, $47, $48, $49, $50, $51, $52
          )
          RETURNING *
        `, [
          libraryId,
          char.name,
          char.display_name || null,
          char.role || 'supporting',
          char.description || null,
          char.personality || null,
          JSON.stringify(char.traits || char.traits_json || []),
          char.backstory || null,
          char.voice_description || null,
          char.gender || 'unknown',
          char.age_group || 'unknown',
          char.age_specific || null,
          char.appearance || null,
          char.clothing_style || null,
          char.physical_condition || null,
          char.species || 'human',
          char.is_animal_companion || false,
          null, // companion_to_character_id - resolve after all characters created
          char.is_alive !== undefined ? char.is_alive : true,
          char.is_deceased || false,
          char.vital_status_summary || (char.is_deceased ? 'DECEASED' : 'ALIVE'),
          char.death_details ? JSON.stringify(char.death_details) : null,
          char.death_context || null,
          char.is_historical || false,
          char.occupation || null,
          char.former_occupations || null,
          char.social_status || null,
          char.education || null,
          char.origin || null,
          char.abilities || null,
          char.skills || null,
          char.weaknesses || null,
          char.signature_moves || null,
          char.motivations || null,
          char.secrets || null,
          char.internal_conflicts || null,
          char.external_conflicts || null,
          char.enemies || null,
          char.allies || null,
          char.romantic_interests || null,
          char.family || null,  // family is ARRAY type, not JSONB
          char.dialogue_style || null,
          char.first_appearance_context || null,
          char.character_arc || null,
          char.symbolic_role || null,
          char.values_json ? JSON.stringify(char.values_json) : (char.values ? JSON.stringify(char.values) : null),
          char.fears || null,
          char.flaws || null,
          char.strengths || null,
          char.faction_allegiance || null,
          char.confidence || 'medium',
          char.extraction_notes || null
        ]);
        created.characters.push(result.rows[0]);
        characterNameToId.set(char.name?.toLowerCase(), result.rows[0].id);

        // Store companion_to reference for later resolution
        if (char.companion_to) {
          result.rows[0]._companion_to_name = char.companion_to;
        }
      } catch (e) {
        logger.warn(`[StoryBible] Failed to create character ${char.name}:`, e.message);
      }
    }

    // Resolve animal companion references
    for (const savedChar of created.characters) {
      if (savedChar._companion_to_name) {
        const companionToId = characterNameToId.get(savedChar._companion_to_name.toLowerCase());
        if (companionToId) {
          await pool.query(
            'UPDATE library_characters SET companion_to_character_id = $1 WHERE id = $2',
            [companionToId, savedChar.id]
          );
        }
      }
    }

    // Create locations
    const locationNameToId = new Map();
    for (const loc of (data.locations || [])) {
      try {
        const result = await pool.query(`
          INSERT INTO library_locations (library_id, world_id, name, location_type,
            description, atmosphere)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `, [
          libraryId,
          created.world?.id || library.rows[0].world_id,
          loc.name,
          loc.location_type || 'other',
          loc.description,
          loc.atmosphere
        ]);
        created.locations.push(result.rows[0]);
        locationNameToId.set(loc.name?.toLowerCase(), result.rows[0].id);
      } catch (e) {
        logger.warn(`[StoryBible] Failed to create location ${loc.name}:`, e.message);
      }
    }

    // Set parent locations
    for (const loc of (data.locations || [])) {
      if (loc.parent_name) {
        const parentId = locationNameToId.get(loc.parent_name.toLowerCase());
        const childId = locationNameToId.get(loc.name?.toLowerCase());
        if (parentId && childId) {
          await pool.query(
            'UPDATE library_locations SET parent_location_id = $1 WHERE id = $2',
            [parentId, childId]
          );
        }
      }
    }

    // Create items
    const itemNameToId = new Map();
    for (const item of (data.items || [])) {
      try {
        // Look up owner character ID if owner name provided
        let ownerCharId = null;
        if (item.current_owner) {
          ownerCharId = characterNameToId.get(item.current_owner.toLowerCase());
        }
        // Look up location ID if location name provided
        let locId = null;
        if (item.current_location) {
          locId = locationNameToId.get(item.current_location.toLowerCase());
        }

        const result = await pool.query(`
          INSERT INTO library_items (library_id, world_id, name, display_name, item_type, subtype,
            description, appearance, size, material, condition, magical_properties, mundane_properties,
            abilities, limitations, rarity, value_description,
            current_owner, owner_character_id, current_location, location_id,
            origin, creator, history, importance, confidence)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
          RETURNING *
        `, [
          libraryId,
          created.world?.id || library.rows[0].world_id,
          item.name,
          item.display_name,
          item.item_type || 'misc',
          item.subtype,
          item.description,
          item.appearance,
          item.size,
          item.material,
          item.condition,
          item.magical_properties,
          item.mundane_properties,
          item.abilities || [],
          item.limitations || [],
          item.rarity,
          item.value_description,
          item.current_owner,
          ownerCharId,
          item.current_location,
          locId,
          item.origin,
          item.creator,
          item.history,
          item.importance || 50,
          item.confidence || 'medium'
        ]);
        created.items.push(result.rows[0]);
        itemNameToId.set(item.name?.toLowerCase(), result.rows[0].id);
      } catch (e) {
        logger.warn(`[StoryBible] Failed to create item ${item.name}:`, e.message);
      }
    }

    // Create factions
    const factionNameToId = new Map();
    for (const faction of (data.factions || [])) {
      try {
        // Look up leader character ID if provided
        let leaderCharId = null;
        if (faction.leader_name) {
          leaderCharId = characterNameToId.get(faction.leader_name.toLowerCase());
        }
        // Look up headquarters location ID if provided
        let hqLocId = null;
        if (faction.headquarters) {
          hqLocId = locationNameToId.get(faction.headquarters.toLowerCase());
        }

        const result = await pool.query(`
          INSERT INTO library_factions (library_id, world_id, name, faction_type, alignment,
            description, motto, symbol_description, leadership_type, leader_name, leader_character_id,
            hierarchy, member_count, goals, methods, values, secrets,
            allies, enemies, neutral_relations,
            headquarters, headquarters_location_id, territories, resources,
            founding, history, current_state, importance, confidence)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
          RETURNING *
        `, [
          libraryId,
          created.world?.id || library.rows[0].world_id,
          faction.name,
          faction.faction_type || 'guild',
          faction.alignment,
          faction.description,
          faction.motto,
          faction.symbol_description,
          faction.leadership_type,
          faction.leader_name,
          leaderCharId,
          faction.hierarchy,
          faction.member_count,
          faction.goals || [],
          faction.methods || [],
          faction.values || [],
          faction.secrets,
          faction.allies || [],
          faction.enemies || [],
          faction.neutral_relations || [],
          faction.headquarters,
          hqLocId,
          faction.territories || [],
          faction.resources || [],
          faction.founding,
          faction.history,
          faction.current_state,
          faction.importance || 50,
          faction.confidence || 'medium'
        ]);
        created.factions.push(result.rows[0]);
        factionNameToId.set(faction.name?.toLowerCase(), result.rows[0].id);
      } catch (e) {
        logger.warn(`[StoryBible] Failed to create faction ${faction.name}:`, e.message);
      }
    }

    // Create lore entries
    for (const loreEntry of (data.lore || [])) {
      try {
        const result = await pool.query(`
          INSERT INTO library_lore (library_id, world_id, entry_type, title, content, importance)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `, [
          libraryId,
          created.world?.id || library.rows[0].world_id,
          loreEntry.entry_type || 'custom',
          loreEntry.title,
          loreEntry.content,
          loreEntry.importance || 50
        ]);
        created.lore.push(result.rows[0]);
      } catch (e) {
        logger.warn(`[StoryBible] Failed to create lore ${loreEntry.title}:`, e.message);
      }
    }

    // Create synopsis if provided
    // Note: synopsis column is NOT NULL, so we must have actual content
    const synopsisText = data.synopsis?.synopsis?.trim();
    if (synopsisText) {
      try {
        // Prepare themes as PostgreSQL array (not JSON string)
        const themes = data.synopsis.themes || data.world?.themes || [];
        const themesArray = Array.isArray(themes) ? themes : [];

        logger.info(`[StoryBible] Creating synopsis: "${data.synopsis.title || 'Untitled'}" (${synopsisText.length} chars, ${themesArray.length} themes)`);

        // PHASE 4 FIX: Include source_chapters if extracted
        const sourceChapters = data.chapterStructure?.has_explicit_structure ? data.chapterStructure : null;
        if (sourceChapters) {
          logger.info(`[StoryBible] Including source chapter structure: ${sourceChapters.total_chapters} chapters`);
        }

        const result = await pool.query(`
          INSERT INTO library_synopsis (library_id, world_id, title, logline, synopsis,
            genre, themes, mood, source_chapters)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `, [
          libraryId,
          created.world?.id || library.rows[0].world_id,
          data.synopsis.title || 'Untitled Story',
          data.synopsis.logline || null,
          synopsisText,
          data.synopsis.genre || data.world?.genre || null,
          themesArray,  // Pass as JS array - pg driver handles conversion
          data.synopsis.mood || data.world?.tone || null,
          sourceChapters ? JSON.stringify(sourceChapters) : null  // PHASE 4 FIX
        ]);
        created.synopsis = result.rows[0];
        logger.info(`[StoryBible] Synopsis created successfully: ${result.rows[0].id}`);
      } catch (e) {
        logger.error('[StoryBible] Failed to create synopsis - Error:', {
          message: e.message,
          code: e.code,
          detail: e.detail,
          constraint: e.constraint,
          stack: e.stack?.split('\n').slice(0, 3).join(' | ')
        });
      }
    } else {
      logger.info('[StoryBible] No synopsis text to save (synopsis_suggestion may be empty)');
    }

    // === PHASE 2 FIX: Save character connections with ALL fields ===
    // Handle both flat array (data.relationships) and nested structure (data.relationships.character_relationships)
    let relationshipsToSave = [];
    if (Array.isArray(data.relationships)) {
      relationshipsToSave = data.relationships;
    } else if (data.relationships?.character_relationships) {
      relationshipsToSave = data.relationships.character_relationships;
    }

    logger.info(`[StoryBible] Processing ${relationshipsToSave.length} relationships for save`);
    logger.info(`[StoryBible] Character lookup map has ${characterNameToId.size} entries: ${[...characterNameToId.keys()].join(', ')}`);

    for (const rel of relationshipsToSave) {
      const charAId = characterNameToId.get(rel.character_a?.toLowerCase());
      const charBId = characterNameToId.get(rel.character_b?.toLowerCase());

      if (!charAId || !charBId) {
        logger.warn(`[StoryBible] Skipping relationship - character not found: "${rel.character_a}" (${charAId ? 'found' : 'NOT FOUND'}) -> "${rel.character_b}" (${charBId ? 'found' : 'NOT FOUND'})`);
        continue;
      }

      try {
        const result = await pool.query(`
          INSERT INTO character_connections (
            library_id, character_a_id, character_b_id,
            relationship_type, relationship_label, is_directional,
            reverse_relationship_type, description, current_status, dynamics
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (character_a_id, character_b_id) DO UPDATE SET
            relationship_type = EXCLUDED.relationship_type,
            relationship_label = EXCLUDED.relationship_label,
            is_directional = EXCLUDED.is_directional,
            reverse_relationship_type = EXCLUDED.reverse_relationship_type,
            description = EXCLUDED.description,
            current_status = EXCLUDED.current_status,
            dynamics = EXCLUDED.dynamics,
            updated_at = NOW()
          RETURNING *
        `, [
          libraryId,
          charAId,
          charBId,
          rel.relationship_type || 'related',
          rel.relationship_label || `${rel.relationship_type || 'related'} relationship`,
          rel.is_directional || false,
          rel.reverse_relationship_type || null,
          rel.description || '',
          rel.current_status || 'active',
          rel.dynamics || ''
        ]);
        created.connections.push(result.rows[0]);
        logger.debug(`[StoryBible] Saved connection: ${rel.character_a} <-> ${rel.character_b} (${rel.relationship_type})`);
      } catch (e) {
        logger.warn(`[StoryBible] Failed to create connection ${rel.character_a} <-> ${rel.character_b}:`, e.message);
      }
    }

    logger.info(`[StoryBible] Successfully saved ${created.connections.length} character connections`);

    // === PHASE 3 FIX: Save events to library_events ===
    if (data.events?.length > 0) {
      logger.info(`[StoryBible] Processing ${data.events.length} events for save`);

      // Calculate sort_order for each event based on timeline data
      let eventIndex = 0;
      for (const event of data.events) {
        try {
          // Build character_ids array from character names
          const characterIds = [];
          for (const charName of (event.characters_involved || [])) {
            const charId = characterNameToId.get(charName?.toLowerCase());
            if (charId) characterIds.push(charId);
          }

          // SYSTEMIC FIX: Calculate sort_order from timeline data, not insertion order
          // Priority: event_year > explicit_sequence > index position
          let calculatedSortOrder = null;
          if (event.event_year) {
            // Use year * 1000 + sequence to sort by year first, then by sequence within year
            const sequence = event.explicit_sequence || eventIndex;
            calculatedSortOrder = (event.event_year * 1000) + Math.min(sequence, 999);
          } else if (event.explicit_sequence) {
            // If we have explicit sequence but no year, use sequence * 1000
            calculatedSortOrder = event.explicit_sequence * 1000;
          }
          // If no timeline data, sort_order will be set by database trigger (insertion order)

          const result = await pool.query(`
            INSERT INTO library_events (
              library_id, name, description, event_type, importance,
              characters_involved, character_ids, factions_involved,
              location_name, suggested_timing, prerequisites, consequences,
              emotional_tone, stakes, conflict_type,
              key_elements, dialogue_hints, visual_details, notes,
              tags, confidence, extraction_notes,
              event_year, event_date, chronological_position, explicit_sequence, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
            RETURNING *
          `, [
            libraryId,
            event.name,
            event.description || '',
            event.event_type || 'action',
            event.importance || 'major',
            event.characters_involved || [],
            characterIds,
            event.factions_involved || [],
            event.location_name || null,
            event.suggested_timing || null,
            event.prerequisites || [],
            event.consequences || [],
            event.emotional_tone || null,
            event.stakes || null,
            event.conflict_type || null,
            event.key_elements || [],
            event.dialogue_hints || null,
            event.visual_details || null,
            event.notes || null,
            event.tags || [],
            event.confidence || 'medium',
            event.extraction_notes || null,
            // New timeline fields
            event.event_year || null,
            event.event_date || null,
            event.chronological_position || null,
            event.explicit_sequence || null,
            calculatedSortOrder  // Explicit sort_order based on timeline data
          ]);
          created.events.push(result.rows[0]);
          logger.debug(`[StoryBible] Saved event: ${event.name} (sort_order: ${calculatedSortOrder || 'auto'})`);
          eventIndex++;
        } catch (e) {
          logger.warn(`[StoryBible] Failed to create event "${event.name}":`, e.message);
          eventIndex++;
        }
      }
      logger.info(`[StoryBible] Successfully saved ${created.events.length} events`);
    }

    logger.info(`[StoryBible:Advanced] Saved extraction - ${created.characters.length} characters, ${created.locations.length} locations, ${created.items.length} items, ${created.factions.length} factions, ${created.lore.length} lore entries, ${created.events.length} events`);

    res.json({
      success: true,
      created,
      counts: {
        characters: created.characters.length,
        locations: created.locations.length,
        items: created.items.length,
        factions: created.factions.length,
        lore: created.lore.length,
        events: created.events.length,  // PHASE 3 FIX: Include events count
        connections: created.connections.length,
        has_world: !!created.world,
        has_synopsis: !!created.synopsis
      }
    });

  } catch (error) {
    logger.error('[StoryBible] Error saving extraction results:', error);
    res.status(500).json({ error: 'Failed to save extraction results' });
  }
});

/**
 * POST /api/story-bible/upload
 * Upload a file (PDF, image, text) and extract story elements
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const auto_create = req.body.auto_create === 'true';

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    let extractedText = '';
    let imageBase64 = null;

    logger.info(`[StoryBible] Processing uploaded file: ${req.file.originalname} (${mimeType})`);

    // Extract text based on file type
    if (mimeType === 'application/pdf') {
      // Parse PDF
      const pdfParse = (await import('pdf-parse')).default;
      const pdfBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      extractedText = pdfData.text;
      logger.info(`[StoryBible] Extracted ${extractedText.length} chars from PDF`);
    } else if (mimeType.startsWith('text/')) {
      // Read text file
      extractedText = await fs.readFile(filePath, 'utf-8');
      logger.info(`[StoryBible] Read ${extractedText.length} chars from text file`);
    } else if (mimeType.startsWith('image/')) {
      // Read image as base64 for vision API
      const imageBuffer = await fs.readFile(filePath);
      imageBase64 = imageBuffer.toString('base64');
      logger.info(`[StoryBible] Read image for vision analysis`);
    }

    // Clean up uploaded file
    await fs.unlink(filePath).catch(err => {
      // Cleanup failures are non-critical but log for diagnostics
      if (err.code !== 'ENOENT') {
        logger.debug(`[StoryBible] File cleanup warning: ${err.message}`);
      }
    });

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const libraryId = library.rows[0].id;

    // Import OpenAI
    const { generateWithOpenAI, generateWithVision } = await import('../services/openai.js');

    let parsed;

    if (imageBase64) {
      // Use vision API to analyze image
      const visionPrompt = `Analyze this image and extract any character or story information you can infer.

If this is a character sheet, character portrait, or reference image, extract:
- Character name (if visible or can be inferred)
- Physical appearance details
- Gender and age (inferred from appearance)
- Any visible equipment, clothing, or notable features
- Personality hints (from expression, pose, setting)
- Role/class/profession (if visible)
- Any text visible in the image

If this is a location or setting image, describe:
- Location type (city, forest, building interior, etc.)
- Atmosphere and mood
- Notable features
- Time of day/weather if apparent

Return JSON:
{
  "image_type": "character_portrait|character_sheet|location|scene|other",
  "characters": [{
    "name": "string or Unknown",
    "gender": "male/female/non-binary/unknown",
    "age_group": "child/teen/young_adult/adult/middle_aged/elderly/unknown",
    "appearance": "detailed description",
    "personality": "inferred from image",
    "traits": ["array"],
    "role": "inferred role/class",
    "voice_description": "inferred voice characteristics"
  }],
  "locations": [{
    "name": "string or Unnamed Location",
    "location_type": "type",
    "description": "string",
    "atmosphere": "string"
  }],
  "visible_text": "any text visible in image",
  "notes": "any other relevant observations"
}`;

      try {
        // Use OpenAI vision API
        const visionResult = await generateWithVision({
          imageBase64,
          mimeType,
          prompt: visionPrompt,
          model: 'gpt-4o'
        });

        parsed = JSON.parse(visionResult.content);
      } catch (e) {
        logger.error('[StoryBible] Vision API error:', e);
        // Fallback to basic response
        parsed = {
          image_type: 'other',
          characters: [],
          locations: [],
          notes: 'Unable to analyze image'
        };
      }
    } else {
      // Use text-based bulk import logic
      const systemPrompt = `You are a story bible parser. Analyze the provided text and extract ALL story elements into structured data.

Look for:
- Characters (names, descriptions, personalities, roles, relationships, gender, age)
- World/Setting (name, description, genre, time period, technology, magic)
- Locations (names, types, descriptions, atmosphere)
- Lore (history, rules, factions, mythology, items, events)
- Synopsis/Plot (story summary, themes, conflicts)

This may be from a D&D character sheet, story notes, worldbuilding document, or any other source.
Be thorough - extract EVERYTHING mentioned, even brief references.
Infer details when reasonable (e.g., D&D stats suggest combat capability, race suggests appearance).

Return JSON:
{
  "characters": [{
    "name": "string (required)",
    "display_name": "string or null",
    "gender": "male/female/non-binary/unknown",
    "age_group": "child/teen/young_adult/adult/middle_aged/elderly/unknown",
    "role": "protagonist/antagonist/supporting/minor/mentioned",
    "description": "string",
    "personality": "string",
    "traits": ["array of trait strings"],
    "backstory": "string or null",
    "appearance": "string or null",
    "voice_description": "string describing how they might sound"
  }],
  "world": {
    "name": "string",
    "description": "string",
    "genre": "string",
    "time_period": "string"
  },
  "locations": [{
    "name": "string",
    "location_type": "string",
    "description": "string",
    "atmosphere": "string"
  }],
  "lore": [{
    "entry_type": "history/magic/religion/faction/item/creature/event/rule/custom",
    "title": "string",
    "content": "string",
    "importance": 1-100
  }],
  "synopsis": {
    "title": "string (story title if found)",
    "logline": "string",
    "synopsis": "string",
    "genre": "string"
  },
  "relationships": [{
    "character_a": "string (name)",
    "character_b": "string (name)",
    "relationship_type": "string",
    "description": "string"
  }]
}`;

      const result = await generateWithOpenAI({
        systemPrompt,
        userPrompt: `Parse this document and extract all story elements:\n\n${extractedText}`,
        model: 'gpt-4o',
        temperature: 0.3,
        responseFormat: { type: 'json_object' }
      });

      parsed = JSON.parse(result.content);
    }

    // Create entities if auto_create is true
    const created = {
      characters: [],
      world: null,
      locations: [],
      lore: [],
      synopsis: null,
      connections: []
    };

    if (auto_create) {
      const characterNameToId = {};

      // Create characters from parsed data
      if (parsed.characters && parsed.characters.length > 0) {
        for (const char of parsed.characters) {
          if (!char.name || char.name === 'Unknown') continue;

          const charResult = await pool.query(`
            INSERT INTO library_characters (
              library_id, name, display_name, role, description, personality,
              traits_json, backstory, voice_description, gender, age_group, appearance,
              is_deceased, death_context, is_historical
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
          `, [
            libraryId,
            char.name,
            char.display_name || null,
            char.role || 'supporting',
            char.description || null,
            char.personality || null,
            JSON.stringify(char.traits || []),
            char.backstory || null,
            char.voice_description || null,
            char.gender || 'unknown',
            char.age_group || 'adult',
            char.appearance || null,
            char.is_deceased || false,
            char.death_context || null,
            char.is_historical || false
          ]);
          created.characters.push(charResult.rows[0]);
          characterNameToId[char.name.toLowerCase()] = charResult.rows[0].id;
        }
      }

      // Create locations
      if (parsed.locations && parsed.locations.length > 0) {
        for (const loc of parsed.locations) {
          if (!loc.name || loc.name === 'Unnamed Location') continue;

          const locResult = await pool.query(`
            INSERT INTO library_locations (
              library_id, name, location_type, description, atmosphere
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
          `, [
            libraryId,
            loc.name,
            loc.location_type || 'other',
            loc.description || null,
            loc.atmosphere || null
          ]);
          created.locations.push(locResult.rows[0]);
        }
      }
    }

    logger.info(`[StoryBible] File processed: ${created.characters.length} characters, ${created.locations.length} locations`);

    res.json({
      parsed,
      created: auto_create ? created : null,
      counts: {
        characters: parsed.characters?.length || 0,
        locations: parsed.locations?.length || 0,
        lore: parsed.lore?.length || 0
      },
      success: true
    });

  } catch (error) {
    logger.error('[StoryBible] Error processing upload:', error);
    res.status(500).json({ error: 'Failed to process uploaded file' });
  }
});

/**
 * Build system prompt for single entity parsing
 */
function buildParseSystemPrompt(entityType) {
  const prompts = {
    character: `You are a character parser. Extract character information from freeform text.

Return JSON:
{
  "name": "string (required - the character's name)",
  "display_name": "string or null (nickname or title)",
  "gender": "male/female/non-binary/unknown",
  "age_group": "child/teen/young_adult/adult/middle_aged/elderly/unknown",
  "role": "protagonist/antagonist/supporting/minor/mentioned",
  "description": "string (physical and general description)",
  "personality": "string (personality traits and behavior)",
  "traits": ["array of trait keywords"],
  "backstory": "string or null (background history)",
  "appearance": "string (physical appearance details)",
  "voice_description": "string (how their voice sounds for TTS)"
}

Infer missing details reasonably. If someone is "gruff", infer a deeper voice. If they're "young princess", infer female, young_adult, and royalty-related traits.`,

    world: `You are a world-building parser. Extract world/setting information from freeform text.

Return JSON:
{
  "name": "string (world or setting name)",
  "description": "string (overall description)",
  "genre": "string (fantasy, sci-fi, horror, etc.)",
  "time_period": "string (medieval, modern, future, etc.)",
  "technology_level": "string or null",
  "magic_system": "string or null (describe magic if present)",
  "society_structure": "string or null",
  "tone": "string (dark, whimsical, gritty, etc.)",
  "themes": ["array of theme strings"],
  "visual_style": "string (aesthetic description)"
}`,

    location: `You are a location parser. Extract location information from freeform text.

Return JSON:
{
  "name": "string (location name)",
  "location_type": "planet/continent/country/region/city/town/village/building/room/wilderness/other",
  "description": "string (what it looks like)",
  "atmosphere": "string (mood and feeling)",
  "notable_features": [{"name": "string", "description": "string"}],
  "history": "string or null",
  "current_state": "string or null (what's happening there now)"
}`,

    lore: `You are a lore parser. Extract lore/worldbuilding information from freeform text.

Return JSON:
{
  "entry_type": "history/magic/religion/faction/item/creature/event/rule/custom",
  "title": "string (lore entry title)",
  "content": "string (full lore content)",
  "tags": ["array of relevant tags"],
  "importance": 1-100 (how important to the story)
}`,

    synopsis: `You are a story synopsis parser. Extract story/plot information from freeform text.

Return JSON:
{
  "title": "string (story title)",
  "logline": "string (one sentence hook)",
  "synopsis": "string (full story synopsis)",
  "genre": "string",
  "target_audience": "children/general/mature",
  "themes": ["array of themes"],
  "mood": "string (overall story mood)"
}`
  };

  return prompts[entityType] || 'Extract relevant information and return as JSON.';
}

// =============================================================================
// CHARACTERS
// =============================================================================

/**
 * GET /api/story-bible/characters
 * List all characters in user's library
 */
router.get('/characters', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id; // Specific library ID
    const search = req.query.search || '';
    const tags = req.query.tags ? req.query.tags.split(',') : [];

    // Get library ID - use specific library_id if provided, otherwise get first for user
    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ characters: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = `
      SELECT * FROM library_characters
      WHERE library_id = $1
    `;
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (tags.length > 0) {
      query += ` AND tags && $${paramIndex}::text[]`;
      params.push(tags);
      paramIndex++;
    }

    query += ' ORDER BY is_favorite DESC, use_count DESC, updated_at DESC';

    const result = await pool.query(query, params);

    res.json({
      characters: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching characters:', error);
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

/**
 * GET /api/story-bible/characters/:id
 * Get single character details
 */
router.get('/characters/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM library_characters WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ character: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error fetching character:', error);
    res.status(500).json({ error: 'Failed to fetch character' });
  }
});

/**
 * POST /api/story-bible/characters
 * Create a new character
 */
router.post('/characters', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      library_id, name, display_name, role, description, personality,
      traits_json, backstory, voice_description, preferred_voice_id,
      gender, age_group, appearance, portrait_url, portrait_prompt,
      relationships_json, tags, is_deceased, death_context, is_historical
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Get library ID - use specific library_id if provided, otherwise get first for user
    let targetLibraryId = library_id;
    if (!targetLibraryId) {
      let library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );

      if (library.rows.length === 0) {
        library = await pool.query(`
          INSERT INTO user_libraries (user_id, name)
          VALUES ($1, 'My Library')
          RETURNING id
        `, [userId]);
      }
      targetLibraryId = library.rows[0].id;
    }

    const result = await pool.query(`
      INSERT INTO library_characters (
        library_id, name, display_name, role, description, personality,
        traits_json, backstory, voice_description, preferred_voice_id,
        gender, age_group, appearance, portrait_url, portrait_prompt,
        relationships_json, tags, is_deceased, death_context, is_historical
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `, [
      targetLibraryId, name, display_name, role, description, personality,
      JSON.stringify(traits_json || []), backstory, voice_description, preferred_voice_id,
      gender, age_group, appearance, portrait_url, portrait_prompt,
      JSON.stringify(relationships_json || {}), tags || [],
      is_deceased || false, death_context || null, is_historical || false
    ]);

    logger.info(`[StoryBible] Created character: ${name}`);
    res.status(201).json({ character: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating character:', error);
    res.status(500).json({ error: 'Failed to create character' });
  }
});

/**
 * PUT /api/story-bible/characters/:id
 * Update a character
 */
router.put('/characters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, display_name, role, description, personality,
      traits_json, backstory, voice_description, preferred_voice_id,
      gender, age_group, appearance, portrait_url, portrait_prompt,
      relationships_json, tags, is_favorite, is_deceased, death_context, is_historical
    } = req.body;

    // Save version before updating
    await saveEntityVersion('character', id);

    const result = await pool.query(`
      UPDATE library_characters SET
        name = COALESCE($2, name),
        display_name = COALESCE($3, display_name),
        role = COALESCE($4, role),
        description = COALESCE($5, description),
        personality = COALESCE($6, personality),
        traits_json = COALESCE($7, traits_json),
        backstory = COALESCE($8, backstory),
        voice_description = COALESCE($9, voice_description),
        preferred_voice_id = COALESCE($10, preferred_voice_id),
        gender = COALESCE($11, gender),
        age_group = COALESCE($12, age_group),
        appearance = COALESCE($13, appearance),
        portrait_url = COALESCE($14, portrait_url),
        portrait_prompt = COALESCE($15, portrait_prompt),
        relationships_json = COALESCE($16, relationships_json),
        tags = COALESCE($17, tags),
        is_favorite = COALESCE($18, is_favorite),
        is_deceased = COALESCE($19, is_deceased),
        death_context = COALESCE($20, death_context),
        is_historical = COALESCE($21, is_historical),
        version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      id, name, display_name, role, description, personality,
      traits_json ? JSON.stringify(traits_json) : null,
      backstory, voice_description, preferred_voice_id,
      gender, age_group, appearance, portrait_url, portrait_prompt,
      relationships_json ? JSON.stringify(relationships_json) : null,
      tags, is_favorite, is_deceased, death_context, is_historical
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ character: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating character:', error);
    res.status(500).json({ error: 'Failed to update character' });
  }
});

/**
 * DELETE /api/story-bible/characters/:id
 * Delete a character
 */
router.delete('/characters/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM library_characters WHERE id = $1', [id]);

    res.json({ message: 'Character deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting character:', error);
    res.status(500).json({ error: 'Failed to delete character' });
  }
});

// =============================================================================
// WORLDS
// =============================================================================

/**
 * GET /api/story-bible/worlds
 * List all worlds in user's library
 */
router.get('/worlds', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ worlds: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_worlds WHERE library_id = $1';
    const params = [targetLibraryId];

    if (search) {
      query += ' AND (name ILIKE $2 OR description ILIKE $2)';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY is_favorite DESC, use_count DESC, updated_at DESC';

    const result = await pool.query(query, params);

    res.json({
      worlds: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching worlds:', error);
    res.status(500).json({ error: 'Failed to fetch worlds' });
  }
});

/**
 * GET /api/story-bible/worlds/:id
 * Get single world with its lore entries
 */
router.get('/worlds/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const world = await pool.query(
      'SELECT * FROM library_worlds WHERE id = $1',
      [id]
    );

    if (world.rows.length === 0) {
      return res.status(404).json({ error: 'World not found' });
    }

    // Get associated lore - DB LIMIT PROTECTION
    const lore = await pool.query(
      'SELECT * FROM library_lore WHERE world_id = $1 ORDER BY sort_order, title LIMIT 100',
      [id]
    );

    res.json({
      world: world.rows[0],
      lore: lore.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching world:', error);
    res.status(500).json({ error: 'Failed to fetch world' });
  }
});

/**
 * POST /api/story-bible/worlds
 * Create a new world
 */
router.post('/worlds', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      name, description, genre, time_period,
      magic_system, technology_level, society_structure, key_locations,
      tone, themes, visual_style, cover_url, cover_prompt, tags
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const result = await pool.query(`
      INSERT INTO library_worlds (
        library_id, name, description, genre, time_period,
        magic_system, technology_level, society_structure, key_locations,
        tone, themes, visual_style, cover_url, cover_prompt, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      library.rows[0].id, name, description, genre, time_period,
      magic_system, technology_level, society_structure,
      JSON.stringify(key_locations || []),
      tone, themes || [], visual_style, cover_url, cover_prompt, tags || []
    ]);

    logger.info(`[StoryBible] Created world: ${name}`);
    res.status(201).json({ world: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating world:', error);
    res.status(500).json({ error: 'Failed to create world' });
  }
});

/**
 * PUT /api/story-bible/worlds/:id
 * Update a world
 */
router.put('/worlds/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, description, genre, time_period,
      magic_system, technology_level, society_structure, key_locations,
      tone, themes, visual_style, cover_url, cover_prompt, tags, is_favorite
    } = req.body;

    await saveEntityVersion('world', id);

    const result = await pool.query(`
      UPDATE library_worlds SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        genre = COALESCE($4, genre),
        time_period = COALESCE($5, time_period),
        magic_system = COALESCE($6, magic_system),
        technology_level = COALESCE($7, technology_level),
        society_structure = COALESCE($8, society_structure),
        key_locations = COALESCE($9, key_locations),
        tone = COALESCE($10, tone),
        themes = COALESCE($11, themes),
        visual_style = COALESCE($12, visual_style),
        cover_url = COALESCE($13, cover_url),
        cover_prompt = COALESCE($14, cover_prompt),
        tags = COALESCE($15, tags),
        is_favorite = COALESCE($16, is_favorite),
        version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      id, name, description, genre, time_period,
      magic_system, technology_level, society_structure,
      key_locations ? JSON.stringify(key_locations) : null,
      tone, themes, visual_style, cover_url, cover_prompt, tags, is_favorite
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'World not found' });
    }

    res.json({ world: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating world:', error);
    res.status(500).json({ error: 'Failed to update world' });
  }
});

/**
 * DELETE /api/story-bible/worlds/:id
 * Delete a world and optionally its lore
 */
router.delete('/worlds/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteLore = req.query.delete_lore === 'true';

    if (deleteLore) {
      await pool.query('DELETE FROM library_lore WHERE world_id = $1', [id]);
    } else {
      // Unlink lore from this world
      await pool.query('UPDATE library_lore SET world_id = NULL WHERE world_id = $1', [id]);
    }

    await pool.query('DELETE FROM library_worlds WHERE id = $1', [id]);

    res.json({ message: 'World deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting world:', error);
    res.status(500).json({ error: 'Failed to delete world' });
  }
});

// =============================================================================
// LORE
// =============================================================================

/**
 * GET /api/story-bible/lore
 * List all lore entries
 */
router.get('/lore', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const worldId = req.query.world_id;
    const entryType = req.query.type;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ lore: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_lore WHERE library_id = $1';
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (worldId) {
      query += ` AND world_id = $${paramIndex}`;
      params.push(worldId);
      paramIndex++;
    }

    if (entryType) {
      query += ` AND entry_type = $${paramIndex}`;
      params.push(entryType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' ORDER BY sort_order, title';

    const result = await pool.query(query, params);

    res.json({
      lore: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching lore:', error);
    res.status(500).json({ error: 'Failed to fetch lore' });
  }
});

/**
 * GET /api/story-bible/lore/:id
 * Get single lore entry with children
 */
router.get('/lore/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const lore = await pool.query(
      'SELECT * FROM library_lore WHERE id = $1',
      [id]
    );

    if (lore.rows.length === 0) {
      return res.status(404).json({ error: 'Lore entry not found' });
    }

    // Get children - DB LIMIT PROTECTION
    const children = await pool.query(
      'SELECT * FROM library_lore WHERE parent_id = $1 ORDER BY sort_order, title LIMIT 100',
      [id]
    );

    res.json({
      lore: lore.rows[0],
      children: children.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching lore:', error);
    res.status(500).json({ error: 'Failed to fetch lore' });
  }
});

/**
 * POST /api/story-bible/lore
 * Create a new lore entry
 */
router.post('/lore', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      world_id, parent_id, entry_type, title, content,
      tags, importance, sort_order
    } = req.body;

    if (!title || !content || !entry_type) {
      return res.status(400).json({ error: 'Title, content, and entry_type are required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const result = await pool.query(`
      INSERT INTO library_lore (
        library_id, world_id, parent_id, entry_type, title, content,
        tags, importance, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      library.rows[0].id, world_id, parent_id, entry_type, title, content,
      tags || [], importance || 50, sort_order || 0
    ]);

    logger.info(`[StoryBible] Created lore: ${title}`);
    res.status(201).json({ lore: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating lore:', error);
    res.status(500).json({ error: 'Failed to create lore' });
  }
});

/**
 * PUT /api/story-bible/lore/:id
 * Update a lore entry
 */
router.put('/lore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      world_id, parent_id, entry_type, title, content,
      tags, importance, sort_order, is_favorite
    } = req.body;

    await saveEntityVersion('lore', id);

    const result = await pool.query(`
      UPDATE library_lore SET
        world_id = COALESCE($2, world_id),
        parent_id = $3,
        entry_type = COALESCE($4, entry_type),
        title = COALESCE($5, title),
        content = COALESCE($6, content),
        tags = COALESCE($7, tags),
        importance = COALESCE($8, importance),
        sort_order = COALESCE($9, sort_order),
        is_favorite = COALESCE($10, is_favorite),
        version = version + 1
      WHERE id = $1
      RETURNING *
    `, [id, world_id, parent_id, entry_type, title, content, tags, importance, sort_order, is_favorite]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lore entry not found' });
    }

    res.json({ lore: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating lore:', error);
    res.status(500).json({ error: 'Failed to update lore' });
  }
});

/**
 * DELETE /api/story-bible/lore/:id
 * Delete a lore entry
 */
router.delete('/lore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteChildren = req.query.delete_children === 'true';

    if (deleteChildren) {
      // Recursively delete children
      await pool.query(`
        WITH RECURSIVE lore_tree AS (
          SELECT id FROM library_lore WHERE id = $1
          UNION ALL
          SELECT l.id FROM library_lore l
          JOIN lore_tree lt ON l.parent_id = lt.id
        )
        DELETE FROM library_lore WHERE id IN (SELECT id FROM lore_tree)
      `, [id]);
    } else {
      // Orphan children (set parent_id to null)
      await pool.query('UPDATE library_lore SET parent_id = NULL WHERE parent_id = $1', [id]);
      await pool.query('DELETE FROM library_lore WHERE id = $1', [id]);
    }

    res.json({ message: 'Lore entry deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting lore:', error);
    res.status(500).json({ error: 'Failed to delete lore' });
  }
});

// =============================================================================
// SYNOPSIS
// =============================================================================

/**
 * GET /api/story-bible/synopsis
 * List all story outlines
 */
router.get('/synopsis', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ synopsis: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_synopsis WHERE library_id = $1';
    const params = [targetLibraryId];

    if (search) {
      query += ' AND (title ILIKE $2 OR synopsis ILIKE $2 OR logline ILIKE $2)';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY is_favorite DESC, use_count DESC, updated_at DESC';

    const result = await pool.query(query, params);

    res.json({
      synopsis: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching synopsis:', error);
    res.status(500).json({ error: 'Failed to fetch synopsis' });
  }
});

/**
 * GET /api/story-bible/synopsis/:id
 * Get single synopsis with linked characters
 */
router.get('/synopsis/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const synopsis = await pool.query(
      'SELECT * FROM library_synopsis WHERE id = $1',
      [id]
    );

    if (synopsis.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    // Get linked characters
    const characterIds = synopsis.rows[0].character_ids || [];
    let characters = [];
    if (characterIds.length > 0) {
      const charResult = await pool.query(
        'SELECT id, name, role, portrait_url FROM library_characters WHERE id = ANY($1)',
        [characterIds]
      );
      characters = charResult.rows;
    }

    res.json({
      synopsis: synopsis.rows[0],
      characters
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching synopsis:', error);
    res.status(500).json({ error: 'Failed to fetch synopsis' });
  }
});

/**
 * POST /api/story-bible/synopsis
 * Create a new synopsis
 */
router.post('/synopsis', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      library_id, world_id, title, logline, synopsis, genre, target_audience,
      story_format, estimated_length, acts_json, character_ids,
      themes, mood, content_warnings, cover_url, cover_prompt, tags
    } = req.body;

    if (!title || !synopsis) {
      return res.status(400).json({ error: 'Title and synopsis are required' });
    }

    let targetLibraryId = library_id;

    // If no library_id provided, get or create user's default library
    if (!targetLibraryId) {
      let library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1',
        [userId]
      );

      if (library.rows.length === 0) {
        library = await pool.query(`
          INSERT INTO user_libraries (user_id, name)
          VALUES ($1, 'My Library')
          RETURNING id
        `, [userId]);
      }
      targetLibraryId = library.rows[0].id;
    }

    const result = await pool.query(`
      INSERT INTO library_synopsis (
        library_id, world_id, title, logline, synopsis, genre, target_audience,
        story_format, estimated_length, acts_json, character_ids,
        themes, mood, content_warnings, cover_url, cover_prompt, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      targetLibraryId, world_id, title, logline, synopsis, genre, target_audience,
      story_format, estimated_length, JSON.stringify(acts_json || []), character_ids || [],
      themes || [], mood, content_warnings || [], cover_url, cover_prompt, tags || []
    ]);

    logger.info(`[StoryBible] Created synopsis: ${title}`);
    res.status(201).json({ synopsis: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating synopsis:', error);
    res.status(500).json({ error: 'Failed to create synopsis' });
  }
});

/**
 * PUT /api/story-bible/synopsis/:id
 * Update a synopsis
 */
router.put('/synopsis/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      world_id, title, logline, synopsis, genre, target_audience,
      story_format, estimated_length, acts_json, character_ids,
      themes, mood, content_warnings, cover_url, cover_prompt, tags, is_favorite
    } = req.body;

    await saveEntityVersion('synopsis', id);

    const result = await pool.query(`
      UPDATE library_synopsis SET
        world_id = $2,
        title = COALESCE($3, title),
        logline = COALESCE($4, logline),
        synopsis = COALESCE($5, synopsis),
        genre = COALESCE($6, genre),
        target_audience = COALESCE($7, target_audience),
        story_format = COALESCE($8, story_format),
        estimated_length = COALESCE($9, estimated_length),
        acts_json = COALESCE($10, acts_json),
        character_ids = COALESCE($11, character_ids),
        themes = COALESCE($12, themes),
        mood = COALESCE($13, mood),
        content_warnings = COALESCE($14, content_warnings),
        cover_url = COALESCE($15, cover_url),
        cover_prompt = COALESCE($16, cover_prompt),
        tags = COALESCE($17, tags),
        is_favorite = COALESCE($18, is_favorite),
        version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      id, world_id, title, logline, synopsis, genre, target_audience,
      story_format, estimated_length,
      acts_json ? JSON.stringify(acts_json) : null,
      character_ids, themes, mood, content_warnings, cover_url, cover_prompt, tags, is_favorite
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    res.json({ synopsis: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating synopsis:', error);
    res.status(500).json({ error: 'Failed to update synopsis' });
  }
});

/**
 * DELETE /api/story-bible/synopsis/:id
 * Delete a synopsis
 */
router.delete('/synopsis/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM library_synopsis WHERE id = $1', [id]);

    res.json({ message: 'Synopsis deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting synopsis:', error);
    res.status(500).json({ error: 'Failed to delete synopsis' });
  }
});

/**
 * POST /api/story-bible/synopsis/:id/ai-revise
 * Use AI to revise/improve the synopsis text
 */
router.post('/synopsis/:id/ai-revise', async (req, res) => {
  try {
    const { id } = req.params;
    const { instruction } = req.body;

    if (!instruction) {
      return res.status(400).json({ error: 'Instruction is required' });
    }

    // Get current synopsis
    const synopsisResult = await pool.query(
      'SELECT * FROM library_synopsis WHERE id = $1',
      [id]
    );

    if (synopsisResult.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const synopsis = synopsisResult.rows[0];

    // Map instruction shortcuts to full prompts
    const instructionMap = {
      'more_dramatic': 'Make this synopsis more dramatic with higher stakes and more intense conflict.',
      'add_detail': 'Add more specific details, sensory descriptions, and character motivations.',
      'simplify': 'Simplify and streamline this synopsis while keeping the core story intact.',
      'darker_tone': 'Shift the tone to be darker, grittier, and more intense.',
      'lighter_tone': 'Shift the tone to be lighter, more hopeful, and uplifting.',
      'mysterious': 'Add more mystery and intrigue, with hints of hidden secrets and unresolved questions.'
    };

    const fullInstruction = instructionMap[instruction] || instruction;

    // Use OpenAI to revise
    const { generateWithOpenAI } = await import('../services/openai.js');

    const response = await generateWithOpenAI({
      systemPrompt: `You are a story synopsis editor. Your task is to revise the given synopsis based on the user's instruction while maintaining the core story elements. Return ONLY the revised synopsis text, no explanations or commentary.`,
      userPrompt: `Current synopsis:\n\n${synopsis.synopsis}\n\nInstruction: ${fullInstruction}\n\nProvide the revised synopsis:`,
      temperature: 0.8,
      max_tokens: 2000
    });

    const revisedSynopsis = response.content.trim();

    // Update the synopsis in database
    await pool.query(
      'UPDATE library_synopsis SET synopsis = $1, updated_at = NOW() WHERE id = $2',
      [revisedSynopsis, id]
    );

    logger.info(`[StoryBible] AI revised synopsis: ${id}`);
    res.json({ synopsis: revisedSynopsis });

  } catch (error) {
    logger.error('[StoryBible] Error revising synopsis:', error);
    res.status(500).json({ error: 'Failed to revise synopsis' });
  }
});

/**
 * POST /api/story-bible/synopsis/generate-from-world
 * Multi-agent synopsis generation with 10+ passes for comprehensive story development
 * Uses socket.io for real-time progress updates
 */
router.post('/synopsis/generate-from-world', async (req, res) => {
  try {
    const { library_id, library_name, world, characters, locations, items, factions, lore, events } = req.body;

    if (!library_id) {
      return res.status(400).json({ error: 'library_id is required' });
    }

    // Generate room ID for socket progress updates
    const roomId = `synopsis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`[StoryBible] Starting multi-agent synopsis generation for library ${library_id}, room: ${roomId}`);

    // Start generation in background
    setImmediate(async () => {
      try {
        await runMultiAgentSynopsisGeneration({
          libraryId: library_id,
          libraryName: library_name,
          world,
          characters,
          locations,
          items,
          factions,
          lore,
          events,
          roomId
        });
      } catch (error) {
        logger.error(`[StoryBible] Multi-agent synopsis generation failed for room ${roomId}:`, error);
      }
    });

    res.json({
      room_id: roomId,
      library_id: library_id,
      message: 'Synopsis generation started - 10+ agent passes will run'
    });

  } catch (error) {
    logger.error('[StoryBible] Error starting synopsis generation:', error);
    res.status(500).json({ error: 'Failed to start synopsis generation' });
  }
});

/**
 * Multi-Agent Synopsis Generation System
 * Runs 10+ specialized agents for comprehensive story development
 */
async function runMultiAgentSynopsisGeneration(params) {
  const { libraryId, libraryName, world, characters, locations, items, factions, lore, events, roomId } = params;
  const { generateWithOpenAI } = await import('../services/openai.js');
  const { getBroadcastIO } = await import('../socket/state.js');

  const io = getBroadcastIO();
  const storyTitle = libraryName || 'Untitled Story';

  const emit = (event, data) => {
    if (io) {
      io.to(roomId).emit(event, data);
    }
  };

  // Build comprehensive context from all library elements
  const buildContext = () => {
    let ctx = `STORY TITLE: "${storyTitle}"\n\n`;

    if (world) {
      ctx += `=== WORLD SETTING ===\n`;
      ctx += `Name: ${world.name || storyTitle}\n`;
      ctx += `Description: ${world.description || 'Not specified'}\n`;
      ctx += `Genre: ${world.genre || 'Not specified'}\n`;
      ctx += `Time Period: ${world.time_period || 'Not specified'}\n`;
      ctx += `Tone: ${world.tone || 'Not specified'}\n`;
      ctx += `Themes: ${(world.themes || []).join(', ') || 'Not specified'}\n\n`;
    }

    if (characters?.length > 0) {
      ctx += `=== CHARACTERS (${characters.length}) ===\n`;
      characters.forEach(c => {
        ctx += `\n[${c.name}]\n`;
        ctx += `Role: ${c.role || 'Unknown'}\n`;
        ctx += `Description: ${c.description || 'No description'}\n`;
        if (c.backstory) ctx += `Backstory: ${c.backstory}\n`;
        if (c.motivation) ctx += `Motivation: ${c.motivation}\n`;
        if (c.traits_json) {
          const traits = typeof c.traits_json === 'string' ? JSON.parse(c.traits_json) : c.traits_json;
          if (traits?.length) ctx += `Traits: ${traits.join(', ')}\n`;
        }
      });
      ctx += '\n';
    }

    if (locations?.length > 0) {
      ctx += `=== LOCATIONS (${locations.length}) ===\n`;
      locations.forEach(l => {
        ctx += `- ${l.name}: ${l.description || 'No description'}\n`;
      });
      ctx += '\n';
    }

    if (items?.length > 0) {
      ctx += `=== ITEMS & ARTIFACTS (${items.length}) ===\n`;
      items.forEach(i => {
        ctx += `- ${i.name} (${i.item_type || 'item'}): ${i.description || 'No description'}\n`;
      });
      ctx += '\n';
    }

    if (factions?.length > 0) {
      ctx += `=== FACTIONS & ORGANIZATIONS (${factions.length}) ===\n`;
      factions.forEach(f => {
        ctx += `- ${f.name} (${f.faction_type || 'organization'}): ${f.description || 'No description'}\n`;
      });
      ctx += '\n';
    }

    if (lore?.length > 0) {
      ctx += `=== LORE & HISTORY (${lore.length}) ===\n`;
      lore.forEach(l => {
        ctx += `- ${l.title} [${l.category || 'general'}]: ${l.description || 'No description'}\n`;
      });
      ctx += '\n';
    }

    if (events?.length > 0) {
      ctx += `=== PLANNED STORY EVENTS (${events.length}) ===\n`;
      ctx += `(These are scenes/moments that SHOULD happen during the story)\n`;
      events.forEach(e => {
        ctx += `\n[${e.name}] (${e.event_type || 'event'}, ${e.importance || 'supporting'})\n`;
        ctx += `Description: ${e.description || 'No description'}\n`;
        if (e.characters_involved?.length > 0) ctx += `Characters: ${e.characters_involved.join(', ')}\n`;
        if (e.location_name) ctx += `Location: ${e.location_name}\n`;
        if (e.suggested_timing) ctx += `Timing: ${e.suggested_timing}\n`;
        if (e.emotional_tone) ctx += `Tone: ${e.emotional_tone}\n`;
        if (e.stakes) ctx += `Stakes: ${e.stakes}\n`;
        if (e.prerequisites?.length > 0) ctx += `Prerequisites: ${e.prerequisites.join('; ')}\n`;
        if (e.consequences?.length > 0) ctx += `Leads to: ${e.consequences.join('; ')}\n`;
      });
      ctx += '\n';
    }

    return ctx;
  };

  const context = buildContext();
  const agentResults = {};

  try {
    emit('synopsis-progress', { agent: 'coordinator', status: 'starting', message: 'Starting 10-agent synopsis generation...', totalAgents: 10 });

    // ========== AGENT 1: Character Analysis ==========
    emit('synopsis-progress', { agent: 'character-analysis', status: 'running', agentNumber: 1, message: 'Analyzing character dynamics and arcs...' });
    const characterAnalysis = await generateWithOpenAI({
      systemPrompt: `You are a character analysis expert. Analyze the provided characters and determine:
1. Who is the protagonist? Why?
2. Who is the antagonist or opposing force? Why?
3. What are the key character relationships?
4. What potential character arcs exist (growth, fall, redemption, etc.)?
5. What internal conflicts might each major character face?
6. What external conflicts exist between characters?

Provide detailed analysis in JSON format with keys: protagonist, antagonist, relationships, character_arcs, internal_conflicts, external_conflicts`,
      userPrompt: context,
      temperature: 0.7,
      max_tokens: 2000
    });
    agentResults.characterAnalysis = parseJsonSafe(characterAnalysis.content);
    emit('synopsis-progress', { agent: 'character-analysis', status: 'complete', agentNumber: 1 });

    // ========== AGENT 2: World & Setting Analysis ==========
    emit('synopsis-progress', { agent: 'world-analysis', status: 'running', agentNumber: 2, message: 'Analyzing world setting and atmosphere...' });
    const worldAnalysis = await generateWithOpenAI({
      systemPrompt: `You are a world-building expert. Analyze the provided setting and determine:
1. What is the overall atmosphere/mood of this world?
2. What makes this setting unique or interesting?
3. What conflicts or tensions exist in this world?
4. How does the setting shape the characters?
5. What are the rules or limitations of this world?
6. What opportunities for adventure exist?

Provide detailed analysis in JSON format with keys: atmosphere, unique_elements, world_conflicts, setting_impact, world_rules, adventure_opportunities`,
      userPrompt: context,
      temperature: 0.7,
      max_tokens: 2000
    });
    agentResults.worldAnalysis = parseJsonSafe(worldAnalysis.content);
    emit('synopsis-progress', { agent: 'world-analysis', status: 'complete', agentNumber: 2 });

    // ========== AGENT 3: Conflict & Stakes Analysis ==========
    emit('synopsis-progress', { agent: 'conflict-analysis', status: 'running', agentNumber: 3, message: 'Identifying conflicts and stakes...' });
    const conflictAnalysis = await generateWithOpenAI({
      systemPrompt: `You are a story conflict expert. Based on all provided elements, identify:
1. The CENTRAL CONFLICT of the story (what is the main problem/challenge?)
2. SECONDARY CONFLICTS that complicate the story
3. What are the STAKES? What happens if the protagonist fails?
4. What obstacles stand in the way?
5. What is the "ticking clock" or urgency?
6. How do items, factions, and lore contribute to conflict?

Provide analysis in JSON format with keys: central_conflict, secondary_conflicts, stakes, obstacles, urgency, element_contributions`,
      userPrompt: context,
      temperature: 0.7,
      max_tokens: 2000
    });
    agentResults.conflictAnalysis = parseJsonSafe(conflictAnalysis.content);
    emit('synopsis-progress', { agent: 'conflict-analysis', status: 'complete', agentNumber: 3 });

    // ========== AGENT 4: Theme Extraction ==========
    emit('synopsis-progress', { agent: 'theme-extraction', status: 'running', agentNumber: 4, message: 'Extracting themes and meaning...' });
    const themeAnalysis = await generateWithOpenAI({
      systemPrompt: `You are a literary theme expert. Based on the characters, world, and potential conflicts, identify:
1. PRIMARY THEME: What is this story fundamentally about? (e.g., redemption, love, power, identity)
2. SECONDARY THEMES: What other themes are present?
3. How do the characters embody these themes?
4. What MESSAGE might this story convey?
5. What QUESTIONS does this story explore?
6. What makes these themes resonate with audiences?

Provide analysis in JSON format with keys: primary_theme, secondary_themes, character_theme_embodiment, message, questions, resonance`,
      userPrompt: context,
      temperature: 0.7,
      max_tokens: 2000
    });
    agentResults.themeAnalysis = parseJsonSafe(themeAnalysis.content);
    emit('synopsis-progress', { agent: 'theme-extraction', status: 'complete', agentNumber: 4 });

    // ========== AGENT 5: Plot Structure Designer ==========
    emit('synopsis-progress', { agent: 'plot-structure', status: 'running', agentNumber: 5, message: 'Designing plot structure...' });
    const plotStructure = await generateWithOpenAI({
      systemPrompt: `You are a master story architect. Using previous analysis context, design a compelling plot structure:

Previous Analysis:
- Characters: ${JSON.stringify(agentResults.characterAnalysis || {})}
- Conflicts: ${JSON.stringify(agentResults.conflictAnalysis || {})}
- Themes: ${JSON.stringify(agentResults.themeAnalysis || {})}

Design the plot using the three-act structure:
1. ACT ONE (Setup): How does the story begin? What is the inciting incident?
2. ACT TWO (Confrontation): What obstacles arise? What is the midpoint twist?
3. ACT THREE (Resolution): What is the climax? How does it resolve?
4. KEY TURNING POINTS: What moments change everything?
5. SUBPLOTS: What secondary storylines enrich the main plot?

Provide structure in JSON format with keys: act_one, act_two, act_three, turning_points, subplots`,
      userPrompt: context,
      temperature: 0.8,
      max_tokens: 2500
    });
    agentResults.plotStructure = parseJsonSafe(plotStructure.content);
    emit('synopsis-progress', { agent: 'plot-structure', status: 'complete', agentNumber: 5 });

    // ========== AGENT 6: Emotional Journey Mapper ==========
    emit('synopsis-progress', { agent: 'emotional-journey', status: 'running', agentNumber: 6, message: 'Mapping emotional journey...' });
    const emotionalJourney = await generateWithOpenAI({
      systemPrompt: `You are an emotional storytelling expert. Map the emotional journey of this story:
1. What emotions should the READER feel at the beginning?
2. How should emotions shift through the middle?
3. What is the EMOTIONAL CLIMAX?
4. What feeling should readers have at the end?
5. What moments of tension, relief, joy, sadness, and surprise exist?
6. How does the protagonist's emotional state change?

Provide mapping in JSON format with keys: opening_emotions, middle_emotions, emotional_climax, ending_emotions, emotional_beats, protagonist_arc`,
      userPrompt: `Story Context:\n${context}\n\nPlot Structure:\n${JSON.stringify(agentResults.plotStructure || {})}`,
      temperature: 0.7,
      max_tokens: 2000
    });
    agentResults.emotionalJourney = parseJsonSafe(emotionalJourney.content);
    emit('synopsis-progress', { agent: 'emotional-journey', status: 'complete', agentNumber: 6 });

    // ========== AGENT 7: Genre & Tone Specialist ==========
    emit('synopsis-progress', { agent: 'genre-tone', status: 'running', agentNumber: 7, message: 'Defining genre and tone...' });
    const genreTone = await generateWithOpenAI({
      systemPrompt: `You are a genre and tone expert. Define the genre and tone for this story:
1. PRIMARY GENRE: What is the main genre? (Fantasy, Sci-Fi, Romance, Thriller, etc.)
2. SUBGENRES: What subgenres apply? (Dark Fantasy, Space Opera, Romantic Comedy, etc.)
3. TONE: What is the overall tone? (Dark, Light, Humorous, Serious, Gritty, etc.)
4. COMPARABLE WORKS: What published books/movies is this similar to?
5. TARGET AUDIENCE: Who would enjoy this story?
6. GENRE CONVENTIONS: What genre expectations should be met or subverted?

Provide analysis in JSON format with keys: primary_genre, subgenres, tone, comparable_works, target_audience, genre_conventions`,
      userPrompt: context,
      temperature: 0.7,
      max_tokens: 1500
    });
    agentResults.genreTone = parseJsonSafe(genreTone.content);
    emit('synopsis-progress', { agent: 'genre-tone', status: 'complete', agentNumber: 7 });

    // ========== AGENT 8: Synopsis Draft Writer ==========
    emit('synopsis-progress', { agent: 'synopsis-draft', status: 'running', agentNumber: 8, message: 'Writing initial synopsis draft...' });
    const synopsisDraft = await generateWithOpenAI({
      systemPrompt: `You are a professional synopsis writer. Using ALL the analysis provided, write a compelling 3-4 paragraph synopsis for "${storyTitle}".

Analysis Summary:
- Characters: ${JSON.stringify(agentResults.characterAnalysis || {})}
- World: ${JSON.stringify(agentResults.worldAnalysis || {})}
- Conflicts: ${JSON.stringify(agentResults.conflictAnalysis || {})}
- Themes: ${JSON.stringify(agentResults.themeAnalysis || {})}
- Plot: ${JSON.stringify(agentResults.plotStructure || {})}
- Emotions: ${JSON.stringify(agentResults.emotionalJourney || {})}
- Genre: ${JSON.stringify(agentResults.genreTone || {})}

Write a synopsis that:
1. Opens with a hook that grabs attention
2. Introduces the protagonist and their world
3. Presents the central conflict and stakes
4. Hints at the journey without spoiling the ending
5. Conveys the tone and emotional stakes
6. Makes readers WANT to experience this story

Return ONLY the synopsis text (3-4 paragraphs), no JSON formatting.`,
      userPrompt: context,
      temperature: 0.9,
      max_tokens: 2000
    });
    agentResults.synopsisDraft = synopsisDraft.content.trim();
    emit('synopsis-progress', { agent: 'synopsis-draft', status: 'complete', agentNumber: 8 });

    // ========== AGENT 9: Synopsis Refiner ==========
    emit('synopsis-progress', { agent: 'synopsis-refiner', status: 'running', agentNumber: 9, message: 'Refining and polishing synopsis...' });
    const synopsisRefined = await generateWithOpenAI({
      systemPrompt: `You are an expert editor specializing in book synopses. Your job is to refine and improve the draft synopsis.

DRAFT SYNOPSIS:
${agentResults.synopsisDraft}

Improve the synopsis by:
1. Strengthening the opening hook
2. Improving flow and pacing
3. Ensuring clarity and avoiding confusion
4. Adding sensory details and emotional resonance
5. Making character motivations clearer
6. Ensuring stakes are compelling
7. Polishing prose for professional quality

Return the REFINED synopsis (3-4 paragraphs), no JSON formatting. Make it ready for a book jacket.`,
      userPrompt: `Original context:\n${context}`,
      temperature: 0.7,
      max_tokens: 2000
    });
    agentResults.synopsisRefined = synopsisRefined.content.trim();
    emit('synopsis-progress', { agent: 'synopsis-refiner', status: 'complete', agentNumber: 9 });

    // ========== AGENT 10: Logline & Metadata Generator ==========
    emit('synopsis-progress', { agent: 'logline-metadata', status: 'running', agentNumber: 10, message: 'Creating logline and metadata...' });
    const loglineMetadata = await generateWithOpenAI({
      systemPrompt: `You are a marketing copywriter for books. Create compelling marketing metadata for this story.

REFINED SYNOPSIS:
${agentResults.synopsisRefined}

GENRE/TONE: ${JSON.stringify(agentResults.genreTone || {})}
THEMES: ${JSON.stringify(agentResults.themeAnalysis || {})}

Create:
1. LOGLINE: A single compelling sentence (25 words max) that hooks readers
2. TAGLINE: A punchy 5-10 word phrase for marketing
3. GENRE: Single primary genre
4. MOOD: Single word describing the overall mood
5. THEMES: Array of 3-5 key themes (single words or short phrases)
6. KEYWORDS: Array of 5-10 searchable keywords

Return in JSON format with keys: logline, tagline, genre, mood, themes, keywords`,
      userPrompt: context,
      temperature: 0.8,
      max_tokens: 1000
    });
    agentResults.loglineMetadata = parseJsonSafe(loglineMetadata.content);
    emit('synopsis-progress', { agent: 'logline-metadata', status: 'complete', agentNumber: 10 });

    // ========== FINAL CONSOLIDATION ==========
    emit('synopsis-progress', { agent: 'consolidator', status: 'running', message: 'Consolidating final synopsis...' });

    const finalSynopsis = {
      title: storyTitle,
      logline: agentResults.loglineMetadata?.logline || 'A compelling story awaits.',
      tagline: agentResults.loglineMetadata?.tagline || '',
      synopsis: agentResults.synopsisRefined || agentResults.synopsisDraft || '',
      genre: agentResults.loglineMetadata?.genre || agentResults.genreTone?.primary_genre || 'Fiction',
      mood: agentResults.loglineMetadata?.mood || agentResults.genreTone?.tone || 'Engaging',
      themes: agentResults.loglineMetadata?.themes || agentResults.themeAnalysis?.secondary_themes || [],
      keywords: agentResults.loglineMetadata?.keywords || [],
      // Store analysis for later use
      analysis: {
        characters: agentResults.characterAnalysis,
        world: agentResults.worldAnalysis,
        conflicts: agentResults.conflictAnalysis,
        themes: agentResults.themeAnalysis,
        plotStructure: agentResults.plotStructure,
        emotionalJourney: agentResults.emotionalJourney,
        genreTone: agentResults.genreTone
      }
    };

    emit('synopsis-progress', { agent: 'consolidator', status: 'complete' });
    emit('synopsis-complete', finalSynopsis);

    logger.info(`[StoryBible] Multi-agent synopsis generation complete for room ${roomId}`);

  } catch (error) {
    logger.error(`[StoryBible] Multi-agent synopsis error for room ${roomId}:`, error);
    emit('synopsis-error', { message: error.message });
  }
}

/**
 * Safely parse JSON from LLM response
 */
function parseJsonSafe(content) {
  try {
    const cleaned = content.trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '');
    return JSON.parse(cleaned);
  } catch (e) {
    logger.warn('[StoryBible] Failed to parse JSON from LLM:', e.message);
    return { raw: content };
  }
}

/**
 * POST /api/story-bible/libraries/:id/duplicate
 * Duplicate a library with all its content
 */
router.post('/libraries/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const { new_name } = req.body;

    if (!new_name) {
      return res.status(400).json({ error: 'new_name is required' });
    }

    // Get source library
    const sourceLibrary = await pool.query(
      'SELECT * FROM user_libraries WHERE id = $1',
      [id]
    );

    if (sourceLibrary.rows.length === 0) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Start transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create new library
      const newLibraryResult = await client.query(`
        INSERT INTO user_libraries (user_id, name, description, settings_json)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [userId, new_name, sourceLibrary.rows[0].description, sourceLibrary.rows[0].settings_json]);

      const newLibraryId = newLibraryResult.rows[0].id;
      const idMappings = { characters: {}, locations: {}, items: {}, factions: {} };

      // Copy world
      const worldResult = await client.query(
        'SELECT * FROM library_worlds WHERE library_id = $1',
        [id]
      );

      let newWorldId = null;
      if (worldResult.rows.length > 0) {
        const w = worldResult.rows[0];
        const newWorld = await client.query(`
          INSERT INTO library_worlds (library_id, name, description, genre, time_period,
            technology_level, magic_system, society_structure, tone, themes, visual_style)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [newLibraryId, w.name, w.description, w.genre, w.time_period,
            w.technology_level, w.magic_system, w.society_structure, w.tone, w.themes, w.visual_style]);
        newWorldId = newWorld.rows[0].id;

        // Update library with world reference
        await client.query('UPDATE user_libraries SET world_id = $1 WHERE id = $2', [newWorldId, newLibraryId]);
      }

      // Copy characters - DB LIMIT PROTECTION
      const characters = await client.query('SELECT * FROM library_characters WHERE library_id = $1 LIMIT 200', [id]);
      for (const c of characters.rows) {
        const newChar = await client.query(`
          INSERT INTO library_characters (library_id, name, display_name, role, description,
            personality, traits_json, backstory, voice_description, gender, age_group,
            appearance, is_deceased, death_context, is_historical)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING id
        `, [newLibraryId, c.name, c.display_name, c.role, c.description, c.personality,
            c.traits_json, c.backstory, c.voice_description, c.gender, c.age_group,
            c.appearance, c.is_deceased, c.death_context, c.is_historical]);
        idMappings.characters[c.id] = newChar.rows[0].id;
      }

      // Copy locations - DB LIMIT PROTECTION
      const locations = await client.query('SELECT * FROM library_locations WHERE library_id = $1 LIMIT 100', [id]);
      for (const l of locations.rows) {
        const newLoc = await client.query(`
          INSERT INTO library_locations (library_id, world_id, name, location_type,
            description, atmosphere, significance, parent_location_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [newLibraryId, newWorldId, l.name, l.location_type, l.description,
            l.atmosphere, l.significance, null]);  // Skip parent for now
        idMappings.locations[l.id] = newLoc.rows[0].id;
      }

      // Copy items - DB LIMIT PROTECTION
      const items = await client.query('SELECT * FROM library_items WHERE library_id = $1 LIMIT 100', [id]);
      for (const item of items.rows) {
        const newItem = await client.query(`
          INSERT INTO library_items (library_id, world_id, name, item_type, description,
            significance, properties_json, current_owner_id, origin)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [newLibraryId, newWorldId, item.name, item.item_type, item.description,
            item.significance, item.properties_json,
            item.current_owner_id ? idMappings.characters[item.current_owner_id] : null,
            item.origin]);
        idMappings.items[item.id] = newItem.rows[0].id;
      }

      // Copy factions - DB LIMIT PROTECTION
      const factions = await client.query('SELECT * FROM library_factions WHERE library_id = $1 LIMIT 50', [id]);
      for (const f of factions.rows) {
        const newFaction = await client.query(`
          INSERT INTO library_factions (library_id, world_id, name, faction_type, description,
            goals, values_beliefs, structure, territory, relations_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [newLibraryId, newWorldId, f.name, f.faction_type, f.description,
            f.goals, f.values_beliefs, f.structure, f.territory, f.relations_json]);
        idMappings.factions[f.id] = newFaction.rows[0].id;
      }

      // Copy lore - DB LIMIT PROTECTION
      const lore = await client.query('SELECT * FROM library_lore WHERE library_id = $1 LIMIT 100', [id]);
      for (const l of lore.rows) {
        await client.query(`
          INSERT INTO library_lore (library_id, world_id, entry_type, title, content, importance)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [newLibraryId, newWorldId, l.entry_type, l.title, l.content, l.importance]);
      }

      // Copy synopsis (only one)
      const synopsis = await client.query('SELECT * FROM library_synopsis WHERE library_id = $1 LIMIT 1', [id]);
      if (synopsis.rows.length > 0) {
        const s = synopsis.rows[0];
        await client.query(`
          INSERT INTO library_synopsis (library_id, world_id, title, logline, synopsis,
            genre, target_audience, story_format, estimated_length, acts_json,
            themes, mood, content_warnings, outline_json, is_outline_generated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [newLibraryId, newWorldId, s.title, s.logline, s.synopsis,
            s.genre, s.target_audience, s.story_format, s.estimated_length, s.acts_json,
            s.themes, s.mood, s.content_warnings, s.outline_json, s.is_outline_generated]);
      }

      await client.query('COMMIT');

      logger.info(`[StoryBible] Duplicated library ${id} to ${newLibraryId} as "${new_name}"`);
      res.json({ library: newLibraryResult.rows[0] });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('[StoryBible] Error duplicating library:', error);
    res.status(500).json({ error: 'Failed to duplicate library' });
  }
});

// =============================================================================
// VERSION HISTORY
// =============================================================================

/**
 * GET /api/story-bible/versions/:entityType/:entityId
 * Get version history for an entity
 */
router.get('/versions/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    // DB LIMIT PROTECTION: Limit version history to 50 most recent
    const result = await pool.query(`
      SELECT * FROM library_entity_versions
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY version_number DESC
      LIMIT 50
    `, [entityType, entityId]);

    res.json({ versions: result.rows });

  } catch (error) {
    logger.error('[StoryBible] Error fetching versions:', error);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

/**
 * POST /api/story-bible/versions/:entityType/:entityId/restore/:versionNumber
 * Restore an entity to a previous version
 */
router.post('/versions/:entityType/:entityId/restore/:versionNumber', async (req, res) => {
  try {
    const { entityType, entityId, versionNumber } = req.params;

    // Get the version
    const version = await pool.query(`
      SELECT * FROM library_entity_versions
      WHERE entity_type = $1 AND entity_id = $2 AND version_number = $3
    `, [entityType, entityId, versionNumber]);

    if (version.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const data = version.rows[0].data_json;
    const table = getValidatedTableName(entityType);

    // Save current version before restoring
    await saveEntityVersion(entityType, entityId, `Restored to version ${versionNumber}`);

    // SECURITY FIX: Build update query from data_json using column whitelist
    // Filter columns against whitelist to prevent SQL injection via malicious column names
    const rawColumns = Object.keys(data).filter(k => k !== 'id' && k !== 'library_id' && k !== 'created_at' && k !== 'version' && k !== 'updated_at');
    const columns = filterAllowedColumns(entityType, rawColumns);

    if (columns.length === 0) {
      return res.status(400).json({ error: 'No valid columns to restore' });
    }

    const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
    const values = columns.map(col => data[col]);

    await pool.query(
      `UPDATE ${table} SET ${setClause}, version = version + 1, updated_at = NOW() WHERE id = $1`,
      [entityId, ...values]
    );

    res.json({ message: 'Entity restored' });

  } catch (error) {
    logger.error('[StoryBible] Error restoring version:', error);
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

// =============================================================================
// LOCATIONS
// =============================================================================

/**
 * GET /api/story-bible/locations
 * List all locations in user's library
 */
router.get('/locations', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const worldId = req.query.world_id;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ locations: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_locations WHERE library_id = $1';
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (worldId) {
      query += ` AND world_id = $${paramIndex}`;
      params.push(worldId);
      paramIndex++;
    }

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' ORDER BY location_type, name';

    const result = await pool.query(query, params);

    res.json({
      locations: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

/**
 * GET /api/story-bible/locations/:id
 * Get single location with children
 */
router.get('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const location = await pool.query(
      'SELECT * FROM library_locations WHERE id = $1',
      [id]
    );

    if (location.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Get child locations - DB LIMIT PROTECTION
    const children = await pool.query(
      'SELECT * FROM library_locations WHERE parent_location_id = $1 ORDER BY name LIMIT 50',
      [id]
    );

    res.json({
      location: location.rows[0],
      children: children.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching location:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

/**
 * POST /api/story-bible/locations
 * Create a new location
 */
router.post('/locations', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      world_id, parent_location_id, name, location_type, description,
      atmosphere, notable_features, history, current_state,
      image_url, image_prompt, tags, importance
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const result = await pool.query(`
      INSERT INTO library_locations (
        library_id, world_id, parent_location_id, name, location_type, description,
        atmosphere, notable_features, history, current_state,
        image_url, image_prompt, tags, importance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      library.rows[0].id, world_id, parent_location_id, name, location_type, description,
      atmosphere, JSON.stringify(notable_features || []), history, current_state,
      image_url, image_prompt, tags || [], importance || 50
    ]);

    logger.info(`[StoryBible] Created location: ${name}`);
    res.status(201).json({ location: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

/**
 * PUT /api/story-bible/locations/:id
 * Update a location
 */
router.put('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      world_id, parent_location_id, name, location_type, description,
      atmosphere, notable_features, history, current_state,
      image_url, image_prompt, tags, importance, is_favorite
    } = req.body;

    await saveEntityVersion('location', id);

    const result = await pool.query(`
      UPDATE library_locations SET
        world_id = COALESCE($2, world_id),
        parent_location_id = $3,
        name = COALESCE($4, name),
        location_type = COALESCE($5, location_type),
        description = COALESCE($6, description),
        atmosphere = COALESCE($7, atmosphere),
        notable_features = COALESCE($8, notable_features),
        history = COALESCE($9, history),
        current_state = COALESCE($10, current_state),
        image_url = COALESCE($11, image_url),
        image_prompt = COALESCE($12, image_prompt),
        tags = COALESCE($13, tags),
        importance = COALESCE($14, importance),
        is_favorite = COALESCE($15, is_favorite),
        version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      id, world_id, parent_location_id, name, location_type, description,
      atmosphere, notable_features ? JSON.stringify(notable_features) : null,
      history, current_state, image_url, image_prompt, tags, importance, is_favorite
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({ location: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * DELETE /api/story-bible/locations/:id
 * Delete a location
 */
router.delete('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Orphan child locations
    await pool.query('UPDATE library_locations SET parent_location_id = NULL WHERE parent_location_id = $1', [id]);
    await pool.query('DELETE FROM library_locations WHERE id = $1', [id]);

    res.json({ message: 'Location deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// =============================================================================
// ITEMS (Objects, Vehicles, Weapons, Artifacts)
// =============================================================================

/**
 * GET /api/story-bible/items
 * List all items in user's library
 */
router.get('/items', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const itemType = req.query.item_type;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ items: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_items WHERE library_id = $1';
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (itemType) {
      query += ` AND item_type = $${paramIndex}`;
      params.push(itemType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' ORDER BY item_type, importance DESC, name';

    const result = await pool.query(query, params);

    res.json({
      items: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

/**
 * GET /api/story-bible/items/:id
 * Get single item with related data
 */
router.get('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const item = await pool.query(
      'SELECT * FROM library_items WHERE id = $1',
      [id]
    );

    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get character associations
    const characterLinks = await pool.query(`
      SELECT ci.*, c.name as character_name
      FROM character_items ci
      JOIN library_characters c ON c.id = ci.character_id
      WHERE ci.item_id = $1
    `, [id]);

    res.json({
      item: item.rows[0],
      character_associations: characterLinks.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching item:', error);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

/**
 * POST /api/story-bible/items
 * Create a new item
 */
router.post('/items', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      world_id, name, display_name, item_type, subtype, description, appearance,
      size, material, condition, magical_properties, mundane_properties,
      abilities, limitations, rarity, value_description,
      current_owner, owner_character_id, current_location, location_id,
      origin, creator, history, stats_json, attunement_required,
      attunement_requirements, charges, recharge_condition,
      image_url, image_prompt, tags, importance
    } = req.body;

    if (!name || !item_type) {
      return res.status(400).json({ error: 'Name and item_type are required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const result = await pool.query(`
      INSERT INTO library_items (
        library_id, world_id, name, display_name, item_type, subtype, description, appearance,
        size, material, condition, magical_properties, mundane_properties,
        abilities, limitations, rarity, value_description,
        current_owner, owner_character_id, current_location, location_id,
        origin, creator, history, stats_json, attunement_required,
        attunement_requirements, charges, recharge_condition,
        image_url, image_prompt, tags, importance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
      RETURNING *
    `, [
      library.rows[0].id, world_id, name, display_name, item_type, subtype, description, appearance,
      size, material, condition, magical_properties, mundane_properties,
      abilities || [], limitations || [], rarity, value_description,
      current_owner, owner_character_id, current_location, location_id,
      origin, creator, history, stats_json ? JSON.stringify(stats_json) : null, attunement_required || false,
      attunement_requirements, charges, recharge_condition,
      image_url, image_prompt, tags || [], importance || 50
    ]);

    logger.info(`[StoryBible] Created item: ${name} (${item_type})`);
    res.status(201).json({ item: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating item:', error);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

/**
 * PUT /api/story-bible/items/:id
 * Update an item
 */
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      world_id, name, display_name, item_type, subtype, description, appearance,
      size, material, condition, magical_properties, mundane_properties,
      abilities, limitations, rarity, value_description,
      current_owner, owner_character_id, current_location, location_id,
      origin, creator, history, stats_json, attunement_required,
      attunement_requirements, charges, recharge_condition,
      image_url, image_prompt, tags, importance, is_favorite
    } = req.body;

    await saveEntityVersion('item', id);

    const result = await pool.query(`
      UPDATE library_items SET
        world_id = COALESCE($2, world_id),
        name = COALESCE($3, name),
        display_name = COALESCE($4, display_name),
        item_type = COALESCE($5, item_type),
        subtype = COALESCE($6, subtype),
        description = COALESCE($7, description),
        appearance = COALESCE($8, appearance),
        size = COALESCE($9, size),
        material = COALESCE($10, material),
        condition = COALESCE($11, condition),
        magical_properties = COALESCE($12, magical_properties),
        mundane_properties = COALESCE($13, mundane_properties),
        abilities = COALESCE($14, abilities),
        limitations = COALESCE($15, limitations),
        rarity = COALESCE($16, rarity),
        value_description = COALESCE($17, value_description),
        current_owner = COALESCE($18, current_owner),
        owner_character_id = $19,
        current_location = COALESCE($20, current_location),
        location_id = $21,
        origin = COALESCE($22, origin),
        creator = COALESCE($23, creator),
        history = COALESCE($24, history),
        stats_json = COALESCE($25, stats_json),
        attunement_required = COALESCE($26, attunement_required),
        attunement_requirements = COALESCE($27, attunement_requirements),
        charges = COALESCE($28, charges),
        recharge_condition = COALESCE($29, recharge_condition),
        image_url = COALESCE($30, image_url),
        image_prompt = COALESCE($31, image_prompt),
        tags = COALESCE($32, tags),
        importance = COALESCE($33, importance),
        is_favorite = COALESCE($34, is_favorite),
        version = version + 1,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [
      id, world_id, name, display_name, item_type, subtype, description, appearance,
      size, material, condition, magical_properties, mundane_properties,
      abilities, limitations, rarity, value_description,
      current_owner, owner_character_id, current_location, location_id,
      origin, creator, history, stats_json ? JSON.stringify(stats_json) : null,
      attunement_required, attunement_requirements, charges, recharge_condition,
      image_url, image_prompt, tags, importance, is_favorite
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ item: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

/**
 * DELETE /api/story-bible/items/:id
 * Delete an item
 */
router.delete('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Remove character associations
    await pool.query('DELETE FROM character_items WHERE item_id = $1', [id]);
    await pool.query('DELETE FROM library_items WHERE id = $1', [id]);

    res.json({ message: 'Item deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// =============================================================================
// FACTIONS (Organizations, Groups, Guilds)
// =============================================================================

/**
 * GET /api/story-bible/factions
 * List all factions in user's library
 */
router.get('/factions', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const factionType = req.query.faction_type;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ factions: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_factions WHERE library_id = $1';
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (factionType) {
      query += ` AND faction_type = $${paramIndex}`;
      params.push(factionType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' ORDER BY faction_type, importance DESC, name';

    const result = await pool.query(query, params);

    res.json({
      factions: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching factions:', error);
    res.status(500).json({ error: 'Failed to fetch factions' });
  }
});

/**
 * GET /api/story-bible/factions/:id
 * Get single faction with members and relationships
 */
router.get('/factions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const faction = await pool.query(
      'SELECT * FROM library_factions WHERE id = $1',
      [id]
    );

    if (faction.rows.length === 0) {
      return res.status(404).json({ error: 'Faction not found' });
    }

    // Get members - DB LIMIT PROTECTION
    const members = await pool.query(`
      SELECT cfm.*, c.name as character_name, c.role as character_role
      FROM character_faction_memberships cfm
      JOIN library_characters c ON c.id = cfm.character_id
      WHERE cfm.faction_id = $1
      ORDER BY cfm.rank, c.name
      LIMIT 100
    `, [id]);

    // Get child factions - DB LIMIT PROTECTION
    const children = await pool.query(
      'SELECT * FROM library_factions WHERE parent_faction_id = $1 ORDER BY name LIMIT 50',
      [id]
    );

    res.json({
      faction: faction.rows[0],
      members: members.rows,
      sub_factions: children.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching faction:', error);
    res.status(500).json({ error: 'Failed to fetch faction' });
  }
});

/**
 * POST /api/story-bible/factions
 * Create a new faction
 */
router.post('/factions', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      world_id, parent_faction_id, name, faction_type, alignment, description,
      motto, symbol_description, leadership_type, leader_name, leader_character_id,
      hierarchy, member_count, goals, methods, values, secrets,
      allies, enemies, neutral_relations,
      headquarters, headquarters_location_id, territories, resources,
      founding, history, current_state,
      symbol_url, symbol_prompt, tags, importance
    } = req.body;

    if (!name || !faction_type) {
      return res.status(400).json({ error: 'Name and faction_type are required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const result = await pool.query(`
      INSERT INTO library_factions (
        library_id, world_id, parent_faction_id, name, faction_type, alignment, description,
        motto, symbol_description, leadership_type, leader_name, leader_character_id,
        hierarchy, member_count, goals, methods, values, secrets,
        allies, enemies, neutral_relations,
        headquarters, headquarters_location_id, territories, resources,
        founding, history, current_state,
        symbol_url, symbol_prompt, tags, importance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
      RETURNING *
    `, [
      library.rows[0].id, world_id, parent_faction_id, name, faction_type, alignment, description,
      motto, symbol_description, leadership_type, leader_name, leader_character_id,
      hierarchy, member_count, goals || [], methods || [], values || [], secrets,
      allies || [], enemies || [], neutral_relations || [],
      headquarters, headquarters_location_id, territories || [], resources || [],
      founding, history, current_state,
      symbol_url, symbol_prompt, tags || [], importance || 50
    ]);

    logger.info(`[StoryBible] Created faction: ${name} (${faction_type})`);
    res.status(201).json({ faction: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating faction:', error);
    res.status(500).json({ error: 'Failed to create faction' });
  }
});

/**
 * PUT /api/story-bible/factions/:id
 * Update a faction
 */
router.put('/factions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      world_id, parent_faction_id, name, faction_type, alignment, description,
      motto, symbol_description, leadership_type, leader_name, leader_character_id,
      hierarchy, member_count, goals, methods, values, secrets,
      allies, enemies, neutral_relations,
      headquarters, headquarters_location_id, territories, resources,
      founding, history, current_state,
      symbol_url, symbol_prompt, tags, importance, is_favorite
    } = req.body;

    await saveEntityVersion('faction', id);

    const result = await pool.query(`
      UPDATE library_factions SET
        world_id = COALESCE($2, world_id),
        parent_faction_id = $3,
        name = COALESCE($4, name),
        faction_type = COALESCE($5, faction_type),
        alignment = COALESCE($6, alignment),
        description = COALESCE($7, description),
        motto = COALESCE($8, motto),
        symbol_description = COALESCE($9, symbol_description),
        leadership_type = COALESCE($10, leadership_type),
        leader_name = COALESCE($11, leader_name),
        leader_character_id = $12,
        hierarchy = COALESCE($13, hierarchy),
        member_count = COALESCE($14, member_count),
        goals = COALESCE($15, goals),
        methods = COALESCE($16, methods),
        values = COALESCE($17, values),
        secrets = COALESCE($18, secrets),
        allies = COALESCE($19, allies),
        enemies = COALESCE($20, enemies),
        neutral_relations = COALESCE($21, neutral_relations),
        headquarters = COALESCE($22, headquarters),
        headquarters_location_id = $23,
        territories = COALESCE($24, territories),
        resources = COALESCE($25, resources),
        founding = COALESCE($26, founding),
        history = COALESCE($27, history),
        current_state = COALESCE($28, current_state),
        symbol_url = COALESCE($29, symbol_url),
        symbol_prompt = COALESCE($30, symbol_prompt),
        tags = COALESCE($31, tags),
        importance = COALESCE($32, importance),
        is_favorite = COALESCE($33, is_favorite),
        version = version + 1,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [
      id, world_id, parent_faction_id, name, faction_type, alignment, description,
      motto, symbol_description, leadership_type, leader_name, leader_character_id,
      hierarchy, member_count, goals, methods, values, secrets,
      allies, enemies, neutral_relations,
      headquarters, headquarters_location_id, territories, resources,
      founding, history, current_state,
      symbol_url, symbol_prompt, tags, importance, is_favorite
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Faction not found' });
    }

    res.json({ faction: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating faction:', error);
    res.status(500).json({ error: 'Failed to update faction' });
  }
});

/**
 * DELETE /api/story-bible/factions/:id
 * Delete a faction
 */
router.delete('/factions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Orphan child factions
    await pool.query('UPDATE library_factions SET parent_faction_id = NULL WHERE parent_faction_id = $1', [id]);
    // Remove membership records
    await pool.query('DELETE FROM character_faction_memberships WHERE faction_id = $1', [id]);
    await pool.query('DELETE FROM library_factions WHERE id = $1', [id]);

    res.json({ message: 'Faction deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting faction:', error);
    res.status(500).json({ error: 'Failed to delete faction' });
  }
});

// =============================================================================
// ABILITIES (Spells, Skills, Feats - for D&D support)
// =============================================================================

/**
 * GET /api/story-bible/abilities
 * List all abilities in user's library
 */
router.get('/abilities', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const abilityType = req.query.ability_type;
    const search = req.query.search || '';

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ abilities: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_abilities WHERE library_id = $1';
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (abilityType) {
      query += ` AND ability_type = $${paramIndex}`;
      params.push(abilityType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' ORDER BY ability_type, level, name';

    const result = await pool.query(query, params);

    res.json({
      abilities: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching abilities:', error);
    res.status(500).json({ error: 'Failed to fetch abilities' });
  }
});

/**
 * GET /api/story-bible/abilities/:id
 * Get single ability with characters who have it
 */
router.get('/abilities/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const ability = await pool.query(
      'SELECT * FROM library_abilities WHERE id = $1',
      [id]
    );

    if (ability.rows.length === 0) {
      return res.status(404).json({ error: 'Ability not found' });
    }

    // Get characters with this ability
    const characters = await pool.query(`
      SELECT ca.*, c.name as character_name, c.role as character_role
      FROM character_abilities ca
      JOIN library_characters c ON c.id = ca.character_id
      WHERE ca.ability_id = $1
    `, [id]);

    res.json({
      ability: ability.rows[0],
      characters: characters.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching ability:', error);
    res.status(500).json({ error: 'Failed to fetch ability' });
  }
});

/**
 * POST /api/story-bible/abilities
 * Create a new ability
 */
router.post('/abilities', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      world_id, name, ability_type, school, description, effect, visual_description,
      prerequisites, requirements, limitations, cooldown, resource_cost,
      level, casting_time, range, components, duration, concentration, ritual,
      damage, saving_throw, attack_bonus, source_type, class_restrictions,
      icon_url, tags, importance
    } = req.body;

    if (!name || !ability_type) {
      return res.status(400).json({ error: 'Name and ability_type are required' });
    }

    // Get or create library
    let library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      library = await pool.query(`
        INSERT INTO user_libraries (user_id, name)
        VALUES ($1, 'My Library')
        RETURNING id
      `, [userId]);
    }

    const result = await pool.query(`
      INSERT INTO library_abilities (
        library_id, world_id, name, ability_type, school, description, effect, visual_description,
        prerequisites, requirements, limitations, cooldown, resource_cost,
        level, casting_time, range, components, duration, concentration, ritual,
        damage, saving_throw, attack_bonus, source_type, class_restrictions,
        icon_url, tags, importance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      RETURNING *
    `, [
      library.rows[0].id, world_id, name, ability_type, school, description, effect, visual_description,
      prerequisites || [], requirements, limitations || [], cooldown, resource_cost,
      level, casting_time, range, components, duration, concentration || false, ritual || false,
      damage, saving_throw, attack_bonus, source_type, class_restrictions || [],
      icon_url, tags || [], importance || 50
    ]);

    logger.info(`[StoryBible] Created ability: ${name} (${ability_type})`);
    res.status(201).json({ ability: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating ability:', error);
    res.status(500).json({ error: 'Failed to create ability' });
  }
});

/**
 * PUT /api/story-bible/abilities/:id
 * Update an ability
 */
router.put('/abilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      world_id, name, ability_type, school, description, effect, visual_description,
      prerequisites, requirements, limitations, cooldown, resource_cost,
      level, casting_time, range, components, duration, concentration, ritual,
      damage, saving_throw, attack_bonus, source_type, class_restrictions,
      icon_url, tags, importance, is_favorite
    } = req.body;

    await saveEntityVersion('ability', id);

    const result = await pool.query(`
      UPDATE library_abilities SET
        world_id = COALESCE($2, world_id),
        name = COALESCE($3, name),
        ability_type = COALESCE($4, ability_type),
        school = COALESCE($5, school),
        description = COALESCE($6, description),
        effect = COALESCE($7, effect),
        visual_description = COALESCE($8, visual_description),
        prerequisites = COALESCE($9, prerequisites),
        requirements = COALESCE($10, requirements),
        limitations = COALESCE($11, limitations),
        cooldown = COALESCE($12, cooldown),
        resource_cost = COALESCE($13, resource_cost),
        level = COALESCE($14, level),
        casting_time = COALESCE($15, casting_time),
        range = COALESCE($16, range),
        components = COALESCE($17, components),
        duration = COALESCE($18, duration),
        concentration = COALESCE($19, concentration),
        ritual = COALESCE($20, ritual),
        damage = COALESCE($21, damage),
        saving_throw = COALESCE($22, saving_throw),
        attack_bonus = COALESCE($23, attack_bonus),
        source_type = COALESCE($24, source_type),
        class_restrictions = COALESCE($25, class_restrictions),
        icon_url = COALESCE($26, icon_url),
        tags = COALESCE($27, tags),
        importance = COALESCE($28, importance),
        is_favorite = COALESCE($29, is_favorite),
        version = version + 1,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [
      id, world_id, name, ability_type, school, description, effect, visual_description,
      prerequisites, requirements, limitations, cooldown, resource_cost,
      level, casting_time, range, components, duration, concentration, ritual,
      damage, saving_throw, attack_bonus, source_type, class_restrictions,
      icon_url, tags, importance, is_favorite
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ability not found' });
    }

    res.json({ ability: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating ability:', error);
    res.status(500).json({ error: 'Failed to update ability' });
  }
});

/**
 * DELETE /api/story-bible/abilities/:id
 * Delete an ability
 */
router.delete('/abilities/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Remove character links
    await pool.query('DELETE FROM character_abilities WHERE ability_id = $1', [id]);
    await pool.query('DELETE FROM library_abilities WHERE id = $1', [id]);

    res.json({ message: 'Ability deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting ability:', error);
    res.status(500).json({ error: 'Failed to delete ability' });
  }
});

// =============================================================================
// CHARACTER-FACTION MEMBERSHIPS
// =============================================================================

/**
 * POST /api/story-bible/memberships
 * Add a character to a faction
 */
router.post('/memberships', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      character_id, faction_id, rank, role, join_date, status, loyalty_level, notes
    } = req.body;

    if (!character_id || !faction_id) {
      return res.status(400).json({ error: 'character_id and faction_id are required' });
    }

    // Get library
    const library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      return res.status(400).json({ error: 'No library found' });
    }

    const result = await pool.query(`
      INSERT INTO character_faction_memberships (
        library_id, character_id, faction_id, rank, role, join_date, status, loyalty_level, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      library.rows[0].id, character_id, faction_id, rank, role, join_date,
      status || 'active', loyalty_level, notes
    ]);

    logger.info(`[StoryBible] Added character ${character_id} to faction ${faction_id}`);
    res.status(201).json({ membership: result.rows[0] });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Character is already a member of this faction' });
    }
    logger.error('[StoryBible] Error creating membership:', error);
    res.status(500).json({ error: 'Failed to create membership' });
  }
});

/**
 * DELETE /api/story-bible/memberships/:id
 * Remove a character from a faction
 */
router.delete('/memberships/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM character_faction_memberships WHERE id = $1', [id]);
    res.json({ message: 'Membership removed' });
  } catch (error) {
    logger.error('[StoryBible] Error deleting membership:', error);
    res.status(500).json({ error: 'Failed to delete membership' });
  }
});

// =============================================================================
// CHARACTER-ITEM LINKS
// =============================================================================

/**
 * POST /api/story-bible/character-items
 * Link a character to an item
 */
router.post('/character-items', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      character_id, item_id, relationship_type, acquisition_context, significance, notes
    } = req.body;

    if (!character_id || !item_id || !relationship_type) {
      return res.status(400).json({ error: 'character_id, item_id, and relationship_type are required' });
    }

    // Get library
    const library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      return res.status(400).json({ error: 'No library found' });
    }

    const result = await pool.query(`
      INSERT INTO character_items (
        library_id, character_id, item_id, relationship_type, acquisition_context, significance, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      library.rows[0].id, character_id, item_id, relationship_type,
      acquisition_context, significance, notes
    ]);

    logger.info(`[StoryBible] Linked character ${character_id} to item ${item_id} (${relationship_type})`);
    res.status(201).json({ character_item: result.rows[0] });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'This character-item relationship already exists' });
    }
    logger.error('[StoryBible] Error creating character-item link:', error);
    res.status(500).json({ error: 'Failed to create character-item link' });
  }
});

/**
 * DELETE /api/story-bible/character-items/:id
 * Remove a character-item link
 */
router.delete('/character-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM character_items WHERE id = $1', [id]);
    res.json({ message: 'Character-item link removed' });
  } catch (error) {
    logger.error('[StoryBible] Error deleting character-item link:', error);
    res.status(500).json({ error: 'Failed to delete character-item link' });
  }
});

// =============================================================================
// CHARACTER-ABILITY LINKS
// =============================================================================

/**
 * POST /api/story-bible/character-abilities
 * Link a character to an ability
 */
router.post('/character-abilities', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      character_id, ability_id, proficiency_level, how_acquired, signature_use, notes
    } = req.body;

    if (!character_id || !ability_id) {
      return res.status(400).json({ error: 'character_id and ability_id are required' });
    }

    // Get library
    const library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      return res.status(400).json({ error: 'No library found' });
    }

    const result = await pool.query(`
      INSERT INTO character_abilities (
        library_id, character_id, ability_id, proficiency_level, how_acquired, signature_use, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      library.rows[0].id, character_id, ability_id, proficiency_level,
      how_acquired, signature_use || false, notes
    ]);

    logger.info(`[StoryBible] Linked character ${character_id} to ability ${ability_id}`);
    res.status(201).json({ character_ability: result.rows[0] });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Character already has this ability' });
    }
    logger.error('[StoryBible] Error creating character-ability link:', error);
    res.status(500).json({ error: 'Failed to create character-ability link' });
  }
});

/**
 * DELETE /api/story-bible/character-abilities/:id
 * Remove a character-ability link
 */
router.delete('/character-abilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM character_abilities WHERE id = $1', [id]);
    res.json({ message: 'Character-ability link removed' });
  } catch (error) {
    logger.error('[StoryBible] Error deleting character-ability link:', error);
    res.status(500).json({ error: 'Failed to delete character-ability link' });
  }
});

// =============================================================================
// CHARACTER CONNECTIONS
// =============================================================================

/**
 * GET /api/story-bible/connections
 * Get all connections for a character or all in library
 */
router.get('/connections', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const characterId = req.query.character_id;

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ connections: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = `
      SELECT cc.*,
        ca.name as character_a_name,
        cb.name as character_b_name
      FROM character_connections cc
      JOIN library_characters ca ON ca.id = cc.character_a_id
      JOIN library_characters cb ON cb.id = cc.character_b_id
      WHERE cc.library_id = $1
    `;
    const params = [targetLibraryId];

    if (characterId) {
      query += ' AND (cc.character_a_id = $2 OR cc.character_b_id = $2)';
      params.push(characterId);
    }

    query += ' ORDER BY cc.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      connections: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching connections:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

/**
 * POST /api/story-bible/connections
 * Create a connection between two characters
 */
router.post('/connections', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      character_a_id, character_b_id, relationship_type, relationship_label,
      is_directional, reverse_relationship_type, description, current_status, dynamics
    } = req.body;

    if (!character_a_id || !character_b_id || !relationship_type) {
      return res.status(400).json({ error: 'character_a_id, character_b_id, and relationship_type are required' });
    }

    // Get library
    const library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      return res.status(400).json({ error: 'No library found' });
    }

    // Check both characters exist
    const chars = await pool.query(
      'SELECT id FROM library_characters WHERE id IN ($1, $2) AND library_id = $3',
      [character_a_id, character_b_id, library.rows[0].id]
    );

    if (chars.rows.length !== 2) {
      return res.status(400).json({ error: 'One or both characters not found' });
    }

    const result = await pool.query(`
      INSERT INTO character_connections (
        library_id, character_a_id, character_b_id, relationship_type, relationship_label,
        is_directional, reverse_relationship_type, description, current_status, dynamics
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      library.rows[0].id, character_a_id, character_b_id, relationship_type, relationship_label,
      is_directional || false, reverse_relationship_type, description, current_status || 'active', dynamics
    ]);

    logger.info(`[StoryBible] Created connection: ${relationship_type}`);
    res.status(201).json({ connection: result.rows[0] });

  } catch (error) {
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: 'Connection already exists between these characters' });
    }
    logger.error('[StoryBible] Error creating connection:', error);
    res.status(500).json({ error: 'Failed to create connection' });
  }
});

/**
 * PUT /api/story-bible/connections/:id
 * Update a connection
 */
router.put('/connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      relationship_type, relationship_label, is_directional,
      reverse_relationship_type, description, current_status, dynamics
    } = req.body;

    const result = await pool.query(`
      UPDATE character_connections SET
        relationship_type = COALESCE($2, relationship_type),
        relationship_label = COALESCE($3, relationship_label),
        is_directional = COALESCE($4, is_directional),
        reverse_relationship_type = COALESCE($5, reverse_relationship_type),
        description = COALESCE($6, description),
        current_status = COALESCE($7, current_status),
        dynamics = COALESCE($8, dynamics),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, relationship_type, relationship_label, is_directional, reverse_relationship_type, description, current_status, dynamics]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    res.json({ connection: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating connection:', error);
    res.status(500).json({ error: 'Failed to update connection' });
  }
});

/**
 * DELETE /api/story-bible/connections/:id
 * Delete a connection
 */
router.delete('/connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM character_connections WHERE id = $1', [id]);
    res.json({ message: 'Connection deleted' });
  } catch (error) {
    logger.error('[StoryBible] Error deleting connection:', error);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

// =============================================================================
// COLLABORATIVE REFINEMENT
// =============================================================================

/**
 * POST /api/story-bible/refine/:entityType/:entityId
 * Refine an entity based on user prompt
 */
router.post('/refine/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { prompt } = req.body;
    const userId = req.body.user_id || DEFAULT_USER_ID;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Get library
    const library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      return res.status(400).json({ error: 'No library found' });
    }

    // Map entity type to table
    const tableMap = {
      character: 'library_characters',
      world: 'library_worlds',
      location: 'library_locations',
      item: 'library_items',
      faction: 'library_factions',
      ability: 'library_abilities',
      lore: 'library_lore',
      event: 'library_events',
      synopsis: 'library_synopsis'
    };

    const table = tableMap[entityType];
    if (!table) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }

    // Get current entity
    const current = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [entityId]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    const entity = current.rows[0];
    const beforeSnapshot = { ...entity };

    // Import OpenAI for refinement
    const { generateWithOpenAI } = await import('../services/openai.js');

    // Build refinement prompt based on entity type
    const systemPrompt = buildRefinementSystemPrompt(entityType, entity);
    const userPrompt = `Current ${entityType} data:\n${JSON.stringify(entity, null, 2)}\n\nUser request: ${prompt}\n\nReturn the updated ${entityType} as JSON, incorporating the user's request while preserving existing details that weren't mentioned.`;

    const result = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      responseFormat: { type: 'json_object' }
    });

    let updatedData;
    try {
      updatedData = JSON.parse(result.content);
    } catch (parseError) {
      logger.error(`[StoryBible] JSON parse error for ${entityType} refinement:`, parseError);
      logger.error(`[StoryBible] Raw content: ${result.content?.substring(0, 500)}`);
      return res.status(500).json({ error: 'Invalid AI response format - could not parse JSON' });
    }

    // Update entity based on type
    const updateResult = await updateEntityFromRefinement(entityType, entityId, updatedData, table);

    // Save refinement history
    await pool.query(`
      INSERT INTO entity_refinements (library_id, entity_type, entity_id, user_prompt, ai_response, before_snapshot, after_snapshot)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      library.rows[0].id,
      entityType,
      entityId,
      prompt,
      `Updated based on: ${prompt}`,
      JSON.stringify(beforeSnapshot),
      JSON.stringify(updateResult.rows[0])
    ]);

    // Update last refinement prompt
    await pool.query(`UPDATE ${table} SET last_refinement_prompt = $2 WHERE id = $1`, [entityId, prompt]);

    res.json({
      [entityType]: updateResult.rows[0],
      refinement: {
        prompt,
        success: true
      }
    });

  } catch (error) {
    logger.error('[StoryBible] Error refining entity:', error);
    res.status(500).json({ error: 'Failed to refine entity' });
  }
});

// =============================================================================
// GENERATE OUTLINE
// =============================================================================

/**
 * POST /api/story-bible/synopsis/:id/generate-outline
 * Generate chapter outline from synopsis and story bible elements
 */
router.post('/synopsis/:id/generate-outline', async (req, res) => {
  try {
    const { id } = req.params;
    const { chapter_count } = req.body;
    const userId = req.body.user_id || DEFAULT_USER_ID;

    // Get synopsis
    const synopsis = await pool.query('SELECT * FROM library_synopsis WHERE id = $1', [id]);
    if (synopsis.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const synopsisData = synopsis.rows[0];

    // Get library
    const library = await pool.query(
      'SELECT * FROM user_libraries WHERE id = $1',
      [synopsisData.library_id]
    );

    // Get related data
    // ERROR HANDLING FIX: Use Promise.allSettled for resilience
    // DB LIMIT PROTECTION: Reasonable limits for story context
    const relatedResults = await Promise.allSettled([
      pool.query('SELECT * FROM library_characters WHERE library_id = $1 LIMIT 200', [synopsisData.library_id]),
      library.rows[0].world_id
        ? pool.query('SELECT * FROM library_worlds WHERE id = $1', [library.rows[0].world_id])
        : Promise.resolve({ rows: [] }),
      pool.query('SELECT * FROM library_locations WHERE library_id = $1 LIMIT 100', [synopsisData.library_id]),
      pool.query('SELECT * FROM library_lore WHERE library_id = $1 ORDER BY importance DESC LIMIT 20', [synopsisData.library_id])
    ]);
    const relatedNames = ['characters', 'world', 'locations', 'lore'];
    const [characters, world, locations, lore] = relatedResults.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      logger.warn(`[StoryBible] Query for ${relatedNames[i]} failed:`, r.reason?.message);
      return { rows: [] };
    });

    // Import OpenAI
    const { generateWithOpenAI } = await import('../services/openai.js');

    // PHASE 5 FIX: Check for source chapter structure
    const sourceChapters = synopsisData.source_chapters;
    const hasSourceStructure = sourceChapters?.has_explicit_structure && sourceChapters?.chapters?.length > 0;

    if (hasSourceStructure) {
      logger.info(`[StoryBible] Using source chapter structure: ${sourceChapters.chapters.length} chapters`);
    }

    const systemPrompt = `You are a story architect. Generate a detailed chapter-by-chapter outline for a story.
Each chapter should have:
- chapter_number (integer)
- title (catchy chapter title)
- summary (2-3 sentences describing what happens)
- key_events (array of 3-5 main events)
- characters_present (array of character names involved)
- location (where it takes place)
- mood (emotional tone)
- ends_with (how the chapter ends - cliffhanger, resolution, revelation, etc.)

${hasSourceStructure ? `
CRITICAL REQUIREMENT:
The source document has an EXPLICIT chapter structure that MUST be preserved.
- Use the EXACT chapter titles provided
- Use the EXACT chapter count (${sourceChapters.total_chapters} chapters)
- Do NOT rename, reorder, or skip any chapters
- You may expand on the summaries but preserve the original structure
` : ''}

Return JSON: { "chapters": [...] }`;

    // Build source chapter context if available
    const sourceChapterContext = hasSourceStructure
      ? `
## SOURCE DOCUMENT CHAPTER STRUCTURE (PRESERVE THIS EXACTLY)
The source material has ${sourceChapters.total_chapters} chapters with these titles:
${sourceChapters.chapters.map(c => `- Chapter ${c.number}: "${c.title}"${c.summary ? ` - ${c.summary}` : ''}`).join('\n')}

CRITICAL: Use these EXACT chapter titles and structure. Expand on them but do NOT rename, reorder, or skip any chapters.

`
      : '';

    const userPrompt = `Create a ${hasSourceStructure ? sourceChapters.total_chapters : (chapter_count || 10)} chapter outline for this story:

${sourceChapterContext}SYNOPSIS:
${synopsisData.synopsis}

GENRE: ${synopsisData.genre || 'General Fiction'}
TARGET AUDIENCE: ${synopsisData.target_audience || 'General'}
THEMES: ${(synopsisData.themes || []).join(', ')}

CHARACTERS:
${characters.rows.map(c => `- ${c.name} (${c.role}): ${c.description || ''}`).join('\n')}

WORLD:
${world.rows[0]?.description || 'Not specified'}

LOCATIONS:
${locations.rows.map(l => `- ${l.name}: ${l.description || ''}`).join('\n')}

KEY LORE:
${lore.rows.map(l => `- ${l.title}: ${l.content?.substring(0, 200)}...`).join('\n')}

${hasSourceStructure
  ? 'Generate an outline that PRESERVES the source chapter structure while enriching each chapter with story details.'
  : 'Generate a compelling outline that uses these elements effectively.'}`;

    const result = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      model: 'gpt-4o',
      temperature: 0.8,
      responseFormat: { type: 'json_object' }
    });

    const outlineData = JSON.parse(result.content);

    // Update synopsis with outline
    await pool.query(`
      UPDATE library_synopsis
      SET outline_json = $2, is_outline_generated = true, outline_generated_at = NOW()
      WHERE id = $1
    `, [id, JSON.stringify(outlineData)]);

    res.json({
      outline: outlineData,
      synopsis_id: id,
      generated: true
    });

  } catch (error) {
    logger.error('[StoryBible] Error generating outline:', error);
    res.status(500).json({ error: 'Failed to generate outline' });
  }
});

/**
 * PATCH /api/story-bible/synopsis/:id/outline
 * Update outline chapters (edit, add, remove, reorder)
 */
router.patch('/synopsis/:id/outline', async (req, res) => {
  try {
    const { id } = req.params;
    const { chapters, action, chapter_index, chapter_data } = req.body;

    // Get current synopsis
    const synopsis = await pool.query('SELECT * FROM library_synopsis WHERE id = $1', [id]);
    if (synopsis.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const synopsisData = synopsis.rows[0];
    let currentOutline = synopsisData.outline_json || { chapters: [] };

    // Handle different actions
    if (action === 'replace_all' && chapters) {
      // Replace entire outline
      currentOutline = { chapters };
      logger.info(`[StoryBible] Replacing entire outline for synopsis ${id} with ${chapters.length} chapters`);
    } else if (action === 'update_chapter' && chapter_index !== undefined && chapter_data) {
      // Update a specific chapter
      if (chapter_index >= 0 && chapter_index < currentOutline.chapters.length) {
        currentOutline.chapters[chapter_index] = {
          ...currentOutline.chapters[chapter_index],
          ...chapter_data
        };
        logger.info(`[StoryBible] Updated chapter ${chapter_index + 1} for synopsis ${id}`);
      } else {
        return res.status(400).json({ error: 'Invalid chapter index' });
      }
    } else if (action === 'add_chapter' && chapter_data) {
      // Add a new chapter at specified index or end
      const insertAt = chapter_index !== undefined ? chapter_index : currentOutline.chapters.length;
      const newChapter = {
        chapter_number: insertAt + 1,
        title: chapter_data.title || `Chapter ${insertAt + 1}`,
        summary: chapter_data.summary || '',
        key_events: chapter_data.key_events || [],
        characters_present: chapter_data.characters_present || [],
        location: chapter_data.location || '',
        mood: chapter_data.mood || '',
        ends_with: chapter_data.ends_with || ''
      };
      currentOutline.chapters.splice(insertAt, 0, newChapter);
      // Renumber all chapters
      currentOutline.chapters.forEach((ch, idx) => {
        ch.chapter_number = idx + 1;
      });
      logger.info(`[StoryBible] Added chapter at position ${insertAt + 1} for synopsis ${id}`);
    } else if (action === 'delete_chapter' && chapter_index !== undefined) {
      // Delete a chapter
      if (chapter_index >= 0 && chapter_index < currentOutline.chapters.length) {
        currentOutline.chapters.splice(chapter_index, 1);
        // Renumber all chapters
        currentOutline.chapters.forEach((ch, idx) => {
          ch.chapter_number = idx + 1;
        });
        logger.info(`[StoryBible] Deleted chapter ${chapter_index + 1} for synopsis ${id}`);
      } else {
        return res.status(400).json({ error: 'Invalid chapter index' });
      }
    } else if (action === 'reorder' && chapter_index !== undefined && req.body.new_index !== undefined) {
      // Move chapter from one position to another
      const { new_index } = req.body;
      if (chapter_index >= 0 && chapter_index < currentOutline.chapters.length &&
          new_index >= 0 && new_index < currentOutline.chapters.length) {
        const [moved] = currentOutline.chapters.splice(chapter_index, 1);
        currentOutline.chapters.splice(new_index, 0, moved);
        // Renumber all chapters
        currentOutline.chapters.forEach((ch, idx) => {
          ch.chapter_number = idx + 1;
        });
        logger.info(`[StoryBible] Moved chapter from ${chapter_index + 1} to ${new_index + 1} for synopsis ${id}`);
      } else {
        return res.status(400).json({ error: 'Invalid chapter indices' });
      }
    } else {
      return res.status(400).json({
        error: 'Invalid action. Use: replace_all, update_chapter, add_chapter, delete_chapter, or reorder'
      });
    }

    // Save updated outline
    await pool.query(`
      UPDATE library_synopsis
      SET outline_json = $2, updated_at = NOW()
      WHERE id = $1
    `, [id, JSON.stringify(currentOutline)]);

    res.json({
      success: true,
      outline: currentOutline,
      synopsis_id: id
    });

  } catch (error) {
    logger.error('[StoryBible] Error updating outline:', error);
    res.status(500).json({ error: 'Failed to update outline' });
  }
});

/**
 * POST /api/story-bible/synopsis/:id/refine-chapter/:chapterNumber
 * Refine a specific chapter using AI based on user prompt
 */
router.post('/synopsis/:id/refine-chapter/:chapterNumber', async (req, res) => {
  try {
    const { id, chapterNumber } = req.params;
    const { prompt, include_events } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Get synopsis with outline
    const synopsis = await pool.query('SELECT * FROM library_synopsis WHERE id = $1', [id]);
    if (synopsis.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const synopsisData = synopsis.rows[0];
    const outline = synopsisData.outline_json;

    if (!outline || !outline.chapters) {
      return res.status(400).json({ error: 'Synopsis has no outline generated' });
    }

    const chapterIndex = parseInt(chapterNumber) - 1;
    if (chapterIndex < 0 || chapterIndex >= outline.chapters.length) {
      return res.status(400).json({ error: 'Invalid chapter number' });
    }

    const currentChapter = outline.chapters[chapterIndex];

    // Get linked events for this chapter if requested
    let linkedEvents = [];
    if (include_events) {
      const events = await pool.query(`
        SELECT e.* FROM outline_chapter_events oce
        JOIN library_events e ON oce.event_id = e.id
        WHERE oce.synopsis_id = $1 AND oce.chapter_number = $2
        ORDER BY oce.position_in_chapter
      `, [id, parseInt(chapterNumber)]);
      linkedEvents = events.rows;
    }

    // Get available events from library for context
    const libraryEvents = await pool.query(`
      SELECT name, description, event_type, importance, suggested_timing
      FROM library_events
      WHERE library_id = $1 AND is_incorporated = false
      ORDER BY sort_order
      LIMIT 20
    `, [synopsisData.library_id]);

    // Import OpenAI
    const { generateWithOpenAI } = await import('../services/openai.js');

    const systemPrompt = `You are a story outline editor. Refine the given chapter based on the user's request.
Preserve the structure but update content based on the prompt.
You may:
- Improve the summary, key events, mood, or ending
- Suggest better pacing or dramatic tension
- Incorporate specific events the user mentions
- Adjust character involvement

Return valid JSON matching this exact structure:
{
  "chapter_number": integer,
  "title": "string",
  "summary": "2-3 sentence description of what happens",
  "key_events": ["array of 3-5 main events/scenes"],
  "characters_present": ["array of character names"],
  "location": "where it takes place",
  "mood": "emotional tone",
  "ends_with": "how chapter ends (cliffhanger/resolution/revelation/transition)"
}`;

    let userPrompt = `Refine this chapter based on my request:

CURRENT CHAPTER ${chapterNumber}:
${JSON.stringify(currentChapter, null, 2)}

USER REQUEST: ${prompt}`;

    if (linkedEvents.length > 0) {
      userPrompt += `\n\nLINKED EVENTS FOR THIS CHAPTER:
${linkedEvents.map(e => `- ${e.name}: ${e.description}`).join('\n')}`;
    }

    if (libraryEvents.rows.length > 0) {
      userPrompt += `\n\nAVAILABLE EVENTS TO CONSIDER (not yet incorporated):
${libraryEvents.rows.map(e => `- ${e.name} (${e.importance}, timing: ${e.suggested_timing}): ${e.description?.substring(0, 100)}...`).join('\n')}`;
    }

    userPrompt += `\n\nReturn the refined chapter as JSON.`;

    const result = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      responseFormat: { type: 'json_object' }
    });

    let refinedChapter;
    try {
      refinedChapter = JSON.parse(result.content);
    } catch (parseError) {
      logger.error('[StoryBible] Error parsing refined chapter:', parseError);
      return res.status(500).json({ error: 'AI returned invalid JSON' });
    }

    // Update the chapter in the outline
    outline.chapters[chapterIndex] = {
      ...refinedChapter,
      chapter_number: parseInt(chapterNumber) // Ensure correct number
    };

    // Save updated outline
    await pool.query(`
      UPDATE library_synopsis
      SET outline_json = $2, updated_at = NOW()
      WHERE id = $1
    `, [id, JSON.stringify(outline)]);

    res.json({
      success: true,
      chapter: outline.chapters[chapterIndex],
      chapter_number: parseInt(chapterNumber),
      synopsis_id: id
    });

  } catch (error) {
    logger.error('[StoryBible] Error refining chapter:', error);
    res.status(500).json({ error: 'Failed to refine chapter' });
  }
});

// =============================================================================
// CHAPTER BEATS
// =============================================================================

/**
 * GET /api/story-bible/synopsis/:id/beats
 * Get all chapter beats for a synopsis
 */
router.get('/synopsis/:id/beats', async (req, res) => {
  try {
    const { id } = req.params;

    // DB LIMIT PROTECTION: Limit chapter beats to 100 max
    const beats = await pool.query(
      'SELECT * FROM chapter_beats WHERE synopsis_id = $1 ORDER BY chapter_number LIMIT 100',
      [id]
    );

    res.json({ beats: beats.rows });

  } catch (error) {
    logger.error('[StoryBible] Error fetching beats:', error);
    res.status(500).json({ error: 'Failed to fetch beats' });
  }
});

/**
 * POST /api/story-bible/synopsis/:id/generate-beats/:chapterNumber
 * Generate beats for a specific chapter using multi-agent pipeline
 */
router.post('/synopsis/:id/generate-beats/:chapterNumber', async (req, res) => {
  try {
    const { id, chapterNumber } = req.params;

    // Get synopsis and outline
    const synopsis = await pool.query('SELECT * FROM library_synopsis WHERE id = $1', [id]);
    if (synopsis.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const synopsisData = synopsis.rows[0];
    const outline = synopsisData.outline_json;

    if (!outline || !outline.chapters) {
      return res.status(400).json({ error: 'Generate outline first' });
    }

    const chapterNum = parseInt(chapterNumber);
    const chapter = outline.chapters.find(c =>
      (c.chapter_number || outline.chapters.indexOf(c) + 1) === chapterNum
    );
    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found in outline' });
    }

    // Get all library data for context
    // ERROR HANDLING FIX: Use Promise.allSettled so one failing query doesn't crash beat generation
    // DB LIMIT PROTECTION: Reasonable limits for beat generation context
    const contextResults = await Promise.allSettled([
      pool.query('SELECT * FROM library_characters WHERE library_id = $1 LIMIT 200', [synopsisData.library_id]),
      pool.query('SELECT * FROM library_locations WHERE library_id = $1 LIMIT 100', [synopsisData.library_id]),
      pool.query('SELECT * FROM library_items WHERE library_id = $1 LIMIT 100', [synopsisData.library_id]),
      pool.query('SELECT * FROM library_factions WHERE library_id = $1 LIMIT 50', [synopsisData.library_id]),
      pool.query('SELECT * FROM library_lore WHERE library_id = $1 LIMIT 100', [synopsisData.library_id]),
      pool.query('SELECT * FROM library_events WHERE library_id = $1 ORDER BY sort_order LIMIT 500', [synopsisData.library_id])
    ]);
    const contextNames = ['characters', 'locations', 'items', 'factions', 'lore', 'events'];
    const [characters, locations, items, factions, lore, events] = contextResults.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      logger.warn(`[StoryBible] Query for ${contextNames[i]} failed:`, r.reason?.message);
      return { rows: [] };
    });

    // Import the multi-agent pipeline
    const { generateBeatsWithPipeline } = await import('../services/agents/beatGenerationPipeline.js');

    // Get OpenAI client
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Run the multi-agent beat generation pipeline
    logger.info(`[StoryBible] Starting multi-agent beat generation for Chapter ${chapterNum}`);

    const result = await generateBeatsWithPipeline({
      chapter,
      chapterNumber: chapterNum,
      synopsis: synopsisData,
      outline,
      libraryData: {
        characters: characters.rows,
        locations: locations.rows,
        items: items.rows,
        factions: factions.rows,
        lore: lore.rows,
        events: events.rows
      },
      openai,
      pool,
      synopsisId: id
    });

    // Save or update beats with linked objects
    await pool.query(`
      INSERT INTO chapter_beats (synopsis_id, chapter_number, chapter_title, chapter_summary, beats, generated_from)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (synopsis_id, chapter_number)
      DO UPDATE SET beats = $5, chapter_title = $3, chapter_summary = $4, updated_at = NOW()
    `, [
      id,
      chapterNum,
      chapter.title,
      chapter.summary,
      JSON.stringify(result.beats),
      JSON.stringify({
        chapter,
        characters_used: chapter.characters_present,
        timeline: result.timeline,
        validation: result.validation,
        pipeline_version: '2.0'
      })
    ]);

    logger.info(`[StoryBible] Generated ${result.beats.length} beats for Chapter ${chapterNum} using multi-agent pipeline`);

    res.json({
      chapter_number: chapterNum,
      beats: result.beats,
      timeline: result.timeline,
      validation: result.validation
    });

  } catch (error) {
    logger.error('[StoryBible] Error generating beats:', error);
    res.status(500).json({ error: 'Failed to generate beats: ' + error.message });
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build system prompt for refinement based on entity type
 */
function buildRefinementSystemPrompt(entityType, entity) {
  const prompts = {
    character: `You are a character development assistant. Update the character profile based on user requests.
Preserve all existing details unless the user explicitly wants to change them.
Return valid JSON matching this structure:
{
  "name": "string",
  "display_name": "string or null",
  "role": "string",
  "description": "string",
  "personality": "string",
  "traits_json": ["array of trait strings"],
  "backstory": "string",
  "voice_description": "string",
  "gender": "string",
  "age_group": "string",
  "appearance": "string"
}`,
    world: `You are a world-building assistant. Update the world details based on user requests.
Return valid JSON matching this structure:
{
  "name": "string",
  "description": "string",
  "genre": "string",
  "time_period": "string",
  "magic_system": "string or null",
  "technology_level": "string or null",
  "society_structure": "string or null",
  "tone": "string",
  "themes": ["array of theme strings"],
  "visual_style": "string"
}`,
    location: `You are a location design assistant. Update the location based on user requests.
Return valid JSON matching this structure:
{
  "name": "string",
  "location_type": "string",
  "description": "string",
  "atmosphere": "string",
  "notable_features": [{"name": "string", "description": "string"}],
  "history": "string",
  "current_state": "string"
}`,
    lore: `You are a lore keeper assistant. Update the lore entry based on user requests.
Return valid JSON matching this structure:
{
  "entry_type": "string",
  "title": "string",
  "content": "string",
  "tags": ["array of tag strings"],
  "importance": number
}`,
    item: `You are an item designer assistant. Update the item based on user requests.
Return valid JSON matching this structure:
{
  "name": "string",
  "display_name": "string or null",
  "item_type": "weapon|armor|vehicle|tool|artifact|book|clothing|consumable|container|key|currency|document|misc",
  "subtype": "string",
  "description": "string",
  "appearance": "string",
  "size": "tiny|small|medium|large|huge|colossal",
  "material": "string",
  "condition": "pristine|good|worn|damaged|broken|ancient",
  "magical_properties": "string or null",
  "mundane_properties": "string or null",
  "abilities": ["array of ability strings"],
  "limitations": ["array of limitation strings"],
  "rarity": "common|uncommon|rare|very_rare|legendary|unique|artifact",
  "value_description": "string",
  "origin": "string",
  "creator": "string",
  "history": "string"
}`,
    faction: `You are an organization designer assistant. Update the faction based on user requests.
Return valid JSON matching this structure:
{
  "name": "string",
  "faction_type": "guild|kingdom|cult|company|military|tribe|gang|religion|school|family|alliance|government|order|resistance|secret_society",
  "alignment": "string",
  "description": "string",
  "motto": "string or null",
  "symbol_description": "string or null",
  "leadership_type": "string",
  "leader_name": "string",
  "hierarchy": "string",
  "member_count": "string",
  "goals": ["array of goal strings"],
  "methods": ["array of method strings"],
  "values": ["array of value strings"],
  "secrets": "string or null",
  "allies": ["array of ally faction names"],
  "enemies": ["array of enemy faction names"],
  "headquarters": "string",
  "founding": "string",
  "history": "string",
  "current_state": "string"
}`,
    ability: `You are a game designer assistant. Update the ability/spell/skill based on user requests.
Return valid JSON matching this structure:
{
  "name": "string",
  "ability_type": "spell|skill|feat|trait|technique|power|curse|blessing|class_feature|racial_ability",
  "school": "string (for spells: evocation, necromancy, etc.)",
  "description": "string",
  "effect": "string (mechanical effect)",
  "visual_description": "string",
  "prerequisites": ["array of prerequisite strings"],
  "requirements": "string",
  "limitations": ["array of limitation strings"],
  "cooldown": "string",
  "resource_cost": "string",
  "level": "number or null",
  "casting_time": "string",
  "range": "string",
  "components": "string (V, S, M)",
  "duration": "string",
  "concentration": "boolean",
  "ritual": "boolean",
  "damage": "string",
  "saving_throw": "string",
  "source_type": "arcane|divine|psionic|martial|natural|technological"
}`,
    event: `You are a story event planner assistant. Update the planned story event based on user requests.
Events are PLANNED MOMENTS that SHOULD happen during the story (not historical events/backstory).
Return valid JSON matching this structure:
{
  "name": "string (short descriptive name)",
  "description": "string (detailed description, 2-4 sentences)",
  "event_type": "action|confrontation|revelation|emotional|transition|discovery|chase|escape|battle|reunion|betrayal|sacrifice|transformation",
  "importance": "major|supporting|minor",
  "characters_involved": ["array of character names"],
  "factions_involved": ["array of faction names"],
  "location_name": "string or null",
  "location_notes": "string or null",
  "suggested_timing": "early|middle|climax|resolution|any",
  "prerequisites": ["array of things that must happen first"],
  "consequences": ["array of things this event leads to"],
  "emotional_tone": "string (tense, triumphant, tragic, hopeful, terrifying, bittersweet, etc.)",
  "stakes": "string (what's at risk)",
  "conflict_type": "physical|verbal|internal|supernatural|political|social",
  "key_elements": ["array of specific things that MUST be part of this event"],
  "dialogue_hints": "string or null",
  "visual_details": "string or null",
  "notes": "string or null",
  "tags": ["array of relevant tags"]
}`,
    synopsis: `You are a story development assistant. Update the synopsis based on user requests.
Return valid JSON matching this structure:
{
  "title": "string",
  "logline": "string (one sentence pitch)",
  "synopsis": "string (full synopsis)",
  "genre": "string",
  "target_audience": "string",
  "themes": ["array of theme strings"],
  "mood": "string"
}`
  };

  return prompts[entityType] || 'You are a helpful assistant. Update the entity based on user requests. Return valid JSON.';
}

/**
 * Update entity from AI refinement response
 */
async function updateEntityFromRefinement(entityType, entityId, data, table) {
  // SECURITY: Use centralized column whitelist (ALLOWED_COLUMNS defined at module level)
  // Exclude 'version' and 'updated_at' as they're managed separately below
  const managedFields = ['version', 'updated_at'];

  // Fields that are PostgreSQL TEXT[] arrays (not JSON)
  const pgArrayFields = ['themes', 'tags', 'characters_involved', 'factions_involved', 'key_elements'];
  // Fields that should be stored as JSON
  const jsonFields = ['traits_json', 'outline_json'];

  // Use centralized whitelist, excluding managed fields
  const fields = (ALLOWED_COLUMNS[entityType] || []).filter(f => !managedFields.includes(f));
  const setClauses = [];
  const values = [entityId];
  let paramIndex = 2;

  for (const field of fields) {
    if (data[field] !== undefined) {
      let value = data[field];

      if (Array.isArray(value)) {
        if (pgArrayFields.includes(field)) {
          // PostgreSQL TEXT[] array - pass as-is, pg driver handles conversion
          // Just ensure it's an array of strings
          value = value.map(v => String(v));
        } else if (jsonFields.includes(field)) {
          // JSON field - stringify
          value = JSON.stringify(value);
        } else {
          // Default: treat arrays as JSON
          value = JSON.stringify(value);
        }
      } else if (typeof value === 'object' && value !== null) {
        // Object - always JSON stringify
        value = JSON.stringify(value);
      }

      setClauses.push(`${field} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return pool.query(`SELECT * FROM ${table} WHERE id = $1`, [entityId]);
  }

  setClauses.push('version = version + 1');
  setClauses.push('updated_at = NOW()');

  return pool.query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
}

/**
 * Save current state of an entity to version history
 */
async function saveEntityVersion(entityType, entityId, changeSummary = null) {
  try {
    const table = getValidatedTableName(entityType);

    // Get current data
    const current = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [entityId]);
    if (current.rows.length === 0) return;

    const currentVersion = current.rows[0].version || 1;

    // Insert version record
    await pool.query(`
      INSERT INTO library_entity_versions (entity_type, entity_id, version_number, data_json, change_summary)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (entity_type, entity_id, version_number) DO NOTHING
    `, [entityType, entityId, currentVersion, JSON.stringify(current.rows[0]), changeSummary]);

  } catch (error) {
    logger.warn('[StoryBible] Error saving version:', error.message);
    // Don't fail the main operation if versioning fails
  }
}

// =============================================================================
// BRAIN DUMP ENDPOINTS
// =============================================================================

/**
 * POST /api/story-bible/refine-brain-dump
 * Refine brain dump content with AI before extraction
 */
router.post('/refine-brain-dump', async (req, res) => {
  try {
    const { content, instruction, library_id } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const { generateWithOpenAI } = await import('../services/openai.js');

    const response = await generateWithOpenAI({
      systemPrompt: `You are a story development assistant helping to refine and expand story content before extraction. Your job is to take rough notes, ideas, and content dumps and make them more detailed, organized, and useful for story development.

When refining content:
- Expand vague descriptions into more detailed ones
- Add personality traits, motivations, and backstory to characters
- Clarify relationships between characters
- Add sensory details to locations
- Organize chaotic content into clear sections
- Maintain the original author's voice and intent
- Never remove information, only expand and clarify

Return the refined content in a clear, organized format that will be easier to extract characters, locations, items, factions, and lore from.`,
      userPrompt: `Please refine this content according to this instruction: "${instruction || 'Expand and clarify all details'}"

Content to refine:
${content}`,
      temperature: 0.7,
      max_tokens: 4000
    });

    logger.info('[StoryBible] Refined brain dump content');
    res.json({ refined_content: response.content });

  } catch (error) {
    logger.error('[StoryBible] Error refining brain dump:', error);
    res.status(500).json({ error: 'Failed to refine content' });
  }
});

/**
 * POST /api/story-bible/extract-file
 * Extract text content from uploaded files (PDF, images, text)
 */
router.post('/extract-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;

    let extractedText = '';

    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      // Read text files directly
      extractedText = await fs.readFile(filePath, 'utf-8');
    } else if (mimeType === 'application/pdf') {
      // For PDFs, we'd need pdf-parse or similar - for now return placeholder
      extractedText = '[PDF extraction not yet implemented - paste text content instead]';
    } else if (mimeType.startsWith('image/')) {
      // For images, we'd need OCR - for now return placeholder
      extractedText = '[Image OCR not yet implemented - paste text content instead]';
    }

    // Clean up uploaded file
    await fs.unlink(filePath).catch(err => {
      // Cleanup failures are non-critical but log for diagnostics
      if (err.code !== 'ENOENT') {
        logger.debug(`[StoryBible] File cleanup warning: ${err.message}`);
      }
    });

    res.json({ text: extractedText, filename: req.file.originalname });

  } catch (error) {
    logger.error('[StoryBible] Error extracting file:', error);
    res.status(500).json({ error: 'Failed to extract file content' });
  }
});

/**
 * POST /api/story-bible/extract-advanced
 * Advanced multi-agent extraction that also generates synopsis
 * Uses same pattern as bulk-import-advanced: store config, let socket handler start extraction
 */
router.post('/extract-advanced', async (req, res) => {
  try {
    const { content, library_id, library_name, generate_synopsis } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Generate a unique room ID for socket progress updates
    const roomId = `extraction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`[StoryBible] Preparing advanced extraction for library ${library_id}, room: ${roomId}`);

    // Store extraction config - will be started when client emits 'start-extraction'
    if (!req.app.locals.extractions) {
      req.app.locals.extractions = new Map();
    }

    req.app.locals.extractions.set(roomId, {
      status: 'pending',
      text: content,
      libraryId: library_id,
      libraryName: library_name,
      generateSynopsis: generate_synopsis,
      createdAt: new Date(),
      promise: null,
      userId: req.user.id  // SECURITY FIX: Include user ID for ownership validation in socket handlers
    });

    // Clean up old extractions (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of req.app.locals.extractions) {
      if (value.createdAt.getTime() < oneHourAgo) {
        req.app.locals.extractions.delete(key);
      }
    }

    res.json({
      room_id: roomId,
      library_id: library_id,
      message: 'Join the Socket.IO room, then emit start-extraction to begin.'
    });

  } catch (error) {
    logger.error('[StoryBible] Error preparing advanced extraction:', error);
    res.status(500).json({ error: 'Failed to start extraction' });
  }
});

/**
 * Run advanced extraction with synopsis generation
 */
async function runAdvancedExtractionWithSynopsis(content, libraryId, libraryName, roomId, generateSynopsis = true) {
  const { generateWithOpenAI } = await import('../services/openai.js');
  const { getBroadcastIO } = await import('../socket/state.js');

  // Get io from socket state for socket emissions
  const io = getBroadcastIO();

  const emit = (event, data) => {
    if (io) {
      io.to(roomId).emit(event, data);
    }
  };

  try {
    emit('extraction-progress', { agent: 'coordinator', status: 'starting', message: 'Starting multi-agent extraction...' });

    // Extract characters
    emit('extraction-progress', { agent: 'characters', status: 'running', message: 'Extracting characters...' });
    const charactersResponse = await generateWithOpenAI({
      systemPrompt: `Extract all characters from the provided content. Return a JSON array of character objects with: name, description, role (protagonist/antagonist/supporting/minor), traits (array), and any backstory or relationships mentioned. Return ONLY valid JSON array, no markdown or explanations.`,
      userPrompt: content,
      temperature: 0.3,
      max_tokens: 4000
    });

    let characters = [];
    try {
      const cleanContent = charactersResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      characters = JSON.parse(cleanContent);
    } catch (e) {
      logger.warn('[StoryBible] Failed to parse characters:', e.message);
    }
    emit('extraction-progress', { agent: 'characters', status: 'complete', count: characters.length });

    // Extract locations
    emit('extraction-progress', { agent: 'locations', status: 'running', message: 'Extracting locations...' });
    const locationsResponse = await generateWithOpenAI({
      systemPrompt: `Extract all locations from the provided content. Return a JSON array of location objects with: name, description, type (city/building/room/natural/etc), and any notable features. Return ONLY valid JSON array, no markdown or explanations.`,
      userPrompt: content,
      temperature: 0.3,
      max_tokens: 3000
    });

    let locations = [];
    try {
      const cleanContent = locationsResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      locations = JSON.parse(cleanContent);
    } catch (e) {
      logger.warn('[StoryBible] Failed to parse locations:', e.message);
    }
    emit('extraction-progress', { agent: 'locations', status: 'complete', count: locations.length });

    // Extract items
    emit('extraction-progress', { agent: 'items', status: 'running', message: 'Extracting items...' });
    const itemsResponse = await generateWithOpenAI({
      systemPrompt: `Extract all significant items, objects, weapons, artifacts, and vehicles from the provided content. Return a JSON array of item objects with: name, description, type (weapon/vehicle/artifact/tool/etc), and any special properties. Return ONLY valid JSON array, no markdown or explanations.`,
      userPrompt: content,
      temperature: 0.3,
      max_tokens: 3000
    });

    let items = [];
    try {
      const cleanContent = itemsResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      items = JSON.parse(cleanContent);
    } catch (e) {
      logger.warn('[StoryBible] Failed to parse items:', e.message);
    }
    emit('extraction-progress', { agent: 'items', status: 'complete', count: items.length });

    // Extract factions
    emit('extraction-progress', { agent: 'factions', status: 'running', message: 'Extracting factions...' });
    const factionsResponse = await generateWithOpenAI({
      systemPrompt: `Extract all organizations, factions, groups, kingdoms, and guilds from the provided content. Return a JSON array of faction objects with: name, description, type (organization/kingdom/guild/etc), goals, and any notable members. Return ONLY valid JSON array, no markdown or explanations.`,
      userPrompt: content,
      temperature: 0.3,
      max_tokens: 3000
    });

    let factions = [];
    try {
      const cleanContent = factionsResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      factions = JSON.parse(cleanContent);
    } catch (e) {
      logger.warn('[StoryBible] Failed to parse factions:', e.message);
    }
    emit('extraction-progress', { agent: 'factions', status: 'complete', count: factions.length });

    // Extract lore
    emit('extraction-progress', { agent: 'lore', status: 'running', message: 'Extracting lore...' });
    const loreResponse = await generateWithOpenAI({
      systemPrompt: `Extract all lore entries including history, customs, rules, legends, magic systems, and world facts from the provided content. Return a JSON array of lore objects with: title, description, category (history/magic/custom/legend/rule/etc). Return ONLY valid JSON array, no markdown or explanations.`,
      userPrompt: content,
      temperature: 0.3,
      max_tokens: 3000
    });

    let lore = [];
    try {
      const cleanContent = loreResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      lore = JSON.parse(cleanContent);
    } catch (e) {
      logger.warn('[StoryBible] Failed to parse lore:', e.message);
    }
    emit('extraction-progress', { agent: 'lore', status: 'complete', count: lore.length });

    // Extract/create world
    emit('extraction-progress', { agent: 'world', status: 'running', message: 'Extracting world setting...' });
    const worldResponse = await generateWithOpenAI({
      systemPrompt: `Analyze the provided content and create a world setting object. Return a JSON object with: name (use "${libraryName || 'Story World'}"), description, genre, time_period, tone, themes (array of 3-5 themes). Return ONLY valid JSON object, no markdown or explanations.`,
      userPrompt: content,
      temperature: 0.5,
      max_tokens: 1500
    });

    let world = null;
    try {
      const cleanContent = worldResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      world = JSON.parse(cleanContent);
    } catch (e) {
      logger.warn('[StoryBible] Failed to parse world:', e.message);
    }
    emit('extraction-progress', { agent: 'world', status: 'complete', count: world ? 1 : 0 });

    // Generate synopsis if requested
    let synopsis = null;
    if (generateSynopsis) {
      emit('extraction-progress', { agent: 'synopsis', status: 'running', message: 'Generating synopsis...' });
      const synopsisResponse = await generateWithOpenAI({
        systemPrompt: `Based on the provided story content, create a story synopsis. Return a JSON object with:
- title: "${libraryName || 'Untitled Story'}" (use this as the title)
- logline: One sentence hook (max 100 words)
- synopsis: 2-3 paragraph story summary that captures the main plot, conflict, and characters
- genre: Primary genre
- mood: Overall story mood
- themes: Array of 3-5 key themes

Return ONLY valid JSON object, no markdown or explanations.`,
        userPrompt: content,
        temperature: 0.7,
        max_tokens: 2000
      });

      try {
        const cleanContent = synopsisResponse.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
        synopsis = JSON.parse(cleanContent);
      } catch (e) {
        logger.warn('[StoryBible] Failed to parse synopsis:', e.message);
      }
      emit('extraction-progress', { agent: 'synopsis', status: 'complete', count: synopsis ? 1 : 0 });
    }

    // Compile results
    const extractedData = {
      characters,
      locations,
      items,
      factions,
      lore,
      world,
      synopsis
    };

    emit('extraction-complete', extractedData);
    logger.info(`[StoryBible] Advanced extraction complete for room ${roomId}`);

  } catch (error) {
    logger.error(`[StoryBible] Advanced extraction error for room ${roomId}:`, error);
    emit('extraction-error', { message: error.message });
  }
}

// =============================================================================
// EVENTS (Planned Story Moments)
// =============================================================================

/**
 * GET /api/story-bible/events
 * List all events in user's library
 */
router.get('/events', async (req, res) => {
  try {
    const userId = req.query.user_id || DEFAULT_USER_ID;
    const libraryId = req.query.library_id;
    const eventType = req.query.event_type;
    const importance = req.query.importance;
    const incorporated = req.query.incorporated;
    const search = req.query.search || '';
    const tags = req.query.tags ? req.query.tags.split(',') : [];

    let targetLibraryId = libraryId;
    if (!targetLibraryId) {
      const library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );
      if (library.rows.length === 0) {
        return res.json({ events: [], count: 0 });
      }
      targetLibraryId = library.rows[0].id;
    }

    let query = 'SELECT * FROM library_events WHERE library_id = $1';
    const params = [targetLibraryId];
    let paramIndex = 2;

    if (eventType) {
      query += ` AND event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }

    if (importance) {
      query += ` AND importance = $${paramIndex}`;
      params.push(importance);
      paramIndex++;
    }

    if (incorporated !== undefined) {
      query += ` AND is_incorporated = $${paramIndex}`;
      params.push(incorporated === 'true');
      paramIndex++;
    }

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (tags.length > 0) {
      query += ` AND tags && $${paramIndex}::text[]`;
      params.push(tags);
      paramIndex++;
    }

    // Support different ordering modes
    const orderBy = req.query.order_by || 'chronological';
    if (orderBy === 'chronological') {
      // User-defined chronological order (drag-and-drop)
      query += ' ORDER BY sort_order ASC, created_at ASC';
    } else if (orderBy === 'importance') {
      // Legacy ordering by importance
      query += ' ORDER BY is_favorite DESC, CASE importance WHEN \'major\' THEN 1 WHEN \'supporting\' THEN 2 ELSE 3 END, use_count DESC, updated_at DESC';
    } else if (orderBy === 'timing') {
      // Order by suggested_timing (early → middle → climax → resolution → any)
      query += ' ORDER BY CASE suggested_timing WHEN \'early\' THEN 1 WHEN \'middle\' THEN 2 WHEN \'climax\' THEN 3 WHEN \'resolution\' THEN 4 ELSE 5 END, sort_order ASC';
    } else {
      // Default to chronological
      query += ' ORDER BY sort_order ASC, created_at ASC';
    }

    const result = await pool.query(query, params);

    res.json({
      events: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /api/story-bible/events/:id
 * Get single event with participating characters
 */
router.get('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const event = await pool.query(
      'SELECT * FROM library_events WHERE id = $1',
      [id]
    );

    if (event.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get participating characters
    const participants = await pool.query(`
      SELECT cep.*, c.name as character_name, c.role as character_role
      FROM character_event_participation cep
      JOIN library_characters c ON c.id = cep.character_id
      WHERE cep.event_id = $1
      ORDER BY cep.significance, c.name
    `, [id]);

    res.json({
      event: event.rows[0],
      participants: participants.rows
    });

  } catch (error) {
    logger.error('[StoryBible] Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

/**
 * POST /api/story-bible/events
 * Create a new event
 */
router.post('/events', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const {
      library_id, name, description, event_type, importance,
      characters_involved, character_ids, factions_involved,
      location_name, location_id, location_notes,
      suggested_timing, prerequisites, consequences,
      emotional_tone, stakes, conflict_type,
      key_elements, dialogue_hints, visual_details, notes,
      image_url, image_prompt, tags, confidence, extraction_notes
    } = req.body;

    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    let targetLibraryId = library_id;
    if (!targetLibraryId) {
      let library = await pool.query(
        'SELECT id FROM user_libraries WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
      );

      if (library.rows.length === 0) {
        library = await pool.query(`
          INSERT INTO user_libraries (user_id, name)
          VALUES ($1, 'My Library')
          RETURNING id
        `, [userId]);
      }
      targetLibraryId = library.rows[0].id;
    }

    const result = await pool.query(`
      INSERT INTO library_events (
        library_id, name, description, event_type, importance,
        characters_involved, character_ids, factions_involved,
        location_name, location_id, location_notes,
        suggested_timing, prerequisites, consequences,
        emotional_tone, stakes, conflict_type,
        key_elements, dialogue_hints, visual_details, notes,
        image_url, image_prompt, tags, confidence, extraction_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING *
    `, [
      targetLibraryId, name, description, event_type || 'action', importance || 'major',
      characters_involved || [], character_ids || [], factions_involved || [],
      location_name, location_id, location_notes,
      suggested_timing, prerequisites || [], consequences || [],
      emotional_tone, stakes, conflict_type,
      key_elements || [], dialogue_hints, visual_details, notes,
      image_url, image_prompt, tags || [], confidence || 'medium', extraction_notes
    ]);

    logger.info(`[StoryBible] Created event: ${name}`);
    res.status(201).json({ event: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * PUT /api/story-bible/events/:id
 * Update an event
 */
router.put('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, description, event_type, importance,
      characters_involved, character_ids, factions_involved,
      location_name, location_id, location_notes,
      suggested_timing, prerequisites, consequences,
      emotional_tone, stakes, conflict_type,
      key_elements, dialogue_hints, visual_details, notes,
      is_incorporated, incorporated_in_chapter, incorporated_beat_id,
      image_url, image_prompt, tags, is_favorite, confidence, extraction_notes
    } = req.body;

    // Save version before updating
    await saveEntityVersion('event', id);

    const result = await pool.query(`
      UPDATE library_events SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        event_type = COALESCE($4, event_type),
        importance = COALESCE($5, importance),
        characters_involved = COALESCE($6, characters_involved),
        character_ids = COALESCE($7, character_ids),
        factions_involved = COALESCE($8, factions_involved),
        location_name = COALESCE($9, location_name),
        location_id = COALESCE($10, location_id),
        location_notes = COALESCE($11, location_notes),
        suggested_timing = COALESCE($12, suggested_timing),
        prerequisites = COALESCE($13, prerequisites),
        consequences = COALESCE($14, consequences),
        emotional_tone = COALESCE($15, emotional_tone),
        stakes = COALESCE($16, stakes),
        conflict_type = COALESCE($17, conflict_type),
        key_elements = COALESCE($18, key_elements),
        dialogue_hints = COALESCE($19, dialogue_hints),
        visual_details = COALESCE($20, visual_details),
        notes = COALESCE($21, notes),
        is_incorporated = COALESCE($22, is_incorporated),
        incorporated_in_chapter = COALESCE($23, incorporated_in_chapter),
        incorporated_beat_id = COALESCE($24, incorporated_beat_id),
        image_url = COALESCE($25, image_url),
        image_prompt = COALESCE($26, image_prompt),
        tags = COALESCE($27, tags),
        is_favorite = COALESCE($28, is_favorite),
        confidence = COALESCE($29, confidence),
        extraction_notes = COALESCE($30, extraction_notes),
        version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      id, name, description, event_type, importance,
      characters_involved, character_ids, factions_involved,
      location_name, location_id, location_notes,
      suggested_timing, prerequisites, consequences,
      emotional_tone, stakes, conflict_type,
      key_elements, dialogue_hints, visual_details, notes,
      is_incorporated, incorporated_in_chapter, incorporated_beat_id,
      image_url, image_prompt, tags, is_favorite, confidence, extraction_notes
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

/**
 * DELETE /api/story-bible/events/:id
 * Delete an event
 */
router.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Remove participation records
    await pool.query('DELETE FROM character_event_participation WHERE event_id = $1', [id]);
    await pool.query('DELETE FROM library_events WHERE id = $1', [id]);

    res.json({ message: 'Event deleted' });

  } catch (error) {
    logger.error('[StoryBible] Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * POST /api/story-bible/events/reorder
 * Reorder events (drag-and-drop support)
 */
router.post('/events/reorder', async (req, res) => {
  try {
    const { library_id, event_ids } = req.body;

    if (!library_id || !event_ids || !Array.isArray(event_ids)) {
      return res.status(400).json({ error: 'library_id and event_ids array are required' });
    }

    // Update sort_order for each event based on array position
    for (let i = 0; i < event_ids.length; i++) {
      await pool.query(
        'UPDATE library_events SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND library_id = $3',
        [i + 1, event_ids[i], library_id]
      );
    }

    // Return updated events in new order - DB LIMIT PROTECTION
    const result = await pool.query(
      'SELECT * FROM library_events WHERE library_id = $1 ORDER BY sort_order ASC LIMIT 500',
      [library_id]
    );

    res.json({ events: result.rows, message: 'Events reordered successfully' });

  } catch (error) {
    logger.error('[StoryBible] Error reordering events:', error);
    res.status(500).json({ error: 'Failed to reorder events' });
  }
});

/**
 * POST /api/story-bible/events/:id/move
 * Move a single event to a new position
 */
router.post('/events/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { new_position, library_id } = req.body;

    if (new_position === undefined || !library_id) {
      return res.status(400).json({ error: 'new_position and library_id are required' });
    }

    // Get current event
    const current = await pool.query(
      'SELECT sort_order FROM library_events WHERE id = $1',
      [id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const oldPosition = current.rows[0].sort_order;

    // Shift other events
    if (new_position > oldPosition) {
      // Moving down: shift events between old and new position up
      await pool.query(`
        UPDATE library_events
        SET sort_order = sort_order - 1
        WHERE library_id = $1 AND sort_order > $2 AND sort_order <= $3`,
        [library_id, oldPosition, new_position]
      );
    } else if (new_position < oldPosition) {
      // Moving up: shift events between new and old position down
      await pool.query(`
        UPDATE library_events
        SET sort_order = sort_order + 1
        WHERE library_id = $1 AND sort_order >= $2 AND sort_order < $3`,
        [library_id, new_position, oldPosition]
      );
    }

    // Set new position for moved event
    await pool.query(
      'UPDATE library_events SET sort_order = $1, updated_at = NOW() WHERE id = $2',
      [new_position, id]
    );

    // Return updated event
    const result = await pool.query('SELECT * FROM library_events WHERE id = $1', [id]);
    res.json({ event: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error moving event:', error);
    res.status(500).json({ error: 'Failed to move event' });
  }
});

// =============================================================================
// OUTLINE-EVENT LINKING
// =============================================================================

/**
 * POST /api/story-bible/outline-events
 * Link an event to an outline chapter
 */
router.post('/outline-events', async (req, res) => {
  try {
    const { synopsis_id, chapter_number, event_id, position_in_chapter, notes } = req.body;

    if (!synopsis_id || chapter_number === undefined || !event_id) {
      return res.status(400).json({ error: 'synopsis_id, chapter_number, and event_id are required' });
    }

    const result = await pool.query(`
      INSERT INTO outline_chapter_events (synopsis_id, chapter_number, event_id, position_in_chapter, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (synopsis_id, chapter_number, event_id)
      DO UPDATE SET position_in_chapter = EXCLUDED.position_in_chapter, notes = EXCLUDED.notes
      RETURNING *
    `, [synopsis_id, chapter_number, event_id, position_in_chapter || 0, notes || null]);

    // Update event's incorporated status
    await pool.query(`
      UPDATE library_events
      SET is_incorporated = true, incorporated_in_chapter = $2, updated_at = NOW()
      WHERE id = $1
    `, [event_id, chapter_number]);

    res.json({ link: result.rows[0] });

  } catch (error) {
    logger.error('[StoryBible] Error linking event to chapter:', error);
    res.status(500).json({ error: 'Failed to link event to chapter' });
  }
});

/**
 * GET /api/story-bible/outline-events/:synopsis_id
 * Get all event links for a synopsis
 */
router.get('/outline-events/:synopsis_id', async (req, res) => {
  try {
    const { synopsis_id } = req.params;
    const chapter_number = req.query.chapter_number;

    let query = `
      SELECT oce.*, e.name as event_name, e.description as event_description,
             e.event_type, e.importance, e.emotional_tone
      FROM outline_chapter_events oce
      JOIN library_events e ON oce.event_id = e.id
      WHERE oce.synopsis_id = $1
    `;
    const params = [synopsis_id];

    if (chapter_number !== undefined) {
      query += ' AND oce.chapter_number = $2';
      params.push(parseInt(chapter_number));
    }

    query += ' ORDER BY oce.chapter_number, oce.position_in_chapter';

    const result = await pool.query(query, params);

    // Group by chapter for easier frontend consumption
    const byChapter = {};
    for (const row of result.rows) {
      if (!byChapter[row.chapter_number]) {
        byChapter[row.chapter_number] = [];
      }
      byChapter[row.chapter_number].push(row);
    }

    res.json({ links: result.rows, by_chapter: byChapter });

  } catch (error) {
    logger.error('[StoryBible] Error fetching outline events:', error);
    res.status(500).json({ error: 'Failed to fetch outline events' });
  }
});

/**
 * DELETE /api/story-bible/outline-events/:id
 * Remove an event from an outline chapter
 */
router.delete('/outline-events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get the link to update the event
    const link = await pool.query('SELECT * FROM outline_chapter_events WHERE id = $1', [id]);

    if (link.rows.length > 0) {
      const eventId = link.rows[0].event_id;

      // Delete the link
      await pool.query('DELETE FROM outline_chapter_events WHERE id = $1', [id]);

      // Check if event is still linked to any chapter
      const remaining = await pool.query(
        'SELECT COUNT(*) FROM outline_chapter_events WHERE event_id = $1',
        [eventId]
      );

      // If no more links, update event's incorporated status
      if (parseInt(remaining.rows[0].count) === 0) {
        await pool.query(`
          UPDATE library_events
          SET is_incorporated = false, incorporated_in_chapter = null, updated_at = NOW()
          WHERE id = $1
        `, [eventId]);
      }
    }

    res.json({ message: 'Event unlinked from chapter' });

  } catch (error) {
    logger.error('[StoryBible] Error unlinking event:', error);
    res.status(500).json({ error: 'Failed to unlink event' });
  }
});

/**
 * POST /api/story-bible/outline-events/reorder
 * Reorder events within a chapter
 */
router.post('/outline-events/reorder', async (req, res) => {
  try {
    const { synopsis_id, chapter_number, event_ids } = req.body;

    if (!synopsis_id || chapter_number === undefined || !event_ids || !Array.isArray(event_ids)) {
      return res.status(400).json({ error: 'synopsis_id, chapter_number, and event_ids array are required' });
    }

    // Update position_in_chapter for each event
    for (let i = 0; i < event_ids.length; i++) {
      await pool.query(`
        UPDATE outline_chapter_events
        SET position_in_chapter = $1
        WHERE synopsis_id = $2 AND chapter_number = $3 AND event_id = $4
      `, [i, synopsis_id, chapter_number, event_ids[i]]);
    }

    // Return updated links
    const result = await pool.query(`
      SELECT oce.*, e.name as event_name
      FROM outline_chapter_events oce
      JOIN library_events e ON oce.event_id = e.id
      WHERE oce.synopsis_id = $1 AND oce.chapter_number = $2
      ORDER BY oce.position_in_chapter
    `, [synopsis_id, chapter_number]);

    res.json({ links: result.rows });

  } catch (error) {
    logger.error('[StoryBible] Error reordering chapter events:', error);
    res.status(500).json({ error: 'Failed to reorder chapter events' });
  }
});

/**
 * POST /api/story-bible/synopsis/:id/auto-link-events
 * PHASE 7 FIX: Automatically link library events to outline chapters using AI
 */
router.post('/synopsis/:id/auto-link-events', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.body.user_id || DEFAULT_USER_ID;

    // Get synopsis with outline
    const synopsis = await pool.query('SELECT * FROM library_synopsis WHERE id = $1', [id]);
    if (synopsis.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const synopsisData = synopsis.rows[0];
    const outline = synopsisData.outline_json;

    if (!outline?.chapters?.length) {
      return res.status(400).json({ error: 'Generate outline first before auto-linking events' });
    }

    // Get unlinked events - DB LIMIT PROTECTION
    const events = await pool.query(`
      SELECT * FROM library_events
      WHERE library_id = $1 AND is_incorporated = false
      ORDER BY importance DESC, sort_order
      LIMIT 500
    `, [synopsisData.library_id]);

    if (events.rows.length === 0) {
      return res.json({ linked: 0, total: 0, message: 'No unlinked events to process' });
    }

    logger.info(`[StoryBible] Auto-linking ${events.rows.length} events to ${outline.chapters.length} chapters`);

    // Import OpenAI
    const { generateWithOpenAI } = await import('../services/openai.js');

    const systemPrompt = `You are a story structure expert. Match events to the most appropriate chapter based on:
- Event timing hints (early, middle, climax, resolution)
- Event description and chapter summary
- Character involvement
- Logical story flow and narrative arc
- Event prerequisites and consequences

Return JSON:
{
  "links": [
    {
      "event_name": "exact event name",
      "chapter_number": 1,
      "position": 1,
      "confidence": "high|medium|low",
      "reasoning": "brief explanation of why this event fits this chapter"
    }
  ]
}

RULES:
1. Only link events where you're confident about the placement (medium or high confidence)
2. Consider event timing hints (e.g., "climax" events go in later chapters)
3. Events with prerequisites should come after events that satisfy them
4. Major events should be spread across chapters, not clustered
5. Each event should be linked to exactly one chapter (or not at all if unsure)`;

    const userPrompt = `Match these events to the most appropriate chapters.

OUTLINE CHAPTERS:
${outline.chapters.map(c => `Chapter ${c.chapter_number}: "${c.title}" - ${c.summary}`).join('\n')}

EVENTS TO PLACE:
${events.rows.map(e => `- "${e.name}" (${e.importance}, timing: ${e.suggested_timing || 'any'})
  Description: ${e.description}
  Characters: ${(e.characters_involved || []).join(', ')}
  Prerequisites: ${(e.prerequisites || []).join(', ') || 'none'}
  Emotional tone: ${e.emotional_tone || 'unspecified'}`).join('\n\n')}

Determine the best chapter placement for each event. Only link events where you're confident about placement.`;

    const result = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      model: 'gpt-4o',
      temperature: 0.3,
      responseFormat: { type: 'json_object' }
    });

    const linkData = JSON.parse(result.content);
    let linked = 0;

    // Process the links
    for (const link of (linkData.links || [])) {
      const event = events.rows.find(e => e.name === link.event_name);
      if (!event) {
        logger.warn(`[StoryBible] Event not found for link: "${link.event_name}"`);
        continue;
      }

      // Only link if confidence is not low
      if (link.confidence === 'low') {
        logger.info(`[StoryBible] Skipping low-confidence link: "${link.event_name}" -> Chapter ${link.chapter_number}`);
        continue;
      }

      try {
        // Insert link
        await pool.query(`
          INSERT INTO outline_chapter_events (synopsis_id, chapter_number, event_id, position_in_chapter, notes)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (synopsis_id, chapter_number, event_id) DO NOTHING
        `, [id, link.chapter_number, event.id, link.position || 0, link.reasoning || null]);

        // Update event's incorporated status
        await pool.query(`
          UPDATE library_events
          SET is_incorporated = true, incorporated_in_chapter = $2, updated_at = NOW()
          WHERE id = $1
        `, [event.id, link.chapter_number]);

        linked++;
        logger.debug(`[StoryBible] Linked event "${event.name}" to Chapter ${link.chapter_number}`);
      } catch (e) {
        logger.warn(`[StoryBible] Failed to link event "${event.name}":`, e.message);
      }
    }

    logger.info(`[StoryBible] Auto-linked ${linked}/${events.rows.length} events`);

    res.json({
      linked,
      total: events.rows.length,
      links: linkData.links || [],
      synopsis_id: id
    });

  } catch (error) {
    logger.error('[StoryBible] Error auto-linking events:', error);
    res.status(500).json({ error: 'Failed to auto-link events' });
  }
});

// =============================================================================
// CHARACTER-EVENT PARTICIPATION
// =============================================================================

/**
 * POST /api/story-bible/event-participation
 * Add a character to an event
 */
router.post('/event-participation', async (req, res) => {
  try {
    const userId = req.body.user_id || DEFAULT_USER_ID;
    const { character_id, event_id, role_in_event, significance, notes } = req.body;

    if (!character_id || !event_id) {
      return res.status(400).json({ error: 'character_id and event_id are required' });
    }

    // Get library
    const library = await pool.query(
      'SELECT id FROM user_libraries WHERE user_id = $1',
      [userId]
    );

    if (library.rows.length === 0) {
      return res.status(404).json({ error: 'Library not found' });
    }

    const result = await pool.query(`
      INSERT INTO character_event_participation (
        library_id, character_id, event_id, role_in_event, significance, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [library.rows[0].id, character_id, event_id, role_in_event, significance || 'primary', notes]);

    res.status(201).json({ participation: result.rows[0] });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Character is already participating in this event' });
    }
    logger.error('[StoryBible] Error creating event participation:', error);
    res.status(500).json({ error: 'Failed to create event participation' });
  }
});

/**
 * DELETE /api/story-bible/event-participation/:id
 * Remove a character from an event
 */
router.delete('/event-participation/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM character_event_participation WHERE id = $1', [id]);
    res.json({ message: 'Event participation removed' });
  } catch (error) {
    logger.error('[StoryBible] Error deleting event participation:', error);
    res.status(500).json({ error: 'Failed to delete event participation' });
  }
});

/**
 * POST /api/story-bible/save-extracted
 * Save extracted data to the library
 */
router.post('/save-extracted', async (req, res) => {
  try {
    const { library_id, data } = req.body;

    if (!library_id || !data) {
      return res.status(400).json({ error: 'library_id and data are required' });
    }

    const results = {
      characters: 0,
      locations: 0,
      items: 0,
      factions: 0,
      events: 0,
      lore: 0,
      relationships: 0,
      world: false,
      synopsis: false
    };

    // Save characters with validation - EXACT COPY of bulk-import-advanced/save logic
    const characterNameToId = new Map();
    if (data.characters?.length > 0) {
      for (const char of data.characters) {
        try {
          // === VALIDATION: Species and Vital Status Correction ===
          const textToCheck = `${char.description || ''} ${char.backstory || ''} ${char.vital_status_summary || ''}`.toLowerCase();

          // Species correction - check description for animal indicators
          const animalPatterns = /\b(great dane|pitbull|pit bull|mastiff|retriever|shepherd|hound|canine|dog|cat|horse|owl|wolf|feline)\b/i;
          const animalMatch = textToCheck.match(animalPatterns);
          if (animalMatch && (!char.species || char.species === 'human')) {
            const detectedSpecies = animalMatch[0].toLowerCase().includes('dane') ||
                                    animalMatch[0].toLowerCase().includes('pitbull') ||
                                    animalMatch[0].toLowerCase().includes('pit bull') ||
                                    animalMatch[0].toLowerCase().includes('mastiff') ||
                                    animalMatch[0].toLowerCase().includes('retriever') ||
                                    animalMatch[0].toLowerCase().includes('shepherd') ||
                                    animalMatch[0].toLowerCase().includes('hound') ||
                                    animalMatch[0].toLowerCase().includes('canine') ? 'dog' : animalMatch[0].toLowerCase();
            logger.info(`[StoryBible] Correcting species for ${char.name}: human → ${detectedSpecies}`);
            char.species = detectedSpecies;
            char.is_animal_companion = true;
          }

          // Vital status correction - check for deceased indicators
          const deceasedPatterns = /\b(deceased|died|dead|killed|passed away|fallen|late father|late mother|parents.*deceased)\b/i;
          if (deceasedPatterns.test(textToCheck) && char.is_alive !== false) {
            logger.info(`[StoryBible] Correcting vital status for ${char.name}: alive → deceased`);
            char.is_alive = false;
            char.is_deceased = true;
            if (!char.vital_status_summary) {
              char.vital_status_summary = 'DECEASED - Mentioned as deceased in source material';
            }
          }

          // Ensure is_alive is set correctly based on is_deceased
          if (char.is_deceased === true) {
            char.is_alive = false;
          } else if (char.is_alive === undefined) {
            char.is_alive = true;
          }

          const result = await pool.query(`
            INSERT INTO library_characters (
              library_id, name, display_name, role, description, personality, traits_json, backstory,
              voice_description, gender, age_group, age_specific, appearance, clothing_style, physical_condition,
              species, is_animal_companion, companion_to_character_id,
              is_alive, is_deceased, vital_status_summary, death_details, death_context, is_historical,
              occupation, former_occupations, social_status, education, origin,
              abilities, skills, weaknesses, signature_moves,
              motivations, secrets, internal_conflicts, external_conflicts,
              enemies, allies, romantic_interests, family,
              dialogue_style, first_appearance_context, character_arc, symbolic_role,
              values_json, fears, flaws, strengths, faction_allegiance, confidence, extraction_notes
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13, $14, $15,
              $16, $17, $18,
              $19, $20, $21, $22, $23, $24,
              $25, $26, $27, $28, $29,
              $30, $31, $32, $33,
              $34, $35, $36, $37,
              $38, $39, $40, $41,
              $42, $43, $44, $45,
              $46, $47, $48, $49, $50, $51, $52
            )
            RETURNING *
          `, [
            library_id,
            char.name,
            char.display_name || null,
            char.role || 'supporting',
            char.description || null,
            char.personality || null,
            JSON.stringify(char.traits || char.traits_json || []),
            char.backstory || null,
            char.voice_description || null,
            char.gender || 'unknown',
            char.age_group || 'unknown',
            char.age_specific || null,
            char.appearance || null,
            char.clothing_style || null,
            char.physical_condition || null,
            char.species || 'human',
            char.is_animal_companion || false,
            null, // companion_to_character_id - resolve after all characters created
            char.is_alive !== undefined ? char.is_alive : true,
            char.is_deceased || false,
            char.vital_status_summary || (char.is_deceased ? 'DECEASED' : 'ALIVE'),
            char.death_details ? JSON.stringify(char.death_details) : null,
            char.death_context || null,
            char.is_historical || false,
            char.occupation || null,
            char.former_occupations || null,
            char.social_status || null,
            char.education || null,
            char.origin || null,
            char.abilities || null,
            char.skills || null,
            char.weaknesses || null,
            char.signature_moves || null,
            char.motivations || null,
            char.secrets || null,
            char.internal_conflicts || null,
            char.external_conflicts || null,
            char.enemies || null,
            char.allies || null,
            char.romantic_interests || null,
            char.family || null,  // family is ARRAY type, not JSONB
            char.dialogue_style || null,
            char.first_appearance_context || null,
            char.character_arc || null,
            char.symbolic_role || null,
            char.values_json ? JSON.stringify(char.values_json) : (char.values ? JSON.stringify(char.values) : null),
            char.fears || null,
            char.flaws || null,
            char.strengths || null,
            char.faction_allegiance || null,
            char.confidence || 'medium',
            char.extraction_notes || null
          ]);
          characterNameToId.set(char.name?.toLowerCase(), result.rows[0].id);
          results.characters++;
        } catch (e) {
          logger.warn(`[StoryBible] Failed to create character ${char.name}:`, e.message);
        }
      }
    }

    // Save locations
    if (data.locations?.length > 0) {
      for (const loc of data.locations) {
        await pool.query(`
          INSERT INTO library_locations (library_id, name, description, location_type, atmosphere)
          VALUES ($1, $2, $3, $4, $5)
        `, [library_id, loc.name, loc.description || '', loc.location_type || loc.type || 'other', loc.atmosphere || null]);
        results.locations++;
      }
    }

    // Save items
    if (data.items?.length > 0) {
      for (const item of data.items) {
        await pool.query(`
          INSERT INTO library_items (library_id, name, description, item_type, rarity, magical_properties)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          library_id,
          item.name,
          item.description || '',
          item.item_type || item.type || 'misc',
          item.rarity || 'common',
          item.magical_properties || item.properties || null
        ]);
        results.items++;
      }
    }

    // Save factions
    if (data.factions?.length > 0) {
      for (const faction of data.factions) {
        await pool.query(`
          INSERT INTO library_factions (library_id, name, description, faction_type, goals, alignment)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          library_id,
          faction.name,
          faction.description || '',
          faction.faction_type || faction.type || 'organization',
          faction.goals || [],
          faction.alignment || null
        ]);
        results.factions++;
      }
    }

    // Save events
    if (data.events?.length > 0) {
      for (const event of data.events) {
        await pool.query(`
          INSERT INTO library_events (
            library_id, name, description, event_type, importance,
            characters_involved, factions_involved, location_name,
            suggested_timing, prerequisites, consequences,
            emotional_tone, stakes, conflict_type,
            key_elements, dialogue_hints, visual_details, notes,
            tags, confidence, extraction_notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        `, [
          library_id,
          event.name,
          event.description || '',
          event.event_type || 'action',
          event.importance || 'major',
          event.characters_involved || [],
          event.factions_involved || [],
          event.location_name || null,
          event.suggested_timing || null,
          event.prerequisites || [],
          event.consequences || [],
          event.emotional_tone || null,
          event.stakes || null,
          event.conflict_type || null,
          event.key_elements || [],
          event.dialogue_hints || null,
          event.visual_details || null,
          event.notes || null,
          event.tags || [],
          event.confidence || 'medium',
          event.extraction_notes || null
        ]);
        results.events++;
      }
    }

    // Save lore
    if (data.lore?.length > 0) {
      for (const entry of data.lore) {
        await pool.query(`
          INSERT INTO library_lore (library_id, title, content, entry_type, importance)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          library_id,
          entry.title,
          entry.content || entry.description || '',
          entry.entry_type || entry.category || 'history',
          entry.importance || 50
        ]);
        results.lore++;
      }
    }

    // Save world
    if (data.world) {
      // Check if world exists
      const existingWorld = await pool.query(
        'SELECT id FROM library_worlds WHERE library_id = $1',
        [library_id]
      );

      if (existingWorld.rows.length > 0) {
        // Update existing
        await pool.query(`
          UPDATE library_worlds
          SET name = $2, description = $3, genre = $4, time_period = $5, tone = $6, themes = $7
          WHERE library_id = $1
        `, [library_id, data.world.name, data.world.description || '', data.world.genre || '', data.world.time_period || '', data.world.tone || '', data.world.themes || []]);
      } else {
        // Insert new
        await pool.query(`
          INSERT INTO library_worlds (library_id, name, description, genre, time_period, tone, themes)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [library_id, data.world.name, data.world.description || '', data.world.genre || '', data.world.time_period || '', data.world.tone || '', data.world.themes || []]);
      }
      results.world = true;
    }

    // Save relationships (character_connections)
    // Handle both flat array (data.relationships) and nested structure (data.relationships.character_relationships)
    let relationshipsToSave = [];
    if (Array.isArray(data.relationships)) {
      relationshipsToSave = data.relationships;
    } else if (data.relationships?.character_relationships) {
      relationshipsToSave = data.relationships.character_relationships;
    }

    if (relationshipsToSave.length > 0) {
      // Build character name to ID mapping
      const savedChars = await pool.query(
        'SELECT id, LOWER(name) as name FROM library_characters WHERE library_id = $1',
        [library_id]
      );
      const characterNameToId = new Map();
      savedChars.rows.forEach(c => characterNameToId.set(c.name, c.id));

      logger.info(`[StoryBible] Processing ${relationshipsToSave.length} relationships for save`);

      for (const rel of relationshipsToSave) {
        const charAId = characterNameToId.get(rel.character_a?.toLowerCase());
        const charBId = characterNameToId.get(rel.character_b?.toLowerCase());

        if (charAId && charBId) {
          try {
            await pool.query(`
              INSERT INTO character_connections (
                library_id, character_a_id, character_b_id, relationship_type,
                relationship_label, is_directional, reverse_relationship_type,
                description, current_status, dynamics
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (character_a_id, character_b_id) DO UPDATE SET
                relationship_type = EXCLUDED.relationship_type,
                description = EXCLUDED.description,
                relationship_label = EXCLUDED.relationship_label
            `, [
              library_id,
              charAId,
              charBId,
              rel.relationship_type || rel.type || 'associated',
              rel.label || rel.relationship_type || null,
              rel.is_directional || false,
              rel.reverse_type || null,
              rel.description || null,
              rel.status || rel.current_status || 'active',
              rel.dynamics || null
            ]);
            results.relationships++;
          } catch (relError) {
            logger.warn(`[StoryBible] Failed to save relationship ${rel.character_a} - ${rel.character_b}: ${relError.message}`);
          }
        } else {
          logger.warn(`[StoryBible] Could not find character IDs for relationship: ${rel.character_a} (${charAId}) - ${rel.character_b} (${charBId})`);
        }
      }

      logger.info(`[StoryBible] Saved ${results.relationships} character relationships`);
    }

    // Save synopsis (with source_chapters if available)
    if (data.synopsis) {
      // Check if synopsis exists
      const existingSynopsis = await pool.query(
        'SELECT id FROM library_synopsis WHERE library_id = $1',
        [library_id]
      );

      // Include source_chapters if extracted
      const sourceChapters = data.chapterStructure?.has_explicit_structure ? data.chapterStructure : null;
      if (sourceChapters) {
        logger.info(`[StoryBible] Including source chapter structure: ${sourceChapters.total_chapters} chapters`);
      }

      if (existingSynopsis.rows.length > 0) {
        // Update existing
        await pool.query(`
          UPDATE library_synopsis
          SET title = $2, logline = $3, synopsis = $4, genre = $5, mood = $6, themes = $7, source_chapters = $8
          WHERE library_id = $1
        `, [
          library_id,
          data.synopsis.title,
          data.synopsis.logline || '',
          data.synopsis.synopsis || '',
          data.synopsis.genre || '',
          data.synopsis.mood || '',
          data.synopsis.themes || [],
          sourceChapters ? JSON.stringify(sourceChapters) : null
        ]);
      } else {
        // Insert new
        await pool.query(`
          INSERT INTO library_synopsis (library_id, title, logline, synopsis, genre, mood, themes, source_chapters)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          library_id,
          data.synopsis.title,
          data.synopsis.logline || '',
          data.synopsis.synopsis || '',
          data.synopsis.genre || '',
          data.synopsis.mood || '',
          data.synopsis.themes || [],
          sourceChapters ? JSON.stringify(sourceChapters) : null
        ]);
      }
      results.synopsis = true;
    }

    logger.info(`[StoryBible] Saved extracted data to library ${library_id}:`, results);
    res.json({ success: true, results });

  } catch (error) {
    logger.error('[StoryBible] Error saving extracted data:', error);
    res.status(500).json({ error: 'Failed to save extracted data' });
  }
});

// =============================================================================
// CHAPTER-EVENT LINKING
// =============================================================================

async function getSynopsisAccess(synopsisId, user) {
  const result = await pool.query(
    `SELECT ls.id, ls.library_id, ul.user_id
     FROM library_synopsis ls
     JOIN user_libraries ul ON ul.id = ls.library_id
     WHERE ls.id = $1`,
    [synopsisId]
  );

  if (result.rows.length === 0) {
    return { error: { status: 404, message: 'Synopsis not found' } };
  }

  const synopsis = result.rows[0];
  if (!user?.is_admin && synopsis.user_id !== user?.id) {
    return { error: { status: 403, message: 'Not authorized to access this synopsis' } };
  }

  return { synopsis };
}

/**
 * POST /api/story-bible/synopsis/:id/chapter/:chapterNumber/link-events
 * Link timeline events to a chapter
 */
router.post('/synopsis/:id/chapter/:chapterNumber/link-events', async (req, res) => {
  try {
    const { id, chapterNumber } = req.params;
    const { event_ids } = req.body;

    if (!Array.isArray(event_ids)) {
      return res.status(400).json({ error: 'event_ids must be an array' });
    }

    const access = await getSynopsisAccess(id, req.user);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const chapterNum = parseInt(chapterNumber, 10);
    if (!Number.isInteger(chapterNum) || chapterNum < 1) {
      return res.status(400).json({ error: 'chapterNumber must be a positive integer' });
    }

    const sanitizedEventIds = event_ids.map(eventId => String(eventId).trim()).filter(Boolean);

    if (sanitizedEventIds.length !== event_ids.length) {
      return res.status(400).json({ error: 'event_ids contains invalid values' });
    }

    if (sanitizedEventIds.length > 0) {
      const validEvents = await pool.query(
        `SELECT id::text AS id
         FROM library_events
         WHERE library_id = $1
           AND id::text = ANY($2::text[])`,
        [access.synopsis.library_id, sanitizedEventIds]
      );

      const validSet = new Set(validEvents.rows.map(row => row.id));
      const invalidEventIds = sanitizedEventIds.filter(eventId => !validSet.has(eventId));
      if (invalidEventIds.length > 0) {
        return res.status(400).json({
          error: 'event_ids must reference events in the same library',
          invalid_event_ids: invalidEventIds
        });
      }
    }

    // Delete existing links for this chapter
    await pool.query(
      'DELETE FROM outline_chapter_events WHERE synopsis_id = $1 AND chapter_number = $2',
      [id, chapterNum]
    );

    // Insert new links (parameterized, SQL-injection safe)
    if (sanitizedEventIds.length > 0) {
      const positions = sanitizedEventIds.map((_, idx) => idx);
      await pool.query(`
        INSERT INTO outline_chapter_events (synopsis_id, chapter_number, event_id, position_in_chapter)
        SELECT $1, $2, e.id, u.pos
        FROM unnest($3::text[], $4::int[]) AS u(event_id, pos)
        JOIN library_events e
          ON e.id::text = u.event_id
         AND e.library_id = $5
      `, [id, chapterNum, sanitizedEventIds, positions, access.synopsis.library_id]);
    }

    logger.info(`[StoryBible] Linked ${sanitizedEventIds.length} events to Chapter ${chapterNum} of synopsis ${id}`);

    res.json({
      success: true,
      chapter_number: chapterNum,
      linked_event_ids: sanitizedEventIds
    });

  } catch (error) {
    logger.error('[StoryBible] Error linking events to chapter:', error);
    res.status(500).json({ error: 'Failed to link events to chapter' });
  }
});

/**
 * GET /api/story-bible/synopsis/:id/chapter-events
 * Get all linked events for all chapters in a synopsis
 */
router.get('/synopsis/:id/chapter-events', async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getSynopsisAccess(id, req.user);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const result = await pool.query(`
      SELECT oce.chapter_number, e.*
      FROM outline_chapter_events oce
      JOIN library_events e ON oce.event_id = e.id
      WHERE oce.synopsis_id = $1
      ORDER BY oce.chapter_number, oce.position_in_chapter
    `, [id]);

    // Group by chapter number
    const eventsByChapter = {};
    result.rows.forEach(row => {
      if (!eventsByChapter[row.chapter_number]) {
        eventsByChapter[row.chapter_number] = [];
      }
      eventsByChapter[row.chapter_number].push(row);
    });

    res.json({ events_by_chapter: eventsByChapter });

  } catch (error) {
    logger.error('[StoryBible] Error fetching chapter events:', error);
    res.status(500).json({ error: 'Failed to fetch chapter events' });
  }
});

// =============================================================================
// BEAT CRUD OPERATIONS
// =============================================================================

/**
 * PATCH /api/story-bible/synopsis/:id/beats/:chapterNumber/:beatNumber
 * Update a specific beat
 */
router.patch('/synopsis/:id/beats/:chapterNumber/:beatNumber', async (req, res) => {
  try {
    const { id, chapterNumber, beatNumber } = req.params;
    const updatedBeat = req.body;

    // Get existing beats for this chapter
    const result = await pool.query(`
      SELECT beats FROM chapter_beats
      WHERE synopsis_id = $1 AND chapter_number = $2
    `, [id, parseInt(chapterNumber)]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chapter beats not found' });
    }

    let beats = result.rows[0].beats;
    if (typeof beats === 'string') {
      beats = JSON.parse(beats);
    }

    // Find and update the beat
    const beatIdx = beats.findIndex(b => b.beat_number === parseInt(beatNumber));
    if (beatIdx === -1) {
      return res.status(404).json({ error: 'Beat not found' });
    }

    // Merge the update with existing beat
    beats[beatIdx] = {
      ...beats[beatIdx],
      ...updatedBeat,
      beat_number: parseInt(beatNumber) // Preserve beat number
    };

    // Save updated beats
    await pool.query(`
      UPDATE chapter_beats
      SET beats = $1, updated_at = NOW()
      WHERE synopsis_id = $2 AND chapter_number = $3
    `, [JSON.stringify(beats), id, parseInt(chapterNumber)]);

    logger.info(`[StoryBible] Updated beat ${beatNumber} in Chapter ${chapterNumber}`);

    res.json({
      success: true,
      beat: beats[beatIdx]
    });

  } catch (error) {
    logger.error('[StoryBible] Error updating beat:', error);
    res.status(500).json({ error: 'Failed to update beat' });
  }
});

/**
 * POST /api/story-bible/synopsis/:id/refine-beat/:chapterNumber/:beatNumber
 * Refine a specific beat using AI
 */
router.post('/synopsis/:id/refine-beat/:chapterNumber/:beatNumber', async (req, res) => {
  try {
    const { id, chapterNumber, beatNumber } = req.params;
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Get synopsis and library_id
    const synopsisResult = await pool.query(`
      SELECT library_id FROM library_synopsis WHERE id = $1
    `, [id]);

    if (synopsisResult.rows.length === 0) {
      return res.status(404).json({ error: 'Synopsis not found' });
    }

    const libraryId = synopsisResult.rows[0].library_id;

    // Get existing beats for this chapter
    const result = await pool.query(`
      SELECT beats FROM chapter_beats
      WHERE synopsis_id = $1 AND chapter_number = $2
    `, [id, parseInt(chapterNumber)]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chapter beats not found' });
    }

    let beats = result.rows[0].beats;
    if (typeof beats === 'string') {
      beats = JSON.parse(beats);
    }

    // Find the beat
    const beatIdx = beats.findIndex(b => b.beat_number === parseInt(beatNumber));
    if (beatIdx === -1) {
      return res.status(404).json({ error: 'Beat not found' });
    }

    const currentBeat = beats[beatIdx];

    // Get library context for AI - locations and characters
    const [locationsResult, charactersResult] = await Promise.all([
      pool.query('SELECT name, description, atmosphere FROM library_locations WHERE library_id = $1', [libraryId]),
      pool.query('SELECT name, role, description FROM library_characters WHERE library_id = $1', [libraryId])
    ]);

    const availableLocations = locationsResult.rows.map(l => l.name);
    const availableCharacters = charactersResult.rows.map(c => c.name);

    // Import OpenAI
    const { generateWithOpenAI } = await import('../services/openai.js');

    const systemPrompt = `You are a story beat editor. Refine the given beat based on the user's request.
A beat is a small scene or moment within a chapter.

CRITICAL RULES:
1. ONLY use locations from the AVAILABLE LOCATIONS list. Do NOT invent new locations.
2. ONLY use characters from the AVAILABLE CHARACTERS list. Do NOT invent new characters.
3. If the user says something doesn't exist (like "there is no basement"), REMOVE it and use an appropriate location from the available list.
4. Pay close attention to the user's corrections about the story world.

Return valid JSON matching this exact structure:
{
  "beat_number": integer,
  "summary": "description of what happens in this beat",
  "type": "opening|rising_action|tension|climax|resolution|transition|flashback|dialogue|action|revelation|emotional|setup",
  "characters": ["array of character names involved"],
  "location": "where it takes place - MUST be from AVAILABLE LOCATIONS",
  "mood": "emotional tone",
  "dialogue_hint": "key dialogue or theme (optional)",
  "sensory_details": "sight, sound, smell, etc (optional)"
}`;

    const userPrompt = `Refine this beat based on my request:

AVAILABLE LOCATIONS (only use these):
${availableLocations.length > 0 ? availableLocations.join('\n') : 'No specific locations defined'}

AVAILABLE CHARACTERS (only use these):
${availableCharacters.length > 0 ? availableCharacters.join('\n') : 'No specific characters defined'}

CURRENT BEAT ${beatNumber}:
${JSON.stringify(currentBeat, null, 2)}

USER REQUEST: ${prompt}

IMPORTANT: If the user says something doesn't exist (like a location), replace it with an appropriate alternative from the AVAILABLE LOCATIONS list.

Return the refined beat as JSON.`;

    const aiResult = await generateWithOpenAI({
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    let refinedBeat;
    try {
      const cleanContent = aiResult.content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      refinedBeat = JSON.parse(cleanContent);
      refinedBeat.beat_number = parseInt(beatNumber); // Ensure beat number is preserved
    } catch (e) {
      logger.error('[StoryBible] Failed to parse refined beat:', e);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    // Update the beat in the array
    beats[beatIdx] = {
      ...currentBeat,
      ...refinedBeat,
      linked_event_ids: currentBeat.linked_event_ids // Preserve links
    };

    // Save updated beats
    await pool.query(`
      UPDATE chapter_beats
      SET beats = $1, updated_at = NOW()
      WHERE synopsis_id = $2 AND chapter_number = $3
    `, [JSON.stringify(beats), id, parseInt(chapterNumber)]);

    logger.info(`[StoryBible] Refined beat ${beatNumber} in Chapter ${chapterNumber}`);

    res.json({
      success: true,
      beat: beats[beatIdx]
    });

  } catch (error) {
    logger.error('[StoryBible] Error refining beat:', error);
    res.status(500).json({ error: 'Failed to refine beat: ' + error.message });
  }
});

export default router;
