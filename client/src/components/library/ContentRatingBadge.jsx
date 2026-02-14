/**
 * ContentRatingBadge - Age/maturity rating badge
 *
 * Displays 18+, Graphic, or Mature badges based on story content intensity settings.
 * Returns null if content is considered safe/clean.
 */


// Rating thresholds and styling
const RATINGS = {
  adult: {
    label: '18+',
    bg: '#dc262622',
    text: '#dc2626',
    border: '#dc262644',
    priority: 1 // Highest priority
  },
  graphic: {
    label: 'Graphic',
    bg: '#ea580c22',
    text: '#ea580c',
    border: '#ea580c44',
    priority: 2
  },
  mature: {
    label: 'Mature',
    bg: '#f5970022',
    text: '#f59700',
    border: '#f5970044',
    priority: 3
  }
};

/**
 * Determine content rating based on config and intensity settings
 * @param {object} configJson - Story config_json containing intensity settings
 * @returns {object|null} Rating object or null if clean
 */
export function getContentRating(configJson) {
  if (!configJson) return null;

  const intensity = configJson.intensity || configJson.intensitySettings || {};
  const audience = configJson.audience;

  // Check for 18+ (adult content)
  const isMatureAudience = audience === 'mature';
  const hasHighAdultContent = (intensity.adultContent || 0) >= 50;
  const hasHighExplicitness = (intensity.explicitness || 0) >= 70;
  const hasHighSensuality = (intensity.sensuality || 0) >= 70;

  if (isMatureAudience || hasHighAdultContent || hasHighExplicitness || hasHighSensuality) {
    return RATINGS.adult;
  }

  // Check for Graphic (violence/gore without explicit adult content)
  const hasHighGore = (intensity.gore || 0) >= 60;
  const hasHighViolence = (intensity.violence || 0) >= 60;

  if (hasHighGore || hasHighViolence) {
    return RATINGS.graphic;
  }

  // Check for Mature (moderate intensity)
  const hasModerateAdultContent = (intensity.adultContent || 0) >= 30;
  const hasModerateSensuality = (intensity.sensuality || 0) >= 40;
  const hasModerateViolence = (intensity.violence || 0) >= 40;

  if (hasModerateAdultContent || hasModerateSensuality || hasModerateViolence) {
    return RATINGS.mature;
  }

  // Clean content - no badge needed
  return null;
}

export default function ContentRatingBadge({
  configJson,
  size = 'small',
  showBorder = true,
  className = ''
}) {
  const rating = getContentRating(configJson);

  // Don't render anything for clean content
  if (!rating) return null;

  const sizes = {
    small: { fontSize: '10px', padding: '2px 8px' },
    medium: { fontSize: '11px', padding: '3px 10px' },
    large: { fontSize: '12px', padding: '4px 12px' }
  };

  const sizeStyles = sizes[size] || sizes.small;

  return (
    <span
      className={`content-rating-badge ${className}`}
      style={{
        background: rating.bg,
        color: rating.text,
        border: showBorder ? `1px solid ${rating.border}` : 'none',
        borderRadius: '10px',
        fontWeight: '600',
        whiteSpace: 'nowrap',
        display: 'inline-block',
        ...sizeStyles
      }}
      title={getRatingTooltip(rating.label)}
    >
      {rating.label}
    </span>
  );
}

/**
 * Get tooltip description for rating
 */
function getRatingTooltip(label) {
  switch (label) {
    case '18+':
      return 'Contains explicit adult content';
    case 'Graphic':
      return 'Contains graphic violence or gore';
    case 'Mature':
      return 'Contains mature themes';
    default:
      return '';
  }
}

// Export ratings config for use elsewhere
export { RATINGS };
