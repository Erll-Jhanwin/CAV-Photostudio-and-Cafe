import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getCached } from '../api/client';

const mockNavigate = jest.fn();
const mockUser = { id: 1, username: 'admin', role: 'ADMIN' };
const mockLogout = jest.fn();

jest.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  useNavigate: () => mockNavigate,
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: mockLogout,
  }),
}));

jest.mock('../components/ui/StyledAlert', () => ({
  useStyledConfirm: () => jest.fn().mockResolvedValue(false),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  DATA_CHANGED_EVENT: 'cav:data-changed',
  getApiErrorMessage: (_error, fallback) => fallback,
  getCached: jest.fn((url) => {
    if (url.includes('/api/dashboard/analytics/')) {
      return Promise.resolve({
        data: {
          metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
          sales_history_chart: [],
          recent_bookings: [],
          recent_pos_transactions: [],
          top_selling_products: [],
          top_booked_packages: [],
          inventory_status_counts: {},
          low_stock_alerts: [],
          inventory_alerts: [],
        },
      });
    }
    return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
  }),
}));

import AdminDashboard from './AdminDashboard';

describe('AdminDashboard', () => {
  it('renders the admin shell and opens Accounts with Lucide action icons', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText('Business Overview')).toBeInTheDocument();
    expect(screen.getAllByText('Booking Income').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(await screen.findByText('Existing Accounts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });

  it('renders the analytics dashboard before the slower forecast request finishes', async () => {
    let resolveForecast;
    getCached.mockImplementation(url => {
      if (url.includes('/api/forecasting/predictions/')) {
        return new Promise(resolve => { resolveForecast = resolve; });
      }
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

    expect(await screen.findByText('Business Overview')).toBeInTheDocument();
    await waitFor(() => expect(resolveForecast).toBeDefined());
    expect(getCached).toHaveBeenCalledWith('/api/dashboard/analytics/', expect.any(Object), expect.any(Object));
    await act(async () => resolveForecast({ data: { sales_forecast: [], reorder_recommendations: [] } }));
  });

  it('opens the matching live ingredient list from each stock summary card', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /View \d+ in stock ingredients/ }));
    expect(await screen.findByRole('dialog', { name: 'In Stock Ingredients' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(await screen.findByRole('button', { name: /View \d+ expired ingredients/ }));
    expect(await screen.findByRole('dialog', { name: 'Expired Ingredients' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search expired ingredients' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort expired ingredients' })).toBeInTheDocument();
  });

  it('shows full-width booking details in responsive columns on the calendar', async () => {
    const bookingMonth = new Date().toISOString().slice(0, 7);
    getCached.mockImplementation(url => {
      if (url.includes('/api/bookings/studio-unavailable-dates/')) return Promise.resolve({ data: [] });
      if (url === '/api/bookings/') {
        return Promise.resolve({ data: [{
          id: 48,
          customer: { first_name: 'Jamie', last_name: 'Reyes', email: 'jamie@example.com', phone_number: '+639171234567' },
          package_details: { name: 'Portrait Session', price: '2500.00', inclusions: 'One printed portrait' },
          scheduled_date: `${bookingMonth}-15`,
          scheduled_time: '10:30:00',
          status: 'PENDING',
          required_down_payment: '1250.00',
          items: [{ name: 'Printed photo', quantity: 2, price: '150.00' }],
          notes: 'Please call upon arrival.',
          payments: [{ id: 11, amount: '1250.00', method_label: 'GCash', status: 'PENDING_VERIFICATION', reference_number: 'GC-48' }],
        }] });
      }
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Booking Calendar' }));

    expect(await screen.findByText('Live Bookings')).toBeInTheDocument();
    expect(await screen.findByText('jamie@example.com')).toBeInTheDocument();
    expect(screen.getByText('+639171234567')).toBeInTheDocument();
    expect(screen.getByText('Down payment: PHP 1,250')).toBeInTheDocument();
    expect(screen.getByText('Printed photo × 2 · PHP 150')).toBeInTheDocument();
    expect(screen.getByText('Please call upon arrival.')).toBeInTheDocument();
    expect(screen.getByText('Includes: One printed portrait')).toBeInTheDocument();
    expect(screen.getByText('PHP 1,250 · GCash · PENDING VERIFICATION · Ref GC-48')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Booking 48 status' })).toBeInTheDocument();

    const bookingCard = screen.getByText('Booking items').closest('.rounded-2xl');
    expect(bookingCard).toHaveClass('min-w-0');
    expect(bookingCard.querySelector('.grid')).toHaveClass('sm:grid-cols-2', 'xl:grid-cols-4');
    expect(bookingCard.parentElement).toHaveClass('grid-cols-1');
  });
});
