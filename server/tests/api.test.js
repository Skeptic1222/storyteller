/**
 * Basic API Tests
 * Run with: npm test
 * Uses Node.js built-in test runner
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5100';
const TEST_AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || '';
const SERVER_AVAILABLE = await fetch(`${BASE_URL}/api/health`)
  .then(() => true)
  .catch(() => false);

/**
 * Helper to make API requests
 */
async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(TEST_AUTH_TOKEN ? { Authorization: `Bearer ${TEST_AUTH_TOKEN}` } : {}),
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

if (!SERVER_AVAILABLE) {
  test('API server not reachable', (t) => {
    t.skip(`Server unavailable at ${BASE_URL}. Start the server or set TEST_URL.`);
  });
}

// =============================================================================
// HEALTH CHECK TESTS
// =============================================================================

if (SERVER_AVAILABLE) {
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
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'Library should require authentication');
      return;
    }
    assert.strictEqual(status, 200, 'Library should return 200 for authenticated users');
    assert.ok(Array.isArray(data.stories), 'Should return stories array');
    assert.ok(typeof data.count === 'number', 'Should return count');
  });

  test('GET /api/library with filter returns filtered results', async () => {
    const { status, data } = await api('/api/library?filter=favorites');
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'Filtered library should require authentication');
      return;
    }
    assert.strictEqual(status, 200, 'Filtered library should return 200');
    assert.strictEqual(data.filter, 'favorites', 'Should echo filter param');
  });

  test('GET /api/library/:storyId with invalid ID returns 404', async () => {
    const { status } = await api('/api/library/00000000-0000-0000-0000-000000000000');
    if (!TEST_AUTH_TOKEN) {
      assert.ok(status === 401 || status === 404, 'Story detail should require auth or return not found');
      return;
    }
    assert.strictEqual(status, 404, 'Non-existent story should return 404');
  });
});

// =============================================================================
// VOICES API TESTS
// =============================================================================

describe('Voices API', () => {
  test('GET /api/voices returns voices list', async () => {
    const { status, data } = await api('/api/voices');
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'Voices should require authentication');
      return;
    }

    assert.strictEqual(status, 200, 'Voices should return 200');
    assert.ok(Array.isArray(data.voices) || data.voices, 'Should return voices');
  });

  test('GET /api/voices/archetypes returns voice archetypes', async () => {
    const { status, data } = await api('/api/voices/archetypes');
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'Voice archetypes should require authentication');
      return;
    }

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
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'SFX library should require authentication');
      return;
    }

    assert.strictEqual(status, 200, 'SFX library should return 200');
    assert.ok(data.library, 'Should return library object');
    assert.ok(Array.isArray(data.categories), 'Should return categories array');
  });

  test('GET /api/sfx/levels returns intensity levels', async () => {
    const { status, data } = await api('/api/sfx/levels');
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'SFX levels should require authentication');
      return;
    }

    assert.strictEqual(status, 200, 'SFX levels should return 200');
    assert.ok(Array.isArray(data.levels), 'Should return levels array');
  });

  test('GET /api/sfx/status returns service status', async () => {
    const { status, data } = await api('/api/sfx/status');
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'SFX status should require authentication');
      return;
    }

    assert.strictEqual(status, 200, 'SFX status should return 200');
    assert.ok(typeof data.enabled === 'boolean', 'Should return enabled status');
  });
});

// =============================================================================
// CONFIG API TESTS
// =============================================================================

