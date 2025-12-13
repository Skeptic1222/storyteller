/**
 * ElevenLabs Voice Sync Service
 *
 * Syncs voices from ElevenLabs API to the local database for:
 * - Dynamic voice catalog (replaces hardcoded VOICE_POOLS)
 * - Voice library access (10,000+ community voices)
 * - Automatic voice metadata extraction (gender, age, accent, tags)
 *
 * Usage:
 *   import { syncVoicesFromElevenLabs, syncSharedVoicesFromLibrary } from './elevenlabsVoiceSync.js';
 *
 *   // Full sync of account voices
 *   await syncVoicesFromElevenLabs();
 *
 *   // Sync curated shared voices from library
 *   await syncSharedVoicesFromLibrary({ category: 'professional' });
 */

import axios from 'axios';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const API_KEY = process.env.ELEVENLABS_API_KEY;

// Voice categories to tag mapping
const CATEGORY_TAGS = {
  premade: ['default', 'professional'],
  cloned: ['cloned', 'custom'],
  generated: ['designed', 'generated'],
  professional: ['professional', 'high_quality']
};

// Label to tag mapping for voice metadata
const LABEL_TAG_MAPPING = {
  // Gender
  male: ['male'],
  female: ['female'],
  neutral: ['neutral', 'androgynous'],

  // Age
  young: ['young', 'youthful'],
  middle_aged: ['adult', 'mature'],
  old: ['elder', 'elderly', 'old'],

  // Accent
  american: ['american', 'usa'],
  british: ['british', 'uk', 'english'],
  australian: ['australian', 'aussie'],
  irish: ['irish'],
  scottish: ['scottish'],
  indian: ['indian', 'south_asian'],

  // Style/Use case
  narration: ['narrator', 'storyteller', 'audiobook'],
  conversational: ['conversational', 'friendly', 'casual'],
  news: ['news', 'professional', 'formal'],
  characters_animation: ['character', 'animation', 'expressive'],
  meditation: ['calm', 'meditation', 'soothing', 'bedtime'],
  ground_reporter: ['reporter', 'energetic', 'urgent'],
  audiobook: ['narrator', 'storyteller', 'warm'],
  video_games: ['character', 'game', 'expressive'],
  social_media: ['casual', 'friendly', 'social'],

  // Description keywords
  warm: ['warm'],
  authoritative: ['authoritative', 'confident'],
  friendly: ['friendly'],
  calm: ['calm', 'peaceful'],
  deep: ['deep'],
  raspy: ['raspy', 'gravelly'],
  soft: ['soft', 'gentle'],
  energetic: ['energetic', 'high_energy'],
  mysterious: ['mysterious', 'dark']
};

/**
 * Extract tags from voice labels and description
 * @param {Object} labels - ElevenLabs voice labels
 * @param {string} description - Voice description
 * @returns {string[]} Array of tags
 */
function extractTags(labels, description = '') {
  const tags = new Set();

  // Process labels
  if (labels) {
    for (const [key, value] of Object.entries(labels)) {
      const normalizedValue = String(value).toLowerCase().replace(/[^a-z0-9]/g, '_');

      // Direct mapping
      if (LABEL_TAG_MAPPING[normalizedValue]) {
        LABEL_TAG_MAPPING[normalizedValue].forEach(tag => tags.add(tag));
      }

      // Add the raw value as a tag too
      if (value && typeof value === 'string' && value.length > 2) {
        tags.add(normalizedValue);
      }
    }
  }

  // Process description for keywords
  const descLower = (description || '').toLowerCase();
  for (const [keyword, mappedTags] of Object.entries(LABEL_TAG_MAPPING)) {
    if (descLower.includes(keyword)) {
      mappedTags.forEach(tag => tags.add(tag));
    }
  }

  // Special character type detection
  if (descLower.includes('hero') || descLower.includes('brave')) tags.add('hero');
  if (descLower.includes('villain') || descLower.includes('evil') || descLower.includes('dark')) tags.add('villain');
  if (descLower.includes('comic') || descLower.includes('funny')) tags.add('comic');
  if (descLower.includes('child') || descLower.includes('kid')) tags.add('child');
  if (descLower.includes('elder') || descLower.includes('wise')) tags.add('elder');
  if (descLower.includes('bedtime') || descLower.includes('sleep')) tags.add('bedtime');

  return Array.from(tags);
}

/**
 * Infer energy level from labels and description
 * @param {Object} labels
 * @param {string} description
 * @returns {string} 'low', 'medium', or 'high'
 */
