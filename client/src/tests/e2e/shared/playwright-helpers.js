/**
 * Playwright Helpers for Storyteller E2E Tests
 *
 * These helpers work with Playwright MCP tools:
 * - mcp__playwright__browser_navigate
 * - mcp__playwright__browser_snapshot
 * - mcp__playwright__browser_click
 * - mcp__playwright__browser_wait_for
 * - mcp__playwright__browser_take_screenshot
 * - mcp__playwright__browser_fill_form
 */

import { SELECTORS, TIMEOUTS } from './test-config.js';

/**
 * Navigate to the Storyteller app
 * @param {string} path - Optional path (default: /storyteller)
 */
export async function navigateToStoryteller(path = '/storyteller') {
  const url = `http://localhost${path}`;
  // Use: mcp__playwright__browser_navigate({ url })
  return { action: 'navigate', url };
}

/**
 * Navigate to configure page
 */
export async function goToConfigure() {
  return navigateToStoryteller('/storyteller/configure');
}

/**
 * Fill in story configuration form
 * @param {Object} config - Story configuration object
 */
export function buildFormFields(config) {
  const fields = [];

  if (config.premise) {
    fields.push({
      name: 'Story premise',
      type: 'textbox',
      ref: '[name="premise"], [data-testid="premise-input"]',
      value: config.premise
    });
  }

  if (config.setting) {
    fields.push({
      name: 'Setting',
      type: 'textbox',
      ref: '[name="setting"], [data-testid="setting-input"]',
      value: config.setting
    });
  }

  // Add character fields if present
  if (config.characters && config.characters.length > 0) {
    const char = config.characters[0];
    if (char.name) {
      fields.push({
        name: 'Character name',
        type: 'textbox',
        ref: '[name="characterName"], [data-testid="character-name-input"]',
        value: char.name
      });
    }
  }

  return fields;
}

/**
 * Extract story text from a page snapshot
 * @param {string} snapshot - Page snapshot content
 */
export function extractStoryText(snapshot) {
  // Look for story content patterns in the snapshot
  const storyPatterns = [
    /Chapter \d+[:\s]*([\s\S]*?)(?=Chapter \d+|$)/gi,
    /story-content[^>]*>([\s\S]*?)<\/div/gi,
    /BookPage[^>]*>([\s\S]*?)<\/div/gi
  ];

  let text = '';
  for (const pattern of storyPatterns) {
    const matches = snapshot.match(pattern);
    if (matches) {
      text += matches.join('\n');
    }
  }

  return text.trim();
}

/**
 * Check if an element reference exists in a snapshot
 * @param {string} snapshot - Page snapshot
 * @param {string} pattern - Pattern to search for
 */
export function snapshotContains(snapshot, pattern) {
  if (typeof pattern === 'string') {
    return snapshot.toLowerCase().includes(pattern.toLowerCase());
  }
  if (pattern instanceof RegExp) {
    return pattern.test(snapshot);
  }
  return false;
}

/**
 * Extract voice assignments from snapshot
 * @param {string} snapshot - Page snapshot
 */
export function extractVoiceAssignments(snapshot) {
  const assignments = [];

  // Look for voice assignment patterns
  const voicePatterns = [
    /(\w+)\s*(?:voiced by|voice:|assigned)\s*(\w+)/gi,
    /CharacterCast[^>]*>[\s\S]*?(\w+)[\s\S]*?(\w+)/gi
  ];

  for (const pattern of voicePatterns) {
    let match;
    while ((match = pattern.exec(snapshot)) !== null) {
      assignments.push({
        character: match[1],
        voice: match[2]
      });
    }
  }

  return assignments;
}

/**
 * Extract SFX list from snapshot
 * @param {string} snapshot - Page snapshot
 */
export function extractSfxList(snapshot) {
  const sfx = [];

  // Look for SFX patterns
  const sfxPatterns = [
    /sfx[:\s]*([^,\n<]+)/gi,
    /sound effect[:\s]*([^,\n<]+)/gi,
    /(\w+(?:_\w+)*\.(?:mp3|wav|ogg))/gi
  ];

  for (const pattern of sfxPatterns) {
    let match;
    while ((match = pattern.exec(snapshot)) !== null) {
      sfx.push(match[1].trim());
    }
  }

  return [...new Set(sfx)]; // Dedupe
}

/**
 * Wait for story generation to complete
 * Returns true if successful, false if timeout
 */
export function getWaitCondition(type) {
  switch (type) {
    case 'generation':
      return { text: 'Begin Chapter', timeout: TIMEOUTS.generation };
    case 'audio':
      return { text: 'Playing', timeout: TIMEOUTS.audio };
    case 'chapter':
      return { text: 'Chapter', timeout: TIMEOUTS.pageLoad };
    default:
      return { text: type, timeout: TIMEOUTS.elementVisible };
  }
}

/**
 * Get screenshot filename with timestamp
 * @param {string} testName - Name of the test
 */
export function getScreenshotFilename(testName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `test-${testName}-${timestamp}.png`;
}

/**
 * Assert helper - throws if condition is false
 * @param {boolean} condition - Condition to check
 * @param {string} message - Error message if assertion fails
 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Test result logger
 * @param {string} testName - Name of the test
 * @param {boolean} passed - Whether test passed
 * @param {string} details - Additional details
 */
export function logTestResult(testName, passed, details = '') {
  const status = passed ? 'PASS' : 'FAIL';
  const message = `[${status}] ${testName}${details ? ': ' + details : ''}`;
  console.log(message);
  return { testName, passed, details, timestamp: new Date().toISOString() };
}

export default {
  navigateToStoryteller,
  goToConfigure,
  buildFormFields,
  extractStoryText,
  snapshotContains,
  extractVoiceAssignments,
  extractSfxList,
  getWaitCondition,
  getScreenshotFilename,
  assert,
  logTestResult
};
