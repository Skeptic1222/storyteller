/**
 * Story Management Routes
 * Handles story sessions, scene generation, and CYOA choices
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool, withTransaction } from '../database/pool.js';
import { Orchestrator } from '../services/orchestrator.js';
import { ConversationEngine, NARRATOR_STYLES, LITERARY_STYLES, DEFAULT_VOICES } from '../services/conversationEngine.js';
import { completion, parseJsonResponse } from '../services/openai.js';
import { getUtilityModel } from '../services/modelSelection.js';
import { logger } from '../utils/logger.js';
import smartConfig from '../services/smartConfig.js';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth, canGenerateStory, recordStoryUsage } from '../middleware/auth.js';
import {
  validateSessionId,
  validateStoryStart,
  validateChoice,
  validateConversation,
  isValidUUID
} from '../middleware/validation.js';

const router = Router();

// Rate limiter for expensive operations (DALL-E cover generation)
// Limits to 3 cover generations per 5 minutes per IP
const coverGenerationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 requests per window
  message: { error: 'Too many cover generation requests. Please wait 5 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use session ID + IP to allow multiple users to generate covers
    const forwarded = req.headers['x-forwarded-for'];
    let ip = forwarded ? forwarded.split(',')[0].trim() : req.ip || 'unknown';
    // Strip port if present (IIS sometimes sends IP:port format)
    ip = ip.split(':')[0] || ip;
    return `${ip}_${req.params.id || 'unknown'}`;
  },
  // Skip validation since we have custom key generator (IIS proxy sends IP:port)
  validate: { xForwardedForHeader: false, trustProxy: false }
});

// Default anonymous user ID for unauthenticated requests
const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * POST /api/stories/start
 * Start a new story session
 * Uses optionalAuth - authenticated users get usage tracking, anonymous users use default ID
 */
