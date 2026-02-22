/**
 * Story Management Routes
 * Handles story sessions, scene generation, and CYOA choices
 */

import { Router } from 'express';
import { pool, withTransaction } from '../database/pool.js';
import { Orchestrator } from '../services/orchestrator.js';
import { ConversationEngine, NARRATOR_STYLES, LITERARY_STYLES, DEFAULT_VOICES } from '../services/conversationEngine.js';
import { completion, parseJsonResponse } from '../services/openai.js';
import { getUtilityModel } from '../services/modelSelection.js';
import { logger } from '../utils/logger.js';
import { cache } from '../services/cache.js';
import smartConfig from '../services/smartConfig.js';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, requireAuth, canGenerateStory, recordStoryUsage } from '../middleware/auth.js';
import { broadcastToRoom } from '../socket/state.js';
import {
  validateSessionId,
  validateStoryStart,
  validateChoice,
  validateConversation,
  isValidUUID,
  schemas,
  validateBody
} from '../middleware/validation.js';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

// Enforce session ownership for protected endpoints
async function requireSessionOwner(req, res, next) {
  try {
    const sessionId = req.params.id;
    const result = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }

    const ownerId = result.rows[0].user_id;
    if (ownerId !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized to access this story' });
    }

    return next();
  } catch (error) {
    logger.error('Error verifying session owner:', error);
    return res.status(500).json({ error: 'Failed to verify session access' });
  }
}

// Attach user if token is provided (required for protected endpoints)
router.use(authenticateToken);

function emitGenerationProgress(sessionId, step, percent, message) {
  if (!sessionId) return;
  broadcastToRoom(sessionId, 'generating', { step, percent, message });
}

/**
 * POST /api/stories/start
 * Start a new story session
 * Uses optionalAuth - authenticated users get usage tracking, anonymous users use default ID
 */
router.post('/start', requireAuth, validateBody(schemas.storyStart), async (req, res) => {
  try {
    const {
      mode = 'storytime',
      config = {},
      cyoa_enabled = false,
      bedtime_mode = false,
      storyBibleContext = null // NEW: Full Story Bible context from Advanced mode
    } = req.body;

    // Require authentication for story generation
    const userId = req.user.id;
    const isAuthenticated = true;

    // Check usage limits for authenticated users
    const usageCheck = await canGenerateStory(userId);
    if (!usageCheck.allowed) {
      return res.status(429).json({
        error: usageCheck.reason,
        usage: usageCheck.usage
      });
    }

    // Use transaction for atomic session creation
    const sessionId = uuidv4();

    // If Story Bible context is provided, merge it into the config
    // This ensures the orchestrator has access to all library data
    const finalConfig = {
      ...config,
      // Store Story Bible context reference in config
      story_bible_context: storyBibleContext ? {
        library_id: storyBibleContext.library_id,
        synopsis_id: storyBibleContext.synopsis?.id,
        has_context: true,
        counts: storyBibleContext.counts
      } : null
    };

    // Debug: Log incoming config to diagnose hide_speech_tags issue
    logger.info(`[Stories] Creating session | hide_speech_tags: ${config?.hide_speech_tags} | multi_voice: ${config?.multi_voice} | advanced_mode: ${!!storyBibleContext} | config keys: ${Object.keys(config || {}).join(', ')}`);

    const session = await withTransaction(async (client) => {
      // Create session
      const result = await client.query(`
        INSERT INTO story_sessions (id, user_id, mode, cyoa_enabled, bedtime_mode, config_json, current_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'planning')
        RETURNING *
      `, [sessionId, userId, mode, cyoa_enabled, bedtime_mode, JSON.stringify(finalConfig)]);

      // If Story Bible context is provided, initialize the orchestrator's story bible
      // Store full context in a dedicated table for retrieval during generation
      if (storyBibleContext) {
        await client.query(`
          INSERT INTO story_bible_sessions (story_session_id, library_id, synopsis_id, full_context)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (story_session_id) DO UPDATE SET
            library_id = EXCLUDED.library_id,
            synopsis_id = EXCLUDED.synopsis_id,
            full_context = EXCLUDED.full_context,
            updated_at = NOW()
        `, [
          sessionId,
          storyBibleContext.library_id,
          storyBibleContext.synopsis?.id || null,
          JSON.stringify(storyBibleContext)
        ]);

        logger.info(`[Stories] Story Bible context stored for session ${sessionId}: ${storyBibleContext.counts?.characters || 0} chars, ${storyBibleContext.counts?.locations || 0} locs`);
      }

      // Log session start
      await client.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, 'system', 'internal', $2)
      `, [sessionId, `Story session started in ${mode} mode${storyBibleContext ? ' with Story Bible context' : ''}`]);

      // Record usage for authenticated users
      await recordStoryUsage(userId, client);

      return result.rows[0];
    });

    logger.info(`Story session started: ${sessionId} (user: ${isAuthenticated ? userId : 'anonymous'}${storyBibleContext ? ', advanced mode with Story Bible' : ''})`);

    await cache.delPattern(`library:${userId}:*`);

    res.status(201).json({
      session_id: sessionId,
      mode,
      status: 'planning',
      authenticated: isAuthenticated,
      has_story_bible: !!storyBibleContext,
      message: mode === 'storytime'
        ? 'What kind of narrated world do you want to create?'
        : 'Configure your story settings and click Start when ready.'
    });

  } catch (error) {
    logger.error('Error starting story:', error);
    res.status(500).json({ error: 'Failed to start story session' });
  }
});

/**
 * GET /api/stories/config/styles
 * Get available literary styles, narrator styles, and default voices
 * NOTE: Must be defined before /:id to avoid being shadowed by it
 */
router.get('/config/styles', async (req, res) => {
  try {
    res.json({
      literary_styles: LITERARY_STYLES,
      narrator_styles: NARRATOR_STYLES,
      default_voices: DEFAULT_VOICES
    });
  } catch (error) {
    logger.error('Error fetching styles:', error);
    res.status(500).json({ error: 'Failed to fetch styles' });
  }
});

/**
 * GET /api/stories/recent/:userId
 * Get recent stories for a user
 * NOTE: Must be defined before /:id to avoid being shadowed by it
 */
router.get('/recent/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    const stories = await pool.query(`
      SELECT id, title, mode, current_status, total_scenes, started_at, ended_at
      FROM story_sessions
      WHERE user_id = $1
      ORDER BY last_activity_at DESC
      LIMIT $2
    `, [userId, limit]);

    res.json({ stories: stories.rows });

  } catch (error) {
    logger.error('Error fetching recent stories:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

/**
 * GET /api/stories/:id
 * Get story session details
 */
router.get('/:id', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;

    const session = await pool.query(
      'SELECT * FROM story_sessions WHERE id = $1',
      [id]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }

    // Get outline if exists
    const outline = await pool.query(
      'SELECT * FROM story_outlines WHERE story_session_id = $1 ORDER BY version DESC LIMIT 1',
      [id]
    );

    // Get latest recording for this session (needed to join with recording_segments)
    const recording = await pool.query(`
      SELECT id FROM story_recordings
      WHERE story_session_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [id]);
    const recordingId = recording.rows.length > 0 ? recording.rows[0].id : null;

    // Get scenes (include polished_text for reconnection recovery + word_timings for karaoke)
    // FIX: Use COALESCE to prefer recording_segments audio_url over story_scenes audio_url
    // This ensures replay mode uses the correct audio path from recordings
    const scenes = await pool.query(`
      SELECT
        sc.id,
        sc.sequence_index,
        sc.branch_key,
        sc.summary,
        sc.polished_text,
        COALESCE(rs.audio_url, sc.audio_url) as audio_url,
        COALESCE(rs.duration_seconds, sc.audio_duration_seconds) as audio_duration_seconds,
        COALESCE(rs.word_timings, sc.word_timings) as word_timings,
        sc.mood
      FROM story_scenes sc
      LEFT JOIN recording_segments rs ON rs.scene_id = sc.id AND rs.recording_id = $2
      WHERE sc.story_session_id = $1
      ORDER BY sc.sequence_index
    `, [id, recordingId]);

    // Get pending choices for the latest scene (for reconnection recovery)
    let pendingChoices = [];
    if (scenes.rows.length > 0) {
      const latestSceneId = scenes.rows[scenes.rows.length - 1].id;
      const choicesResult = await pool.query(`
        SELECT choice_key, choice_text, was_selected
        FROM story_choices
        WHERE scene_id = $1 AND was_selected = false
        ORDER BY choice_key
      `, [latestSceneId]);
      pendingChoices = choicesResult.rows;
    }

    // Get choice history (selected choices) for CYOA path visualization
    const choiceHistoryResult = await pool.query(`
      SELECT sc.choice_key, sc.choice_text, sc.selected_at, ss.sequence_index as scene_index
      FROM story_choices sc
      JOIN story_scenes ss ON sc.scene_id = ss.id
      WHERE sc.story_session_id = $1 AND sc.was_selected = true
      ORDER BY sc.selected_at ASC
    `, [id]);
    const choiceHistory = choiceHistoryResult.rows.map(row => ({
      sceneIndex: row.scene_index,
      choiceKey: row.choice_key,
      choiceText: row.choice_text,
      timestamp: new Date(row.selected_at).getTime()
    }));

    // Get characters
    const characters = await pool.query(
      'SELECT id, name, role, description FROM characters WHERE story_session_id = $1',
      [id]
    );

    res.json({
      session: {
        ...session.rows[0],
        has_outline: outline.rows.length > 0
      },
      outline: outline.rows[0] || null,
      scenes: scenes.rows,
      characters: characters.rows,
      pendingChoices: pendingChoices,
      choiceHistory: choiceHistory
    });

  } catch (error) {
    logger.error('Error fetching story:', error);
    res.status(500).json({ error: 'Failed to fetch story' });
  }
});

