import React, { createContext, useCallback, useState, useEffect, useContext } from 'react';
import client, { clearStoredAuth, getApiErrorMessage } from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const savedUser = localStorage.getItem('user');
      const token = localStorage.getItem('access_token');
      if (!savedUser || !token) {
        if (active) setLoading(false);
        return;
      }

      try {
        JSON.parse(savedUser);
        const response = await client.get('/api/auth/profile/');
        const profile = response.data || {};
        const userData = {
          id: profile.id,
          username: profile.username,
          email: profile.email,
          role: profile.role,
          profile_picture_url: profile.profile_picture_url || '',
        };
        localStorage.setItem('user', JSON.stringify(userData));
        if (active) setUser(userData);
      } catch {
        clearStoredAuth();
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    restoreSession();
    return () => { active = false; };
  }, []);

  const login = async (username, password) => {
    try {
      const response = await client.post('/api/auth/login/', { username, password });
      const { access, refresh, role, email, id, profile_picture_url } = response.data;
      
      const userData = { id, username, email, role, profile_picture_url };
      
      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);
      localStorage.setItem('user', JSON.stringify(userData));
      
      setUser(userData);
      return { success: true, user: userData };
    } catch (error) {
      console.error("Login failed:", error);
      const message = error.response?.data?.detail || getApiErrorMessage(error, 'Invalid username or password.');
      return { success: false, error: message };
    }
  };

  const loginWithGoogle = async (credential) => {
    try {
      const response = await client.post('/api/auth/google/', { credential });
      const { access, refresh, role, username, email, id, profile_picture_url } = response.data;

      const userData = { id, username, email, role, profile_picture_url };

      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);
      localStorage.setItem('user', JSON.stringify(userData));

      setUser(userData);
      return { success: true, user: userData, created: response.data.created };
    } catch (error) {
      console.error("Google login failed:", error);
      const message = error.response?.data?.detail || getApiErrorMessage(error, 'Google authentication failed.');
      return { success: false, error: message };
    }
  };

  const logout = () => {
    clearStoredAuth();
    sessionStorage.clear();
    document.cookie.split(';').forEach((cookie) => {
      const name = cookie.split('=')[0].trim();
      if (name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });
    delete client.defaults.headers.common.Authorization;
    setUser(null);
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
      return { success: true, message: response.data.message };
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
