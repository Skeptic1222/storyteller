/**
 * MilestoneBadge Component
 * Enhanced badge positioned on the circular progress ring at milestone points
 *
 * Features:
 * - Larger 48px badges (increased from 32px)
 * - Five states: pending, approaching, active, filling, complete
 * - Fill animation with clip-path when stage completes
 * - Quadrant-specific gradient colors
 * - Glow effects and scale bounce on completion
 */

import { memo, useMemo, useState, useEffect } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { QUADRANT_COLORS } from './QuadrantSegment';

// Get quadrant from angle (0-360)
const getQuadrantFromAngle = (angle) => {
  if (angle < 90) return 'Q1';
  if (angle < 180) return 'Q2';
  if (angle < 270) return 'Q3';
  return 'Q4';
};

// Status to state mapping
const STATUS_TO_STATE = {
  pending: 'pending',
  in_progress: 'active',
  success: 'complete',
  error: 'error'
};

// State-based styles using Narrimo quadrant colors
// Returns both CSS classes and inline styles (for dynamic colors)
const getStateStyles = (state, quadrantKey) => {
  const quadrant = QUADRANT_COLORS[quadrantKey] || QUADRANT_COLORS.Q1;

  const baseStyles = {
    pending: {
      border: 'border-transparent',
      text: 'text-slate-500',
      labelText: 'text-slate-600',
      shadow: '',
      glow: false,
      bgStyle: { background: '#1e293b' }
    },
    approaching: {
      border: 'border-transparent',
      text: 'text-slate-300',
      labelText: 'text-slate-400',
      shadow: '',
      glow: false,
      bgStyle: { background: '#334155' }
    },
    active: {
      border: 'border-white/50',
      text: 'text-white',
      labelText: 'text-white/80',
      shadow: 'shadow-lg',
      glow: true,
      animate: true,
      bgStyle: { background: `linear-gradient(135deg, ${quadrant.colorStart}, ${quadrant.colorEnd})` }
    },
    filling: {
      border: 'border-white',
      text: 'text-white',
      labelText: 'text-white',
      shadow: 'shadow-xl',
      glow: true,
      bgStyle: { background: `linear-gradient(135deg, ${quadrant.colorStart}, ${quadrant.colorEnd})` }
    },
    complete: {
      border: 'border-emerald-300',
      text: 'text-white',
      labelText: 'text-emerald-400',
      shadow: 'shadow-lg shadow-emerald-500/40',
      glow: false,
      bgStyle: { background: 'linear-gradient(135deg, #34d399, #059669)' }
    },
    error: {
      border: 'border-red-300',
      text: 'text-white',
      labelText: 'text-red-400',
      shadow: 'shadow-lg shadow-red-500/40',
      glow: false,
      bgStyle: { background: 'linear-gradient(135deg, #f87171, #dc2626)' }
    }
  };

  return baseStyles[state] || baseStyles.pending;
};

