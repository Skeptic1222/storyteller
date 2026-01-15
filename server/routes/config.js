/**
 * Configuration Routes
 * Handles user preferences and story configuration
 */

import { Router } from 'express';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { completion, parseJsonResponse } from '../services/openai.js';
import { getUtilityModel } from '../services/modelSelection.js';
import smartConfig from '../services/smartConfig.js';
import { wrapRoutes, ValidationError } from '../middleware/errorHandler.js';
import { authenticateToken, requireAuth, requireAdmin } from '../middleware/auth.js';
import { schemas, validateBody } from '../middleware/validation.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken);

// Input sanitization helper
function sanitizePremise(text) {
  if (!text || typeof text !== 'string') return '';

  // Remove potential XSS/injection patterns
  let sanitized = text
    .replace(/<[^>]*>/g, '')  // Remove HTML tags
    .replace(/javascript:/gi, '')  // Remove javascript: URLs
    .replace(/on\w+=/gi, '')  // Remove event handlers
    .trim();

  // Limit length to prevent abuse
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000);
  }

  return sanitized;
}

// Default story configuration
const DEFAULT_CONFIG = {
  genres: {
    fantasy: 70,
    adventure: 50,
    mystery: 30,
    romance: 20,
    horror: 10,
    humor: 40,
    scifi: 30
  },
  intensity: {
    gore: 0,
    violence: 20,
    scary: 30
  },
  preferences: {
    bedtime_mode: false,
    cyoa_enabled: false,
    story_length: 'medium', // short, medium, long
    narrator_style: 'warm' // warm, dramatic, neutral
  },
  lengths: {
    short: { minutes: 5, scenes: 3 },
    medium: { minutes: 15, scenes: 8 },
    long: { minutes: 30, scenes: 15 }
  }
};

/**
 * GET /api/config/defaults
 * Get default story configuration
 */
router.get('/defaults', (req, res) => {
  res.json(DEFAULT_CONFIG);
});

/**
 * GET /api/config/preferences/:userId
 * Get user's saved preferences
 */
router.get('/preferences/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT long_term_preferences FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        preferences: DEFAULT_CONFIG,
        source: 'defaults'
      });
    }

    const userPrefs = result.rows[0].long_term_preferences || {};

    // Merge with defaults
    const merged = {
      ...DEFAULT_CONFIG,
      ...userPrefs,
      genres: { ...DEFAULT_CONFIG.genres, ...userPrefs.genres },
      intensity: { ...DEFAULT_CONFIG.intensity, ...userPrefs.intensity },
      preferences: { ...DEFAULT_CONFIG.preferences, ...userPrefs.preferences }
    };

    res.json({
      preferences: merged,
      source: 'user'
    });

  } catch (error) {
    logger.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * POST /api/config/preferences
 * Save user preferences
 */
router.post('/preferences', requireAuth, async (req, res) => {
  try {
    const { preferences } = req.body;
    const user_id = req.user.id;

    // Validate intensity levels
    if (preferences.intensity) {
      const maxGore = parseInt(process.env.MAX_GORE_LEVEL) || 50;
      const maxHorror = parseInt(process.env.MAX_HORROR_LEVEL) || 70;

      if (preferences.intensity.gore > maxGore) {
        preferences.intensity.gore = maxGore;
      }
      if (preferences.intensity.scary > maxHorror) {
        preferences.intensity.scary = maxHorror;
      }
    }

    // Upsert user with preferences
    await pool.query(`
      INSERT INTO users (id, long_term_preferences, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        long_term_preferences = users.long_term_preferences || $2,
        updated_at = NOW()
    `, [user_id, JSON.stringify(preferences)]);

    res.json({
      message: 'Preferences saved',
      preferences
    });

  } catch (error) {
    logger.error('Error saving preferences:', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

/**
 * GET /api/config/auto-select/:userId
 * Get user's auto-select preferences (which sections AI should configure automatically)
 */
router.get('/auto-select/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT long_term_preferences FROM users WHERE id = $1',
      [userId]
    );

    // Default auto-select settings (all enabled for new users)
    const defaults = {
      story_type: true,
      genres: true,
      intensity: true,
      narrator_style: true,
      author_style: true,
      audience: true,
      mood: true,
      multi_narrator: true,
      sfx: true,
      story_length: true
    };

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        auto_select: defaults,
        source: 'defaults'
      });
    }

    const prefs = result.rows[0].long_term_preferences || {};
    const autoSelect = prefs.auto_select || defaults;

    res.json({
      success: true,
      auto_select: autoSelect,
      source: 'user'
    });

  } catch (error) {
    logger.error('Error fetching auto-select preferences:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch auto-select preferences' });
  }
});