/**
 * POST /api/stories/:id/configure
 * Configure story based on user input (voice or UI)
 */
router.post('/:id/configure', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { input, input_type = 'text' } = req.body;

    // Log user input
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'user', $2, $3)
    `, [id, input_type, input]);

    // Use orchestrator to process configuration
    // CRITICAL: Pass input_type so JSON configs are handled correctly
    // NOTE: No progress reporting needed for config - just saving to DB
    const orchestrator = new Orchestrator(id);
    const response = await orchestrator.processConfiguration(input, input_type);

    // Log orchestrator response
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'orchestrator', 'text', $2)
    `, [id, response.message]);

    res.json(response);

  } catch (error) {
    logger.error('Error configuring story:', error);
    res.status(500).json({ error: 'Failed to configure story' });
  }
});

/**
 * POST /api/stories/:id/converse
 * Handle conversational story configuration (voice-first Storytime mode)
 */
router.post('/:id/converse', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { input, current_config = {}, conversation_history = [] } = req.body;

    // Log user input
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'user', 'voice', $2)
    `, [id, input]);

    // Count conversation exchanges to enforce max turns
    const exchangeCount = conversation_history.filter(m => m.role === 'user').length;

    // Check for explicit "start now" phrases from user
    const inputLower = input.toLowerCase().trim();
    const startPhrases = [
      'start', 'begin', 'go', 'let\'s go', 'that\'s it', 'that\'s all', 'sounds good',
      'perfect', 'ready', 'i\'m ready', 'start the story', 'begin the story',
      'that works', 'yes', 'yep', 'yeah', 'ok', 'okay', 'sure', 'do it',
      'make it', 'create', 'generate', 'tell me', 'tell the story'
    ];
    const userWantsToStart = startPhrases.some(phrase =>
      inputLower === phrase ||
      inputLower.startsWith(phrase + ' ') ||
      inputLower.endsWith(' ' + phrase) ||
      inputLower.includes('start') ||
      inputLower.includes('begin') ||
      inputLower.includes('ready')
    );

    // Force ready_to_start if user explicitly wants to start OR we've had 3+ exchanges
    const shouldForceStart = userWantsToStart || exchangeCount >= 3;

    // Build conversation context
    const messages = [
      {
        role: 'system',
        content: `You are a friendly storyteller helping someone choose a story. Your goal is to understand what kind of story they want through natural conversation.

Extract these preferences if mentioned:
- Genre/theme (fantasy, adventure, mystery, spooky, funny, romantic)
- Characters or character types
- Setting or world
- Mood (exciting, calm, mysterious, silly)
- Story length preference (short, medium, long)
- Intensity level for scary/intense content

IMPORTANT RULES FOR ready_to_start:
1. Set ready_to_start: true if the user says ANYTHING like "start", "begin", "go", "ready", "that's it", "sounds good", "yes", "perfect", "let's go"
2. Set ready_to_start: true after 2-3 exchanges even if you don't have all details - you can fill in defaults
3. Set ready_to_start: true if the user has given you a clear genre/theme - that's enough to start
4. NEVER ask more than 2 follow-up questions total

${shouldForceStart ? 'USER WANTS TO START NOW - set ready_to_start: true and give a brief enthusiastic response about starting their story.' : ''}

Respond naturally and conversationally. Keep responses SHORT (1-2 sentences max) since you're speaking aloud.

Return JSON with:
- response: Your spoken response (SHORT!)
- config_updates: Any extracted preferences as key-value pairs
- ready_to_start: true when you have enough info to start (REQUIRED if user says start/begin/ready/go)

