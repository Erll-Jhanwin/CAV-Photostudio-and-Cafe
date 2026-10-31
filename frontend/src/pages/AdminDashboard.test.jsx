import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import client, { getCached } from '../api/client';
import { getManilaMonthValue } from '../utils/dateTime';

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
  it('opens Live Inventory with staff inventory data and both paginated views', async () => {
    const ingredient = {
      id: 91,
      name: 'Arabica Beans',
      batch_number: 'B-091',
      supplier_details: { name: 'CAV Supply' },
      category_details: { name: 'Coffee' },
      stock_quantity: '12.00',
      base_unit: 'kg',
      minimum_stock_level: '4.00',
      maximum_stock_level: '30.00',
      inventory_status: 'IN_STOCK',
      inventory_status_label: 'In Stock',
      suggested_action: 'Maintain stock',
      expiration_date: null,
      storage_location: 'Dry store',
    };
    const salesRow = {
      product_id: 6,
      product_name: 'Iced Latte',
      beginning_stock: 20,
      quantity_sold: 5,
      wastage: 1,
      ending_stock: 14,
      date: '2026-10-30',
      revenue: '450.00',
      profit_loss: '210.00',
    };
    client.get.mockImplementation((_url, { params }) => Promise.resolve({ data: params.type === 'sales' ? [{
      id: 'sale-6', transaction_id: 'POS-20261030-0006', date_time: '2026-10-30T02:15:00Z', quantity: 5, staff_name: 'Jamie Cashier', sale_amount: '450.00',
    }, {
      id: 'sale-7', transaction_id: 'POS-20261030-0007', date_time: '2026-10-30T03:15:00Z', quantity: 1, staff_name: 'Sam Cashier', sale_amount: '90.00',
    }] : [{
      id: 'waste-6', transaction_id: 'POS-20261030-0006', date_time: '2026-10-30T03:00:00Z', quantity: 1, staff_name: 'Jamie Cashier', reason: 'Spilled during preparation',
    }] }));
    getCached.mockImplementation(url => {
      if (url === '/api/inventory/ingredients/') return Promise.resolve({ data: [ingredient] });
      if (url === '/api/inventory/product-sales/') return Promise.resolve({ data: [salesRow] });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {}, low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Live Inventory' }));

    expect(document.querySelector('main')).toHaveClass('overflow-hidden', 'flex', 'flex-col');
    expect(screen.getByTestId('admin-live-inventory')).toHaveClass('h-full', 'min-h-0', 'flex-col', 'overflow-hidden');
    expect(screen.getByRole('tablist', { name: 'Live Inventory sections' })).toHaveClass('overflow-x-auto');
    expect(await screen.findByRole('tab', { name: 'Inventory Management' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Arabica Beans')).toBeInTheDocument();
    expect(screen.getByText('12 kg')).toBeInTheDocument();
    expect(getCached).toHaveBeenCalledWith('/api/inventory/ingredients/', { params: { limit: 300 } }, expect.any(Object));
    expect(getCached).toHaveBeenCalledWith('/api/inventory/product-sales/', {}, expect.any(Object));

    fireEvent.click(screen.getByRole('tab', { name: 'Product Sales, Returns & Wastage' }));
    expect(await screen.findByText('Iced Latte')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Product Sales, Returns & Wastage' })).toHaveClass('flex-1', 'overflow-hidden');
    expect(screen.getByText('PHP 450')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Inventory' }));
    await waitFor(() => expect(getCached).toHaveBeenCalledWith('/api/inventory/ingredients/', { params: { limit: 300 } }, { force: true }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'View 5 sold transactions for Iced Latte' }));
    const salesDialog = await screen.findByRole('dialog', { name: 'Iced Latte · Sales Records' });
    expect(within(salesDialog).getByText('POS-20261030-0006')).toBeInTheDocument();
    expect(within(salesDialog).getByText('Jamie Cashier')).toBeInTheDocument();
    expect(within(salesDialog).getByText('PHP 450')).toBeInTheDocument();
    expect(within(salesDialog).queryByText('POS-20261030-0007')).not.toBeInTheDocument();
    fireEvent.click(within(salesDialog).getByRole('button', { name: 'Next page' }));
    expect(await within(salesDialog).findByText('POS-20261030-0007')).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith('/api/inventory/product-sales/transactions/', {
      params: { product_id: 6, date: '2026-10-30', type: 'sales' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'View 1 wastage records for Iced Latte' }));
    const wastageDialog = await screen.findByRole('dialog', { name: 'Iced Latte · Wastage Records' });
    expect(within(wastageDialog).getByText('Spilled during preparation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
  }, 20000);

  it('loads an Admin payment proof only after opening it and preserves verification actions', async () => {
    const payment = {
      id: 18,
      booking: 48,
      booking_details: {
        customer_name: 'Jamie Reyes', customer_email: 'jamie@example.com',
        service_name: 'Studio', package_name: 'Portrait Session',
        scheduled_date: '2026-11-15', scheduled_time: '10:30',
      },
      method_label: 'GCash', reference_number: 'GC-48', amount: '1250.00',
      required_down_payment: '1250.00', paid_at: '2026-10-28T10:00:00Z',
      status: 'PENDING_VERIFICATION', receipt_url: '/api/bookings/payments/18/receipt/',
    };
    getCached.mockImplementation(url => {
      if (url.includes('/api/bookings/payments/')) return Promise.resolve({ data: [payment] });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });
    let resolveProof;
    client.get.mockReturnValue(new Promise(resolve => { resolveProof = resolve; }));

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Payment Booking Verification' }));

    const proofButton = await screen.findByRole('button', { name: 'View proof of payment for booking 48' });
    expect(screen.getByRole('button', { name: 'Confirm Payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flag Payment Issue' })).toBeInTheDocument();
    expect(client.get).not.toHaveBeenCalled();

    fireEvent.click(proofButton);
    expect(await screen.findByRole('dialog', { name: 'Payment proof · Booking #48' })).toBeInTheDocument();
    expect(screen.getByText('Loading payment proof…')).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith('/api/bookings/payments/18/receipt/', { responseType: 'blob' });
    await act(async () => resolveProof({ data: new Blob(['proof'], { type: 'image/png' }) }));
  });

  it('filters payment tabs immediately and keeps scrolling inside the fixed verification panel', async () => {
    const statuses = ['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'PENDING_VERIFICATION'];
    const payments = statuses.map((status, index) => ({
      id: 70 + index,
      booking: 170 + index,
      amount: '500.00',
      required_down_payment: '500.00',
      method_label: 'GCash',
      reference_number: `REF-${index}`,
      paid_at: '2026-10-28T10:00:00Z',
      status,
      verified_by_details: { username: 'Admin' },
      booking_details: {
        customer_name: `Payment Customer ${index + 1}`,
        customer_email: `customer${index + 1}@example.com`,
        package_name: 'Portrait Session',
        scheduled_date: '2026-11-15',
        scheduled_time: '10:30',
      },
    }));
    getCached.mockImplementation(url => {
      if (url.includes('/api/bookings/payments/')) return Promise.resolve({ data: payments });
      if (url.includes('/api/forecasting/predictions/')) return Promise.resolve({ data: { sales_forecast: [], reorder_recommendations: [] } });
      return Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } });
    });

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Payment Booking Verification' }));

    const panel = await screen.findByRole('group', { name: 'Booking payment status filter' });
    const list = screen.getByLabelText('Booking payment list');
    const main = document.querySelector('main');
    expect(main).toHaveClass('overflow-hidden', 'flex', 'flex-col');
    expect(list).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(within(panel).getByRole('button', { name: 'Pending Verification' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Payment Customer 1')).toBeInTheDocument();
    expect(screen.getByText('Payment Customer 4')).toBeInTheDocument();
    expect(screen.queryByText('Payment Customer 2')).not.toBeInTheDocument();

    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 180 });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1200 });
    list.scrollTop = 360;
    fireEvent.scroll(list);
    fireEvent.click(within(panel).getByRole('button', { name: 'Approved' }));
    expect(list.scrollTop).toBe(0);
    expect(within(panel).getByRole('button', { name: 'Approved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Payment Customer 2')).toBeInTheDocument();
    expect(screen.queryByText('Payment Customer 1')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Rejected' }));
    expect(within(panel).getByRole('button', { name: 'Rejected' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Payment Customer 3')).toBeInTheDocument();
    expect(screen.queryByText('Payment Customer 2')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'All' }));
    expect(within(panel).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Payment Customer 1')).toBeInTheDocument();
    expect(screen.getByText('Payment Customer 2')).toBeInTheDocument();
    expect(screen.getByText('Payment Customer 3')).toBeInTheDocument();
  });

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

  it('shows calculated sales forecast cards, backtest reliability, and the training computation', async () => {
    const forecastRows = Array.from({ length: 14 }, (_, index) => ({
      target_date: `2025-08-${String(index + 1).padStart(2, '0')}`,
      predicted_sales: (index + 1) * 10,
      lower_bound: (index + 1) * 8,
      upper_bound: (index + 1) * 12,
    }));
    const report = {
      status: 'ok',
      source_file: 'CAV_Three_Year_Synthetic_Sales-Daily sales.csv',
      imported_at: '2025-08-01T00:00:00Z',
      history_start: '2022-08-01',
      history_end: '2025-07-31',
      sales_forecast: forecastRows,
      monthly_forecast: [{ target_date: '2025-08-01', predicted_sales: 2000, lower_bound: 1800, upper_bound: 2200 }],
      actual_history: [{ date: '2025-07-31', actual_sales: 145, backtest_predicted_sales: 120, is_imputed: false }],
      sales_backtest: [{ date: '2025-07-31', actual_sales: 145, predicted_sales: 120 }],
      forecast_ranges: {
        next_7_days: { start_date: '2025-08-01', end_date: '2025-08-07', total_predicted_sales: 280 },
        next_week: { start_date: '2025-08-08', end_date: '2025-08-14', total_predicted_sales: 770 },
      },
      metrics: { accuracy_available: true, holdout_days: 220, wape: 0.5, mae: 25, rmse: 40, r2: 0.25, baseline: { mae: 30, rmse: 42, r2: 0.2, wape: 0.6 } },
      model: {
        name: 'linear_regression', display_name: 'Daily linear regression',
        training_computation: { sample_count: 876, sum_x: 383250, sum_y: 94975, sum_x2: 223690250, sum_xy: 43231380, slope: 0.03, intercept: 95.3 },
        final_model_computation: { sample_count: 1096 },
      },
      data_quality: { valid_rows: 1096, history_days: 1096, is_synthetic: true },
      data_sufficiency: { is_sufficient: true, message: 'Chronological backtest completed.' },
      product_forecast_summary: [],
      reorder_recommendations: [],
    };
    getCached.mockImplementation(url => url.includes('/api/forecasting/predictions/')
      ? Promise.resolve({ data: report })
      : Promise.resolve({ data: {
        metrics: { total_revenue: 0, booking_revenue: 0, pos_revenue: 0 },
        sales_history_chart: [], recent_bookings: [], recent_pos_transactions: [],
        top_selling_products: [], top_booked_packages: [], inventory_status_counts: {},
        low_stock_alerts: [], inventory_alerts: [],
      } }));

    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

    expect(await screen.findByText('Backtested forecast available')).toBeInTheDocument();
    expect(screen.getByText(/Dataset: Synthetic sales data/)).toBeInTheDocument();
    expect(screen.getByText('PHP 280')).toBeInTheDocument();
    expect(screen.getByText('PHP 770')).toBeInTheDocument();
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText('Linear regression: How it works')).toBeInTheDocument();
    expect(screen.getAllByText('876').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Following week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upcoming months' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actual' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forecast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Combined' })).toBeInTheDocument();
    expect(screen.getByText('Scroll to zoom · Drag to pan.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sales chart range selector')).not.toBeInTheDocument();
    const visibleRange = screen.getByTestId('sales-chart-visible-range');
    expect(visibleRange.textContent).toContain('Jul 31, 2025');
    expect(visibleRange.textContent).toContain('Aug 7, 2025');
    const startDate = screen.getByLabelText('Sales chart start date');
    fireEvent.change(startDate, { target: { value: '2025-08-02' } });
    expect(startDate).toHaveValue('2025-08-02');
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming months' }));
    expect(screen.getByRole('button', { name: 'Upcoming months' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reset View' }));
    expect(startDate).toHaveValue('');
    const interactionArea = screen.getByTestId('sales-chart-interaction-area');
    interactionArea.getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 360, height: 360 });
    const zoomInEvent = createEvent.wheel(interactionArea, { deltaY: -120, clientX: 750, cancelable: true });
    fireEvent(interactionArea, zoomInEvent);
    expect(zoomInEvent.defaultPrevented).toBe(true);
    expect(visibleRange.textContent).not.toContain('Jul 31, 2025');
    const zoomedRange = visibleRange.textContent;
    const zoomOutEvent = createEvent.wheel(interactionArea, { deltaY: 120, clientX: 750, cancelable: true });
    fireEvent(interactionArea, zoomOutEvent);
    expect(zoomOutEvent.defaultPrevented).toBe(true);
    expect(visibleRange.textContent).toContain('Jul 31, 2025');
    fireEvent.wheel(interactionArea, { deltaY: -120, clientX: 750, cancelable: true });
    fireEvent.mouseDown(interactionArea, { button: 0, clientX: 700 });
    fireEvent.mouseMove(interactionArea, { clientX: 350 });
    fireEvent.mouseUp(interactionArea, { clientX: 350 });
    expect(visibleRange.textContent).not.toBe('Jul 31, 2025 – Aug 7, 2025');
    expect(zoomedRange).not.toBe('Jul 31, 2025 – Aug 7, 2025');
    fireEvent.click(screen.getByRole('button', { name: 'Reset View' }));
    expect(startDate).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Next 7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Actual' })).toHaveAttribute('aria-pressed', 'true');
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
    const bookingMonth = getManilaMonthValue();
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
    expect(document.querySelector('main')).toHaveClass('overflow-hidden', 'flex', 'flex-col');
    expect(screen.getByText('Existing Accounts').closest('div.rounded-2xl')).toHaveClass('h-full', 'min-h-0', 'flex-col');

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
    expect(screen.getByRole('columnheader', { name: 'Username' })).toBeInTheDocument();
    expect(screen.getByText('Showing 0-0 of 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('customer.one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  }, 15000);

  it('keeps the FAQ panels viewport-sized with a fixed list heading and scrolling rows', async () => {
    const faqRows = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      question: `FAQ Question ${index + 1}`,
      answer: `FAQ Answer ${index + 1}`,
      tags: 'help',
    }));
    let resolveFaqs;
    getCached.mockImplementation(url => {
      if (url.includes('/api/chatbot/faqs/')) return new Promise(resolve => { resolveFaqs = resolve; });
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
    await waitFor(() => expect(resolveFaqs).toEqual(expect.any(Function)));
    expect(container.firstChild).toHaveClass('h-dvh', 'overflow-hidden');
    expect(container.querySelector('main')).toHaveClass('overflow-hidden', 'flex', 'flex-col');
    const faqLayout = screen.getByRole('heading', { name: 'Knowledge Base FAQs' }).closest('.grid');
    expect(faqLayout).toHaveClass('flex-1', 'min-h-0', 'grid-rows-2', 'xl:grid-rows-1');
    expect(faqLayout.parentElement.parentElement).toHaveClass('flex-1', 'min-h-0');
    resolveFaqs({ data: faqRows });
    expect(await screen.findByText('FAQ Question 1')).toBeInTheDocument();
    expect(faqLayout).toHaveClass('flex-1', 'min-h-0', 'grid-rows-2', 'xl:grid-rows-1');

    const answerField = screen.getByRole('textbox', { name: 'Answer' });
    expect(answerField).toHaveClass('flex-1', 'min-h-[5rem]');
    expect(answerField.parentElement).toHaveClass('flex-1', 'min-h-0', 'flex-col');

    const fixedFaqHeading = screen.getByRole('heading', { name: 'Knowledge Base FAQs' });
    const firstFaqRow = screen.getByText('FAQ Question 1').closest('.animate-in-up');
    const faqScrollPanel = firstFaqRow.parentElement;
    expect(faqScrollPanel).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto');
    expect(faqScrollPanel).not.toContainElement(fixedFaqHeading);
    expect(faqLayout.children[1].firstChild).toHaveClass('h-full', 'min-h-0', 'flex-col', 'overflow-hidden');
  });
});
