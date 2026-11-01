import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import client from '../api/client';
import WalkInBookingModal from './WalkInBookingModal';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

test('walk-in success offers two receipt copies and reprinting never resubmits booking or payment', async () => {
  client.get.mockImplementation(url => Promise.resolve({ data: url === '/api/bookings/services/'
    ? [{ id: 2, name: 'Studio Portrait', packages: [{ id: 3, name: 'Portrait Session', price: '1000.00', inclusions: 'One portrait' }] }]
    : { slots: [{ time: '09:00:00', label: '9:00 AM', display_time: '9:00 AM', available: true }] } }));
  client.post.mockResolvedValue({ data: {
    id: 55,
    customer_name: 'Jamie Reyes', customer_phone: '09171234567', customer_email: 'jamie@example.test',
    scheduled_date: '2026-12-01', scheduled_time: '09:00:00', created_at: '2026-11-01T02:00:00Z',
    package_details: { name: 'Portrait Session', price: '1000.00' },
    payments: [{ id: 9, status: 'APPROVED', amount: '500.00', method: 'CASH', method_label: 'Cash', paid_at: '2026-11-01T02:00:00Z' }],
    remaining_balance: '500.00',
  } });
  const onCreated = jest.fn();
  const onClose = jest.fn();
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  const localBridge = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Local print bridge unavailable.'));

  render(<WalkInBookingModal open onCreated={onCreated} onClose={onClose} />);
  fireEvent.change(await screen.findByLabelText('Package'), { target: { value: '3' } });
  await screen.findByLabelText('Available time');
  await waitFor(() => expect(screen.getByRole('option', { name: '9:00 AM' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Available time'), { target: { value: '09:00:00' } });
  fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Jamie Reyes' } });
  fireEvent.change(screen.getByLabelText('Contact number'), { target: { value: '09171234567' } });
  fireEvent.change(screen.getByLabelText('Payment amount (optional)'), { target: { value: '500.00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Walk-in Booking' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Walk-in booking #55 saved successfully.');
  expect(screen.getByRole('button', { name: 'Print Customer Copy' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print Your Copy' })).toBeInTheDocument();
  expect(screen.getByText('PHP 1,000.00')).toBeInTheDocument();
  expect(screen.getAllByText('PHP 500.00')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Print Customer Copy' }));
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Customer Copy')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Print Your Copy' }));
  await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Staff/Admin Copy')).toBeInTheDocument();
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(onCreated).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  print.mockRestore();
  localBridge.mockRestore();
});
