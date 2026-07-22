export const normalizeId = (value) => String(value ?? '').trim();

export const asArray = (value) => Array.isArray(value) ? value : [];

export const asRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

export const recordKey = (row, fallback = '') => normalizeId(row?.id ?? row?.pk ?? fallback);

export const uniqueBy = (rows, getKey) => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row, index) => {
    const rawKey = getKey(row, index);
    const key = normalizeId(rawKey);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizedTextKey = (...parts) => (
  parts
    .map(part => normalizeId(part).toLowerCase())
    .filter(Boolean)
    .join(':')
);

export const mergeBookingItems = (items) => {
  const merged = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const name = normalizeId(item?.name);
    if (!name) return;
    const key = name.toLowerCase();
    const quantity = Math.max(Number(item?.quantity || 1), 1);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    merged.set(key, { ...item, name, quantity });
  });
  return Array.from(merged.values());
};

export const normalizeBooking = (booking) => ({
  ...booking,
  items: mergeBookingItems(booking?.items),
  payments: uniqueBy(
    booking?.payments,
    payment => payment?.id || normalizedTextKey(payment?.reference_number, payment?.created_at)
  ),
  change_history: uniqueBy(
    booking?.change_history,
    change => change?.id || normalizedTextKey(change?.created_at, change?.reason)
  ),
});

export const normalizeBookings = (rows) => (
  uniqueBy(rows, row => row?.id || normalizedTextKey(row?.customer?.id, row?.package, row?.scheduled_date, row?.scheduled_time))
    .map(normalizeBooking)
);

export const normalizePackages = (rows) => uniqueBy(
  rows,
  pkg => pkg?.id || normalizedTextKey(pkg?.service, pkg?.name)
);

export const normalizeServices = (rows) => uniqueBy(
  rows,
  service => service?.id || normalizedTextKey(service?.name)
).map(service => ({
  ...service,
  packages: normalizePackages(service?.packages),
}));

export const normalizePayments = (rows) => uniqueBy(
  rows,
  payment => payment?.id || normalizedTextKey(payment?.payment_type, payment?.reference_number, payment?.created_at)
);

export const normalizeRowsById = (rows, fallbackKey = row => row?.name) => uniqueBy(
  rows,
  (row, index) => row?.id || fallbackKey(row, index)
);

export const normalizeGalleryImages = (rows) => uniqueBy(
  rows,
  image => image?.id || normalizedTextKey(image?.image_url, image?.title)
);

export const normalizeDashboardAnalytics = (analytics) => {
  if (!analytics || typeof analytics !== 'object') return analytics;
  return {
    ...analytics,
    metrics: asRecord(analytics.metrics),
    recent_bookings: uniqueBy(
      asArray(analytics.recent_bookings),
      booking => booking?.id || normalizedTextKey(booking?.customer_name, booking?.scheduled_date, booking?.scheduled_time)
    ),
    recent_pos_transactions: uniqueBy(
      asArray(analytics.recent_pos_transactions),
      order => order?.id || order?.transaction_id || normalizedTextKey(order?.date, order?.total)
    ),
    low_stock_alerts: normalizeRowsById(analytics.low_stock_alerts),
    inventory_alerts: normalizeRowsById(analytics.inventory_alerts),
    top_selling_products: uniqueBy(asArray(analytics.top_selling_products), row => normalizedTextKey(row?.product)),
    top_booked_packages: uniqueBy(asArray(analytics.top_booked_packages), row => normalizedTextKey(row?.package)),
    sales_history_chart: asArray(analytics.sales_history_chart),
    inventory_status_counts: asRecord(analytics.inventory_status_counts),
  };
};
