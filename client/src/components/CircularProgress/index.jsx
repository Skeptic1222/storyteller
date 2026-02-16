/**
 * CircularProgress Component
 * Full-screen circular progress indicator with Narrimo-inspired design
 *
 * Features:
 * - Full-screen display during story generation
 * - 8 milestone badges at 45° intervals representing pipeline stages
 * - Badge-gated progress (progress stops at badge until stage completes)
 * - 4 quadrant colors matching Narrimo logo (Navy, Cyan, Tan, Sage)
 * - Progress preserves previous quadrant colors
 * - TimeDisplay with animated clock and hourglass
 * - Activity feed for real-time updates
 *
 * Pipeline Stage Order:
 * 1. STORY - Story content generation (0-55%)
 * 2. VOICES - Voice casting/assignment (55-57%)
 * 3. SFX - Sound effect detection (57-60%)
 * 4. COVER - Cover art generation (60-68%)
 * 5. QA - Quality assurance checks (68-70%)
 * 6. AUDIO - Audio synthesis (70-98%)
 */

import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import CircularProgressRing, { QUADRANT_COLORS, QUADRANT_ANGLES } from './CircularProgressRing';
import MilestoneBadge from './MilestoneBadge';
import ProgressCenter from './ProgressCenter';
import ActivityFeed from './ActivityFeed';
import TimeDisplay from './TimeDisplay';
import {
  BookOpen, FileCheck, Users, UserCheck,
  Volume2, Palette, Shield, Mic
} from 'lucide-react';

// Stage constants matching server
const STAGES = {
  STORY: 'story',
  VOICES: 'voices',
  SFX: 'sfx',
  COVER: 'cover',
  QA: 'qa',
  AUDIO: 'audio'
};

const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  ERROR: 'error'
};

// 8 Milestone definitions - 45° apart (matching actual pipeline order)
// Badges positioned to mark key progress points
const MILESTONES = [
  {
    id: 'story-start',
    stage: STAGES.STORY,
    angle: 22.5,        // Position on circle (degrees from top, clockwise)
    gatePercent: 6.25,  // % where progress should gate until stage complete
    icon: BookOpen,
    label: 'Story',
    activeLabel: 'Writing...',
    completeLabel: 'Story Started'
  },
  {
    id: 'story-complete',
    stage: STAGES.STORY,
    angle: 67.5,
    gatePercent: 18.75,
    icon: FileCheck,
    label: 'Draft',
    activeLabel: 'Drafting...',
    completeLabel: 'Draft Done'
  },
  {
    id: 'voice-casting',
    stage: STAGES.VOICES,
    angle: 112.5,
    gatePercent: 31.25,
    icon: Users,
    label: 'Voices',
    activeLabel: 'Casting...',
    completeLabel: 'Voices Cast'
  },
  {
    id: 'voices-done',
    stage: STAGES.VOICES,
    angle: 157.5,
    gatePercent: 43.75,
    icon: UserCheck,
    label: 'Assigned',
    activeLabel: 'Assigning...',
    completeLabel: 'Assigned'
  },
  {
    id: 'sfx-detection',
    stage: STAGES.SFX,
    angle: 202.5,
    gatePercent: 56.25,
    icon: Volume2,
    label: 'SFX',
    activeLabel: 'Finding SFX...',
    completeLabel: 'SFX Ready'
  },
  {
    id: 'cover-art',
    stage: STAGES.COVER,
    angle: 247.5,
    gatePercent: 68.75,
    icon: Palette,
    label: 'Cover',
    activeLabel: 'Creating...',
    completeLabel: 'Cover Done'
  },
  {
    id: 'qa-checks',
    stage: STAGES.QA,
    angle: 292.5,
    gatePercent: 81.25,
    icon: Shield,
    label: 'QA',
    activeLabel: 'Checking...',
    completeLabel: 'QA Passed'
  },
  {
    id: 'audio-synthesis',
    stage: STAGES.AUDIO,
    angle: 337.5,
    gatePercent: 93.75,
    icon: Mic,
    label: 'Audio',
    activeLabel: 'Synthesizing...',
    completeLabel: 'Audio Ready'
  }
];