function inferEnergyLevel(labels, description = '') {
  const combined = JSON.stringify(labels || {}).toLowerCase() + ' ' + (description || '').toLowerCase();

  const highEnergyKeywords = ['energetic', 'exciting', 'animated', 'loud', 'shouty', 'action', 'dynamic'];
  const lowEnergyKeywords = ['calm', 'peaceful', 'soft', 'gentle', 'relaxed', 'meditation', 'bedtime', 'soothing'];

  if (highEnergyKeywords.some(k => combined.includes(k))) return 'high';
  if (lowEnergyKeywords.some(k => combined.includes(k))) return 'low';
  return 'medium';
}

/**
 * Infer pitch hint from voice characteristics
 * @param {Object} labels
 * @param {string} description
 * @returns {string}
 */
function inferPitchHint(labels, description = '') {
  const combined = JSON.stringify(labels || {}).toLowerCase() + ' ' + (description || '').toLowerCase();

  if (combined.includes('deep') || combined.includes('bass') || combined.includes('low')) return 'low';
  if (combined.includes('high') || combined.includes('bright') || combined.includes('child')) return 'high';
  if (combined.includes('very deep')) return 'very_low';
  if (combined.includes('soprano') || combined.includes('squeaky')) return 'very_high';
  return 'medium';
}

/**
 * Determine if voice is suitable for narration
 * @param {Object} voice
 * @returns {boolean}
 */
function isNarratorSuitable(voice) {
  const labels = voice.labels || {};
  const useCase = labels.use_case || labels.description || '';

  const narratorUseCases = ['narration', 'audiobook', 'meditation', 'narrative_story', 'informative_educational'];
  if (narratorUseCases.some(uc => useCase.toLowerCase().includes(uc))) return true;

  // Also check description
  const desc = (voice.description || '').toLowerCase();
  if (desc.includes('narrator') || desc.includes('storytell') || desc.includes('audiobook')) return true;

  return false;
}

/**
 * Determine if voice can portray child characters
 * @param {Object} voice
 * @returns {boolean}
 */
function canBeChild(voice) {
  const labels = voice.labels || {};
  const age = labels.age || '';
  const desc = (voice.description || '').toLowerCase();

  if (age === 'young' || age === 'child') return true;
  if (desc.includes('child') || desc.includes('kid') || desc.includes('young') || desc.includes('youthful')) return true;
  if (labels.gender === 'female' && (desc.includes('soft') || desc.includes('warm') || desc.includes('gentle'))) return true;

  return false;
}

/**
 * Start a sync log entry
 * @param {string} syncType
 * @param {string} triggeredBy
 * @returns {Promise<string>} Sync log ID
 */
async function startSyncLog(syncType, triggeredBy = 'manual') {
  try {
    const result = await pool.query(`
      INSERT INTO voice_sync_log (sync_type, triggered_by)
      VALUES ($1, $2)
      RETURNING id
    `, [syncType, triggeredBy]);
    return result.rows[0].id;
  } catch (error) {
    logger.error('[VoiceSync] Failed to create sync log:', error);
    return null;
  }
}

/**
 * Complete a sync log entry
 * @param {string} logId
 * @param {Object} results
 */
async function completeSyncLog(logId, results) {
  if (!logId) return;

  try {
    await pool.query(`
      UPDATE voice_sync_log
      SET completed_at = NOW(),
          voices_added = $1,
          voices_updated = $2,
          voices_deactivated = $3,
          errors_count = $4,
          errors_detail = $5,
          status = $6
      WHERE id = $7
    `, [
      results.added || 0,
      results.updated || 0,
      results.deactivated || 0,
      results.errors?.length || 0,
      JSON.stringify(results.errors || []),
      results.status || 'completed',
      logId
    ]);
  } catch (error) {
    logger.error('[VoiceSync] Failed to update sync log:', error);
  }
}

/**
 * Sync all voices from ElevenLabs account to database
 * @param {Object} options
 * @param {string} options.triggeredBy - 'manual', 'cron', 'startup'
 * @returns {Promise<Object>} Sync results
 */
