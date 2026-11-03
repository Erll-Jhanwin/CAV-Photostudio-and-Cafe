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

jest.setTimeout(30000);

beforeEach(() => {
  mockConfirm.mockReset();
  mockConfirm.mockResolvedValue(false);
  getCached.mockReset().mockResolvedValue({ data: [] });
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

  const customerButton = await screen.findByRole('button', { name: 'Open booking 48 details for Jamie Reyes' });
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalledWith('/api/bookings/payments/18/receipt/', { responseType: 'blob' });
  expect(screen.queryByRole('img', { name: 'Payment proof for booking 48' })).not.toBeInTheDocument();

  fireEvent.click(customerButton);
  const detailsDialog = await screen.findByRole('dialog', { name: 'Booking #48 · Payment details' });
  expect(within(detailsDialog).getAllByText('PHP 1,250').length).toBeGreaterThan(0);
  expect(within(detailsDialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  expect(within(detailsDialog).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  fireEvent.click(within(detailsDialog).getByRole('button', { name: 'View proof of payment for booking 48' }));
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
      customer_phone: '09171234567',
      package_name: 'Portrait Session',
      service_name: 'Studio',
      scheduled_date: '2026-11-15',
      scheduled_time: '10:30',
      status: 'PENDING',
      notes: 'Bring a printed reference photo.',
      total_amount: '1000.00', amount_paid: '500.00', remaining_balance: '500.00',
    },
    created_at: '2026-10-27T10:00:00Z',
    updated_at: '2026-10-28T10:00:00Z',
    verification_history: [{ id: 1, action: 'BOOKING_PAYMENT_SUBMIT', actor_name: 'Payment Customer', description: `Submitted payment #${70 + index} for booking #${170 + index}.`, timestamp: '2026-10-28T10:00:00Z' }],
  }));
  const alerts = jest.spyOn(window, 'alert').mockImplementation(() => {});
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  const localBridge = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Local print bridge unavailable.'));
  mockConfirm.mockResolvedValue(true);
  getCached.mockImplementation((url, { params = {} } = {}) => {
    if (url !== '/api/bookings/payments/') return Promise.resolve({ data: [] });
    const matching = params.status ? payments.filter(row => row.status === params.status) : payments;
    const offset = Number(params.offset || 0);
    const limit = Number(params.limit || 100);
    return Promise.resolve({ data: { count: matching.length, results: matching.slice(offset, offset + limit) } });
  });
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
  expect(filters).toHaveClass('shrink-0', 'grid-cols-2', 'sm:flex');
  expect(list).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
  expect(within(filters).getByRole('button', { name: 'Pending Verification' })).toHaveAttribute('aria-pressed', 'true');
  expect(getCached).toHaveBeenCalledWith('/api/bookings/payments/', {
    params: { limit: 10, offset: 0, include_count: 'true', status: 'PENDING_VERIFICATION' },
  }, { force: false });
  expect(getCached.mock.calls.filter(([url]) => url === '/api/bookings/payments/')).toHaveLength(1);
  expect(screen.getByText('Payment Customer 1')).toBeInTheDocument();
  expect(screen.getByText('Payment Customer 4')).toBeInTheDocument();
  expect(screen.queryByText('Payment Customer 2')).not.toBeInTheDocument();

  list.scrollTop = 360;
  fireEvent.click(within(filters).getByRole('button', { name: 'Approved' }));
  await waitFor(() => expect(getCached).toHaveBeenCalledWith('/api/bookings/payments/', {
    params: { limit: 10, offset: 0, include_count: 'true', status: 'APPROVED' },
  }, { force: false }));
  expect(list.scrollTop).toBe(0);
  expect(await screen.findByText('Payment Customer 2')).toBeInTheDocument();
  expect(screen.queryByText('Payment Customer 1')).not.toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('button', { name: 'Rejected' }));
  await screen.findByText('Payment Customer 3');
  expect(await screen.findByText('Payment Customer 3')).toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('button', { name: 'All' }));
  await screen.findByText('Payment Customer 1');
  expect(await screen.findByText('Payment Customer 1')).toBeInTheDocument();
  expect(screen.getByText('Payment Customer 2')).toBeInTheDocument();
  expect(screen.getByText('Payment Customer 3')).toBeInTheDocument();
  expect(within(list).getAllByRole('button', { name: /Open booking .* details/ })).toHaveLength(4);
  expect(within(list).queryByRole('button', { name: 'Print Receipt' })).not.toBeInTheDocument();

  const selectedCustomerButton = within(list).getByRole('button', { name: 'Open booking 170 details for Payment Customer 1' });
  selectedCustomerButton.focus();
  fireEvent.click(selectedCustomerButton);
  const bookingDialog = await screen.findByRole('dialog', { name: 'Booking #170 · Payment details' });
  expect(within(bookingDialog).getByText('Payment Customer 1')).toBeInTheDocument();
  expect(within(bookingDialog).getByText('Bring a printed reference photo.')).toBeInTheDocument();
  expect(within(bookingDialog).getByText('REF-0')).toBeInTheDocument();
  expect(within(bookingDialog).getByRole('heading', { name: 'Verification history' })).toBeInTheDocument();
  expect(within(bookingDialog).getByText(/Payment submitted/)).toBeInTheDocument();
  expect(within(bookingDialog).getByRole('button', { name: 'Print Receipt' })).toBeInTheDocument();
  expect(within(bookingDialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  expect(within(bookingDialog).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  fireEvent.click(within(bookingDialog).getByRole('button', { name: 'Print Receipt' }));
  const reprintDialog = await screen.findByRole('dialog', { name: 'Booking receipt' });
  expect(within(reprintDialog).getByText('Pending verification')).toBeInTheDocument();
  expect(within(reprintDialog).getByLabelText('Receipt printer')).toBeInTheDocument();
  expect(within(reprintDialog).getByRole('button', { name: 'Detect Printers' })).toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
  expect(localBridge).not.toHaveBeenCalled();
  expect(print).not.toHaveBeenCalled();
  fireEvent.click(within(reprintDialog).getByRole('button', { name: 'Done' }));

  fireEvent.click(within(bookingDialog).getByRole('button', { name: 'View proof of payment for booking 170' }));
  expect(await screen.findByRole('dialog', { name: 'Payment proof · Booking #170' })).toBeInTheDocument();
  await waitFor(() => expect(client.get).toHaveBeenCalledWith('/api/bookings/payments/70/receipt/', { responseType: 'blob' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Payment proof · Booking #170' })).getByRole('button', { name: 'Close modal' }));

  fireEvent.click(within(bookingDialog).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(client.patch).toHaveBeenCalledWith('/api/bookings/payments/70/verify/', { status: 'APPROVED' }));
  const receiptDialog = await screen.findByRole('dialog', { name: 'Booking receipt' });
  expect(within(receiptDialog).getByText(/Booking reference/)).toBeInTheDocument();
  expect(within(receiptDialog).getByText('Approved')).toBeInTheDocument();
  expect(within(receiptDialog).getByText('Remaining balance')).toBeInTheDocument();
  expect(within(receiptDialog).getByRole('button', { name: 'Print Customer Copy' })).toBeInTheDocument();
  expect(alerts).toHaveBeenCalledWith('Payment approved successfully.');
  await waitFor(() => expect(print).toHaveBeenCalled());
  fireEvent.click(within(receiptDialog).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(within(bookingDialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument());
  expect(within(bookingDialog).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  fireEvent.click(within(bookingDialog).getByRole('button', { name: 'Close modal' }));
  expect(document.activeElement).toBe(selectedCustomerButton);
  list.scrollTop = 360;
  fireEvent.click(within(list).getByRole('button', { name: 'Open booking 173 details for Payment Customer 4' }));
  const pendingDialog = await screen.findByRole('dialog', { name: 'Booking #173 · Payment details' });
  expect(within(pendingDialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  fireEvent.click(within(pendingDialog).getByRole('button', { name: 'Reject' }));
  await waitFor(() => expect(client.patch).toHaveBeenCalledWith('/api/bookings/payments/73/verify/', { status: 'REJECTED' }));
  expect(list.scrollTop).toBe(360);
  expect(within(filters).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  alerts.mockRestore();
  print.mockRestore();
  localBridge.mockRestore();
});

test('Staff payment pages request only the selected status and current offset', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...payment,
    id: 100 + index,
    booking: 200 + index,
    reference_number: `PAGE-${index}`,
    status: 'PENDING_VERIFICATION',
    booking_details: { ...payment.booking_details, customer_name: `Page Customer ${index + 1}` },
  }));
  getCached.mockImplementation((url, { params = {} } = {}) => {
    if (url !== '/api/bookings/payments/') return Promise.resolve({ data: [] });
    const matching = params.status ? rows.filter(row => row.status === params.status) : rows;
    const offset = Number(params.offset || 0);
    return Promise.resolve({ data: { count: matching.length, results: matching.slice(offset, offset + Number(params.limit || 10)) } });
  });

  render(<StaffDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Payment Booking Verification' }));
  expect(await screen.findByText('Page Customer 1')).toBeInTheDocument();
  expect(screen.queryByText('Page Customer 11')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('Page Customer 11')).toBeInTheDocument();
  expect(screen.queryByText('Page Customer 1')).not.toBeInTheDocument();
  expect(getCached).toHaveBeenCalledWith('/api/bookings/payments/', {
    params: { limit: 10, offset: 10, include_count: 'true', status: 'PENDING_VERIFICATION' },
  }, { force: false });
});

test('Same-name customers open the payment record for the selected booking ID', async () => {
  const sameCustomerPayments = [170, 171].map((bookingId, index) => ({
    ...payment,
    id: 270 + index,
    booking: bookingId,
    status: 'APPROVED',
    booking_details: {
      ...payment.booking_details,
      customer_name: 'Jamie Reyes',
      scheduled_date: `2026-11-${15 + index}`,
    },
  }));
  getCached.mockImplementation(url => url === '/api/bookings/payments/'
    ? Promise.resolve({ data: { count: 2, results: sameCustomerPayments } })
    : Promise.resolve({ data: [] }));

  render(<StaffDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Payment Booking Verification' }));
  const list = await screen.findByLabelText('Booking payment list');
  const selectedBookingButton = within(list).getByRole('button', { name: 'Open booking 171 details for Jamie Reyes' });
  selectedBookingButton.focus();
  fireEvent.click(selectedBookingButton);

  const details = await screen.findByRole('dialog', { name: 'Booking #171 · Payment details' });
  expect(within(details).getAllByText(/2026-11-16/).length).toBeGreaterThan(0);
  expect(within(details).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  expect(within(details).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  expect(within(details).getByRole('button', { name: 'Print Receipt' })).toBeInTheDocument();
});

test('Staff payment verification remains compact at desktop and mobile viewport widths', async () => {
  const originalWidth = window.innerWidth;
  getCached.mockImplementation(url => url === '/api/bookings/payments/'
    ? Promise.resolve({ data: { count: 1, results: [payment] } })
    : Promise.resolve({ data: [] }));
  for (const width of [1280, 390]) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    const { unmount } = render(<StaffDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Payment Booking Verification' }));
    const filters = await screen.findByRole('group', { name: 'Booking payment status filter' });
    const list = screen.getByLabelText('Booking payment list');
    expect(within(filters).getAllByRole('button')).toHaveLength(4);
    expect(filters).toHaveClass('grid-cols-2', 'sm:flex');
    expect(filters.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list).toHaveClass('overflow-y-auto', 'min-h-0');
    const customerButton = await within(list).findByRole('button', { name: 'Open booking 48 details for Jamie Reyes' });
    customerButton.focus();
    fireEvent.click(customerButton);
    const details = await screen.findByRole('dialog', { name: 'Booking #48 · Payment details' });
    expect(details.querySelector('.overflow-y-auto')).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: 'Print Receipt' })).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Close modal' }));
    expect(document.activeElement).toBe(customerButton);
    unmount();
  }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

test('Staff payment verification explains when the selected status has no results', async () => {
  getCached.mockResolvedValue({ data: { count: 0, results: [] } });
  render(<StaffDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Payment Booking Verification' }));
  expect(await screen.findByText('No payments match this filter')).toBeInTheDocument();
  expect(screen.getByText('Try another payment status or refresh the verification list.')).toBeInTheDocument();
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

test('Staff Live Inventory shows loading until its inventory request completes', async () => {
  let resolveInventoryRequest;
  const inventoryRequest = new Promise(resolve => { resolveInventoryRequest = resolve; });
  getCached.mockImplementation(url => url === '/api/inventory/ingredients/'
    ? inventoryRequest
    : Promise.resolve({ data: [] }));

  render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Live Inventory' }));
  expect(await screen.findByRole('heading', { name: 'Loading inventory' })).toBeInTheDocument();

  await act(async () => {
    resolveInventoryRequest({ data: [] });
  });
  expect(await screen.findByRole('heading', { name: 'No ingredients found' })).toBeInTheDocument();
});

test('Staff Live Inventory shows a recoverable error and retries the inventory request', async () => {
  let failInventoryRequests = true;
  getCached.mockImplementation(url => {
    if (url === '/api/inventory/ingredients/' && failInventoryRequests) {
      return Promise.reject(new Error('inventory request failed'));
    }
    return Promise.resolve({ data: [] });
  });

  render(<StaffDashboard />);
  expect(await screen.findByRole('heading', { name: 'POS Terminal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Live Inventory' }));
  expect(await screen.findByRole('heading', { name: 'Inventory unavailable' })).toBeInTheDocument();
  expect(screen.getByText('Connection Error')).toBeInTheDocument();

  failInventoryRequests = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect Dashboard' }));
  expect(await screen.findByRole('heading', { name: 'No ingredients found' })).toBeInTheDocument();
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
  fireEvent.change(within(latteRow).getByLabelText('Iced Latte discount'), { target: { value: '10' } });
  expect(screen.getByText('-PHP 12.00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Complete Sale - PHP 188.00' })).toBeInTheDocument();
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
  expect(client.post.mock.calls.find(([url]) => url === '/api/pos/orders/')[1]).not.toHaveProperty('discount');
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

test('Bookings keeps its queue inside the viewport while data loads', async () => {
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
  expect(screen.getByRole('status', { name: 'Loading bookings' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Bookings' }).closest('main')).toHaveClass('overflow-hidden');
  expect(screen.getByRole('heading', { name: 'Bookings' }).closest('main').parentElement).toHaveClass('h-dvh', 'min-h-0');

  await act(async () => resolveBookings({ data: [booking] }));
  expect(await screen.findByText('Jamie Reyes')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Live Booking List' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Walk-in Booking' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Refresh bookings' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Photo Shoot Done' })).toBeVisible();
});
