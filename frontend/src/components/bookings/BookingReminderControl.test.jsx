import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import client from '../../api/client';
import { getManilaDateInputValue } from '../../utils/dateTime';
import BookingReminderControl from './BookingReminderControl';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

const booking = {
  id: 73,
  customer: { id: 9 },
  status: 'CONFIRMED',
  scheduled_date: getManilaDateInputValue(),
  scheduled_time: '14:30:00',
  package_details: { name: 'Portrait Package', service: { name: 'Studio Session' } },
};

beforeEach(() => jest.clearAllMocks());

test('previews, edits, and sends a same-day reminder with required time and location', async () => {
  client.get.mockResolvedValue({ data: {
    eligible: true,
    already_sent: false,
    session_time: '2:30 PM',
    default_location: '028B Studio address',
    default_message: 'We look forward to seeing you today.',
  } });
  client.post.mockResolvedValue({ data: { created: true } });

  render(<BookingReminderControl booking={booking} />);
  fireEvent.click(screen.getByRole('button', { name: 'Notify customer' }));
  expect(await screen.findByText(/Customer notification preview/)).toBeInTheDocument();
  expect(screen.getByText(/Session time: 2:30 PM/)).toBeInTheDocument();
  expect(client.get).toHaveBeenCalledWith('/api/bookings/73/reminder/');

  fireEvent.change(screen.getByLabelText('Reminder message'), { target: { value: 'We are ready for your session.' } });
  fireEvent.change(screen.getByLabelText('Session location'), { target: { value: 'Studio entrance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/bookings/73/reminder/', {
    message: 'We are ready for your session.',
    location: 'Studio entrance',
  }));
  expect(await screen.findByRole('status')).toHaveTextContent('Reminder sent to the customer’s Notifications page.');
  expect(screen.getByRole('button', { name: 'Reminder sent' })).toBeDisabled();
});

test('only shows the reminder action for a confirmed photo booking scheduled today', () => {
  const { rerender } = render(<BookingReminderControl booking={{ ...booking, status: 'PENDING' }} />);
  expect(screen.queryByRole('button', { name: 'Notify customer' })).not.toBeInTheDocument();
  rerender(<BookingReminderControl booking={{ ...booking, scheduled_date: '2000-01-01' }} />);
  expect(screen.queryByRole('button', { name: 'Notify customer' })).not.toBeInTheDocument();
  rerender(<BookingReminderControl booking={{ ...booking, package_details: { name: 'Cafe Item', service: { name: 'Cafe' } } }} />);
  expect(screen.queryByRole('button', { name: 'Notify customer' })).not.toBeInTheDocument();
});
