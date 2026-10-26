import requests
from django.conf import settings

from users.phone_numbers import normalize_philippine_mobile_number


class IProgSMSDeliveryError(Exception):
    def __init__(self, message, *, code='provider_error', status_code=None, retryable=False, uncertain=False):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retryable = retryable
        self.uncertain = uncertain


def _post_i_progsms(path, payload):
    api_token = str(getattr(settings, 'IPROG_SMS_API_TOKEN', '') or '').strip()
    if not api_token:
        raise IProgSMSDeliveryError('IPROG_SMS_API_TOKEN is not configured.', code='missing_credentials')

    base_url = getattr(settings, 'IPROG_SMS_API_BASE_URL', 'https://www.iprogsms.com').rstrip('/')
    try:
        response = requests.post(  # nosec B113
            f'{base_url}{path}',
            json={**payload, 'api_token': api_token},
            timeout=getattr(settings, 'IPROG_SMS_API_TIMEOUT', 15),
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'cav-photostudio-and-cafe/1.0',
            },
        )
    except requests.ConnectTimeout as exc:
        raise IProgSMSDeliveryError('Could not connect to iProgSMS.', code='connect_timeout', retryable=True) from exc
    except requests.RequestException as exc:
        raise IProgSMSDeliveryError(
            'iProgSMS request failed.',
            code='request_error',
            uncertain=True,
        ) from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise IProgSMSDeliveryError(
            f'iProgSMS returned an invalid response (HTTP {response.status_code}).',
            code='invalid_response',
            status_code=response.status_code,
            uncertain=True,
        ) from exc
    if not isinstance(data, dict):
        raise IProgSMSDeliveryError(
            f'iProgSMS returned an invalid response (HTTP {response.status_code}).',
            code='invalid_response',
            status_code=response.status_code,
            uncertain=True,
        )

    if response.status_code >= 500:
        raise IProgSMSDeliveryError(
            f'iProgSMS is temporarily unavailable (HTTP {response.status_code}).',
            code='provider_unavailable',
            status_code=response.status_code,
            uncertain=True,
        )
    if response.status_code >= 400:
        raise IProgSMSDeliveryError(
            f'iProgSMS rejected the request (HTTP {response.status_code}).',
            code='rate_limited' if response.status_code == 429 else 'provider_rejected',
            status_code=response.status_code,
            retryable=response.status_code == 429,
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
    provider_status = str(data.get('status', '')).lower().strip()
    if data.get('message_id') and provider_status in {'200', 'success', 'queued'}:
        return {
            'provider': 'iprogsms',
            'provider_message_id': str(data.get('message_id') or ''),
            'provider_status': 'accepted',
        }
    # Never persist arbitrary provider text: it may echo credentials, recipient,
    # or SMS contents. Keep actionable, allowlisted classifications instead.
    provider_message = str(data.get('message') or '').lower()
    code = 'provider_rejected'
    if 'sender name' in provider_message and ('approved' in provider_message or 'shared' in provider_message):
        code = 'sender_name_required'
    elif 'token' in provider_message:
        code = 'invalid_credentials'
    elif 'credit' in provider_message or 'balance' in provider_message:
        code = 'insufficient_credits'
    elif 'phone' in provider_message or 'number' in provider_message:
        code = 'invalid_recipient'
    elif 'content' in provider_message or 'phishing' in provider_message:
        code = 'content_rejected'
    rejection_confirmed = provider_status in {'error', 'failed', '400', '401', '403', '422', '500'}
    error_message = (
        'iProgSMS requires an approved sender name for the recipient network. Configure it in the provider account.'
        if code == 'sender_name_required'
        else f'iProgSMS did not confirm message acceptance ({code}).'
    )
    raise IProgSMSDeliveryError(
        error_message,
        code=code,
        uncertain=not rejection_confirmed or bool(data.get('message_id')),
    )


def get_sms_delivery_status(message_id):
    """Read delivery state separately from submission acceptance."""
    token = str(getattr(settings, 'IPROG_SMS_API_TOKEN', '') or '').strip()
    if not token:
        raise IProgSMSDeliveryError('IPROG_SMS_API_TOKEN is not configured.', code='missing_credentials')
    base_url = settings.IPROG_SMS_API_BASE_URL.rstrip('/')
    try:
        response = requests.get(
            f'{base_url}/api/v1/sms_messages/status',
            params={'api_token': token, 'message_id': message_id},
            timeout=settings.IPROG_SMS_API_TIMEOUT,
            headers={'Accept': 'application/json'},
        )
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise IProgSMSDeliveryError('Could not check iProgSMS delivery status.', code='status_check_failed') from exc
    if not isinstance(data, dict) or response.status_code != 200 or str(data.get('status')).lower() not in {'200', 'success'}:
        raise IProgSMSDeliveryError('iProgSMS rejected the delivery status check.', code='status_check_failed', status_code=response.status_code)
    delivery_status = str(data.get('message_status') or '').lower().strip()
    if delivery_status not in {'pending', 'queued', 'processing', 'sent', 'completed', 'delivered', 'failed', 'undelivered', 'rejected', 'expired'}:
        raise IProgSMSDeliveryError('iProgSMS returned an unknown delivery status.', code='unknown_delivery_status')
    return delivery_status


def send_password_reset_otp(phone_number, purpose='password reset'):
    data = _post_i_progsms(
        '/api/v1/otp/send_otp',
        {
            'phone_number': phone_number,
            'message': f"Your CAV {purpose} code is :otp. It expires in {getattr(settings, 'PASSWORD_RESET_OTP_TTL_MINUTES', 10)} minutes. Do not share this code.",
            'expires_in_minutes': getattr(settings, 'PASSWORD_RESET_OTP_TTL_MINUTES', 10),
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