router.post('/start', optionalAuth, validateStoryStart, async (req, res) => {
  try {
    const {
      mode = 'storytime',
      config = {},
      cyoa_enabled = false,
      bedtime_mode = true
    } = req.body;

    // Use authenticated user ID if available, otherwise anonymous
    const userId = req.user?.id || ANONYMOUS_USER_ID;
    const isAuthenticated = !!req.user;

    // Check usage limits for authenticated users
    if (isAuthenticated) {
      const usageCheck = await canGenerateStory(userId);
      if (!usageCheck.allowed) {
        return res.status(429).json({
          error: usageCheck.reason,
          usage: usageCheck.usage
        });
      }
    }

    // Use transaction for atomic session creation
    const sessionId = uuidv4();

    // Debug: Log incoming config to diagnose hide_speech_tags issue
    logger.info(`[Stories] Creating session | hide_speech_tags: ${config?.hide_speech_tags} | multi_voice: ${config?.multi_voice} | config keys: ${Object.keys(config || {}).join(', ')}`);

    const session = await withTransaction(async (client) => {
      // Create session
      const result = await client.query(`
        INSERT INTO story_sessions (id, user_id, mode, cyoa_enabled, bedtime_mode, config_json, current_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'planning')
        RETURNING *
      `, [sessionId, userId, mode, cyoa_enabled, bedtime_mode, JSON.stringify(config)]);

      // Log session start
      await client.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, 'system', 'internal', $2)
      `, [sessionId, `Story session started in ${mode} mode`]);

      // Record usage for authenticated users
      if (isAuthenticated) {
        await recordStoryUsage(userId, client);
      }

      return result.rows[0];
    });

    logger.info(`Story session started: ${sessionId} (user: ${isAuthenticated ? userId : 'anonymous'})`);

    res.status(201).json({
      session_id: sessionId,
      mode,
      status: 'planning',
      authenticated: isAuthenticated,
      message: mode === 'storytime'
        ? 'What kind of story would you like to hear tonight?'
        : 'Configure your story settings and click Start when ready.'
    });

  } catch (error) {
    logger.error('Error starting story:', error);
    res.status(500).json({ error: 'Failed to start story session' });
  }
});

/**
 * GET /api/stories/:id
 * Get story session details
 */
router.get('/:id', validateSessionId, async (req, res) => {
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

    // Get scenes (include polished_text for reconnection recovery)
    const scenes = await pool.query(`
      SELECT id, sequence_index, branch_key, summary, polished_text, audio_url, audio_duration_seconds, mood
      FROM story_scenes
      WHERE story_session_id = $1
      ORDER BY sequence_index
    `, [id]);

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
router.post('/:id/configure', async (req, res) => {
  try {
    const { id } = req.params;
    const { input, input_type = 'text' } = req.body;

    // Log user input
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'user', $2, $3)
    `, [id, input_type, input]);

    // Use orchestrator to process configuration
    const orchestrator = new Orchestrator(id);
    const response = await orchestrator.processConfiguration(input);

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
router.post('/:id/converse', async (req, res) => {
  try {
    const { id } = req.params;
    const { input, current_config = {}, conversation_history = [] } = req.body;

    // Log user input
    await pool.query(`
      INSERT INTO conversation_turns (story_session_id, role, modality, content)
      VALUES ($1, 'user', 'voice', $2)
    `, [id, input]);

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

After 2-3 exchanges or when you have enough information, indicate you're ready to start the story.

Respond naturally and conversationally. Keep responses SHORT (1-2 sentences max) since you're speaking aloud.

Return JSON with:
- response: Your spoken response (SHORT!)
- config_updates: Any extracted preferences as key-value pairs
- ready_to_start: true when you have enough info to start

Current preferences so far: ${JSON.stringify(current_config)}`
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

    // Use SmartConfig to detect additional settings the AI might miss (sfx_level, multi_narrator, etc.)
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
      if (smartAnalysis.multi_narrator) {
        result.config_updates = result.config_updates || {};
        result.config_updates.multi_narrator = true;
        logger.info('[Converse] SmartConfig detected multi_narrator request');
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
router.post('/:id/conversation', async (req, res) => {
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
 * GET /api/stories/config/styles
 * Get available literary styles, narrator styles, and default voices
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
 * POST /api/stories/:id/generate-outline
 * Generate story outline based on configuration
 */
router.post('/:id/generate-outline', async (req, res) => {
  try {
    const { id } = req.params;

    const orchestrator = new Orchestrator(id);
    const outline = await orchestrator.generateOutline();

    res.json({
      message: 'Outline generated',
      outline
    });

  } catch (error) {
    logger.error('Error generating outline:', error);
    // FIX: Pass specific error message to client for better UX
    const clientMessage = error.message.includes('Outline generation failed')
      ? error.message
      : 'Failed to generate outline. Please try again.';
    res.status(500).json({
      error: clientMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/stories/:id/continue
 * Generate the next scene
 */
router.post('/:id/continue', async (req, res) => {
  try {
    const { id } = req.params;
    const { voice_id } = req.body;

    // Update session status
    await pool.query(
      "UPDATE story_sessions SET current_status = 'narrating', last_activity_at = NOW() WHERE id = $1",
      [id]
    );

    const orchestrator = new Orchestrator(id);
    const scene = await orchestrator.generateNextScene(voice_id);

    res.json({
      scene,
      has_choices: scene.choices && scene.choices.length > 0,
      is_final: scene.is_final || false
    });

  } catch (error) {
    logger.error('Error continuing story:', error);
    res.status(500).json({ error: 'Failed to generate next scene' });
  }
});

/**
 * POST /api/stories/:id/generate-audio/:sceneId
 * Generate audio on-demand for a scene (for deferred audio mode)
 */
router.post('/:id/generate-audio/:sceneId', async (req, res) => {
  try {
    const { id, sceneId } = req.params;
    const { voice_id } = req.body;

    const orchestrator = new Orchestrator(id);
    const result = await orchestrator.generateSceneAudio(sceneId, voice_id);

    res.json({
      success: true,
      audioUrl: result.audioUrl,
      cached: result.cached
    });

  } catch (error) {
    logger.error('Error generating scene audio:', error);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

/**
 * POST /api/stories/:id/choice
 * Submit a CYOA choice
 */
router.post('/:id/choice', validateSessionId, validateChoice, async (req, res) => {
  try {
    const { id } = req.params;
    const { choice_id, choice_key } = req.body;

    // Use transaction for atomic choice recording
    const result = await withTransaction(async (client) => {
      // Mark choice as selected
      let choiceQuery;
      if (choice_id) {
        choiceQuery = await client.query(
          'UPDATE story_choices SET was_selected = true, selected_at = NOW() WHERE id = $1 RETURNING *',
          [choice_id]
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
router.get('/:id/scene/:sceneIndex', async (req, res) => {
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
router.post('/:id/pause', async (req, res) => {
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
router.post('/:id/end', async (req, res) => {
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
router.post('/:id/backtrack', async (req, res) => {
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
 * Sanitize cover prompt for DALL-E safety compliance
 * Transforms horror/violent content into atmospheric equivalents
 */
function sanitizeCoverPrompt(text, genre) {
  if (!text) return text;

  let sanitized = text;

  // Horror/violence word replacements for DALL-E safety
  const replacements = [
    // Violence -> atmosphere
    [/\b(blood|bloody|bleeding)\b/gi, 'crimson'],
    [/\b(gore|gory|gruesome)\b/gi, 'dramatic'],
    [/\b(kill|killing|killed|murder|murdered)\b/gi, 'confrontation'],
    [/\b(death|dead|dying|die|dies)\b/gi, 'fate'],
    [/\b(corpse|corpses|body|bodies)\b/gi, 'figure'],
    [/\b(severed|dismembered|mutilated)\b/gi, 'shadowy'],
    [/\b(torture|torment)\b/gi, 'struggle'],
    [/\b(weapon|knife|sword|gun|blade)\b/gi, 'object'],
    [/\b(attack|attacked|attacking)\b/gi, 'encounter'],
    [/\b(victim|victims)\b/gi, 'character'],
    [/\b(scream|screaming|screams)\b/gi, 'call'],
    [/\b(terror|terrorize|terrifying)\b/gi, 'intense'],
    [/\b(horrific|horrifying)\b/gi, 'dramatic'],
    [/\b(nightmare|nightmarish)\b/gi, 'dreamlike'],
    [/\b(demon|demonic|devil)\b/gi, 'ethereal being'],
    [/\b(monster|monstrous)\b/gi, 'mysterious creature'],
    [/\b(zombie|zombies|undead)\b/gi, 'spectral figure'],
    [/\b(evil|sinister|malevolent)\b/gi, 'enigmatic'],
    [/\b(haunted|haunting)\b/gi, 'atmospheric'],
    [/\b(ghost|ghosts|ghostly)\b/gi, 'ethereal presence'],
    [/\b(skull|skulls)\b/gi, 'symbol'],
    [/\b(grave|graveyard|cemetery)\b/gi, 'ancient grounds'],
    [/\b(fear|fearsome|afraid)\b/gi, 'tension'],
    [/\b(creepy|creeping)\b/gi, 'mysterious'],
    [/\b(dark force|dark forces)\b/gi, 'unknown force'],
    [/\b(possess|possessed|possession)\b/gi, 'transformed'],
    [/\b(curse|cursed)\b/gi, 'enchanted'],
    [/\b(sacrifice|sacrificed)\b/gi, 'offering'],
    [/\b(prey|predator)\b/gi, 'pursuer'],
    [/\b(stalk|stalking|stalker)\b/gi, 'following'],
    [/\b(trapped|trap)\b/gi, 'confined'],
    [/\b(escape|fleeing)\b/gi, 'journey']
  ];

  for (const [pattern, replacement] of replacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  // For horror genre, add safety framing
  if (genre && /horror|thriller|dark|scary/i.test(genre)) {
    // Transform genre descriptor
    sanitized = sanitized.replace(/\bhorror\b/gi, 'gothic suspense');
    sanitized = sanitized.replace(/\bthriller\b/gi, 'mystery suspense');
    sanitized = sanitized.replace(/\bscary\b/gi, 'atmospheric');
  }

  return sanitized;
}

/**
 * Generate three cover art prompts with increasing abstraction levels
 * Uses LLM to create prompts based on story context
 * Level 1: Direct scene from story
 * Level 2: More abstract/symbolic interpretation
 * Level 3: Highly abstract (guaranteed safe - metaphorical/symbolic only)
 */
async function generateCoverPrompts(storyContext, openai) {
  const { title, synopsis, themes, genre, authorStyle, characters } = storyContext;
  logger.info(`[CoverArt] PROMPT_GEN_INPUT | title: "${title?.substring(0, 40)}" | genre: ${genre} | themes: ${themes?.slice(0, 3).join(', ') || 'none'} | hasCharacters: ${!!characters?.length}`);

  const systemPrompt = `You are a professional book cover art director. Generate THREE image prompts for a paperback book cover, with increasing levels of abstraction.

CRITICAL RULES:
- NO text, titles, words, or letters in the image
- NO real people or celebrities
- Keep all content tasteful and suitable for general audiences
- Focus on mood, atmosphere, and symbolism

Output valid JSON with this exact structure:
{
  "prompts": [
    {
      "level": 1,
      "description": "Direct interpretation",
      "prompt": "full DALL-E prompt here"
    },
    {
      "level": 2,
      "description": "Abstract interpretation",
      "prompt": "full DALL-E prompt here"
    },
    {
      "level": 3,
      "description": "Highly abstract/symbolic",
      "prompt": "full DALL-E prompt here"
    }
  ]
}`;

  const userPrompt = `Create three cover art prompts for this story:

TITLE: ${title}
GENRE: ${genre}
${synopsis ? `SYNOPSIS: ${synopsis.substring(0, 300)}` : ''}
${themes?.length > 0 ? `THEMES: ${themes.slice(0, 5).join(', ')}` : ''}
${authorStyle ? `VISUAL STYLE: Reminiscent of ${authorStyle} book covers` : ''}
${characters?.length > 0 ? `KEY CHARACTERS: ${characters.slice(0, 3).map(c => c.name).join(', ')}` : ''}

Requirements for each level:
1. LEVEL 1 (Direct): A specific scene or moment from the story. Include setting, atmosphere, maybe a character silhouette. Cinematic and dramatic.
2. LEVEL 2 (Abstract): Focus on emotions and themes rather than literal scenes. Use symbolic imagery, color palette, and mood. Less specific details.
3. LEVEL 3 (Highly Abstract): Pure symbolism and metaphor. Could be abstract shapes, colors, nature imagery (like a single rose on silk, a key floating in clouds, etc). This MUST be safe for any content filter - no violence, no explicit content, just evocative abstract art.

Each prompt should be 2-3 sentences, suitable for DALL-E 3, specifying: style, composition, colors, mood, lighting.
Include "professional book cover art, no text" in each prompt.`;

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
router.post('/:id/generate-cover', coverGenerationLimiter, async (req, res) => {
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
    const rawSynopsis = story.synopsis || outlineData.synopsis || '';
    const rawThemes = story.themes || outlineData.themes || [];
    const rawTitle = story.title || outlineData.title || 'Untitled Story';
    const genre = config.genre || config.story_type || 'fantasy';
    const authorStyle = config.author_style || '';

    // Sanitize content for DALL-E safety compliance
    const title = sanitizeCoverPrompt(rawTitle, genre);
    const synopsis = sanitizeCoverPrompt(rawSynopsis, genre);
    const themes = rawThemes.map(t => sanitizeCoverPrompt(t, genre));
    const safeGenre = sanitizeCoverPrompt(genre, genre);

    logger.info(`[CoverArt] INPUT | storyId: ${id} | title: "${rawTitle?.substring(0, 50)}" | genre: ${safeGenre}`);

    // Use OpenAI for both LLM and DALL-E
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Generate three prompts with increasing abstraction
    const storyContext = { title, synopsis, themes, genre: safeGenre, authorStyle };
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

    // Generate unique filename
    const filename = `cover_${id}_${Date.now()}.png`;
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
        } catch (e) { /* ignore - file might not exist */ }

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
    } catch (e) { /* ignore cleanup errors */ }

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
router.post('/:id/update-config', async (req, res) => {
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
 * GET /api/stories/recent/:userId
 * Get recent stories for a user
 */
router.get('/recent/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
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
 * GET /api/stories/:id/usage
 * Get usage statistics and cost estimation for a story session
 */
router.get('/:id/usage', async (req, res) => {
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
