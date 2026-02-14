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
// TIME-PROPORTIONAL REBALANCING: Based on observed phase durations
// Total post-generation: ~163 seconds typical
// Voices: ~5 sec (3%), SFX: ~8 sec (5%), Cover: ~25 sec (15%), QA: ~5 sec (3%), Audio: ~120 sec (74%)
export const LAUNCH_PROGRESS_RANGES = {
  [STAGES.VOICES]: { start: 55, end: 57 },   // Voice assignment ~2% (quick phase)
  [STAGES.SFX]: { start: 57, end: 60 },      // SFX detection ~3% (quick phase)
  [STAGES.COVER]: { start: 60, end: 68 },    // Cover art ~8% (DALL-E network latency)
  [STAGES.QA]: { start: 68, end: 70 },       // QA checks ~2% (quick validation)
  [STAGES.AUDIO]: { start: 70, end: 98 }     // Audio synthesis ~28% - LONGEST stage (TTS + assembly)
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
