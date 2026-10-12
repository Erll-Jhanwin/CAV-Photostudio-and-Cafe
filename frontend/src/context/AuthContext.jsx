import React, { createContext, useCallback, useState, useEffect, useContext } from 'react';
import client, { clearStoredAuth, getApiErrorMessage } from '../api/client';

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

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(readStoredUser);
  const [loading, setLoading] = useState(() => !readStoredUser());

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const savedUser = readStoredValue('user');
      if (!savedUser) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        const cachedUser = JSON.parse(savedUser);
        // The cached role lets the correct shell paint immediately while this request verifies the session.
        if (active) {
          setUser(cachedUser);
          setLoading(false);
        }
        const response = await client.get('/api/auth/profile/');
        const profile = response.data || {};
        const userData = {
          id: profile.id,
          username: profile.username,
          email: profile.email,
          role: profile.role,
          profile_picture_url: profile.profile_picture_url || '',
        };
        // A login can complete while this restore request is in flight. Do not
        // let the older session overwrite the newly authenticated account.
        if (readStoredValue('user') === savedUser) {
          localStorage.setItem('user', JSON.stringify(userData));
          if (active) setUser(userData);
        }
      } catch {
        // Keep a newer login intact when an older cached session fails to restore.
        if (readStoredValue('user') === savedUser) {
          clearStoredAuth();
          if (active) setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    restoreSession();
    return () => { active = false; };
  }, []);

  const login = async (username, password, verification = {}) => {
    try {
      const response = await client.post('/api/auth/login/', { username, password, ...verification });
      if (response.data.mfa_required) {
        return { success: false, mfaRequired: true, ...response.data };
      }
      const { role, email, id, profile_picture_url } = response.data;
      
      const userData = { id, username, email, role, profile_picture_url };
      
      localStorage.setItem('user', JSON.stringify(userData));
      
      setUser(userData);
      return { success: true, user: userData };
    } catch (error) {
      console.error("Login failed:", error);
      const message = error.response?.status === 401
        ? 'Invalid username or password.'
        : getApiErrorMessage(error, 'Unable to sign in. Please try again.');
      return { success: false, error: message };
    }
  };

  const loginWithGoogle = async (credential, phoneNumber = '') => {
    try {
      const response = await client.post('/api/auth/google/', { credential, phone_number: phoneNumber });
      if (response.data.pending_verification) {
        return { success: false, pendingVerification: true, ...response.data };
      }
      const { role, username, email, id, profile_picture_url } = response.data;

      const userData = { id, username, email, role, profile_picture_url };

      localStorage.setItem('user', JSON.stringify(userData));

      setUser(userData);
      return { success: true, user: userData, created: response.data.created };
    } catch (error) {
      console.error("Google login failed:", error);
      const message = error.response?.data?.detail || getApiErrorMessage(error, 'Google authentication failed.');
      return { success: false, error: message, errors: error.response?.data || {} };
    }
  };

  const logout = async () => {
    try {
      await client.post('/api/auth/logout/');
    } catch (error) {
      console.warn('Server logout failed; clearing local session state.', error);
    } finally {
      clearStoredAuth();
      sessionStorage.clear();
      setUser(null);
    }
  };

  const updateStoredUser = useCallback((updates) => {
    setUser(current => {
      const nextUser = { ...(current || {}), ...(updates || {}) };
      const currentString = JSON.stringify(current || {});
      const nextString = JSON.stringify(nextUser);
      if (currentString === nextString) return current;
      localStorage.setItem('user', JSON.stringify(nextUser));
      return nextUser;
    });
  }, []);

  const register = async (registerData) => {
    try {
      const response = await client.post('/api/auth/register/', registerData);
      return { success: true, ...response.data };
    } catch (error) {
      console.error("Registration failed:", error);
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
