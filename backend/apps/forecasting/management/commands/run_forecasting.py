import json

from django.core.management.base import BaseCommand
from ml.forecasting_engine import generate_forecast_report

class Command(BaseCommand):
    help = 'Builds the CSV-backed sales and product forecasts for the next 90 days.'

    def handle(self, *args, **options):
        self.stdout.write('Starting ML forecasting training and predictions...')
        
        report = generate_forecast_report()
        self.stdout.write(json.dumps({
            'status': report.get('status'),
            'source_file': report.get('source_file'),
            'history': [report.get('history_start'), report.get('history_end')],
            'forecast': [report.get('forecast_start'), report.get('forecast_end')],
            'products': len(report.get('product_forecasts', [])),
            'data_sufficiency': report.get('data_sufficiency'),
            'metrics': report.get('metrics'),
        }, indent=2, default=str))
        if report.get('status') == 'ok':
            self.stdout.write(self.style.SUCCESS('Forecasting completed successfully.'))
        else:
            self.stdout.write(self.style.WARNING('Forecasting did not produce predictions: ' + report.get('detail', 'unknown error')))
