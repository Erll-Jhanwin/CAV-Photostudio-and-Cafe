/* CAV Web Push service worker. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'CAV Photo Studio & Cafe';
  const options = {
    body: payload.body || 'You have a new notification.',
    icon: '/logo192.png',
    badge: '/logo192.png',
    data: { url: payload.url || '/customer?tab=notifications' },
    tag: payload.notification_id ? `cav-notification-${payload.notification_id}` : 'cav-notification',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/customer?tab=notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
