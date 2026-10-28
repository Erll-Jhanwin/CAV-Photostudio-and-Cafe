import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  getCached.mockResolvedValue({ data: [] });
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

async function fillPayment(container) {
  fireEvent.change(screen.getByLabelText('GCash Reference No.'), { target: { value: 'GCASH-TEST-001' } });
  fireEvent.change(screen.getByLabelText('Amount Paid'), { target: { value: '500' } });
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
  expect(await screen.findByRole('img', { name: 'GCash payment QR code' })).toHaveAttribute('src', '/gcash-qr.png');
  return container;
}

test('available slot completes the wizard and sends Manila payment timestamp and idempotency keys', async () => {
  client.post.mockImplementation(async url => ({ data: url === '/api/bookings/' ? booking : { id: 7, status: 'PENDING_VERIFICATION' } }));
  await completeWizard();
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Booking submitted successfully.'));
  expect(client.post).toHaveBeenCalledTimes(2);
  expect(client.post.mock.calls[0][1]).toMatchObject({ scheduled_date: date, scheduled_time: '09:00', idempotency_key: expect.any(String) });
  const payment = client.post.mock.calls[1][1];
  expect(payment).toMatchObject({
    booking: 42,
    reference_number: 'GCASH-TEST-001',
    amount: '500.00',
    paid_at: '2026-10-18T04:30:00.000Z',
    method: 'GCASH',
    idempotency_key: expect.any(String),
  });
  expect(payment).not.toHaveProperty('receipt');
});

test('selected payment proof is sent as multipart data for private storage', async () => {
  client.post.mockImplementation(async url => ({ data: url === '/api/bookings/' ? booking : { id: 7, status: 'PENDING_VERIFICATION' } }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Reserve Your Session' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Booking submitted successfully.'));
  clock.mockRestore();
  const bookingCalls = client.post.mock.calls.filter(([url]) => url === '/api/bookings/');
  const payments = client.post.mock.calls.filter(([url]) => url === '/api/bookings/payments/').map(([, body]) => body);
  expect(bookingCalls).toHaveLength(1);
  expect(payments).toHaveLength(2);
  expect(payments[0].idempotency_key).toBe(payments[1].idempotency_key);
  expect(payments[1].booking).toBe(42);
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
