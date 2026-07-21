import axios from 'axios';
import { API_BASE_URL } from './config';

export const DATA_CHANGED_EVENT = 'cav:data-changed';
const DATA_CHANGED_STORAGE_KEY = 'cav:data-change';

const dispatchDataChanged = (detail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }));
  try {
    window.localStorage.setItem(DATA_CHANGED_STORAGE_KEY, JSON.stringify({
      ...detail,
      at: Date.now(),
      nonce: Math.random().toString(36).slice(2),
    }));
  } catch {
    // Storage can be unavailable in private browsing; the current tab still refreshes.
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== DATA_CHANGED_STORAGE_KEY || !event.newValue) return;
    try {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
        detail: JSON.parse(event.newValue),
      }));
    } catch {
      // Ignore malformed storage events from older app versions.
    }
  });
}

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

let refreshPromise = null;

export const clearStoredAuth = () => {
  ['access_token', 'refresh_token', 'user'].forEach(key => localStorage.removeItem(key));
};

export const getApiErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  if (error?.code === 'ECONNABORTED') return 'The server is taking too long to respond. Please try again.';
  if (!error?.response) return 'Cannot reach the server. Check your connection and try again.';

  const { status, data } = error.response;
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    const messages = Object.entries(data).flatMap(([field, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return values
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(message => field === 'detail' ? message : `${field.replace(/_/g, ' ')}: ${message}`);
    });
    if (messages.length) return messages.join(' ');
  }
  return fallback;
};

const redirectToLogin = () => {
  clearStoredAuth();
  if (window.location.pathname === '/login') return;
  const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/login?redirect=${encodeURIComponent(destination)}`);
};

// Request Interceptor: Inject JWT token from localStorage
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Handle Token Refresh on 401
client.interceptors.response.use(
  (response) => {
    const method = String(response.config?.method || 'get').toLowerCase();
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      dispatchDataChanged({
        method,
        url: response.config?.url || '',
      });
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config || {};
    const requestUrl = originalRequest.url || '';
    const isPublicAuthRequest = [
      '/api/auth/login/',
      '/api/auth/register/',
      '/api/auth/google/',
      '/api/auth/forgot-password/',
    ].some(path => requestUrl.includes(path));
    
    // If we get a 401 and we haven't retried yet
    if (
      error.response &&
      error.response.status === 401 &&
      !originalRequest._retry &&
      !requestUrl.includes('/api/auth/token/refresh/') &&
      !isPublicAuthRequest
    ) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      
      if (refreshToken) {
        try {
          if (!refreshPromise) {
            refreshPromise = axios.post(`${API_BASE_URL}/api/auth/token/refresh/`, {
              refresh: refreshToken,
            }, { timeout: 15000 }).finally(() => {
              refreshPromise = null;
            });
          }
          const res = await refreshPromise;
          
          if (res.status === 200) {
            const newAccess = res.data.access;
            localStorage.setItem('access_token', newAccess);
            originalRequest.headers.Authorization = `Bearer ${newAccess}`;
            return client(originalRequest);
          }
        } catch (refreshError) {
          redirectToLogin();
          return Promise.reject(refreshError);
        }
      }

      redirectToLogin();
    }

    error.userMessage = getApiErrorMessage(error);
    return Promise.reject(error);
  }
);

export default client;
