import json
import logging
from urllib.parse import urlparse

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from users.email_delivery import EmailDeliveryError, send_transactional_email

from .models import Notification, NotificationDelivery, PushSubscription
from .sms import send_sms_notification as _send_sms_notification

logger = logging.getLogger(__name__)


class PushDeliveryError(Exception):
    """A provider/configuration failure while sending Web Push."""

    def __init__(self, message, *, code='provider_error', status_code=None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _enabled(setting_name):
    return bool(getattr(settings, setting_name, False))


def _safe_email_metadata(email):
    return {'recipient_domain': email.rsplit('@', 1)[-1].lower()}


def _safe_phone_metadata(phone_number):
    return {'recipient_suffix': phone_number[-4:]}


def _safe_endpoint_metadata(endpoint):
    parsed = urlparse(endpoint)
    return {'endpoint_host': parsed.netloc[:255]}


def _set_delivery(delivery, *, status, provider='', provider_message_id='', error_code='', error_message='', metadata=None):
    delivery.status = status
    delivery.provider = provider or delivery.provider
    delivery.provider_message_id = provider_message_id or ''
    delivery.error_code = error_code or ''
    delivery.error_message = error_message or ''
    if metadata is not None:
        delivery.metadata = metadata
    if status == NotificationDelivery.STATUS_SENT:
        delivery.sent_at = timezone.now()
    delivery.save(update_fields=[
        'status', 'provider', 'provider_message_id', 'error_code',
        'error_message', 'metadata', 'sent_at', 'updated_at',
    ])
    return delivery


def _new_delivery(notification, channel, *, provider=''):
    return NotificationDelivery.objects.create(
        notification=notification,
        user=notification.user,
        channel=channel,
        provider=provider,
        status=NotificationDelivery.STATUS_QUEUED,
    )


def _skip(delivery, *, provider, code, message, metadata=None):
    return _set_delivery(
        delivery,
        status=NotificationDelivery.STATUS_SKIPPED,
        provider=provider,
        error_code=code,
        error_message=message,
        metadata=metadata or {},
    )


def _fail(delivery, *, provider, code, message, metadata=None):
    logger.warning(
        'Notification delivery failed: notification_id=%s channel=%s provider=%s code=%s message=%s metadata=%s',
        delivery.notification_id,
        delivery.channel,
        provider,
        code,
        message,
        metadata or {},
    )
    return _set_delivery(
        delivery,
        status=NotificationDelivery.STATUS_FAILED,
        provider=provider,
        error_code=code,
        error_message=message,
        metadata=metadata or {},
    )


def _send_email_notification(notification):
    provider = getattr(settings, 'EMAIL_PROVIDER', 'smtp') or 'smtp'
    delivery = _new_delivery(notification, NotificationDelivery.CHANNEL_EMAIL, provider=provider)
    user_email = (notification.user.email or '').strip()

    if not _enabled('EMAIL_DELIVERY_ENABLED'):
        return _skip(
            delivery,
            provider=provider,
            code='disabled',
            message='Email delivery is disabled by configuration.',
        )
    if provider == 'resend' and not getattr(settings, 'RESEND_API_KEY', '').strip():
        return _skip(
            delivery,
            provider=provider,
            code='missing_credentials',
            message='RESEND_API_KEY is not configured.',
        )
    if provider not in {'smtp', 'resend', 'console'}:
        return _fail(
            delivery,
            provider=provider,
            code='unsupported_provider',
            message=f'Unsupported email provider: {provider}.',
        )
    if not user_email:
        return _skip(
            delivery,
            provider=provider,
            code='missing_recipient',
            message='The user does not have an email address.',
        )
    try:
        validate_email(user_email)
    except DjangoValidationError:
        return _skip(
            delivery,
            provider=provider,
            code='invalid_recipient',
            message='The user email address is invalid.',
            metadata=_safe_email_metadata(user_email) if '@' in user_email else {},
        )
    if provider == 'smtp' and str(getattr(settings, 'EMAIL_BACKEND', '')).endswith('console.EmailBackend'):
        return _skip(
            delivery,
            provider=provider,
            code='console_backend',
            message='SMTP delivery is configured with Django console backend.',
            metadata=_safe_email_metadata(user_email),
        )

    try:
        result = send_transactional_email(
            user_email,
            notification.title,
            notification.message,
        )
    except EmailDeliveryError as exc:
        return _fail(
            delivery,
            provider=provider,
            code='provider_error',
            message=str(exc),
            metadata=_safe_email_metadata(user_email),
        )
    return _set_delivery(
        delivery,
        status=NotificationDelivery.STATUS_SENT,
        provider=result.get('provider', provider),
        provider_message_id=result.get('provider_message_id', ''),
        metadata=_safe_email_metadata(user_email),
    )


def _webpush(subscription):
    if not getattr(settings, 'PUSH_VAPID_PRIVATE_KEY', '').strip():
        raise PushDeliveryError('PUSH_VAPID_PRIVATE_KEY is not configured.', code='missing_credentials')
    if not getattr(settings, 'PUSH_VAPID_SUBJECT', '').strip():
        raise PushDeliveryError('PUSH_VAPID_SUBJECT is not configured.', code='missing_configuration')
    try:
        from pywebpush import WebPushException, webpush
    except ImportError as exc:
        raise PushDeliveryError('pywebpush is not installed.', code='dependency_missing') from exc

    payload = json.dumps({
        'title': subscription['_title'],
        'body': subscription['_message'],
        'notification_id': subscription['_notification_id'],
        'url': '/customer?tab=notifications',
    })
    subscription_info = {
        'endpoint': subscription['endpoint'],
        'keys': {
            'p256dh': subscription['p256dh'],
            'auth': subscription['auth'],
        },
    }
    try:
        response = webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=settings.PUSH_VAPID_PRIVATE_KEY,
            vapid_claims={'sub': settings.PUSH_VAPID_SUBJECT},
            ttl=getattr(settings, 'PUSH_DELIVERY_TTL_SECONDS', 86400),
        )
    except WebPushException as exc:
        response = getattr(exc, 'response', None)
        status_code = getattr(response, 'status_code', None)
        if status_code in {404, 410}:
            raise PushDeliveryError('Push subscription is no longer valid.', code='subscription_expired', status_code=status_code) from exc
        raise PushDeliveryError('Web Push provider rejected the notification.', code='provider_error', status_code=status_code) from exc
    except Exception as exc:
        raise PushDeliveryError('Web Push delivery failed.', code='provider_error') from exc

    provider_message_id = ''
    headers = getattr(response, 'headers', {}) or {}
    provider_message_id = str(headers.get('location') or headers.get('x-request-id') or '')
    return {'provider': 'webpush', 'provider_message_id': provider_message_id}