Current preferences so far: ${JSON.stringify(current_config)}
Exchange count: ${exchangeCount + 1}`
      },
      ...conversation_history.slice(-6).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      })),
      {
        role: 'user',
        content: input
      }
    ];

    // Get AI response using centralized completion
    const aiResponse = await completion({
      messages,
      model: getUtilityModel(),
      response_format: { type: 'json_object' },
      max_tokens: 200,
      agent_name: 'story_conversation',
      sessionId: id
    });

    let result;
    try {
      result = parseJsonResponse(aiResponse.content);
    } catch (e) {
      result = {
        response: "That sounds wonderful! Let me create a story for you.",
        config_updates: {},
        ready_to_start: true
      };
    }

    // Use SmartConfig to detect additional settings the AI might miss (sfx_level, voice_acted, etc.)
    try {
      const smartAnalysis = smartConfig.analyzeKeywords(input.toLowerCase());

      // Merge SmartConfig detected settings into config_updates
      if (smartAnalysis.sfx_level) {
        result.config_updates = result.config_updates || {};
        result.config_updates.sfx_level = smartAnalysis.sfx_level;
        result.config_updates.sfx_enabled = true;
        logger.info(`[Converse] SmartConfig detected sfx_level: ${smartAnalysis.sfx_level}`);
      }
      if (smartAnalysis.sfx_enabled && !result.config_updates?.sfx_enabled) {
        result.config_updates = result.config_updates || {};
        result.config_updates.sfx_enabled = true;
      }
      // Voice acting (support both new and legacy field names)
      if (smartAnalysis.voice_acted || smartAnalysis.multi_narrator) {
        result.config_updates = result.config_updates || {};
        result.config_updates.voice_acted = true;
        result.config_updates.multi_narrator = true; // Backward compatibility
        logger.info('[Converse] SmartConfig detected voice acting request');
      }
      if (smartAnalysis.story_length && !result.config_updates?.story_length) {
        result.config_updates = result.config_updates || {};
        result.config_updates.story_length = smartAnalysis.story_length;
      }
      if (smartAnalysis.bedtime_mode) {
        result.config_updates = result.config_updates || {};
        result.config_updates.bedtime_mode = true;
      }
    } catch (smartErr) {
      logger.warn('[Converse] SmartConfig analysis failed:', smartErr.message);
    }

    // SAFETY: Force ready_to_start if user explicitly requested or max exchanges reached
    if (shouldForceStart && !result.ready_to_start) {
      logger.info(`[Converse] Forcing ready_to_start (userWantsToStart: ${userWantsToStart}, exchanges: ${exchangeCount})`);
      result.ready_to_start = true;
      // If the AI gave a question as response, replace with a starting message
      if (result.response.includes('?') && !result.response.toLowerCase().includes('ready')) {
        result.response = "Wonderful! Let me create that story for you now.";
      }
    }

    // Log AI response
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'assistant', 'voice', $2)
    `, [id, result.response]);

    // Update session config if we have updates
    if (result.config_updates && Object.keys(result.config_updates).length > 0) {
      const currentSession = await pool.query('SELECT config_json FROM story_sessions WHERE id = $1', [id]);
      const existingConfig = currentSession.rows[0]?.config_json || {};
      const newConfig = { ...existingConfig, ...result.config_updates };

      await pool.query(
        'UPDATE story_sessions SET config_json = $1, last_activity_at = NOW() WHERE id = $2',
        [JSON.stringify(newConfig), id]
      );
    }

    // If ready to start, update status
    if (result.ready_to_start) {
      await pool.query(
        "UPDATE story_sessions SET current_status = 'ready', last_activity_at = NOW() WHERE id = $1",
        [id]
      );
    }

    res.json({
      response: result.response,
      config_updates: result.config_updates || {},
      ready_to_start: result.ready_to_start || false
    });

  } catch (error) {
    logger.error('Error in conversation:', error);
    res.status(500).json({ error: 'Failed to process conversation' });
  }
});

/**
 * POST /api/stories/:id/conversation
 * Full conversational AI for story configuration (voice-first interface)
 * Handles multi-step conversation flow from greeting to story start
 */
router.post('/:id/conversation', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { input, step = 1, current_config = {} } = req.body;

    const engine = new ConversationEngine(id);
    const result = await engine.processInput(input, step, current_config);

    res.json(result);

  } catch (error) {
    logger.error('Conversation error:', error);
    res.status(500).json({ error: 'Failed to process conversation' });
  }
});

/**
 * POST /api/stories/:id/generate-outline
 * Generate story outline based on configuration
 *
 * ★ ADVANCED MODE: If session has Story Bible context, uses that outline instead of generating new one
 */
