import { filterNotifications, getNotificationCategories, getNotificationCategory } from './notificationFilters';

const rows = [
  { id: 1, notification_type: 'BOOKING_CREATED', is_read: false },
  { id: 2, notification_type: 'BOOKING_CONFIRMED', is_read: true },
  { id: 3, notification_type: 'BOOKING_PAYMENT_APPROVED', is_read: false },
  { id: 4, notification_type: 'BOOKING_PAYMENT_REJECTED', is_read: true },
  { id: 5, notification_type: 'ACCOUNT_UPDATED', is_read: false },
  { id: 6, notification_type: 'SYSTEM_MAINTENANCE', is_read: true },
];

describe('notification filters', () => {
  test.each([
    ['all', 'all', [1, 2, 3, 4, 5, 6]],
    ['unread', 'all', [1, 3, 5]],
    ['read', 'all', [2, 4, 6]],
    ['all', 'Booking', [1, 2]],
    ['unread', 'Booking', [1]],
    ['read', 'Booking', [2]],
    ['all', 'Payment', [3, 4]],
    ['unread', 'Payment', [3]],
    ['read', 'Payment', [4]],
    ['all', 'Account', [5]],
    ['unread', 'Account', [5]],
    ['read', 'Account', []],
    ['all', 'System', [6]],
    ['unread', 'System', []],
    ['read', 'System', [6]],
  ])('combines %s status with %s type', (status, type, expectedIds) => {
    expect(filterNotifications(rows, status, type).map(row => row.id)).toEqual(expectedIds);
  });

  it('keeps the standard categories available and adds categories found in existing notification types', () => {
    expect(getNotificationCategories(rows)).toEqual(['Booking', 'Payment', 'Account', 'System']);
    expect(getNotificationCategory('BOOKING_PAYMENT_APPROVED')).toBe('Payment');
  });
});
