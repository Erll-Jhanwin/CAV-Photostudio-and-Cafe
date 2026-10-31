import {
  aggregateSalesChartData,
  buildSalesForecastChartData,
  filterSalesChartData,
  getSalesYAxisDomain,
  panSalesChartRange,
  selectSalesForecastRows,
  zoomSalesChartRange,
} from './salesForecastChartData';

describe('sales forecast chart data', () => {
  it('maps verified imported API revenue and prediction into the chart series', () => {
    const chartRows = buildSalesForecastChartData([
      { date: '2022-08-01', actual_sales: 130, backtest_predicted_sales: null },
    ], [
      { target_date: '2025-08-01', predicted_sales: 122.65, lower_bound: null, upper_bound: null },
    ]);

    expect(chartRows).toEqual([
      expect.objectContaining({ date: '2022-08-01', actual_sales: 130, combined_sales: 130 }),
      expect.objectContaining({ date: '2025-08-01', forecast_sales: 122.65, combined_sales: 122.65, lower_bound: null, upper_bound: null }),
    ]);
  });

  it('keeps complete years, chronological order, real zeros, nulls, and combined values', () => {
    const chartRows = buildSalesForecastChartData([
      { date: '2025-01-01', actual_sales: 50, backtest_predicted_sales: 45 },
      { date: '2024-12-31', actual_sales: 0, backtest_predicted_sales: null },
    ], [
      { target_date: '2025-01-02', predicted_sales: 30, lower_bound: 20, upper_bound: 40 },
      { target_date: '2025-01-03', predicted_sales: 35, lower_bound: 25, upper_bound: 45, interval_method: 'ols_prediction_interval' },
    ]);

    expect(chartRows.map(row => row.date)).toEqual(['2024-12-31', '2025-01-01', '2025-01-02', '2025-01-03']);
    expect(chartRows[0]).toMatchObject({ actual_sales: 0, forecast_sales: null, combined_sales: 0 });
    expect(chartRows[1]).toMatchObject({ actual_sales: 50, forecast_sales: 45, combined_sales: 50 });
    expect(chartRows[2]).toMatchObject({ forecast_sales: 30, combined_sales: 30, lower_bound: null, upper_bound: null });
    expect(chartRows[3]).toMatchObject({ forecast_sales: 35, lower_bound: 25, upper_bound: 45 });
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

  it('zooms around the cursor while respecting minimum and maximum date limits', () => {
    expect(zoomSalesChartRange({ start: 0, end: 19, total: 20, factor: 0.5, anchorRatio: 0.75 }))
      .toEqual({ start: 8, end: 17 });
    expect(zoomSalesChartRange({ start: 5, end: 7, total: 20, factor: 0.5, anchorRatio: 0.5 }))
      .toEqual({ start: 5, end: 7 });
    expect(zoomSalesChartRange({ start: 0, end: 19, total: 20, factor: 3, anchorRatio: 0.5 }))
      .toEqual({ start: 0, end: 19 });
  });

  it('pans by date intervals and clamps at either end without changing zoom width', () => {
    expect(panSalesChartRange({ start: 5, end: 9, total: 20, delta: -3 }))
      .toEqual({ start: 2, end: 6 });
    expect(panSalesChartRange({ start: 1, end: 5, total: 20, delta: -20 }))
      .toEqual({ start: 0, end: 4 });
    expect(panSalesChartRange({ start: 15, end: 19, total: 20, delta: 20 }))
      .toEqual({ start: 15, end: 19 });
  });
});
