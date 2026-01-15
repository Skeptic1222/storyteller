/**
 * Socket.IO Event Schemas for Storyteller
 * Section 4 of Storyteller Gospel - Structured stage_status event schema
 *
 * This file documents all launch sequence events and their payloads.
 * Use these schemas to ensure consistent data flow between server and client.
 *
 * Event Categories:
 * 1. Launch Sequence Events (launch-*)
 * 2. Stage Detail Events (voice-*, sfx-*, cover-*, qa-*, safety-*)
 */

/**
 * STAGE CONSTANTS
 */
export const STAGES = {
  VOICES: 'voices',
  SFX: 'sfx',
  COVER: 'cover',
  QA: 'qa'
};

export const STAGE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  ERROR: 'error'
};

/**
 * EVENT: launch-sequence-started
 * Emitted when the launch sequence begins
 *
 * @typedef {Object} LaunchSequenceStartedEvent
 * @property {Array<{id: string, name: string, status: string}>} stages - All stages with initial status
 * @property {Object<string, string>} allStatuses - Map of stage ID to status
 */
export const LaunchSequenceStartedSchema = {
  event: 'launch-sequence-started',
  payload: {
    stages: [
      { id: 'voices', name: 'Narrator Voices', status: 'pending' },
      { id: 'sfx', name: 'Sound Effects', status: 'pending' },
      { id: 'cover', name: 'Cover Art', status: 'pending' },
      { id: 'qa', name: 'Quality Checks', status: 'pending' }
    ],
    allStatuses: { voices: 'pending', sfx: 'pending', cover: 'pending', qa: 'pending' }
  }
};

/**
 * EVENT: launch-stage-update
 * Emitted when a single stage status changes
 *
 * @typedef {Object} LaunchStageUpdateEvent
 * @property {string} stage - Stage ID (voices, sfx, cover, qa)
 * @property {string} status - New status (pending, in_progress, success, error)
 * @property {string} previousStatus - Previous status
 * @property {Object<string, string>} allStatuses - Current status of all stages
 * @property {Object} details - Stage-specific details
 * @property {string} details.message - Human-readable status message
 * @property {number} details.retryAttempt - Current retry attempt number
 * @property {boolean} details.canRetry - Whether stage can be retried
 * @property {number} timestamp - Event timestamp (ms since epoch)
 * @property {string} sequenceId - Unique ID for deduplication
 */
export const LaunchStageUpdateSchema = {
  event: 'launch-stage-update',
  payload: {
    stage: 'voices', // 'voices' | 'sfx' | 'cover' | 'qa'
    status: 'in_progress', // 'pending' | 'in_progress' | 'success' | 'error'
    previousStatus: 'pending',
    allStatuses: { voices: 'in_progress', sfx: 'pending', cover: 'pending', qa: 'pending' },
    details: {
      message: 'Assigning narrator voices...',
      retryAttempt: 0,
      canRetry: true
    },
    timestamp: Date.now(),
    sequenceId: 'session-id-stage-timestamp'
  }
};

/**
 * EVENT: launch-progress
 * Emitted for overall progress updates
 *
 * @typedef {Object} LaunchProgressEvent
 * @property {string} message - Progress message
 * @property {number} percent - Completion percentage (0-100)
 * @property {Object<string, string>} statuses - All stage statuses
 * @property {string|null} stage - Active stage (voices, sfx, cover, qa)
 */
export const LaunchProgressSchema = {
  event: 'launch-progress',
  payload: {
    message: 'Generating cover art...',
    percent: 50,
    statuses: { voices: 'success', sfx: 'success', cover: 'in_progress', qa: 'pending' },
    stage: 'cover'
  }
};

/**
 * EVENT: launch-sequence-ready
 * Emitted when all stages complete successfully
 *
 * @typedef {Object} LaunchSequenceReadyEvent
 * @property {boolean} ready - Always true when emitted
 * @property {Object} stats - Validation stats (see ValidationStats)
 * @property {Object} scene - Current scene data
 * @property {Object<string, string>} allStatuses - Final status of all stages
 * @property {Object} sfxDetails - SFX details fallback
 * @property {Object} safetyDetails - Safety report summary (Section 5)
 * @property {number} readyTimestamp - Ready event timestamp
 * @property {string} sequenceId - Unique sequence ID
 * @property {boolean} [isRetry] - True if this is a watchdog resend
 */
