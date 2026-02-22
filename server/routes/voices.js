/**
 * Voice Management Routes
 * Handles ElevenLabs voice listing, preview, and preferences
 */

import { Router } from 'express';
import { pool } from '../database/pool.js';
import { ElevenLabsService, RECOMMENDED_VOICES, VOICE_PRESETS } from '../services/elevenlabs.js';
import { VOICE_PREVIEWS, CHARACTER_VOICE_SUGGESTIONS, NARRATOR_STYLES } from '../services/conversationEngine.js';
import { logger } from '../utils/logger.js';
import { normalizeStyleValue } from '../utils/styleUtils.js';
import { wrapRoutes, NotFoundError } from '../middleware/errorHandler.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { authenticateToken, requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
const elevenlabs = new ElevenLabsService();
router.use(authenticateToken, requireAuth);

/**
 * GET /api/voices
 * List all available voices (with recommended voices first)
 */
router.get('/', async (req, res) => {
  try {
    // Flatten recommended voices for easy consumption - use explicit gender from voice object
    const recommendedFlat = [
      ...RECOMMENDED_VOICES.male_narrators.map(v => ({ ...v, category: 'narrator' })),
      ...RECOMMENDED_VOICES.female_narrators.map(v => ({ ...v, category: 'narrator' })),
      ...RECOMMENDED_VOICES.character_voices.map(v => ({ ...v, category: 'character' })),
      ...RECOMMENDED_VOICES.expressive_voices.map(v => ({ ...v, category: 'expressive' }))
    ];

    // Try to get from database cache first
    const cachedVoices = await pool.query(`
      SELECT voice_id, name, category, description, gender, age_group, style, preview_url
      FROM elevenlabs_voices
      WHERE is_available = true
      ORDER BY name
    `);

    if (cachedVoices.rows.length > 0) {
      return res.json({
        voices: cachedVoices.rows,
        recommended: recommendedFlat,
        presets: VOICE_PRESETS,
        source: 'cache',
        count: cachedVoices.rows.length
      });
    }

    // If no cached voices, fetch from ElevenLabs API
    const voices = await elevenlabs.getVoices();

    res.json({
      voices,
      recommended: recommendedFlat,
      presets: VOICE_PRESETS,
      source: 'api',
      count: voices.length
    });

  } catch (error) {
    logger.error('Error fetching voices:', error);
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

/**
 * GET /api/voices/recommended
 * Get curated list of recommended storytelling voices
 */
router.get('/recommended', async (req, res) => {
  try {
    const { gender, category } = req.query;

    let voices = [];

    if (gender === 'male') {
      voices = RECOMMENDED_VOICES.male_narrators;
    } else if (gender === 'female') {
      voices = RECOMMENDED_VOICES.female_narrators;
    } else if (category === 'character') {
      voices = RECOMMENDED_VOICES.character_voices;
    } else if (category === 'expressive') {
      voices = RECOMMENDED_VOICES.expressive_voices;
    } else {
      // Return all organized by category
      voices = RECOMMENDED_VOICES;
    }

    res.json({
      voices,
      presets: VOICE_PRESETS,
      total_count: Object.values(RECOMMENDED_VOICES).reduce((sum, arr) => sum + arr.length, 0)
    });
  } catch (error) {
    logger.error('Error fetching recommended voices:', error);
    res.status(500).json({ error: 'Failed to fetch recommended voices' });
  }
});

/**
 * POST /api/voices/sync
 * Sync voices from ElevenLabs API to database
 */
router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const voices = await elevenlabs.getVoices();

    if (!voices || voices.length === 0) {
      return res.json({ message: 'No voices to sync', synced: 0, genderUpdated: 0 });
    }

    // BATCH INSERT FIX: Prepare all values in arrays instead of N+1 individual inserts
    const voiceIds = [];
    const names = [];
    const categories = [];
    const descriptions = [];
    const labelsArr = [];
    const previewUrls = [];
    const settingsJsonArr = [];
    const genders = [];
    const ageGroups = [];
    const accents = [];
    const styles = [];

    let genderUpdated = 0;

    for (const voice of voices) {
      // Extract gender, age, accent, style from labels object
      // ElevenLabs labels format: { gender: "male", age: "young", accent: "British", description: "..." }
      const labels = voice.labels || {};
      const gender = labels.gender || null;
      const ageGroup = labels.age || null;
      const accent = labels.accent || null;
      const style = labels.description || labels.use_case || voice.description?.split(',')[0] || null;

      if (gender) genderUpdated++;

      voiceIds.push(voice.voice_id);
      names.push(voice.name);
      categories.push(voice.category || 'premade');
      descriptions.push(voice.description || '');
      labelsArr.push(JSON.stringify(voice.labels || {}));
      previewUrls.push(voice.preview_url || '');
      settingsJsonArr.push(JSON.stringify(voice.fine_tuning || {}));
      genders.push(gender);
      ageGroups.push(ageGroup);
      accents.push(accent);
      styles.push(style);
    }

    // Single batch upsert using UNNEST - ~10-15x faster than N+1 individual inserts
    const result = await pool.query(`
      INSERT INTO elevenlabs_voices (voice_id, name, category, description, labels, preview_url, settings_json, gender, age_group, accent, style)
      SELECT * FROM UNNEST(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::jsonb[],
        $6::text[], $7::jsonb[], $8::text[], $9::text[], $10::text[], $11::text[]
      )
      ON CONFLICT (voice_id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        labels = EXCLUDED.labels,
        preview_url = EXCLUDED.preview_url,
        settings_json = EXCLUDED.settings_json,
        gender = COALESCE(EXCLUDED.gender, elevenlabs_voices.gender),
        age_group = COALESCE(EXCLUDED.age_group, elevenlabs_voices.age_group),
        accent = COALESCE(EXCLUDED.accent, elevenlabs_voices.accent),
        style = COALESCE(EXCLUDED.style, elevenlabs_voices.style),
        last_synced_at = NOW()
    `, [
      voiceIds, names, categories, descriptions, labelsArr,
      previewUrls, settingsJsonArr, genders, ageGroups, accents, styles
    ]);

    const synced = result.rowCount || voices.length;
    logger.info(`[VoiceSync] Batch synced ${synced} voices, ${genderUpdated} with gender data`);

    res.json({
      message: 'Voices synced successfully',
      synced,
      genderUpdated,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error syncing voices:', error);
    res.status(500).json({ error: 'Failed to sync voices' });
  }
});

/**
 * POST /api/voices/preview
 * Generate a voice preview audio sample with optional style settings
 */
router.post('/preview', rateLimiters.tts, async (req, res) => {
  try {
    const { voice_id, text, voice_settings } = req.body;

    if (!voice_id) {
      return res.status(400).json({ error: 'voice_id is required' });
    }

    const previewText = text || `Once upon a time, in a land of wonder and mystery, there lived a brave adventurer seeking fortune and glory.`;

    // Apply voice settings if provided (stability, similarity_boost, style, speed)
    // V3 model supports audio emotion tags like [excited], [whisper], etc.
    const options = voice_settings ? {
      stability: voice_settings.stability ?? 0.5,
      similarity_boost: voice_settings.similarity_boost ?? 0.75,
      style: voice_settings.style ?? 0,
      use_speaker_boost: voice_settings.use_speaker_boost !== false,
      model_id: voice_settings.model_id || 'eleven_v3'
    } : {
      model_id: 'eleven_v3'
    };

    const audioBuffer = await elevenlabs.textToSpeech(previewText, voice_id, options);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=3600'
    });

    res.send(audioBuffer);

  } catch (error) {
    logger.error('Error generating voice preview:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * GET /api/voices/narrator-styles
 * Get available narrator style presets
 */
router.get('/narrator-styles', async (req, res) => {
  try {
    const styles = {
      warm: {
        name: 'Warm & Gentle',
        desc: 'Soothing, low-intensity delivery',
        stability: 0.7,
        similarity_boost: 0.8,
        style: 20,
        best_for: ['calm', 'children', 'romance']
      },
      dramatic: {
        name: 'Dramatic',
        desc: 'Epic and theatrical delivery',
        stability: 0.3,
        similarity_boost: 0.85,
        style: 80,
        best_for: ['fantasy', 'action', 'thriller']
      },
      playful: {
        name: 'Playful',
        desc: 'Fun and whimsical',
        stability: 0.5,
        similarity_boost: 0.75,
        style: 60,
        best_for: ['comedy', 'children', 'adventure']
      },
      mysterious: {
        name: 'Mysterious',
        desc: 'Dark and intriguing',
        stability: 0.8,
        similarity_boost: 0.9,
        style: 30,
        best_for: ['mystery', 'horror', 'thriller']
      },
      horror: {
        name: 'Horror',
        desc: 'Tense and unsettling',
        stability: 0.85,
        similarity_boost: 0.9,
        style: 25,
        best_for: ['horror', 'thriller', 'lovecraft']
      },
      epic: {
        name: 'Epic',
        desc: 'Grand and sweeping',
        stability: 0.4,
        similarity_boost: 0.85,
        style: 70,
        best_for: ['fantasy', 'scifi', 'tolkien']
      },
      whimsical: {
        name: 'Whimsical',
        desc: 'Light and fantastical',
        stability: 0.45,
        similarity_boost: 0.7,
        style: 55,
        best_for: ['fairy_tale', 'children', 'comedy']
      },
      noir: {
        name: 'Noir',
        desc: 'Hard-boiled detective style',
        stability: 0.75,
        similarity_boost: 0.85,
        style: 35,
        best_for: ['detective', 'mystery', 'thriller']
      }
    };

    res.json({ styles });
  } catch (error) {
    logger.error('Error fetching narrator styles:', error);
    res.status(500).json({ error: 'Failed to fetch narrator styles' });
  }
});

/**
 * GET /api/voices/previews
 * Get all voice preview samples with their sample text
 */
router.get('/previews', async (req, res) => {
  try {
    const { genre, style } = req.query;

    let previews = Object.entries(VOICE_PREVIEWS).map(([key, voice]) => ({
      key,
      ...voice,
      recommended: false
    }));

    // Mark recommended voices based on genre/style
    if (genre || style) {
      const searchTerms = [genre, style].filter(Boolean).map(s => s.toLowerCase());
      previews = previews.map(voice => ({
        ...voice,
        recommended: voice.bestFor.some(bf => searchTerms.includes(bf.toLowerCase()))
      }));
      // Sort recommended first
      previews.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    }

    res.json({
      previews,
      narrator_styles: NARRATOR_STYLES,
      character_suggestions: CHARACTER_VOICE_SUGGESTIONS
    });
  } catch (error) {
    logger.error('Error fetching voice previews:', error);
    res.status(500).json({ error: 'Failed to fetch voice previews' });
  }
});

/**
 * POST /api/voices/preview-sample
 * Generate audio for a specific voice preview sample
 */
router.post('/preview-sample', rateLimiters.tts, async (req, res) => {
  try {
    const { voice_key, narrator_style } = req.body;

    const voicePreview = VOICE_PREVIEWS[voice_key];
    if (!voicePreview) {
      return res.status(400).json({ error: 'Invalid voice key' });
    }

    // Get style settings if specified
    let voiceSettings = {};
    if (narrator_style && NARRATOR_STYLES[narrator_style]) {
      const style = NARRATOR_STYLES[narrator_style];
      voiceSettings = {
        stability: style.stability,
        similarity_boost: style.similarity_boost || 0.75,
        style: normalizeStyleValue(style.style, 0), // uses styleUtils.js
        use_speaker_boost: true
      };
    }

    const audioBuffer = await elevenlabs.textToSpeech(
      voicePreview.sampleText,
      voicePreview.id,
      {
        ...voiceSettings,
        model_id: 'eleven_v3' // V3 supports audio emotion tags
      }
    );

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'X-Voice-Name': voicePreview.name,
      'X-Voice-Key': voice_key,
      'Cache-Control': 'public, max-age=3600'
    });

    res.send(audioBuffer);
  } catch (error) {
    logger.error('Error generating voice sample:', error);
    res.status(500).json({ error: 'Failed to generate voice sample' });
  }
});

/**
 * GET /api/voices/character-suggestions
 * Get voice suggestions based on character role
 */
router.get('/character-suggestions', async (req, res) => {
  try {
    const { role, gender } = req.query;

    let suggestions = [];

    if (role && CHARACTER_VOICE_SUGGESTIONS[role]) {
      suggestions = CHARACTER_VOICE_SUGGESTIONS[role].map(voiceId => {
        const voiceEntry = Object.values(VOICE_PREVIEWS).find(v => v.id === voiceId);
        return voiceEntry ? { ...voiceEntry, voice_id: voiceId } : null;
      }).filter(Boolean);
    } else if (gender) {
      // Filter by gender
      const genderKey = gender.toLowerCase() === 'female' ? 'protagonist_female' : 'protagonist_male';
      suggestions = (CHARACTER_VOICE_SUGGESTIONS[genderKey] || []).map(voiceId => {
        const voiceEntry = Object.values(VOICE_PREVIEWS).find(v => v.id === voiceId);
        return voiceEntry ? { ...voiceEntry, voice_id: voiceId } : null;
      }).filter(Boolean);
    } else {
      // Return all available voice previews
      suggestions = Object.values(VOICE_PREVIEWS);
    }

    res.json({
      role: role || 'all',
      suggestions,
      roles_available: Object.keys(CHARACTER_VOICE_SUGGESTIONS)
    });
  } catch (error) {
    logger.error('Error fetching character suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch character suggestions' });
  }
});

/**
 * GET /api/voices/preferences/:userId
 * Get user's voice preferences
 */
router.get('/preferences/:userId', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT vp.*, ev.name as voice_name, ev.description as voice_description
      FROM voice_preferences vp
      LEFT JOIN elevenlabs_voices ev ON vp.elevenlabs_voice_id = ev.voice_id
      WHERE vp.user_id = $1
      ORDER BY vp.is_default DESC, vp.created_at DESC
    `, [userId]);

    res.json({ preferences: result.rows });

  } catch (error) {
    logger.error('Error fetching voice preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * POST /api/voices/preferences
 * Save a voice preference
 */
router.post('/preferences', async (req, res) => {
  try {
    const { preference_label, voice_id, is_default } = req.body;
    const user_id = req.user.id;

    if (!voice_id) {
      return res.status(400).json({ error: 'voice_id is required' });
    }

    // If setting as default, unset other defaults first
    if (is_default) {
      await pool.query(
        'UPDATE voice_preferences SET is_default = false WHERE user_id = $1',
        [user_id]
      );
    }

    // Get voice name from cache
    const voiceInfo = await pool.query(
      'SELECT name FROM elevenlabs_voices WHERE voice_id = $1',
      [voice_id]
    );

    const result = await pool.query(`
      INSERT INTO voice_preferences (user_id, preference_label, elevenlabs_voice_id, voice_name, is_default)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      user_id,
      preference_label || 'Custom',
      voice_id,
      voiceInfo.rows[0]?.name || 'Unknown',
      is_default || false
    ]);

    res.status(201).json({
      message: 'Preference saved',
      preference: result.rows[0]
    });

  } catch (error) {
    logger.error('Error saving voice preference:', error);
    res.status(500).json({ error: 'Failed to save preference' });
  }
});

