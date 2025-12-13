/**
 * Story Continuation Service
 * Allows continuing completed stories with new adventures
 *
 * MODEL: This is a CREATIVE task - uses tier-based model selection
 * Premium: gpt-5.1, Standard: gpt-4o
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { completion } from './openai.js';
import { getCreativeModel, getQualityTier } from './modelSelection.js';

/**
 * Generate continuation ideas for a completed story
 */
async function generateContinuationIdeas(sessionId) {
  // Get story details
  const storyResult = await pool.query(
    `SELECT ss.*, so.outline_json
     FROM story_sessions ss
     LEFT JOIN story_outlines so ON so.story_session_id = ss.id
     WHERE ss.id = $1`,
    [sessionId]
  );

  if (storyResult.rows.length === 0) {
    throw new Error('Story not found');
  }

  const story = storyResult.rows[0];
  const outline = story.outline_json ? JSON.parse(story.outline_json) : {};

  // Get characters
  const charsResult = await pool.query(
    `SELECT name, role, traits_json FROM characters WHERE story_session_id = $1`,
    [sessionId]
  );

  // Get last few scenes for context
  const scenesResult = await pool.query(
    `SELECT polished_text FROM story_scenes
     WHERE story_session_id = $1
     ORDER BY sequence DESC LIMIT 3`,
    [sessionId]
  );

  const characters = charsResult.rows.map(c => ({
    name: c.name,
    role: c.role,
    traits: c.traits_json
  }));

  const recentScenes = scenesResult.rows.map(s => s.polished_text).reverse();

  // Generate continuation ideas using GPT
  const prompt = `Based on this completed story, generate 3 creative continuation ideas for a sequel adventure.

Story Title: ${outline.title || story.title || 'Untitled'}
Genre: ${story.genre || outline.genre || 'Fantasy'}
Setting: ${outline.setting || 'Unknown'}
Theme: ${outline.theme || 'Adventure'}

Characters:
${characters.map(c => `- ${c.name} (${c.role}): ${JSON.stringify(c.traits)}`).join('\n')}

Recent scenes summary:
${recentScenes.join('\n---\n')}

Generate 3 distinct continuation ideas. Each should:
1. Build on the existing characters and world
2. Introduce a new conflict or adventure
3. Be suitable for the same audience as the original
4. Feel like a natural sequel

Return as JSON array with format:
[
  {
    "title": "Sequel title",
    "hook": "One sentence hook",
    "synopsis": "2-3 sentence synopsis",
    "newElements": ["new character/location/plot element"],
    "tone": "similar/lighter/darker than original"
  }
]`;

  try {
    // Creative task - use tier-based model (GPT-5.1 in premium, GPT-4o in standard)
    const model = getCreativeModel();
    logger.info(`[StoryContinuation] Using ${model} for sequel generation (tier: ${getQualityTier()})`);

    const response = await completion({
      messages: [{ role: 'user', content: prompt }],
      model,
      temperature: 0.8,
      max_tokens: 1000,
      agent_name: 'story_continuation',
      sessionId
    });

    const content = response.content;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const ideas = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    logger.info(`[StoryContinuation] Generated ${ideas.length} continuation ideas for ${sessionId}`);

    return {
      originalStory: {
        id: sessionId,
        title: outline.title || story.title,
        genre: story.genre,
        characters: characters.map(c => c.name)
      },
      ideas
    };
  } catch (error) {
    logger.error('[StoryContinuation] Failed to generate ideas:', error);
    throw error;
  }
}

/**
 * Create a continuation story from an original story
 */