def _send_push_notification(notification):
    provider = 'webpush'
    subscriptions = list(PushSubscription.objects.filter(user=notification.user, is_active=True))
    if not _enabled('PUSH_DELIVERY_ENABLED'):
        delivery = _new_delivery(notification, NotificationDelivery.CHANNEL_PUSH, provider=provider)
        return [_skip(
            delivery,
            provider=provider,
            code='disabled',
            message='Push delivery is disabled by configuration.',
        )]
    if (
        not getattr(settings, 'PUSH_VAPID_PUBLIC_KEY', '').strip()
        or not getattr(settings, 'PUSH_VAPID_PRIVATE_KEY', '').strip()
        or not getattr(settings, 'PUSH_VAPID_SUBJECT', '').strip()
    ):
        delivery = _new_delivery(notification, NotificationDelivery.CHANNEL_PUSH, provider=provider)
        return [_skip(
            delivery,
            provider=provider,
            code='missing_credentials',
            message='PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, and PUSH_VAPID_SUBJECT are required.',
        )]
    if not subscriptions:
        delivery = _new_delivery(notification, NotificationDelivery.CHANNEL_PUSH, provider=provider)
        return [_skip(
            delivery,
            provider=provider,
            code='no_subscription',
            message='The user has no active push subscription.',
        )]

    deliveries = []
    for push_subscription in subscriptions:
        delivery = _new_delivery(notification, NotificationDelivery.CHANNEL_PUSH, provider=provider)
        metadata = _safe_endpoint_metadata(push_subscription.endpoint)
        try:
            result = _webpush({
                'endpoint': push_subscription.endpoint,
                'p256dh': push_subscription.p256dh,
                'auth': push_subscription.auth,
                '_title': notification.title,
                '_message': notification.message,
                '_notification_id': notification.id,
            })
        except PushDeliveryError as exc:
            if exc.code == 'subscription_expired':
                push_subscription.is_active = False
                push_subscription.save(update_fields=['is_active', 'updated_at'])
            if exc.status_code:
                metadata['provider_status_code'] = exc.status_code
            deliveries.append(_fail(
                delivery,
                provider=provider,
                code=exc.code,
                message=str(exc),
                metadata=metadata,
            ))
        else:
            deliveries.append(_set_delivery(
                delivery,
                status=NotificationDelivery.STATUS_SENT,
                provider=result.get('provider', provider),
                provider_message_id=result.get('provider_message_id', ''),
                metadata=metadata,
            ))
    return deliveries


def dispatch_notification(notification):
    """Attempt every configured channel and persist one status per attempt."""
    if isinstance(notification, (int, str)):
        notification = Notification.objects.select_related(
            'user', 'booking', 'booking__customer',
        ).get(pk=notification)

    deliveries = []
    # An email/push error must not prevent SMS from being attempted.
    for channel, sender in [('sms', _send_sms_notification), ('email', _send_email_notification), ('push', _send_push_notification)]:
        try:
            result = sender(notification)
            deliveries.extend(result if isinstance(result, list) else [result])
        except Exception as exc:
            logger.error('Notification dispatch failed notification_id=%s channel=%s exception_type=%s', notification.id, channel, type(exc).__name__)
    return deliveries


def create_booking_notification(*, booking, notification_type, title, message, event_key=None):
    """Persist a notification and dispatch it after its transaction commits."""
    values = dict(user_id=booking.customer_id, booking_id=booking.id,
                  notification_type=notification_type, title=title, message=message)
    if event_key:
        notification, created = Notification.objects.get_or_create(event_key=event_key, defaults=values)
        if not created:
            return notification
    else:
        notification = Notification.objects.create(**values)

    def deliver_after_commit():
        try:
            dispatch_notification(notification.id)
        except Exception as exc:
            logger.error('Post-commit notification dispatch failed notification_id=%s exception_type=%s', notification.id, type(exc).__name__)

    # Django logs callback.__qualname__ when robust callbacks fail; partial()
    # lacks that attribute and used to turn the error handler into another 500.
    transaction.on_commit(deliver_after_commit, robust=True)
    return notification
