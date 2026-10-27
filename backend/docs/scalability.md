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
