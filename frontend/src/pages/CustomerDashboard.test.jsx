import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import client, { getCached } from '../api/client';
import { getManilaMonthValue } from '../utils/dateTime';
import CustomerDashboard from './CustomerDashboard';

jest.setTimeout(30000);
afterEach(() => jest.restoreAllMocks());

const mockUser = { id: 5, username: 'test-customer', first_name: 'Test', last_name: 'Customer', email: 'customer@example.test', phone_number: '09171234567', role: 'CUSTOMER' };
const mockUpdateUser = jest.fn();
const mockConfirm = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser, updateStoredUser: mockUpdateUser, logout: jest.fn() }) }));
jest.mock('../components/ui/StyledAlert', () => ({ useStyledConfirm: () => mockConfirm }));
jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  DATA_CHANGED_EVENT: 'cav:data-changed',
  getApiErrorMessage: (_error, fallback) => fallback,
  getCached: jest.fn(),
}));

const date = `${getManilaMonthValue()}-28`;
const pkg = { id: 3, service: 2, name: 'Solo Test', price: '1000', description: 'One person' };
const service = { id: 2, name: 'Studio Session', base_price: '1000', duration_minutes: 60, packages: [pkg] };
const booking = { id: 42, package: 3, package_name: pkg.name, service_name: service.name, scheduled_date: date, scheduled_time: '09:00', status: 'PENDING', payments: [], total_price: '1000', customer: mockUser };

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', '/');
  window.alert = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:test');
  URL.revokeObjectURL = jest.fn();
  mockConfirm.mockResolvedValue(true);
  getCached.mockImplementation(url => Promise.resolve({ data: url === '/api/bookings/services/' ? [service] : [] }));
  client.get.mockImplementation((url, options) => Promise.resolve({ data: url === '/api/bookings/payment-methods/'
    ? { methods: [{ code: 'GCASH', label: 'GCash', qr_url: '/gcash-qr.png', configured: true }] }
    : url === '/api/bookings/services/' ? [service]
      : url === '/api/bookings/' ? []
        : url === '/api/auth/profile/' ? mockUser
          : url.includes('reference-check') ? { exists: false }
            : options?.params?.month
              ? { dates: [{ date, status: 'AVAILABLE', available_count: 1 }] }
              : { date, slots: [{ time: '09:00', label: '9:00 AM', available: true }, { time: '10:00', label: '10:00 AM', available: false, status: 'BOOKED' }] },
  }));
});

test('shows the customer dashboard while the supplemental profile refresh is still pending', async () => {
  let resolveProfile;
  client.get.mockImplementation(url => {
    if (url === '/api/auth/profile/') {
      return new Promise(resolve => { resolveProfile = resolve; });
    }
    if (url === '/api/bookings/services/') return Promise.resolve({ data: [service] });
    if (url === '/api/bookings/') return Promise.resolve({ data: [] });
    if (url === '/api/bookings/payment-methods/') return Promise.resolve({ data: { methods: [] } });
    return Promise.resolve({ data: [] });
  });

  render(<CustomerDashboard />);

  expect(await screen.findByRole('button', { name: 'Book a Session' })).toBeInTheDocument();
  expect(resolveProfile).toBeDefined();
});

