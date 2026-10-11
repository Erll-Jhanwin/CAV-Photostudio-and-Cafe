import requests
from django.conf import settings


class IProgSMSDeliveryError(Exception):
    pass


def _post_i_progsms(path, payload):
    api_token = getattr(settings, 'IPROG_SMS_API_TOKEN', '')
    if not api_token:
        raise IProgSMSDeliveryError('IPROG_SMS_API_TOKEN is not configured.')

    base_url = getattr(settings, 'IPROG_SMS_API_BASE_URL', 'https://www.iprogsms.com').rstrip('/')
    try:
        response = requests.post(
            f'{base_url}{path}',
            json={**payload, 'api_token': api_token},
            timeout=getattr(settings, 'IPROG_SMS_API_TIMEOUT', 15),
            headers={'Accept': 'application/json', 'User-Agent': 'cav-photostudio-and-cafe/1.0'},
        )
    except requests.RequestException as exc:
        raise IProgSMSDeliveryError('iProgSMS request failed.') from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise IProgSMSDeliveryError('iProgSMS returned an invalid response.') from exc

    if response.status_code >= 500:
        raise IProgSMSDeliveryError('iProgSMS is temporarily unavailable.')
    return data


def send_password_reset_otp(phone_number):
    data = _post_i_progsms(
        '/api/v1/otp/send_otp',
        {
            'phone_number': phone_number,
            'message': f"Your CAV password reset code is :otp. It expires in {getattr(settings, 'PASSWORD_RESET_OTP_TTL_MINUTES', 10)} minutes. Do not share this code.",
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
