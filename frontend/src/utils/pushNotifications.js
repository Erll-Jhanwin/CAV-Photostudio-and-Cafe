import client from '../api/client';

const PUSH_SERVICE_WORKER_PATH = '/push-sw.js';

const base64ToUint8Array = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
};

export const isPushSupported = () => (
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window
);

export const enablePushNotifications = async () => {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  const configResponse = await client.get('/api/notifications/push/config/');
  const { enabled, public_key: publicKey } = configResponse.data || {};
  if (!enabled || !publicKey) {
    throw new Error('Push notifications are not configured yet.');
  }

  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const registration = await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH);
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(publicKey),
  });
  const payload = subscription.toJSON();
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
    throw new Error('The browser returned an incomplete push subscription.');
  }

  await client.post('/api/notifications/push/subscription/', {
    endpoint: payload.endpoint,
    keys: payload.keys,
    user_agent: navigator.userAgent,
  });
  return subscription;
};

export const disablePushNotifications = async () => {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_PATH);
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return false;
  const payload = subscription.toJSON();
  await client.delete('/api/notifications/push/subscription/', {
    data: { endpoint: payload.endpoint },
  });
  return subscription.unsubscribe();
};