test('My Photos groups booking attachments and opens the image, ZIP, and Drive delivery types', async () => {
  const defaultGet = client.get.getMockImplementation();
  let rejectZipDownload = false;
  client.get.mockImplementation((url, options) => {
    if (url === '/api/gallery/customer-photos/') return Promise.resolve({ data: [
      {
        id: 201, booking_id: 88, booking_scheduled_date: '2026-10-20', booking_scheduled_time: '14:00:00',
        package_name: 'Studio Portrait', title: 'Finished portraits', attachment_type: 'IMAGE',
        download_url: '/api/gallery/customer-photos/201/download/', created_at: '2026-10-21T10:00:00Z',
      },
      {
        id: 202, booking_id: 88, booking_scheduled_date: '2026-10-20', booking_scheduled_time: '14:00:00',
        package_name: 'Studio Portrait', title: 'Full resolution archive', attachment_type: 'ZIP', file_name: 'session.zip',
        download_url: '/api/gallery/customer-photos/202/download/', created_at: '2026-10-21T10:01:00Z',
      },
      {
        id: 203, booking_id: 88, booking_scheduled_date: '2026-10-20', booking_scheduled_time: '14:00:00',
        package_name: 'Studio Portrait', title: 'Online gallery', attachment_type: 'GOOGLE_DRIVE',
        drive_url: 'https://drive.google.com/file/d/Abc_123/view', created_at: '2026-10-21T10:02:00Z',
      },
    ] });
    if (String(url).includes('/download-all/')) {
      if (rejectZipDownload) {
        rejectZipDownload = false;
        return Promise.reject(new Error('download failed'));
      }
      return Promise.resolve({ data: new Blob(['zip-file']) });
    }
    if (String(url).includes('/download/')) return Promise.resolve({ data: new Blob(['file']) });
    return defaultGet(url, options);
  });
  const openWindow = jest.spyOn(window, 'open').mockImplementation(() => null);
  const downloadClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: 'My Photos' }));
  expect(await screen.findByText('Studio Portrait')).toBeInTheDocument();
  expect(screen.getByText('2026-10-20 · 14:00')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: 'View', exact: true })[0]);
  const galleryDialog = await screen.findByRole('dialog', { name: 'Session photos · Booking #88' });
  expect(await screen.findByRole('img', { name: 'Finished portraits' })).toBeInTheDocument();
  fireEvent.click(within(galleryDialog).getByRole('button', { name: 'Download All Photos' }));
  await waitFor(() => expect(client.get).toHaveBeenCalledWith('/api/gallery/customer-photos/booking/88/download-all/', { responseType: 'blob' }));
  await waitFor(() => expect(downloadClick).toHaveBeenCalled());
  rejectZipDownload = true;
  fireEvent.click(within(galleryDialog).getByRole('button', { name: 'Download All Photos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('We could not create or download the ZIP. Please try again.');
  fireEvent.click(within(galleryDialog).getByRole('button', { name: 'Open Google Drive' }));
  expect(openWindow).toHaveBeenCalledWith('https://drive.google.com/file/d/Abc_123/view', '_blank', 'noopener,noreferrer');
  fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

  fireEvent.click(screen.getByRole('button', { name: 'View ZIP' }));
  await waitFor(() => expect(client.get).toHaveBeenCalledWith('/api/gallery/customer-photos/202/download/', { responseType: 'blob' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Open Google Drive', exact: true })[0]);
  expect(openWindow).toHaveBeenCalledTimes(2);
});

async function fillPayment(container) {
  fireEvent.change(screen.getByLabelText('GCash Reference No.'), { target: { value: 'GCASH-TEST-001' } });
  fireEvent.change(screen.getByLabelText('Amount Paid'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('Payment Date'), { target: { value: '2026-10-18' } });
  fireEvent.change(screen.getByLabelText('Payment Time'), { target: { value: '12:30' } });
}

async function completeWizard() {
  const { container } = render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: /Studio Session.*Select/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue Booking' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select Solo Test package' }));
  const day = await screen.findByTitle(`${date} - AVAILABLE`);
  await waitFor(() => expect(day).toBeEnabled());
  fireEvent.click(day);
  fireEvent.click(await screen.findByRole('button', { name: '9:00 AM' }));
  expect(screen.getByRole('button', { name: /10:00 AM Booked/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue Booking' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue Booking' }));
  await fillPayment(container);
  expect(screen.getAllByText('PHP 200')).toHaveLength(2);
  expect(screen.getByText('A minimum down payment of ₱200 is required to confirm your booking. The remaining balance is payable separately.')).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'GCash payment QR code' })).toHaveAttribute('src', '/gcash-qr.png');
  return container;
}

test('available slot completes the wizard and sends Manila payment timestamp and idempotency keys', async () => {
  client.post.mockImplementation(async url => ({ data: url === '/api/bookings/' ? booking : { id: 7, booking: 42, reference_number: 'GCASH-TEST-001', amount: '200.00', status: 'PENDING_VERIFICATION' } }));
  await completeWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Booking submitted successfully.'));
  expect(await screen.findByText('Submitted for verification')).toBeInTheDocument();
  expect(client.post).toHaveBeenCalledTimes(2);
  expect(client.post.mock.calls[0][1]).toMatchObject({ scheduled_date: date, scheduled_time: '09:00', idempotency_key: expect.any(String) });
  const payment = client.post.mock.calls[1][1];
  expect(payment).toMatchObject({
    booking: 42,
    reference_number: 'GCASH-TEST-001',
    amount: '200.00',
    paid_at: '2026-10-18T04:30:00.000Z',
    method: 'GCASH',
    idempotency_key: expect.any(String),
  });
  expect(payment).not.toHaveProperty('receipt');
});

