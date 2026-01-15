/**
 * Story Sharing Service
 * Handles creating shareable links and accessing shared stories
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

/**
 * Generate a unique share code
 */
function generateShareCode() {
  return crypto.randomBytes(6).toString('base64url');
}

/**
 * Create a shareable link for a story
 */
async function createShareLink(sessionId, options = {}) {
  const {
    userId = null,
    expiresInDays = null,
    allowComments = false,
    isPublic = true,
    password = null
  } = options;

  // Verify session exists and get details
  const sessionResult = await pool.query(
    `SELECT id, title, user_id, current_status FROM story_sessions WHERE id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    throw new Error('Story session not found');
  }

  const session = sessionResult.rows[0];

  // Check ownership if userId provided
  if (userId && session.user_id && session.user_id !== userId) {
    throw new Error('Not authorized to share this story');
  }

  // Generate unique share code
  let shareCode = generateShareCode();
  let attempts = 0;

  while (attempts < 5) {
    const existing = await pool.query(
      'SELECT id FROM story_shares WHERE share_code = $1',
      [shareCode]
    );
    if (existing.rows.length === 0) break;
    shareCode = generateShareCode();
    attempts++;
  }

  // Calculate expiry
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  // Hash password if provided
  const passwordHash = password
    ? crypto.createHash('sha256').update(password).digest('hex')
    : null;

  // Create share record
  const result = await pool.query(
    `INSERT INTO story_shares
     (story_session_id, share_code, created_by, expires_at, is_public, allow_comments, password_hash, view_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
     RETURNING id, share_code, expires_at, is_public, allow_comments, created_at`,
    [sessionId, shareCode, userId, expiresAt, isPublic, allowComments, passwordHash]
  );

  const share = result.rows[0];

  logger.info(`[StorySharing] Created share link: ${shareCode} for session ${sessionId}`);

  return {
    shareCode: share.share_code,
    shareUrl: `/storyteller/shared/${share.share_code}`,
    fullUrl: `https://ay-i-t.com/storyteller/shared/${share.share_code}`,
    expiresAt: share.expires_at,
    isPublic: share.is_public,
    allowComments: share.allow_comments,
    hasPassword: !!passwordHash,
    createdAt: share.created_at
  };
}

/**
 * Access a shared story
 */
async function accessSharedStory(shareCode, password = null) {
  // Get share details
  const shareResult = await pool.query(
    `SELECT ss.*, s.title, s.cover_image_url, s.current_status,
            s.config_json->>'genre' as genre
     FROM story_shares ss
     JOIN story_sessions s ON s.id = ss.story_session_id
     WHERE ss.share_code = $1`,
    [shareCode]
  );

  if (shareResult.rows.length === 0) {
    return { success: false, error: 'Share link not found' };
  }

  const share = shareResult.rows[0];

  // Check expiry
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return { success: false, error: 'Share link has expired' };
  }

  // Check password
  if (share.password_hash) {
    if (!password) {
      return { success: false, error: 'Password required', requiresPassword: true };
    }
    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    if (inputHash !== share.password_hash) {
      return { success: false, error: 'Invalid password', requiresPassword: true };
    }
  }

  // Increment view count
  await pool.query(
    'UPDATE story_shares SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = $1',
    [share.id]
  );

  // Get story content
  const scenesResult = await pool.query(
    `SELECT id,
            sequence_index as sequence,
            branch_key,
            polished_text,
            audio_url,
            illustration_url
     FROM story_scenes
     WHERE story_session_id = $1
     ORDER BY sequence_index`,
    [share.story_session_id]
  );

  const charactersResult = await pool.query(
    `SELECT id, name, role, portrait_url, traits_json
     FROM characters
     WHERE story_session_id = $1`,
    [share.story_session_id]
  );

  // Get outline
  const outlineResult = await pool.query(
    `SELECT outline_json FROM story_outlines WHERE story_session_id = $1`,
    [share.story_session_id]
  );

  const outline = outlineResult.rows[0]?.outline_json
    ? JSON.parse(outlineResult.rows[0].outline_json)
    : null;

  logger.info(`[StorySharing] Story accessed via share code: ${shareCode}`);

  return {
    success: true,
    story: {
      sessionId: share.story_session_id,
      title: share.title || outline?.title || 'Untitled Story',
      genre: share.genre || outline?.genre || null,
      coverImage: share.cover_image_url,
      synopsis: outline?.synopsis,
      setting: outline?.setting,
      theme: outline?.theme
    },
    scenes: scenesResult.rows.map(scene => ({
      id: scene.id,
      sequence: scene.sequence,
      branchKey: scene.branch_key,
      text: scene.polished_text,
      audioUrl: scene.audio_url,
      illustrationUrl: scene.illustration_url
    })),
    characters: charactersResult.rows.map(char => ({
      id: char.id,
      name: char.name,
      role: char.role,
      portraitUrl: char.portrait_url,
      traits: char.traits_json
    })),
    share: {
      allowComments: share.allow_comments,
      viewCount: share.view_count + 1,
      createdAt: share.created_at
    }
  };
}

/**
 * Get all shares for a session
 */
