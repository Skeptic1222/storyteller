/**
 * User-Scoped localStorage Utility
 *
 * Prevents preference leakage between users sharing the same browser.
 * Extracts user ID from the stored JWT to scope preference keys.
 * The auth token itself remains unscoped (it IS the identity).
 */

const TOKEN_KEY = 'narrimo_token';

/**
 * Extract user ID from stored JWT token (synchronous).
 * Returns null if no token or token is unparseable.
 */
export function getCurrentUserId() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload.sub || payload.id || null;
  } catch {
    return null;
  }
}

/**
 * Get a user-scoped storage key.
 * If a user is logged in, returns `${baseKey}_${userId}`.
 * If no user, returns the base key (anonymous fallback).
 */
export function scopedKey(baseKey) {
  const userId = getCurrentUserId();
  return userId ? `${baseKey}_${userId}` : baseKey;
}

/**
 * Read from user-scoped localStorage with fallback to unscoped key.
 * Handles migration: if unscoped value exists but scoped doesn't,
 * copies the value to the scoped key.
 */
export function scopedGetItem(baseKey) {
  const userKey = scopedKey(baseKey);

  // Try user-scoped key first
  const scoped = localStorage.getItem(userKey);
  if (scoped !== null) return scoped;

  // Fall back to unscoped key (migration path)
  if (userKey !== baseKey) {
    const unscoped = localStorage.getItem(baseKey);
    if (unscoped !== null) {
      // Migrate: copy to scoped key
      localStorage.setItem(userKey, unscoped);
      return unscoped;
    }
  }

  return null;
}

/**
 * Write to user-scoped localStorage.
 */
export function scopedSetItem(baseKey, value) {
  localStorage.setItem(scopedKey(baseKey), value);
}

/**
 * Remove from user-scoped localStorage.
 */
export function scopedRemoveItem(baseKey) {
  localStorage.removeItem(scopedKey(baseKey));
}

/**
 * Clear all narrimo_* preferences from localStorage.
 * Called on logout to prevent preference leakage.
 * Does NOT clear the token itself (that's handled by clearStoredToken).
 */
export function clearAllPreferences() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('narrimo_') && key !== TOKEN_KEY) {
      keysToRemove.push(key);
    }
  }
  // Also clear legacy keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('storyteller_')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}
