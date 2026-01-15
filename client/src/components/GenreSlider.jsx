import { useState, useEffect, useRef } from 'react';

function GenreSlider({
  label,
  icon,
  value,
  onChange,
  max = 100,
  colorClass = 'from-slate-500 to-golden-400',
  threshold = null,  // Optional threshold marker (e.g., { value: 61, label: 'Venice.ai', icon: '🔓' })
  showProvider = false,  // Show which provider will be used
  animating = false,  // If true, slider is being auto-configured
  autoSelected = false  // If true, this value was set by AI
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef(null);
  const prevValueRef = useRef(value);

  // Animate value changes when auto-configuring
  useEffect(() => {
    if (animating && value !== prevValueRef.current) {
      // Cancel any ongoing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const startValue = displayValue;
      const targetValue = value;
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
      prevValueRef.current = value;
    } else if (!animating) {
      // When not animating, immediately sync display value
      setDisplayValue(value);
      prevValueRef.current = value;
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, animating]);

  const isAboveThreshold = threshold && displayValue >= threshold.value;
  const thresholdPercent = threshold ? (threshold.value / max) * 100 : 0;

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
    return colorClass;
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
        className="relative"
        onMouseEnter={() => threshold && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* Background track */}
        <div className={`h-2 bg-slate-700 rounded-full overflow-hidden relative ${
          isAnimating ? 'ring-2 ring-golden-400/50 ring-offset-1 ring-offset-slate-900' : ''
        }`}>
          {/* Threshold zone indicator (shows uncensored zone) */}
          {threshold && (
            <div
              className="absolute h-full bg-purple-600/20 right-0"
              style={{
                left: `${thresholdPercent}%`,
                width: `${100 - thresholdPercent}%`
              }}
            />
          )}

          {/* Value fill */}
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

        {/* Threshold marker line */}
        {threshold && (
          <div
            className="absolute top-0 h-2 w-0.5 bg-purple-400/60"
            style={{ left: `${thresholdPercent}%` }}
          />
        )}

        {/* Invisible range input - disabled during animation */}
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
          className={`absolute inset-0 w-full h-full opacity-0 ${
            isAnimating ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
        />

        {/* Tooltip */}
        {showTooltip && threshold && (
          <div
            className="absolute -top-10 transform -translate-x-1/2 px-2 py-1 bg-slate-800 border border-purple-500/30 rounded text-xs text-purple-300 whitespace-nowrap z-20"
            style={{ left: `${thresholdPercent}%` }}
          >
            {threshold.value}%+ = {threshold.label}
          </div>
        )}
      </div>

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
    </div>
  );
}

export default GenreSlider;
