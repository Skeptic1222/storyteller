/**
 * Progress Bar E2E Tests
 *
 * Tests for Issue B/C: Unified progress bar, no double-click bug
 *
 * To run with Playwright MCP:
 * 1. Navigate to http://localhost/storyteller/configure
 * 2. Fill in SHORT_STORY_CONFIG
 * 3. Click Generate
 * 4. Verify circular progress appears
 * 5. Wait for "Begin Chapter" button
 * 6. Click once - verify audio plays without second progress bar
 */

import {
  SHORT_STORY_CONFIG,
  SELECTORS,
  TIMEOUTS
} from './shared/test-config.js';
import {
  assert,
  snapshotContains,
  logTestResult,
  getScreenshotFilename
} from './shared/playwright-helpers.js';

/**
 * Test: Unified Progress Bar - No Double Click
 *
 * Steps:
 * 1. Navigate to configure page
 * 2. Fill minimal story config
 * 3. Click generate
 * 4. Wait for progress indicator
 * 5. Wait for "Begin Chapter" button
 * 6. Click Begin Chapter ONCE
 * 7. Assert: NO second progress bar appears
 * 8. Assert: Audio starts playing OR text displays
 */
export const testUnifiedProgressBar = {
  name: 'Unified Progress Bar - No Double Click',
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
      action: 'snapshot',
      description: 'Capture configure page'
    },
    // Fill story config (simplified - in practice use browser_fill_form)
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
      text: 'Creating Your Story',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture progress state'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture ready state'
    },
    {
      action: 'click',
      ref: '[data-testid="begin-chapter"], button:has-text("Begin Chapter")'
    },
    // Wait a moment for any second progress bar to appear
    {
      action: 'wait_for',
      time: 2  // Wait 2 seconds
    },
    {
      action: 'snapshot',
      description: 'Capture post-click state'
    },
    {
      action: 'screenshot',
      filename: 'progress-bar-after-click.png'
    }
  ],

  assertions: [
    {
      name: 'Progress indicator visible during generation',
      check: (snapshots) => {
        const progressSnapshot = snapshots.find(s => s.description === 'Capture progress state');
        return snapshotContains(progressSnapshot?.content, 'Creating Your Story') ||
               snapshotContains(progressSnapshot?.content, 'CircularProgress');
      }
    },
    {
      name: 'Begin Chapter button appears',
      check: (snapshots) => {
        const readySnapshot = snapshots.find(s => s.description === 'Capture ready state');
        return snapshotContains(readySnapshot?.content, 'Begin Chapter');
      }
    },
    {
      name: 'No second progress bar after clicking Begin Chapter',
      check: (snapshots) => {
        const postClickSnapshot = snapshots.find(s => s.description === 'Capture post-click state');
        // Should NOT contain "Generating audio" or second progress indicator
        const hasSecondProgressBar =
          snapshotContains(postClickSnapshot?.content, 'Generating audio') ||
          snapshotContains(postClickSnapshot?.content, 'Preparing Narration') && !snapshotContains(postClickSnapshot?.content, 'preloaded');
        return !hasSecondProgressBar;
      }
    },
    {
      name: 'Audio or text content appears',
      check: (snapshots) => {
        const postClickSnapshot = snapshots.find(s => s.description === 'Capture post-click state');
        return snapshotContains(postClickSnapshot?.content, 'Chapter 1') ||
               snapshotContains(postClickSnapshot?.content, 'Playing') ||
               snapshotContains(postClickSnapshot?.content, 'story-content');
      }
    }
  ]
};

/**
 * Test: Circular Progress Display
 *
 * Verifies the new circular progress indicator is visible when enabled
 */
export const testCircularProgressDisplay = {
  name: 'Circular Progress Display',
  config: { ...SHORT_STORY_CONFIG, useCircularProgress: true },

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    {
      action: 'wait_for',
      time: 3  // Wait for progress to show
    },
    {
      action: 'snapshot',
      description: 'Capture circular progress'
    },
    {
      action: 'screenshot',
      filename: 'circular-progress.png'
    }
  ],

  assertions: [
    {
      name: 'Circular progress ring visible',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture circular progress');
        return snapshotContains(snapshot?.content, 'CircularProgress') ||
               snapshotContains(snapshot?.content, 'circular') ||
               snapshotContains(snapshot?.content, 'ring');
      }
    }
  ]
};

// Export all tests
export default [testUnifiedProgressBar, testCircularProgressDisplay];
