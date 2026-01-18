import React from 'react';

/**
 * Accessible toggle switch component with proper ARIA attributes
 * Replaces inline toggle implementations throughout Configure.jsx
 */
function AccessibleToggle({
  enabled,
  onChange,
  label,
  description,
  size = 'default', // 'small' | 'default' | 'large'
  colorOn = 'bg-golden-400',
  colorOff = 'bg-slate-600',
  disabled = false,
  showLabel = false, // Show On/Off text for color-blind users
  className = ''
}) {
  const sizeClasses = {
    small: { track: 'w-10 h-6', thumb: 'w-4 h-4', translate: 'translate-x-5' },
    default: { track: 'w-12 h-7', thumb: 'w-5 h-5', translate: 'translate-x-6' },
    large: { track: 'w-14 h-8', thumb: 'w-6 h-6', translate: 'translate-x-7' }
  };

  const sizes = sizeClasses[size] || sizeClasses.default;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        aria-describedby={description ? `${label.replace(/\s+/g, '-').toLowerCase()}-desc` : undefined}
        disabled={disabled}
        onClick={() => !disabled && onChange(!enabled)}
        className={`
          relative ${sizes.track} rounded-full transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-golden-400 focus:ring-offset-slate-800
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${enabled ? colorOn : colorOff}
        `}
      >
        <span className="sr-only">{enabled ? 'Enabled' : 'Disabled'}</span>
        <div
          className={`
            absolute top-1 ${sizes.thumb} rounded-full bg-white shadow-md
            transition-transform duration-200 ease-in-out
            ${enabled ? sizes.translate : 'translate-x-1'}
          `}
          aria-hidden="true"
        />
      </button>

      {/* Visible On/Off label for color-blind users */}
      {showLabel && (
        <span className={`text-xs font-medium min-w-[24px] ${enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
          {enabled ? 'On' : 'Off'}
        </span>
      )}

      {/* Hidden description for screen readers */}
      {description && (
        <span id={`${label.replace(/\s+/g, '-').toLowerCase()}-desc`} className="sr-only">
          {description}
        </span>
      )}
    </div>
  );
}

export default AccessibleToggle;
