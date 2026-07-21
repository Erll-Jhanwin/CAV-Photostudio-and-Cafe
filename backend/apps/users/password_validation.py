import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


COMMON_WEAK_PASSWORDS = {
    '12345678',
    '123456789',
    '1234567890',
    'admin123',
    'admin123!',
    'cav12345',
    'letmein',
    'password',
    'password1',
    'password12',
    'password123',
    'password123!',
    'qwerty',
    'qwerty123',
    'welcome',
    'welcome123',
}


class StrongPasswordValidator:
    def validate(self, password, user=None):
        password = password or ''
        normalized = password.strip().lower()
        errors = []

        if len(password) < 8:
            errors.append(_('Password must contain at least 8 characters.'))
        if not re.search(r'[A-Z]', password):
            errors.append(_('Password must include at least one uppercase letter.'))
        if not re.search(r'[a-z]', password):
            errors.append(_('Password must include at least one lowercase letter.'))
        if not re.search(r'\d', password):
            errors.append(_('Password must include at least one number.'))
        if not re.search(r'[^A-Za-z0-9\s]', password):
            errors.append(_('Password must include at least one special character.'))
        if normalized in COMMON_WEAK_PASSWORDS:
            errors.append(_('Password is too common or weak.'))

        if errors:
            raise ValidationError(errors)

    def get_help_text(self):
        return _(
            'Your password must be at least 8 characters and include uppercase, '
            'lowercase, a number, a special character, and must not be common.'
        )
