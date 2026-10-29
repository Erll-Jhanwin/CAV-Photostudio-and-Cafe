import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import client, { getCached } from '../api/client';

const mockStaffUser = { id: 2, username: 'staff', role: 'STAFF' };

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockStaffUser, logout: jest.fn() }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn(),
  },
  DATA_CHANGED_EVENT: 'cav:data-changed',
  getApiErrorMessage: (_error, fallback) => fallback,
  getCached: jest.fn(() => Promise.resolve({ data: [] })),
}));

jest.mock('../components/ui/StyledAlert', () => ({
  useStyledConfirm: () => jest.fn().mockResolvedValue(false),
}));

import StaffDashboard from './StaffDashboard';

const payment = {
  id: 18,
  booking: 48,
  booking_details: {
    customer_name: 'Jamie Reyes', customer_profile_picture_url: '',
    service_name: 'Studio', package_name: 'Portrait Session',
    scheduled_date: '2026-11-15', scheduled_time: '10:30',
  },
  method_label: 'GCash', reference_number: 'GC-48', amount: '1250.00',
  required_down_payment: '1250.00', paid_at: '2026-10-28T10:00:00Z',
  status: 'PENDING_VERIFICATION', receipt_url: '/api/bookings/payments/18/receipt/',
};

test('Staff payment verification opens proof on demand and keeps its verify actions available', async () => {
  getCached.mockImplementation(url => (
    url.includes('/api/bookings/payments/') ? Promise.resolve({ data: [payment] }) : Promise.resolve({ data: [] })
  ));
  client.get.mockReturnValue(new Promise(() => {}));

  const { unmount } = render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Payment Booking Verification' }));

  const proofButton = await screen.findByRole('button', { name: 'View proof of payment for booking 48' });
  expect(screen.getByRole('button', { name: 'Confirm Payment' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Flag Payment Issue' })).toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalled();

  fireEvent.click(proofButton);
  expect(await screen.findByRole('dialog', { name: 'Payment proof · Booking #48' })).toBeInTheDocument();
  await waitFor(() => expect(client.get).toHaveBeenCalledWith(
    '/api/bookings/payments/18/receipt/', { responseType: 'blob' },
  ));
  unmount();
});
