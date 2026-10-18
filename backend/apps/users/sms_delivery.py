import requests
from django.conf import settings

from users.phone_numbers import normalize_philippine_mobile_number


class IProgSMSDeliveryError(Exception):
    def __init__(self, message, *, code='provider_error', status_code=None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _post_i_progsms(path, payload):
    api_token = str(getattr(settings, 'IPROG_SMS_API_TOKEN', '') or '').strip()
    if not api_token:
        raise IProgSMSDeliveryError('IPROG_SMS_API_TOKEN is not configured.', code='missing_credentials')

    base_url = getattr(settings, 'IPROG_SMS_API_BASE_URL', 'https://www.iprogsms.com').rstrip('/')
    try:
        response = requests.post(
            f'{base_url}{path}',
            json={**payload, 'api_token': api_token},
            timeout=getattr(settings, 'IPROG_SMS_API_TIMEOUT', 15),
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'cav-photostudio-and-cafe/1.0',
            },
        )
    except requests.RequestException as exc:
        raise IProgSMSDeliveryError(
            'iProgSMS request failed.',
            code='request_error',
        ) from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise IProgSMSDeliveryError(
            f'iProgSMS returned an invalid response (HTTP {response.status_code}).',
            code='invalid_response',
            status_code=response.status_code,
        ) from exc
    if not isinstance(data, dict):
        raise IProgSMSDeliveryError(
            f'iProgSMS returned an invalid response (HTTP {response.status_code}).',
            code='invalid_response',
            status_code=response.status_code,
        )

    if response.status_code >= 500:
        raise IProgSMSDeliveryError(
            f'iProgSMS is temporarily unavailable (HTTP {response.status_code}).',
            code='provider_unavailable',
            status_code=response.status_code,
        )
    if response.status_code >= 400:
        provider_message = str(data.get('message') or '').strip()
        detail = f': {provider_message[:180]}' if provider_message else ''
        raise IProgSMSDeliveryError(
            f'iProgSMS rejected the request (HTTP {response.status_code}){detail}',
            code='provider_rejected',
            status_code=response.status_code,
        )
    return data


def send_transactional_sms(phone_number, message):
    """Send a non-OTP SMS through the iProgSMS transactional endpoint."""
    normalized = normalize_philippine_mobile_number(phone_number)
    if not normalized:
        raise IProgSMSDeliveryError('Enter a valid Philippine mobile number.')
    if not str(message or '').strip():
        raise IProgSMSDeliveryError('SMS message cannot be empty.')

    data = _post_i_progsms(
        '/api/v1/sms_messages',
        {
            'phone_number': normalized,
            'message': str(message).strip(),
        },
    )
    provider_status = str(data.get('status', '')).lower()
    if data.get('message_id') and provider_status in {'200', 'success', 'queued'}:
        return {
            'provider': 'iprogsms',
            'provider_message_id': str(data.get('message_id') or ''),
        }
    provider_message = str(data.get('message') or '').strip()
    detail = f': {provider_message[:180]}' if provider_message else ''
    raise IProgSMSDeliveryError(
        f'iProgSMS rejected the SMS request{detail}',
        code='provider_rejected',
    )


def send_password_reset_otp(phone_number, purpose='password reset'):
    data = _post_i_progsms(
        '/api/v1/otp/send_otp',
        {
            'phone_number': phone_number,
            'message': f"Your CAV {purpose} code is :otp. It expires in {getattr(settings, 'PASSWORD_RESET_OTP_TTL_MINUTES', 10)} minutes. Do not share this code.",
            'code_length': 6,
        },
    )
    if str(data.get('status', '')).lower() != 'success':
        raise IProgSMSDeliveryError('iProgSMS rejected the OTP request.')
    return data


def verify_password_reset_otp(phone_number, otp):
    data = _post_i_progsms(
        '/api/v1/otp/verify_otp',
        {'phone_number': phone_number, 'otp': otp},
    )
    return str(data.get('status', '')).lower() == 'success'
