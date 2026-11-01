import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import client, { getCached } from '../api/client';

const mockStaffUser = { id: 2, username: 'staff', role: 'STAFF' };
const staffAccessPolicy = { on_duty: true };
const mockConfirm = jest.fn();

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
  useStyledConfirm: () => mockConfirm,
}));

import StaffDashboard from './StaffDashboard';

beforeEach(() => {
  mockConfirm.mockReset();
  mockConfirm.mockResolvedValue(false);
  client.get.mockImplementation(url => url === '/api/auth/staff-access/me/'
    ? Promise.resolve({ data: staffAccessPolicy })
    : Promise.resolve({ data: {} }));
  localStorage.clear();
  sessionStorage.clear();
});

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

test('off-duty staff sessions do not render protected tabs or load their data', async () => {
  client.get.mockResolvedValue({ data: { on_duty: false } });

  render(<StaffDashboard />);

  expect(await screen.findByRole('heading', { name: 'You are off duty' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'POS Terminal' })).not.toBeInTheDocument();
  expect(getCached).not.toHaveBeenCalled();
});

test('Staff payment verification opens proof on demand and keeps its verify actions available', async () => {
  getCached.mockImplementation(url => (
    url.includes('/api/bookings/payments/') ? Promise.resolve({ data: [payment] }) : Promise.resolve({ data: [] })
  ));
  client.get.mockImplementation(url => url === '/api/auth/staff-access/me/'
    ? Promise.resolve({ data: staffAccessPolicy })
    : new Promise(() => {}));

  const { unmount } = render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bookings' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Live Inventory' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Daily Sales Logs' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Payment Booking Verification' }));

  const proofButton = await screen.findByRole('button', { name: 'View proof of payment for booking 48' });
  expect(screen.getByRole('button', { name: 'Confirm Payment' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Flag Payment Issue' })).toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalledWith('/api/bookings/payments/18/receipt/', { responseType: 'blob' });
  expect(screen.queryByRole('img', { name: 'Payment proof for booking 48' })).not.toBeInTheDocument();

  fireEvent.click(proofButton);
  expect(await screen.findByRole('dialog', { name: 'Payment proof · Booking #48' })).toBeInTheDocument();
  await waitFor(() => expect(client.get).toHaveBeenCalledWith(
    '/api/bookings/payments/18/receipt/', { responseType: 'blob' },
  ));
  unmount();
});

test('Staff payment filters, proof modal, approval and rejection work inside the responsive fixed panel', async () => {
  const payments = ['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'PENDING_VERIFICATION'].map((status, index) => ({
    id: 70 + index,
    booking: 170 + index,
    amount: '500.00',
    required_down_payment: '500.00',
    method_label: 'GCash',
    reference_number: `REF-${index}`,
    paid_at: '2026-10-28T10:00:00Z',
    status,
    receipt_url: `/api/bookings/payments/${70 + index}/receipt/`,
    verified_by_details: { username: 'Verifier' },
    booking_details: {
      customer_name: `Payment Customer ${index + 1}`,
      customer_email: `customer${index + 1}@example.test`,
      package_name: 'Portrait Session',
      scheduled_date: '2026-11-15',
      scheduled_time: '10:30',
      total_amount: '1000.00', amount_paid: '500.00', remaining_balance: '500.00',
    },
  }));
  const alerts = jest.spyOn(window, 'alert').mockImplementation(() => {});
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  const localBridge = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Local print bridge unavailable.'));
  mockConfirm.mockResolvedValue(true);
  getCached.mockImplementation(url => (
    url === '/api/bookings/payments/' ? Promise.resolve({ data: payments }) : Promise.resolve({ data: [] })
  ));
  client.get.mockImplementation(url => url === '/api/auth/staff-access/me/'
    ? Promise.resolve({ data: staffAccessPolicy })
    : Promise.resolve({ data: new Blob(['proof'], { type: 'image/png' }) }));
  client.patch.mockImplementation((url, payload) => {
    const paymentId = Number(url.match(/payments\/(\d+)\/verify\//)?.[1]);
    const original = payments.find(row => row.id === paymentId);
    return Promise.resolve({ data: { ...original, status: payload.status, verified_by_details: { username: 'Verifier' } } });
  });

  render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Payment Booking Verification' }));

  const filters = await screen.findByRole('group', { name: 'Booking payment status filter' });
  const list = screen.getByLabelText('Booking payment list');
  expect(document.querySelector('main')).toHaveClass('flex', 'min-h-0', 'overflow-hidden');
  expect(document.querySelector('main').parentElement).toHaveClass('h-dvh', 'min-h-0');
  expect(filters).toHaveClass('shrink-0', 'overflow-x-auto');
  expect(list).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
  expect(within(filters).getByRole('button', { name: 'Pending Verification' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Payment Customer 1')).toBeInTheDocument();
  expect(screen.getByText('Payment Customer 4')).toBeInTheDocument();
  expect(screen.queryByText('Payment Customer 2')).not.toBeInTheDocument();

  list.scrollTop = 360;
  fireEvent.click(within(filters).getByRole('button', { name: 'Approved' }));
  expect(list.scrollTop).toBe(0);
  expect(screen.getByText('Payment Customer 2')).toBeInTheDocument();
  expect(screen.queryByText('Payment Customer 1')).not.toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('button', { name: 'Rejected' }));
  expect(screen.getByText('Payment Customer 3')).toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('button', { name: 'All' }));
  expect(screen.getByText('Payment Customer 1')).toBeInTheDocument();
  expect(screen.getByText('Payment Customer 2')).toBeInTheDocument();
  expect(screen.getByText('Payment Customer 3')).toBeInTheDocument();
  expect(within(list).getAllByRole('button', { name: 'Print Receipt' })).toHaveLength(4);

  fireEvent.click(within(list).getAllByRole('button', { name: 'Print Receipt' })[0]);
  const reprintDialog = await screen.findByRole('dialog', { name: 'Booking receipt' });
  expect(within(reprintDialog).getByText('Pending verification')).toBeInTheDocument();
  expect(within(reprintDialog).getByLabelText('Receipt printer')).toBeInTheDocument();
  expect(within(reprintDialog).getByRole('button', { name: 'Detect Printers' })).toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
  expect(localBridge).not.toHaveBeenCalled();
  expect(print).not.toHaveBeenCalled();
  fireEvent.click(within(reprintDialog).getByRole('button', { name: 'Done' }));

  fireEvent.click(screen.getByRole('button', { name: 'View proof of payment for booking 170' }));
  expect(await screen.findByRole('dialog', { name: 'Payment proof · Booking #170' })).toBeInTheDocument();
  await waitFor(() => expect(client.get).toHaveBeenCalledWith('/api/bookings/payments/70/receipt/', { responseType: 'blob' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

  fireEvent.click(within(list).getAllByRole('button', { name: 'Confirm Payment' })[0]);
  await waitFor(() => expect(client.patch).toHaveBeenCalledWith('/api/bookings/payments/70/verify/', { status: 'APPROVED' }));
  const receiptDialog = await screen.findByRole('dialog', { name: 'Booking receipt' });
  expect(within(receiptDialog).getByText(/Booking reference/)).toBeInTheDocument();
  expect(within(receiptDialog).getByText('Approved')).toBeInTheDocument();
  expect(within(receiptDialog).getByText('Remaining balance')).toBeInTheDocument();
  expect(within(receiptDialog).getByRole('button', { name: 'Print Customer Copy' })).toBeInTheDocument();
  expect(alerts).toHaveBeenCalledWith('Payment approved successfully.');
  await waitFor(() => expect(print).toHaveBeenCalled());
  fireEvent.click(within(receiptDialog).getByRole('button', { name: 'Done' }));
  fireEvent.click(within(list).getByRole('button', { name: 'Flag Payment Issue' }));
  await waitFor(() => expect(client.patch).toHaveBeenCalledWith('/api/bookings/payments/73/verify/', { status: 'REJECTED' }));
  expect(screen.getByText('Payment Customer 1').closest('div')).toBeInTheDocument();
  alerts.mockRestore();
  print.mockRestore();
  localBridge.mockRestore();
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
  client.get.mockImplementation((url, { params } = {}) => url === '/api/auth/staff-access/me/'
    ? Promise.resolve({ data: staffAccessPolicy })
    : Promise.resolve({ data: params.type === 'sales' ? [{
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

test('Staff POS cart displays and edits items, completes checkout, and records wastage and refund', async () => {
  const products = [
    { id: 1, name: 'Iced Latte', price: '120.00', stock_level: 20, is_active: true, is_cafe_item: false },
    { id: 2, name: 'Americano', price: '80.00', stock_level: 20, is_active: true, is_cafe_item: false },
  ];
  const alerts = jest.spyOn(window, 'alert').mockImplementation(() => {});
  let transactionRecord = null;
  sessionStorage.setItem('staff:recipesChecked', 'true');
  getCached.mockImplementation((url, config = {}) => Promise.resolve({
    data: url === '/api/inventory/products/'
      ? products
      : url === '/api/pos/orders/' && transactionRecord
        && (!config.params?.customer_name || transactionRecord.customer_name.toLowerCase().includes(config.params.customer_name.toLowerCase()))
        ? [transactionRecord]
        : [],
  }));
  client.get.mockImplementation((url, config = {}) => Promise.resolve({
    data: url === '/api/auth/staff-access/me/'
      ? staffAccessPolicy
      : url === '/api/inventory/products/'
      ? products
      : url === '/api/pos/orders/' && transactionRecord
        && (!config.params?.transaction_id || config.params.transaction_id.toLowerCase() === transactionRecord.transaction_id.toLowerCase())
        ? [transactionRecord]
        : [],
  }));
  client.post.mockImplementation((url, payload) => {
    if (url === '/api/pos/orders/') {
      transactionRecord = {
        id: 20,
        transaction_id: 'POS-TEST-20',
        payment_status: 'PAID',
        total: '80.00',
        subtotal: '80.00',
        discount_amount: '0.00',
        customer_name: payload.customer_name,
        created_at: '2026-11-01T12:00:00Z',
        completed_at: '2026-11-01T12:00:00Z',
        items: [{ id: 1, product: 2, quantity: 1, price: '80.00', subtotal: '80.00', product_details: { name: 'Americano' } }],
        payments: [{ id: 1, amount: '100.00', method: 'CASH', timestamp: '2026-11-01T12:00:00Z' }],
      };
      return Promise.resolve({ data: {
        ...transactionRecord,
        receipt_print: { printed: true },
      } });
    }
    if (url === '/api/pos/stock-actions/') {
      return Promise.resolve({ data: { transaction_id: payload.transaction_id } });
    }
    return Promise.resolve({ data: {} });
  });

  render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Iced Latte to cart' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Americano to cart' }));
  expect(screen.getByLabelText('Customer Name')).toHaveValue('Walk-in Customer');
  fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: 'Taylor Reyes' } });

  const cart = screen.getByRole('list', { name: 'Cart items' });
  const latteRow = within(cart).getByRole('listitem', { name: /Iced Latte/ });
  expect(within(latteRow).getByText(/120\.00 each/)).toBeInTheDocument();
  fireEvent.click(within(latteRow).getByRole('button', { name: 'Increase Iced Latte quantity' }));
  expect(within(latteRow).getByLabelText('Iced Latte quantity')).toHaveTextContent('2');
  fireEvent.click(within(latteRow).getByRole('button', { name: 'Decrease Iced Latte quantity' }));
  expect(within(latteRow).getByLabelText('Iced Latte quantity')).toHaveTextContent('1');
  fireEvent.click(within(latteRow).getByRole('button', { name: 'Remove Iced Latte from cart' }));
  expect(within(cart).queryByText('Iced Latte')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Complete Sale - PHP 80.00' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Amount Received'), { target: { value: '100' } });
  mockConfirm.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Complete Sale - PHP 80.00' }));
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/pos/orders/', expect.objectContaining({
    items: [{ product_id: 2, quantity: 1, discount: { type: 'PERCENT', value: 0 } }],
    customer_name: 'Taylor Reyes',
    payment: expect.objectContaining({ amount: 100, method: 'CASH' }),
  })));
  expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Wastage' }));
  const wastageDialog = await screen.findByRole('dialog', { name: 'Record Wastage' });
  fireEvent.change(within(wastageDialog).getByLabelText('Transaction ID'), { target: { value: 'POS-TEST-20' } });
  fireEvent.click(within(wastageDialog).getByRole('button', { name: 'Load sale items' }));
  await within(wastageDialog).findByText(/Eligible products from POS-TEST-20/);
  fireEvent.change(within(wastageDialog).getByLabelText('Reason'), { target: { value: 'Preparation spill' } });
  fireEvent.click(await within(wastageDialog).findByRole('button', { name: /Americano Add/ }));
  fireEvent.click(within(wastageDialog).getByRole('button', { name: 'Confirm Wastage' }));
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/pos/stock-actions/', expect.objectContaining({
    action_type: 'WASTAGE',
    transaction_id: 'POS-TEST-20',
    items: [{ product_id: 2, quantity: 1 }],
  })));

  fireEvent.click(screen.getByRole('button', { name: 'Refund' }));
  const refundDialog = await screen.findByRole('dialog', { name: 'Record Refund' });
  fireEvent.change(within(refundDialog).getByLabelText('Transaction ID'), { target: { value: 'POS-TEST-20' } });
  fireEvent.click(within(refundDialog).getByRole('button', { name: 'Load sale items' }));
  await within(refundDialog).findByText(/Eligible products from POS-TEST-20/);
  fireEvent.change(within(refundDialog).getByLabelText('Reason'), { target: { value: 'Customer return' } });
  fireEvent.click(await within(refundDialog).findByRole('button', { name: /Americano Add/ }));
  fireEvent.change(within(refundDialog).getByLabelText('Americano restock disposition'), { target: { value: 'RESTOCKED' } });
  fireEvent.click(within(refundDialog).getByRole('button', { name: 'Confirm Refund' }));
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/pos/stock-actions/', expect.objectContaining({
    action_type: 'REFUND',
    transaction_id: 'POS-TEST-20',
    items: [{ product_id: 2, quantity: 1, disposition: 'RESTOCKED' }],
  })));

  fireEvent.click(screen.getByRole('button', { name: 'Daily Sales Logs' }));
  expect(await screen.findByRole('heading', { name: 'Daily Sales Logs' })).toBeInTheDocument();
  const customerSearch = screen.getByRole('textbox', { name: 'Search transactions by customer name' });
  fireEvent.change(customerSearch, { target: { value: 'Taylor' } });
  const transactionRow = await screen.findByRole('row', { name: /Taylor Reyes/ });
  expect(transactionRow).toHaveTextContent('POS-TEST-20');
  fireEvent.click(transactionRow);
  const details = await screen.findByRole('dialog', { name: 'Transaction Details & Receipt' });
  expect(details).toHaveTextContent('Taylor Reyes');
  fireEvent.click(within(details).getByRole('button', { name: 'Back to Sales Log' }));
  fireEvent.change(customerSearch, { target: { value: 'Unmatched Name' } });
  expect(await screen.findByText('No transactions')).toBeInTheDocument();
  alerts.mockRestore();
}, 20000);

