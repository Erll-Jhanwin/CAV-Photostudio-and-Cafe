import client, { getApiErrorMessage } from '../api/client';

export const PUSH_SERVICE_WORKER_PATH = '/push-sw.js';

const base64ToUint8Array = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
};

export const isPushSupported = () => (
  typeof window !== 'undefined'
  && typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window
);

const getServiceWorkerRegistration = async ({ register = false } = {}) => {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration || !register) return registration;
  return navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH, { scope: '/' });
};

export const getPushSubscription = async () => {
  const registration = await getServiceWorkerRegistration();
  return registration?.pushManager?.getSubscription() || null;
};

const getPushError = (error, fallback) => {
  if (error?.response) return new Error(getApiErrorMessage(error, fallback));
  return error instanceof Error ? error : new Error(fallback);
};

const getSubscriptionPayload = (subscription) => {
  const payload = subscription?.toJSON?.() || {};
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
    throw new Error('The browser returned an incomplete push subscription.');
  }
  return payload;
};

export const syncPushSubscription = async (subscription) => {
  const payload = getSubscriptionPayload(subscription);
  try {
    await client.post('/api/notifications/push/subscription/', {
      endpoint: payload.endpoint,
      keys: payload.keys,
      user_agent: navigator.userAgent,
    });
  } catch (error) {
    throw getPushError(error, 'Could not save this device for push notifications.');
  }
  return subscription;
};

export const enablePushNotifications = async () => {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  let configResponse;
  try {
    configResponse = await client.get('/api/notifications/push/config/');
  } catch (error) {
    throw getPushError(error, 'Could not check push notification configuration.');
  }
  const { enabled, public_key: publicKey } = configResponse.data || {};
  if (!enabled || !publicKey) {
    throw new Error('Push notifications are not configured yet.');
  }

  if (window.Notification.permission === 'denied') {
    throw new Error('Push notifications are blocked for this site. Allow them in your browser site settings, then try again.');
  }

  const permission = window.Notification.permission === 'granted'
    ? 'granted'
    : await window.Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted. You can enable it later from your browser site settings.');
  }

  let subscription;
  try {
    const registration = await getServiceWorkerRegistration({ register: true });
    const existingSubscription = await registration.pushManager.getSubscription();
    subscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(publicKey),
    });
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      throw new Error('The browser did not allow this push subscription. Check site permissions and try again.');
    }
    throw getPushError(error, 'Could not create a push subscription in this browser.');
  }

  return syncPushSubscription(subscription);
};

export const disablePushNotifications = async () => {
  if (!isPushSupported()) return false;
  const subscription = await getPushSubscription();
  if (!subscription) return false;
  const payload = getSubscriptionPayload(subscription);
  try {
    await client.delete('/api/notifications/push/subscription/', {
      data: { endpoint: payload.endpoint },
    });
  } catch (error) {
    throw getPushError(error, 'Could not remove this device from push notifications.');
  }
  return subscription.unsubscribe();
};
