/**
 * Client-side Logger Utility
 * Provides controlled logging that can be disabled in production
 *
 * Usage:
 *   import { log, warn, error, debug } from '../utils/logger';
 *   log('[Component] Message');
 *   debug('[Debug] Detailed info');  // Only in development
 */

// Check if in development mode
const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';

const DEBUG_STORAGE_KEY = 'narrimo_debug';
const LEGACY_DEBUG_STORAGE_KEY = 'storyteller_debug';

// Check for debug override in localStorage
const isDebugEnabled = () => {
  try {
    const enabled = localStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
    if (enabled) return true;

    const legacyEnabled = localStorage.getItem(LEGACY_DEBUG_STORAGE_KEY) === 'true';
    if (legacyEnabled) {
      localStorage.setItem(DEBUG_STORAGE_KEY, 'true');
      localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * Standard log - shows in development or when debug enabled
 */
export const log = (...args) => {
  if (isDev || isDebugEnabled()) {
    console.log(...args);
  }
};

/**
 * Warning log - always shows
 */
export const warn = (...args) => {
  console.warn(...args);
};

/**
 * Error log - always shows
 */
export const error = (...args) => {
  console.error(...args);
};

/**
 * Debug log - only in development or when explicitly enabled
 */
export const debug = (...args) => {
  if (isDev || isDebugEnabled()) {
    console.debug('[DEBUG]', ...args);
  }
};

/**
 * Performance timing log
 */
export const perf = (label, startTime) => {
  if (isDev || isDebugEnabled()) {
    const duration = Date.now() - startTime;
    console.log(`[PERF] ${label}: ${duration}ms`);
  }
};

/**
 * Group logs (collapsible in console)
 */
export const group = (label, fn) => {
  if (isDev || isDebugEnabled()) {
    console.groupCollapsed(label);
    fn();
    console.groupEnd();
  }
};

/**
 * Enable/disable debug logging at runtime
 */
export const setDebugEnabled = (enabled) => {
  try {
    if (enabled) {
      localStorage.setItem(DEBUG_STORAGE_KEY, 'true');
      localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY);
      console.log('[Logger] Debug mode ENABLED - refresh to apply');
    } else {
      localStorage.removeItem(DEBUG_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY);
      console.log('[Logger] Debug mode DISABLED - refresh to apply');
    }
  } catch (e) {
    console.warn('[Logger] Could not set debug state:', e);
  }
};

// Expose debug toggle in browser console for easy access
if (typeof window !== 'undefined') {
  window.narrimoDebug = setDebugEnabled;
  window.storytellerDebug = setDebugEnabled;
}

export default { log, warn, error, debug, perf, group, setDebugEnabled };