const MilestoneBadge = memo(function MilestoneBadge({
  status = 'pending',          // 'pending', 'in_progress', 'success', 'error'
  label = '',
  activeLabel = '',
  completeLabel = '',
  icon: CustomIcon = null,
  size = 48,                   // Increased from 32px
  position = { x: 0, y: 0 },
  angle = 0,                   // Angle on the circle (0-360) for quadrant color
  showLabel = true,
  approachingThreshold = 15,   // % before badge to start approaching animation
  currentProgress = 0,         // Current progress % for approaching state
  badgeProgress = 0            // Progress % where this badge is positioned
}) {
  // Track filling animation state
  const [isFilling, setIsFilling] = useState(false);
  const [wasActive, setWasActive] = useState(false);
  const [showBounce, setShowBounce] = useState(false);

  // Determine quadrant from angle
  const quadrantKey = useMemo(() => getQuadrantFromAngle(angle), [angle]);
  const quadrant = QUADRANT_COLORS[quadrantKey] || QUADRANT_COLORS.Q1;

  // Determine if we're approaching this badge
  const isApproaching = useMemo(() => {
    if (status !== 'pending') return false;
    const distanceToGo = badgeProgress - currentProgress;
    return distanceToGo > 0 && distanceToGo <= approachingThreshold;
  }, [status, badgeProgress, currentProgress, approachingThreshold]);

  // Determine effective state
  const effectiveState = useMemo(() => {
    if (isFilling) return 'filling';
    if (status === 'success') return 'complete';
    if (status === 'error') return 'error';
    if (status === 'in_progress') return 'active';
    if (isApproaching) return 'approaching';
    return 'pending';
  }, [status, isFilling, isApproaching]);

  // Handle fill animation when transitioning from active to complete
  useEffect(() => {
    let fillTimeout, bounceTimeout;
    if (status === 'in_progress') {
      setWasActive(true);
    } else if (status === 'success' && wasActive) {
      // Trigger filling animation
      setIsFilling(true);
      fillTimeout = setTimeout(() => {
        setIsFilling(false);
        setShowBounce(true);
        bounceTimeout = setTimeout(() => setShowBounce(false), 500);
      }, 600); // Match the fill animation duration
    }
    return () => {
      clearTimeout(fillTimeout);
      clearTimeout(bounceTimeout);
    };
  }, [status, wasActive]);

  const style = getStateStyles(effectiveState, quadrantKey);
  const IconComponent = effectiveState === 'pending' || effectiveState === 'approaching'
    ? CustomIcon
    : effectiveState === 'complete'
      ? Check
      : effectiveState === 'error'
        ? X
        : effectiveState === 'active' || effectiveState === 'filling'
          ? Loader2
          : CustomIcon;

  // Determine which label to show based on status
  const displayLabel = useMemo(() => {
    if (effectiveState === 'active' && activeLabel) return activeLabel;
    if (effectiveState === 'filling' && completeLabel) return completeLabel;
    if (effectiveState === 'complete' && completeLabel) return completeLabel;
    return label;
  }, [effectiveState, label, activeLabel, completeLabel]);

  // Calculate label position - simple positioning directly below/beside badge
  // For mobile, labels are kept very close to avoid going off-screen
  const labelStyle = useMemo(() => {
    const normalizedAngle = ((angle % 360) + 360) % 360;

    // Simple offset: position label just below or beside the badge
    // Use minimal offsets to stay within bounds
    const smallOffset = size * 0.6;

    let offsetX = 0;
    let offsetY = smallOffset; // Default: below badge
    let textAlign = 'center';
    let translateX = '-50%';

    // Top badges (315-45°): label below
    if (normalizedAngle >= 315 || normalizedAngle < 45) {
      offsetY = smallOffset;
      textAlign = 'center';
    }
    // Right badges (45-135°): label to the left
    else if (normalizedAngle >= 45 && normalizedAngle < 135) {
      offsetX = -smallOffset;
      offsetY = 0;
      textAlign = 'right';
      translateX = '-100%';
    }
    // Bottom badges (135-225°): label above
    else if (normalizedAngle >= 135 && normalizedAngle < 225) {
      offsetY = -smallOffset;
      textAlign = 'center';
    }
    // Left badges (225-315°): label to the right
    else {
      offsetX = smallOffset;
      offsetY = 0;
      textAlign = 'left';
      translateX = '0%';
    }

    return {
      position: 'absolute',
      left: position.x + offsetX,
      top: position.y + offsetY,
      transform: `translate(${translateX}, -50%)`,
      textAlign,
      whiteSpace: 'nowrap',
      fontSize: '0.6rem',
      maxWidth: '60px',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    };
  }, [position, size, angle]);

  return (
    <>
      {/* Badge circle */}
      <div
        className="absolute transform -translate-x-1/2 -translate-y-1/2"
        style={{
          left: position.x,
          top: position.y,
          zIndex: effectiveState === 'active' || effectiveState === 'filling' ? 30 : 10
        }}
      >
        {/* Glow ring for active/filling states */}
        {style.glow && (
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              background: `linear-gradient(135deg, ${quadrant.colorStart}, ${quadrant.colorEnd})`,
              opacity: 0.3,
              transform: 'scale(1.3)'
            }}
          />
        )}

        {/* Approaching pulse ring */}
        {effectiveState === 'approaching' && (
          <div
            className="absolute inset-0 rounded-full border-2 border-slate-400/50 animate-pulse"
            style={{ transform: 'scale(1.2)' }}
          />
        )}

        {/* Main badge */}
        <div
          className={`
            relative flex items-center justify-center rounded-full border-2
            ${style.border} ${style.shadow}
            ${effectiveState === 'active' ? 'animate-pulse' : ''}
            ${showBounce ? 'animate-bounce' : ''}
            transition-all duration-300
          `}
          style={{
            width: size,
            height: size,
            ...style.bgStyle,
            transform: showBounce ? 'scale(1.15)' : 'scale(1)',
            boxShadow: style.glow
              ? `0 0 20px ${quadrant.colorStart}80, 0 0 40px ${quadrant.colorStart}40`
              : undefined
          }}
        >
          {/* Fill animation overlay */}
          {isFilling && (
            <div
              className="absolute inset-0 rounded-full overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, #34d399, #059669)',
                animation: 'badgeFill 0.6s ease-out forwards'
              }}
            />
          )}

          {/* Icon */}
          {IconComponent && (
            <IconComponent
              className={`${style.text} relative z-10 ${effectiveState === 'active' ? 'animate-spin' : ''}`}
              size={size * 0.45}
              strokeWidth={2.5}
            />
          )}
        </div>
      </div>

      {/* Label - positioned outside the badge */}
      {showLabel && displayLabel && (
        <div
          className={`
            absolute text-xs font-semibold whitespace-nowrap
            ${style.labelText}
            ${effectiveState === 'active' ? 'animate-pulse' : ''}
            pointer-events-none transition-colors duration-300
          `}
          style={labelStyle}
        >
          {displayLabel}
        </div>
      )}

    </>
  );
});

export default MilestoneBadge;