/**
 * POST /api/config/auto-select
 * Save user's auto-select preferences
 */
router.post('/auto-select', requireAuth, async (req, res) => {
  try {
    const { auto_select } = req.body;
    const user_id = req.user.id;

    if (!auto_select || typeof auto_select !== 'object') {
      return res.status(400).json({ success: false, error: 'auto_select object is required' });
    }

    // Upsert user with auto_select preferences nested in long_term_preferences
    await pool.query(`
      INSERT INTO users (id, long_term_preferences, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        long_term_preferences = COALESCE(users.long_term_preferences, '{}'::jsonb) || $2,
        updated_at = NOW()
    `, [user_id, JSON.stringify({ auto_select })]);

    logger.info(`[Config] Saved auto-select preferences for user ${user_id}`);

    res.json({
      success: true,
      message: 'Auto-select preferences saved',
      auto_select
    });

  } catch (error) {
    logger.error('Error saving auto-select preferences:', error);
    res.status(500).json({ success: false, error: 'Failed to save auto-select preferences' });
  }
});

/**
 * GET /api/config/genres
 * Get available story genres with descriptions
 */
router.get('/genres', (req, res) => {
  const genres = [
    { id: 'fantasy', name: 'Fantasy', description: 'Magic, mythical creatures, enchanted worlds', icon: '🧙' },
    { id: 'adventure', name: 'Adventure', description: 'Exciting journeys and brave heroes', icon: '⚔️' },
    { id: 'mystery', name: 'Mystery', description: 'Puzzles, clues, and discoveries', icon: '🔍' },
    { id: 'romance', name: 'Romance', description: 'Love stories and heartwarming tales', icon: '💕' },
    { id: 'horror', name: 'Spooky', description: 'Gentle scares and thrilling moments', icon: '👻' },
    { id: 'humor', name: 'Funny', description: 'Silly jokes and amusing situations', icon: '😄' },
    { id: 'scifi', name: 'Sci-Fi', description: 'Space, robots, and future worlds', icon: '🚀' },
    { id: 'animals', name: 'Animals', description: 'Talking animals and nature stories', icon: '🐻' },
    { id: 'fairytale', name: 'Fairy Tale', description: 'Classic storybook adventures', icon: '👑' }
  ];

  res.json({ genres });
});

/**
 * GET /api/config/narrator-styles
 * Get available narrator styles
 */
router.get('/narrator-styles', (req, res) => {
  const styles = [
    { id: 'warm', name: 'Warm & Gentle', description: 'Like a loving grandparent telling a story' },
    { id: 'dramatic', name: 'Dramatic', description: 'Theatrical and expressive for exciting tales' },
    { id: 'neutral', name: 'Neutral', description: 'Clear and steady for all story types' },
    { id: 'playful', name: 'Playful', description: 'Fun and energetic for silly stories' },
    { id: 'mysterious', name: 'Mysterious', description: 'Hushed and intriguing for mysteries' }
  ];

  res.json({ styles });
});

/**
 * GET /api/config/agent-prompts
 * Get agent prompts (admin only)
 */