test('selected payment proof is sent as multipart data for private storage', async () => {
  client.post.mockImplementation(async url => ({ data: url === '/api/bookings/' ? booking : { id: 7, booking: 42, reference_number: 'GCASH-TEST-001', amount: '200.00', status: 'PENDING_VERIFICATION' } }));
  const container = await completeWizard();
  const proof = new File(['proof bytes'], 'transfer.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText(/Payment Proof/), { target: { files: [proof] } });
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Booking submitted successfully.'));
  const request = client.post.mock.calls.find(([url]) => url === '/api/bookings/payments/')[1];
  expect(request).toBeInstanceOf(FormData);
  expect(request.get('receipt')).toBe(proof);
  expect(request.get('reference_number')).toBe('GCASH-TEST-001');
  expect(container.querySelector('input[type="file"]')).toBeTruthy();
});

test('booking submission rejects a missing payment reference or amount before saving a booking', async () => {
  const container = await completeWizard();
  fireEvent.change(screen.getByLabelText('GCash Reference No.'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Amount Paid'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Please enter the payment method, reference number, amount, date, and time.'));
  expect(client.post).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="file"][aria-label="Payment proof image"]')).toBeNull();
});

test('lost payment response keeps the saved booking and retries only payment with the same key', async () => {
  let paymentCalls = 0;
  client.post.mockImplementation(async url => {
    if (url === '/api/bookings/') return { data: booking };
    if (++paymentCalls === 1) throw new Error('Network Error');
    return { data: { id: 7, status: 'PENDING_VERIFICATION' } };
  });
  await completeWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Booking #42 was saved, but we could not confirm the payment submission.')));
  // The server may already have saved the reference. This preflight must not
  // prevent the idempotent replay of the uncertain payment request.
  client.get.mockResolvedValue({ data: { exists: true, date, slots: [] } });
  const realNow = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 2000);
  fireEvent.click(screen.getByRole('button', { name: /Retry Payment for Booking #42/ }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Booking submitted successfully.'));
  clock.mockRestore();
  const bookingCalls = client.post.mock.calls.filter(([url]) => url === '/api/bookings/');
  const payments = client.post.mock.calls.filter(([url]) => url === '/api/bookings/payments/').map(([, body]) => body);
  expect(bookingCalls).toHaveLength(1);
  expect(payments).toHaveLength(2);
  expect(payments[0].idempotency_key).toBe(payments[1].idempotency_key);
  expect(payments[1].booking).toBe(42);
});

test('when payment saved but its response dropped, status lookup confirms it without retrying', async () => {
  let paymentCalls = 0;
  const fallbackGet = client.get.getMockImplementation();
  client.post.mockImplementation(async url => {
    if (url === '/api/bookings/') return { data: booking };
    paymentCalls += 1;
    throw new Error('Network Error');
  });
  client.get.mockImplementation((url, options) => {
    if (url === '/api/bookings/payments/' && options?.params?.booking === 42) {
      return Promise.resolve({ data: [{
        id: 7, booking: 42, reference_number: 'GCASH-TEST-001', amount: '200.00', status: 'PENDING_VERIFICATION',
      }] });
    }
    return fallbackGet(url, options);
  });
  await completeWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  expect(await screen.findByText('Submitted for verification')).toBeInTheDocument();
  expect(paymentCalls).toBe(1);
  expect(client.post.mock.calls.filter(([url]) => url === '/api/bookings/')).toHaveLength(1);
});

test('a genuine backend slot conflict is shown and never submits payment', async () => {
  client.post.mockRejectedValue({ response: { status: 409, data: { scheduled_time: 'This schedule was just booked. Please select another available time slot.' } } });
  await completeWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('This schedule was just booked.')));
  expect(client.post).toHaveBeenCalledTimes(1);
});

