const TOKEN_STORAGE_KEY = 'narrimo_token';
const LEGACY_TOKEN_STORAGE_KEY = 'storyteller_token';

export function getStoredToken() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token && token !== 'null' && token !== 'undefined') {
    return token;
  }

  const legacyToken = localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY);
  if (legacyToken && legacyToken !== 'null' && legacyToken !== 'undefined') {
    localStorage.setItem(TOKEN_STORAGE_KEY, legacyToken);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    return legacyToken;
  }

  if (!token || token === 'null' || token === 'undefined') {
    return null;
  }
  return token;
}

export function setStoredToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
}

export function isTokenExpired(token) {
  if (!token) return true;
  const parts = token.split('.');
  if (parts.length < 2) return true;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (!payload?.exp) return false;
    return Date.now() / 1000 >= payload.exp;
  } catch {
    return true;
  }
}

export { TOKEN_STORAGE_KEY };
