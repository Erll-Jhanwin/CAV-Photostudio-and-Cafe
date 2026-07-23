import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
});
