import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  useNavigate: () => jest.fn(),
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'ADMIN' },
    logout: jest.fn(),
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

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div>{children}</div>,
  Pie: ({ children }) => <div>{children}</div>,
  Cell: () => null,
  Tooltip: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ComposedChart: ({ children }) => <div>{children}</div>,
}));

import AdminDashboard from './AdminDashboard';

describe('AdminDashboard', () => {
  it('renders the admin shell and accepts empty analytics data', async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText('Business Overview')).toBeInTheDocument();
    expect(screen.getAllByText('Booking Income').length).toBeGreaterThan(0);
  });
});
