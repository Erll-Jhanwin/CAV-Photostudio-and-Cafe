import { Capacitor } from '@capacitor/core';

// Appflow builds do not receive the local, gitignored frontend/.env file. Keep
// native releases pointed at the public API unless an explicit mobile URL is set.
const PRODUCTION_API_BASE_URL = 'https://cav-photostudio-and-cafe.onrender.com';

const cleanBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const isNativeApp = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const browserApiBaseUrl = cleanBaseUrl(process.env.REACT_APP_API_BASE_URL);
const mobileApiBaseUrl = cleanBaseUrl(process.env.REACT_APP_MOBILE_API_BASE_URL);

export const API_BASE_URL = browserApiBaseUrl
  || (isNativeApp() ? (mobileApiBaseUrl || PRODUCTION_API_BASE_URL) : (
    process.env.NODE_ENV === 'development' ? 'http://localhost:8000' : PRODUCTION_API_BASE_URL
  ));
