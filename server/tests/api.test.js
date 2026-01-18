/**
 * Basic API Tests
 * Run with: npm test
 * Uses Node.js built-in test runner
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5100';

/**
 * Helper to make API requests
 */
async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data, ok: response.ok };
}

// =============================================================================
// HEALTH CHECK TESTS
// =============================================================================

describe('Health API', () => {
  test('GET /api/health returns 200', async () => {
    const { status, data, ok } = await api('/api/health');

    assert.strictEqual(ok, true, 'Health check should return OK');
    assert.strictEqual(status, 200, 'Status should be 200');
    assert.ok(data.status, 'Response should have status field');
  });

  test('GET /api/health/detailed returns service info', async () => {
    const { status, data } = await api('/api/health/detailed');

    assert.strictEqual(status, 200, 'Detailed health check should return 200');
    assert.ok(data.database !== undefined, 'Should include database status');
    assert.ok(data.uptime !== undefined, 'Should include uptime');
  });
});

// =============================================================================
// LIBRARY API TESTS
// =============================================================================

describe('Library API', () => {
  test('GET /api/library returns stories list', async () => {
    const { status, data } = await api('/api/library');

    assert.strictEqual(status, 200, 'Library should return 200');
    assert.ok(Array.isArray(data.stories), 'Should return stories array');
    assert.ok(typeof data.count === 'number', 'Should return count');
  });

  test('GET /api/library with filter returns filtered results', async () => {
    const { status, data } = await api('/api/library?filter=favorites');

    assert.strictEqual(status, 200, 'Filtered library should return 200');
    assert.strictEqual(data.filter, 'favorites', 'Should echo filter param');
  });

  test('GET /api/library/:storyId with invalid ID returns 404', async () => {
    const { status } = await api('/api/library/00000000-0000-0000-0000-000000000000');

    assert.strictEqual(status, 404, 'Non-existent story should return 404');
  });
});

// =============================================================================
// VOICES API TESTS
// =============================================================================

describe('Voices API', () => {
  test('GET /api/voices returns voices list', async () => {
    const { status, data } = await api('/api/voices');

    assert.strictEqual(status, 200, 'Voices should return 200');
    assert.ok(Array.isArray(data.voices) || data.voices, 'Should return voices');
  });

  test('GET /api/voices/archetypes returns voice archetypes', async () => {
    const { status, data } = await api('/api/voices/archetypes');

    // May return 200 or 404 depending on DB state
    assert.ok(status === 200 || status === 404, 'Archetypes should return 200 or 404');
  });
});

// =============================================================================
// SFX API TESTS
// =============================================================================

describe('SFX API', () => {
  test('GET /api/sfx/library returns sound effects library', async () => {
    const { status, data } = await api('/api/sfx/library');

    assert.strictEqual(status, 200, 'SFX library should return 200');
    assert.ok(data.library, 'Should return library object');
    assert.ok(Array.isArray(data.categories), 'Should return categories array');
  });

  test('GET /api/sfx/levels returns intensity levels', async () => {
    const { status, data } = await api('/api/sfx/levels');

    assert.strictEqual(status, 200, 'SFX levels should return 200');
    assert.ok(Array.isArray(data.levels), 'Should return levels array');
  });

  test('GET /api/sfx/status returns service status', async () => {
    const { status, data } = await api('/api/sfx/status');

    assert.strictEqual(status, 200, 'SFX status should return 200');
    assert.ok(typeof data.enabled === 'boolean', 'Should return enabled status');
  });
});

// =============================================================================
// CONFIG API TESTS
// =============================================================================

describe('Config API', () => {
  test('GET /api/config/narrator-styles returns styles', async () => {
    const { status, data } = await api('/api/config/narrator-styles');

    assert.strictEqual(status, 200, 'Narrator styles should return 200');
    assert.ok(data.styles || data.narratorStyles, 'Should return styles');
  });

  test('GET /api/config/genres returns genre options', async () => {
    const { status, data } = await api('/api/config/genres');

    assert.strictEqual(status, 200, 'Genres should return 200');
  });
});

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe('Input Validation', () => {
  test('POST /api/sfx/generate without prompt returns 400', async () => {
    const { status } = await api('/api/sfx/generate', {
      method: 'POST',
      body: JSON.stringify({})
    });

    assert.strictEqual(status, 400, 'Missing prompt should return 400');
  });

  test('POST /api/sfx/detect without text returns 400', async () => {
    const { status } = await api('/api/sfx/detect', {
      method: 'POST',
      body: JSON.stringify({})
    });

    assert.strictEqual(status, 400, 'Missing text should return 400');
  });
});

// =============================================================================
// RATE LIMITING TESTS (basic verification)
// =============================================================================

describe('Rate Limiting', () => {
  test('Multiple rapid requests dont crash server', async () => {
    // Make 5 quick requests to verify rate limiting doesn't break things
    const requests = Array(5).fill(null).map(() => api('/api/health'));
    const results = await Promise.all(requests);

    // All should complete (200 or 429)
    for (const result of results) {
      assert.ok(
        result.status === 200 || result.status === 429,
        `Request should return 200 or 429, got ${result.status}`
      );
    }
  });
});

console.log('Running API tests against:', BASE_URL);
