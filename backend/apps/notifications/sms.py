"""Durable SMS claims, bounded retries, and provider delivery reconciliation."""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from users.phone_numbers import normalize_philippine_mobile_number
from users.sms_delivery import IProgSMSDeliveryError, get_sms_delivery_status, send_transactional_sms
from .models import Notification, NotificationDelivery as Delivery

logger = logging.getLogger(__name__)


def _finish(delivery, status, *, code='', message='', retryable=False, metadata=None):
    delivery.status = status
    delivery.error_code = code
    delivery.error_message = message
    delivery.next_retry_at = None
    if metadata is not None:
        delivery.metadata = metadata
    if retryable and delivery.attempt_count < getattr(settings, 'SMS_MAX_ATTEMPTS', 3):
        delay = getattr(settings, 'SMS_RETRY_DELAY_SECONDS', 60) * (2 ** max(delivery.attempt_count - 1, 0))
        delivery.next_retry_at = timezone.now() + timedelta(seconds=delay)
    delivery.save()
    logger.log(
        logging.WARNING if code else logging.INFO,
        'SMS result delivery_id=%s notification_id=%s status=%s code=%s attempt=%s recipient_suffix=%s',
        delivery.id, delivery.notification_id, status, code, delivery.attempt_count,
        delivery.metadata.get('recipient_suffix', ''),
    )
    return delivery


def _obsolete_reminder(notification):
    if not notification.notification_type.startswith('BOOKING_REMINDER_'):
        return False
    from booking.availability import ACTIVE_BOOKING_STATUSES
    from .reminders import reminder_event_key
    booking = notification.booking
    return (
        not booking or booking.status not in ACTIVE_BOOKING_STATUSES
        or booking.starts_at <= timezone.now()
        or notification.event_key != reminder_event_key(booking, notification.notification_type)
    )


def send_sms_notification(notification, *, retry=False):
    # Lock only the notification table. Joining nullable booking relations in a
    # FOR UPDATE query is illegal on PostgreSQL (SQLSTATE 0A000).
    with transaction.atomic():
        notification = Notification.objects.select_for_update().get(pk=notification.pk)
        delivery = Delivery.objects.filter(notification=notification, channel='sms').order_by('id').first()
        if delivery:
            if not (
                retry and delivery.status == Delivery.STATUS_FAILED
                and delivery.next_retry_at and delivery.next_retry_at <= timezone.now()
                and delivery.attempt_count < getattr(settings, 'SMS_MAX_ATTEMPTS', 3)
            ):
                return delivery
        else:
            delivery = Delivery.objects.create(
                notification=notification, user_id=notification.user_id,
                channel='sms', provider='iprogsms', attempt_count=0,
            )
        customer = notification.booking.customer if notification.booking_id else notification.user
        phone = normalize_philippine_mobile_number(customer.phone_number)
        if not getattr(settings, 'SMS_DELIVERY_ENABLED', False):
            return _finish(delivery, Delivery.STATUS_SKIPPED, code='disabled', message='SMS delivery is disabled by configuration.')
        if not getattr(settings, 'IPROG_SMS_API_TOKEN', '').strip():
            return _finish(delivery, Delivery.STATUS_SKIPPED, code='missing_credentials', message='IPROG_SMS_API_TOKEN is not configured.')
        if not phone:
            return _finish(delivery, Delivery.STATUS_SKIPPED, code='invalid_recipient', message='A valid registered Philippine mobile number is required.')
        if _obsolete_reminder(notification):
            return _finish(delivery, Delivery.STATUS_SKIPPED, code='obsolete_reminder', message='The session was cancelled, rescheduled, or has already started.')
        delivery.metadata = {'recipient_suffix': phone[-4:]}
        delivery.attempt_count += 1
        delivery.provider_message_id = ''
        _finish(delivery, Delivery.STATUS_SENDING)

    # The claim is committed before making the external request. A process
    # crash leaves a durable SENDING row, never an automatically repeatable send.
    try:
        result = send_transactional_sms(phone, notification.message)
    except IProgSMSDeliveryError as exc:
        metadata = dict(delivery.metadata)
        if exc.status_code:
            metadata['provider_status_code'] = exc.status_code
        return _finish(
            delivery, Delivery.STATUS_UNKNOWN if exc.uncertain else Delivery.STATUS_FAILED,
            code=exc.code, message=str(exc), retryable=exc.retryable and not exc.uncertain,
            metadata=metadata,
        )
    except Exception as exc:
        # Exception text can contain HTTP credentials. Log its class and IDs only.
        logger.error('Unexpected SMS client failure delivery_id=%s exception_type=%s', delivery.id, type(exc).__name__)
        return _finish(delivery, Delivery.STATUS_UNKNOWN, code='unexpected_error', message='SMS submission outcome is unknown; operator reconciliation is required.')
    delivery.provider_message_id = result['provider_message_id']
    delivery.sent_at = timezone.now()  # submission time, NOT confirmed delivery
    delivery.metadata['provider_status'] = 'accepted'
    return _finish(delivery, Delivery.STATUS_ACCEPTED)