/**
 * Calculate badge-gated progress
 * Progress cannot advance past a badge until that badge's stage is complete
 */
const getGatedProgress = (rawPercent, stageStatuses) => {
  // Find the first incomplete badge that we've reached
  for (const badge of MILESTONES) {
    const stageStatus = stageStatuses[badge.stage];
    const stageComplete = stageStatus === STATUS.SUCCESS;

    // If we've reached this badge's gate but the stage isn't complete, stop here
    if (!stageComplete && rawPercent >= badge.gatePercent) {
      // Progress stops just before this badge (with small offset for visual gap)
      return Math.max(0, badge.gatePercent - 0.5);
    }
  }

  // All stages complete up to current progress, or progress hasn't reached any gates
  return rawPercent;
};

const CircularProgress = memo(function CircularProgress({
  // Progress data
  percent = 0,
  currentStage = null,
  stageStatuses = {},
  stageMessage = '',

  // Time tracking (from server startTime for persistence)
  startTime = null,

  // Activity log
  activityLog = [],

  // Sizing - LARGER for full-screen display
  size = 400,
  ringStrokeWidth = 16,

  // Display options
  showActivityFeed = true,
  showMilestones = true,
  showTimeDisplay = true,
  compact = false,
  fullScreen = false,  // NEW: Full-screen overlay mode

  // Badge-gating
  enableBadgeGating = true
}) {
  // Track elapsed time
  const [elapsedMs, setElapsedMs] = useState(0);
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState(null);

  // Timer effect - uses startTime for persistence across refreshes
  useEffect(() => {
    if (!startTime) return;

    const updateElapsed = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      setElapsedMs(elapsed);

      // Estimate remaining time based on progress
      if (percent > 5) {
        const msPerPercent = elapsed / percent;
        const remainingPercent = 100 - percent;
        setEstimatedRemainingMs(msPerPercent * remainingPercent);
      }
    };

    // Initial update
    updateElapsed();

    // Update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime, percent]);

  // Apply badge-gating to progress if enabled
  const effectivePercent = useMemo(() => {
    if (!enableBadgeGating) return percent;
    return getGatedProgress(percent, stageStatuses);
  }, [percent, stageStatuses, enableBadgeGating]);

  // Calculate milestone positions on the ring
  const milestonePositions = useMemo(() => {
    const center = size / 2;
    const radius = (size - ringStrokeWidth) / 2;

    return MILESTONES.map(milestone => {
      // Convert angle to radians (starting from top, going clockwise)
      // Subtract 90 to start from top (12 o'clock position)
      const angleRad = ((milestone.angle - 90) * Math.PI) / 180;

      return {
        ...milestone,
        x: center + radius * Math.cos(angleRad),
        y: center + radius * Math.sin(angleRad)
      };
    });
  }, [size, ringStrokeWidth]);

  // Determine milestone status based on stageStatuses
  const getMilestoneStatus = useCallback((milestone) => {
    const stageStatus = stageStatuses[milestone.stage];

    if (stageStatus === STATUS.SUCCESS) return 'success';
    if (stageStatus === STATUS.IN_PROGRESS) return 'in_progress';
    if (stageStatus === STATUS.ERROR) return 'error';
    return 'pending';
  }, [stageStatuses]);

  // Get the current active milestone label
  const getActiveLabel = useCallback(() => {
    const activeMilestone = MILESTONES.find(m =>
      stageStatuses[m.stage] === STATUS.IN_PROGRESS
    );
    return activeMilestone?.activeLabel || stageMessage || 'Preparing...';
  }, [stageStatuses, stageMessage]);

  // Get current quadrant for highlighting based on stage
  const activeQuadrant = useMemo(() => {
    if (currentStage) {
      // Map stages to quadrants
      const stageToQuadrant = {
        [STAGES.STORY]: 'Q1',
        [STAGES.VOICES]: 'Q2',
        [STAGES.SFX]: 'Q3',
        [STAGES.COVER]: 'Q3',
        [STAGES.QA]: 'Q4',
        [STAGES.AUDIO]: 'Q4'
      };
      return stageToQuadrant[currentStage] || 'Q1';
    }
    // Fallback to percent-based
    if (effectivePercent <= 25) return 'Q1';
    if (effectivePercent <= 50) return 'Q2';
    if (effectivePercent <= 75) return 'Q3';
    return 'Q4';
  }, [currentStage, effectivePercent]);

  // Calculate display percent
  const displayPercent = Math.max(0, Math.min(100, Math.round(effectivePercent)));

  // Compact mode - minimal display
  if (compact) {
    return (
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <CircularProgressRing
          percent={displayPercent}
          size={size}
          strokeWidth={ringStrokeWidth}
          activeQuadrant={activeQuadrant}
        />
        <ProgressCenter
          percent={displayPercent}
          elapsedMs={elapsedMs}
          currentActivity={stageMessage}
          stageLabel={getActiveLabel()}
          size={size * 0.6}
        />
      </div>
    );
  }

  // Full layout with milestones and activity feed
  const containerClass = fullScreen
    ? "fixed inset-0 z-50 flex flex-col items-center justify-center bg-narrimo-midnight"
    : "flex flex-col items-center justify-center w-full";

  return (
    <div className={containerClass}>
      {/* Main ring container */}
      <div className="relative" style={{ width: size, height: size }}>
        {/* Ring */}
        <CircularProgressRing
          percent={displayPercent}
          size={size}
          strokeWidth={ringStrokeWidth}
          activeQuadrant={activeQuadrant}
        />

        {/* Center content */}
        <ProgressCenter
          percent={displayPercent}
          elapsedMs={elapsedMs}
          currentActivity={stageMessage}
          stageLabel={getActiveLabel()}
          size={size * 0.55}
        />

        {/* Milestone badges around the ring */}
        {showMilestones && milestonePositions.map(milestone => (
          <MilestoneBadge
            key={milestone.id}
            status={getMilestoneStatus(milestone)}
            label={milestone.label}
            activeLabel={milestone.activeLabel}
            completeLabel={milestone.completeLabel}
            icon={milestone.icon}
            position={{ x: milestone.x, y: milestone.y }}
            angle={milestone.angle}
            size={48}
            showLabel={true}
            currentProgress={displayPercent}
            badgeProgress={milestone.gatePercent}
          />
        ))}
      </div>

      {/* Time display - below ring */}
      {showTimeDisplay && (
        <div className="mt-6">
          <TimeDisplay
            elapsedMs={elapsedMs}
            estimatedRemainingMs={estimatedRemainingMs}
            size="default"
          />
        </div>
      )}

      {/* Stage status summary - compact row */}
      <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
        {Object.entries(STAGES).map(([key, stage]) => {
          const status = stageStatuses[stage];
          const milestone = MILESTONES.find(m => m.stage === stage);
          const Icon = milestone?.icon || Shield;

          return (
            <div
              key={stage}
              className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all ${
                status === STATUS.SUCCESS ? 'bg-emerald-500/20 text-emerald-400' :
                status === STATUS.IN_PROGRESS ? 'bg-golden-500/20 text-golden-400 animate-pulse' :
                status === STATUS.ERROR ? 'bg-red-500/20 text-red-400' :
                'bg-slate-700/50 text-slate-500'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span className="capitalize">{stage}</span>
            </div>
          );
        })}
      </div>

      {/* Activity feed */}
      {showActivityFeed && activityLog.length > 0 && (
        <div className="w-full max-w-lg mt-6">
          <ActivityFeed
            logs={activityLog}
            maxVisible={5}
          />
        </div>
      )}
    </div>
  );
});

export default CircularProgress;
export {
  CircularProgressRing,
  MilestoneBadge,
  ProgressCenter,
  ActivityFeed,
  TimeDisplay,
  MILESTONES,
  STAGES,
  STATUS,
  QUADRANT_COLORS,
  QUADRANT_ANGLES
};