export const LaunchSequenceReadySchema = {
  event: 'launch-sequence-ready',
  payload: {
    ready: true,
    stats: {
      // Voice info
      narratorCount: 3,
      narrators: [{ id: 'voice_id', name: 'George', type: 'narrator', character: null }],
      narratorDisplay: 'George, Sarah, Mike',
      // SFX info
      sfxCount: 5,
      sfxCategories: ['ambient', 'weather'],
      sfxNames: ['forest birds', 'rain'],
      sfxCachedCount: 3,
      sfxMissingCount: 2,
      // Session info
      title: 'The Enchanted Forest',
      synopsis: 'A tale of adventure...',
      coverArtUrl: '/audio/covers/session-id.png',
      // Scene stats
      sceneCount: 1,
      characterCount: 3,
      estimatedDuration: 45,
      // Safety report (Section 5)
      safetyReport: null, // Full report object
      contentAdjusted: false,
      intensityScores: { violence: 10, gore: 0, scary: 20, romance: 5, language: 0 },
      // Validation
      isValid: true,
      errors: [],
      warnings: []
    },
    scene: {
      id: 'scene-uuid',
      index: 0,
      text: 'Once upon a time...',
      mood: 'adventurous',
      hasChoices: false,
      choices: [],
      isFinal: false,
      sfx: [],
      audioUrl: null
    },
    allStatuses: { voices: 'success', sfx: 'success', cover: 'success', qa: 'success' },
    sfxDetails: {
      sfxList: [{ key: 'ambient.forest', name: 'forest', category: 'ambient', status: 'cached', progress: 100 }],
      sfxCount: 5,
      cachedCount: 3,
      generatingCount: 2,
      totalInLibrary: 150,
      sfxEnabled: true
    },
    safetyDetails: {
      wasAdjusted: false,
      summary: 'Content within comfort settings',
      audience: 'general',
      originalScores: { violence: 10, gore: 0, scary: 20, romance: 5, language: 0 },
      adjustedScores: null,
      changesMade: [],
      passCount: 1
    },
    readyTimestamp: Date.now(),
    sequenceId: 'session-id-ready-timestamp'
  }
};

/**
 * EVENT: launch-sequence-error
 * Emitted when the launch sequence fails
 *
 * @typedef {Object} LaunchSequenceErrorEvent
 * @property {string} error - Error message
 * @property {string|null} failedStage - Stage that failed
 * @property {Object<string, string>} statuses - Stage statuses at failure
 */
export const LaunchSequenceErrorSchema = {
  event: 'launch-sequence-error',
  payload: {
    error: 'Voice assignment failed: No voices available',
    failedStage: 'voices',
    statuses: { voices: 'error', sfx: 'pending', cover: 'pending', qa: 'pending' }
  }
};

/**
 * EVENT: voice-assignment-update
 * Detailed voice assignment information for HUD
 *
 * @typedef {Object} VoiceAssignmentUpdateEvent
 * @property {Array<Object>} characters - Voice assignments per character
 * @property {number} totalCharacters - Total character count (including narrator)
 * @property {number} totalVoices - Unique voice count
 */
export const VoiceAssignmentUpdateSchema = {
  event: 'voice-assignment-update',
  payload: {
    characters: [
      {
        name: 'Narrator',
        voiceName: 'George',
        voiceDescription: 'Main storyteller',
        voiceId: 'elevenlabs-voice-id', // Internal use only, not displayed
        isNarrator: true,
        role: 'narrator',
        sharesNarratorVoice: false
      },
      {
        name: 'Princess Elena',
        voiceName: 'Sarah',
        voiceDescription: 'protagonist voice',
        voiceId: 'elevenlabs-voice-id',
        isNarrator: false,
        role: 'protagonist',
        sharesNarratorVoice: false
      }
    ],
    totalCharacters: 4,
    totalVoices: 3
  }
};

/**
 * EVENT: sfx-detail-update
 * Detailed SFX information for HUD
 *
 * @typedef {Object} SFXDetailUpdateEvent
 * @property {Array<Object>} sfxList - List of SFX with status
 * @property {number} sfxCount - Total SFX for scene
 * @property {number} cachedCount - SFX found in cache
 * @property {number} generatingCount - SFX being generated
 * @property {number} totalInLibrary - Total SFX in local library
 * @property {boolean} sfxEnabled - Whether SFX is enabled
 */
export const SFXDetailUpdateSchema = {
  event: 'sfx-detail-update',
  payload: {
    sfxList: [
      { key: 'ambient.forest', name: 'forest ambiance', category: 'ambient', status: 'cached', progress: 100 },
      { key: 'weather.rain_light', name: 'light rain', category: 'weather', status: 'generating', progress: 50 }
    ],
    sfxCount: 5,
    cachedCount: 3,
    generatingCount: 2,
    totalInLibrary: 150,
    sfxEnabled: true
  }
};

