import re

from .models import AuditLog


SENSITIVE_KEY = re.compile(r'(password|passwd|otp|token|secret|authorization|cookie|credential|proof|file|image|base64)', re.I)
SENSITIVE_VALUE = re.compile(r'(Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)', re.I)


def sanitize_metadata(value):
    """Defensively remove credential shaped metadata from every audit writer."""
    if isinstance(value, dict):
        return {
            str(key)[:100]: sanitize_metadata(item)
            for key, item in value.items()
            if not SENSITIVE_KEY.search(str(key))
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_metadata(item) for item in value[:100]]
    if isinstance(value, str):
        return SENSITIVE_VALUE.sub('[redacted]', value)[:4000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:1000]


def safe_change_details(data):
    """Retain field names only; request values may contain personal or secret data."""
    if not isinstance(data, dict):
        return {}
    return {'changed_fields': sorted(str(key)[:80] for key in data if not SENSITIVE_KEY.search(str(key)))}


def module_for_path(path):
    parts = [part for part in path.strip('/').split('/') if part]
    if len(parts) > 1 and parts[0] == 'api':
        return parts[1].replace('-', '_')[:80]
    return 'system'


def module_for_action(action):
    prefix = str(action or '').upper().split('_', 1)[0]
    return {
        'USER': 'auth', 'AUTH': 'auth', 'BOOKING': 'bookings', 'POS': 'pos',
        'TRANSACTION': 'pos', 'PRODUCT': 'inventory', 'INVENTORY': 'inventory',
        'INGREDIENT': 'inventory', 'CATEGORY': 'inventory', 'SUPPLIER': 'inventory',
        'PO': 'inventory', 'STOCK': 'inventory', 'ADMIN': 'users', 'ACCOUNT': 'users',
        'STAFF': 'users', 'PRIVACY': 'privacy', 'FAQ': 'chatbot', 'CLIENT': 'system',
        'SYSTEM': 'system', 'NOTIFICATION': 'notifications', 'PAYMENT': 'payments',
        'GALLERY': 'gallery', 'REPORT': 'pos',
    }.get(prefix, prefix.lower()[:80])


def record_activity(*, user=None, action, description, module='', record_reference='', metadata=None, ip_address=None):
    user_id = getattr(user, 'pk', None)
    actor_name = ''
    actor_role = ''
    if user_id:
        actor_name = user.get_full_name().strip() or user.get_username()
        actor_role = getattr(user, 'role', '')
    safe_metadata = sanitize_metadata(metadata if isinstance(metadata, dict) else {})
    return AuditLog.objects.create(
        user=user if user_id else None,
        actor_user_id=user_id,
        actor_name=actor_name,
        actor_role=actor_role,
        action=action[:100],
        description=description[:2000],
        module=module[:80],
        record_reference=str(record_reference or '')[:160],
        metadata=safe_metadata,
        ip_address=ip_address,
    )