router.post('/:id/generate-outline', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const generationProgress = {
      outline_loading: { step: 0, percent: 6, message: 'Preparing story outline...' },
      outline_generating: { step: 1, percent: 12, message: 'Generating story outline...' },
      outline_validating: { step: 2, percent: 18, message: 'Reviewing outline...' },
      outline_saving: { step: 3, percent: 22, message: 'Saving outline...' },
      outline_complete: { step: 4, percent: 28, message: 'Outline ready. Preparing chapter...' },
      loading: { step: 5, percent: 32, message: 'Loading story context...' },
      planning: { step: 6, percent: 36, message: 'Planning the next scene...' },
      analyzing_intent: { step: 6, percent: 36, message: 'Interpreting tone and intensity...' },
      generating: { step: 7, percent: 46, message: 'Writing the next scene...' },
      hybrid_generating: { step: 7, percent: 50, message: 'Refining scene output...' },
      validating: { step: 8, percent: 58, message: 'Checking continuity and safety...' },
      polishing: { step: 9, percent: 64, message: 'Polishing narration...' },
      choices: { step: 10, percent: 66, message: 'Mapping interactive choices...' },
      saving: { step: 11, percent: 68, message: 'Saving scene...' },
      validating_speakers: { step: 12, percent: 70, message: 'Balancing character voices...' }
    };
    const emitOutlineProgress = (phase) => {
      const payload = generationProgress[phase];
      if (payload) {
        emitGenerationProgress(id, payload.step, payload.percent, payload.message);
      }
    };


    // ★ ADVANCED MODE: Check if session has Story Bible context with outline
    const storyBibleResult = await pool.query(
      'SELECT full_context FROM story_bible_sessions WHERE story_session_id = $1',
      [id]
    );

    if (storyBibleResult.rows.length > 0 && storyBibleResult.rows[0].full_context) {
      const storyBibleContext = typeof storyBibleResult.rows[0].full_context === 'string'
        ? JSON.parse(storyBibleResult.rows[0].full_context)
        : storyBibleResult.rows[0].full_context;

      // Check if we have a valid outline from Story Bible
      const storyBibleOutline = storyBibleContext.outline;
      const synopsis = storyBibleContext.synopsis;

      if (storyBibleOutline || synopsis) {
        emitOutlineProgress('outline_loading');
        logger.info(`[Stories] ★ ADVANCED MODE: Using Story Bible outline instead of generating new one`);

        // Build outline from Story Bible data
        const outline = {
          title: synopsis?.title || 'Story from Story Bible',
          synopsis: synopsis?.synopsis || synopsis?.logline || '',
          setting: storyBibleContext.world?.description || synopsis?.genre || 'A rich story world',
          themes: synopsis?.themes || [],
          acts: storyBibleOutline?.chapters?.map((ch, i) => ({
            act_number: i + 1,
            title: ch.title || `Chapter ${i + 1}`,
            summary: ch.summary || ch.key_events || ''
          })) || [{ act_number: 1, title: 'The Story', summary: synopsis?.synopsis || '' }],
          main_characters: storyBibleContext.characters?.map(c => ({
            name: c.name,
            role: c.role || 'character',
            description: c.description || c.bio || '',
            traits: c.personality_traits || c.traits || [],
            gender: c.gender
          })) || [],
          target_length: 'medium'
        };

        // Save outline to story_outlines table (so orchestrator.loadSession can find it)
        await withTransaction(async (client) => {
          // Check if outline already exists for this session
          const existingOutline = await client.query(
            'SELECT id FROM story_outlines WHERE story_session_id = $1 LIMIT 1',
            [id]
          );

          if (existingOutline.rows.length > 0) {
            // Update existing outline
            await client.query(`
              UPDATE story_outlines SET outline_json = $1, themes = $2 WHERE story_session_id = $3
            `, [JSON.stringify(outline), outline.themes || [], id]);
          } else {
            // Insert new outline
            await client.query(`
              INSERT INTO story_outlines (story_session_id, outline_json, themes, target_duration_minutes)
              VALUES ($1, $2, $3, $4)
            `, [id, JSON.stringify(outline), outline.themes || [], 15]);
          }

          // Update session with title and synopsis
          await client.query(
            `UPDATE story_sessions SET
              title = $1,
              synopsis = $2,
              current_status = 'narrating',
              last_activity_at = NOW()
             WHERE id = $3`,
            [outline.title, outline.synopsis || '', id]
          );

          // Create characters in the characters table (so they're available for voice casting)
          if (storyBibleContext.characters && storyBibleContext.characters.length > 0) {
            // First, check which characters already exist
            const existingChars = await client.query(
              'SELECT name FROM characters WHERE story_session_id = $1',
              [id]
            );
            const existingNames = new Set(existingChars.rows.map(r => r.name.toLowerCase()));

            let createdCount = 0;
            for (const char of storyBibleContext.characters) {
              const charName = char.name || 'Unknown';
              if (!existingNames.has(charName.toLowerCase())) {
                await client.query(`
                  INSERT INTO characters (story_session_id, name, role, description, traits_json, gender)
                  VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                  id,
                  charName,
                  char.role || 'supporting',
                  char.description || char.bio || '',
                  JSON.stringify(char.personality_traits || char.traits || []),
                  char.gender || null
                ]);
                createdCount++;
              }
            }
            if (createdCount > 0) {
              logger.info(`[Stories] Created ${createdCount} characters from Story Bible`);
            }
          }

          // Create lore entries from Story Bible locations
          if (storyBibleContext.locations && storyBibleContext.locations.length > 0) {
            for (const loc of storyBibleContext.locations.slice(0, 5)) {
              await client.query(`
                INSERT INTO lore_entries (story_session_id, entry_type, title, content, importance)
                VALUES ($1, 'location', $2, $3, 80)
              `, [id, loc.name, loc.description || loc.atmosphere || '']);
            }
          }
        });

        logger.info(`[Stories] Story Bible outline saved: "${outline.title}" with ${outline.main_characters.length} characters`);

        emitOutlineProgress('outline_complete');

        return res.json({
          message: 'Outline loaded from Story Bible',
          outline,
          source: 'story_bible'
        });
      }
    }

    // Standard mode: Generate new outline
    const orchestrator = new Orchestrator(id);
    orchestrator.onProgress = (phase) => emitOutlineProgress(phase);
    const outline = await orchestrator.generateOutline();

    res.json({
      message: 'Outline generated',
      outline
    });

  } catch (error) {
    const { id } = req.params;
    // PHASE 2 FIX: Log full error with stack trace for debugging
    logger.error(`[GenerateOutline] Error for session ${id}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    // Pass specific error message to client for better UX
    const clientMessage = error.message.includes('Outline generation failed')
      || error.message.includes('Failed to load session')
      || error.message.includes('invalid title')
      || error.message.includes('no characters')
      ? error.message
      : 'Failed to generate outline. Please try again.';
    res.status(500).json({
      error: clientMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/stories/:id/continue
 * Generate the next scene
 */
router.post('/:id/continue', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { voice_id } = req.body;

    // Update session status
    await pool.query(
      "UPDATE story_sessions SET current_status = 'narrating', last_activity_at = NOW() WHERE id = $1",
      [id]
    );

    const generationProgress = {
      loading: { step: 5, percent: 32, message: 'Loading story context...' },
      planning: { step: 6, percent: 36, message: 'Planning the next scene...' },
      analyzing_intent: { step: 6, percent: 36, message: 'Interpreting tone and intensity...' },
      generating: { step: 7, percent: 46, message: 'Writing the next scene...' },
      hybrid_generating: { step: 7, percent: 50, message: 'Refining scene output...' },
      validating: { step: 8, percent: 58, message: 'Checking continuity and safety...' },
      polishing: { step: 9, percent: 64, message: 'Polishing narration...' },
      choices: { step: 10, percent: 66, message: 'Mapping interactive choices...' },
      saving: { step: 11, percent: 68, message: 'Saving scene...' },
      validating_speakers: { step: 12, percent: 70, message: 'Balancing character voices...' }
    };
    const emitContinueProgress = (phase) => {
      const payload = generationProgress[phase];
      if (payload) {
        emitGenerationProgress(id, payload.step, payload.percent, payload.message);
      }
    };

    const orchestrator = new Orchestrator(id);
    orchestrator.onProgress = (phase) => emitContinueProgress(phase);
    const scene = await orchestrator.generateNextScene(voice_id);

    res.json({
      scene,
      has_choices: scene.choices && scene.choices.length > 0,
      is_final: scene.is_final || false
    });

  } catch (error) {
    const { id } = req.params;
    logger.error(`[ContinueStory] Error for session ${id}:`, error.message);
    res.status(500).json({ error: 'Failed to generate next scene' });
  }
});

/**
 * POST /api/stories/:id/generate-audio/:sceneId
 * Generate audio on-demand for a scene (for deferred audio mode)
 */
router.post('/:id/generate-audio/:sceneId', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id, sceneId } = req.params;
    const { voice_id } = req.body;

    const orchestrator = new Orchestrator(id);
    orchestrator.onProgress = (phase) => emitGenerationProgress(id, 0, 0, phase);
    const result = await orchestrator.generateSceneAudio(sceneId, voice_id);

    res.json({
      success: true,
      audioUrl: result.audioUrl,
      cached: result.cached
    });

  } catch (error) {
    const { id, sceneId } = req.params;
    logger.error(`[GenerateAudio] Error for session ${id}, scene ${sceneId}:`, error.message);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

/**
 * POST /api/stories/:id/choice
 * Submit a CYOA choice
 */
router.post('/:id/choice', requireAuth, validateSessionId, requireSessionOwner, validateChoice, async (req, res) => {
  try {
    const { id } = req.params;
    const { choice_id, choice_key } = req.body;

    // Use transaction for atomic choice recording
    const result = await withTransaction(async (client) => {
      // Mark choice as selected
      let choiceQuery;
      if (choice_id) {
        choiceQuery = await client.query(
          'UPDATE story_choices SET was_selected = true, selected_at = NOW() WHERE id = $1 AND story_session_id = $2 RETURNING *',
          [choice_id, id]
        );
      } else {
        choiceQuery = await client.query(`
          UPDATE story_choices
          SET was_selected = true, selected_at = NOW()
          WHERE story_session_id = $1 AND choice_key = $2 AND was_selected = false
          RETURNING *
        `, [id, choice_key.toUpperCase()]);
      }

      if (choiceQuery.rows.length === 0) {
        throw { status: 404, message: 'Choice not found' };
      }

      const choice = choiceQuery.rows[0];

      // Log choice
      await client.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, 'user', 'ui', $2)
      `, [id, `Selected choice ${choice.choice_key}: ${choice.choice_text}`]);

      // Update session status
      await client.query(
        "UPDATE story_sessions SET current_status = 'narrating', last_activity_at = NOW() WHERE id = $1",
        [id]
      );

      return choice;
    });

    res.json({
      message: 'Choice recorded',
      choice: {
        key: result.choice_key,
        text: result.choice_text
      }
    });

  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error('Error recording choice:', error);
    res.status(500).json({ error: 'Failed to record choice' });
  }
});

/**
 * GET /api/stories/:id/scene/:sceneIndex
 * Get a specific scene
 */
router.get('/:id/scene/:sceneIndex', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id, sceneIndex } = req.params;

    const scene = await pool.query(`
      SELECT s.*,
        (SELECT json_agg(json_build_object(
          'id', c.id,
          'key', c.choice_key,
          'text', c.choice_text,
          'description', c.choice_description,
          'selected', c.was_selected
        )) FROM story_choices c WHERE c.scene_id = s.id) as choices
      FROM story_scenes s
      WHERE s.story_session_id = $1 AND s.sequence_index = $2
    `, [id, parseInt(sceneIndex)]);

    if (scene.rows.length === 0) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    res.json({ scene: scene.rows[0] });

  } catch (error) {
    logger.error('Error fetching scene:', error);
    res.status(500).json({ error: 'Failed to fetch scene' });
  }
});

/**
 * POST /api/stories/:id/pause
 * Pause the story
 */
router.post('/:id/pause', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "UPDATE story_sessions SET current_status = 'paused', last_activity_at = NOW() WHERE id = $1",
      [id]
    );

    res.json({ message: 'Story paused' });

  } catch (error) {
    logger.error('Error pausing story:', error);
    res.status(500).json({ error: 'Failed to pause story' });
  }
});

/**
 * POST /api/stories/:id/end
 * End the story session
 */
router.post('/:id/end', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'completed' } = req.body;

    await pool.query(`
      UPDATE story_sessions
      SET current_status = 'finished', ended_at = NOW(), last_activity_at = NOW()
      WHERE id = $1
    `, [id]);

    // Log session end
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'system', 'internal', $2)
    `, [id, `Story session ended: ${reason}`]);

    // Get session summary
    const summary = await pool.query(`
      SELECT
        s.title,
        s.started_at,
        s.ended_at,
        s.total_scenes,
        EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60 as duration_minutes
      FROM story_sessions s
      WHERE s.id = $1
    `, [id]);

    res.json({
      message: 'Story ended',
      summary: summary.rows[0]
    });

  } catch (error) {
    logger.error('Error ending story:', error);
    res.status(500).json({ error: 'Failed to end story' });
  }
});

/**
 * POST /api/stories/:id/backtrack
 * Go back to a previous checkpoint in a CYOA story
 * Uses transaction to ensure atomic operation
 */
router.post('/:id/backtrack', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { scene_id, scene_index } = req.body;

    if (!scene_id && scene_index === undefined) {
      client.release();
      return res.status(400).json({ error: 'scene_id or scene_index is required' });
    }

    // Get the session to check if backtracking is allowed
    const sessionResult = await client.query(
      'SELECT config_json FROM story_sessions WHERE id = $1',
      [id]
    );

    if (sessionResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Story session not found' });
    }

    const config = sessionResult.rows[0].config_json || {};
    const cyoaSettings = config.cyoa_settings || {};

    if (!cyoaSettings.allow_backtrack && cyoaSettings.allow_backtrack !== undefined) {
      client.release();
      return res.status(403).json({ error: 'Backtracking is not enabled for this story' });
    }

    // Find the target scene
    let targetScene;
    if (scene_id) {
      const sceneResult = await client.query(
        'SELECT * FROM story_scenes WHERE id = $1 AND story_session_id = $2',
        [scene_id, id]
      );
      targetScene = sceneResult.rows[0];
    } else {
      const sceneResult = await client.query(
        'SELECT * FROM story_scenes WHERE story_session_id = $1 AND sequence_index = $2',
        [id, scene_index]
      );
      targetScene = sceneResult.rows[0];
    }

    if (!targetScene) {
      client.release();
      return res.status(404).json({ error: 'Target scene not found' });
    }

    // Begin transaction for atomic backtrack operation
    await client.query('BEGIN');

    try {
      // First, get IDs of scenes to delete (before deleting them)
      const scenesToDelete = await client.query(
        'SELECT id FROM story_scenes WHERE story_session_id = $1 AND sequence_index > $2',
        [id, targetScene.sequence_index]
      );
      const sceneIdsToDelete = scenesToDelete.rows.map(r => r.id);

      // Delete choices for scenes being removed (must happen BEFORE deleting scenes)
      if (sceneIdsToDelete.length > 0) {
        await client.query(
          'DELETE FROM story_choices WHERE scene_id = ANY($1)',
          [sceneIdsToDelete]
        );
      }

      // Delete scenes after this checkpoint
      await client.query(
        'DELETE FROM story_scenes WHERE story_session_id = $1 AND sequence_index > $2',
        [id, targetScene.sequence_index]
      );

      // Reset choice selections for this scene (allow re-choosing)
      await client.query(`
        UPDATE story_choices
        SET was_selected = false, selected_at = NULL
        WHERE scene_id = $1
      `, [targetScene.id]);

      // Update session state
      await client.query(`
        UPDATE story_sessions
        SET current_status = 'waiting_choice',
            current_scene_index = $1,
            last_activity_at = NOW()
        WHERE id = $2
      `, [targetScene.sequence_index, id]);

      // Log the backtrack action
      await client.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, 'system', 'internal', $2)
      `, [id, `Story backtracked to scene ${targetScene.sequence_index}`]);

      // Commit transaction
      await client.query('COMMIT');

      // Get choices for the target scene (after commit)
      const choicesResult = await client.query(`
        SELECT id, choice_key, choice_text, choice_description
        FROM story_choices
        WHERE scene_id = $1
        ORDER BY choice_index
      `, [targetScene.id]);

      logger.info(`Story ${id} backtracked to scene ${targetScene.sequence_index} (deleted ${sceneIdsToDelete.length} scenes)`);

      res.json({
        success: true,
        message: 'Successfully backtracked to checkpoint',
        scene: {
          id: targetScene.id,
          sequence_index: targetScene.sequence_index,
          text: targetScene.polished_text || targetScene.raw_text,
          summary: targetScene.summary
        },
        choices: choicesResult.rows.map(c => ({
          key: c.choice_key,
          text: c.choice_text,
          description: c.choice_description
        }))
      });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    }

  } catch (error) {
    logger.error('Error backtracking story:', error);
    res.status(500).json({ error: 'Failed to backtrack story' });
  } finally {
    client.release();
  }
});

/**
 * Generate three cover art prompts with increasing abstraction levels
 * Uses LLM to create DALL-E safe prompts based on story context
 *
 * The LLM is responsible for ALL safety considerations - no regex post-processing.
 * Each level should be progressively safer:
 * - Level 1: Direct scene (may fail for mature content)
 * - Level 2: Abstract/symbolic (should pass most filters)
 * - Level 3: Pure metaphor (GUARANTEED safe - nature, colors, shapes only)
 */
async function generateCoverPrompts(storyContext, openai) {
  const { title, synopsis, themes, genre, authorStyle, characters } = storyContext;
  logger.info(`[CoverArt] PROMPT_GEN_INPUT | title: "${title?.substring(0, 40)}" | genre: ${genre} | themes: ${themes?.slice(0, 3).join(', ') || 'none'} | hasCharacters: ${!!characters?.length}`);

  const systemPrompt = `You are a professional book cover art director creating prompts for DALL-E 3.

Your job is to generate THREE image prompts with INCREASING ABSTRACTION. This is critical because:
- The story may contain mature themes (horror, violence, romance) that DALL-E will reject
- Level 1 might fail, Level 2 is a fallback, Level 3 MUST ALWAYS work

DALL-E SAFETY RULES (apply to ALL levels):
- NO text, titles, words, or letters
- NO real people or celebrities
- NO explicit violence, gore, blood, weapons shown in use
- NO nudity or sexual content
- NO horror imagery (monsters attacking, corpses, etc.)

ABSTRACTION STRATEGY:
- Level 1: Capture the SETTING and MOOD, not violent/explicit moments. Use silhouettes, shadows, atmosphere.
- Level 2: Focus on EMOTIONS and THEMES through symbolic imagery. Colors, weather, landscapes that evoke feeling.
- Level 3: PURE ABSTRACTION - this is your failsafe. Think: a single rose on dark silk, storm clouds over calm water, a key suspended in light, autumn leaves on stone. NO story-specific elements, just beautiful evocative art that captures the emotional essence.

Output valid JSON:
{
  "prompts": [
    { "level": 1, "description": "...", "prompt": "..." },
    { "level": 2, "description": "...", "prompt": "..." },
    { "level": 3, "description": "...", "prompt": "..." }
  ]
}`;

  const userPrompt = `Create three DALL-E safe cover art prompts for this story:

TITLE: ${title}
GENRE: ${genre}
${synopsis ? `SYNOPSIS: ${synopsis.substring(0, 400)}` : ''}
${themes?.length > 0 ? `THEMES: ${themes.slice(0, 5).join(', ')}` : ''}
${authorStyle ? `VISUAL STYLE: Reminiscent of ${authorStyle} book covers` : ''}
${characters?.length > 0 ? `KEY CHARACTERS: ${characters.slice(0, 3).map(c => c.name).join(', ')}` : ''}

IMPORTANT: Even if this story contains violence, horror, or mature themes, your prompts must be DALL-E safe.
- Level 1: Atmospheric scene - use silhouettes, shadows, mood lighting. Avoid showing violence directly.
- Level 2: Symbolic interpretation - colors, weather, objects that represent themes without depicting them literally.
- Level 3: GUARANTEED SAFE - Pure abstract beauty. Nature imagery, flowing colors, simple symbolic objects (rose, key, feather, flame, water). This MUST pass any content filter.

Each prompt: 2-3 sentences specifying style, composition, colors, mood, lighting.
End each with "professional book cover art, no text on the image".`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    const prompts = result.prompts || [];
    logger.info(`[CoverArt] PROMPT_GEN_OUTPUT | promptCount: ${prompts.length} | levels: ${prompts.map(p => p.level).join(',')}`);
    prompts.forEach((p, i) => {
      logger.debug(`[CoverArt] PROMPT[${p.level}] ${p.description}: "${p.prompt?.substring(0, 80)}..."`);
    });
    return prompts;
  } catch (error) {
    logger.error(`[CoverArt] PROMPT_GEN_ERROR | error: ${error.message}`);
    // Fallback to basic prompts if LLM fails
    return [
      {
        level: 1,
        description: 'Direct',
        prompt: `Professional book cover art for a ${genre} story titled "${title}". ${synopsis?.substring(0, 100) || 'Dramatic scene'}. Cinematic lighting, rich colors, evocative atmosphere, no text on the image.`
      },
      {
        level: 2,
        description: 'Abstract',
        prompt: `Abstract professional book cover art evoking ${genre} themes. Symbolic imagery representing ${themes?.slice(0, 2).join(' and ') || 'mystery and adventure'}. Moody atmosphere, artistic composition, no text.`
      },
      {
        level: 3,
        description: 'Highly abstract',
        prompt: `Highly abstract artistic book cover. Flowing colors and shapes suggesting emotion and mystery. Ethereal, dreamlike quality. Beautiful abstract art composition, professional quality, no text.`
      }
    ];
  }
}

/**
 * POST /api/stories/:id/generate-cover
 * Generate a paperback-style cover for the story using DALL-E
 * Uses three-tier prompt system: tries direct prompt first, falls back to more abstract versions
 * Rate limited to 3 requests per 5 minutes per IP+session to prevent abuse
 */
router.post('/:id/generate-cover', requireAuth, validateSessionId, requireSessionOwner, rateLimiters.imageGeneration, async (req, res) => {
  try {
    const { id } = req.params;

    // Get story details - synopsis is on story_sessions, themes on story_outlines
    const sessionResult = await pool.query(`
      SELECT s.title, s.config_json, s.synopsis, o.themes, o.outline_json
      FROM story_sessions s
      LEFT JOIN story_outlines o ON o.story_session_id = s.id
      WHERE s.id = $1
    `, [id]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const story = sessionResult.rows[0];
    const config = story.config_json || {};
    const outlineData = story.outline_json || {};
    // Synopsis can be on story_sessions OR in outline_json
    const synopsis = story.synopsis || outlineData.synopsis || '';
    const themes = story.themes || outlineData.themes || [];
    const title = story.title || outlineData.title || 'Untitled Story';
    const genre = config.genre || config.story_type || 'fantasy';
    const authorStyle = config.author_style || '';

    // LLM handles ALL safety considerations for DALL-E prompts - no regex sanitization
    logger.info(`[CoverArt] INPUT | storyId: ${id} | title: "${title?.substring(0, 50)}" | genre: ${genre}`);

    // Use OpenAI for both LLM and DALL-E
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Generate three prompts with increasing abstraction (LLM handles safety)
    const storyContext = { title, synopsis, themes, genre, authorStyle };
    const coverPrompts = await generateCoverPrompts(storyContext, openai);

    logger.info(`[CoverArt] TIERS_READY | storyId: ${id} | tierCount: ${coverPrompts.length}`);

    // Helper function to classify DALL-E errors
    const classifyDalleError = (error) => {
      const message = error.message?.toLowerCase() || '';
      const code = error.code || error.status;

      if (message.includes('content_policy') || message.includes('safety') || message.includes('rejected')) {
        return { type: 'content_policy', retryable: false };
      }
      if (code === 429 || message.includes('rate_limit') || message.includes('too many')) {
        return { type: 'rate_limit', retryable: true, delay: 5000 };
      }
      if (code === 503 || code === 502 || message.includes('overloaded') || message.includes('unavailable')) {
        return { type: 'transient', retryable: true, delay: 2000 };
      }
      if (message.includes('timeout') || message.includes('network')) {
        return { type: 'network', retryable: true, delay: 1000 };
      }
      return { type: 'unknown', retryable: false };
    };

    // Helper for retry with exponential backoff
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Try each prompt in order until one succeeds
    let dalleUrl = null;
    let successfulPrompt = null;
    let lastError = null;
    let allErrors = [];

    for (const promptData of coverPrompts) {
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          logger.info(`[CoverArt] ATTEMPT | tier: ${promptData.level} | desc: ${promptData.description} | retry: ${retryCount} | prompt: "${promptData.prompt.substring(0, 60)}..."`);

          const imageResponse = await openai.images.generate({
            model: 'dall-e-3',
            prompt: promptData.prompt,
            n: 1,
            size: '1024x1792', // Portrait orientation for book cover
            quality: 'standard',
            style: 'vivid'
          });

          dalleUrl = imageResponse.data[0]?.url;

          if (dalleUrl) {
            successfulPrompt = promptData;
            logger.info(`[CoverArt] TIER_SUCCESS | tier: ${promptData.level} | desc: ${promptData.description}`);
            break;
          }
        } catch (promptError) {
          const errorInfo = classifyDalleError(promptError);
          lastError = promptError;
          allErrors.push({
            level: promptData.level,
            type: errorInfo.type,
            message: promptError.message
          });

          logger.warn(`[CoverArt] TIER_FAILED | tier: ${promptData.level} | errorType: ${errorInfo.type} | retryable: ${errorInfo.retryable} | error: ${promptError.message}`);

          // Retry transient errors
          if (errorInfo.retryable && retryCount < maxRetries) {
            retryCount++;
            const delay = errorInfo.delay * retryCount;
            logger.info(`[CoverArt] RETRY | tier: ${promptData.level} | attempt: ${retryCount + 1}/${maxRetries + 1} | delayMs: ${delay}`);
            await sleep(delay);
            continue;
          }

          // Non-retryable or max retries reached, move to next prompt level
          break;
        }
      }

      // If we got a URL, stop trying more levels
      if (dalleUrl) break;
    }

    if (!dalleUrl) {
      // Provide detailed error info for debugging
      const contentPolicyErrors = allErrors.filter(e => e.type === 'content_policy');
      const rateLimitErrors = allErrors.filter(e => e.type === 'rate_limit');

      let userMessage = 'Failed to generate cover art';
      if (contentPolicyErrors.length === coverPrompts.length) {
        userMessage = 'Cover art generation was blocked by content policy. Try a different story theme.';
      } else if (rateLimitErrors.length > 0) {
        userMessage = 'Image generation service is busy. Please try again in a few minutes.';
      }

      throw {
        message: userMessage,
        details: allErrors,
        originalError: lastError
      };
    }

    // Download and save the image locally (DALL-E URLs expire after ~2 hours)
    const fs = await import('fs/promises');
    const path = await import('path');
    const https = await import('https');
    const { pipeline } = await import('stream/promises');
    const { createWriteStream } = await import('fs');

    // Create covers directory if it doesn't exist
    const coversDir = path.join(process.cwd(), 'public', 'covers');
    try {
      await fs.mkdir(coversDir, { recursive: true });
    } catch (e) {
      // Only log if not EEXIST (directory already exists is expected)
      if (e.code !== 'EEXIST') {
        logger.warn(`[Cover] Failed to create covers directory: ${e.message}`);
      }
    }

    // Generate unique filename with UUID to prevent any collision
    const filename = `cover_${id}_${Date.now()}_${uuidv4().substring(0, 8)}.png`;
    const localPath = path.join(coversDir, filename);

    // Download image with retry logic
    let downloadAttempts = 0;
    const maxDownloadAttempts = 3;
    let downloadSuccess = false;

    while (downloadAttempts < maxDownloadAttempts && !downloadSuccess) {
      downloadAttempts++;
      try {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => reject(new Error('Download timeout')), 30000);

          https.get(dalleUrl, (response) => {
            // Check for HTTP errors
            if (response.statusCode !== 200) {
              clearTimeout(timeoutId);
              reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
              return;
            }

            const fileStream = createWriteStream(localPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
              clearTimeout(timeoutId);
              fileStream.close();
              resolve();
            });
            fileStream.on('error', (err) => {
              clearTimeout(timeoutId);
              reject(err);
            });
          }).on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
          });
        });

        downloadSuccess = true;
        logger.info(`[CoverArt] DOWNLOAD_SUCCESS | attempt: ${downloadAttempts}/${maxDownloadAttempts}`);
      } catch (downloadError) {
        logger.warn(`[CoverArt] DOWNLOAD_FAILED | attempt: ${downloadAttempts}/${maxDownloadAttempts} | error: ${downloadError.message}`);
        // Clean up partial file if it exists
        try {
          await fs.unlink(localPath);
        } catch (e) {
          // File might not exist - log at debug level for diagnostics
          if (e.code !== 'ENOENT') {
            logger.debug(`[CoverArt] Cleanup warning: ${e.message}`);
          }
        }

        if (downloadAttempts < maxDownloadAttempts) {
          await sleep(1000 * downloadAttempts); // Exponential backoff
        }
      }
    }

    if (!downloadSuccess) {
      throw {
        message: 'Failed to download generated cover image. Please try again.',
        type: 'download_failed'
      };
    }

    // Use local URL that won't expire
    const localUrl = `/storyteller/covers/${filename}`;

    logger.info(`[CoverArt] SAVED | path: ${localUrl}`);

    // Save the LOCAL cover URL to the database
    await pool.query(`
      UPDATE story_sessions
      SET cover_image_url = $1, last_activity_at = NOW()
      WHERE id = $2
    `, [localUrl, id]);

    logger.info(`[CoverArt] OUTPUT | storyId: ${id} | success: true | tier: ${successfulPrompt?.level || 1} | url: ${localUrl}`);

    res.json({
      success: true,
      cover_url: localUrl,
      prompt_level: successfulPrompt?.level || 1,
      message: 'Cover generated successfully'
    });

  } catch (error) {
    logger.error(`[CoverArt] OUTPUT | storyId: ${id} | success: false | error: ${error?.message || error}`);

    // Clean up any partial file that might have been created
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const coversDir = path.join(process.cwd(), 'public', 'covers');
      const possibleFile = path.join(coversDir, `cover_${id}_*.png`);
      // Don't actually glob - just note that cleanup would be here
    } catch (e) {
      // Cleanup failures are non-critical - log at debug level
      logger.debug(`[CoverArt] Error cleanup warning: ${e.message}`);
    }

    // Determine appropriate status code and message
    let statusCode = 500;
    let userMessage = 'Failed to generate cover';
    let errorDetails = error.message || 'Unknown error';

    if (error.details) {
      // Our custom error object with details
      userMessage = error.message;
      errorDetails = error.details;
    } else if (error.status === 429 || error.message?.includes('rate')) {
      statusCode = 429;
      userMessage = 'Too many cover generation requests. Please wait a few minutes.';
    } else if (error.message?.includes('content_policy')) {
      statusCode = 400;
      userMessage = 'Cover content was blocked by safety filters. Try a different story theme.';
    } else if (error.type === 'download_failed') {
      statusCode = 502;
      userMessage = error.message;
    }

    res.status(statusCode).json({
      error: userMessage,
      details: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
      retryable: statusCode === 429 || statusCode === 502 || statusCode === 503
    });
  }
});

/**
 * POST /api/stories/:id/update-config
 * Update story configuration on-the-fly (voice, narrator style, etc.)
 */
router.post('/:id/update-config', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Get current config
    const sessionResult = await pool.query(
      'SELECT config_json FROM story_sessions WHERE id = $1',
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const currentConfig = sessionResult.rows[0].config_json || {};
    const newConfig = { ...currentConfig, ...updates };

    // Update the config
    await pool.query(`
      UPDATE story_sessions
      SET config_json = $1, last_activity_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(newConfig), id]);

    logger.info(`[Config] Story ${id} config updated:`, Object.keys(updates));

    res.json({
      success: true,
      config: newConfig,
      message: 'Configuration updated'
    });

  } catch (error) {
    logger.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * GET /api/stories/:id/usage
 * Get usage statistics and cost estimation for a story session
 */
router.get('/:id/usage', requireAuth, validateSessionId, requireSessionOwner, async (req, res) => {
  try {
    const { id } = req.params;

    // Import usage tracker dynamically to avoid circular dependency
    const usageTracker = await import('../services/usageTracker.js');

    // Get current session usage from memory
    const memoryUsage = usageTracker.getUsageSummary(id);

    // Also try to get persisted usage from database
    let dbUsage = null;
    try {
      const dbResult = await pool.query(`
        SELECT * FROM usage_tracking WHERE story_session_id = $1
      `, [id]);
      if (dbResult.rows.length > 0) {
        dbUsage = dbResult.rows[0];
      }
    } catch (dbErr) {
      // Table might not exist yet
      logger.debug('Usage tracking table not found, using memory only');
    }

    res.json({
      sessionId: id,
      current: memoryUsage,
      persisted: dbUsage ? {
        elevenlabs: {
          characters: dbUsage.elevenlabs_characters,
          requests: dbUsage.elevenlabs_requests,
          cost: parseFloat(dbUsage.elevenlabs_cost)
        },
        openai: {
          inputTokens: dbUsage.openai_input_tokens,
          outputTokens: dbUsage.openai_output_tokens,
          requests: dbUsage.openai_requests,
          cost: parseFloat(dbUsage.openai_cost)
        },
        whisper: {
          minutes: parseFloat(dbUsage.whisper_minutes),
          requests: dbUsage.whisper_requests,
          cost: parseFloat(dbUsage.whisper_cost)
        },
        realtime: {
          audioInputTokens: dbUsage.realtime_audio_input_tokens,
          audioOutputTokens: dbUsage.realtime_audio_output_tokens,
          cost: parseFloat(dbUsage.realtime_cost)
        },
        images: {
          count: dbUsage.image_count,
          cost: parseFloat(dbUsage.image_cost)
        },
        totalCost: parseFloat(dbUsage.total_cost),
        trackedAt: dbUsage.tracked_at
      } : null,
      pricing: usageTracker.default.PRICING
    });

  } catch (error) {
    logger.error('Error fetching usage:', error);
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
});

export default router;
