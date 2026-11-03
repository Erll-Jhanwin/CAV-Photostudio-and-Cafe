import React, { createContext, useCallback, useState, useEffect, useContext, useRef } from 'react';
import client, { beginAuthTransition, clearStoredAuth, getApiErrorMessage } from '../api/client';

const AuthContext = createContext(null);

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const readStoredValue = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const storeUser = (userData) => {
  try {
    localStorage.setItem('user', JSON.stringify(userData));
  } catch {
    // The authenticated HttpOnly cookie and in-memory user state are enough to
    // keep this tab signed in when persistent storage is unavailable.
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(readStoredUser);
  // Verify the cookie before protected routes decide whether to redirect.
  // This also allows a private session to restore without localStorage.
  const [loading, setLoading] = useState(true);
  const restoreControllerRef = useRef(null);
  const loginInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const savedUser = readStoredValue('user');
      const controller = new AbortController();
      restoreControllerRef.current = controller;

      try {
        // A cached user is only a display hint; protected routes remain gated
        // until the backend confirms the session and current role.
        if (savedUser) {
          try {
            const cachedUser = JSON.parse(savedUser);
            if (active) setUser(cachedUser);
          } catch {
            // Ignore malformed cached profile data and verify the cookie below.
          }
        }
        const response = await client.get('/api/auth/profile/', {
          signal: controller.signal,
          timeout: 12000,
          skipAuthRedirect: true,
        });
        const profile = response.data || {};
        const userData = {
          id: profile.id,
          username: profile.username,
          email: profile.email,
          role: profile.role,
          first_name: profile.first_name || '',
          last_name: profile.last_name || '',
          phone_number: profile.phone_number || '',
          address: profile.address || '',
          registration_method: profile.registration_method || '',
          profile_picture_url: profile.profile_picture_url || '',
        };
        // A login can complete while this restore request is in flight. Do not
        // let the older session overwrite the newly authenticated account.
        if (readStoredValue('user') === savedUser) {
          storeUser(userData);
          if (active) setUser(userData);
        }
      } catch {
        // Keep a newer login intact when an older cached session fails to restore.
        if (readStoredValue('user') === savedUser && !loginInFlightRef.current) {
          clearStoredAuth();
          if (active) setUser(null);
        }
      } finally {
        if (active && !loginInFlightRef.current) setLoading(false);
        if (restoreControllerRef.current === controller) restoreControllerRef.current = null;
      }
    };

    restoreSession();
    return () => { active = false; };
  }, []);

  const completeLogin = async (fallbackUser) => {
    // Do not report success until the browser has proved that the HttpOnly
    // cookie issued by the login response can authenticate a protected call.
    const profileResponse = await client.get('/api/auth/profile/', { skipAuthRedirect: true, timeout: 12000 });
    const profile = profileResponse.data || {};
    const userData = {
      id: profile.id ?? fallbackUser.id,
      username: profile.username || fallbackUser.username,
      email: profile.email || fallbackUser.email,
      role: profile.role || fallbackUser.role,
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      phone_number: profile.phone_number || '',
      address: profile.address || '',
      registration_method: profile.registration_method || '',
      profile_picture_url: profile.profile_picture_url || fallbackUser.profile_picture_url || '',
    };

    storeUser(userData);
    setUser(userData);
    return userData;
  };

  const login = async (username, password, verification = {}) => {
    beginAuthTransition();
    loginInFlightRef.current = true;
    restoreControllerRef.current?.abort();
    try {
      const response = await client.post('/api/auth/login/', { username, password, ...verification });
      if (response.data.mfa_required) {
        return { success: false, mfaRequired: true, ...response.data };
      }
      const { role, email, id, profile_picture_url } = response.data;
      const userData = await completeLogin({ id, username, email, role, profile_picture_url });
      return { success: true, user: userData };
    } catch (error) {
      console.error('Login request failed.');
      const message = error.response?.status === 401
        ? (error.config?.skipAuthRedirect
          ? 'Your details were accepted, but we couldn’t start your session. Try again.'
          : 'Invalid username or password.')
        : getApiErrorMessage(error, 'Couldn’t sign in. Try again.');
      return { success: false, error: message };
    } finally {
      loginInFlightRef.current = false;
      setLoading(false);
    }
  };

  const loginWithGoogle = async (credential, phoneNumber = '', verification = {}) => {
    beginAuthTransition();
    loginInFlightRef.current = true;
    restoreControllerRef.current?.abort();
    try {
      const response = await client.post('/api/auth/google/', { credential, phone_number: phoneNumber, ...verification });
      if (response.data.pending_verification) {
        return { success: false, pendingVerification: true, ...response.data };
      }
      if (response.data.mfa_required) {
        return { success: false, mfaRequired: true, ...response.data };
      }
      const { role, username, email, id, profile_picture_url } = response.data;
      const userData = await completeLogin({ id, username, email, role, profile_picture_url });
      return { success: true, user: userData, created: response.data.created };
    } catch (error) {
      console.error('Google login request failed.');
      const responseData = error.response?.data || {};
      const messageValue = value => (Array.isArray(value) ? value : [value])
        .filter(item => typeof item === 'string' || typeof item === 'number')
        .map(item => String(item).trim())
        .filter(Boolean)
        .join(' ');
      const message = messageValue(responseData.detail)
        || messageValue(responseData.phone_number)
        || messageValue(responseData.privacy_consent)
        || getApiErrorMessage(error, 'Google authentication failed.');
      return { success: false, error: message, errors: error.response?.data || {} };
    } finally {
      loginInFlightRef.current = false;
      setLoading(false);
    }
  };

  const logout = async () => {
    beginAuthTransition();
    restoreControllerRef.current?.abort();
    try {
      await client.post('/api/auth/logout/');
    } catch (error) {
      // Axios errors include request configuration and CSRF headers. Avoid
      // logging the raw error object while still clearing the local session.
      console.warn('Server logout failed; clearing local session state.');
    } finally {
      clearStoredAuth();
      try {
        sessionStorage.clear();
      } catch {
        // Session cleanup must not prevent the in-memory logout.
      }
      setUser(null);
    }
  };

  const updateStoredUser = useCallback((updates) => {
    setUser(current => {
      const nextUser = { ...(current || {}), ...(updates || {}) };
      const currentString = JSON.stringify(current || {});
      const nextString = JSON.stringify(nextUser);
      if (currentString === nextString) return current;
      storeUser(nextUser);
      return nextUser;
    });
  }, []);

  const register = async (registerData) => {
    try {
      const response = await client.post('/api/auth/register/', registerData);
      return { success: true, ...response.data };
    } catch (error) {
      console.error('Registration request failed.');
      const errors = error.response?.data || { detail: "Registration failed." };
      return { success: false, errors };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout, register, updateStoredUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
