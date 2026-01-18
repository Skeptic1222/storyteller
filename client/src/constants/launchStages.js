/**
 * Launch Stage Constants
 * Shared constants for LaunchScreen and related components
 */
import { Sparkles, Mic, Volume2, Image, Shield, AudioLines } from 'lucide-react';

// Validation stage definitions matching server
export const STAGES = {
  STORY: 'story',
  VOICES: 'voices',
  SFX: 'sfx',
  COVER: 'cover',
  QA: 'qa',
  AUDIO: 'audio'  // Audio synthesis - generates all TTS before reveal
};

export const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  ERROR: 'error'
};

// Countdown phases (deprecated - simplified flow goes directly to ready)
// Kept for backward compatibility with existing components
export const COUNTDOWN_PHASE = {
  READY: 'ready',
  COMPLETE: 'complete'
};

// Stage configuration with icons and display names
export const STAGE_CONFIG = {
  [STAGES.STORY]: {
    name: 'Story Generation',
    shortName: 'Story',
    icon: Sparkles,
    description: 'Creating your story',
    color: 'golden',
    activeColor: 'text-golden-400',
    bgColor: 'bg-golden-500/20'
  },
  [STAGES.VOICES]: {
    name: 'Narrator Voices',
    shortName: 'Voices',
    icon: Mic,
    description: 'Assigning voice actors',
    color: 'purple',
    activeColor: 'text-purple-400',
    bgColor: 'bg-purple-500/20'
  },
  [STAGES.SFX]: {
    name: 'Sound Effects',
    shortName: 'SFX',
    icon: Volume2,
    description: 'Preparing audio effects',
    color: 'cyan',
    activeColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20'
  },
  [STAGES.COVER]: {
    name: 'Cover Art',
    shortName: 'Cover',
    icon: Image,
    description: 'Validating story cover',
    color: 'amber',
    activeColor: 'text-amber-400',
    bgColor: 'bg-amber-500/20'
  },
  [STAGES.QA]: {
    name: 'Quality Checks',
    shortName: 'QA',
    icon: Shield,
    description: 'Final validation',
    color: 'green',
    activeColor: 'text-green-400',
    bgColor: 'bg-green-500/20'
  },
  [STAGES.AUDIO]: {
    name: 'Audio Synthesis',
    shortName: 'Audio',
    icon: AudioLines,
    description: 'Synthesizing narration',
    color: 'blue',
    activeColor: 'text-blue-400',
    bgColor: 'bg-blue-500/20'
  }
};

/**
 * Get stage config by stage ID
 * @param {string} stageId - Stage ID from STAGES
 * @returns {Object|null} Stage configuration or null
 */
export function getStageConfig(stageId) {
  return STAGE_CONFIG[stageId] || null;
}

/**
 * Get all stage IDs as array
 * @returns {string[]} Array of stage IDs
 */
export function getStageIds() {
  return Object.values(STAGES);
}
