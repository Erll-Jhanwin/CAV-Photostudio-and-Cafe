#!/bin/sh
set -eu

python manage.py migrate --noinput
python manage.py migrate --check

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --worker-class gthread \
  --workers "${WEB_CONCURRENCY:-2}" \
  --threads "${WEB_THREADS:-4}" \
  --timeout "${GUNICORN_TIMEOUT_SECONDS:-60}" \
  --graceful-timeout 30 \
  --keep-alive 5 \
  --backlog 128 \
  --max-requests 1000 \
  --max-requests-jitter 100 \
  --access-logfile - \
  --error-logfile -
