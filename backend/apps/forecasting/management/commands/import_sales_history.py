import json

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from forecasting.models import ForecastRun
from ml.linear_regression_forecasting import MODEL_VERSION, create_forecast_run
from ml.sales_history_repository import DEFAULT_SOURCE_NAME, import_sales_history_csv


class Command(BaseCommand):
    help = 'Validate and import a sales-history CSV into the forecasting tables.'

    def add_arguments(self, parser):
        parser.add_argument('--path', dest='path', help='CSV path. Defaults to SALES_HISTORY_CSV_PATH or the project upload.')
        parser.add_argument('--source-name', default=DEFAULT_SOURCE_NAME, help='Logical source name for the forecasting snapshot.')

    def handle(self, *args, **options):
        result = import_sales_history_csv(options.get('path'), options['source_name'])
        self.stdout.write(json.dumps(result, indent=2, default=str))
        if result['status'] != 'ok':
            raise CommandError(result.get('detail') or 'Sales history import failed.')
        cache.delete(f'forecasting:dashboard-report:v2:{timezone.localdate().isoformat()}')
        ForecastRun.objects.filter(model_version=MODEL_VERSION).delete()
        run = create_forecast_run(source_name=options['source_name'])
        if run.data_status != 'ready':
            raise CommandError((run.evaluation or {}).get('detail') or 'The imported sales history could not produce a valid regression backtest.')
        if result.get('duplicate'):
            self.stdout.write(self.style.WARNING('Matching CSV snapshot was revalidated and refreshed in place.'))
        else:
            self.stdout.write(self.style.SUCCESS('Sales history imported and activated.'))
        self.stdout.write(json.dumps({
            'forecast_run_id': run.id,
            'training_computation': run.evaluation['sales']['training_computation'],
            'backtest': run.evaluation['sales']['backtest'],
        }, indent=2, default=str))
