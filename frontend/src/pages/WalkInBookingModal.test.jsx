import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WalkInBookingModal from './WalkInBookingModal';
import client from '../api/client';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

const services = [{
  id: 1,
  name: 'Studio Session',
  packages: [{ id: 4, name: 'Portrait', price: '1000.00', inclusions: 'Portrait session' }],
}];

describe('WalkInBookingModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.get.mockImplementation((url) => {
      if (url.endsWith('/services/')) return Promise.resolve({ data: services });
      if (url.endsWith('/availability/')) return Promise.resolve({ data: { slots: [{ time: '09:00:00', display_time: '09:00 AM', available: true }] } });
      return Promise.resolve({ data: [] });
    });
    client.post.mockResolvedValue({ data: { id: 51, is_walk_in: true } });
  });

  test('checks existing availability and submits walk-in details and cash payment once', async () => {
    const onCreated = jest.fn();
    render(<WalkInBookingModal open onClose={jest.fn()} onCreated={onCreated} />);

    await waitFor(() => expect(screen.getByLabelText('Package')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: '4' } });
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/api/bookings/availability/', expect.objectContaining({ params: expect.objectContaining({ package: '4' }) })));
    await waitFor(() => expect(screen.getByRole('option', { name: '09:00 AM' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Available time'), { target: { value: '09:00:00' } });
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Walk-in Guest' } });
    fireEvent.change(screen.getByLabelText('Contact number'), { target: { value: '09171234567' } });
    fireEvent.change(screen.getByLabelText('Payment amount (optional)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Walk-in Booking' }));

    await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/bookings/walk-in/', expect.objectContaining({
      package: 4,
      scheduled_time: '09:00:00',
      customer_name: 'Walk-in Guest',
      customer_phone: '09171234567',
      payment_method: 'CASH',
      payment_amount: '500',
    })));
    expect(onCreated).toHaveBeenCalledWith({ id: 51, is_walk_in: true });
  });

  test('does not submit until an available slot and customer contact are provided', async () => {
    client.get.mockImplementation((url) => url.endsWith('/services/')
      ? Promise.resolve({ data: services })
      : Promise.resolve({ data: { slots: [] } }));
    render(<WalkInBookingModal open onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Package')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: '4' } });
    await waitFor(() => expect(screen.getByText('No available times for this date. Choose another date.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Confirm Walk-in Booking' })).toBeDisabled();
    expect(client.post).not.toHaveBeenCalled();
  });
});
