/**
 * Launch Sequence Stage Constants
 * Single source of truth for all stage-related constants.
 *
 * IMPORTANT: All stage IDs and statuses should be imported from this file.
 * Do NOT hardcode stage values elsewhere in the codebase.
 */

// Stage IDs used in the launch sequence
export const STAGES = {
  VOICES: 'voices',
  SFX: 'sfx',
  COVER: 'cover',
  QA: 'qa',
  AUDIO: 'audio'  // Audio synthesis - generates all TTS before reveal
};

// Stage display names for UI
export const STAGE_NAMES = {
  [STAGES.VOICES]: 'Narrator Voices',
  [STAGES.SFX]: 'Sound Effects',
  [STAGES.COVER]: 'Cover Art',
  [STAGES.QA]: 'Quality Checks',
  [STAGES.AUDIO]: 'Audio Synthesis'  // TTS generation for intro + scene
};

// Stage status values
export const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  ERROR: 'error'
};

// Alias for consistency with eventSchemas.js naming
export const STAGE_STATUS = STATUS;

// Launch progress ranges (overall 55-100% after story generation completes at 55%)
// Compressed to make room for AUDIO stage which is the longest post-generation stage
export const LAUNCH_PROGRESS_RANGES = {
  [STAGES.VOICES]: { start: 55, end: 62 },   // Voice assignment (was 70-82)
  [STAGES.SFX]: { start: 62, end: 68 },      // SFX detection (was 82-92)
  [STAGES.COVER]: { start: 68, end: 74 },    // Cover art (was 92-97)
  [STAGES.QA]: { start: 74, end: 78 },       // QA checks (was 97-100)
  [STAGES.AUDIO]: { start: 78, end: 98 }     // Audio synthesis - longest stage, 20% of bar
};

// Helper to get all stages as an array for initial state
export function getInitialStages() {
  return Object.keys(STAGES).map(key => ({
    id: STAGES[key],
    name: STAGE_NAMES[STAGES[key]],
    status: STATUS.PENDING
  }));
}

// Helper to get initial all-statuses map
export function getInitialStatuses() {
  return Object.values(STAGES).reduce((acc, stage) => {
    acc[stage] = STATUS.PENDING;
    return acc;
  }, {});
}

export default {
  STAGES,
  STAGE_NAMES,
  STATUS,
  STAGE_STATUS,
  LAUNCH_PROGRESS_RANGES,
  getInitialStages,
  getInitialStatuses
};
