import uuid

import requests
from django.conf import settings
from django.core.mail import send_mail


class EmailDeliveryError(Exception):
    pass


def send_password_reset_email(recipient, otp):
    subject = 'Your CAV password reset code'
    message = (
        f'Your CAV password reset OTP is {otp}.\n\n'
        f'This code expires in {settings.PASSWORD_RESET_OTP_TTL_MINUTES} minutes. '
        'If you did not request this, you can ignore this email.'
    )

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
                },
                timeout=settings.EMAIL_TIMEOUT,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise EmailDeliveryError('Resend email delivery failed.') from exc
        return

    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient],
        fail_silently=False,
    )
