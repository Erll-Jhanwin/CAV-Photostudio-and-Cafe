# Backend scalability and load testing

## Application capacity

The backend is a synchronous Django application served by Gunicorn `gthread`.
Each instance accepts `WEB_CONCURRENCY * WEB_THREADS` active requests; the
current defaults are 2 workers and 4 threads (8 active requests per instance).
Requests beyond those slots wait in the proxy or socket backlog. This is not a
promise of 1,000 simultaneous requests: provision instances and request threads
against measured CPU, memory, database, and provider limits.

Set `REDIS_URL` to a private Redis-compatible service when running more than
one worker or instance. Django then uses one shared cache for DRF throttles,
OTP resend limits, and admin MFA challenges. Without it, the local-memory cache
is intentionally suitable only for a single process; throttles can diverge and
an MFA challenge may not be visible to the worker handling the next request.
The authentication and per-user rate limits remain enabled.

For Supabase, use the transaction pooler URL (port 6543) when the application
has multiple workers or instances and direct connections are limited. The
backend detects Supabase transaction-pooler URLs, defaults persistent
connections off, and disables server-side cursors for that mode. Configure
`DB_CONN_MAX_AGE_SECONDS=0` explicitly if using a different transaction pooler.
For direct or session-pooled PostgreSQL connections, budget at least
`instances * workers * threads` potential application connections, plus
migrations, operational tools, and Supabase-managed connections. Keep below
the project's connection limit and pool size.

## Work that must be moved off web requests

SMS, email, push, OCR, and other third-party calls can hold a request worker for
the provider timeout. Set `SMS_ASYNC_DELIVERY_ENABLED=true` to create a durable
queued SMS delivery after the booking transaction commits; run
`manage.py process_notification_deliveries` from a Render background worker or
scheduled job to submit queued messages, retry known failures, and reconcile
provider reports. Keep the default synchronous mode until that worker is
configured, or queued texts will wait. Email and push still dispatch after the
commit in the web process. OCR and optional chatbot calls also need bounded
provider timeouts and should be queued if measured request latency requires it.

## SMTP email delivery

Set `EMAIL_DELIVERY_ENABLED=true` on the backend web service to enable email
notifications; it defaults to disabled. Configure `EMAIL_HOST`, `EMAIL_PORT`,
`EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`,
`EMAIL_USE_TLS`, `EMAIL_USE_SSL`, and optionally `EMAIL_TIMEOUT` in the backend
service environment. For Gmail, use `smtp.gmail.com`, port `587`, TLS enabled,
SSL disabled, and an app password. For implicit SSL use port `465`, SSL enabled,
TLS disabled. Keep credentials only in the deployment environment, never in
the blueprint or logs. The startup settings reject enabling TLS and SSL
together. Confirm that the sender address is allowed by the SMTP account.

Password reset email is sent from the web request. Booking submission,
approval, and reminder emails remain queued for
`manage.py process_notification_deliveries`; booking completion emails make an
immediate post-commit SMTP attempt and remain in that same outbox for retry if
delivery fails. A scheduled job or background worker is still needed for queued
emails and retries. Installing that worker does not enable delivery by itself;
it also needs the SMTP variables and `EMAIL_DELIVERY_ENABLED=true`. SMTP connection failures are logged with host,
port, TLS/SSL mode, exception type, and response code where available; the
exception text, credentials, recipient, and message body are not logged.

## Load test requirements

Use an isolated staging database, storage bucket, SMS/email test credentials,
and synthetic accounts before exercising mutations. Do not run booking, login,
payment, upload, or notification stress tests against production data: these
flows create durable records or can contact real customers. Include separate
customer, staff, and admin scenarios; admin login requires the normal MFA flow.
Record p50/p95/p99 latency, throughput, status/error counts, database pool
usage, CPU, memory, and provider outcomes. Load tests that exceed configured
security throttles should count 429 responses separately from application
errors.

This repository's `render.yaml` provisions only the static frontend. The
backend service, its instance plan/autoscaling, environment variables, and
background worker are managed outside this blueprint and must be checked in
the Render dashboard before a production capacity target can be certified.

## Local isolated performance run

The repository includes a Windows-safe read-only load runner. It requires a
separate SQLite file whose name contains `perf_load`; the test server refuses
to start on any other database. It creates no bookings or payments during the
run, and the seeder uses synthetic `example.invalid` accounts and data. For
the dashboard scenario below, fixture rows are created only in that isolated
database.

From `backend`, set `TEST_DATABASE_URL` to an absolute local `perf_load`
SQLite path, run `manage.py migrate --settings=config.test_settings`, then
seed distinct synthetic identities and rows:

```powershell
$env:TEST_DATABASE_URL = 'sqlite:///C:/workspace/backend/tmp/perf_load.sqlite3'
$env:LOAD_TEST_FIXTURE_ROWS = '2000'
python manage.py migrate --noinput --settings=config.test_settings
python tools/seed_load_test_users.py 1000 tmp/load-test-users.json STAFF
python tools/run_perf_test_server.py
```

In a second terminal, run a synchronized dashboard burst or profile burst:

```powershell
$env:LOAD_TEST_BASE_URL = 'http://127.0.0.1:8107'
$env:LOAD_TEST_USERS_FILE = 'tmp/load-test-users.json'
$env:LOAD_TEST_VUS = '400'
$env:LOAD_TEST_ONCE = 'true'
$env:LOAD_TEST_PATHS = '/api/auth/profile/'
node tools/load_test.mjs
```

Use `refresh_load_test_tokens.py` before a run if the short-lived test tokens
have expired. The runner reports every HTTP error and connection failure and
exits nonzero if any request fails. A local SQLite run is useful for code
comparisons, but it does not reproduce PostgreSQL, Render's proxy, Gunicorn,
instance autoscaling, or provider limits. A 1,000-VU run on one developer
machine is therefore a diagnostic, not production certification. Run the same
scenarios on isolated staging resources before asserting a 1,000-user target.

## Optimizations and deployment requirements

Booking list indexes now match the customer history ordering and staff
schedule ordering. Dashboard booking-payment date filters separate payments
with a `paid_at` timestamp from legacy rows that fall back to `created_at`;
this keeps date predicates indexable. The selected-period payment count is
returned by its revenue aggregate instead of issuing another count query.
The frontend serves hashed `/static/*` bundles as immutable for one year and
revalidates `/index.html` so browsers can reuse JS and CSS between visits.

Keep database connections at zero persistent age when using the Supabase
transaction pooler (port 6543), and budget direct/session connections against
`instances * WEB_CONCURRENCY * WEB_THREADS` plus operational connections.
`REDIS_URL` is required for consistent throttles and MFA state across multiple
web workers or instances. Configure a Render background worker to run
`process_notification_deliveries` before enabling asynchronous SMS; that
command also drains the booking email queue. Push, OCR, and chatbot provider
calls still need queueing or measured timeout budgets if they become hot paths.

The current code defaults to two Gunicorn workers and four threads per
instance, or eight active requests per instance. The backend service and
database plans are not declared in `render.yaml`, so their current CPU, memory,
connection, and autoscaling limits cannot be inferred from this repository.
Do not advertise 1,000 simultaneous API requests until staging measurements
show zero failed requests at that load and the selected plans can sustain the
measured worker and database connection counts.
