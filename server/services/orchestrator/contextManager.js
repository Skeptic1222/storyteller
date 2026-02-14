/**
 * Context Management Functions
 * Handles session loading, Story Bible context, and context window management.
 *
 * Extracted from orchestrator.js for better maintainability.
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import { countTokens, summarizeContext } from '../openai.js';
import { CONTEXT_LIMITS } from '../../constants/sceneGeneration.js';

// MEDIUM-9: Token budget now from centralized constants
const MAX_CONTEXT_TOKENS = CONTEXT_LIMITS.MAX_CONTEXT_TOKENS;
const CONTEXT_SUMMARY_THRESHOLD = CONTEXT_LIMITS.CONTEXT_SUMMARY_THRESHOLD;

/**
 * Load session data from database
 * @param {string} sessionId
 * @returns {object} Session row
 */
export async function loadSessionData(sessionId) {
  // Explicit columns instead of SELECT * for performance
  const result = await pool.query(
    `SELECT id, user_id, mode, cyoa_enabled, bedtime_mode, config_json,
            current_status, title, total_scenes, current_scene_index,
            started_at, ended_at, last_activity_at, context_summary
     FROM story_sessions WHERE id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    throw new Error('Session not found');
  }

  logger.info(`[ContextManager] Session loaded | id: ${sessionId} | status: ${result.rows[0].current_status}`);
  return result.rows[0];
}

/**
 * Load outline for a session
 * @param {string} sessionId
 * @returns {object|null} Outline with merged JSON
 */
export async function loadOutline(sessionId) {
  // Explicit columns instead of SELECT * for performance
  const result = await pool.query(
    `SELECT id, story_session_id, outline_json, themes, target_duration_minutes,
            notes, version, created_at, bible_json
     FROM story_outlines WHERE story_session_id = $1 ORDER BY version DESC LIMIT 1`,
    [sessionId]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return { ...row, ...(row.outline_json || {}) };
  }

  return null;
}

/**
 * Load characters from database or Story Bible context
 * @param {string} sessionId
 * @param {object} storyBibleContext - Optional Story Bible context for Advanced Mode
 * @returns {Array} Characters array
 */
export async function loadCharacters(sessionId, storyBibleContext = null) {
  if (storyBibleContext?.characters?.length > 0) {
    const characters = storyBibleContext.characters.map(char => ({
      id: char.id,
      story_session_id: sessionId,
      name: char.name,
      role: char.role || 'supporting',
      description: char.description || char.bio || '',
      traits_json: char.traits || char.personality_traits || [],
      gender: char.gender,
      age_group: char.age_group,
      appearance: char.appearance,
      backstory: char.backstory,
      voice_description: char.voice_description,
      relationships: char.relationships
    }));
    logger.info(`[ContextManager] ADVANCED MODE: Loaded ${characters.length} characters from Story Bible`);
    return characters;
  }

  // DB LIMIT PROTECTION: Limit characters to 100 max per session
  // Explicit columns for performance
  const result = await pool.query(
    `SELECT id, story_session_id, name, role, description, personality,
            traits_json, backstory, voice_description, appearance, appearance_json,
            portrait_url, gender, age_group, relationships_json, is_recurring, created_at
     FROM characters WHERE story_session_id = $1 LIMIT 100`,
    [sessionId]
  );
  return result.rows;
}

/**
 * Load lore entries from database or Story Bible context
 * @param {string} sessionId
 * @param {object} storyBibleContext - Optional Story Bible context for Advanced Mode
 * @returns {Array} Lore entries array
 */
export async function loadLore(sessionId, storyBibleContext = null) {
  if (storyBibleContext?.lore?.length > 0) {
    const lore = storyBibleContext.lore.map(entry => ({
      id: entry.id,
      story_session_id: sessionId,
      entry_type: entry.category || 'world',
      title: entry.title,
      content: entry.content,
      importance: entry.importance || 50
    }));
    logger.info(`[ContextManager] ADVANCED MODE: Loaded ${lore.length} lore entries from Story Bible`);
    return lore;
  }

  // DB LIMIT PROTECTION: Limit lore entries to 200 max per session
  // Explicit columns for performance
  const result = await pool.query(
    `SELECT id, story_session_id, entry_type, title, content, tags, importance,
            parent_location_id, created_at
     FROM lore_entries WHERE story_session_id = $1 ORDER BY importance DESC LIMIT 200`,
    [sessionId]
  );
  return result.rows;
}

/**
 * Load Story Bible session context for Advanced Mode
 * @param {string} sessionId
 * @returns {object|null} Story Bible context with parsed fields
 */
export async function loadStoryBibleSession(sessionId) {
  try {
    // Only select the columns we need (full_context contains all the data)
    const result = await pool.query(
      'SELECT id, story_session_id, library_id, full_context, created_at FROM story_bible_sessions WHERE story_session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      logger.debug(`[ContextManager] Standard mode - no Story Bible context found`);
      return null;
    }

    const row = result.rows[0];
    const fullContext = typeof row.full_context === 'string'
      ? JSON.parse(row.full_context)
      : row.full_context;

    const context = {
      fullContext,
      locations: fullContext?.locations || [],
      events: fullContext?.events || [],
      items: fullContext?.items || [],
      factions: fullContext?.factions || [],
      world: fullContext?.world || null,
      outline: fullContext?.outline || null,
      synopsis: fullContext?.synopsis || null,
      characters: fullContext?.characters || [],
      lore: fullContext?.lore || []
    };

    logger.info(`[ContextManager] ★ ADVANCED MODE ENABLED ★`);
    logger.info(`[ContextManager] Story Bible context loaded: ` +
      `characters=${context.characters.length}, ` +
      `locations=${context.locations.length}, ` +
      `events=${context.events.length}, ` +
      `items=${context.items.length}, ` +
      `factions=${context.factions.length}`);

    return context;
  } catch (error) {
    if (error.code === '42P01') {
      logger.debug(`[ContextManager] story_bible_sessions table not yet created`);
    } else {
      logger.warn(`[ContextManager] Failed to load Story Bible session:`, error.message);
    }
    return null;
  }
}

/**
 * Load or initialize story bible (persistent story knowledge base)
 * @param {string} sessionId
 * @returns {object} Story bible object
 */
export async function loadStoryBible(sessionId) {
  const result = await pool.query(
    'SELECT bible_json FROM story_outlines WHERE story_session_id = $1 ORDER BY version DESC LIMIT 1',
    [sessionId]
  );

  if (result.rows.length > 0 && result.rows[0].bible_json) {
    return result.rows[0].bible_json;
  }

  // Return empty story bible
  return {
    world_rules: [],
    character_facts: {},
    established_events: [],
    important_locations: [],
    recurring_themes: [],
    user_preferences: {}
  };
}

/**
 * Update story bible with new facts
 * @param {string} sessionId
 * @param {object} currentBible - Current story bible
 * @param {object} updates - New facts to merge
 * @returns {object} Updated story bible
 */
export async function updateStoryBible(sessionId, currentBible, updates) {
  const bible = { ...currentBible };

  if (updates.world_rules) {
    bible.world_rules = [...new Set([...bible.world_rules, ...updates.world_rules])];
  }
  if (updates.character_facts) {
    for (const [char, facts] of Object.entries(updates.character_facts)) {
      bible.character_facts[char] = {
        ...bible.character_facts[char],
        ...facts
      };
    }
  }
  if (updates.established_events) {
    bible.established_events.push(...updates.established_events);
  }
  if (updates.important_locations) {
    bible.important_locations = [...new Set([...bible.important_locations, ...updates.important_locations])];
  }
  if (updates.recurring_themes) {
    bible.recurring_themes = [...new Set([...bible.recurring_themes, ...updates.recurring_themes])];
  }

  // Persist to database
  await pool.query(
    'UPDATE story_outlines SET bible_json = $1 WHERE story_session_id = $2',
    [JSON.stringify(bible), sessionId]
  );

  logger.info(`[ContextManager] Story bible updated for session ${sessionId}`);
  return bible;
}

/**
 * Load context summary from database
 * @param {string} sessionId
 * @returns {string|null} Context summary
 */
export async function loadContextSummary(sessionId) {
  const result = await pool.query(
    'SELECT context_summary FROM story_sessions WHERE id = $1',
    [sessionId]
  );

  return result.rows[0]?.context_summary || null;
}

/**
 * Check and manage context window for long sessions
 * Summarizes context when approaching token limit
 * @param {string} sessionId
 * @param {object} options
 * @param {Array} options.characters
 * @param {object} options.outline
 * @param {string} options.previousSummary
 * @returns {object} { summarized, summary?, tokens? }
 */
export async function manageContextWindow(sessionId, options) {
  const { characters, outline, previousSummary } = options;

  // DB LIMIT PROTECTION: Limit scenes to prevent OOM for very long stories
  const scenesResult = await pool.query(
    'SELECT polished_text FROM story_scenes WHERE story_session_id = $1 ORDER BY sequence_index LIMIT 200',
    [sessionId]
  );

  const allText = scenesResult.rows.map(r => r.polished_text).join('\n\n');
  const estimatedTokens = countTokens(allText);

  logger.info(`[ContextManager] Context estimation: ${estimatedTokens} tokens (threshold: ${MAX_CONTEXT_TOKENS * CONTEXT_SUMMARY_THRESHOLD})`);

  if (estimatedTokens > MAX_CONTEXT_TOKENS * CONTEXT_SUMMARY_THRESHOLD) {
    logger.info('[ContextManager] Context threshold exceeded, generating summary...');

    const summary = await summarizeContext({
      scenes: scenesResult.rows.map(r => r.polished_text),
      characters,
      outline,
      previousSummary
    });

    // Persist summary
    await pool.query(
      'UPDATE story_sessions SET context_summary = $1 WHERE id = $2',
      [summary, sessionId]
    );

    logger.info('[ContextManager] Context summarized and persisted');
    return { summarized: true, summary };
  }

  return { summarized: false, tokens: estimatedTokens };
}

/**
 * Get optimized context for scene generation
 * Uses summary if available, otherwise full context
 * @param {object} options
 * @param {string} options.contextSummary
 * @param {object} options.storyBible
 * @param {Array} options.characters
 * @param {Array} options.lore
 * @returns {object} Optimized context
 */
export function getOptimizedContext({ contextSummary, storyBible, characters, lore }) {
  if (contextSummary) {
    return {
      type: 'summary',
      content: contextSummary,
      storyBible
    };
  }

  return {
    type: 'full',
    characters,
    lore,
    storyBible
  };
}

/**
 * Build Advanced Mode context for scene generation
 * @param {object} storyBibleContext - Full Story Bible context
 * @param {Array} lore - Lore entries (limited to top 10)
 * @returns {object} Formatted Story Bible context for scene generation
 */
export function buildAdvancedModeContext(storyBibleContext, lore) {
  if (!storyBibleContext) {
    return null;
  }

  return {
    isAdvancedMode: true,
    synopsis: storyBibleContext.synopsis,
    outline: storyBibleContext.outline,
    beats: storyBibleContext.fullContext?.beats,
    locations: (storyBibleContext.locations || []).map(loc => ({
      name: loc.name,
      type: loc.location_type || loc.type,
      description: loc.description,
      atmosphere: loc.atmosphere,
      notable_features: loc.notable_features
    })),
    events: (storyBibleContext.events || []).map(evt => ({
      title: evt.title,
      description: evt.description,
      event_type: evt.event_type,
      importance: evt.importance,
      suggested_timing: evt.suggested_timing,
      characters_involved: evt.characters_involved,
      is_incorporated: evt.is_incorporated
    })),
    items: (storyBibleContext.items || []).map(item => ({
      name: item.name,
      type: item.item_type || item.type,
      description: item.description,
      properties: item.properties,
      history: item.history
    })),
    factions: (storyBibleContext.factions || []).map(fac => ({
      name: fac.name,
      type: fac.faction_type || fac.type,
      description: fac.description,
      goals: fac.goals,
      relationships: fac.relationships
    })),
    world: storyBibleContext.world ? {
      name: storyBibleContext.world.name,
      description: storyBibleContext.world.description,
      genre: storyBibleContext.world.genre,
      time_period: storyBibleContext.world.time_period,
      magic_system: storyBibleContext.world.magic_system,
      technology_level: storyBibleContext.world.technology_level,
      society_structure: storyBibleContext.world.society_structure,
      tone: storyBibleContext.world.tone
    } : null,
    lore: lore.slice(0, 10).map(l => ({
      title: l.title,
      content: l.content,
      category: l.entry_type || l.category,
      importance: l.importance
    }))
  };
}

export default {
  loadSessionData,
  loadOutline,
  loadCharacters,
  loadLore,
  loadStoryBibleSession,
  loadStoryBible,
  updateStoryBible,
  loadContextSummary,
  manageContextWindow,
  getOptimizedContext,
  buildAdvancedModeContext
};