export async function syncVoicesFromElevenLabs(options = {}) {
  const { triggeredBy = 'manual' } = options;

  logger.info('[VoiceSync] Starting full voice sync from ElevenLabs...');
  const logId = await startSyncLog('full', triggeredBy);

  const results = {
    added: 0,
    updated: 0,
    deactivated: 0,
    errors: [],
    status: 'completed'
  };

  try {
    // Fetch all voices from ElevenLabs
    const response = await axios.get(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        'xi-api-key': API_KEY
      }
    });

    const voices = response.data.voices || [];
    logger.info(`[VoiceSync] Fetched ${voices.length} voices from ElevenLabs`);

    // Track synced voice IDs
    const syncedVoiceIds = new Set();

    for (const voice of voices) {
      try {
        const labels = voice.labels || {};
        const tags = extractTags(labels, voice.description);
        const energyLevel = inferEnergyLevel(labels, voice.description);
        const pitchHint = inferPitchHint(labels, voice.description);

        // Determine source
        let source = 'default';
        if (voice.category === 'cloned') source = 'cloned';
        else if (voice.category === 'generated') source = 'designed';
        else if (voice.category === 'professional') source = 'library';

        // Upsert voice
        const upsertResult = await pool.query(`
          INSERT INTO elevenlabs_voices (
            voice_id, name, category, description, labels, preview_url, settings_json,
            gender, age_group, accent, style,
            source, tags, energy_level, pitch_hint,
            is_narrator_suitable, is_character_suitable, can_be_child,
            is_available, is_synced, last_synced_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
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
            source = EXCLUDED.source,
            tags = CASE WHEN array_length(EXCLUDED.tags, 1) > 0 THEN EXCLUDED.tags ELSE elevenlabs_voices.tags END,
            energy_level = EXCLUDED.energy_level,
            pitch_hint = EXCLUDED.pitch_hint,
            is_narrator_suitable = EXCLUDED.is_narrator_suitable,
            is_character_suitable = EXCLUDED.is_character_suitable,
            can_be_child = EXCLUDED.can_be_child,
            is_available = TRUE,
            is_synced = TRUE,
            sync_error = NULL,
            last_synced_at = NOW()
          RETURNING (xmax = 0) AS is_new
        `, [
          voice.voice_id,
          voice.name,
          voice.category || 'premade',
          voice.description || '',
          JSON.stringify(labels),
          voice.preview_url || '',
          JSON.stringify(voice.fine_tuning || {}),
          labels.gender || null,
          labels.age || null,
          labels.accent || null,
          labels.description || labels.use_case || null,
          source,
          tags,
          energyLevel,
          pitchHint,
          isNarratorSuitable(voice),
          true, // All voices can be used for characters
          canBeChild(voice),
          true,
          true
        ]);

        if (upsertResult.rows[0]?.is_new) {
          results.added++;
        } else {
          results.updated++;
        }

        syncedVoiceIds.add(voice.voice_id);

      } catch (voiceError) {
        logger.error(`[VoiceSync] Error syncing voice ${voice.voice_id}:`, voiceError.message);
        results.errors.push({
          voice_id: voice.voice_id,
          name: voice.name,
          error: voiceError.message
        });
      }
    }

    // Mark voices not in sync as unavailable (but don't delete)
    const deactivateResult = await pool.query(`
      UPDATE elevenlabs_voices
      SET is_available = FALSE, is_synced = FALSE
      WHERE voice_id NOT IN (SELECT unnest($1::text[]))
        AND source = 'default'
        AND is_available = TRUE
    `, [Array.from(syncedVoiceIds)]);

    results.deactivated = deactivateResult.rowCount;

    logger.info(`[VoiceSync] Sync complete: ${results.added} added, ${results.updated} updated, ${results.deactivated} deactivated, ${results.errors.length} errors`);

  } catch (error) {
    logger.error('[VoiceSync] Full sync failed:', error);
    results.status = 'failed';
    results.errors.push({
      type: 'api_error',
      error: error.message
    });
  }

  await completeSyncLog(logId, results);
  return results;
}

/**
 * Sync shared voices from ElevenLabs Voice Library
 * Note: This requires appropriate API access
 * @param {Object} options
 * @param {string} options.category - Filter by category
 * @param {number} options.limit - Max voices to sync
 * @returns {Promise<Object>} Sync results
 */
