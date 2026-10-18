import {
  disablePushNotifications,
  enablePushNotifications,
  isPushSupported,
} from './pushNotifications';
import client from '../api/client';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  getApiErrorMessage: jest.fn((error, fallback) => error?.message || fallback),
}));

const originalNotification = window.Notification;
const originalPushManager = window.PushManager;
const originalServiceWorker = navigator.serviceWorker;

const setPushBrowser = ({ permission = 'default', registration = null } = {}) => {
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      permission,
      requestPermission: jest.fn().mockResolvedValue('granted'),
    },
  });
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: function PushManager() {},
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: jest.fn().mockResolvedValue(registration),
      register: jest.fn().mockResolvedValue(registration),
    },
  });
};

afterEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'Notification', { configurable: true, value: originalNotification });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: originalPushManager });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: originalServiceWorker });
});

test('enables a browser subscription and persists it for the signed-in user', async () => {
  const subscription = {
    toJSON: () => ({
      endpoint: 'https://push.example.test/subscription/123',
      keys: { p256dh: 'public-client-key', auth: 'auth-secret' },
    }),
    unsubscribe: jest.fn().mockResolvedValue(true),
  };
  const registration = {
    pushManager: {
      getSubscription: jest.fn().mockResolvedValue(null),
      subscribe: jest.fn().mockResolvedValue(subscription),
    },
  };
  setPushBrowser({ registration: null });
  navigator.serviceWorker.register.mockResolvedValue(registration);
  navigator.serviceWorker.ready = Promise.resolve(registration);
  client.get.mockResolvedValue({ data: { enabled: true, public_key: 'AQID' } });
  client.post.mockResolvedValue({ data: { active: true } });

  expect(isPushSupported()).toBe(true);
  await expect(enablePushNotifications()).resolves.toBe(subscription);
  expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/push-sw.js', { scope: '/' });
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({
    userVisibleOnly: true,
    applicationServerKey: expect.any(Uint8Array),
  }));
  expect(client.post).toHaveBeenCalledWith('/api/notifications/push/subscription/', expect.objectContaining({
    endpoint: 'https://push.example.test/subscription/123',
  }));
});

test('does not re-request browser permission when notifications are blocked', async () => {
  setPushBrowser({ permission: 'denied' });
  client.get.mockResolvedValue({ data: { enabled: true, public_key: 'AQID' } });

  await expect(enablePushNotifications()).rejects.toThrow('blocked for this site');
  expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  expect(client.post).not.toHaveBeenCalled();
});

test('removes the server subscription before unsubscribing the browser', async () => {
  const subscription = {
    toJSON: () => ({
      endpoint: 'https://push.example.test/subscription/123',
      keys: { p256dh: 'public-client-key', auth: 'auth-secret' },
    }),
    unsubscribe: jest.fn().mockResolvedValue(true),
  };
  const registration = { pushManager: { getSubscription: jest.fn().mockResolvedValue(subscription) } };
  setPushBrowser({ registration });
  client.delete.mockResolvedValue({ data: { deleted: true } });

  await expect(disablePushNotifications()).resolves.toBe(true);
  expect(client.delete).toHaveBeenCalledWith('/api/notifications/push/subscription/', {
    data: { endpoint: 'https://push.example.test/subscription/123' },
  });
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
});
