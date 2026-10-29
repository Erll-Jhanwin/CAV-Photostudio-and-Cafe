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
