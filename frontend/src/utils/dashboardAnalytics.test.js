import { hasDashboardOperationalRecords, validateDashboardAnalytics } from './dashboardAnalytics';

const range = { start: '2026-11-01', end: '2026-11-01' };
const payload = {
  metrics: {
    total_revenue: 0, total_revenue_change: 0, previous_period_revenue: 0, pos_revenue: 0, booking_revenue: 0,
    booking_payment_revenue: 0, transaction_count: 0, avg_transaction_value: 0,
    total_items_sold: 0, total_bookings: 0, completed_bookings: 0, pending: 0,
    confirmed: 0, confirmed_dp: 0, completed: 0, cancelled: 0,
  },
  range: { ...range, grain: 'daily' },
  record_counts: { paid_orders: 0, pos_transactions: 0, booking_payments: 0, bookings: 0 },
};

describe('dashboard analytics response validation', () => {
  it('accepts calculated zero values only when the response is complete and for the selected range', () => {
    expect(validateDashboardAnalytics(payload, range)).toBe('');
    expect(hasDashboardOperationalRecords(payload)).toBe(false);
  });

  it('rejects missing metrics and stale date ranges instead of rendering zero', () => {
    expect(validateDashboardAnalytics({ ...payload, metrics: { total_revenue: 0 } }, range)).toMatch(/missing valid metrics/);
    expect(validateDashboardAnalytics({ ...payload, range: { ...range, start: '2026-10-01' } }, range)).toMatch(/different date range/);
    expect(validateDashboardAnalytics({ ...payload, record_counts: undefined }, range)).toMatch(/record counts/);
  });

  it('recognizes real records even when their revenue is zero', () => {
    expect(hasDashboardOperationalRecords({ ...payload, record_counts: { ...payload.record_counts, bookings: 1 } })).toBe(true);
  });

  it('accepts an unavailable percentage only when there is revenue and no prior revenue baseline', () => {
    const freshSales = { ...payload, metrics: { ...payload.metrics, total_revenue: 50, total_revenue_change: null } };
    expect(validateDashboardAnalytics(freshSales, range)).toBe('');
    expect(validateDashboardAnalytics({ ...freshSales, metrics: { ...freshSales.metrics, previous_period_revenue: 10 } }, range)).toMatch(/previous-period comparison/);
  });
});
