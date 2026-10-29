import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import client, { getCached } from '../api/client';

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

  it('opens saved closeout details from the card while keeping reprint independent', async () => {
    const reportDate = '2026-10-25';
    getCached.mockImplementation(url => {
      if (url.includes('/api/pos/end-of-day-reports/')) return Promise.resolve({ data: [{
        id: 73,
        report_date: reportDate,
        opening_time: '2026-10-25T01:00:00Z',
        closing_time: '2026-10-25T13:00:00Z',
        closed_by: 1,
        closed_by_name: 'admin',
        staff_name: 'Admin User',
        total_transactions: 1,
        gross_sales: '180.00',
        discounts: '20.00',
        refunds: '0.00',
        opening_cash: '100.00',
        cash_sales: '180.00',
        gcash_sales: '0.00',
        card_sales: '0.00',
        other_payment_sales: '0.00',
        booking_income: '0.00',
        cafe_pos_income: '180.00',
        total_items_sold: 2,
        best_selling_items: [{ name: 'Iced Latte', quantity: 2, total: '180.00' }],
        cancelled_or_voided_transactions: 0,
        cash_in_out: '0.00',
        first_transaction_id: 'TX-73',
        last_transaction_id: 'TX-73',
        transaction_ids: ['TX-73', 'PAY-73'],
        transaction_snapshot_version: 1,
        expected_cash: '280.00',
        actual_cash: '280.00',
        cash_difference: '0.00',
        transactions: [{
          id: 73,
          transaction_id: 'TX-73',
          type: 'WALK_IN',
          created_at: '2026-10-25T10:00:00Z',
          staff_name: 'Admin User',
          subtotal: '200.00',
          discount_type: 'FIXED',
          discount_amount: '20.00',
          refunds: '0.00',
          total: '180.00',
          items: [{ name: 'Iced Latte', quantity: 2, price: '100.00', subtotal: '200.00', discount_amount: '20.00', net_subtotal: '180.00' }],
          payments: [{ method: 'CASH', amount: '180.00', transaction_id: 'PAY-73' }],
        }],
        print_history: [{ event: 'local_print', recorded_at: '2026-10-25T13:05:00Z', printed: true, printer: 'Receipt Printer', error: '' }],
        printed_at: '2026-10-25T13:05:00Z',
        print_status: { printed: true, printer: 'Receipt Printer', error: '' },
        created_at: '2026-10-25T13:00:00Z',
      }] });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'End-of-Day Reports' }));
    const viewReportButton = await screen.findByRole('button', { name: `View saved closeout for ${reportDate}` });
    fireEvent.click(screen.getByRole('button', { name: 'Reprint Closeout' }));
    expect(screen.queryByRole('dialog', { name: `Saved Closeout · ${reportDate}` })).not.toBeInTheDocument();

    fireEvent.click(viewReportButton);
    expect(await screen.findByRole('dialog', { name: `Saved Closeout · ${reportDate}` })).toBeInTheDocument();
    expect(screen.getByText('Transaction IDs')).toBeInTheDocument();
    expect(screen.getByText('PAY-73')).toBeInTheDocument();
    expect(screen.getByText('Itemized transactions')).toBeInTheDocument();
    expect(screen.getByText('Iced Latte')).toBeInTheDocument();
    expect(screen.getByText('Cash reconciliation')).toBeInTheDocument();
    expect(screen.getByText('Payment breakdown')).toBeInTheDocument();
    expect(screen.getByText('Print history')).toBeInTheDocument();
    expect(screen.getByText(/Printer: Receipt Printer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument();

    const dialog = screen.getByRole('dialog', { name: `Saved Closeout · ${reportDate}` });
    expect(dialog.querySelector('[class*="max-h-[calc(100dvh-2rem)]"]')).toBeInTheDocument();
    const itemRow = dialog.querySelector('[class*="sm:grid-cols-4"]');
    expect(itemRow).toHaveClass('grid-cols-2', 'sm:grid-cols-4');
  });

  it('loads transaction details for a legacy saved report when the card is opened', async () => {
    getCached.mockImplementation(url => {
      if (url.includes('/api/pos/end-of-day-reports/')) return Promise.resolve({ data: [{
        id: 81,
        report_date: '2026-10-20',
        total_transactions: 1,
        gross_sales: '50.00',
        cash_difference: '0.00',
        first_transaction_id: 'LEGACY-81',
        last_transaction_id: 'LEGACY-81',
      }] });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });
    client.get.mockResolvedValue({ data: {
      id: 81,
      report_date: '2026-10-20',
      total_transactions: 1,
      gross_sales: '50.00',
      cash_difference: '0.00',
      transaction_ids: ['LEGACY-81'],
      transactions: [{
        id: 81,
        transaction_id: 'LEGACY-81',
        type: 'WALK_IN',
        subtotal: '50.00',
        discount_amount: '0.00',
        refunds: '0.00',
        total: '50.00',
        items: [{ name: 'Recovered Latte', quantity: 1, price: '50.00', subtotal: '50.00', net_subtotal: '50.00' }],
        payments: [],
      }],
      transactions_reconstructed: true,
    } });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'End-of-Day Reports' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View saved closeout for 2026-10-20' }));

    expect(client.get).toHaveBeenCalledWith('/api/pos/end-of-day-reports/81/');
    expect(await screen.findByText('Recovered Latte')).toBeInTheDocument();
    expect(screen.getByText(/loaded from the recorded transactions for the report date/)).toBeInTheDocument();
  });

  it('filters accounts by role, search, and pagination together', async () => {
    const accounts = [
      { id: 1, username: 'admin.alpha', first_name: 'Admin', last_name: 'Alpha', email: 'admin.alpha@example.test', role: 'ADMIN' },
      { id: 2, username: 'admin.beta', first_name: 'Admin', last_name: 'Beta', email: 'admin.beta@example.test', role: 'ADMIN' },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: index + 3,
        username: `staff.${String(index + 1).padStart(2, '0')}`,
        first_name: 'Staff',
        last_name: String(index + 1),
        email: `staff${String(index + 1).padStart(2, '0')}@example.test`,
        role: 'STAFF',
      })),
      { id: 14, username: 'customer.one', first_name: 'Casey', last_name: 'Customer', email: 'customer@example.test', role: 'CUSTOMER' },
    ];
    getCached.mockImplementation(url => {
      if (url.includes('/api/auth/users/')) return Promise.resolve({ data: accounts });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
    expect(await screen.findByText('admin.alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Admin/ }));
    expect(screen.getByText('admin.alpha')).toBeInTheDocument();
    expect(screen.queryByText('staff.01')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1-2 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Staff/ }));
    expect(screen.getByText('Showing 1-10 of 11')).toBeInTheDocument();
    expect(screen.queryByText('staff.11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('staff.11')).toBeInTheDocument();
    expect(screen.getByText('Showing 11-11 of 11')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: 'staff11@example.test' } });
    expect(screen.getByText('staff.11')).toBeInTheDocument();
    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Customers/ }));
    expect(screen.getByText('No matching accounts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('customer.one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the FAQ panels viewport-sized with a fixed list heading and scrolling rows', async () => {
    const faqRows = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      question: `FAQ Question ${index + 1}`,
      answer: `FAQ Answer ${index + 1}`,
      tags: 'help',
    }));
    getCached.mockImplementation(url => {
      if (url.includes('/api/chatbot/faqs/')) return Promise.resolve({ data: faqRows });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    const { container } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Chatbot Manager' }));

    expect(await screen.findByRole('heading', { name: 'Knowledge Base FAQs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add FAQ Entry' })).toBeInTheDocument();
    const faqLayout = screen.getByRole('heading', { name: 'Knowledge Base FAQs' }).closest('.grid');
    expect(faqLayout).toHaveClass('flex-1', 'min-h-0', 'grid-rows-2', 'xl:grid-rows-1');
    expect(container.querySelector('main')).toHaveClass('overflow-hidden', 'flex', 'flex-col');

    const answerField = screen.getByRole('textbox', { name: 'Answer' });
    expect(answerField).toHaveClass('flex-1', 'min-h-[5rem]');
    expect(answerField.parentElement).toHaveClass('flex-1', 'min-h-0', 'flex-col');

    const fixedFaqHeading = screen.getByRole('heading', { name: 'Knowledge Base FAQs' });
    const firstFaqRow = screen.getByText('FAQ Question 1').closest('.animate-in-up');
    const faqScrollPanel = firstFaqRow.parentElement;
    expect(faqScrollPanel).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto');
    expect(faqScrollPanel).not.toContainElement(fixedFaqHeading);
  });
});
