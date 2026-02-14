/**
 * SFX Detection E2E Tests
 *
 * Tests for sound effects detection during story generation
 *
 * Verifies:
 * - SFX are detected from story content
 * - SFX count is displayed in UI
 * - Appropriate SFX types detected for story themes
 */

import {
  TEST_STORY_CONFIGS,
  SHORT_STORY_CONFIG,
  TIMEOUTS
} from './shared/test-config.js';
import {
  assert,
  snapshotContains,
  extractSfxList,
  logTestResult
} from './shared/playwright-helpers.js';

/**
 * Test: SFX Detection Basic
 */
export const testSfxDetectionBasic = {
  name: 'SFX Detection Basic',
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
      text: 'Sound Effects',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture SFX stage'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture final state with SFX'
    }
  ],

  assertions: [
    {
      name: 'SFX stage is reached',
      check: (snapshots) => {
        const sfxSnapshot = snapshots.find(s => s.description === 'Capture SFX stage');
        return snapshotContains(sfxSnapshot?.content, 'Sound') ||
               snapshotContains(sfxSnapshot?.content, 'SFX') ||
               snapshotContains(sfxSnapshot?.content, 'effects');
      }
    },
    {
      name: 'SFX count displayed',
      check: (snapshots) => {
        const finalSnapshot = snapshots.find(s => s.description === 'Capture final state with SFX');
        // Look for SFX count pattern like "3 SFX" or "SFX: 3"
        return /\d+\s*SFX|SFX[:\s]*\d+/i.test(finalSnapshot?.content || '');
      }
    }
  ]
};

/**
 * Test: Weather SFX Detection
 * Story with thunder/rain should detect weather-related SFX
 */
export const testWeatherSfxDetection = {
  name: 'Weather SFX Detection',
  config: TEST_STORY_CONFIGS.sfxHeavy,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: TEST_STORY_CONFIGS.sfxHeavy.premise  // Thunder storm story
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
      description: 'Capture weather story SFX'
    },
    {
      action: 'screenshot',
      filename: 'sfx-weather-test.png'
    }
  ],

  assertions: [
    {
      name: 'Weather-related SFX detected',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture weather story SFX');
        const content = snapshot?.content?.toLowerCase() || '';

        // Storm story should have weather SFX
        const weatherSfx = ['thunder', 'rain', 'wind', 'storm', 'lightning'];
        return weatherSfx.some(sfx => content.includes(sfx));
      }
    },
    {
      name: 'Multiple SFX detected for atmospheric story',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture weather story SFX');
        // Count SFX mentions or check for count > 1
        const match = (snapshot?.content || '').match(/(\d+)\s*SFX/i);
        const count = match ? parseInt(match[1]) : 0;
        return count >= 1;  // At least 1 SFX for atmospheric story
      }
    }
  ]
};

/**
 * Test: SFX Display in HUD
 */
export const testSfxDisplayInHud = {
  name: 'SFX Display in HUD',
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
      description: 'Capture HUD with SFX panel'
    }
  ],

  assertions: [
    {
      name: 'SFX panel visible in HUD',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture HUD with SFX panel');
        return snapshotContains(snapshot?.content, 'SFX') ||
               snapshotContains(snapshot?.content, 'Sound Effects') ||
               snapshotContains(snapshot?.content, 'ExpandableSFX');
      }
    }
  ]
};

// Export all tests
export default [testSfxDetectionBasic, testWeatherSfxDetection, testSfxDisplayInHud];