test('booking history resumes a saved booking without creating another reservation', async () => {
  window.history.replaceState({}, '', '/?tab=history');
  const cached = getCached.getMockImplementation();
  getCached.mockImplementation(url => url === '/api/bookings/' ? Promise.resolve({ data: [booking] }) : cached(url));
  client.get.mockImplementation((url, options) => Promise.resolve({ data: url === '/api/bookings/payment-methods/'
    ? { methods: [{ code: 'GCASH', label: 'GCash', qr_url: '/gcash-qr.png', configured: true }] }
    : url === '/api/bookings/services/' ? [service]
      : url === '/api/bookings/' ? [booking]
        : url === '/api/auth/profile/' ? mockUser
          : url.includes('reference-check') ? { exists: false }
            : options?.params?.month ? { dates: [{ date, status: 'AVAILABLE', available_count: 1 }] }
              : { date, slots: [{ time: '09:00', label: '9:00 AM', available: true }] },
  }));
  client.post.mockResolvedValue({ data: { id: 7, status: 'PENDING_VERIFICATION' } });
  const { container } = render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: /Submit Payment Reference for/ }));
  await fillPayment(container);
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Booking submitted successfully.'));
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(client.post.mock.calls[0][0]).toBe('/api/bookings/payments/');
  expect(client.post.mock.calls[0][1].booking).toBe(42);
});

test('a booking ID in the home handoff opens that exact booking from history', async () => {
  window.history.replaceState({}, '', '/?tab=history&booking=42');
  client.get.mockImplementation((url, options) => {
    if (url === '/api/bookings/') return Promise.resolve({ data: [{
      ...booking,
      package_details: { ...pkg, service: { name: service.name } },
      customer_name: 'Test Customer',
      customer_email: mockUser.email,
      customer_phone: mockUser.phone_number,
    }] });
    if (url === '/api/bookings/payment-methods/') return Promise.resolve({ data: { methods: [] } });
    if (url === '/api/auth/profile/') return Promise.resolve({ data: mockUser });
    return Promise.resolve({ data: [] });
  });

  render(<CustomerDashboard />);

  const details = await screen.findByRole('dialog', { name: 'Booking Details' });
  expect(within(details).getByText('Solo Test')).toBeInTheDocument();
  expect(within(details).getByText(`${date} at 09:00`)).toBeInTheDocument();
});

test('booking history filters canonical statuses and shows matching status counts', async () => {
  window.history.replaceState({}, '', '/?tab=history');
  const rows = [
    { ...booking, id: 51, status: 'PENDING' },
    { ...booking, id: 52, status: 'CONFIRMED_DP' },
    { ...booking, id: 53, status: 'COMPLETED' },
    { ...booking, id: 54, status: 'CANCELLED' },
  ];
  client.get.mockImplementation((url, options) => Promise.resolve({ data: url === '/api/bookings/payment-methods/'
    ? { methods: [] }
    : url === '/api/bookings/services/' ? [service]
      : url === '/api/bookings/' ? rows
        : url === '/api/auth/profile/' ? mockUser
          : options?.params?.month ? { dates: [] } : { date, slots: [] },
  }));
  render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: /Booking History/ }));
  expect(await screen.findByRole('button', { name: 'Pending 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Verified 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Completed 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Canceled 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Verified 1' }));
  expect(await screen.findByText('Confirmed - Down Payment Received')).toBeInTheDocument();
  expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
});

