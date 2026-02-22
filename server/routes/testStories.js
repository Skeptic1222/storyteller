/**
 * Test Stories API Routes
 *
 * Endpoints for running pre-written test fixtures through the voice pipeline.
 * Only available in development mode or for admin users.
 *
 * Routes:
 *   GET  /fixtures           - List available test fixtures
 *   POST /run                - Run a test fixture
 *   GET  /results/:sessionId - Get test results
 *   DELETE /:sessionId       - Clean up test session
 */

import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { TEST_FIXTURES, validateAllFixtures } from '../services/testFixtures.js';
import { runTestFixture, cleanupTestSession, getTestResults } from '../services/testStoryRunner.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Guard: Only allow in development or for admin users
 */
function devGuard(req, res, next) {
  if (NODE_ENV !== 'production') {
    return next();
  }
  // In production, require admin
  if (req.user?.is_admin) {
    return next();
  }
  return res.status(403).json({ error: 'Test stories only available in development mode' });
}

router.use(authenticateToken, devGuard);

/**
 * GET /fixtures - List available test fixtures
 */
router.get('/fixtures', (req, res) => {
  const fixtures = Object.entries(TEST_FIXTURES).map(([key, fixture]) => ({
    key,
    name: fixture.name,
    description: fixture.description,
    characters: fixture.characters.length,
    dialogue_lines: fixture.scene.dialogue_map.length,
    text_length: fixture.scene.polished_text.length
  }));

  // Also validate all fixtures
  const validation = validateAllFixtures();

  res.json({ fixtures, validation });
});

/**
 * POST /run - Run a test fixture
 *
 * Body:
 *   fixture: string (fixture key)
 *   options: {
 *     skipTTS: boolean (default: true)
 *     skipVoiceDirection: boolean (default: false)
 *     skipSpeechTagFilter: boolean (default: false)
 *     useHardcodedVoices: boolean (default: false)
 *     narratorVoice: string (override narrator voice ID)
 *   }
 */
router.post('/run', async (req, res) => {
  try {
    const { fixture, options = {} } = req.body;

    if (!fixture) {
      return res.status(400).json({
        error: 'Missing fixture name',
        available: Object.keys(TEST_FIXTURES)
      });
    }

    if (!TEST_FIXTURES[fixture]) {
      return res.status(400).json({
        error: `Unknown fixture: ${fixture}`,
        available: Object.keys(TEST_FIXTURES)
      });
    }

    logger.info(`[TestStories] Running fixture: ${fixture} with options: ${JSON.stringify(options)}`);

    const result = await runTestFixture(fixture, {
      ...options,
      userId: req.user?.id || null
    });

    res.json({
      success: true,
      session_id: result.sessionId,
      fixture,
      results: result.results,
      timings: result.timings
    });
  } catch (error) {
    logger.error(`[TestStories] Run failed: ${error.message}`);
    res.status(500).json({
      error: error.message,
      stack: NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

/**
 * GET /results/:sessionId - Get test results
 */
router.get('/results/:sessionId', async (req, res) => {
  try {
    const results = await getTestResults(req.params.sessionId);
    res.json(results);
  } catch (error) {
    logger.error(`[TestStories] Get results failed: ${error.message}`);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      error: error.message
    });
  }
});

/**
 * DELETE /:sessionId - Clean up test session
 */
router.delete('/:sessionId', async (req, res) => {
  try {
    const result = await cleanupTestSession(req.params.sessionId);
    res.json(result);
  } catch (error) {
    logger.error(`[TestStories] Cleanup failed: ${error.message}`);
    const status = error.message.includes('not found') ? 404
      : error.message.includes('not a test session') ? 403
      : 500;
    res.json({ error: error.message });
  }
});

export default router;
