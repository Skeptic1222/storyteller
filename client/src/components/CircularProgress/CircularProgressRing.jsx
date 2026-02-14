/**
 * CircularProgressRing Component
 * SVG-based circular progress with Narrimo logo-inspired quadrant colors
 *
 * Features:
 * - Four quadrants with distinct colors (Navy, Cyan, Tan, Sage)
 * - Completed quadrants preserve their original color
 * - Active quadrant shows glow effect
 * - Pending quadrants are dimmed
 * - Smooth progress animation
 */

import { memo, useMemo } from 'react';
import QuadrantSegment, { QUADRANT_COLORS } from './QuadrantSegment';

// Quadrant angle definitions (clockwise from top)
const QUADRANT_ANGLES = {
  Q1: { start: 0, end: 90 },    // 0° - 90° (top-right)
  Q2: { start: 90, end: 180 },  // 90° - 180° (bottom-right)
  Q3: { start: 180, end: 270 }, // 180° - 270° (bottom-left)
  Q4: { start: 270, end: 360 }  // 270° - 360° (top-left)
};

// Convert percent (0-100) to angle (0-360)
const percentToAngle = (percent) => (percent / 100) * 360;

// Get quadrant key from angle
const getQuadrantFromAngle = (angle) => {
  if (angle <= 90) return 'Q1';
  if (angle <= 180) return 'Q2';
  if (angle <= 270) return 'Q3';
  return 'Q4';
};

// Get quadrant key from percent
const getQuadrantFromPercent = (percent) => {
  if (percent <= 25) return 'Q1';
  if (percent <= 50) return 'Q2';
  if (percent <= 75) return 'Q3';
  return 'Q4';
};

const CircularProgressRing = memo(function CircularProgressRing({
  percent = 0,
  size = 400,
  strokeWidth = 16,
  activeQuadrant = null, // Optionally force active quadrant
  stageStatuses = {},    // For determining which quadrants are complete
  showBackground = true,
  showDividers = true
}) {
  // Calculate SVG dimensions
  const center = { x: size / 2, y: size / 2 };
  const radius = (size - strokeWidth) / 2;

  // Clamp percent
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const progressAngle = percentToAngle(clampedPercent);

  // Determine the current quadrant based on progress
  const currentQuadrant = activeQuadrant || getQuadrantFromPercent(clampedPercent);

  // Calculate quadrant states based on progress
  const quadrantStates = useMemo(() => {
    const states = {};
    const quadrants = ['Q1', 'Q2', 'Q3', 'Q4'];

    quadrants.forEach((q, index) => {
      const qAngles = QUADRANT_ANGLES[q];
      const qStartPercent = (index * 25);
      const qEndPercent = ((index + 1) * 25);

      if (clampedPercent >= qEndPercent) {
        // Quadrant is fully completed
        states[q] = { state: 'completed', fillPercent: 100 };
      } else if (clampedPercent > qStartPercent) {
        // Quadrant is partially filled (active)
        const qProgress = ((clampedPercent - qStartPercent) / 25) * 100;
        states[q] = { state: 'partial', fillPercent: qProgress };
      } else {
        // Quadrant is pending
        states[q] = { state: 'pending', fillPercent: 0 };
      }
    });

    return states;
  }, [clampedPercent]);

  // Generate divider lines at quadrant boundaries
  const dividerLines = useMemo(() => {
    if (!showDividers) return null;

    return [90, 180, 270].map((angle) => {
      const radian = ((angle - 90) * Math.PI) / 180;
      const innerRadius = radius - strokeWidth / 2 - 2;
      const outerRadius = radius + strokeWidth / 2 + 2;

      const x1 = center.x + innerRadius * Math.cos(radian);
      const y1 = center.y + innerRadius * Math.sin(radian);
      const x2 = center.x + outerRadius * Math.cos(radian);
      const y2 = center.y + outerRadius * Math.sin(radian);

      return (
        <line
          key={angle}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#475569"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-40"
        />
      );
    });
  }, [center, radius, strokeWidth, showDividers]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="circular-progress-ring"
    >
      {/* Global definitions */}
      <defs>
        {/* Background track gradient */}
        <linearGradient id="ring-bg-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#334155" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#1e293b" stopOpacity="0.2" />
        </linearGradient>

        {/* Glow filter for active progress */}
        <filter id="progress-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background track circle */}
      {showBackground && (
        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="none"
          stroke="url(#ring-bg-gradient)"
          strokeWidth={strokeWidth}
          className="opacity-70"
        />
      )}

      {/* Quadrant divider lines - BEFORE quadrants so they appear behind */}
      {dividerLines}

      {/* Render all quadrants with their appropriate states */}
      {Object.entries(QUADRANT_ANGLES).map(([quadrantKey, angles]) => {
        const qState = quadrantStates[quadrantKey];
        const isCurrentQuadrant = quadrantKey === currentQuadrant;

        return (
          <QuadrantSegment
            key={quadrantKey}
            quadrantKey={quadrantKey}
            center={center}
            radius={radius}
            strokeWidth={strokeWidth}
            startAngle={angles.start}
            endAngle={angles.end}
            state={qState.state}
            fillPercent={qState.fillPercent}
            showGlow={isCurrentQuadrant && qState.state !== 'pending'}
          />
        );
      })}

      {/* Progress leading edge indicator (small bright dot at the current progress point) */}
      {clampedPercent > 0 && clampedPercent < 100 && (
        <circle
          cx={center.x + radius * Math.cos(((progressAngle - 90) * Math.PI) / 180)}
          cy={center.y + radius * Math.sin(((progressAngle - 90) * Math.PI) / 180)}
          r={strokeWidth / 3}
          fill="white"
          filter="url(#progress-glow)"
          className="animate-pulse"
        >
          <animate
            attributeName="r"
            values={`${strokeWidth / 3};${strokeWidth / 2.5};${strokeWidth / 3}`}
            dur="1.5s"
            repeatCount="indefinite"
          />
        </circle>
      )}
    </svg>
  );
});

export default CircularProgressRing;
export { QUADRANT_COLORS, QUADRANT_ANGLES };
