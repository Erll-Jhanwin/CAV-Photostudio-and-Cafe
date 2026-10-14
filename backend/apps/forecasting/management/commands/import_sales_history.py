import json

from django.core.management.base import BaseCommand, CommandError

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
        if result.get('duplicate'):
            self.stdout.write(self.style.WARNING('Duplicate import skipped; existing validated snapshot is active.'))
        else:
            self.stdout.write(self.style.SUCCESS('Sales history imported and activated.'))
