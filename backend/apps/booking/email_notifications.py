import html
import logging
from uuid import uuid4
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from booking.models import Booking, BookingEmail

logger = logging.getLogger(__name__)
FEEDBACK_SALT = 'booking-feedback-survey-v1'


def booking_email_address(booking):
    return (booking.contact_email or (booking.customer.email if booking.customer_id else '') or '').strip()


def _recipient_name(booking):
    return booking.contact_name or (booking.customer.get_full_name() if booking.customer_id else '') or (booking.customer.username if booking.customer_id else 'there')


def _snapshot(booking, event_type):
    start = timezone.localtime(booking.starts_at)
    package = booking.package
    payload = {
        'booking_id': booking.id,
        'customer_name': _recipient_name(booking),
        'service': package.service.name,
        'package': package.name,
        'date': start.strftime('%A, %B %d, %Y').replace(' 0', ' '),
        'time': start.strftime('%I:%M %p').lstrip('0'),
        'timezone': timezone.get_current_timezone_name(),
        'status': booking.get_status_display(),
        'price': f'PHP {Decimal(str(package.price)):,.2f}',
        'event_type': event_type,
    }
    if event_type == BookingEmail.EVENT_COMPLETED:
        payload['feedback_token'] = signing.dumps({'booking_id': booking.id}, salt=FEEDBACK_SALT)
    return payload


def enqueue_booking_email(booking, event_type, *, scheduled_for=None, event_key=None):
    recipient = booking_email_address(booking)
    if not recipient:
        return None
    scheduled_for = scheduled_for or timezone.now()
    key = event_key or f'booking:{booking.id}:{event_type}'
    email, _ = BookingEmail.objects.get_or_create(
        event_key=key,
        defaults={
            'booking': booking,
            'event_type': event_type,
            'recipient': recipient,
            'scheduled_for': scheduled_for,
            'payload': _snapshot(booking, event_type),
        },
    )
    if (
        event_type == BookingEmail.EVENT_REMINDER
        and email.status == BookingEmail.STATUS_CANCELLED
        and scheduled_for > timezone.now()
    ):
        email.status = BookingEmail.STATUS_QUEUED
        email.scheduled_for = scheduled_for
        email.next_retry_at = None
        email.last_error = ''
        email.save(update_fields=['status', 'scheduled_for', 'next_retry_at', 'last_error', 'updated_at'])
    return email


def queue_booking_submitted(booking):
    enqueue_booking_email(booking, BookingEmail.EVENT_SUBMITTED)
    schedule_booking_reminder(booking)


def queue_booking_approved(booking):
    enqueue_booking_email(booking, BookingEmail.EVENT_APPROVED, event_key=f'booking:{booking.id}:approved:{uuid4().hex}')


def queue_booking_completed(booking):
    enqueue_booking_email(booking, BookingEmail.EVENT_COMPLETED, event_key=f'booking:{booking.id}:completed:{uuid4().hex}')


def schedule_booking_reminder(booking):
    BookingEmail.objects.filter(
        booking=booking,
        event_type=BookingEmail.EVENT_REMINDER,
        status=BookingEmail.STATUS_QUEUED,
    ).update(status=BookingEmail.STATUS_CANCELLED)
    if booking.status not in {'PENDING', 'CONFIRMED', 'CONFIRMED_DP'}:
        return None
    send_at = booking.starts_at - timedelta(hours=24)
    if send_at <= timezone.now():
        return None
    return enqueue_booking_email(
        booking,
        BookingEmail.EVENT_REMINDER,
        scheduled_for=send_at,
        event_key=f'booking:{booking.id}:reminder:{booking.starts_at.isoformat()}',
    )


def cancel_booking_reminders(booking):
    BookingEmail.objects.filter(
        booking=booking,
        event_type=BookingEmail.EVENT_REMINDER,
        status=BookingEmail.STATUS_QUEUED,
    ).update(status=BookingEmail.STATUS_CANCELLED)


