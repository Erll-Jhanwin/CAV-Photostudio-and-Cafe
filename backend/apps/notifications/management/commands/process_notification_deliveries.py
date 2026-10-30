from django.core.management.base import BaseCommand, CommandError
from notifications.sms import process_sms_deliveries
from booking.email_notifications import process_due_booking_emails


class Command(BaseCommand):
    help = 'Recover unprocessed SMS, retry known failures, and check provider delivery reports.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        if not 1 <= options['limit'] <= 1000:
            raise CommandError('--limit must be between 1 and 1000.')
        process_sms_deliveries(options['limit'])
        email_counts = process_due_booking_emails(options['limit'])
        summary = ', '.join(f'{name}={count}' for name, count in email_counts.items() if count) or 'no due booking emails'
        self.stdout.write(f'SMS and booking email delivery processing finished ({summary}). Check persisted delivery records for individual outcomes.')
