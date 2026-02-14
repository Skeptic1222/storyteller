/**
 * Storyteller E2E Test Suite Index
 *
 * This file exports all test configurations for use with Playwright MCP.
 *
 * Usage with Playwright MCP:
 *
 * 1. Import the test suite:
 *    import tests from './index.js';
 *
 * 2. Run tests using Playwright MCP tools:
 *    - mcp__playwright__browser_navigate({ url: test.steps[0].url })
 *    - mcp__playwright__browser_snapshot()
 *    - mcp__playwright__browser_click({ ref: test.steps[n].ref })
 *    - mcp__playwright__browser_wait_for({ text: test.steps[n].text })
 *
 * 3. Run assertions on collected snapshots
 *
 * IMPORTANT: These tests use SHORT stories to minimize ElevenLabs token usage!
 */

// Import all test suites
import progressBarTests from './progress-bar.test.js';
import voiceAssignmentTests from './voice-assignment.test.js';
import sfxDetectionTests from './sfx-detection.test.js';
import coverArtTests from './cover-art.test.js';

// Import shared utilities
export * from './shared/test-config.js';
export * from './shared/playwright-helpers.js';

// Export all tests grouped by category
export const tests = {
  progressBar: progressBarTests,
  voiceAssignment: voiceAssignmentTests,
  sfxDetection: sfxDetectionTests,
  coverArt: coverArtTests
};

// Export flat array of all tests
export const allTests = [
  ...progressBarTests,
  ...voiceAssignmentTests,
  ...sfxDetectionTests,
  ...coverArtTests
];

// Test summary
export const testSummary = {
  totalTests: allTests.length,
  categories: {
    progressBar: progressBarTests.length,
    voiceAssignment: voiceAssignmentTests.length,
    sfxDetection: sfxDetectionTests.length,
    coverArt: coverArtTests.length
  },
  description: 'Storyteller E2E Tests - Uses short stories to minimize token usage'
};

/**
 * Quick test runner helper
 *
 * Example usage in Claude Code conversation:
 *
 * To run a single test:
 * ```
 * const { testUnifiedProgressBar } = await import('./progress-bar.test.js');
 *
 * // Execute steps
 * for (const step of testUnifiedProgressBar.steps) {
 *   if (step.action === 'navigate') {
 *     mcp__playwright__browser_navigate({ url: step.url });
 *   } else if (step.action === 'click') {
 *     mcp__playwright__browser_click({ ref: step.ref });
 *   }
 *   // ... etc
 * }
 *
 * // Collect snapshots and run assertions
 * for (const assertion of testUnifiedProgressBar.assertions) {
 *   const passed = assertion.check(snapshots);
 *   console.log(`${assertion.name}: ${passed ? 'PASS' : 'FAIL'}`);
 * }
 * ```
 */
export function getTestByName(name) {
  return allTests.find(t => t.name === name);
}

export function listTests() {
  return allTests.map(t => ({
    name: t.name,
    category: Object.keys(tests).find(cat => tests[cat].includes(t)) || 'unknown',
    stepsCount: t.steps?.length || 0,
    assertionsCount: t.assertions?.length || 0
  }));
}

// Default export
export default {
  tests,
  allTests,
  testSummary,
  getTestByName,
  listTests
};

// Log test summary when imported
console.log(`[E2E Tests] Loaded ${testSummary.totalTests} tests across ${Object.keys(tests).length} categories`);