def build_email_content(email_event):
    data = email_event.payload
    first_name = html.escape(data.get('customer_name') or 'there')
    status = html.escape(data.get('status') or '')
    details = (
        f"<p><strong>Booking:</strong> #{data['booking_id']}</p>"
        f"<p><strong>Service:</strong> {html.escape(data['service'])}</p>"
        f"<p><strong>Package:</strong> {html.escape(data['package'])}</p>"
        f"<p><strong>Schedule:</strong> {html.escape(data['date'])} at {html.escape(data['time'])} ({html.escape(data['timezone'])})</p>"
        f"<p><strong>Status:</strong> {status}</p><p><strong>Package price:</strong> {html.escape(data['price'])}</p>"
    )
    labels = {
        BookingEmail.EVENT_SUBMITTED: ('Booking request received', 'We received your booking request. We will let you know when it is approved.'),
        BookingEmail.EVENT_APPROVED: ('Your booking is approved', 'Your photo session is confirmed. We look forward to seeing you.'),
        BookingEmail.EVENT_REMINDER: ('Your session is tomorrow', 'A reminder that your photo session is scheduled in about 24 hours.'),
        BookingEmail.EVENT_COMPLETED: ('Photo session completed', 'Your photo session has been marked completed. We would appreciate your feedback.'),
    }
    heading, message = labels[email_event.event_type]
    feedback_link = ''
    text_link = ''
    if email_event.event_type == BookingEmail.EVENT_COMPLETED:
        token = data['feedback_token']
        base = getattr(settings, 'BOOKING_FEEDBACK_URL', 'http://localhost:3000/booking-feedback').rstrip('/')
        url = f'{base}?token={token}'
        feedback_link = f'<p style="margin:28px 0"><a href="{html.escape(url, quote=True)}" style="background:#c49a3a;color:#2e1a11;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Share your feedback</a></p>'
        text_link = f'\nShare your feedback: {url}'
    subject = f'CAV Photo Studio & Cafe · {heading} (#{email_event.booking_id})'
    text_body = f"Hi {data.get('customer_name') or 'there'},\n\n{message}\n\n{data['service']} · {data['package']}\n{data['date']} at {data['time']} ({data['timezone']})\nBooking #{data['booking_id']} · {data['status']}\nPackage price: {data['price']}{text_link}\n\nCAV Photo Studio & Cafe"
    html_body = (
        '<div style="background:#fbf7ee;padding:32px 12px;font-family:Arial,sans-serif;color:#39251b">'
        '<div style="max-width:560px;margin:auto;background:#fffdf8;border:1px solid #e8dcc3;border-radius:16px;padding:28px">'
        '<p style="color:#a87920;font-size:11px;font-weight:bold;letter-spacing:2px">CAV PHOTO STUDIO &amp; CAFE</p>'
        f'<h1 style="font-size:24px">{html.escape(heading)}</h1><p>Hi {first_name},</p><p>{html.escape(message)}</p>'
        f'{details}{feedback_link}<p style="color:#806a56;font-size:12px">Thank you for choosing CAV.</p></div></div>'
    )
    return subject, text_body, html_body


@transaction.atomic
def process_booking_email(email_id, *, now=None):
    from users.email_delivery import EmailDeliveryError, send_transactional_email

    now = now or timezone.now()
    event = BookingEmail.objects.select_for_update().select_related('booking').get(pk=email_id)
    due_time = event.next_retry_at or event.scheduled_for
    if event.status != BookingEmail.STATUS_QUEUED or due_time > now:
        return event.status
    if event.event_type in {BookingEmail.EVENT_APPROVED, BookingEmail.EVENT_COMPLETED}:
        booking_status = Booking.objects.filter(pk=event.booking_id).values_list('status', flat=True).first()
        still_valid = booking_status in {'CONFIRMED', 'CONFIRMED_DP', 'COMPLETED'} if event.event_type == BookingEmail.EVENT_APPROVED else booking_status == 'COMPLETED'
        if not still_valid:
            event.status = BookingEmail.STATUS_CANCELLED
            event.save(update_fields=['status', 'updated_at'])
            return event.status
    if event.event_type == BookingEmail.EVENT_REMINDER:
        booking = Booking.objects.select_for_update().get(pk=event.booking_id)
        if booking.status not in {'PENDING', 'CONFIRMED', 'CONFIRMED_DP'} or booking.starts_at <= now:
            event.status = BookingEmail.STATUS_CANCELLED
            event.save(update_fields=['status', 'updated_at'])
            return event.status
        if event.event_key != f'booking:{booking.id}:reminder:{booking.starts_at.isoformat()}':
            event.status = BookingEmail.STATUS_CANCELLED
            event.save(update_fields=['status', 'updated_at'])
            return event.status
    event.attempt_count += 1
    event.last_error = ''
    event.save(update_fields=['attempt_count', 'last_error', 'updated_at'])
    subject, text_body, html_body = build_email_content(event)
    try:
        send_transactional_email(
            event.recipient,
            subject,
            text_body,
            html_message=html_body,
        )
    except EmailDeliveryError as exc:
        delays = (60, 300, 1800, 7200)
        event.last_error = str(exc)[:500]
        if event.attempt_count >= 5:
            event.status = BookingEmail.STATUS_FAILED
            event.next_retry_at = None
        else:
            event.next_retry_at = now + timedelta(seconds=delays[min(event.attempt_count - 1, len(delays) - 1)])
        event.save(update_fields=['status', 'next_retry_at', 'last_error', 'updated_at'])
        logger.error('Booking email failed: booking_id=%s event=%s attempt=%s error=%s', event.booking_id, event.event_type, event.attempt_count, exc)
        return event.status
    event.status = BookingEmail.STATUS_SENT
    event.sent_at = now
    event.next_retry_at = None
    event.save(update_fields=['status', 'sent_at', 'next_retry_at', 'updated_at'])
    return event.status


def process_due_booking_emails(limit=100, *, now=None):
    now = now or timezone.now()
    due = Q(next_retry_at__lte=now) | Q(next_retry_at__isnull=True, scheduled_for__lte=now)
    if not getattr(settings, 'EMAIL_DELIVERY_ENABLED', False):
        queued = BookingEmail.objects.filter(status=BookingEmail.STATUS_QUEUED).filter(due).count()
        return {'queued': queued, 'sent': 0, 'failed': 0, 'cancelled': 0}
    due_ids = list(BookingEmail.objects.filter(status=BookingEmail.STATUS_QUEUED).filter(due)
                   .order_by('next_retry_at', 'scheduled_for', 'id').values_list('id', flat=True)[:limit])
    counts = {'queued': 0, 'sent': 0, 'failed': 0, 'cancelled': 0}
    for email_id in due_ids:
        result = process_booking_email(email_id, now=now)
        counts[result if result in {'sent', 'failed', 'cancelled'} else 'queued'] += 1
    return counts
