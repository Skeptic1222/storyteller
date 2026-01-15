// API and Socket configuration
import { getStoredToken } from './utils/authToken';

const BASE_URL = import.meta.env.BASE_URL || '/storyteller/';
const API_BASE_PATH = import.meta.env.VITE_API_BASE || `${BASE_URL}api`;

export const API_BASE = API_BASE_PATH.replace(/\/$/, '');
export const SOCKET_URL = window.location.origin;
export const SOCKET_PATH = `${BASE_URL}socket.io`;

export async function apiCall(endpoint, options = {}) {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE}${normalizedEndpoint}`;
  const token = getStoredToken();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Auto-add Authorization header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Authorization'] = `Bearer ${token}`;
    headers['X-Auth-Token'] = token;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  return response;
}
