function isOwnerOrAdmin(ownerId, user) {
  if (!user) return false;
  return ownerId === user.id || Boolean(user.is_admin);
}

function resolveDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('Database client with query() is required for ownership checks');
  }
  return db;
}

export async function verifySessionOwnership(
  sessionId,
  user,
  {
    db,
    notFoundError = 'Session not found',
    forbiddenError = 'Not authorized to access this session'
  } = {}
) {
  const client = resolveDb(db);
  const result = await client.query(
    'SELECT user_id FROM story_sessions WHERE id = $1',
    [sessionId]
  );

  if (result.rows.length === 0) {
    return { status: 404, error: notFoundError };
  }

  const ownerId = result.rows[0].user_id;
  if (!isOwnerOrAdmin(ownerId, user)) {
    return { status: 403, error: forbiddenError };
  }

  return null;
}

export async function verifySceneOwnership(
  sceneId,
  user,
  {
    db,
    notFoundError = 'Scene not found',
    forbiddenError = 'Not authorized to access this scene'
  } = {}
) {
  const client = resolveDb(db);
  const result = await client.query(
    `SELECT ss.user_id
     FROM story_scenes sc
     JOIN story_sessions ss ON ss.id = sc.story_session_id
     WHERE sc.id = $1`,
    [sceneId]
  );

  if (result.rows.length === 0) {
    return { status: 404, error: notFoundError };
  }

  const ownerId = result.rows[0].user_id;
  if (!isOwnerOrAdmin(ownerId, user)) {
    return { status: 403, error: forbiddenError };
  }

  return null;
}
