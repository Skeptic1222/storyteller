/**
 * TypeScript Types for Launch Sequence Events
 * Section 4 of Storyteller Gospel - Structured stage_status event schema
 *
 * These types match the server-side eventSchemas.js
 * Import and use these types to ensure type safety when handling socket events.
 */

// Stage constants
export type StageId = 'voices' | 'sfx' | 'cover' | 'qa';
export type StageStatus = 'pending' | 'in_progress' | 'success' | 'error';

export interface StageInfo {
  id: StageId;
  name: string;
  status: StageStatus;
}

export interface AllStatuses {
  voices: StageStatus;
  sfx: StageStatus;
  cover: StageStatus;
  qa: StageStatus;
}

// Event: launch-sequence-started
export interface LaunchSequenceStartedEvent {
  stages: StageInfo[];
  allStatuses: AllStatuses;
}

// Event: launch-stage-update
export interface LaunchStageUpdateEvent {
  stage: StageId;
  status: StageStatus;
  previousStatus: StageStatus;
  allStatuses: AllStatuses;
  details: {
    message: string;
    retryAttempt: number;
    canRetry: boolean;
    [key: string]: unknown;
  };
  timestamp: number;
  sequenceId: string;
}

// Event: launch-progress
export interface LaunchProgressEvent {
  message: string;
  percent: number;
  statuses: AllStatuses;
}

// Intensity scores for safety checking (Section 5)
export interface IntensityScores {
  violence: number;
  gore: number;
  scary: number;
  romance: number;
  language: number;
}

// Safety report structure (Section 5)
export interface SafetyReport {
  timestamp: string;
  originalScores: IntensityScores;
  targetLevels: IntensityScores;
  adjustedScores: IntensityScores;
  passCount: number;
  changesMade: string[];
  wasAdjusted: boolean;
  audience: 'children' | 'general' | 'mature';
  summary: string;
}

// Narrator info
export interface NarratorInfo {
  id: string;
  name: string;
  type: 'narrator' | 'character';
  character: string | null;
}

// Validation stats in launch-sequence-ready
export interface ValidationStats {
  // Voice info
  narratorCount: number;
  narrators: NarratorInfo[];
  narratorDisplay: string;
  // SFX info
  sfxCount: number;
  sfxCategories: string[];
  sfxNames: string[];
  sfxCachedCount: number;
  sfxMissingCount: number;
  sfxMissing: string[];
  sfxTotalLocal: number;
  // Session info
  title: string;
  synopsis: string;
  coverArtUrl: string | null;
  // Scene stats
  sceneCount: number;
  characterCount: number;
  estimatedDuration: number;
  // Safety report (Section 5)
  safetyReport: SafetyReport | null;
  contentAdjusted: boolean;
  intensityScores: IntensityScores | null;
  // Validation
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Scene choice
export interface SceneChoice {
  key: string;
  text: string;
  leads_to_scene_id?: string;
}

// Scene data in launch-sequence-ready
export interface SceneData {
  id: string;
  index: number;
  text: string;
  mood: string;
  hasChoices: boolean;
  choices: SceneChoice[];
  isFinal: boolean;
  sfx: unknown[];
  audioUrl: string | null;
}

// SFX item in sfxDetails
export interface SFXItem {
  key: string;
  name: string;
  category: string;
  status: 'cached' | 'generating';
  progress: number;
}

// SFX details
export interface SFXDetails {
  sfxList: SFXItem[];
  sfxCount: number;
  cachedCount: number;
  generatingCount: number;
  totalInLibrary: number;
  sfxEnabled: boolean;
}

// Safety details (Section 5)
export interface SafetyDetails {
  wasAdjusted: boolean;
  summary: string;
  audience: 'children' | 'general' | 'mature';
  originalScores: IntensityScores | null;
  adjustedScores: IntensityScores | null;
  changesMade: string[];
  passCount: number;
}

// Event: launch-sequence-ready
export interface LaunchSequenceReadyEvent {
  ready: true;
  stats: ValidationStats;
  scene: SceneData;
  allStatuses: AllStatuses;
  sfxDetails: SFXDetails;
  safetyDetails: SafetyDetails;
  readyTimestamp: number;
  sequenceId: string;
  isRetry?: boolean;
}

// Event: launch-sequence-error
export interface LaunchSequenceErrorEvent {
  error: string;
  failedStage: StageId | null;
  statuses: AllStatuses;
}

// Character voice assignment
export interface CharacterVoiceAssignment {
  name: string;
  voiceName: string;
  voiceDescription: string;
  voiceId: string;
  isNarrator: boolean;
  role: string;
  sharesNarratorVoice: boolean;
}

// Event: voice-assignment-update
export interface VoiceAssignmentUpdateEvent {
  characters: CharacterVoiceAssignment[];
  totalCharacters: number;
  totalVoices: number;
}

// Event: sfx-detail-update
export interface SFXDetailUpdateEvent {
  sfxList: SFXItem[];
  sfxCount: number;
  cachedCount: number;
  generatingCount: number;
  totalInLibrary: number;
  sfxEnabled: boolean;
}

// Event: cover-generation-progress
export interface CoverGenerationProgressEvent {
  status: 'generating' | 'validating' | 'complete' | 'error';
  progress: number;
  message: string;
  coverUrl: string | null;
}

// QA check types
export type QACheckName = 'safety' | 'sliders' | 'continuity' | 'engagement';
export type QACheckStatus = 'running' | 'passed' | 'warning' | 'failed';

// Event: qa-check-update
export interface QACheckUpdateEvent {
  checkName: QACheckName;
  status: QACheckStatus;
  message: string;
  details: Record<string, unknown>;
}

// Safety display mode
export interface SafetyDisplaySimple {
  message: string;
  wasAdjusted: boolean;
  changeCount: number;
}

export interface SafetyDisplayAdvanced extends SafetyDisplaySimple {
  categoryChanges: Array<{
    category: string;
    original: number;
    target: number;
    final: number;
    reduced: boolean;
  }>;
  changesMade: string[];
  passCount: number;
  audience: string;
}

// Event: safety-report-update (Section 5)
export interface SafetyReportUpdateEvent {
  report: SafetyReport;
  display: SafetyDisplaySimple | SafetyDisplayAdvanced;
  audience: 'children' | 'general' | 'mature';
  wasAdjusted: boolean;
  summary: string;
}

// Union type for all launch events
export type LaunchEvent =
  | { type: 'launch-sequence-started'; data: LaunchSequenceStartedEvent }
  | { type: 'launch-stage-update'; data: LaunchStageUpdateEvent }
  | { type: 'launch-progress'; data: LaunchProgressEvent }
  | { type: 'launch-sequence-ready'; data: LaunchSequenceReadyEvent }
  | { type: 'launch-sequence-error'; data: LaunchSequenceErrorEvent }
  | { type: 'voice-assignment-update'; data: VoiceAssignmentUpdateEvent }
  | { type: 'sfx-detail-update'; data: SFXDetailUpdateEvent }
  | { type: 'cover-generation-progress'; data: CoverGenerationProgressEvent }
  | { type: 'qa-check-update'; data: QACheckUpdateEvent }
  | { type: 'safety-report-update'; data: SafetyReportUpdateEvent };

export default {
  // Re-export all types for convenient access
};
