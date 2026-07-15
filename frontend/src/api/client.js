import axios from 'axios';
import { API_BASE_URL } from './config';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // If we get a 401 and we haven't retried yet
    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      
      if (refreshToken) {
        try {
          const res = await axios.post(`${API_BASE_URL}/api/auth/token/refresh/`, {
            refresh: refreshToken,
          });
          
          if (res.status === 200) {
            const newAccess = res.data.access;
            localStorage.setItem('access_token', newAccess);
            originalRequest.headers.Authorization = `Bearer ${newAccess}`;
            return client(originalRequest);
          }
        } catch (refreshError) {
          // Refresh token expired or invalid -> log out
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      }
    }
    
    return Promise.reject(error);
  }
);

export default client;
