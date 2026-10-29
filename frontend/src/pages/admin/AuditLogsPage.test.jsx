import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import client from '../../api/client';
import AuditLogsPage from './AuditLogsPage';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  getApiErrorMessage: (_error, fallback) => fallback,
}));

beforeEach(() => {
  client.get.mockResolvedValue({ data: { count: 4, results: [] } });
});

test('shows all filters and applies then clears them through the existing query', async () => {
  render(<AuditLogsPage />);

  expect(await screen.findByRole('textbox', { name: 'Search audit logs' })).toBeInTheDocument();
  const role = screen.getByRole('combobox', { name: 'Filter by role' });
  const module = screen.getByRole('combobox', { name: 'Filter by module' });
  const kind = screen.getByRole('combobox', { name: 'Filter activity type' });
  const action = screen.getByRole('textbox', { name: 'Filter by action' });
  const start = screen.getByLabelText('Start date');
  const end = screen.getByLabelText('End date');
  expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: 'Search audit logs' }), { target: { value: 'receipt' } });
  fireEvent.change(role, { target: { value: 'STAFF' } });
  fireEvent.change(module, { target: { value: 'bookings' } });
  fireEvent.change(kind, { target: { value: 'errors' } });
  fireEvent.change(action, { target: { value: 'BOOKING_PAYMENT' } });
  fireEvent.change(start, { target: { value: '2026-10-01' } });
  fireEvent.change(end, { target: { value: '2026-10-31' } });

  await waitFor(() => expect(client.get).toHaveBeenLastCalledWith('/api/audit/logs/', expect.objectContaining({
    params: expect.objectContaining({
      search: 'receipt', role: 'STAFF', module: 'bookings', kind: 'errors',
      action: 'BOOKING_PAYMENT', start: '2026-10-01', end: '2026-10-31', page: 1,
    }),
  })));

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(client.get).toHaveBeenLastCalledWith('/api/audit/logs/', expect.objectContaining({
    params: expect.objectContaining({ search: '', role: '', module: '', kind: '', action: '', start: '', end: '', page: 1 }),
  })));
});

test('uses wrapping grid tracks and constrained date inputs at responsive breakpoints', () => {
  const { container } = render(<AuditLogsPage />);
  const filterGrid = container.querySelector('[class*="lg:grid-cols-5"]');
  expect(filterGrid).toHaveClass('min-w-0', 'grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-5', '2xl:grid-cols-8');
  expect(screen.getByLabelText('Start date')).toHaveClass('min-w-0');
  expect(screen.getByLabelText('End date')).toHaveClass('min-w-0');
});

test('opens successful event details from a keyboard-accessible row and redacts sensitive metadata', async () => {
  client.get.mockResolvedValue({ data: { count: 1, results: [{
    id: 21,
    timestamp: '2026-10-29T10:30:00Z',
    user_id: 7,
    name: 'Audit Admin',
    role: 'ADMIN',
    action: 'USER_UPDATE',
    module: 'users',
    record_reference: '44',
    description: 'Updated user role.',
    details: {
      outcome: 'Success',
      target_user_id: 44,
      old_values: { role: 'STAFF' },
      new_values: { role: 'ADMIN' },
      changed_fields: ['role'],
      customer_email: 'private@example.test',
      access_token: 'do-not-display',
      note: 'Contact private@example.test with Bearer abc123',
    },
  }] } });
  render(<AuditLogsPage />);

  const eventRow = await screen.findByRole('row', { name: 'View audit event USER_UPDATE' });
  eventRow.focus();
  fireEvent.keyDown(eventRow, { key: 'Enter' });

  const dialog = await screen.findByRole('dialog', { name: 'Audit event · USER_UPDATE' });
  expect(screen.getAllByText('Audit Admin').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Affected module').parentElement).toHaveTextContent('users');
  expect(screen.getByText('Affected record').parentElement).toHaveTextContent('44');
  expect(screen.getByText('Before').parentElement).toHaveTextContent('STAFF');
  expect(screen.getByText('After').parentElement).toHaveTextContent('ADMIN');
  expect(screen.getByText('Outcome').parentElement).toHaveTextContent('Success');
  expect(screen.getByText('Relevant metadata')).toBeInTheDocument();
  expect(dialog).toHaveTextContent('[redacted email]');
  expect(dialog).toHaveTextContent('[redacted credential]');
  expect(dialog).not.toHaveTextContent('do-not-display');
  expect(dialog).not.toHaveTextContent('private@example.test');
  expect(dialog.querySelector('[class*="max-h-[calc(100dvh-8rem)]"]')).toHaveClass('overflow-y-auto');
});

test('opens warning and error rows and labels unrecorded cause or recovery without inventing details', async () => {
  client.get.mockResolvedValue({ data: { count: 2, results: [
    {
      id: 22, timestamp: '2026-10-29T10:31:00Z', user_id: 3, name: 'Staff User', role: 'STAFF',
      action: 'INVENTORY_LOW_STOCK_WARNING', module: 'inventory', record_reference: '18',
      description: 'Stock level warning recorded.', details: { warning: true, product_id: 18 },
    },
    {
      id: 23, timestamp: '2026-10-29T10:32:00Z', user_id: null, name: 'System', role: 'SYSTEM',
      action: 'API_SERVER_ERROR', module: 'bookings', record_reference: '48',
      description: 'Unexpected server error.', details: { message: 'Request failed.', issue: 'PermissionDenied' },
    },
  ] } });
  render(<AuditLogsPage />);

  fireEvent.click(await screen.findByRole('row', { name: 'View audit event INVENTORY_LOW_STOCK_WARNING' }));
  expect(await screen.findByRole('dialog', { name: 'Audit event · INVENTORY_LOW_STOCK_WARNING' })).toBeInTheDocument();
  expect(screen.getByText('Warning')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

  fireEvent.click(screen.getByRole('row', { name: 'View audit event API_SERVER_ERROR' }));
  expect(await screen.findByRole('dialog', { name: 'Audit event · API_SERVER_ERROR' })).toBeInTheDocument();
  expect(screen.getByText('Error')).toBeInTheDocument();
  expect(screen.getByText('Recorded error message').parentElement).toHaveTextContent('Request failed.');
  expect(screen.getByText('Recorded cause').parentElement).toHaveTextContent('PermissionDenied');
  expect(screen.getByText('Recovery actions').parentElement).toHaveTextContent('Not recorded');
});
