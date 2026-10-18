import uuid

import requests
from django.conf import settings
from django.core.mail import send_mail


class EmailDeliveryError(Exception):
    pass


def send_transactional_email(recipient, subject, message, *, html_message=None):
    """Send an email through the configured SMTP or Resend provider.

    The return value is intentionally small and provider-neutral so the
    notification service can record delivery IDs without storing message
    contents or credentials.
    """
    if settings.EMAIL_PROVIDER == 'resend':
        if not settings.RESEND_API_KEY:
            raise EmailDeliveryError('RESEND_API_KEY is not configured.')
        try:
            response = requests.post(
                settings.RESEND_API_URL,
                headers={
                    'Authorization': f'Bearer {settings.RESEND_API_KEY}',
                    'Content-Type': 'application/json',
                    'User-Agent': 'cav-photostudio-and-cafe/1.0',
                    'Idempotency-Key': f'password-reset-{uuid.uuid4()}',
                },
                json={
                    'from': settings.DEFAULT_FROM_EMAIL,
                    'to': [recipient],
                    'subject': subject,
                    'text': message,
                    **({'html': html_message} if html_message else {}),
                },
                timeout=settings.EMAIL_TIMEOUT,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise EmailDeliveryError('Resend email delivery failed.') from exc
        try:
            data = response.json()
        except ValueError:
            data = {}
        return {
            'provider': 'resend',
            'provider_message_id': str(data.get('id') or ''),
        }

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
        raise EmailDeliveryError('Email delivery failed.') from exc
    if sent != 1:
        raise EmailDeliveryError('Email provider did not accept the message.')
    return {
        'provider': settings.EMAIL_PROVIDER or 'smtp',
        'provider_message_id': '',
    }


def send_password_reset_email(recipient, otp, purpose='password reset'):
    subject = f'Your CAV {purpose} code'
    message = (
        f'Your CAV {purpose} OTP is {otp}.\n\n'
        f'This code expires in {settings.PASSWORD_RESET_OTP_TTL_MINUTES} minutes. '
        'If you did not request this, you can ignore this email.'
    )
    send_transactional_email(recipient, subject, message)
