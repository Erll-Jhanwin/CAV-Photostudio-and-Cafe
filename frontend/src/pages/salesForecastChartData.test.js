import {
  aggregateSalesChartData,
  buildSalesForecastChartData,
  filterSalesChartData,
  getSalesYAxisDomain,
  selectSalesForecastRows,
} from './salesForecastChartData';

describe('sales forecast chart data', () => {
  it('keeps complete years, chronological order, real zeros, nulls, and combined values', () => {
    const chartRows = buildSalesForecastChartData([
      { date: '2025-01-01', actual_sales: 50, backtest_predicted_sales: 45 },
      { date: '2024-12-31', actual_sales: 0, backtest_predicted_sales: null },
    ], [
      { target_date: '2025-01-02', predicted_sales: 30, lower_bound: 20, upper_bound: 40 },
    ]);

    expect(chartRows.map(row => row.date)).toEqual(['2024-12-31', '2025-01-01', '2025-01-02']);
    expect(chartRows[0]).toMatchObject({ actual_sales: 0, forecast_sales: null, combined_sales: 0 });
    expect(chartRows[1]).toMatchObject({ actual_sales: 50, forecast_sales: 45, combined_sales: 50 });
    expect(chartRows[2]).toMatchObject({ forecast_sales: 30, combined_sales: 30, lower_bound: 20, upper_bound: 40 });
  });

  it('selects distinct next-week and monthly forecast ranges', () => {
    const daily = Array.from({ length: 90 }, (_, index) => ({ target_date: `2025-08-${index + 1}`, predicted_sales: index }));
    expect(selectSalesForecastRows(daily, 'next_7_days')).toEqual(daily.slice(0, 7));
    expect(selectSalesForecastRows(daily, 'next_week')).toEqual(daily.slice(7, 14));
    expect(selectSalesForecastRows(daily, 'upcoming_months')).toEqual(daily);
  });

  it('filters by inclusive date bounds and aggregates into calendar weeks and months', () => {
    const rows = [
      { date: '2024-12-30', actual_sales: 10, forecast_sales: null, combined_sales: 10 },
      { date: '2025-01-01', actual_sales: 0, forecast_sales: 12, combined_sales: 0 },
      { date: '2025-01-02', actual_sales: null, forecast_sales: 15, combined_sales: 15 },
      { date: '2025-02-01', actual_sales: 20, forecast_sales: null, combined_sales: 20 },
    ];

    expect(filterSalesChartData(rows, '2025-01-01', '2025-01-02')).toEqual(rows.slice(1, 3));
    expect(filterSalesChartData(rows, '2025-02-02', '2025-01-01')).toEqual([]);
    expect(aggregateSalesChartData(rows, 'weekly').map(row => row.date)).toEqual(['2024-12-30', '2025-01-27']);
    expect(aggregateSalesChartData(rows, 'weekly')[0]).toMatchObject({ actual_sales: 10, forecast_sales: 27, combined_sales: 25, period_start: '2024-12-30', period_end: '2025-01-02' });
    expect(aggregateSalesChartData(rows, 'monthly').map(row => row.date)).toEqual(['2024-12-01', '2025-01-01', '2025-02-01']);
  });

  it('fits the Y-axis to only the visible series and sales values', () => {
    const rows = [
      { actual_sales: 100, forecast_sales: null, lower_bound: null, upper_bound: null, combined_sales: 100 },
      { actual_sales: 120, forecast_sales: 140, lower_bound: 130, upper_bound: 150, combined_sales: 140 },
    ];

    expect(getSalesYAxisDomain(rows, { actual: true, forecast: false, combined: false })[1]).toBeLessThan(125);
    const withForecast = getSalesYAxisDomain(rows, { actual: false, forecast: true, combined: false });
    expect(withForecast[0]).toBeLessThanOrEqual(130);
    expect(withForecast[1]).toBeGreaterThanOrEqual(150);
  });
});
