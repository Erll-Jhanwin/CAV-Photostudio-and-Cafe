export const DASHBOARD_METRIC_FIELDS = [
  'total_revenue', 'previous_period_revenue', 'pos_revenue', 'booking_revenue',
  'booking_payment_revenue', 'transaction_count', 'avg_transaction_value',
  'total_items_sold', 'total_bookings', 'completed_bookings', 'pending',
  'confirmed', 'confirmed_dp', 'completed', 'cancelled',
];

export const validateDashboardAnalytics = (payload, expectedRange) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'The dashboard service returned an invalid response.';
  }
  if (!payload.metrics || typeof payload.metrics !== 'object') {
    return 'The dashboard response is missing its metrics.';
  }
  const missing = DASHBOARD_METRIC_FIELDS.filter(field => (
    payload.metrics[field] === null || payload.metrics[field] === undefined ||
    payload.metrics[field] === '' || !Number.isFinite(Number(payload.metrics[field]))
  ));
  if (missing.length) return `The dashboard response is missing valid metrics: ${missing.join(', ')}.`;
  const revenueChange = payload.metrics.total_revenue_change;
  const previousRevenue = Number(payload.metrics.previous_period_revenue);
  const currentRevenue = Number(payload.metrics.total_revenue);
  if (revenueChange === null) {
    if (previousRevenue !== 0 || currentRevenue <= 0) return 'The dashboard response is missing a valid previous-period comparison.';
  } else if (revenueChange === undefined || revenueChange === '' || !Number.isFinite(Number(revenueChange))) {
    return 'The dashboard response is missing a valid previous-period comparison.';
  }
  if (!payload.range || payload.range.start !== expectedRange.start || payload.range.end !== expectedRange.end) {
    return 'The dashboard returned results for a different date range. Please retry.';
  }
  if (!payload.record_counts || ['paid_orders', 'pos_transactions', 'booking_payments', 'bookings'].some(key => (
    !Number.isInteger(Number(payload.record_counts[key])) || Number(payload.record_counts[key]) < 0
  ))) {
    return 'The dashboard response is missing record counts.';
  }
  return '';
};

export const hasDashboardOperationalRecords = payload => (
  ['paid_orders', 'booking_payments', 'bookings'].some(key => Number(payload?.record_counts?.[key]) > 0)
);
