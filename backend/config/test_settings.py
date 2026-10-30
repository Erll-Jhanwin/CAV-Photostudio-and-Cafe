"""Isolated tests: never inherit a production database or delivery credentials.

python manage.py test apps --settings=config.test_settings
For local PostgreSQL only: set TEST_DATABASE_URL before running the same command.
"""
import os
from urllib.parse import urlparse

test_database_url = os.environ.get('TEST_DATABASE_URL', 'sqlite:///:memory:')
if not test_database_url.startswith('sqlite:') and urlparse(test_database_url).hostname not in {'127.0.0.1', 'localhost'}:
    raise RuntimeError('TEST_DATABASE_URL must point to an isolated localhost database.')
os.environ['DATABASE_URL'] = test_database_url
os.environ['DATABASE_SSL_REQUIRE'] = 'false'
os.environ['DJANGO_SECRET_KEY'] = 'isolated-tests-only-not-for-deployment'
os.environ['DJANGO_DEBUG'] = 'false'

from .settings import *  # noqa: E402,F403

EMAIL_DELIVERY_ENABLED = SMS_DELIVERY_ENABLED = PUSH_DELIVERY_ENABLED = False
SMS_ASYNC_DELIVERY_ENABLED = False
IPROG_SMS_API_TOKEN = OPENROUTER_API_KEY = OCR_API_KEY = ''
REDIS_URL = ''
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'isolated-tests-only',
    },
}
SECURE_SSL_REDIRECT = False
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}
