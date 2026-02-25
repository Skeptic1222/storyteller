import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

describe('route guard regressions', () => {
  test('voices routes enforce ownership checks for usage/check and hud', async () => {
    const voicesRoute = await readFile('server/routes/voices.js', 'utf8');
    assert.equal(
      /router\.post\('\/usage\/check'[\s\S]*verifySessionOwnership\(sessionId,\s*req\.user[\s,\)]/.test(voicesRoute),
      true,
      'usage/check should verify session ownership'
    );
    assert.equal(
      /router\.get\('\/hud\/:sessionId'[\s\S]*verifySessionOwnership\(sessionId,\s*req\.user[\s,\)]/.test(voicesRoute),
      true,
      'hud endpoint should verify session ownership'
    );
  });

  test('portraits scene route verifies ownership before DB update', async () => {
    const portraitsRoute = await readFile('server/routes/portraits.js', 'utf8');
    assert.equal(
      /router\.post\('\/scene'[\s\S]*verifySceneOwnership\(sceneId,\s*req\.user\)/.test(portraitsRoute),
      true,
      'scene portrait generation should verify scene ownership'
    );
  });

  test('story generation routes apply endpoint-level rate limiters', async () => {
    const storiesRoute = await readFile('server/routes/stories.js', 'utf8');
    assert.equal(
      /router\.post\('\/:id\/generate-outline'[\s\S]*rateLimiters\.storyGeneration/.test(storiesRoute),
      true,
      'generate-outline should use storyGeneration limiter'
    );
    assert.equal(
      /router\.post\('\/:id\/continue'[\s\S]*rateLimiters\.storyGeneration/.test(storiesRoute),
      true,
      'continue should use storyGeneration limiter'
    );
    assert.equal(
      /router\.post\('\/:id\/generate-audio\/:sceneId'[\s\S]*rateLimiters\.tts/.test(storiesRoute),
      true,
      'generate-audio should use tts limiter'
    );
  });
});
