from datetime import timedelta

from django.utils import timezone


REMINDER_DEFINITIONS = (
    ('24H', 'BOOKING_REMINDER_24H', '24-hour', timedelta(hours=24)),
    ('2H', 'BOOKING_REMINDER_2H', '2-hour', timedelta(hours=2)),
)
REMINDER_OFFSETS = {code: offset for code, _, _, offset in REMINDER_DEFINITIONS}


def format_booking_start(booking):
    """Return the booking start in the application's local timezone."""
    return timezone.localtime(booking.starts_at)


def build_booking_reminder_message(booking, reminder_label):
    """Build the stable message/signature used for reminder deduplication."""
    starts_at = format_booking_start(booking)
    date_text = f'{starts_at.strftime("%B")} {starts_at.day}, {starts_at.year}'
    time_text = starts_at.strftime('%I:%M %p').lstrip('0')
    return (
        f'CAV reminder ({reminder_label}): Your photo session for booking '
        f'#{booking.id} is on {date_text} at {time_text}. '
        'Please arrive 15 minutes early. Bring any outfits or props you plan '
        'to use and arrive camera-ready.'
    )


def is_reminder_due(session_start, reference_time, offset, window_minutes):
    """Return whether a scheduler run is inside a reminder's delivery window."""
    if not session_start or reference_time >= session_start:
        return False
    target_time = session_start - offset
    return abs((reference_time - target_time).total_seconds()) <= window_minutes * 60
