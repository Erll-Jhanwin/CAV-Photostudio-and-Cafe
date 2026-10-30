from django.conf import settings
from django.core.mail import send_mail


class EmailDeliveryError(Exception):
    """A safe, provider-neutral failure message for transactional email."""


def send_transactional_email(recipient, subject, message, *, html_message=None):
    """Send email through Django's configured built-in SMTP backend."""
    if not settings.EMAIL_HOST:
        raise EmailDeliveryError('SMTP email delivery is not configured.')
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
        # Do not include the SMTP exception text, which could contain sensitive
        # server or authentication details, in persisted delivery logs.
        raise EmailDeliveryError('SMTP email delivery failed.') from exc
    if sent != 1:
        raise EmailDeliveryError('SMTP server did not accept the message.')
    return {'provider': 'smtp', 'provider_message_id': ''}


def send_password_reset_email(recipient, otp, purpose='password reset'):
    subject = f'Your CAV {purpose} code'
    message = (
        f'Your CAV {purpose} OTP is {otp}.\n\n'
        f'This code expires in {settings.PASSWORD_RESET_OTP_TTL_MINUTES} minutes. '
        'If you did not request this, you can ignore this email.'
    )
    send_transactional_email(recipient, subject, message)
