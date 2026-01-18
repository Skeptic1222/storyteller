/**
 * CircularGauge Component
 * SVG-based circular progress gauge with animated fill, glow effects, and center text.
 *
 * Design: Mission Control aesthetic with golden gradient stroke and ambient glow.
 *
 * Features:
 * - Smooth stroke-dashoffset animation
 * - Gradient stroke (golden-400 -> amber-500 -> orange-500)
 * - Glow effect behind active portion
 * - Pulsing leading edge
 * - Center text for percentage and ETA
 */

import { memo, useMemo } from 'react';

const CircularGauge = memo(function CircularGauge({
  percent = 0,
  size = 200,
  strokeWidth = 12,
  label = '',
  sublabel = '',
  showPercent = true,
  glowColor = 'rgba(251, 191, 36, 0.4)',
  className = ''
}) {
  // Calculate SVG parameters
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * Math.min(percent, 100) / 100);

  // Unique ID for gradients (avoid conflicts with multiple gauges)
  const gradientId = useMemo(() => `gauge-gradient-${Math.random().toString(36).substr(2, 9)}`, []);
  const glowId = useMemo(() => `gauge-glow-${Math.random().toString(36).substr(2, 9)}`, []);

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      {/* Ambient glow behind gauge */}
      <div
        className="absolute inset-0 rounded-full blur-xl transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
          opacity: percent > 0 ? 0.6 : 0
        }}
      />

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" /> {/* golden-400 */}
            <stop offset="50%" stopColor="#f59e0b" /> {/* amber-500 */}
            <stop offset="100%" stopColor="#f97316" /> {/* orange-500 */}
          </linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-700/50"
        />

        {/* Inner track with subtle gradient */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth - 4}
          className="text-slate-800"
        />

        {/* Progress ring with gradient and glow */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          filter={`url(#${glowId})`}
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        />

        {/* Pulsing leading edge indicator */}
        {percent > 0 && percent < 100 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="white"
            strokeWidth={strokeWidth / 2}
            strokeLinecap="round"
            strokeDasharray={`${strokeWidth / 2} ${circumference}`}
            strokeDashoffset={strokeDashoffset - (strokeWidth / 4)}
            className="animate-pulse opacity-60"
            style={{
              transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />
        )}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center transform">
        {showPercent && (
          <span
            className="font-bold text-white transition-all duration-300"
            style={{ fontSize: size * 0.2 }}
          >
            {Math.round(percent)}%
          </span>
        )}
        {label && (
          <span
            className="text-slate-400 font-medium text-center px-2 leading-tight"
            style={{ fontSize: Math.max(10, size * 0.065) }}
          >
            {label}
          </span>
        )}
        {sublabel && (
          <span
            className="text-golden-400/70 text-center px-2"
            style={{ fontSize: Math.max(9, size * 0.055) }}
          >
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
});

export default CircularGauge;
