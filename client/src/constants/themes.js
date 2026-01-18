/**
 * Unified Theme Definitions
 *
 * Consolidated from Library.jsx and Reader.jsx
 * Provides consistent theming across all pages
 */

// Reading themes - used for Library, Reader, and immersive reading experiences
export const READING_THEMES = {
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: '#0A2342',
    card: '#132d4f',
    text: '#F7F4E9',
    textMuted: '#9aa7a3',
    accent: '#FF6F61',
    border: '#1f3a5c',
    highlight: '#FF6F611f'
  },
  sepia: {
    id: 'sepia',
    name: 'Sepia',
    bg: '#f4ecd8',
    card: '#ebe3d0',
    text: '#5c4b37',
    textMuted: '#8b7355',
    accent: '#8b5e3c',
    border: '#d4c9b0',
    highlight: '#8b5e3c33'
  },
  light: {
    id: 'light',
    name: 'Light',
    bg: '#ffffff',
    card: '#f5f5f5',
    text: '#1a1a1a',
    textMuted: '#666',
    accent: '#4f46e5',
    border: '#e5e5e5',
    highlight: '#4f46e533'
  }
};

// New neutral slate palette - replaces night-* for a less "bedtime" feel
export const SLATE_PALETTE = {
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
  950: '#020617'
};

// Genre mood accents - dynamically applied based on story content
export const MOOD_ACCENTS = {
  neutral: {
    id: 'neutral',
    name: 'Neutral',
    accent: '#6366f1',  // Indigo - default
    glow: '#6366f140'
  },
  fantasy: {
    id: 'fantasy',
    name: 'Fantasy',
    accent: '#a855f7',  // Purple
    glow: '#a855f740'
  },
  horror: {
    id: 'horror',
    name: 'Horror',
    accent: '#dc2626',  // Red
    glow: '#dc262640'
  },
  romance: {
    id: 'romance',
    name: 'Romance',
    accent: '#ec4899',  // Pink
    glow: '#ec489940'
  },
  scifi: {
    id: 'scifi',
    name: 'Sci-Fi',
    accent: '#06b6d4',  // Cyan
    glow: '#06b6d440'
  },
  mystery: {
    id: 'mystery',
    name: 'Mystery',
    accent: '#8b5cf6',  // Violet
    glow: '#8b5cf640'
  },
  adventure: {
    id: 'adventure',
    name: 'Adventure',
    accent: '#f59e0b',  // Amber
    glow: '#f59e0b40'
  }
};

// App-wide themes (for navigation, settings, etc.)
export const APP_THEMES = {
  dark: {
    id: 'dark',
    name: 'Dark',
    // Tailwind classes for easy usage
    bgClass: 'bg-narrimo-midnight',
    cardClass: 'bg-[#132d4f]',
    textClass: 'text-narrimo-cream',
    mutedClass: 'text-[#9aa7a3]',
    borderClass: 'border-[#1f3a5c]',
    // CSS custom properties
    cssVars: {
      '--app-bg': '#0A2342',
      '--app-card': '#132d4f',
      '--app-text': '#F7F4E9',
      '--app-muted': '#9aa7a3',
      '--app-border': '#1f3a5c'
    }
  },
  light: {
    id: 'light',
    name: 'Light',
    bgClass: 'bg-slate-50',
    cardClass: 'bg-white',
    textClass: 'text-slate-900',
    mutedClass: 'text-slate-500',
    borderClass: 'border-slate-200',
    cssVars: {
      '--app-bg': SLATE_PALETTE[50],
      '--app-card': '#ffffff',
      '--app-text': SLATE_PALETTE[900],
      '--app-muted': SLATE_PALETTE[500],
      '--app-border': SLATE_PALETTE[200]
    }
  }
};

// Typography settings for reader
export const TYPOGRAPHY = {
  fontSizes: {
    small: 14,
    medium: 16,
    large: 18,
    xlarge: 20,
    xxlarge: 24
  },
  fontFamilies: {
    serif: "'Merriweather', 'Georgia', serif",
    sansSerif: "'Inter', 'Segoe UI', sans-serif",
    mono: "'Fira Code', 'Consolas', monospace"
  },
  lineHeights: {
    compact: 1.4,
    normal: 1.6,
    relaxed: 1.8,
    loose: 2.0
  }
};

/**
 * Get mood accent based on story genres
 * Auto-detects appropriate mood from genre mix
 */
export function getMoodFromGenres(genres = {}) {
  if (!genres || typeof genres !== 'object') {
    return MOOD_ACCENTS.neutral;
  }

  // Find the dominant genre
  const sortedGenres = Object.entries(genres)
    .filter(([, value]) => value > 0)
    .sort(([, a], [, b]) => b - a);

  if (sortedGenres.length === 0) {
    return MOOD_ACCENTS.neutral;
  }

  const [dominantGenre] = sortedGenres[0];

  // Map genre to mood
  const genreToMood = {
    fantasy: 'fantasy',
    fairytale: 'fantasy',
    horror: 'horror',
    romance: 'romance',
    scifi: 'scifi',
    mystery: 'mystery',
    adventure: 'adventure'
  };

  const moodId = genreToMood[dominantGenre] || 'neutral';
  return MOOD_ACCENTS[moodId];
}

/**
 * Get reading theme by ID
 */
export function getReadingTheme(themeId) {
  return READING_THEMES[themeId] || READING_THEMES.dark;
}

/**
 * Get app theme by ID
 */
export function getAppTheme(themeId) {
  return APP_THEMES[themeId] || APP_THEMES.dark;
}

// Default exports for backward compatibility
export const THEMES = READING_THEMES;

export default {
  READING_THEMES,
  SLATE_PALETTE,
  MOOD_ACCENTS,
  APP_THEMES,
  TYPOGRAPHY,
  getMoodFromGenres,
  getReadingTheme,
  getAppTheme
};
