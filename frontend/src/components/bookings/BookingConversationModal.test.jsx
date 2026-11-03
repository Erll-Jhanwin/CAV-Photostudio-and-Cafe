import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import client from '../../api/client';
import BookingConversationModal from './BookingConversationModal';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

beforeEach(() => jest.clearAllMocks());

test('loads the booking thread, sends a reply, and displays both participants separately from the chatbot', async () => {
  client.get.mockResolvedValue({ data: [{
    id: 1,
    booking: 86,
    author_id: 9,
    author_name: 'Customer One',
    author_role: 'CUSTOMER',
    message: 'Can I arrive early?',
    created_at: '2026-11-03T02:00:00Z',
  }] });
  client.post.mockResolvedValue({ data: {
    id: 2,
    booking: 86,
    author_id: 2,
    author_name: 'Admin Two',
    author_role: 'ADMIN',
    message: 'Yes, please arrive ten minutes early.',
    created_at: '2026-11-03T02:01:00Z',
  } });

  render(<BookingConversationModal open bookingId={86} customerName="Customer One" currentUserId={2} onClose={jest.fn()} />);
  const dialog = await screen.findByRole('dialog', { name: 'Booking conversation · #86' });
  expect(await within(dialog).findByText('Can I arrive early?')).toBeInTheDocument();
  expect(client.get).toHaveBeenCalledWith('/api/bookings/86/conversation/');
  expect(within(dialog).queryByText('Chatbot')).not.toBeInTheDocument();

  fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'Yes, please arrive ten minutes early.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/bookings/86/conversation/', {
    message: 'Yes, please arrive ten minutes early.',
    concern: 'BOOKING',
  }));
  expect(await within(dialog).findByText('Yes, please arrive ten minutes early.')).toBeInTheDocument();
  expect(within(dialog).getByText('You')).toBeInTheDocument();
  expect(within(dialog).getByText('Customer One')).toBeInTheDocument();
});

test('lets the customer choose a concern before opening a new thread', async () => {
  client.get.mockResolvedValue({ data: { conversation: null, messages: [] } });
  client.post.mockResolvedValue({ data: {
    id: 3, booking: 91, author_id: 9, author_name: 'Customer One', author_role: 'CUSTOMER',
    message: 'I have a payment question.', created_at: '2026-11-03T02:05:00Z',
  } });
  render(<BookingConversationModal open bookingId={91} currentUserId={9} allowConcern onClose={jest.fn()} />);
  const dialog = await screen.findByRole('dialog', { name: 'Booking conversation · #91' });
  fireEvent.change(within(dialog).getByLabelText('Message concern'), { target: { value: 'PAYMENT' } });
  fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'I have a payment question.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/bookings/91/conversation/', {
    message: 'I have a payment question.',
    concern: 'PAYMENT',
  }));
});
