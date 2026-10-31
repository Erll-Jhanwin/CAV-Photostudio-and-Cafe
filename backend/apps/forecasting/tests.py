import csv
import os
import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from forecasting.models import ForecastRun, SalesHistoryImport, SalesHistoryRecord
from ml.forecasting_engine import generate_forecast_report
from ml.linear_regression_forecasting import MODEL_VERSION, dataset_path
from ml.sales_history_repository import _decimal, import_sales_history_csv
from forecasting.views import forecast_cache_key


class ForecastingEngineTests(TestCase):
    def write_history(self, rows):
        handle = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, newline='', encoding='utf-8')
        writer = csv.DictWriter(handle, fieldnames=[
            'Number', 'Status', 'Date/Time', 'Qty.', 'Total amount',
            'Items Description', 'Total',
        ])
        writer.writeheader()
        writer.writerows(rows)
        handle.close()
        self.addCleanup(lambda: os.path.exists(handle.name) and os.unlink(handle.name))
        return handle.name

    def sample_rows(self):
        return [
            {
                'Number': '1', 'Status': 'Sale', 'Date/Time': '2025-01-01 09:00',
                'Qty.': '3', 'Total amount': '300', 'Items Description': '1x Cafe Latte, 2x Sparkling Green Apple', 'Total': '300',
            },
            {
                'Number': '2', 'Status': 'Sale', 'Date/Time': '2025-01-03 09:00',
                'Qty.': '1', 'Total amount': '120', 'Items Description': '1x Cafe Latte', 'Total': '120',
            },
            {
                'Number': '3', 'Status': 'Cancelled', 'Date/Time': '2025-01-04 09:00',
                'Qty.': '1', 'Total amount': '120', 'Items Description': '1x Cafe Latte', 'Total': '120',
            },
        ]

    def test_import_is_idempotent_and_report_uses_active_supabase_snapshot(self):
        path = self.write_history(self.sample_rows())

        imported = import_sales_history_csv(path)
        duplicate = import_sales_history_csv(path)
        report = generate_forecast_report(horizon=14)

        self.assertEqual(imported['status'], 'ok')
        self.assertTrue(imported['imported'])
        self.assertTrue(duplicate['duplicate'])
        self.assertEqual(SalesHistoryImport.objects.count(), 1)
        self.assertEqual(SalesHistoryRecord.objects.count(), 3)
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['data_quality']['parsed_transactions'], 2)
        self.assertEqual(report['history_start'], '2025-01-01')
        self.assertEqual(report['history_end'], '2025-01-03')
        self.assertEqual(len(report['actual_history']), 3)
        self.assertTrue(report['actual_history'][1]['is_imputed'])
        self.assertEqual(len(report['sales_forecast']), 14)
        self.assertEqual(report['forecast_ranges']['next_7_days']['rows'], 7)
        self.assertEqual(report['forecast_ranges']['next_week']['rows'], 7)
        self.assertEqual({row['product_name'] for row in report['product_forecasts']}, {
            'Cafe Latte', 'Sparkling Green Apple',
        })
        self.assertIn('mae', report['metrics'])
        self.assertFalse(report['data_sufficiency']['is_sufficient'])
        self.assertFalse(report['data_sufficiency']['requested_30_day_observed_coverage']['available'])
        self.assertEqual(report['data_sufficiency']['requested_30_day_observed_coverage']['observed_days'], 2)

    def test_new_snapshot_refreshes_active_data_without_deleting_old_history(self):
        first_path = self.write_history(self.sample_rows())
        second_rows = self.sample_rows()[:2] + [{
            'Number': '4', 'Status': 'Sale', 'Date/Time': '2025-02-01 09:00',
            'Qty.': '1', 'Total amount': '140', 'Items Description': '1x Cafe Latte', 'Total': '140',
        }]
        second_path = self.write_history(second_rows)

        import_sales_history_csv(first_path)
        import_sales_history_csv(second_path)

        self.assertEqual(SalesHistoryImport.objects.count(), 2)
        self.assertEqual(SalesHistoryRecord.objects.count(), 6)
        self.assertEqual(SalesHistoryImport.objects.filter(is_active=True).count(), 1)
        report = generate_forecast_report()
        self.assertEqual(report['history_end'], '2025-02-01')

    def test_synthetic_daily_sales_import_reaches_linear_regression_and_populates_ranges(self):
        imported = import_sales_history_csv()
        report = generate_forecast_report()

        self.assertEqual(imported['status'], 'ok')
        self.assertEqual(imported['imported_row_count'], 1096)
        self.assertEqual(imported['skipped_row_count'], 0)
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['source_file'], 'CAV_Three_Year_Synthetic_Sales-Daily sales.csv')
        self.assertTrue(report['data_quality']['is_synthetic'])
        self.assertEqual(report['data_quality']['source_columns'], ['Date', 'Orders', 'Units', 'Sales (PHP)', 'Data origin'])
        self.assertEqual(report['data_quality']['valid_rows'], 1096)
        self.assertEqual(report['data_quality']['total_sales'], 120750.0)
        self.assertEqual(report['data_quality']['dataset_type'], 'Synthetic daily sales data')
        self.assertEqual(report['actual_history'][0]['date'], '2022-08-01')
        self.assertEqual(report['actual_history'][0]['actual_sales'], 130.0)
        self.assertEqual(report['data_quality']['history_days'], 1096)
        self.assertEqual(report['history_start'], '2022-08-01')
        self.assertEqual(report['history_end'], '2025-07-31')
        self.assertEqual(report['model']['name'], 'linear_regression')
        self.assertEqual(report['model']['training_computation']['sample_count'], 876)
        self.assertEqual(report['model']['training_computation']['sum_y'], 94975.0)
        self.assertNotEqual(report['model']['training_computation']['sum_xy'], 0)
        self.assertNotEqual(report['model']['training_computation']['slope'], 0)
        self.assertEqual(report['data_quality']['column_mapping']['sales_php'], 'Sales (PHP)')
        self.assertEqual(report['data_quality']['import_quality']['zero_sales_rows'], 533)
        self.assertIsNone(report['sales_forecast'][0]['lower_bound'])
        self.assertIsNone(report['sales_forecast'][0]['upper_bound'])
        self.assertEqual(report['model']['metrics']['holdout_days'], 220)
        self.assertTrue(report['model']['metrics']['accuracy_available'])
        self.assertEqual(len(report['actual_history']), 1096)
        self.assertEqual(len(report['sales_backtest']), 220)
        self.assertEqual(report['forecast_start'], '2025-08-01')
        self.assertEqual(len(report['sales_forecast']), 90)
        final = report['model']['final_model_computation']
        first_prediction = (final['slope'] * final['sample_count']) + final['intercept']
        self.assertAlmostEqual(report['sales_forecast'][0]['predicted_sales'], first_prediction, places=2)
        self.assertEqual(report['sales_forecast'][0]['target_date'], '2025-08-01')
        self.assertGreater(report['sales_forecast'][0]['predicted_sales'], 0)
        self.assertEqual(report['forecast_ranges']['next_7_days']['rows'], 7)
        self.assertEqual(report['forecast_ranges']['next_week']['rows'], 7)
        self.assertEqual(report['forecast_ranges']['next_7_days']['total_predicted_sales'], round(sum(row['predicted_sales'] for row in report['sales_forecast'][:7]), 2))
        self.assertEqual(report['forecast_ranges']['next_week']['total_predicted_sales'], round(sum(row['predicted_sales'] for row in report['sales_forecast'][7:14]), 2))
        self.assertGreater(len(report['forecast_ranges']['upcoming_months']), 0)

    def test_same_hash_import_repairs_old_zero_revenue_snapshot_without_duplicates(self):
        first = import_sales_history_csv()
        batch = SalesHistoryImport.objects.get(source_hash=first['source_hash'])
        original_record_count = batch.records.count()
        batch.records.update(total=0, total_amount=0)

        refreshed = import_sales_history_csv()
        report = generate_forecast_report()

        batch.refresh_from_db()
        self.assertTrue(refreshed['reprocessed'])
        self.assertEqual(refreshed['import_id'], first['import_id'])
        self.assertEqual(batch.records.count(), original_record_count)
        self.assertEqual(batch.imported_row_count, 1096)
        self.assertEqual(batch.skipped_row_count, 0)
        self.assertEqual(report['data_quality']['total_sales'], 120750.0)
        self.assertEqual(report['model']['training_computation']['sum_y'], 94975.0)

    def test_currency_parser_preserves_zero_and_rejects_missing_or_malformed_amounts(self):
        self.assertEqual(_decimal('₱1,234.50'), Decimal('1234.50'))
        self.assertEqual(_decimal('PHP 1,234.50'), Decimal('1234.50'))
        self.assertEqual(_decimal('(PHP 12.00)'), Decimal('-12.00'))
        self.assertEqual(_decimal('0.00'), Decimal('0.00'))
        self.assertIsNone(_decimal(''))
        self.assertIsNone(_decimal('1,2,34.00'))

    def test_import_keeps_explicit_zero_and_reports_invalid_revenue_rows(self):
        rows = [
            {'Number': '1', 'Status': 'Sale', 'Date/Time': '2025-01-01', 'Qty.': '1', 'Total amount': '1,234.50', 'Items Description': '1x Coffee', 'Total': 'PHP 1,234.50'},
            {'Number': '2', 'Status': 'Sale', 'Date/Time': '2025-01-02', 'Qty.': '0', 'Total amount': '0.00', 'Items Description': '', 'Total': '0.00'},
            {'Number': '3', 'Status': 'Sale', 'Date/Time': '2025-01-03', 'Qty.': '1', 'Total amount': '', 'Items Description': '1x Coffee', 'Total': 'not-a-number'},
        ]
        path = self.write_history(rows)

        imported = import_sales_history_csv(path)
        batch = SalesHistoryImport.objects.get(source_hash=imported['source_hash'])

        self.assertEqual(imported['imported_row_count'], 2)
        self.assertEqual(imported['skipped_row_count'], 1)
        self.assertEqual(batch.quality_report['zero_sales_rows'], 1)
        self.assertEqual(batch.quality_report['missing_or_invalid_sales_rows'], 1)
        self.assertEqual(batch.quality_report['sales_total_php'], 1234.5)
        self.assertEqual(list(batch.records.values_list('total', flat=True)), [Decimal('1234.50'), Decimal('0.00')])

    def test_report_does_not_fabricate_predictions_without_an_import(self):
        report = generate_forecast_report()

        self.assertEqual(report['status'], 'unavailable')
        self.assertEqual(report['sales_forecast'], [])
        self.assertEqual(report['actual_history'], [])
        self.assertFalse(report['data_sufficiency']['is_sufficient'])
        self.assertFalse(report['data_sufficiency']['requested_30_day_observed_coverage']['available'])


class ForecastingImportApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.staff = get_user_model().objects.create_user(
            username='forecasting-staff',
            password='ForecastingPass123!',
            role='STAFF',
        )
        self.customer = get_user_model().objects.create_user(
            username='forecasting-customer',
            password='ForecastingPass123!',
            role='CUSTOMER',
        )
        self.csv_bytes = (
            b'Number,Status,Date/Time,Qty.,Total,Items Description\n'
            b'1,Sale,2025-01-01 09:00,1,100,1x Cafe Latte\n'
        )

    def test_import_endpoint_is_staff_only(self):
        client = APIClient()
        client.force_authenticate(self.customer)
        response = client.post('/api/forecasting/history/import/', {
            'file': SimpleUploadedFile('sales.csv', self.csv_bytes, content_type='text/csv'),
        }, format='multipart')
        self.assertEqual(response.status_code, 403)

    def test_staff_import_endpoint_validates_and_deduplicates(self):
        client = APIClient()
        client.force_authenticate(self.staff)
        ForecastRun.objects.create(model_version=MODEL_VERSION, data_status='ready')
        cache.set(forecast_cache_key(), {'stale': True}, timeout=60)
        first = client.post('/api/forecasting/history/import/', {
            'file': SimpleUploadedFile('sales.csv', self.csv_bytes, content_type='text/csv'),
        }, format='multipart')
        second = client.post('/api/forecasting/history/import/', {
            'file': SimpleUploadedFile('sales.csv', self.csv_bytes, content_type='text/csv'),
        }, format='multipart')
        self.assertEqual(first.status_code, 422)
        self.assertEqual(first.data['forecast_status'], 'error')
        self.assertIsNone(cache.get(forecast_cache_key()))
        self.assertFalse(ForecastRun.objects.filter(model_version=MODEL_VERSION, data_status='ready').exists())
        self.assertEqual(second.status_code, 422)
        self.assertTrue(second.data['duplicate'])
        self.assertEqual(SalesHistoryImport.objects.count(), 1)
        self.assertEqual(SalesHistoryRecord.objects.count(), 1)

    def test_synthetic_csv_import_retrains_from_active_rows_and_returns_verified_values(self):
        path = dataset_path()
        upload = SimpleUploadedFile(path.name, path.read_bytes(), content_type='text/csv')
        client = APIClient()
        client.force_authenticate(self.staff)

        imported = client.post('/api/forecasting/history/import/', {'file': upload}, format='multipart')
        report = client.get('/api/forecasting/predictions/')

        self.assertEqual(imported.status_code, 201)
        self.assertEqual(imported.data['forecast_status'], 'ready')
        self.assertEqual(imported.data['forecast_run']['training_count'], 876)
        self.assertEqual(imported.data['forecast_run']['training_computation']['sum_y'], 94975.0)
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.data['data_quality']['total_sales'], 120750.0)
        self.assertEqual(report.data['actual_history'][0]['actual_sales'], 130.0)
        self.assertEqual(report.data['sales_forecast'][0]['target_date'], '2025-08-01')
        self.assertAlmostEqual(report.data['sales_forecast'][0]['predicted_sales'], 122.65, places=2)


class ForecastingReportApiTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            username='forecast-report-staff',
            password='ForecastingPass123!',
            role='STAFF',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.staff)
        cache.clear()

    def test_forecast_report_is_cached_between_dashboard_requests(self):
        from unittest.mock import patch

        report = {'status': 'unavailable', 'sales_forecast': []}
        with patch('forecasting.views.generate_forecast_report', return_value=report) as generate:
            first = self.client.get('/api/forecasting/predictions/')
            second = self.client.get('/api/forecasting/predictions/')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data, report)
        self.assertEqual(second.data, report)
        generate.assert_called_once_with()

    def test_dashboard_api_bootstraps_bundled_dataset_and_returns_computed_forecast(self):
        response = self.client.get('/api/forecasting/predictions/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'ok')
        self.assertEqual(response.data['data_quality']['valid_rows'], 1096)
        self.assertEqual(response.data['data_quality']['total_sales'], 120750.0)
        self.assertEqual(response.data['model']['training_computation']['sum_y'], 94975.0)
        self.assertEqual(response.data['model']['name'], 'linear_regression')
        self.assertEqual(response.data['sales_forecast'][0]['target_date'], '2025-08-01')
        self.assertGreater(response.data['forecast_ranges']['next_7_days']['total_predicted_sales'], 0)
