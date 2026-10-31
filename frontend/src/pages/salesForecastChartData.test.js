import { buildSalesForecastChartData, selectSalesForecastRows } from './salesForecastChartData';

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
    const monthly = [{ target_date: '2025-08-01', predicted_sales: 500 }, { target_date: '2025-09-01', predicted_sales: 600 }];

    expect(selectSalesForecastRows(daily, monthly, 'next_7_days')).toEqual(daily.slice(0, 7));
    expect(selectSalesForecastRows(daily, monthly, 'next_week')).toEqual(daily.slice(7, 14));
    expect(selectSalesForecastRows(daily, monthly, 'upcoming_months')).toEqual(monthly);
  });
});