/**
 * EVENT: cover-generation-progress
 * Cover art generation progress updates
 *
 * @typedef {Object} CoverGenerationProgressEvent
 * @property {string} status - 'generating' | 'validating' | 'complete' | 'error'
 * @property {number} progress - Progress percentage (0-100)
 * @property {string} message - Status message
 * @property {string|null} coverUrl - Cover image URL when available
 */
export const CoverGenerationProgressSchema = {
  event: 'cover-generation-progress',
  payload: {
    status: 'generating', // 'generating' | 'validating' | 'complete' | 'error'
    progress: 60,
    message: 'Creating cover art with AI...',
    coverUrl: null
  }
};

/**
 * EVENT: qa-check-update
 * Individual QA check status updates
 *
 * @typedef {Object} QACheckUpdateEvent
 * @property {string} checkName - Check identifier
 * @property {string} status - 'running' | 'passed' | 'warning' | 'failed'
 * @property {string} message - Status message
 * @property {Object} details - Additional check-specific details
 */
export const QACheckUpdateSchema = {
  event: 'qa-check-update',
  payload: {
    checkName: 'safety', // 'safety' | 'sliders' | 'continuity' | 'engagement'
    status: 'passed', // 'running' | 'passed' | 'warning' | 'failed'
    message: 'Content safety verified',
    details: {
      // Check-specific data
      topGenres: ['fantasy', 'adventure'],
      storyType: 'narrative'
    }
  }
};

/**
 * EVENT: safety-report-update
 * Section 5 - Structured intensity/safety report for HUD
 *
 * @typedef {Object} SafetyReportUpdateEvent
 * @property {Object} report - Full SafetyReport object
 * @property {Object} display - Formatted display data
 * @property {string} audience - 'children' | 'general' | 'mature'
 * @property {boolean} wasAdjusted - Whether content was modified
 * @property {string} summary - Human-readable summary
 */
export const SafetyReportUpdateSchema = {
  event: 'safety-report-update',
  payload: {
    report: {
      timestamp: '2025-12-07T00:00:00.000Z',
      originalScores: { violence: 30, gore: 5, scary: 40, romance: 10, language: 0 },
      targetLevels: { violence: 20, gore: 0, scary: 30, romance: 20, language: 10 },
      adjustedScores: { violence: 18, gore: 0, scary: 28, romance: 10, language: 0 },
      passCount: 3,
      changesMade: ['Softened combat description', 'Reduced tension in forest scene'],
      wasAdjusted: true,
      audience: 'general',
      summary: 'Content adjusted: violence, scary reduced to meet comfort settings'
    },
    display: {
      // Simple mode
      message: 'Content adjusted to your comfort settings',
      wasAdjusted: true,
      changeCount: 2
      // Advanced mode adds: categoryChanges[], changesMade[], passCount
    },
    audience: 'general',
    wasAdjusted: true,
    summary: 'Content adjusted: violence, scary reduced to meet comfort settings'
  }
};

/**
 * Helper to validate event payload matches schema
 * @param {string} eventName - Event name
 * @param {Object} payload - Event payload to validate
 * @returns {boolean} True if valid
 */
export function validateEventPayload(eventName, payload) {
  const schemas = {
    'launch-sequence-started': LaunchSequenceStartedSchema,
    'launch-stage-update': LaunchStageUpdateSchema,
    'launch-progress': LaunchProgressSchema,
    'launch-sequence-ready': LaunchSequenceReadySchema,
    'launch-sequence-error': LaunchSequenceErrorSchema,
    'voice-assignment-update': VoiceAssignmentUpdateSchema,
    'sfx-detail-update': SFXDetailUpdateSchema,
    'cover-generation-progress': CoverGenerationProgressSchema,
    'qa-check-update': QACheckUpdateSchema,
    'safety-report-update': SafetyReportUpdateSchema
  };

  const schema = schemas[eventName];
  if (!schema) {
    console.warn(`[EventSchema] Unknown event: ${eventName}`);
    return false;
  }

  // Basic type check - ensure payload has same top-level keys
  const schemaKeys = Object.keys(schema.payload);
  const payloadKeys = Object.keys(payload);

  const missingKeys = schemaKeys.filter(k => !payloadKeys.includes(k));
  if (missingKeys.length > 0) {
    console.warn(`[EventSchema] ${eventName} missing keys:`, missingKeys);
    return false;
  }

  return true;
}

export default {
  STAGES,
  STAGE_STATUS,
  LaunchSequenceStartedSchema,
  LaunchStageUpdateSchema,
  LaunchProgressSchema,
  LaunchSequenceReadySchema,
  LaunchSequenceErrorSchema,
  VoiceAssignmentUpdateSchema,
  SFXDetailUpdateSchema,
  CoverGenerationProgressSchema,
  QACheckUpdateSchema,
  SafetyReportUpdateSchema,
  validateEventPayload
};