test('Bookings keeps its viewport-sized table region and page controls in place while loading', async () => {
  const booking = {
    id: 48,
    customer_name: 'Jamie Reyes',
    customer_email: 'jamie@example.test',
    package: 3,
    package_details: { name: 'Portrait Session' },
    scheduled_date: '2026-11-15',
    scheduled_time: '10:30',
    status: 'CONFIRMED',
    payments: [],
    is_walk_in: true,
    created_by_name: 'Jamie Cashier',
  };
  let resolveBookings;
  sessionStorage.setItem('staff:recipesChecked', 'true');
  getCached.mockImplementation(url => {
    if (url === '/api/bookings/') return new Promise(resolve => { resolveBookings = resolve; });
    return Promise.resolve({ data: [] });
  });

  render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));

  expect(await screen.findByRole('heading', { name: 'Bookings' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Walk-in Booking' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Refresh bookings' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Loading bookings' })).toBeInTheDocument();
  const tableRegion = screen.getByRole('region', { name: 'Bookings table' });
  const regionClassesWhileLoading = tableRegion.className;
  expect(tableRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden');
  expect(tableRegion.querySelector('.overflow-y-auto')).toBeInTheDocument();
  expect(tableRegion.querySelector('thead')).toHaveClass('sticky', 'top-0');
  expect(screen.getByRole('heading', { name: 'Bookings' }).closest('main')).toHaveClass('overflow-hidden');
  expect(screen.getByRole('heading', { name: 'Bookings' }).closest('main').parentElement).toHaveClass('h-dvh', 'min-h-0');

  await act(async () => resolveBookings({ data: [booking] }));
  expect(await screen.findByText('Jamie Reyes')).toBeInTheDocument();
  expect(tableRegion.className).toBe(regionClassesWhileLoading);
  expect(screen.getByRole('button', { name: 'Walk-in Booking' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Refresh bookings' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Booking' })).toBeVisible();
});
