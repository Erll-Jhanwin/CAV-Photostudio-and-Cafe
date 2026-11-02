import logging
import smtplib

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """A safe, provider-neutral failure message for transactional email."""


def send_transactional_email(recipient, subject, message, *, html_message=None):
    """Send email through Django's configured built-in SMTP backend."""
    if not settings.EMAIL_HOST:
        logger.error('SMTP delivery skipped: EMAIL_HOST is not configured.')
        raise EmailDeliveryError('SMTP email delivery is not configured.')
    if not settings.DEFAULT_FROM_EMAIL:
        logger.error('SMTP delivery skipped: DEFAULT_FROM_EMAIL is not configured.')
        raise EmailDeliveryError('SMTP sender is not configured.')
    logger.info(
        'SMTP delivery starting: host=%s port=%s tls=%s ssl=%s auth_configured=%s',
        settings.EMAIL_HOST,
        settings.EMAIL_PORT,
        bool(settings.EMAIL_USE_TLS),
        bool(settings.EMAIL_USE_SSL),
        bool(settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD),
    )
    try:
        sent = send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            html_message=html_message,
            fail_silently=False,
        )
    except Exception as exc:
        # Error strings can contain SMTP replies or credentials. Log only safe,
        # structured diagnostics and keep the public/persisted error generic.
        response_code = getattr(exc, 'smtp_code', None)
        if response_code is None and isinstance(exc, smtplib.SMTPRecipientsRefused):
            response_code = next(
                (reply[0] for reply in exc.recipients.values() if reply), None
            )
        logger.error(
            'SMTP delivery failed: host=%s port=%s tls=%s ssl=%s auth_configured=%s '
            'exception_type=%s smtp_code=%s',
            settings.EMAIL_HOST,
            settings.EMAIL_PORT,
            bool(settings.EMAIL_USE_TLS),
            bool(settings.EMAIL_USE_SSL),
            bool(settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD),
            type(exc).__name__,
            response_code,
        )
        # Suppress exception chaining too: Django's default error reporting can
        # otherwise print the underlying SMTP reply despite our safe log line.
        raise EmailDeliveryError('SMTP email delivery failed.') from None
    if sent != 1:
        logger.error('SMTP delivery not accepted: send_mail returned sent=%s.', sent)
        raise EmailDeliveryError('SMTP server did not accept the message.')
    logger.info('SMTP delivery accepted: host=%s port=%s.', settings.EMAIL_HOST, settings.EMAIL_PORT)
    return {'provider': 'smtp', 'provider_message_id': ''}


def send_password_reset_email(recipient, otp, purpose='password reset'):
    subject = f'Your CAV {purpose} code'
    message = (
        f'Your CAV {purpose} OTP is {otp}.\n\n'
        f'This code expires in {settings.PASSWORD_RESET_OTP_TTL_MINUTES} minutes. '
        'If you did not request this, you can ignore this email.'
    )
    send_transactional_email(recipient, subject, message)
