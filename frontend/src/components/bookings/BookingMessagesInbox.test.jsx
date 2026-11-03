import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import client from '../../api/client';
import BookingMessagesInbox from './BookingMessagesInbox';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

beforeEach(() => jest.clearAllMocks());

test('staff inbox shows unread customer messages and allows a reply in the linked thread', async () => {
  client.get.mockImplementation(url => {
    if (url === '/api/bookings/conversations/inbox/') return Promise.resolve({ data: { unread_count: 1, results: [{
      booking_id: 86,
      customer_name: 'Customer One',
      package_name: 'Portrait Package',
      scheduled_date: '2026-11-03',
      scheduled_time: '2:30 PM',
      concern: 'PAYMENT',
      concern_label: 'Payment',
      unread_count: 1,
      last_message: { message: 'I have a question about my deposit.', created_at: '2026-11-03T02:00:00Z' },
    }] } });
    return Promise.resolve({ data: { conversation: { concern: 'PAYMENT', concern_label: 'Payment' }, messages: [{
      id: 1, booking: 86, author_id: 9, author_name: 'Customer One', author_role: 'CUSTOMER',
      message: 'I have a question about my deposit.', created_at: '2026-11-03T02:00:00Z',
    }] } });
  });
  client.post.mockResolvedValue({ data: {
    id: 2, booking: 86, author_id: 4, author_name: 'Staff Four', author_role: 'STAFF',
    message: 'We received your down payment.', created_at: '2026-11-03T02:01:00Z',
  } });

  render(<BookingMessagesInbox currentUserId={4} />);
  expect(await screen.findByText('Customer One')).toBeInTheDocument();
  expect(screen.getAllByText('1 unread', { selector: 'span' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Booking conversation · #86' });
  expect(await within(dialog).findByText('I have a question about my deposit.')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'We received your down payment.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/bookings/86/conversation/', {
    message: 'We received your down payment.',
    concern: 'PAYMENT',
  }));
  expect(await within(dialog).findByText('We received your down payment.')).toBeInTheDocument();
});
