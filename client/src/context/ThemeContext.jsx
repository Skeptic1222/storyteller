import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  READING_THEMES,
  APP_THEMES,
  MOOD_ACCENTS,
  TYPOGRAPHY,
  getMoodFromGenres
} from '../constants/themes';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'narrimo_theme_prefs';
const LEGACY_STORAGE_KEY = 'storyteller_theme_prefs';

// Default preferences
const DEFAULT_PREFS = {
  readingTheme: 'dark',
  appTheme: 'dark',
  fontSize: 16,
  fontFamily: 'serif',
  lineHeight: 1.6,
  mood: 'neutral',
  textLayout: 'vertical' // 'vertical' | 'horizontal' | 'modal'
};

/**
 * ThemeProvider - Provides unified theme management across all pages
 *
 * Features:
 * - Persists preferences to localStorage
 * - Syncs with API for authenticated users
 * - Provides reading themes (dark/sepia/light)
 * - Provides mood accents based on story genre
 * - Typography settings (font size, family, line height)
 */
export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(() => {
    // Load from localStorage on initial render
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
      }

      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const nextPrefs = { ...DEFAULT_PREFS, ...JSON.parse(legacy) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPrefs));
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return nextPrefs;
      }
    } catch (e) {
      console.warn('Failed to load theme preferences:', e);
    }
    return DEFAULT_PREFS;
  });

  // Persist to localStorage whenever prefs change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to save theme preferences:', e);
    }
  }, [prefs]);

  // Apply CSS custom properties for mood accent
  useEffect(() => {
    const mood = MOOD_ACCENTS[prefs.mood] || MOOD_ACCENTS.neutral;
    document.documentElement.style.setProperty('--mood-accent', mood.accent);
    document.documentElement.style.setProperty('--mood-glow', mood.glow);

    // Set data attribute for CSS targeting
    document.documentElement.setAttribute('data-mood', prefs.mood);
    document.documentElement.setAttribute('data-theme', prefs.appTheme);
  }, [prefs.mood, prefs.appTheme]);

  // Reading theme getter
  const readingTheme = READING_THEMES[prefs.readingTheme] || READING_THEMES.dark;

  // App theme getter
  const appTheme = APP_THEMES[prefs.appTheme] || APP_THEMES.dark;

  // Current mood accent
  const moodAccent = MOOD_ACCENTS[prefs.mood] || MOOD_ACCENTS.neutral;

  // Update reading theme
  const setReadingTheme = useCallback((themeId) => {
    if (READING_THEMES[themeId]) {
      setPrefs(prev => ({ ...prev, readingTheme: themeId }));
    }
  }, []);

  // Update app theme
  const setAppTheme = useCallback((themeId) => {
    if (APP_THEMES[themeId]) {
      setPrefs(prev => ({ ...prev, appTheme: themeId }));
    }
  }, []);

  // Update mood (can be auto-detected from genres)
  const setMood = useCallback((moodId) => {
    if (MOOD_ACCENTS[moodId]) {
      setPrefs(prev => ({ ...prev, mood: moodId }));
    }
  }, []);

  // Auto-detect mood from story genres
  const setMoodFromGenres = useCallback((genres) => {
    const detected = getMoodFromGenres(genres);
    setPrefs(prev => ({ ...prev, mood: detected.id }));
  }, []);

  // Typography setters
  const setFontSize = useCallback((size) => {
    const validSize = Math.min(Math.max(size, 12), 32);
    setPrefs(prev => ({ ...prev, fontSize: validSize }));
  }, []);

  const setFontFamily = useCallback((family) => {
    if (TYPOGRAPHY.fontFamilies[family]) {
      setPrefs(prev => ({ ...prev, fontFamily: family }));
    }
  }, []);

  const setLineHeight = useCallback((height) => {
    const validHeight = Math.min(Math.max(height, 1.2), 2.5);
    setPrefs(prev => ({ ...prev, lineHeight: validHeight }));
  }, []);

  // Text layout setter
  const setTextLayout = useCallback((layout) => {
    const validLayouts = ['vertical', 'horizontal', 'modal'];
    console.log('[ThemeContext] setTextLayout called with:', layout, '| valid:', validLayouts.includes(layout));
    if (validLayouts.includes(layout)) {
      setPrefs(prev => {
        console.log('[ThemeContext] Updating textLayout from', prev.textLayout, 'to', layout);
        return { ...prev, textLayout: layout };
      });
    }
  }, []);

  // Reset to defaults
  const resetPrefs = useCallback(() => {
    setPrefs(DEFAULT_PREFS);
  }, []);

  // Get computed typography styles for reader
  const getTypographyStyles = useCallback(() => {
    return {
      fontSize: `${prefs.fontSize}px`,
      fontFamily: TYPOGRAPHY.fontFamilies[prefs.fontFamily] || TYPOGRAPHY.fontFamilies.serif,
      lineHeight: prefs.lineHeight
    };
  }, [prefs.fontSize, prefs.fontFamily, prefs.lineHeight]);

  const value = {
    // Current values
    readingTheme,
    appTheme,
    moodAccent,
    fontSize: prefs.fontSize,
    fontFamily: prefs.fontFamily,
    lineHeight: prefs.lineHeight,
    mood: prefs.mood,
    textLayout: prefs.textLayout,

    // Raw IDs for persistence
    readingThemeId: prefs.readingTheme,
    appThemeId: prefs.appTheme,

    // Setters
    setReadingTheme,
    setAppTheme,
    setMood,
    setMoodFromGenres,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setTextLayout,
    resetPrefs,

    // Utilities
    getTypographyStyles,

    // Static references
    availableReadingThemes: Object.values(READING_THEMES),
    availableAppThemes: Object.values(APP_THEMES),
    availableMoods: Object.values(MOOD_ACCENTS),
    fontSizeOptions: TYPOGRAPHY.fontSizes,
    fontFamilyOptions: TYPOGRAPHY.fontFamilies,
    lineHeightOptions: TYPOGRAPHY.lineHeights
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Hook for reading-specific theme (used in Reader, Library)
 * Returns only reading-related values for cleaner component code
 */
export function useReadingTheme() {
  const { readingTheme, setReadingTheme, availableReadingThemes } = useTheme();
  return { theme: readingTheme, setTheme: setReadingTheme, themes: availableReadingThemes };
}

/**
 * Hook for typography settings
 */
export function useTypography() {
  const {
    fontSize,
    fontFamily,
    lineHeight,
    setFontSize,
    setFontFamily,
    setLineHeight,
    getTypographyStyles
  } = useTheme();

  return {
    fontSize,
    fontFamily,
    lineHeight,
    setFontSize,
    setFontFamily,
    setLineHeight,
    styles: getTypographyStyles()
  };
}

export default ThemeContext;
