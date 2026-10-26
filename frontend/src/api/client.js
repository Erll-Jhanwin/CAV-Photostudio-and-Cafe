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
  withCredentials: true,
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
});

let csrfPromise = null;
let refreshPromise = null;
let refreshController = null;
let csrfTokenCache = '';
let authGeneration = 0;
const queryCache = new Map();
const pendingQueries = new Map();
let queryCacheGeneration = 0;

const getCsrfCookie = () => {
  if (typeof document === 'undefined') return '';
  const cookie = document.cookie
    .split('; ')
    .find(item => item.startsWith('csrftoken='));
  return cookie ? decodeURIComponent(cookie.slice('csrftoken='.length)) : '';
};

// A request started before a new login/logout must never be allowed to clear
// the newer session when its response arrives later.
export const beginAuthTransition = () => {
  authGeneration += 1;
  refreshController?.abort();
  refreshController = null;
  refreshPromise = null;
  clearQueryCache();
  return authGeneration;
};

const ensureCsrfToken = () => {
  const existingToken = getCsrfCookie();
  if (existingToken) {
    csrfTokenCache = existingToken;
    return Promise.resolve(existingToken);
  }
  if (csrfTokenCache) return Promise.resolve(csrfTokenCache);
  if (!csrfPromise) {
    csrfPromise = axios.get(`${API_BASE_URL}/api/auth/csrf/`, {
      timeout: 15000,
      withCredentials: true,
    })
      .then(response => {
        // The CSRF cookie belongs to the API origin, so document.cookie on a
        // separately hosted frontend cannot read it. The endpoint also
        // returns the token explicitly for that deployment shape.
        csrfTokenCache = response.data?.csrf_token || response.data?.csrfToken || getCsrfCookie();
        return csrfTokenCache;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
};

const getQueryKey = (url, config = {}) => `${authGeneration}:${queryCacheGeneration}:${url}?${JSON.stringify(stableValue(config.params || {}))}`;

export const clearQueryCache = (prefix = '') => {
  if (!prefix) {
    queryCacheGeneration += 1;
    queryCache.clear();
    pendingQueries.clear();
    return;
  }
  Array.from(queryCache.keys()).forEach(key => {
    if (key.startsWith(prefix)) queryCache.delete(key);
  });
};

export const getCached = async (url, config = {}, { maxAge = 20_000, force = false } = {}) => {
  const key = getQueryKey(url, config);
  const cached = queryCache.get(key);
  if (!force && cached && Date.now() - cached.savedAt < maxAge) {
    return cached.response;
  }
  if (pendingQueries.has(key)) return pendingQueries.get(key);

  const request = client.get(url, config)
    .then(response => {
      queryCache.set(key, { response, savedAt: Date.now() });
      return response;
    })
    .finally(() => pendingQueries.delete(key));
  pendingQueries.set(key, request);
  return request;
};

export const clearStoredAuth = () => {
  ['access_token', 'refresh_token', 'user'].forEach(key => localStorage.removeItem(key));
  clearQueryCache();
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

// Browser authentication uses HttpOnly cookies; tokens never enter JavaScript storage.
client.interceptors.request.use(
  async (config) => {
    if (typeof config.authGeneration !== 'number') {
      config.authGeneration = authGeneration;
    }
    const method = String(config.method || 'get').toLowerCase();
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      const csrfToken = await ensureCsrfToken();
      if (csrfToken) {
        config.headers = config.headers || {};
        config.headers['X-CSRFToken'] = csrfToken;
      }
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
      clearQueryCache();
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
    const isStaleAuthRequest = (
      typeof originalRequest.authGeneration === 'number'
      && originalRequest.authGeneration !== authGeneration
    );
    
    // If we get a 401 and we haven't retried yet
    if (
      error.response &&
      error.response.status === 401 &&
      !originalRequest._retry &&
      !requestUrl.includes('/api/auth/token/refresh/') &&
      !isPublicAuthRequest &&
      !originalRequest.skipAuthRecovery &&
      !isStaleAuthRequest
    ) {
      originalRequest._retry = true;
      try {
        if (!refreshPromise) {
          const refreshControllerForRequest = new AbortController();
          refreshController = refreshControllerForRequest;
          refreshPromise = axios.post(`${API_BASE_URL}/api/auth/token/refresh/`, {}, {
            timeout: 15000,
            withCredentials: true,
            signal: refreshControllerForRequest.signal,
          }).finally(() => {
            if (refreshController === refreshControllerForRequest) {
              refreshPromise = null;
              refreshController = null;
            }
          });
        }
        const res = await refreshPromise;
        if (res.status === 200 && originalRequest.authGeneration === authGeneration) {
          return client(originalRequest);
        }
      } catch (refreshError) {
        if (originalRequest.authGeneration === authGeneration && !originalRequest.skipAuthRedirect) {
          redirectToLogin();
        }
        return Promise.reject(refreshError);
      }

      if (originalRequest.authGeneration === authGeneration && !originalRequest.skipAuthRedirect) {
        redirectToLogin();
      }
    }

    error.userMessage = getApiErrorMessage(error);
    return Promise.reject(error);
  }
);

export default client;
