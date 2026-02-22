/**
 * Hooks Index
 * Re-exports all custom hooks for cleaner imports.
 *
 * Usage:
 * import { useStateRef, useAudioStateMachine } from '../hooks';
 */

// State management hooks
export { useStateRef, useBooleanStateRef } from './useStateRef';
export { useAudioStateMachine, AUDIO_STATES } from './useAudioStateMachine';

// Feature-specific hooks
export { default as useAgentStatus } from './useAgentStatus';
export { default as useAutoContinue } from './useAutoContinue';
export { default as useKaraokeHighlight } from './useKaraokeHighlight';
export { default as useKeyboardShortcuts } from './useKeyboardShortcuts';
export { default as useLaunchSequence } from './useLaunchSequence';
export { default as useOfflineMode } from './useOfflineMode';
export { default as useRecordings } from './useRecordings';
export { default as useSfxManager } from './useSfxManager';
export { default as useSleepTimer } from './useSleepTimer';
export { default as useStorySocket } from './useStorySocket';
export { default as useUsageTracking } from './useUsageTracking';

// Session and story management hooks
export { default as useCYOAState } from './useCYOAState';
export { default as useCoverArt } from './useCoverArt';
export { default as usePlaybackControls } from './usePlaybackControls';
export { default as useRecordingPlayback } from './useRecordingPlayback';
export { default as useHeaderPanels } from './useHeaderPanels';
export { default as useStoryConfig } from './useStoryConfig';
