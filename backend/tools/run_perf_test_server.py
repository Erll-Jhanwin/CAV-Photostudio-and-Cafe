"""Serve an isolated perf_load SQLite DB with a large accept backlog for local tests."""

import os
import sys
from pathlib import Path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.test_settings')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import django

django.setup()

from django.conf import settings
from django.core.servers.basehttp import WSGIServer, run
from django.core.wsgi import get_wsgi_application


database = str(settings.DATABASES['default']['NAME']).lower()
if settings.DATABASES['default']['ENGINE'] != 'django.db.backends.sqlite3' or 'perf_load' not in database:
    raise SystemExit('Refusing to start unless config.test_settings uses an isolated perf_load SQLite database.')


class PerfTestWSGIServer(WSGIServer):
    request_queue_size = 2048
    daemon_threads = True


run(
    addr=os.environ.get('LOAD_TEST_BIND', '127.0.0.1'),
    port=int(os.environ.get('LOAD_TEST_PORT', '8107')),
    wsgi_handler=get_wsgi_application(),
    threading=True,
    server_cls=PerfTestWSGIServer,
)
