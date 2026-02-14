/**
 * GenreBadge - Colored badge for genre/theme tags
 *
 * Color scheme based on genre type for visual distinction
 */


// Genre color mapping - background uses 20% opacity version of text color
const GENRE_COLORS = {
  // Primary genres
  fantasy: { bg: '#a855f720', text: '#a855f7', border: '#a855f740' },
  horror: { bg: '#dc262620', text: '#dc2626', border: '#dc262640' },
  romance: { bg: '#ec489920', text: '#ec4899', border: '#ec489940' },
  'sci-fi': { bg: '#06b6d420', text: '#06b6d4', border: '#06b6d440' },
  scifi: { bg: '#06b6d420', text: '#06b6d4', border: '#06b6d440' },
  'science fiction': { bg: '#06b6d420', text: '#06b6d4', border: '#06b6d440' },
  mystery: { bg: '#8b5cf620', text: '#8b5cf6', border: '#8b5cf640' },
  adventure: { bg: '#f59e0b20', text: '#f59e0b', border: '#f59e0b40' },
  thriller: { bg: '#ef444420', text: '#ef4444', border: '#ef444440' },
  drama: { bg: '#84748b20', text: '#8b748b', border: '#8b748b40' },
  comedy: { bg: '#22c55e20', text: '#22c55e', border: '#22c55e40' },

  // Secondary/sub-genres
  action: { bg: '#f9731620', text: '#f97316', border: '#f9731640' },
  suspense: { bg: '#ef444420', text: '#ef4444', border: '#ef444440' },
  historical: { bg: '#92400e20', text: '#b45309', border: '#92400e40' },
  literary: { bg: '#71717a20', text: '#a1a1aa', border: '#71717a40' },
  dystopian: { bg: '#52525b20', text: '#71717a', border: '#52525b40' },
  supernatural: { bg: '#7c3aed20', text: '#8b5cf6', border: '#7c3aed40' },
  paranormal: { bg: '#7c3aed20', text: '#8b5cf6', border: '#7c3aed40' },
  urban: { bg: '#64748b20', text: '#94a3b8', border: '#64748b40' },
  western: { bg: '#a16207', text: '#ca8a04', border: '#a1620740' },
  noir: { bg: '#1f293720', text: '#475569', border: '#1f293740' },
  satire: { bg: '#84cc1620', text: '#84cc16', border: '#84cc1640' },

  // Thematic elements (often used as secondary tags)
  dark: { bg: '#1e293b20', text: '#64748b', border: '#1e293b40' },
  epic: { bg: '#7c3aed20', text: '#a78bfa', border: '#7c3aed40' },
  psychological: { bg: '#6366f120', text: '#818cf8', border: '#6366f140' },
  romantic: { bg: '#ec489920', text: '#ec4899', border: '#ec489940' },
  erotic: { bg: '#be185d20', text: '#db2777', border: '#be185d40' },
  violent: { bg: '#b9171720', text: '#dc2626', border: '#b9171740' },
  gothic: { bg: '#44403c20', text: '#78716c', border: '#44403c40' },

  // Default fallback
  default: { bg: '#6366f120', text: '#6366f1', border: '#6366f140' }
};

/**
 * Get color scheme for a genre, matching against known genres
 * Performs case-insensitive partial matching
 */
function getGenreColors(genre) {
  const normalized = genre.toLowerCase().trim();

  // Direct match first
  if (GENRE_COLORS[normalized]) {
    return GENRE_COLORS[normalized];
  }

  // Partial match (e.g., "dark fantasy" matches "dark" then "fantasy")
  for (const [key, colors] of Object.entries(GENRE_COLORS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return colors;
    }
  }

  return GENRE_COLORS.default;
}

export default function GenreBadge({ genre, size = 'small', className = '' }) {
  const colors = getGenreColors(genre);

  const sizes = {
    small: { fontSize: '10px', padding: '2px 8px' },
    medium: { fontSize: '11px', padding: '3px 10px' },
    large: { fontSize: '12px', padding: '4px 12px' }
  };

  const sizeStyles = sizes[size] || sizes.small;

  return (
    <span
      className={`genre-badge ${className}`}
      style={{
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: '12px',
        fontWeight: '500',
        whiteSpace: 'nowrap',
        display: 'inline-block',
        ...sizeStyles
      }}
    >
      {genre}
    </span>
  );
}

// Export color mapping for use in other components
export { GENRE_COLORS, getGenreColors };
