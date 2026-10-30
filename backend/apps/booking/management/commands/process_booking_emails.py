from django.core.management.base import BaseCommand, CommandError

from booking.email_notifications import process_due_booking_emails


class Command(BaseCommand):
    help = 'Deliver due booking emails and retry transient provider failures.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 1000:
            raise CommandError('--limit must be between 1 and 1000.')
        counts = process_due_booking_emails(limit)
        summary = ', '.join(f'{name}={count}' for name, count in counts.items() if count) or 'no due emails'
        self.stdout.write(self.style.SUCCESS(f'Booking email processing finished: {summary}.'))
