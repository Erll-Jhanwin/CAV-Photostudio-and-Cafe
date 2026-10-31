import csv
import tempfile
from datetime import date, timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from forecasting.models import ForecastRun
from ml.linear_regression_forecasting import (
    create_forecast_run, evaluate_series, fit_linear_regression, load_daily_sales,
)


class LinearRegressionCalculationTests(TestCase):
    def test_ordinary_least_squares_reports_formula_sums_and_forecasts(self):
        model = fit_linear_regression([10, 20, 30])
        self.assertEqual(model, {
            'sample_count': 3, 'sum_x': 3, 'sum_y': 60,
            'sum_x2': 5, 'sum_xy': 80, 'slope': 10.0, 'intercept': 10.0,
        })

    def test_chronological_holdout_reports_metrics_and_mean_baseline(self):
        values = [float(index) for index in range(10)]
        dates = [date(2025, 1, 1) + timedelta(days=index) for index in range(10)]
        evaluation = evaluate_series(values, dates)
        self.assertEqual(evaluation['train_count'], 8)
        self.assertEqual(evaluation['test_count'], 2)
        self.assertEqual(evaluation['training_end'], '2025-01-08')
        self.assertEqual(evaluation['testing_start'], '2025-01-09')
        self.assertEqual(evaluation['linear_regression'], {'mae': 0.0, 'rmse': 0.0, 'r2': 1.0})
        self.assertIn('mae', evaluation['baseline'])

    def test_actual_csv_is_validated_sorted_and_labeled_synthetic(self):
        dataset = load_daily_sales()
        self.assertEqual(dataset['status'], 'ok')
        self.assertTrue(dataset['quality']['is_synthetic'])
        self.assertEqual(dataset['quality']['columns'], ['Date', 'Orders', 'Units', 'Sales (PHP)', 'Data origin'])
        self.assertEqual(dataset['quality']['raw_rows'], 1096)
        self.assertEqual(dataset['quality']['exact_duplicate_rows_removed'], 0)
        self.assertEqual(dataset['quality']['duplicate_date_rows_aggregated'], 0)
        self.assertEqual(dataset['quality']['imputed_missing_days'], 0)
        self.assertEqual(dataset['dates'][0].isoformat(), '2022-08-01')
        self.assertEqual(dataset['dates'][-1].isoformat(), '2025-07-31')
        self.assertEqual(len(dataset['values']), 1096)

    def test_missing_and_duplicate_dates_are_handled_without_leakage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.csv'
            rows = [
                {'Date': '2025-01-02', 'Sales (PHP)': '20', 'Data origin': 'SYNTHETIC'},
                {'Date': '2025-01-01', 'Sales (PHP)': '10', 'Data origin': 'SYNTHETIC'},
                {'Date': '2025-01-01', 'Sales (PHP)': '10', 'Data origin': 'SYNTHETIC'},
                {'Date': '2025-01-02', 'Sales (PHP)': '5', 'Data origin': 'SYNTHETIC'},
            ]
            with path.open('w', newline='', encoding='utf-8') as handle:
                writer = csv.DictWriter(handle, fieldnames=['Date', 'Sales (PHP)', 'Data origin'])
                writer.writeheader()
                writer.writerows(rows)
            dataset = load_daily_sales(path)
        self.assertEqual(dataset['values'], [10.0, 25.0])
        self.assertEqual(dataset['quality']['exact_duplicate_rows_removed'], 1)
        self.assertEqual(dataset['quality']['duplicate_date_rows_aggregated'], 1)


class ForecastDataIntegrationTests(TestCase):
    def test_forecast_run_uses_synthetic_csv_and_saves_holdout_and_future(self):
        run = create_forecast_run(horizon=7)
        self.assertEqual(run.data_status, 'ready')
        self.assertEqual(run.model_version, 'daily-sales-ols-synthetic-v1')
        self.assertEqual(run.training_start, date(2022, 8, 1))
        self.assertEqual(run.training_end, date(2025, 7, 31))
        self.assertEqual(len(run.predictions['backtest']), 220)
        self.assertEqual(len(run.predictions['sales']), 7)
        self.assertEqual(run.predictions['sales'][0]['date'], '2025-08-01')
        self.assertEqual(run.evaluation['sales']['train_count'], 876)
        self.assertEqual(run.evaluation['sales']['test_count'], 220)
        self.assertTrue(run.evaluation['sales']['data_quality']['is_synthetic'])

    def test_forecast_endpoint_is_staff_only_and_accepts_valid_horizon(self):
        customer = get_user_model().objects.create_user(username='forecast-customer', password='test-pass', role='CUSTOMER')
        staff = get_user_model().objects.create_user(username='forecast-staff', password='test-pass', role='STAFF')
        client = APIClient()
        client.force_authenticate(customer)
        self.assertEqual(client.get('/api/forecasting/ml/').status_code, 403)
        client.force_authenticate(staff)
        response = client.post('/api/forecasting/ml/', {'horizon_days': 7}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['model_version'], 'daily-sales-ols-synthetic-v1')
        self.assertEqual(response.data['dataset']['dataset_type'], 'Synthetic dataset')
        self.assertEqual(ForecastRun.objects.count(), 1)
