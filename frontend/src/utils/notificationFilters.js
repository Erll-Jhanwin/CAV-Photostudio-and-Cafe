const DEFAULT_NOTIFICATION_CATEGORIES = ['Booking', 'Payment', 'Account'];

export function getNotificationCategory(notificationType) {
  const type = String(notificationType || '').trim().toUpperCase();
  if (type.includes('PAYMENT')) return 'Payment';
  if (type.startsWith('BOOKING')) return 'Booking';
  if (/^(ACCOUNT|PROFILE|USER)(_|$)/.test(type)) return 'Account';

  const prefix = type.split('_')[0];
  return prefix ? `${prefix.charAt(0)}${prefix.slice(1).toLowerCase()}` : 'Other';
}

export function getNotificationCategories(notifications = []) {
  const dynamicCategories = new Set(
    notifications.map(notification => getNotificationCategory(notification.notification_type)),
  );
  return [
    ...DEFAULT_NOTIFICATION_CATEGORIES,
    ...[...dynamicCategories]
      .filter(category => !DEFAULT_NOTIFICATION_CATEGORIES.includes(category))
      .sort((a, b) => a.localeCompare(b)),
  ];
}

export function filterNotifications(notifications = [], statusFilter = 'all', typeFilter = 'all') {
  return notifications.filter(notification => {
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'unread' && !notification.is_read)
      || (statusFilter === 'read' && Boolean(notification.is_read));
    const matchesType = typeFilter === 'all'
      || getNotificationCategory(notification.notification_type) === typeFilter;
    return matchesStatus && matchesType;
  });
}
