/**
 * Cover Art E2E Tests
 *
 * Tests for cover art generation during story creation
 *
 * Verifies:
 * - Cover art generation stage completes
 * - Cover image displays in UI
 * - Cover art URL is available
 */

import {
  SHORT_STORY_CONFIG,
  TIMEOUTS
} from './shared/test-config.js';
import {
  assert,
  snapshotContains,
  logTestResult,
  getScreenshotFilename
} from './shared/playwright-helpers.js';

/**
 * Test: Cover Art Generation
 */
export const testCoverArtGeneration = {
  name: 'Cover Art Generation',
  config: SHORT_STORY_CONFIG,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'wait_for',
      text: 'Create Your Story',
      timeout: TIMEOUTS.pageLoad
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: SHORT_STORY_CONFIG.premise
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    // Wait for cover art stage
    {
      action: 'wait_for',
      text: 'Cover Art',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture cover art stage'
    },
    // Wait for completion
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture final state with cover'
    },
    {
      action: 'screenshot',
      filename: 'cover-art-test.png'
    }
  ],

  assertions: [
    {
      name: 'Cover Art stage reached',
      check: (snapshots) => {
        const coverSnapshot = snapshots.find(s => s.description === 'Capture cover art stage');
        return snapshotContains(coverSnapshot?.content, 'Cover') ||
               snapshotContains(coverSnapshot?.content, 'Image');
      }
    },
    {
      name: 'Cover image present in final state',
      check: (snapshots) => {
        const finalSnapshot = snapshots.find(s => s.description === 'Capture final state with cover');
        const content = finalSnapshot?.content || '';

        // Look for cover-related elements
        return snapshotContains(content, 'cover') ||
               snapshotContains(content, 'CoverImage') ||
               snapshotContains(content, 'cover-thumbnail') ||
               snapshotContains(content, 'coverUrl') ||
               // Also check for img elements with cover in src
               /img[^>]*cover|cover[^>]*img/i.test(content);
      }
    },
    {
      name: 'Cover URL available',
      check: (snapshots) => {
        const finalSnapshot = snapshots.find(s => s.description === 'Capture final state with cover');
        const content = finalSnapshot?.content || '';

        // Check for URL patterns for cover images
        return /cover.*\.(?:png|jpg|jpeg|webp)/i.test(content) ||
               /coverUrl[:\s]*["']?[^"'\s]+/i.test(content) ||
               /fal\.media|dalle|openai.*image/i.test(content);
      }
    }
  ]
};

/**
 * Test: Cover Displays in Book Layout
 */
export const testCoverInBookLayout = {
  name: 'Cover Displays in Book Layout',
  config: SHORT_STORY_CONFIG,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: SHORT_STORY_CONFIG.premise
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'click',
      ref: '[data-testid="begin-chapter"], button:has-text("Begin Chapter")'
    },
    // Wait for book layout to render
    {
      action: 'wait_for',
      text: 'Chapter',
      timeout: TIMEOUTS.pageLoad
    },
    {
      action: 'snapshot',
      description: 'Capture book layout with cover'
    },
    {
      action: 'screenshot',
      filename: 'cover-in-book-layout.png'
    }
  ],

  assertions: [
    {
      name: 'Book layout visible',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture book layout with cover');
        return snapshotContains(snapshot?.content, 'BookPage') ||
               snapshotContains(snapshot?.content, 'Chapter');
      }
    },
    {
      name: 'Cover thumbnail visible in layout',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture book layout with cover');
        return snapshotContains(snapshot?.content, 'cover') ||
               snapshotContains(snapshot?.content, 'thumbnail');
      }
    }
  ]
};

/**
 * Test: Cover Regeneration Button
 */
export const testCoverRegeneration = {
  name: 'Cover Regeneration Available',
  config: SHORT_STORY_CONFIG,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: SHORT_STORY_CONFIG.premise
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture UI with regeneration options'
    }
  ],

  assertions: [
    {
      name: 'Regenerate cover option available',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture UI with regeneration options');
        // Look for regenerate/retry buttons
        return snapshotContains(snapshot?.content, 'Regenerate') ||
               snapshotContains(snapshot?.content, 'Retry') ||
               snapshotContains(snapshot?.content, 'refresh');
      }
    }
  ]
};

// Export all tests
export default [testCoverArtGeneration, testCoverInBookLayout, testCoverRegeneration];