export async function syncSharedVoicesFromLibrary(options = {}) {
  const { category = 'professional', limit = 50, triggeredBy = 'manual' } = options;

  logger.info(`[VoiceSync] Syncing shared voices from library (category: ${category})...`);
  const logId = await startSyncLog('library', triggeredBy);

  const results = {
    added: 0,
    updated: 0,
    deactivated: 0,
    errors: [],
    status: 'completed'
  };

  try {
    // Note: The voice library API may require specific endpoints
    // This is a placeholder for the actual implementation
    // The actual endpoint might be /v1/voices/library or /v1/shared-voices

    const response = await axios.get(`${ELEVENLABS_API_URL}/shared-voices`, {
      headers: {
        'xi-api-key': API_KEY
      },
      params: {
        page_size: limit,
        category: category
      }
    });

    const voices = response.data.voices || [];
    logger.info(`[VoiceSync] Fetched ${voices.length} shared voices from library`);

    for (const voice of voices) {
      try {
        const labels = voice.labels || {};
        const tags = extractTags(labels, voice.description);
        tags.push('library', 'shared');

        await pool.query(`
          INSERT INTO elevenlabs_voices (
            voice_id, name, category, description, labels, preview_url,
            gender, age_group, accent, style,
            source, tags, shared_voice_id,
            is_narrator_suitable, is_character_suitable, can_be_child,
            is_available, is_synced, last_synced_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
          ON CONFLICT (voice_id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            labels = EXCLUDED.labels,
            preview_url = EXCLUDED.preview_url,
            is_available = TRUE,
            is_synced = TRUE,
            last_synced_at = NOW()
          RETURNING (xmax = 0) AS is_new
        `, [
          voice.voice_id,
          voice.name,
          'shared',
          voice.description || '',
          JSON.stringify(labels),
          voice.preview_url || '',
          labels.gender || null,
          labels.age || null,
          labels.accent || null,
          labels.use_case || null,
          'library',
          tags,
          voice.public_owner_id || voice.voice_id,
          isNarratorSuitable(voice),
          true,
          canBeChild(voice),
          true,
          true
        ]);

        results.added++;

      } catch (voiceError) {
        logger.error(`[VoiceSync] Error syncing shared voice ${voice.voice_id}:`, voiceError.message);
        results.errors.push({
          voice_id: voice.voice_id,
          name: voice.name,
          error: voiceError.message
        });
      }
    }

  } catch (error) {
    // Shared voices API might not be available on all plans
    logger.warn('[VoiceSync] Shared voices sync not available:', error.message);
    results.status = 'partial';
    results.errors.push({
      type: 'api_not_available',
      error: 'Shared voices API may require specific plan access'
    });
  }

  await completeSyncLog(logId, results);
  return results;
}

/**
 * Get sync status
 * @returns {Promise<Object>} Latest sync status
 */
export async function getSyncStatus() {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM elevenlabs_voices WHERE is_available = TRUE) AS available_voices,
        (SELECT COUNT(*) FROM elevenlabs_voices WHERE is_synced = TRUE) AS synced_voices,
        (SELECT COUNT(*) FROM elevenlabs_voices WHERE gender = 'male' AND is_available = TRUE) AS male_voices,
        (SELECT COUNT(*) FROM elevenlabs_voices WHERE gender = 'female' AND is_available = TRUE) AS female_voices,
        (SELECT COUNT(*) FROM elevenlabs_voices WHERE is_narrator_suitable = TRUE AND is_available = TRUE) AS narrator_voices,
        (SELECT MAX(last_synced_at) FROM elevenlabs_voices) AS last_sync,
        (SELECT status FROM voice_sync_log ORDER BY started_at DESC LIMIT 1) AS last_sync_status
    `);

    return result.rows[0];
  } catch (error) {
    logger.error('[VoiceSync] Error getting sync status:', error);
    return null;
  }
}

/**
 * Manual voice metadata update
 * Allows admins to correct/enhance voice metadata
 * @param {string} voiceId
 * @param {Object} updates
 */
export async function updateVoiceMetadata(voiceId, updates) {
  const allowedFields = [
    'tags', 'gender', 'age_group', 'accent', 'style', 'energy_level', 'pitch_hint',
    'is_narrator_suitable', 'is_character_suitable', 'can_be_child', 'quality_score',
    'warmth', 'clarity', 'emotion_range', 'cost_tier'
  ];

  const fields = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(voiceId);

  await pool.query(`
    UPDATE elevenlabs_voices
    SET ${fields.join(', ')}
    WHERE voice_id = $${paramIndex}
  `, values);

  logger.info(`[VoiceSync] Updated metadata for voice ${voiceId}:`, updates);
}

export default {
  syncVoicesFromElevenLabs,
  syncSharedVoicesFromLibrary,
  getSyncStatus,
  updateVoiceMetadata
};
