const numericValueOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function selectSalesForecastRows(dailyRows, view) {
  if (view === 'next_week') return dailyRows.slice(7, 14);
  if (view === 'upcoming_months') return dailyRows;
  return dailyRows.slice(0, 7);
}

export function buildSalesForecastChartData(historyRows, forecastRows) {
  const historical = historyRows.map(row => {
    const actual = numericValueOrNull(row.actual_sales ?? row.total_revenue);
    return {
      date: row.date,
      actual_sales: actual,
      forecast_sales: numericValueOrNull(row.backtest_predicted_sales),
      combined_sales: actual,
      is_imputed: Boolean(row.is_imputed),
    };
  });
  const future = forecastRows.map(row => {
    const prediction = numericValueOrNull(row.predicted_sales);
    const hasStatisticalInterval = row.interval_method === 'ols_prediction_interval';
    return {
      date: row.target_date,
      forecast_sales: prediction,
      combined_sales: prediction,
      lower_bound: hasStatisticalInterval ? numericValueOrNull(row.lower_bound) : null,
      upper_bound: hasStatisticalInterval ? numericValueOrNull(row.upper_bound) : null,
    };
  });
  return [...historical, ...future].sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

export function filterSalesChartData(rows, startDate = '', endDate = '') {
  if (startDate && endDate && startDate > endDate) return [];
  return rows.filter(row => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate));
}

function bucketDate(date, granularity) {
  if (granularity === 'monthly') return `${date.slice(0, 7)}-01`;
  if (granularity !== 'weekly') return date;
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(year, month - 1, day - mondayOffset));
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

export function aggregateSalesChartData(rows, granularity = 'daily') {
  if (granularity === 'daily') return rows.map(row => ({ ...row, period_start: row.date, period_end: row.date }));
  const buckets = new Map();
  rows.forEach(row => {
    const key = bucketDate(row.date, granularity);
    const bucket = buckets.get(key) || {
      date: key, period_start: row.date, period_end: row.date,
      actual_sales: null, forecast_sales: null, combined_sales: null,
      lower_bound: null, upper_bound: null, is_imputed: false,
    };
    bucket.period_start = bucket.period_start < row.date ? bucket.period_start : row.date;
    bucket.period_end = bucket.period_end > row.date ? bucket.period_end : row.date;
    ['actual_sales', 'forecast_sales', 'combined_sales', 'lower_bound', 'upper_bound'].forEach(series => {
      const value = numericValueOrNull(row[series]);
      if (value !== null) bucket[series] = (bucket[series] ?? 0) + value;
    });
    bucket.is_imputed = bucket.is_imputed || Boolean(row.is_imputed);
    buckets.set(key, bucket);
  });
  return [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function getSalesYAxisDomain(rows, visibleSeries = { actual: true, forecast: true, combined: true }) {
  const series = [];
  if (visibleSeries.actual) series.push('actual_sales');
  if (visibleSeries.forecast) series.push('forecast_sales', 'lower_bound', 'upper_bound');
  if (visibleSeries.combined) series.push('combined_sales');
  const values = rows.flatMap(row => series.map(key => numericValueOrNull(row[key])))
    .filter(value => value !== null);
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.08, Math.max(Math.abs(max), 1) * 0.03, 1);
  return [min >= 0 ? Math.max(0, min - padding) : min - padding, max + padding];
}

export function zoomSalesChartRange({ start, end, total, factor, anchorRatio = 0.5, minSize = 3 }) {
  if (total < 2 || !Number.isFinite(factor) || factor <= 0) return { start: 0, end: Math.max(total - 1, 0) };
  const last = total - 1;
  const currentStart = Math.max(0, Math.min(last, start));
  const currentEnd = Math.max(currentStart, Math.min(last, end));
  const currentSize = currentEnd - currentStart + 1;
  const nextSize = Math.max(Math.min(minSize, total), Math.min(total, Math.round(currentSize * factor)));
  const ratio = Math.max(0, Math.min(1, anchorRatio));
  const anchorIndex = currentStart + ratio * (currentSize - 1);
  let nextStart = Math.round(anchorIndex - ratio * (nextSize - 1));
  nextStart = Math.max(0, Math.min(total - nextSize, nextStart));
  return { start: nextStart, end: nextStart + nextSize - 1 };
}

export function panSalesChartRange({ start, end, total, delta }) {
  if (total < 2) return { start: 0, end: Math.max(total - 1, 0) };
  const last = total - 1;
  const currentStart = Math.max(0, Math.min(last, start));
  const currentEnd = Math.max(currentStart, Math.min(last, end));
  const size = currentEnd - currentStart + 1;
  const nextStart = Math.max(0, Math.min(total - size, currentStart + Math.round(delta)));
  return { start: nextStart, end: nextStart + size - 1 };
}
