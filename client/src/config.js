// API and Socket configuration
const BASE_URL = import.meta.env.BASE_URL || '/storyteller/';

export const API_BASE = `${BASE_URL}api`;
export const SOCKET_URL = window.location.origin;
export const SOCKET_PATH = `${BASE_URL}socket.io`;

export async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response;
}
