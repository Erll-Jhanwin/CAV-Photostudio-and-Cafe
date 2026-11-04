import re


PHILIPPINE_MOBILE_PATTERN = re.compile(r'^639\d{9}$')
PHILIPPINE_LOCAL_MOBILE_PATTERN = re.compile(r'^09\d{9}$')


def validate_philippine_mobile_number(value):
    """Return a local 09xxxxxxxxx number, or None if input is not exactly 11 digits."""
    raw = str(value or '')
    return raw if PHILIPPINE_LOCAL_MOBILE_PATTERN.fullmatch(raw) else None


def normalize_philippine_mobile_number(value):
    """Return iProgSMS's 639xxxxxxxxx format, accepting legacy stored formats."""
    raw = str(value or '').strip()
    if not raw:
        return None

    compact = re.sub(r'[\s().-]', '', raw)
    if compact.startswith('+'):
        compact = compact[1:]
    if compact.startswith('09') and len(compact) == 11:
        compact = f'63{compact[1:]}'
    elif compact.startswith('9') and len(compact) == 10:
        compact = f'63{compact}'

    return compact if PHILIPPINE_MOBILE_PATTERN.fullmatch(compact) else None