test('notification status and type filters combine immediately and preserve unread counts', async () => {
  const notificationRows = [
    { id: 81, notification_type: 'BOOKING_CREATED', title: 'Booking request received', message: 'We received your request.', is_read: false, created_at: '2026-10-20T04:00:00Z' },
    { id: 82, booking_id: 242, notification_type: 'BOOKING_PAYMENT_APPROVED', title: 'Payment approved', message: 'Your payment is approved. Booking #242 payment received: PHP 500.', is_read: false, created_at: '2026-10-20T05:00:00Z' },
    { id: 83, notification_type: 'BOOKING_PAYMENT_REJECTED', title: 'Payment needs review', message: 'Please check your payment.', is_read: true, created_at: '2026-10-20T06:00:00Z' },
  ];
  const defaultGet = client.get.getMockImplementation();
  client.get.mockImplementation((url, options) => url === '/api/notifications/'
    ? Promise.resolve({ data: notificationRows })
    : defaultGet(url, options));
  const defaultCachedGet = getCached.getMockImplementation();
  getCached.mockImplementation((url, ...args) => url === '/api/notifications/'
    ? Promise.resolve({ data: notificationRows })
    : defaultCachedGet(url, ...args));
  client.patch.mockImplementation(async () => {
    notificationRows.find(row => row.id === 82).is_read = true;
    return { data: { is_read: true } };
  });

  render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
  expect(await screen.findByRole('button', { name: 'Unread notification: Booking request received' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.change(screen.getByLabelText('Filter by notification type'), { target: { value: 'Payment' } });
  expect(screen.queryByText('Booking request received')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Read 1' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Read 1' }));
  expect(await screen.findByRole('button', { name: 'Read notification: Payment needs review' })).toBeInTheDocument();
  expect(screen.queryByText('Payment approved')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Unread 2' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Unread notification: Payment approved' }));
  const detailDialog = await screen.findByRole('dialog', { name: 'Payment approved' });
  expect(within(detailDialog).getByText('Your payment is approved. Booking #242 payment received: PHP 500.')).toBeInTheDocument();
  expect(within(detailDialog).getByText('Booking #242')).toBeInTheDocument();
  expect(within(detailDialog).getByText('Received')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('No notifications match these filters')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Unread 1' })).toBeInTheDocument();
  expect(client.patch).toHaveBeenCalledWith('/api/notifications/82/read/');

  fireEvent.click(within(detailDialog).getByRole('button', { name: 'Close modal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByRole('button', { name: 'Unread notification: Booking request received' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Read notification: Payment approved' })).toBeInTheDocument();
  const readCard = screen.getByRole('button', { name: 'Read notification: Payment approved' });
  readCard.focus();
  userEvent.keyboard('{enter}');
  expect(await screen.findByRole('dialog', { name: 'Payment approved' })).toBeInTheDocument();
  expect(client.patch).toHaveBeenCalledTimes(1);
});

test('notifications paginate inside the dashboard while filters remain available', async () => {
  const notificationRows = Array.from({ length: 12 }, (_, index) => ({
    id: 180 + index,
    notification_type: 'BOOKING_CREATED',
    title: `Booking update ${index + 1}`,
    message: 'Your booking has an update.',
    is_read: index > 2,
    created_at: '2026-10-20T04:00:00Z',
  }));
  const defaultGet = client.get.getMockImplementation();
  client.get.mockImplementation((url, options) => url === '/api/notifications/'
    ? Promise.resolve({ data: notificationRows })
    : defaultGet(url, options));
  const defaultCachedGet = getCached.getMockImplementation();
  getCached.mockImplementation((url, ...args) => url === '/api/notifications/'
    ? Promise.resolve({ data: notificationRows })
    : defaultCachedGet(url, ...args));

  render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
  expect(await screen.findByRole('button', { name: 'Unread notification: Booking update 1' })).toBeInTheDocument();
  expect(screen.getByText('Page 1 of 2 · 12 notifications')).toBeInTheDocument();
  expect(screen.getByLabelText('Filter by notification type')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('button', { name: 'Read notification: Booking update 11' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Unread notification: Booking update 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
});

test.each([
  ['desktop', 1280],
  ['mobile', 390],
])('notification details open and close at %s viewport width', async (_device, width) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const notificationRows = [{
    id: 91,
    booking_id: 342,
    notification_type: 'BOOKING_PAYMENT_APPROVED',
    title: 'A long payment notification title',
    message: 'Payment approved for booking #342. Amount: PHP 750.',
    is_read: true,
    created_at: '2026-10-20T05:00:00Z',
  }];
  const defaultGet = client.get.getMockImplementation();
  client.get.mockImplementation((url, options) => url === '/api/notifications/'
    ? Promise.resolve({ data: notificationRows })
    : defaultGet(url, options));
  const defaultCachedGet = getCached.getMockImplementation();
  getCached.mockImplementation((url, ...args) => url === '/api/notifications/'
    ? Promise.resolve({ data: notificationRows })
    : defaultCachedGet(url, ...args));

  render(<CustomerDashboard />);
  fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Read notification: A long payment notification title' }));
  const dialog = await screen.findByRole('dialog', { name: 'A long payment notification title' });
  expect(within(dialog).getByText('Payment approved for booking #342. Amount: PHP 750.')).toBeInTheDocument();
  expect(within(dialog).getByText('Booking #342')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close modal' }));
  expect(screen.getByRole('button', { name: 'Read notification: A long payment notification title' })).toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
});