def reconcile_sms_delivery(delivery_id):
    delivery = Delivery.objects.get(pk=delivery_id, channel='sms')
    if delivery.status not in {Delivery.STATUS_ACCEPTED, Delivery.STATUS_SENT} or not delivery.provider_message_id:
        return delivery
    message_id = delivery.provider_message_id
    try:
        provider_status = get_sms_delivery_status(message_id)
    except IProgSMSDeliveryError as exc:
        logger.warning('SMS status check failed delivery_id=%s code=%s http_status=%s', delivery_id, exc.code, exc.status_code)
        Delivery.objects.filter(pk=delivery_id).update(last_checked_at=timezone.now())
        return delivery
    with transaction.atomic():
        delivery = Delivery.objects.select_for_update().get(pk=delivery_id)
        if delivery.provider_message_id != message_id or delivery.status not in {Delivery.STATUS_ACCEPTED, Delivery.STATUS_SENT}:
            return delivery
        delivery.last_checked_at = timezone.now()
        delivery.metadata = {**delivery.metadata, 'provider_status': provider_status}
        if provider_status == 'delivered':
            delivery.delivered_at = timezone.now()
            return _finish(delivery, Delivery.STATUS_DELIVERED)
        if provider_status in {'failed', 'undelivered', 'rejected', 'expired'}:
            return _finish(delivery, Delivery.STATUS_FAILED, code='delivery_failed',
                           message=f'iProgSMS reports {provider_status}.',
                           retryable=provider_status in {'failed', 'undelivered'})
        # "sent"/"completed" means provider processing completed. Only an
        # explicit delivery report is represented as DELIVERED.
        return _finish(delivery, Delivery.STATUS_SENT if provider_status in {'sent', 'completed'} else Delivery.STATUS_ACCEPTED)


def process_sms_deliveries(limit=100):
    """Run from a scheduler; never blindly retry an ambiguous submission."""
    now = timezone.now()
    stale = now - timedelta(seconds=max(getattr(settings, 'IPROG_SMS_API_TIMEOUT', 15) * 3, 120))
    Delivery.objects.filter(channel='sms', status=Delivery.STATUS_SENDING, updated_at__lt=stale).update(
        status=Delivery.STATUS_UNKNOWN, error_code='interrupted_submission',
        error_message='Worker stopped during submission; reconcile with iProgSMS before resending.',
        next_retry_at=None,
    )
    if not getattr(settings, 'SMS_DELIVERY_ENABLED', False):
        return
    # Only recover events created by the durable event pipeline. Legacy rows
    # without event keys may be months old; deployment must not broadcast them.
    pending = Notification.objects.filter(event_key__isnull=False).exclude(deliveries__channel='sms').order_by('id')[:limit]
    for notification in pending:
        send_sms_notification(notification)
    for delivery in Delivery.objects.filter(channel='sms', status=Delivery.STATUS_FAILED, next_retry_at__lte=now).select_related('notification').order_by('id')[:limit]:
        if delivery.notification:
            send_sms_notification(delivery.notification, retry=True)
    due = Delivery.objects.filter(channel='sms', status__in=[Delivery.STATUS_ACCEPTED, Delivery.STATUS_SENT]).exclude(provider_message_id='')
    from django.db.models import Q
    due = due.filter(Q(last_checked_at__isnull=True) | Q(last_checked_at__lte=now - timedelta(minutes=5)))
    for delivery in due.order_by('id')[:limit]:
        reconcile_sms_delivery(delivery.id)
