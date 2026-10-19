from django.core.management.base import BaseCommand, CommandError
from notifications.sms import process_sms_deliveries


class Command(BaseCommand):
    help = 'Recover unprocessed SMS, retry known failures, and check provider delivery reports.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        if not 1 <= options['limit'] <= 1000:
            raise CommandError('--limit must be between 1 and 1000.')
        process_sms_deliveries(options['limit'])
        self.stdout.write('SMS delivery processing finished. Check delivery records for individual outcomes.')
