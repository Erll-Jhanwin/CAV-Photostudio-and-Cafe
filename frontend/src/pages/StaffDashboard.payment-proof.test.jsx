import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

test('Staff Live Inventory opens dated product sales and wastage records', async () => {
  const salesRow = {
    product_id: 6,
    product_name: 'Iced Latte',
    beginning_stock: 20,
    quantity_sold: 2,
    wastage: 1,
    ending_stock: 17,
    revenue: '180.00',
    profit_loss: '90.00',
    date: '2026-10-30',
  };
  getCached.mockImplementation(url => (
    url === '/api/inventory/product-sales/'
      ? Promise.resolve({ data: [salesRow] })
      : Promise.resolve({ data: [] })
  ));
  client.get.mockImplementation((_url, { params }) => Promise.resolve({ data: params.type === 'sales' ? [{
    id: 'sale-6', transaction_id: 'POS-20261030-0006', date_time: '2026-10-30T02:15:00Z', quantity: 2, staff_name: 'Sam Cashier', sale_amount: '180.00',
  }] : [{
    id: 'waste-6', transaction_id: 'POS-20261030-0006', date_time: '2026-10-30T03:00:00Z', quantity: 1, staff_name: 'Sam Cashier', reason: 'Preparation spill',
  }] }));

  render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Live Inventory' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Product Sales, Returns & Wastage' }));

  fireEvent.click(await screen.findByRole('button', { name: 'View 2 sold transactions for Iced Latte' }));
  const salesDialog = await screen.findByRole('dialog', { name: 'Iced Latte · Sales Records' });
  expect(within(salesDialog).getByText('PHP 180')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));

  fireEvent.click(screen.getByRole('button', { name: 'View 1 wastage records for Iced Latte' }));
  const wastageDialog = await screen.findByRole('dialog', { name: 'Iced Latte · Wastage Records' });
  expect(within(wastageDialog).getByText('Preparation spill')).toBeInTheDocument();
  expect(client.get).toHaveBeenCalledWith('/api/inventory/product-sales/transactions/', {
    params: { product_id: 6, date: '2026-10-30', type: 'wastage' },
  });
});