async function getSessionShares(sessionId, userId = null) {
  let query = `
    SELECT id, share_code, expires_at, is_public, allow_comments,
           view_count, last_viewed_at, created_at, password_hash IS NOT NULL as has_password
    FROM story_shares
    WHERE story_session_id = $1`;

  const params = [sessionId];

  if (userId) {
    query += ` AND created_by = $2`;
    params.push(userId);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await pool.query(query, params);

  return result.rows.map(share => ({
    id: share.id,
    shareCode: share.share_code,
    shareUrl: `/storyteller/shared/${share.share_code}`,
    fullUrl: `https://ay-i-t.com/storyteller/shared/${share.share_code}`,
    expiresAt: share.expires_at,
    isExpired: share.expires_at && new Date(share.expires_at) < new Date(),
    isPublic: share.is_public,
    allowComments: share.allow_comments,
    hasPassword: share.has_password,
    viewCount: share.view_count,
    lastViewedAt: share.last_viewed_at,
    createdAt: share.created_at
  }));
}

/**
 * Delete a share link
 */
async function deleteShareLink(shareId, userId = null) {
  let query = 'DELETE FROM story_shares WHERE id = $1';
  const params = [shareId];

  if (userId) {
    query += ' AND created_by = $2';
    params.push(userId);
  }

  query += ' RETURNING id';

  const result = await pool.query(query, params);

  if (result.rows.length === 0) {
    throw new Error('Share link not found or not authorized');
  }

  logger.info(`[StorySharing] Deleted share link: ${shareId}`);

  return { success: true };
}

/**
 * Update share settings
 */
async function updateShareSettings(shareId, userId, settings) {
  const {
    expiresInDays,
    allowComments,
    isPublic,
    password
  } = settings;

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (expiresInDays !== undefined) {
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    updates.push(`expires_at = $${paramIndex++}`);
    values.push(expiresAt);
  }

  if (allowComments !== undefined) {
    updates.push(`allow_comments = $${paramIndex++}`);
    values.push(allowComments);
  }

  if (isPublic !== undefined) {
    updates.push(`is_public = $${paramIndex++}`);
    values.push(isPublic);
  }

  if (password !== undefined) {
    const passwordHash = password
      ? crypto.createHash('sha256').update(password).digest('hex')
      : null;
    updates.push(`password_hash = $${paramIndex++}`);
    values.push(passwordHash);
  }

  if (updates.length === 0) {
    throw new Error('No settings to update');
  }

  values.push(shareId);
  values.push(userId);

  const query = `
    UPDATE story_shares
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex++} AND created_by = $${paramIndex}
    RETURNING id, share_code, expires_at, is_public, allow_comments`;

  const result = await pool.query(query, values);

  if (result.rows.length === 0) {
    throw new Error('Share link not found or not authorized');
  }

  return result.rows[0];
}

/**
 * Get public stories for discovery
 */
async function getPublicStories(options = {}) {
  const {
    limit = 20,
    offset = 0,
    genre = null,
    sortBy = 'recent'
  } = options;

  let query = `
    SELECT DISTINCT ON (ss.story_session_id)
      ss.story_session_id as session_id,
      s.title,
      s.config_json->>'genre' as genre,
      s.cover_image_url,
      ss.share_code,
      ss.view_count,
      ss.created_at,
      (SELECT COUNT(*) FROM story_scenes WHERE story_session_id = s.id) as scene_count
    FROM story_shares ss
    JOIN story_sessions s ON s.id = ss.story_session_id
    WHERE ss.is_public = true
      AND ss.password_hash IS NULL
      AND (ss.expires_at IS NULL OR ss.expires_at > NOW())
      AND s.current_status = 'finished'`;

  const params = [];
  let paramIndex = 1;

  if (genre) {
    query += ` AND s.config_json->>'genre' = $${paramIndex++}`;
    params.push(genre);
  }

  query += ` ORDER BY ss.story_session_id, `;

  switch (sortBy) {
    case 'popular':
      query += `ss.view_count DESC`;
      break;
    case 'recent':
    default:
      query += `ss.created_at DESC`;
  }

  query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    sessionId: row.session_id,
    title: row.title || 'Untitled Story',
    genre: row.genre,
    coverImage: row.cover_image_url,
    shareCode: row.share_code,
    shareUrl: `/storyteller/shared/${row.share_code}`,
    viewCount: row.view_count,
    sceneCount: row.scene_count,
    sharedAt: row.created_at
  }));
}

/**
 * Add a comment to a shared story
 */
async function addComment(shareCode, comment, authorName = 'Anonymous') {
  // Verify share allows comments
  const shareResult = await pool.query(
    'SELECT id, story_session_id, allow_comments FROM story_shares WHERE share_code = $1',
    [shareCode]
  );

  if (shareResult.rows.length === 0) {
    throw new Error('Share link not found');
  }

  const share = shareResult.rows[0];

  if (!share.allow_comments) {
    throw new Error('Comments not allowed on this shared story');
  }

  const result = await pool.query(
    `INSERT INTO story_comments (story_share_id, author_name, comment_text)
     VALUES ($1, $2, $3)
     RETURNING id, author_name, comment_text, created_at`,
    [share.id, authorName, comment]
  );

  logger.info(`[StorySharing] Comment added to share ${shareCode}`);

  return result.rows[0];
}

/**
 * Get comments for a shared story
 */
async function getComments(shareCode, limit = 50) {
  const result = await pool.query(
    `SELECT c.id, c.author_name, c.comment_text, c.created_at
     FROM story_comments c
     JOIN story_shares ss ON ss.id = c.story_share_id
     WHERE ss.share_code = $1
     ORDER BY c.created_at DESC
     LIMIT $2`,
    [shareCode, limit]
  );

  return result.rows;
}

export {
  createShareLink,
  accessSharedStory,
  getSessionShares,
  deleteShareLink,
  updateShareSettings,
  getPublicStories,
  addComment,
  getComments,
  generateShareCode
};
