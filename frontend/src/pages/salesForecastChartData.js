const numericValueOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function selectSalesForecastRows(dailyRows, monthlyRows, view) {
  if (view === 'next_week') return dailyRows.slice(7, 14);
  if (view === 'upcoming_months') return monthlyRows;
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
    return {
      date: row.target_date,
      forecast_sales: prediction,
      combined_sales: prediction,
      lower_bound: numericValueOrNull(row.lower_bound),
      upper_bound: numericValueOrNull(row.upper_bound),
    };
  });
  return [...historical, ...future].sort((left, right) => String(left.date).localeCompare(String(right.date)));
}
