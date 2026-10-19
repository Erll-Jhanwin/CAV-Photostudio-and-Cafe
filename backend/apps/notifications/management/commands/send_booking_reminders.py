from datetime import datetime

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from booking.availability import ACTIVE_BOOKING_STATUSES
from booking.models import Booking

from notifications.models import Notification, NotificationDelivery
from notifications.reminders import (
    REMINDER_DEFINITIONS,
    REMINDER_OFFSETS,
    build_booking_reminder_message,
    is_reminder_due,
    reminder_event_key,
)
from notifications.services import create_booking_notification


class Command(BaseCommand):
    help = 'Send due SMS booking reminders through the configured notification pipeline.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--at',
            dest='reference_time',
            help='Use this ISO-8601 time instead of the current time (useful for tests).',
        )
        parser.add_argument(
            '--window-minutes',
            type=int,
            default=None,
            help='Delivery window around each reminder target; defaults to BOOKING_REMINDER_WINDOW_MINUTES.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List due reminders without creating notifications or contacting providers.',
        )

    def handle(self, *args, **options):
        reference_time = self._parse_reference_time(options.get('reference_time'))
        window_minutes = options.get('window_minutes')
        if window_minutes is None:
            window_minutes = getattr(settings, 'BOOKING_REMINDER_WINDOW_MINUTES', 30)
        if window_minutes <= 0:
            raise CommandError('--window-minutes must be greater than zero.')

        counts = {
            'created': 0,
            'already_sent': 0,
            'already_recorded': 0,
            'cancelled_or_changed': 0,
            'dry_run': 0,
        }
        bookings = Booking.objects.filter(
            status__in=ACTIVE_BOOKING_STATUSES,
        ).select_related('customer', 'package', 'package__service')

        for booking in bookings.iterator():
            session_start = booking.starts_at
            if not session_start:
                continue
            for reminder_code, notification_type, reminder_label, offset in REMINDER_DEFINITIONS:
                if not is_reminder_due(session_start, reference_time, offset, window_minutes):
                    continue
                result = self._process_reminder(
                    booking_id=booking.id,
                    reminder_code=reminder_code,
                    notification_type=notification_type,
                    reminder_label=reminder_label,
                    reference_time=reference_time,
                    window_minutes=window_minutes,
                    dry_run=options['dry_run'],
                )
                counts[result] += 1

        summary = ', '.join(f'{key}={value}' for key, value in counts.items() if value)
        if not summary:
            summary = 'no due reminders'
        self.stdout.write(
            self.style.SUCCESS(
                f'Booking reminder run at {reference_time.isoformat()}: {summary}.'
            )
        )

    def _process_reminder(
        self,
        *,
        booking_id,
        reminder_code,
        notification_type,
        reminder_label,
        reference_time,
        window_minutes,
        dry_run,
    ):
        """Lock the booking while checking the current schedule and deduping."""
        with transaction.atomic():
            booking = (
                Booking.objects.select_for_update()
                .select_related('customer', 'package', 'package__service')
                .get(pk=booking_id)
            )
            session_start = booking.starts_at
            if (
                booking.status not in ACTIVE_BOOKING_STATUSES
                or not session_start
                or not is_reminder_due(
                    session_start,
                    reference_time,
                    REMINDER_OFFSETS[reminder_code],
                    window_minutes,
                )
            ):
                return 'cancelled_or_changed'

            message = build_booking_reminder_message(booking, reminder_label)
            existing = Notification.objects.filter(
                booking_id=booking.id,
                notification_type=notification_type,
                message=message,
            ).order_by('-id').first()
            if existing:
                has_sent_sms = NotificationDelivery.objects.filter(
                    notification=existing,
                    channel=NotificationDelivery.CHANNEL_SMS,
                    status__in=[NotificationDelivery.STATUS_ACCEPTED, NotificationDelivery.STATUS_SENT, NotificationDelivery.STATUS_DELIVERED],
                ).exists()
                return 'already_sent' if has_sent_sms else 'already_recorded'

            if dry_run:
                self.stdout.write(
                    f'[dry-run] booking #{booking.id}: {notification_type}'
                )
                return 'dry_run'

            create_booking_notification(
                booking=booking,
                notification_type=notification_type,
                title=f'Photo session reminder ({reminder_label})',
                message=message,
                event_key=reminder_event_key(booking, notification_type),
            )
            return 'created'

    @staticmethod
    def _parse_reference_time(value):
        if not value:
            return timezone.localtime(timezone.now())
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as exc:
            raise CommandError('--at must be a valid ISO-8601 datetime.') from exc
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        return timezone.localtime(parsed)
