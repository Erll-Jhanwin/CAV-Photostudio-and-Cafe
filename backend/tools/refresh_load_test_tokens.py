"""Issue fresh short-lived tokens for synthetic accounts in an isolated DB."""

import json
import os
import sys
from pathlib import Path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.test_settings')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import django

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken


database = str(settings.DATABASES['default']['NAME']).lower()
if settings.DATABASES['default']['ENGINE'] != 'django.db.backends.sqlite3' or 'perf_load' not in database:
    raise SystemExit('Refusing to refresh tokens outside an isolated perf_load SQLite database.')

count = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'tmp/load-test-users.json')
User = get_user_model()
users = list(User.objects.filter(username__startswith='perfload').order_by('id')[:count])
if len(users) != count:
    raise SystemExit(f'Expected {count} synthetic perfload users; found {len(users)}.')

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps([
    {'token': str(AccessToken.for_user(user)), 'role': user.role}
    for user in users
]), encoding='utf-8')
print(f'Renewed {len(users)} synthetic bearer tokens in {output}.')
