/**
 * Voice Assignment E2E Tests
 *
 * Tests for Issue A: Age-appropriate voice assignments
 *
 * Verifies:
 * - Child characters get child-suitable voices (Matilda, Gigi, Ethan, Harry, Laura)
 * - Adult male voices (Callum, Josh, Adam) are NOT assigned to children
 * - Elderly characters get mature voices
 */

import {
  TEST_STORY_CONFIGS,
  CHILD_SUITABLE_VOICES,
  ADULT_ONLY_VOICES,
  TIMEOUTS
} from './shared/test-config.js';
import {
  assert,
  snapshotContains,
  extractVoiceAssignments,
  logTestResult
} from './shared/playwright-helpers.js';

/**
 * Test: Child Character Gets Child-Suitable Voice
 */
export const testChildCharacterVoice = {
  name: 'Child Character Gets Child-Suitable Voice',
  config: TEST_STORY_CONFIGS.childCharacter,

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
    // Configure story with child character (Emma, age 8)
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: TEST_STORY_CONFIGS.childCharacter.premise
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    {
      action: 'wait_for',
      text: 'Voices',  // Wait for voice assignment stage
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture voice assignment'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture final state'
    }
  ],

  assertions: [
    {
      name: 'Child character assigned child-suitable voice',
      check: (snapshots) => {
        const voiceSnapshot = snapshots.find(s => s.description === 'Capture voice assignment');
        const finalSnapshot = snapshots.find(s => s.description === 'Capture final state');
        const content = (voiceSnapshot?.content || '') + (finalSnapshot?.content || '');

        // Check for presence of child-suitable voices
        const hasChildVoice = CHILD_SUITABLE_VOICES.some(voice =>
          snapshotContains(content, voice)
        );

        return hasChildVoice;
      }
    },
    {
      name: 'Adult male voice NOT assigned to child',
      check: (snapshots) => {
        const voiceSnapshot = snapshots.find(s => s.description === 'Capture voice assignment');
        const finalSnapshot = snapshots.find(s => s.description === 'Capture final state');
        const content = (voiceSnapshot?.content || '') + (finalSnapshot?.content || '');

        // Check that adult-only voices are NOT associated with child character
        // This is a simplified check - in production you'd parse the voice assignments
        const hasAdultVoice = ADULT_ONLY_VOICES.some(voice =>
          snapshotContains(content, `Emma.*${voice}`) || snapshotContains(content, `${voice}.*Emma`)
        );

        return !hasAdultVoice;
      }
    }
  ]
};

/**
 * Test: Male Child Gets Age-Appropriate Voice
 */
export const testMaleChildVoice = {
  name: 'Male Child Gets Age-Appropriate Voice',
  config: TEST_STORY_CONFIGS.maleChild,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: TEST_STORY_CONFIGS.maleChild.premise
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    {
      action: 'wait_for',
      text: 'Voices',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture voice assignment for male child'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    }
  ],

  assertions: [
    {
      name: 'Male child character gets young voice (Ethan or Harry)',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture voice assignment for male child');
        const content = snapshot?.content || '';

        // For male children, Ethan and Harry are the best choices
        const maleChildVoices = ['Ethan', 'Harry'];
        return maleChildVoices.some(voice => snapshotContains(content, voice));
      }
    }
  ]
};

/**
 * Test: Elderly Character Gets Mature Voice
 */
export const testElderlyCharacterVoice = {
  name: 'Elderly Character Gets Mature Voice',
  config: TEST_STORY_CONFIGS.elderlyCharacter,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: TEST_STORY_CONFIGS.elderlyCharacter.premise
    },
    {
      action: 'click',
      ref: '[data-testid="generate-button"], button:has-text("Generate")'
    },
    {
      action: 'wait_for',
      text: 'Voices',
      timeout: TIMEOUTS.generation
    },
    {
      action: 'snapshot',
      description: 'Capture voice assignment for elderly character'
    },
    {
      action: 'wait_for',
      text: 'Begin Chapter',
      timeout: TIMEOUTS.generation
    }
  ],

  assertions: [
    {
      name: 'Elderly female character gets mature voice',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture voice assignment for elderly character');
        const content = snapshot?.content || '';

        // Mature female voices for elderly characters
        const matureVoices = ['Dorothy', 'Grace', 'Bella'];
        return matureVoices.some(voice => snapshotContains(content, voice));
      }
    }
  ]
};

/**
 * Test: Mixed Ages Get Correct Voices
 */
export const testMixedAgesVoices = {
  name: 'Mixed Ages Get Correct Voices',
  config: TEST_STORY_CONFIGS.mixedAges,

  steps: [
    {
      action: 'navigate',
      url: 'http://localhost/storyteller/configure'
    },
    {
      action: 'type',
      ref: '[data-testid="premise-input"], textarea[name="premise"]',
      text: TEST_STORY_CONFIGS.mixedAges.premise
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
      description: 'Capture final voice assignments'
    }
  ],

  assertions: [
    {
      name: 'Both characters assigned different appropriate voices',
      check: (snapshots) => {
        const snapshot = snapshots.find(s => s.description === 'Capture final voice assignments');
        const content = snapshot?.content || '';

        // Should have at least 2 different voices assigned
        const allVoices = [...CHILD_SUITABLE_VOICES, 'Dorothy', 'Grace', 'Bella', 'George', 'Daniel'];
        const foundVoices = allVoices.filter(voice => snapshotContains(content, voice));

        return foundVoices.length >= 2;
      }
    }
  ]
};

// Export all tests
export default [
  testChildCharacterVoice,
  testMaleChildVoice,
  testElderlyCharacterVoice,
  testMixedAgesVoices
];
