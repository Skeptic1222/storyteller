import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

export function requireSocketAuth(socket) {
  const user = socket.data?.user || null;
  if (!user) {
    socket.emit('error', { message: 'Authentication required' });
    return null;
  }
  return user;
}

export async function requireSessionOwner(socket, sessionId) {
  const user = requireSocketAuth(socket);
  if (!user) return null;

  if (!sessionId) {
    socket.emit('error', { message: 'session_id is required' });
    return null;
  }

  try {
    const result = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      socket.emit('error', { message: 'Session not found' });
      return null;
    }

    const ownerId = result.rows[0].user_id;
    if (ownerId !== user.id && !user.is_admin) {
      socket.emit('error', { message: 'Not authorized for this session' });
      return null;
    }

    return user;
  } catch (error) {
    logger.error('[SocketAuth] Session check failed:', error);
    socket.emit('error', { message: 'Failed to authorize session' });
    return null;
  }
}
