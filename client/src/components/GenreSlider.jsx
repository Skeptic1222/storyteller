import { useState, useEffect, useRef, useMemo } from 'react';
import { getSliderColor, getSliderMessage } from '../constants/sliderMessages';

function GenreSlider({
  label,
  icon,
  value,
  onChange,
  max = 100,
  colorClass = 'from-slate-500 to-golden-400',
  sliderType = null,  // Slider type for dynamic colors/messages (violence, gore, etc.)
  threshold = null,  // Optional threshold marker (e.g., { value: 61, label: 'Venice.ai', icon: '🔓' })
  showProvider = false,  // Show which provider will be used
  animating = false,  // If true, slider is being auto-configured
  autoSelected = false,  // If true, this value was set by AI
  description = null  // Optional description shown below the slider
}) {
  // Ensure value is always a number (fix for undefined displayValue bug)
  const safeValue = value ?? 0;

  const [showTooltip, setShowTooltip] = useState(false);
  const [displayValue, setDisplayValue] = useState(safeValue);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef(null);
  const prevValueRef = useRef(safeValue);
  // Track displayValue in a ref to avoid stale closures in animation callbacks
  const displayValueRef = useRef(safeValue);

  // Keep displayValueRef in sync with displayValue state
  useEffect(() => {
    displayValueRef.current = displayValue;
  }, [displayValue]);

  // Animate value changes when auto-configuring
  useEffect(() => {
    if (animating && safeValue !== prevValueRef.current) {
      // Cancel any ongoing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      // Use ref to get current displayValue (avoids stale closure)
      const startValue = displayValueRef.current;
      const targetValue = safeValue;
      const duration = 800; // ms
      const startTime = Date.now();

      setIsAnimating(true);

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out-cubic)
        const eased = 1 - Math.pow(1 - progress, 3);

        const currentValue = Math.round(startValue + (targetValue - startValue) * eased);
        setDisplayValue(currentValue);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setIsAnimating(false);
          setDisplayValue(targetValue);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
      prevValueRef.current = safeValue;
    } else if (!animating) {
      // When not animating, immediately sync display value
      setDisplayValue(safeValue);
      prevValueRef.current = safeValue;
    }
    // IMPORTANT: Always ensure displayValue is synced when animating but value hasn't changed
    // This fixes the case where component mounts with animating=true but value matches prevRef
    else if (animating && safeValue === prevValueRef.current && displayValue !== safeValue) {
      setDisplayValue(safeValue);
      setIsAnimating(false);  // No animation needed, ensure slider is usable
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  // Note: displayValue intentionally excluded - tracked via displayValueRef to prevent
  // animation cancellation race condition (effect re-running would cancel animation frame)
  }, [safeValue, animating]);

  // Safety effect: ensure isAnimating resets when parent animation completes
  // This handles edge cases where the animation loop doesn't complete naturally
  useEffect(() => {
    if (!animating) {
      setIsAnimating(false);
    }
  }, [animating]);

  const isAboveThreshold = threshold && displayValue >= threshold.value;
  const thresholdPercent = threshold ? (threshold.value / max) * 100 : 0;

  // Get dynamic color and message based on slider type and value
  // Use useMemo with a seed based on value tier for consistent message within tier
  const { dynamicColor, dynamicMessage, tierLabel } = useMemo(() => {
    if (!sliderType) {
      return { dynamicColor: null, dynamicMessage: null, tierLabel: null };
    }
    const color = getSliderColor(sliderType, displayValue);
    // Use the tier's max value as seed for consistent message within each tier
    const tierSeed = color.label ? color.label.charCodeAt(0) : 0;
    const message = getSliderMessage(sliderType, displayValue, tierSeed);
    return {
      dynamicColor: color.gradient,
      dynamicMessage: message,
      tierLabel: color.label
    };
  }, [sliderType, displayValue]);

  // Determine slider state styling
  const getSliderGradient = () => {
    if (isAnimating) {
      return 'from-golden-300 to-golden-500'; // Golden glow during animation
    }
    if (autoSelected) {
      return 'from-golden-400/80 to-amber-500'; // Subtle golden tint for AI-set values
    }
    if (isAboveThreshold) {
      return 'from-purple-400 to-purple-600';
    }
    // Use dynamic color if available, otherwise fall back to colorClass
    return dynamicColor || colorClass;
  };

  return (
    <div className={`space-y-2 transition-all duration-300 ${isAnimating ? 'scale-[1.02]' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={isAnimating ? 'animate-bounce' : ''}>{icon}</span>
          <span className="text-slate-200">{label}</span>
          {/* Provider badge when above threshold */}
          {isAboveThreshold && showProvider && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse">
              {threshold.icon} {threshold.label}
            </span>
          )}
          {/* AI indicator when auto-selected */}
          {autoSelected && !isAnimating && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-golden-400/20 text-golden-400 border border-golden-400/30">
              AI
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Tier label badge when using dynamic colors */}
          {tierLabel && !isAnimating && !autoSelected && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full bg-slate-700/50 transition-colors duration-300`}
              style={{
                color: displayValue >= 70 ? '#ef4444' : displayValue >= 40 ? '#f59e0b' : '#22c55e'
              }}
            >
              {tierLabel}
            </span>
          )}
          <span className={`text-sm transition-all ${
            isAnimating
              ? 'text-golden-400 font-medium animate-pulse'
              : 'text-slate-400'
          }`}>
            {displayValue}%
          </span>
          {isAboveThreshold && !showProvider && (
            <span className="text-xs text-purple-400">{threshold.icon}</span>
          )}
        </div>
      </div>
      <div
        className="relative h-6 flex items-center"
        onMouseEnter={() => threshold && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* Background track - darker for contrast */}
        <div className={`absolute left-0 right-0 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-600 ${
          isAnimating ? 'ring-2 ring-golden-400/50 ring-offset-1 ring-offset-slate-900' : ''
        }`}>
          {/* Threshold zone indicator (shows uncensored zone) */}
          {threshold && (
            <div
              className="absolute h-full bg-purple-600/30 right-0"
              style={{
                left: `${thresholdPercent}%`,
                width: `${100 - thresholdPercent}%`
              }}
            />
          )}

          {/* Value fill - brighter colors for contrast */}
          <div
            className={`h-full bg-gradient-to-r ${getSliderGradient()} rounded-full relative z-10 ${
              isAnimating ? '' : 'transition-all duration-150'
            }`}
            style={{ width: `${(displayValue / max) * 100}%` }}
          />

          {/* Animation shimmer effect */}
          {isAnimating && (
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
              style={{ animationDuration: '1s' }}
            />
          )}
        </div>

        {/* Visible thumb indicator - larger and more prominent */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full shadow-lg border-2 z-20 ${
            isAnimating
              ? 'bg-golden-400 border-golden-300 shadow-golden-400/50 animate-pulse'
              : isAboveThreshold
                ? 'bg-purple-400 border-purple-300 shadow-purple-400/50'
                : 'bg-white border-slate-400 shadow-black/30'
          } transition-all duration-150 pointer-events-none`}
          style={{ left: `${(displayValue / max) * 100}%` }}
        />

        {/* Threshold marker line */}
        {threshold && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-4 w-0.5 bg-purple-400/80 z-15"
            style={{ left: `${thresholdPercent}%` }}
          />
        )}

        {/* Range input - full height for easy clicking */}
        <input
          type="range"
          min="0"
          max={max}
          value={displayValue}
          onChange={(e) => {
            if (!isAnimating) {
              onChange(parseInt(e.target.value));
            }
          }}
          disabled={isAnimating}
          className={`absolute inset-0 w-full opacity-0 z-30 ${
            isAnimating ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
          style={{ height: '24px' }}
        />

        {/* Tooltip */}
        {showTooltip && threshold && (
          <div
            className="absolute -top-10 transform -translate-x-1/2 px-2 py-1 bg-slate-800 border border-purple-500/30 rounded text-xs text-purple-300 whitespace-nowrap z-40"
            style={{ left: `${thresholdPercent}%` }}
          >
            {threshold.value}%+ = {threshold.label}
          </div>
        )}
      </div>

      {/* Dynamic contextual message based on slider value */}
      {dynamicMessage && !isAnimating && (
        <p className={`text-xs italic transition-all duration-300 ${
          displayValue >= 70 ? 'text-red-400/80' :
          displayValue >= 40 ? 'text-amber-400/80' :
          'text-slate-400/80'
        }`}>
          "{dynamicMessage}"
        </p>
      )}

      {/* Threshold description (shown when near or above threshold) */}
      {threshold && displayValue >= threshold.value - 10 && (
        <p className={`text-xs transition-all ${
          isAboveThreshold
            ? 'text-purple-400'
            : 'text-slate-500'
        }`}>
          {isAboveThreshold
            ? `🔓 Uncensored AI enabled for graphic content`
            : `${threshold.value - displayValue}% more to enable uncensored AI`
          }
        </p>
      )}

      {/* Optional description text (only if no dynamic message) */}
      {description && !threshold && !dynamicMessage && (
        <p className="text-xs text-slate-500">{description}</p>
      )}
    </div>
  );
}

export default GenreSlider;