async function createContinuation(originalSessionId, options = {}) {
  const {
    userId,
    continuationIdea,
    preserveCharacters = true,
    preserveLore = true
  } = options;

  // Get original story
  const originalResult = await pool.query(
    `SELECT * FROM story_sessions WHERE id = $1`,
    [originalSessionId]
  );

  if (originalResult.rows.length === 0) {
    throw new Error('Original story not found');
  }

  const original = originalResult.rows[0];

  // Create new session
  const newSessionId = uuidv4();

  await pool.query(
    `INSERT INTO story_sessions
     (id, user_id, mode, genre, status, config_json, parent_session_id, continuation_number)
     VALUES ($1, $2, $3, $4, 'configuring', $5, $6,
       (SELECT COALESCE(MAX(continuation_number), 0) + 1 FROM story_sessions WHERE parent_session_id = $6 OR id = $6))`,
    [
      newSessionId,
      userId || original.user_id,
      original.mode,
      original.genre,
      original.config_json,
      originalSessionId
    ]
  );

  // Copy characters if requested
  if (preserveCharacters) {
    const chars = await pool.query(
      `SELECT name, role, traits_json, appearance_json, portrait_url, species, gender, age
       FROM characters WHERE story_session_id = $1`,
      [originalSessionId]
    );

    for (const char of chars.rows) {
      await pool.query(
        `INSERT INTO characters
         (story_session_id, name, role, traits_json, appearance_json, portrait_url, species, gender, age)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newSessionId, char.name, char.role, char.traits_json, char.appearance_json,
         char.portrait_url, char.species, char.gender, char.age]
      );
    }

    logger.info(`[StoryContinuation] Copied ${chars.rows.length} characters to continuation`);
  }

  // Copy lore entries if requested
  if (preserveLore) {
    const lore = await pool.query(
      `SELECT title, content, tags, entry_type
       FROM lore_entries WHERE story_session_id = $1`,
      [originalSessionId]
    );

    for (const entry of lore.rows) {
      await pool.query(
        `INSERT INTO lore_entries
         (story_session_id, title, content, tags, entry_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [newSessionId, entry.title, entry.content, entry.tags, entry.entry_type]
      );
    }

    logger.info(`[StoryContinuation] Copied ${lore.rows.length} lore entries to continuation`);
  }

  // Create continuation context
  const contextResult = await pool.query(
    `SELECT outline_json FROM story_outlines WHERE story_session_id = $1`,
    [originalSessionId]
  );

  const originalOutline = contextResult.rows[0]?.outline_json
    ? JSON.parse(contextResult.rows[0].outline_json)
    : {};

  // Get original story summary for continuation context
  const sceneSummary = await pool.query(
    `SELECT polished_text FROM story_scenes
     WHERE story_session_id = $1
     ORDER BY sequence`,
    [originalSessionId]
  );

  const storySummary = sceneSummary.rows.map(s => s.polished_text).join('\n\n');

  // Store continuation context
  await pool.query(
    `INSERT INTO continuation_context
     (continuation_session_id, original_session_id, original_summary, continuation_idea_json)
     VALUES ($1, $2, $3, $4)`,
    [newSessionId, originalSessionId, storySummary.substring(0, 5000), JSON.stringify(continuationIdea)]
  );

  logger.info(`[StoryContinuation] Created continuation ${newSessionId} from ${originalSessionId}`);

  return {
    sessionId: newSessionId,
    originalSessionId,
    preservedCharacters: preserveCharacters ? (await pool.query(
      `SELECT COUNT(*) FROM characters WHERE story_session_id = $1`, [newSessionId]
    )).rows[0].count : 0,
    preservedLore: preserveLore ? (await pool.query(
      `SELECT COUNT(*) FROM lore_entries WHERE story_session_id = $1`, [newSessionId]
    )).rows[0].count : 0
  };
}

/**
 * Get all continuations for a story
 */
async function getStoryContinuations(sessionId) {
  // Get direct continuations
  const continuations = await pool.query(
    `SELECT ss.id, ss.title, ss.status, ss.continuation_number, ss.created_at,
            (SELECT COUNT(*) FROM story_scenes WHERE story_session_id = ss.id) as scene_count
     FROM story_sessions ss
     WHERE ss.parent_session_id = $1
     ORDER BY ss.continuation_number`,
    [sessionId]
  );

  // Check if this is itself a continuation
  const parentResult = await pool.query(
    `SELECT parent_session_id, continuation_number FROM story_sessions WHERE id = $1`,
    [sessionId]
  );

  const parent = parentResult.rows[0];

  return {
    sessionId,
    parentSessionId: parent?.parent_session_id || null,
    continuationNumber: parent?.continuation_number || 0,
    continuations: continuations.rows.map(c => ({
      id: c.id,
      title: c.title,
      status: c.status,
      continuationNumber: c.continuation_number,
      sceneCount: parseInt(c.scene_count),
      createdAt: c.created_at
    }))
  };
}

/**
 * Get continuation context for an orchestrator
 */
async function getContinuationContext(sessionId) {
  const result = await pool.query(
    `SELECT cc.*, ss.title as original_title
     FROM continuation_context cc
     JOIN story_sessions ss ON ss.id = cc.original_session_id
     WHERE cc.continuation_session_id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const context = result.rows[0];

  return {
    originalSessionId: context.original_session_id,
    originalTitle: context.original_title,
    originalSummary: context.original_summary,
    continuationIdea: context.continuation_idea_json
      ? JSON.parse(context.continuation_idea_json)
      : null
  };
}

/**
 * Get full story series (all related stories)
 */
async function getStorySeries(sessionId) {
  // Find root story
  let rootId = sessionId;
  let current = await pool.query(
    `SELECT parent_session_id FROM story_sessions WHERE id = $1`,
    [sessionId]
  );

  while (current.rows[0]?.parent_session_id) {
    rootId = current.rows[0].parent_session_id;
    current = await pool.query(
      `SELECT parent_session_id FROM story_sessions WHERE id = $1`,
      [rootId]
    );
  }

  // Get all stories in series
  const series = await pool.query(
    `WITH RECURSIVE story_tree AS (
       SELECT id, title, status, continuation_number, parent_session_id, created_at, 0 as depth
       FROM story_sessions WHERE id = $1
       UNION ALL
       SELECT ss.id, ss.title, ss.status, ss.continuation_number, ss.parent_session_id, ss.created_at, st.depth + 1
       FROM story_sessions ss
       INNER JOIN story_tree st ON ss.parent_session_id = st.id
     )
     SELECT * FROM story_tree ORDER BY depth, continuation_number`,
    [rootId]
  );

  return {
    rootId,
    currentId: sessionId,
    stories: series.rows.map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      continuationNumber: s.continuation_number,
      parentId: s.parent_session_id,
      depth: s.depth,
      createdAt: s.created_at,
      isCurrent: s.id === sessionId
    }))
  };
}

export {
  generateContinuationIdeas,
  createContinuation,
  getStoryContinuations,
  getContinuationContext,
  getStorySeries
};
