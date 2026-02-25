import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySessionOwnership,
  verifySceneOwnership
} from '../utils/ownership.js';

function createDb(rows) {
  return {
    async query() {
      return { rows };
    }
  };
}

describe('ownership helpers', () => {
  test('verifySessionOwnership returns 404 when session is missing', async () => {
    const result = await verifySessionOwnership('missing-session', { id: 'user-1', is_admin: false }, {
      db: createDb([])
    });
    assert.deepStrictEqual(result, {
      status: 404,
      error: 'Session not found'
    });
  });

  test('verifySessionOwnership returns 403 for non-owner', async () => {
    const result = await verifySessionOwnership('session-1', { id: 'user-2', is_admin: false }, {
      db: createDb([{ user_id: 'user-1' }])
    });
    assert.deepStrictEqual(result, {
      status: 403,
      error: 'Not authorized to access this session'
    });
  });

  test('verifySessionOwnership allows owner and admin', async () => {
    const ownerResult = await verifySessionOwnership('session-1', { id: 'user-1', is_admin: false }, {
      db: createDb([{ user_id: 'user-1' }])
    });
    assert.equal(ownerResult, null);

    const adminResult = await verifySessionOwnership('session-1', { id: 'other-user', is_admin: true }, {
      db: createDb([{ user_id: 'user-1' }])
    });
    assert.equal(adminResult, null);
  });

  test('verifySceneOwnership returns expected access states', async () => {
    const missing = await verifySceneOwnership('missing-scene', { id: 'user-1', is_admin: false }, {
      db: createDb([])
    });
    assert.deepStrictEqual(missing, {
      status: 404,
      error: 'Scene not found'
    });

    const forbidden = await verifySceneOwnership('scene-1', { id: 'user-2', is_admin: false }, {
      db: createDb([{ user_id: 'user-1' }])
    });
    assert.deepStrictEqual(forbidden, {
      status: 403,
      error: 'Not authorized to access this scene'
    });

    const allowed = await verifySceneOwnership('scene-1', { id: 'user-1', is_admin: false }, {
      db: createDb([{ user_id: 'user-1' }])
    });
    assert.equal(allowed, null);
  });
});