/**
 * POST /api/voices/match
 * Match a voice description to the best available voice
 */
router.post('/match', async (req, res) => {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    // Simple keyword matching for now
    const keywords = description.toLowerCase();

    let query = 'SELECT * FROM elevenlabs_voices WHERE is_available = true';
    const conditions = [];
    const params = [];

    if (keywords.includes('male') || keywords.includes('grandfather') || keywords.includes('man')) {
      conditions.push("gender = 'male'");
    } else if (keywords.includes('female') || keywords.includes('grandmother') || keywords.includes('woman')) {
      conditions.push("gender = 'female'");
    }

    if (keywords.includes('deep') || keywords.includes('authoritative')) {
      conditions.push("style = 'deep' OR style = 'authoritative'");
    } else if (keywords.includes('warm') || keywords.includes('gentle') || keywords.includes('soft')) {
      conditions.push("style = 'warm' OR style = 'gentle' OR style = 'soothing'");
    }

    if (keywords.includes('young')) {
      conditions.push("age_group = 'young_adult'");
    } else if (keywords.includes('old') || keywords.includes('elderly') || keywords.includes('grandpa') || keywords.includes('grandma')) {
      conditions.push("age_group = 'elderly'");
    }

    if (conditions.length > 0) {
      query += ' AND (' + conditions.join(' OR ') + ')';
    }

    query += ' ORDER BY name LIMIT 3';

    const result = await pool.query(query);

    res.json({
      query: description,
      matches: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Error matching voice:', error);
    res.status(500).json({ error: 'Failed to match voice' });
  }
});

/**
 * POST /api/voices/suggest
 * Intelligently suggest the best narrator based on story configuration
 *
 * Takes into account:
 * - Genre mix (fantasy, horror, romance, comedy, mystery)
 * - Target audience (children, general, mature)
 * - Story mood (adventurous, dark, whimsical, dramatic)
 * - Author style preference
 * - Story type (narrative, cyoa, campaign)
 */
router.post('/suggest', async (req, res) => {
  try {
    const { genres, audience, mood, author_style, story_type, bedtime_mode } = req.body;

    // Voice profiles with suitability scores for different contexts
    const voiceProfiles = {
      // Male narrators
      'JBFqnCBsd6RMkjVDRZzb': { // George
        name: 'George', gender: 'male', style: 'warm',
        genres: { fantasy: 85, romance: 70, mystery: 65, horror: 40, comedy: 60, adventure: 75 },
        audiences: { children: 90, general: 85, mature: 70 },
        moods: { adventurous: 75, dark: 50, whimsical: 65, dramatic: 70, cozy: 95 },
        authors: { tolkien: 90, dickens: 85, rowling: 80, king: 45 },
        bedtime: 95
      },
      'onwK4e9ZLuTAKqWW03F9': { // Daniel
        name: 'Daniel', gender: 'male', style: 'authoritative',
        genres: { fantasy: 90, horror: 75, mystery: 85, romance: 50, comedy: 40, adventure: 85 },
        audiences: { children: 60, general: 85, mature: 90 },
        moods: { adventurous: 85, dark: 80, whimsical: 40, dramatic: 95, cozy: 50 },
        authors: { tolkien: 95, lovecraft: 75, christie: 80, martin: 90 },
        bedtime: 60
      },
      'N2lVS1w4EtoT3dr4eOWO': { // Callum
        name: 'Callum', gender: 'male', style: 'gravelly',
        genres: { fantasy: 95, horror: 85, mystery: 80, romance: 40, comedy: 45, adventure: 90 },
        audiences: { children: 40, general: 80, mature: 95 },
        moods: { adventurous: 90, dark: 95, whimsical: 30, dramatic: 90, cozy: 35 },
        authors: { tolkien: 90, lovecraft: 95, martin: 95, king: 85 },
        bedtime: 30
      },
      'yoZ06aMxZJJ28mfd3POQ': { // Sam
        name: 'Sam', gender: 'male', style: 'raspy',
        genres: { fantasy: 60, horror: 85, mystery: 95, romance: 35, comedy: 50, adventure: 70 },
        audiences: { children: 30, general: 75, mature: 90 },
        moods: { adventurous: 70, dark: 90, whimsical: 25, dramatic: 85, cozy: 30 },
        authors: { chandler: 95, hammett: 95, poe: 85, christie: 80 },
        bedtime: 25
      },

      // Female narrators
      'EXAVITQu4vr4xnSDxMaL': { // Bella
        name: 'Bella', gender: 'female', style: 'soft',
        genres: { fantasy: 80, romance: 90, mystery: 60, horror: 30, comedy: 65, adventure: 70 },
        audiences: { children: 95, general: 85, mature: 60 },
        moods: { adventurous: 65, dark: 35, whimsical: 80, dramatic: 55, cozy: 100 },
        authors: { rowling: 85, austen: 90, carroll: 85, seuss: 80 },
        bedtime: 100
      },
      'pFZP5JQG7iQjIQuC4Bku': { // Lily
        name: 'Lily', gender: 'female', style: 'British',
        genres: { fantasy: 85, romance: 80, mystery: 85, horror: 50, comedy: 75, adventure: 75 },
        audiences: { children: 85, general: 90, mature: 75 },
        moods: { adventurous: 75, dark: 50, whimsical: 85, dramatic: 70, cozy: 85 },
        authors: { rowling: 95, dickens: 80, austen: 90, christie: 85 },
        bedtime: 85
      },
      'ThT5KcBeYPX3keUQqHPh': { // Dorothy
        name: 'Dorothy', gender: 'female', style: 'pleasant',
        genres: { fantasy: 85, romance: 75, mystery: 70, horror: 40, comedy: 80, adventure: 80 },
        audiences: { children: 95, general: 90, mature: 65 },
        moods: { adventurous: 80, dark: 40, whimsical: 90, dramatic: 60, cozy: 90 },
        authors: { rowling: 90, baum: 95, seuss: 85, barrie: 90 },
        bedtime: 90
      },
      'XrExE9yKIg1WjnnlVkGX': { // Matilda
        name: 'Matilda', gender: 'female', style: 'warm',
        genres: { fantasy: 85, romance: 70, mystery: 55, horror: 25, comedy: 85, adventure: 80 },
        audiences: { children: 100, general: 85, mature: 50 },
        moods: { adventurous: 80, dark: 25, whimsical: 95, dramatic: 50, cozy: 95 },
        authors: { dahl: 100, seuss: 95, milne: 95, rowling: 85 },
        bedtime: 95
      }
    };

    // Calculate scores for each voice
    const scoredVoices = [];

    for (const [voiceId, profile] of Object.entries(voiceProfiles)) {
      let score = 0;
      let factors = [];

      // Genre scoring (weighted by genre slider values)
      if (genres && typeof genres === 'object') {
        let genreScore = 0;
        let genreWeight = 0;
        for (const [genre, value] of Object.entries(genres)) {
          if (value > 0 && profile.genres[genre]) {
            genreScore += profile.genres[genre] * (value / 100);
            genreWeight += value / 100;
          }
        }
        if (genreWeight > 0) {
          const normalizedGenreScore = genreScore / genreWeight;
          score += normalizedGenreScore * 0.3; // 30% weight
          factors.push({ type: 'genre', score: normalizedGenreScore });
        }
      }

      // Audience scoring
      if (audience && profile.audiences[audience]) {
        const audienceScore = profile.audiences[audience];
        score += audienceScore * 0.25; // 25% weight
        factors.push({ type: 'audience', score: audienceScore });
      }

      // Mood scoring
      if (mood && profile.moods[mood]) {
        const moodScore = profile.moods[mood];
        score += moodScore * 0.2; // 20% weight
        factors.push({ type: 'mood', score: moodScore });
      }

      // Author style scoring
      if (author_style && profile.authors[author_style]) {
        const authorScore = profile.authors[author_style];
        score += authorScore * 0.15; // 15% weight
        factors.push({ type: 'author', score: authorScore });
      }

      // Bedtime mode bonus
      if (bedtime_mode) {
        score += profile.bedtime * 0.1; // 10% weight
        factors.push({ type: 'bedtime', score: profile.bedtime });
      }

      scoredVoices.push({
        voice_id: voiceId,
        name: profile.name,
        gender: profile.gender,
        style: profile.style,
        score: Math.round(score),
        factors,
        reason: generateReasonText(profile, { genres, audience, mood, author_style, bedtime_mode })
      });
    }

    // Sort by score descending
    scoredVoices.sort((a, b) => b.score - a.score);

    // Return top 3 suggestions
    const suggestions = scoredVoices.slice(0, 3);

    res.json({
      suggestions,
      config: { genres, audience, mood, author_style, story_type, bedtime_mode },
      recommended: suggestions[0]
    });

  } catch (error) {
    logger.error('Error suggesting narrator:', error);
    res.status(500).json({ error: 'Failed to suggest narrator' });
  }
});

/**
 * POST /api/voices/assign-characters
 * Smart voice assignment for multi-narrator mode
 * Automatically assigns distinct voices to each character based on traits
 */
router.post('/assign-characters', async (req, res) => {
  try {
    const { characters, story_config } = req.body;

    if (!characters || !Array.isArray(characters) || characters.length === 0) {
      return res.status(400).json({ error: 'characters array is required' });
    }

    // Voice pools organized by character type
    const VOICE_POOLS = {
      // Male voices by archetype
      male_hero: [
        { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', traits: ['heroic', 'authoritative', 'confident'] },
        { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', traits: ['young', 'energetic', 'brave'] },
        { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', traits: ['warm', 'friendly', 'noble'] }
      ],
      male_villain: [
        { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', traits: ['dark', 'menacing', 'gravelly'] },
        { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', traits: ['raspy', 'sinister', 'mysterious'] },
        { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', traits: ['deep', 'commanding', 'threatening'] }
      ],
      male_elder: [
        { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', traits: ['wise', 'warm', 'grandfather'] },
        { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', traits: ['mature', 'deep', 'narrator'] },
        { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', traits: ['elderly', 'storyteller', 'calm'] }
      ],
      male_comic: [
        { id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', traits: ['witty', 'expressive', 'conversational'] },
        { id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', traits: ['casual', 'friendly', 'youthful'] },
        { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', traits: ['quirky', 'animated', 'fun'] }
      ],
      male_young: [
        { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', traits: ['young', 'energetic', 'boyish'] },
        { id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', traits: ['youthful', 'casual', 'friendly'] },
        { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', traits: ['teen', 'modern', 'relatable'] }
      ],

      // Female voices by archetype
      female_hero: [
        { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', traits: ['strong', 'British', 'elegant'] },
        { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', traits: ['confident', 'warm', 'narrator'] },
        { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', traits: ['expressive', 'emotional', 'powerful'] }
      ],
      female_villain: [
        { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', traits: ['seductive', 'mysterious', 'dark'] },
        { id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily', traits: ['cold', 'elegant', 'menacing'] },
        { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', traits: ['cunning', 'expressive', 'dangerous'] }
      ],
      female_elder: [
        { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', traits: ['grandmother', 'warm', 'wise'] },
        { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', traits: ['soft', 'nurturing', 'gentle'] },
        { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', traits: ['mature', 'storyteller', 'comforting'] }
      ],
      female_comic: [
        { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', traits: ['animated', 'expressive', 'fun'] },
        { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', traits: ['bubbly', 'energetic', 'cheerful'] },
        { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', traits: ['quirky', 'youthful', 'playful'] }
      ],
      female_young: [
        { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', traits: ['young', 'energetic', 'bright'] },
        { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', traits: ['teen', 'casual', 'modern'] },
        { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', traits: ['childlike', 'warm', 'storyteller'] }
      ],

      // Neutral/fantasy creature voices
      creature: [
        { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', traits: ['otherworldly', 'raspy', 'mysterious'] },
        { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', traits: ['deep', 'gravelly', 'inhuman'] },
        { id: 'ODq5zmih8GrVes37Dizd', name: 'Patrick', traits: ['strange', 'varied', 'flexible'] }
      ],

      // Child voices (use warm female voices pitched up or youthful voices)
      child: [
        { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', traits: ['childlike', 'warm', 'innocent'] },
        { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', traits: ['young', 'playful', 'sweet'] },
        { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', traits: ['youthful', 'energetic', 'bright'] }
      ]
    };

    // Track used voices to ensure distinctness
    const usedVoices = new Set();
    const assignments = [];

    // Character archetype detection
    const detectArchetype = (character) => {
      const name = (character.name || '').toLowerCase();
      const role = (character.role || '').toLowerCase();
      const traits = (character.traits || []).map(t => t.toLowerCase());
      const description = (character.description || '').toLowerCase();
      const all = ` ${name} ${role} ${traits.join(' ')} ${description} `;

      // Word boundary matcher (avoids "the" matching "he")
      const hasWord = (text, word) => {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(text);
      };

      // Gender detection - check female first (more specific indicators)
      let gender = character.gender?.toLowerCase();
      if (!gender) {
        // Use word boundaries to avoid false matches like "the" → "he"
        const femaleIndicators = ['queen', 'princess', 'lady', 'madam', 'witch', 'sorceress', 'mother', 'sister', 'daughter', 'woman', 'girl', 'she', 'her', 'empress', 'duchess', 'baroness', 'countess'];
        const maleIndicators = ['king', 'prince', 'lord', 'sir', 'wizard', 'sorcerer', 'father', 'brother', 'son', 'man', 'boy', 'he', 'his', 'emperor', 'duke', 'baron', 'count'];

        // Check female first (more specific)
        if (femaleIndicators.some(ind => hasWord(all, ind))) gender = 'female';
        else if (maleIndicators.some(ind => hasWord(all, ind))) gender = 'male';
        else gender = 'unknown';
      }

      // Age detection (with word boundaries)
      let age = 'adult';
      const youngIndicators = ['child', 'kid', 'boy', 'girl', 'young', 'little', 'teen', 'youth'];
      const elderIndicators = ['elder', 'old', 'ancient', 'wise', 'grandfather', 'grandmother', 'grandpa', 'grandma', 'mentor', 'sage', 'elderly', 'aged'];

      if (youngIndicators.some(ind => hasWord(all, ind))) age = 'young';
      else if (elderIndicators.some(ind => hasWord(all, ind))) age = 'elder';

      // Role detection
      let archetype = 'hero';
      const villainIndicators = ['villain', 'evil', 'dark', 'enemy', 'antagonist', 'wicked', 'sinister', 'malevolent'];
      const comicIndicators = ['comic', 'funny', 'jester', 'fool', 'comedic', 'silly', 'humor', 'clown', 'trickster'];
      const creatureIndicators = ['creature', 'monster', 'beast', 'dragon', 'demon', 'spirit', 'ghost', 'alien', 'goblin', 'troll', 'orc'];

      if (creatureIndicators.some(ind => hasWord(all, ind))) archetype = 'creature';
      else if (villainIndicators.some(ind => hasWord(all, ind))) archetype = 'villain';
      else if (comicIndicators.some(ind => hasWord(all, ind))) archetype = 'comic';

      return { gender, age, archetype };
    };

    // Get the best available voice for a character
    const assignVoice = (character, index) => {
      const { gender, age, archetype } = detectArchetype(character);

      // Build pool key
      let poolKey;
      if (archetype === 'creature') {
        poolKey = 'creature';
      } else if (age === 'young' && gender !== 'male') {
        poolKey = 'child'; // Use child pool for young non-male characters
      } else if (gender === 'male' || gender === 'unknown') {
        if (age === 'elder') poolKey = 'male_elder';
        else if (archetype === 'villain') poolKey = 'male_villain';
        else if (archetype === 'comic') poolKey = 'male_comic';
        else if (age === 'young') poolKey = 'male_young';
        else poolKey = 'male_hero';
      } else {
        if (age === 'elder') poolKey = 'female_elder';
        else if (archetype === 'villain') poolKey = 'female_villain';
        else if (archetype === 'comic') poolKey = 'female_comic';
        else if (age === 'young') poolKey = 'female_young';
        else poolKey = 'female_hero';
      }

      const pool = VOICE_POOLS[poolKey] || VOICE_POOLS.male_hero;

      // Find first unused voice in pool
      let selectedVoice = null;
      for (const voice of pool) {
        if (!usedVoices.has(voice.id)) {
          selectedVoice = voice;
          break;
        }
      }

      // If all voices in primary pool used, try related pools
      if (!selectedVoice) {
        // Define fallback pool order by gender
        const maleFallbackOrder = ['male_hero', 'male_villain', 'male_elder', 'male_comic', 'male_young', 'creature'];
        const femaleFallbackOrder = ['female_hero', 'female_villain', 'female_elder', 'female_comic', 'female_young', 'child'];
        const fallbackOrder = gender === 'female' ? femaleFallbackOrder : maleFallbackOrder;

        // Try each fallback pool for an unused voice
        for (const fallbackKey of fallbackOrder) {
          if (fallbackKey === poolKey) continue; // Skip primary pool we already checked
          const fallbackPool = VOICE_POOLS[fallbackKey];
          if (!fallbackPool) continue;

          for (const voice of fallbackPool) {
            if (!usedVoices.has(voice.id)) {
              selectedVoice = voice;
              break;
            }
          }
          if (selectedVoice) break;
        }
      }

      // If still no unused voice, try ANY unused voice
      if (!selectedVoice) {
        const allPools = Object.values(VOICE_POOLS);
        for (const anyPool of allPools) {
          for (const voice of anyPool) {
            if (!usedVoices.has(voice.id)) {
              selectedVoice = voice;
              break;
            }
          }
          if (selectedVoice) break;
        }
      }

      // Last resort: cycle through primary pool (duplicate voice)
      if (!selectedVoice) {
        selectedVoice = pool[index % pool.length];
        logger.warn(`[VoiceAssign] Had to reuse voice ${selectedVoice.name} for character ${character.name} - all voices exhausted`);
      }

      usedVoices.add(selectedVoice.id);

      return {
        character_name: character.name,
        character_id: character.id || `char_${index}`,
        voice_id: selectedVoice.id,
        voice_name: selectedVoice.name,
        voice_traits: selectedVoice.traits,
        detected: { gender, age, archetype, pool: poolKey },
        reason: `${selectedVoice.name} (${selectedVoice.traits.slice(0, 2).join(', ')}) matches ${gender} ${archetype}${age !== 'adult' ? ` (${age})` : ''}`
      };
    };

    // Process each character
    for (let i = 0; i < characters.length; i++) {
      const assignment = assignVoice(characters[i], i);
      assignments.push(assignment);
    }

    logger.info(`[VoiceAssign] Assigned ${assignments.length} character voices`);

    res.json({
      success: true,
      assignments,
      voices_used: usedVoices.size,
      story_config: story_config || null
    });

  } catch (error) {
    logger.error('Error assigning character voices:', error);
    res.status(500).json({ error: 'Failed to assign character voices' });
  }
});

// Import new services
import * as voiceSelectionService from '../services/voiceSelectionService.js';
import * as qualityTierConfig from '../services/qualityTierConfig.js';
import * as elevenlabsVoiceSync from '../services/elevenlabsVoiceSync.js';

/**
 * GET /api/voices/archetypes
 * Get all voice archetypes for character casting
 */
router.get('/archetypes', async (req, res) => {
  try {
    const archetypes = await voiceSelectionService.getArchetypes();

    res.json({
      archetypes,
      count: archetypes.length
    });
  } catch (error) {
    logger.error('Error fetching archetypes:', error);
    res.status(500).json({ error: 'Failed to fetch archetypes' });
  }
});

/**
 * GET /api/voices/archetypes/:key
 * Get voices matching a specific archetype
 */
router.get('/archetypes/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const voices = await voiceSelectionService.getVoicesByArchetype(key);

    res.json({
      archetype: key,
      voices,
      count: voices.length
    });
  } catch (error) {
    logger.error('Error fetching archetype voices:', error);
    res.status(500).json({ error: 'Failed to fetch archetype voices' });
  }
});

/**
 * POST /api/voices/select-narrator
 * Get AI-recommended narrator voice based on story config
 */
router.post('/select-narrator', async (req, res) => {
  try {
    const { mood, genre, language, preferredGender, qualityTier } = req.body;

    const voice = await voiceSelectionService.getNarratorVoice({
      mood,
      genre,
      language: language || 'en',
      preferredGender,
      qualityTier: qualityTier || 'standard'
    });

    res.json({
      voice,
      selectionMethod: voice.selectionMethod,
      metadata: voice.metadata
    });
  } catch (error) {
    logger.error('Error selecting narrator voice:', error);
    res.status(500).json({ error: 'Failed to select narrator voice' });
  }
});

/**
 * POST /api/voices/select-character
 * Get AI-recommended voice for a character
 */
router.post('/select-character', async (req, res) => {
  try {
    const { name, gender, age, archetype, personality, role, species, sessionId, qualityTier } = req.body;

    const voice = await voiceSelectionService.getCharacterVoice(
      { name, gender, age, archetype, personality, role, species },
      { sessionId, qualityTier: qualityTier || 'standard' }
    );

    res.json({
      character: name,
      voice,
      selectionMethod: voice.selectionMethod,
      metadata: voice.metadata
    });
  } catch (error) {
    logger.error('Error selecting character voice:', error);
    res.status(500).json({ error: 'Failed to select character voice' });
  }
});

/**
 * POST /api/voices/cast
 * Get voice cast for multiple characters
 */
router.post('/cast', async (req, res) => {
  try {
    const { characters, sessionId, qualityTier } = req.body;

    if (!characters || !Array.isArray(characters)) {
      return res.status(400).json({ error: 'characters array is required' });
    }

    const voiceCast = await voiceSelectionService.getVoiceCast(characters, {
      sessionId,
      qualityTier: qualityTier || 'standard'
    });

    // Convert Map to object for JSON response
    const cast = {};
    for (const [name, voice] of voiceCast) {
      cast[name] = voice;
    }

    res.json({
      cast,
      characterCount: voiceCast.size,
      sessionId
    });
  } catch (error) {
    logger.error('Error generating voice cast:', error);
    res.status(500).json({ error: 'Failed to generate voice cast' });
  }
});

/**
 * GET /api/voices/quality-tiers
 * Get quality tier configurations
 */
router.get('/quality-tiers', async (req, res) => {
  try {
    const tiers = qualityTierConfig.getAllTierConfigs();
    const comparison = qualityTierConfig.getTierComparison();

    res.json({
      tiers,
      comparison,
      default: 'standard'
    });
  } catch (error) {
    logger.error('Error fetching quality tiers:', error);
    res.status(500).json({ error: 'Failed to fetch quality tiers' });
  }
});

/**
 * POST /api/voices/quality-tiers/recommend
 * Get recommended quality tier based on story config
 */
router.post('/quality-tiers/recommend', async (req, res) => {
  try {
    const { expectedScenes, averageSceneLength, multiVoice, prioritizeQuality, budgetSensitive } = req.body;

    const recommendation = qualityTierConfig.recommendTier({
      expectedScenes,
      averageSceneLength,
      multiVoice,
      prioritizeQuality,
      budgetSensitive
    });

    res.json(recommendation);
  } catch (error) {
    logger.error('Error recommending quality tier:', error);
    res.status(500).json({ error: 'Failed to recommend quality tier' });
  }
});

/**
 * GET /api/voices/usage/:sessionId
 * Get TTS usage statistics for a session
 */
router.get('/usage/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Verify session ownership
    const session = await pool.query('SELECT user_id FROM story_sessions WHERE id = $1', [sessionId]);
    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized to access this session' });
    }

    const stats = await qualityTierConfig.getUsageStats(sessionId);

    res.json(stats);
  } catch (error) {
    logger.error('Error fetching usage stats:', error);
    res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
});

/**
 * POST /api/voices/usage/check
 * Check if session can generate more TTS
 */
router.post('/usage/check', async (req, res) => {
  try {
    const { sessionId, plannedChars } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await qualityTierConfig.checkUsageLimits(sessionId, plannedChars || 0);

    res.json(result);
  } catch (error) {
    logger.error('Error checking usage limits:', error);
    res.status(500).json({ error: 'Failed to check usage limits' });
  }
});

/**
 * POST /api/voices/cost-estimate
 * Estimate TTS cost for planned content
 */
router.post('/cost-estimate', async (req, res) => {
  try {
    const { segments, tier } = req.body;

    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments array is required' });
    }

    const estimate = qualityTierConfig.estimateCost(segments, tier || 'standard');

    res.json(estimate);
  } catch (error) {
    logger.error('Error estimating cost:', error);
    res.status(500).json({ error: 'Failed to estimate cost' });
  }
});

/**
 * POST /api/voices/sync-full
 * Full voice sync using new elevenlabsVoiceSync service
 */
router.post('/sync-full', requireAdmin, async (req, res) => {
  try {
    const { includeShared = false } = req.body;

    const result = await elevenlabsVoiceSync.syncVoicesFromElevenLabs({
      includeDisabled: false,
      updateExisting: true
    });

    let sharedResult = null;
    if (includeShared) {
      sharedResult = await elevenlabsVoiceSync.syncSharedVoicesFromLibrary();
    }

    res.json({
      success: true,
      synced: result.synced,
      updated: result.updated,
      errors: result.errors,
      sharedVoices: sharedResult,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error in full voice sync:', error);
    res.status(500).json({ error: 'Failed to sync voices' });
  }
});

/**
 * GET /api/voices/sync-status
 * Get voice sync status
 */
router.get('/sync-status', requireAdmin, async (req, res) => {
  try {
    const status = await elevenlabsVoiceSync.getSyncStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

/**
 * POST /api/voices/preview-styled
 * Generate preview with specific style preset
 */
router.post('/preview-styled', rateLimiters.tts, async (req, res) => {
  try {
    const { voice_id, style_preset, text, quality_tier } = req.body;

    if (!voice_id) {
      return res.status(400).json({ error: 'voice_id is required' });
    }

    const previewText = text || "The ancient forest whispered secrets to those brave enough to listen.";

    // Get style preset settings
    const presetSettings = VOICE_PRESETS[style_preset] || VOICE_PRESETS.mysterious;

    const audioBuffer = await elevenlabs.textToSpeech(previewText, voice_id, {
      ...presetSettings,
      quality_tier: quality_tier || 'fast' // Use fast tier for previews
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'X-Style-Preset': style_preset || 'default',
      'Cache-Control': 'public, max-age=3600'
    });

    res.send(audioBuffer);
  } catch (error) {
    logger.error('Error generating styled preview:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * GET /api/voices/hud/:sessionId
 * Get voice HUD data for story session
 */
router.get('/hud/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get session voice assignments
    const assignments = await voiceSelectionService.loadVoiceAssignments(sessionId);

    // Get usage stats
    const usage = await qualityTierConfig.getUsageStats(sessionId);

    // Get tier config
    const tierConfig = await qualityTierConfig.getSessionTier(sessionId);

    // Convert assignments to array
    const voiceList = [];
    for (const [character, voice] of assignments) {
      voiceList.push({
        character,
        voiceId: voice.voiceId,
        voiceName: voice.name,
        gender: voice.gender,
        previewUrl: voice.previewUrl
      });
    }

    res.json({
      sessionId,
      tier: tierConfig.tier,
      model: tierConfig.model,
      voices: voiceList,
      voiceCount: voiceList.length,
      usage: {
        totalChars: usage.usage.totalChars,
        percentUsed: usage.percentUsed.story,
        estimatedCost: usage.estimatedCost,
        remaining: usage.remaining.storyChars
      },
      limits: usage.limits
    });
  } catch (error) {
    logger.error('Error fetching voice HUD:', error);
    res.status(500).json({ error: 'Failed to fetch voice HUD' });
  }
});

/**
 * POST /api/voices/infer-gender
 * Infer gender from character name with confidence
 */
router.post('/infer-gender', async (req, res) => {
  try {
    const { name, description, role } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Import gender inference
    const { inferGender, getConfidenceLabel } = await import('../utils/genderInference.js');

    const result = inferGender(name, { description, role });

    res.json({
      name,
      gender: result.gender,
      confidence: result.confidence,
      confidenceLevel: getConfidenceLabel(result.confidence),
      reason: result.reason
    });
  } catch (error) {
    logger.error('Error inferring gender:', error);
    res.status(500).json({ error: 'Failed to infer gender' });
  }
});

/**
 * Generate human-readable reason for voice suggestion
 */
function generateReasonText(profile, config) {
  const reasons = [];

  if (config.bedtime_mode && profile.bedtime >= 90) {
    reasons.push('soothing for calm stories');
  }

  if (config.audience === 'children' && profile.audiences.children >= 90) {
    reasons.push('great for children');
  }

  if (config.genres?.horror > 50 && profile.genres.horror >= 80) {
    reasons.push('perfect for horror');
  } else if (config.genres?.fantasy > 50 && profile.genres.fantasy >= 85) {
    reasons.push('ideal for fantasy');
  } else if (config.genres?.mystery > 50 && profile.genres.mystery >= 80) {
    reasons.push('suited for mystery');
  } else if (config.genres?.romance > 50 && profile.genres.romance >= 80) {
    reasons.push('perfect for romance');
  }

  if (config.mood === 'dramatic' && profile.moods.dramatic >= 85) {
    reasons.push('delivers drama well');
  } else if (config.mood === 'whimsical' && profile.moods.whimsical >= 85) {
    reasons.push('playful and whimsical');
  } else if (config.mood === 'cozy' && profile.moods.cozy >= 85) {
    reasons.push('warm and cozy');
  }

  if (config.author_style && profile.authors[config.author_style] >= 90) {
    const authorNames = {
      tolkien: 'Tolkien',
      rowling: 'Rowling',
      king: 'Stephen King',
      lovecraft: 'Lovecraft',
      christie: 'Christie',
      austen: 'Austen'
    };
    reasons.push(`channeling ${authorNames[config.author_style] || config.author_style}`);
  }

  if (reasons.length === 0) {
    reasons.push(profile.style === 'warm' ? 'versatile storyteller' : `${profile.style} style`);
  }

  return reasons.slice(0, 2).join(', ');
}

export default router;
