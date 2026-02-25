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

  test('multiplayer routes require auth and prevent user_id spoofing', async () => {
    const multiplayerRoute = await readFile('server/routes/multiplayer.js', 'utf8');
    assert.equal(
      /router\.use\(authenticateToken,\s*requireAuth\)/.test(multiplayerRoute),
      true,
      'multiplayer routes should require authenticated users'
    );
    assert.equal(
      /join_code is required and must be 6 characters/.test(multiplayerRoute),
      true,
      'join route should require a join code'
    );
    assert.equal(
      /userId:\s*req\.user\.id/.test(multiplayerRoute),
      true,
      'join route should bind participant identity to req.user.id'
    );
  });

  test('story-bible chapter event linking is parameterized and ownership-scoped', async () => {
    const storyBibleRoute = await readFile('server/routes/story-bible.js', 'utf8');
    assert.equal(
      /VALUES\s+\$\{insertValues\}/.test(storyBibleRoute),
      false,
      'chapter-event linking should not build raw VALUES strings'
    );
    assert.equal(
      /getSynopsisAccess\(id,\s*req\.user\)/.test(storyBibleRoute),
      true,
      'chapter-event endpoints should enforce synopsis ownership/access'
    );
    assert.equal(
      /FROM unnest\(\$3::text\[\],\s*\$4::int\[\]\)/.test(storyBibleRoute),
      true,
      'chapter-event linking should use parameterized unnest inserts'
    );
    assert.equal(
      /router\.use\('\/synopsis\/:id'/.test(storyBibleRoute),
      true,
      'all /synopsis/:id routes should enforce synopsis ownership/access middleware'
    );
  });
});