describe('Config API', () => {
  test('GET /api/config/defaults returns canonical configure defaults', async () => {
    const { status, data } = await api('/api/config/defaults');

    assert.strictEqual(status, 200, 'Config defaults should return 200');
    const isConfigureShape =
      Object.prototype.hasOwnProperty.call(data, 'story_type') ||
      Object.prototype.hasOwnProperty.call(data, 'story_format');

    if (isConfigureShape) {
      assert.strictEqual(data.audience, 'general', 'Defaults should use canonical audience');
      assert.ok(
        ['picture_book', 'short_story', 'novella', 'novel', 'series'].includes(data.story_format),
        'Defaults should use supported story_format'
      );
    } else {
      // Backward-compatible assertion for environments still serving legacy defaults shape.
      assert.ok(data.preferences && typeof data.preferences === 'object', 'Legacy defaults should include preferences');
    }

    const expectedGenreKeys = isConfigureShape
      ? ['fantasy', 'adventure', 'mystery', 'scifi', 'romance', 'horror', 'humor', 'fairytale']
      : ['fantasy', 'adventure', 'mystery', 'scifi', 'romance', 'horror', 'humor'];
    const expectedIntensityKeys = isConfigureShape
      ? ['violence', 'gore', 'scary', 'romance', 'language', 'adultContent', 'sensuality', 'explicitness', 'bleakness', 'sexualViolence']
      : ['violence', 'gore', 'scary'];

    assert.ok(data.genres && typeof data.genres === 'object', 'Defaults should include genres object');
    expectedGenreKeys.forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(data.genres, key), `Genres should include ${key}`);
    });

    assert.ok(data.intensity && typeof data.intensity === 'object', 'Defaults should include intensity object');
    expectedIntensityKeys.forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(data.intensity, key), `Intensity should include ${key}`);
    });
  });

  test('GET /api/config/narrator-styles returns styles', async () => {
    const { status, data } = await api('/api/config/narrator-styles');

    assert.strictEqual(status, 200, 'Narrator styles should return 200');
    assert.ok(data.styles || data.narratorStyles, 'Should return styles');
  });

  test('GET /api/config/genres returns genre options', async () => {
    const { status, data } = await api('/api/config/genres');

    assert.strictEqual(status, 200, 'Genres should return 200');
  });

  test('POST /api/config/templates/apply normalizes legacy aliases in response config', async () => {
    const { status, data } = await api('/api/config/templates/apply', {
      method: 'POST',
      body: JSON.stringify({
        template_id: 'audio_drama',
        current_config: {
          audience: 'all_ages',
          story_format: 'novel_chapter'
        }
      })
    });

    assert.strictEqual(status, 200, 'Template apply should return 200');
    assert.strictEqual(data.success, true, 'Template apply should succeed');
    assert.ok(data.config && typeof data.config === 'object', 'Template apply should return config');
    assert.ok(
      ['novel', 'novel_chapter'].includes(data.config.story_format),
      `Story format should be canonicalized when supported, got ${data.config.story_format}`
    );
    assert.ok(
      ['children', 'general', 'mature'].includes(data.config.audience),
      `Audience should be canonical, got ${data.config.audience}`
    );
  });
});

// =============================================================================
// PAYPAL API TESTS
// =============================================================================

describe('PayPal API', () => {
  test('GET /api/paypal/status returns configuration status', async () => {
    const { status, data } = await api('/api/paypal/status');

    assert.strictEqual(status, 200, 'PayPal status should return 200');
    assert.ok(typeof data.mode === 'string', 'Should return mode');
    assert.ok(data.plans && typeof data.plans === 'object', 'Should return plan availability map');
  });

  test('GET /api/paypal/plans returns plan metadata', async () => {
    const { status, data } = await api('/api/paypal/plans');

    assert.strictEqual(status, 200, 'PayPal plans should return 200');
    assert.ok(Array.isArray(data.plans), 'Should return plans array');
    assert.ok(data.plans.length >= 1, 'Should include at least one plan');
  });

  test('POST /api/paypal/create-subscription enforces auth/config validation', async () => {
    const { status } = await api('/api/paypal/create-subscription', {
      method: 'POST',
      body: JSON.stringify({ planId: 'invalid-plan' })
    });

    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'Create subscription should require authentication');
      return;
    }

    // If PayPal is not configured: 503; if configured with invalid plan: 400
    assert.ok(
      status === 400 || status === 503,
      `Expected 400 or 503 for invalid/pre-configured plan request, got ${status}`
    );
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
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'SFX generate should require authentication');
      return;
    }

    assert.strictEqual(status, 400, 'Missing prompt should return 400');
  });

  test('POST /api/sfx/detect without text returns 400', async () => {
    const { status } = await api('/api/sfx/detect', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (!TEST_AUTH_TOKEN) {
      assert.strictEqual(status, 401, 'SFX detect should require authentication');
      return;
    }

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
}

console.log('Running API tests against:', BASE_URL);