router.get('/agent-prompts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT agent_name, description, model, temperature, max_tokens, is_active, version, updated_at
      FROM agent_prompts
      ORDER BY agent_name
    `);

    res.json({ prompts: result.rows });

  } catch (error) {
    logger.error('Error fetching agent prompts:', error);
    res.status(500).json({ error: 'Failed to fetch prompts' });
  }
});

/**
 * POST /api/config/interpret
 * Use AI to interpret voice prompt and suggest config changes
 */
router.post('/interpret', requireAuth, async (req, res) => {
  try {
    const { prompt, current_config } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const systemPrompt = `You are a helpful story configurator. Based on the user's request, suggest story configuration changes.

Available genres (values 0-100): fantasy, adventure, mystery, horror (max 70), humor, romance
Story lengths: short (~5 min), medium (~15 min), long (~30 min)
Narrator styles: warm, dramatic, playful, mysterious
Intensity scary level: 0-70

Current config: ${JSON.stringify(current_config)}

Respond with JSON in this exact format:
{
  "suggestion": "A friendly message acknowledging their request and explaining what you're setting up",
  "config_updates": {
    "genres": { "fantasy": 80, "adventure": 60 },
    "story_length": "medium",
    "intensity": { "scary": 20 },
    "narrator_style": "warm",
    "cyoa_enabled": false
  }
}

Only include fields in config_updates that need to change based on the request.
Keep suggestions friendly and engaging.`;

    const result = await completion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      model: getUtilityModel(),
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      agent_name: 'config_interpreter'
    });

    const response = parseJsonResponse(result.content);

    res.json({
      suggestion: response.suggestion || "I'll set that up for you!",
      config_updates: response.config_updates || {}
    });

  } catch (error) {
    logger.error('Error interpreting config prompt:', error);
    res.status(500).json({
      suggestion: "I heard you! Feel free to adjust the settings below.",
      config_updates: {}
    });
  }
});

/**
 * POST /api/config/smart-interpret
 * Use Smart Config engine to interpret premise text and suggest configuration
 * This is the primary endpoint for AI-driven auto-configuration
 */
router.post('/smart-interpret', requireAuth, rateLimiters.ai, async (req, res) => {
  const { premise, current_config } = req.body;

  if (!premise || typeof premise !== 'string') {
    throw new ValidationError('premise is required');
  }

  // Sanitize the premise text
  const sanitizedPremise = sanitizePremise(premise);

  if (sanitizedPremise.length < 10) {
    throw new ValidationError('Premise too short - please provide more detail');
  }

  logger.info('[Config] Smart interpret request:', sanitizedPremise.substring(0, 50));

  const result = await smartConfig.interpretPremise(sanitizedPremise, current_config || {});

  if (result.success) {
    res.json({
      success: true,
      suggestedConfig: result.suggestedConfig,
      reasoning: result.reasoning,
      analysis: result.analysis
    });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

/**
 * POST /api/config/smart-apply
 * Apply smart configuration to a session
 */
router.post('/smart-apply', requireAuth, async (req, res) => {
  try {
    const { session_id, premise, current_config } = req.body;

    if (!session_id || !premise) {
      return res.status(400).json({ error: 'session_id and premise are required' });
    }

    // Get interpretation
    const result = await smartConfig.interpretPremise(premise, current_config || {});

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Update session config in database
    await pool.query(`
      UPDATE story_sessions
      SET config_json = config_json || $1,
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(result.suggestedConfig), session_id]);

    res.json({
      success: true,
      appliedConfig: result.suggestedConfig,
      reasoning: result.reasoning
    });

  } catch (error) {
    logger.error('Error applying smart config:', error);
    res.status(500).json({ success: false, error: 'Failed to apply configuration' });
  }
});

/**
 * GET /api/config/voice-styles
 * Get all voice style presets with ElevenLabs parameters
 */
router.get('/voice-styles', (req, res) => {
  const styles = {
    warm: {
      name: 'Warm & Gentle',
      description: 'Soft, comforting, low-intensity',
      settings: { stability: 0.7, similarity_boost: 0.8, style: 0.3, speed: 0.9 },
      icon: '🌅',
      bestFor: ['calm', 'children', 'romance']
    },
    dramatic: {
      name: 'Dramatic',
      description: 'Theatrical, intense, emotional',
      settings: { stability: 0.5, similarity_boost: 0.75, style: 0.8, speed: 1.0 },
      icon: '🎭',
      bestFor: ['adventure', 'epic', 'action']
    },
    playful: {
      name: 'Playful',
      description: 'Light, fun, energetic',
      settings: { stability: 0.6, similarity_boost: 0.7, style: 0.6, speed: 1.1 },
      icon: '🎪',
      bestFor: ['comedy', 'children', 'fairytale']
    },
    mysterious: {
      name: 'Mysterious',
      description: 'Dark, suspenseful, intriguing',
      settings: { stability: 0.8, similarity_boost: 0.85, style: 0.4, speed: 0.85 },
      icon: '🌙',
      bestFor: ['mystery', 'horror', 'thriller']
    },
    horror: {
      name: 'Horror',
      description: 'Chilling, tense, atmospheric',
      settings: { stability: 0.85, similarity_boost: 0.9, style: 0.25, speed: 0.85 },
      icon: '👻',
      bestFor: ['horror', 'thriller']
    },
    epic: {
      name: 'Epic',
      description: 'Grand, sweeping, heroic',
      settings: { stability: 0.4, similarity_boost: 0.85, style: 0.7, speed: 1.0 },
      icon: '⚔️',
      bestFor: ['fantasy', 'adventure', 'scifi']
    },
    whimsical: {
      name: 'Whimsical',
      description: 'Quirky, imaginative, delightful',
      settings: { stability: 0.45, similarity_boost: 0.7, style: 0.55, speed: 1.05 },
      icon: '✨',
      bestFor: ['fairytale', 'children', 'comedy']
    },
    noir: {
      name: 'Noir',
      description: 'Moody, cynical, atmospheric',
      settings: { stability: 0.75, similarity_boost: 0.85, style: 0.35, speed: 0.9 },
      icon: '🎬',
      bestFor: ['mystery', 'thriller', 'detective']
    }
  };

  res.json({ styles });
});

/**
 * POST /api/config/voice-preview
 * Generate a preview for a specific voice + style combination
 */
