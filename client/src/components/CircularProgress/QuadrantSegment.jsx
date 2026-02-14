/**
 * QuadrantSegment Component
 * Individual quadrant arc for the circular progress ring
 *
 * Features:
 * - SVG arc rendering for each quadrant
 * - Three states: completed (full opacity), active (glow), pending (dimmed)
 * - Narrimo-inspired color gradients
 */

import { memo, useMemo } from 'react';

// Narrimo logo-inspired quadrant colors (clockwise from top)
export const QUADRANT_COLORS = {
  Q1: {
    label: 'Story',
    colorStart: '#0A2342', // Navy (narrimo-midnight)
    colorEnd: '#1A4A7A',   // Lighter navy
    stages: ['story']
  },
  Q2: {
    label: 'Voices',
    colorStart: '#22B8CF', // Cyan
    colorEnd: '#4DD0E1',   // Lighter cyan
    stages: ['voices']
  },
  Q3: {
    label: 'Media',
    colorStart: '#B8860B', // Tan/Bronze
    colorEnd: '#D4A574',   // Lighter tan
    stages: ['sfx', 'cover']
  },
  Q4: {
    label: 'Final',
    colorStart: '#6A8A82', // Sage (narrimo-sage)
    colorEnd: '#8FB3A5',   // Lighter sage
    stages: ['qa', 'audio']
  }
};

// Helper function to calculate arc path
function describeArc(cx, cy, radius, startAngle, endAngle) {
  // Convert angles from degrees to radians
  // SVG uses 0° at 3 o'clock, we want 0° at 12 o'clock (top)
  const start = ((startAngle - 90) * Math.PI) / 180;
  const end = ((endAngle - 90) * Math.PI) / 180;

  const startX = cx + radius * Math.cos(start);
  const startY = cy + radius * Math.sin(start);
  const endX = cx + radius * Math.cos(end);
  const endY = cy + radius * Math.sin(end);

  // Large arc flag: 1 if arc > 180 degrees
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  // Sweep flag: 1 for clockwise
  const sweepFlag = 1;

  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`;
}

const QuadrantSegment = memo(function QuadrantSegment({
  quadrantKey,     // 'Q1', 'Q2', 'Q3', 'Q4'
  center,          // Center point {x, y}
  radius,          // Radius of the arc
  strokeWidth = 16,
  startAngle,      // Start angle in degrees (0 = top)
  endAngle,        // End angle in degrees
  state = 'pending', // 'pending', 'active', 'completed', 'partial'
  fillPercent = 0,   // For 'partial' state: how much of the quadrant is filled (0-100)
  showGlow = false
}) {
  const quadrant = QUADRANT_COLORS[quadrantKey] || QUADRANT_COLORS.Q1;
  const gradientId = `gradient-${quadrantKey}-${state}`;
  const glowId = `glow-${quadrantKey}`;

  // Calculate the actual end angle for partial fills
  const effectiveEndAngle = state === 'partial'
    ? startAngle + (endAngle - startAngle) * (fillPercent / 100)
    : endAngle;

  // Generate arc path
  const arcPath = useMemo(() => {
    if (state === 'partial' && fillPercent <= 0) return null;
    return describeArc(center.x, center.y, radius, startAngle, effectiveEndAngle);
  }, [center.x, center.y, radius, startAngle, effectiveEndAngle, state, fillPercent]);

  // State-based styling
  const stateStyles = useMemo(() => {
    switch (state) {
      case 'completed':
        return { opacity: 1, filter: 'none' };
      case 'active':
        return { opacity: 1, filter: showGlow ? `url(#${glowId})` : 'none' };
      case 'partial':
        return { opacity: 1, filter: showGlow ? `url(#${glowId})` : 'none' };
      case 'pending':
      default:
        return { opacity: 0.25, filter: 'none' };
    }
  }, [state, showGlow, glowId]);

  if (!arcPath) return null;

  return (
    <g className={`quadrant-segment quadrant-${quadrantKey.toLowerCase()}`}>
      {/* Gradient definition - follows arc direction */}
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={center.x + radius * Math.cos(((startAngle - 90) * Math.PI) / 180)}
          y1={center.y + radius * Math.sin(((startAngle - 90) * Math.PI) / 180)}
          x2={center.x + radius * Math.cos(((effectiveEndAngle - 90) * Math.PI) / 180)}
          y2={center.y + radius * Math.sin(((effectiveEndAngle - 90) * Math.PI) / 180)}
        >
          <stop offset="0%" stopColor={quadrant.colorStart} />
          <stop offset="100%" stopColor={quadrant.colorEnd} />
        </linearGradient>

        {/* Glow filter for active quadrant */}
        {showGlow && (
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      {/* The arc path */}
      <path
        d={arcPath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{
          opacity: stateStyles.opacity,
          filter: stateStyles.filter,
          transition: 'opacity 0.5s ease, filter 0.3s ease'
        }}
      />
    </g>
  );
});

export default QuadrantSegment;