router.post('/voice-preview', async (req, res) => {
  try {
    const { voice_id, style, text } = req.body;

    if (!voice_id) {
      return res.status(400).json({ error: 'voice_id is required' });
    }

    // Get style settings
    const styleSettings = {
      warm: { stability: 0.7, similarity_boost: 0.8, style: 0.3, speed: 0.9 },
      dramatic: { stability: 0.5, similarity_boost: 0.75, style: 0.8, speed: 1.0 },
      playful: { stability: 0.6, similarity_boost: 0.7, style: 0.6, speed: 1.1 },
      mysterious: { stability: 0.8, similarity_boost: 0.85, style: 0.4, speed: 0.85 }
    };

    const settings = styleSettings[style] || styleSettings.warm;
    const previewText = text || 'Once upon a time, in a land far away, there lived a brave adventurer.';

    // Forward to ElevenLabs (this would call the elevenlabs service)
    res.json({
      success: true,
      message: 'Preview generation would happen here',
      voice_id,
      style,
      settings
    });

  } catch (error) {
    logger.error('Error generating voice preview:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * GET /api/config/auto-select-status
 * Get which configuration sections have auto-select enabled
 */
router.get('/auto-select-status', (req, res) => {
  // Default auto-select status (would be stored per-user in production)
  res.json({
    sections: {
      narrator_voice: { enabled: false, label: 'Narrator Voice' },
      voice_style: { enabled: false, label: 'Voice Style' },
      writing_style: { enabled: false, label: 'Writing Style' },
      story_mood: { enabled: false, label: 'Story Mood' },
      genre_sliders: { enabled: false, label: 'Genre Mix' },
      story_format: { enabled: false, label: 'Story Format' },
      content_intensity: { enabled: false, label: 'Content Intensity' }
    },
    masterToggle: false
  });
});

/**
 * POST /api/config/auto-select-toggle
 * Toggle auto-select for a specific section or all sections
 */
router.post('/auto-select-toggle', async (req, res) => {
  try {
    const { section, enabled, masterToggle, user_id } = req.body;

    // In production, this would be stored per-user
    // For now, just acknowledge the toggle
    res.json({
      success: true,
      section,
      enabled,
      masterToggle
    });

  } catch (error) {
    logger.error('Error toggling auto-select:', error);
    res.status(500).json({ error: 'Failed to toggle auto-select' });
  }
});

/**
 * POST /api/config/rtc-input
 * Process RTC (realtime conversation) input for smart configuration
 * This endpoint is used by the RTC mode to interpret voice commands
 */
router.post('/rtc-input', requireAuth, async (req, res) => {
  try {
    const { transcript, session_context } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const result = await smartConfig.processRTCInput(transcript, session_context || {});

    res.json({
      success: true,
      type: result.type,
      updates: result.updates,
      response: result.response,
      reasoning: result.reasoning
    });

  } catch (error) {
    logger.error('Error processing RTC input:', error);
    res.status(500).json({
      success: false,
      response: "I had trouble understanding that. Could you try again?"
    });
  }
});

/**
 * POST /api/config/validate-premise
 * Validate a premise and return warnings/suggestions for improving the story
 */
router.post('/validate-premise', (req, res) => {
  try {
    const { premise, config } = req.body;

    const validation = smartConfig.validatePremise(premise, config || {});

    res.json({
      success: true,
      ...validation
    });
  } catch (error) {
    logger.error('Error validating premise:', error);
    res.status(500).json({ success: false, error: 'Failed to validate premise' });
  }
});

/**
 * GET /api/config/templates
 * Get all available story configuration templates (presets)
 */
router.get('/templates', (req, res) => {
  try {
    const templates = smartConfig.getTemplates();
    res.json({
      success: true,
      templates
    });
  } catch (error) {
    logger.error('Error fetching templates:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/config/templates/:templateId
 * Get a specific template with full configuration
 */
router.get('/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const template = smartConfig.getTemplateById(templateId);

    if (!template) {
      return res.status(404).json({ success: false, error: `Template '${templateId}' not found` });
    }

    res.json({
      success: true,
      template
    });
  } catch (error) {
    logger.error('Error fetching template:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
});

/**
 * POST /api/config/templates/apply
 * Apply a template to get merged configuration
 */
router.post('/templates/apply', (req, res) => {
  try {
    const { template_id, current_config } = req.body;

    if (!template_id) {
      return res.status(400).json({ success: false, error: 'template_id is required' });
    }

    const result = smartConfig.applyTemplate(template_id, current_config || {});

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error('Error applying template:', error);
    res.status(500).json({ success: false, error: 'Failed to apply template' });
  }
});

export default router;
