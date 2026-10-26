# Performance and capacity tuning

## Changes in this optimization pass

- Gunicorn now uses configurable gthread workers and threads, with request timeout, graceful shutdown, bounded backlog, access/error logs, and periodic worker recycling. Defaults are **2 workers × 4 threads = 8 active request slots per instance**.
- PostgreSQL connection reuse is configurable with DB_CONN_MAX_AGE_SECONDS (default 60) and health checks. Set the age to 0 and DB_DISABLE_SERVER_SIDE_CURSORS=true when the configured Supabase endpoint is a transaction-mode pooler. Do not point a large worker/thread count at a direct database endpoint without checking the provider's connection limit.
- Product, ingredient, gallery, booking, review, staff-user and order list routes return bounded windows by default and accept limit/offset, preserving the existing array response format. Existing UI requests that specify a limit keep their current shape.
- Inventory list serialization bulk-fetches category/supplier/recipe references. Query count no longer grows with the number of products or ingredients in the response.
- Dashboard analytics computes revenue, status and package aggregates in SQL; trend lines are grouped by local day in the database. It selects only recipe JSON when calculating top products and fetches the recent transaction feed separately.
- Frontend GET requests coalesce identical in-flight reads. Query-cache generations prevent prior-session or pre-mutation responses from being reused. Staff local-storage snapshots are keyed by authenticated user, and a tab refresh already in flight is not duplicated.
- Added targeted indexes for catalog filtering/order, inventory-event feeds, booking analytics, POS date/status analytics, booking-payment analytics, and featured gallery ordering. These touch only the relevant tables.

## Capacity assumptions and target

The backend deployment identity and instance size are not present in render.yaml; that file provisions the static frontend only. The backend image is defined by backend/Dockerfile, while its actual host, CPU, memory, database plan and PostgreSQL pooler mode must be confirmed in the hosting account.

With the Docker defaults, up to eight requests per backend instance can execute concurrently. Additional connections queue in Gunicorn's bounded backlog (128); excess load may increase latency and eventually be rejected. Capacity is therefore finite and depends on CPU, memory, request mix, and available database connections. For a persistent-connection setup, budget roughly one connection per active worker thread per instance, plus migrations, scheduled commands and operations. Provider-side PgBouncer can change that budget; verify its mode and limits.

The practical target is p95 below 2 seconds for ordinary authenticated reads under normal expected traffic, with no unexpected 5xx responses and no cross-user cache reuse. This target is not a benchmark result and cannot be promised until testing against a production-like PostgreSQL/database and sized host.

## Load test procedure

The standard-library harness scripts/api_load_test.py performs concurrent test-account logins followed by read-only profile, booking, notification, catalog, POS and dashboard requests. It reports throughput, status/error rate, and p50/p95/p99 client-observed latency per stage and route. It does not report server CPU, memory, or database connection counts; collect those from the actual host and database metrics at the same timestamps.

Run against a disposable local or staging environment only. Use a test account without admin MFA and no production data. Example:

    $env:PERF_BASE_URL = 'https://staging.example.test'
    $env:PERF_TEST_USERNAME = 'performance-customer'
    $env:PERF_TEST_PASSWORD = '<test-only password>'
    python scripts/api_load_test.py --role customer --stages 5,10,25,50,100 --allow-remote

For staff-specific analytics/search/catalog paths, use a disposable staff account and --role staff. The login endpoint's normal auth throttle is 10 requests/minute per source key; if a stage is meant to measure database/app capacity rather than the login abuse-control threshold, use a temporary staging-only throttle setting that accommodates that stage, and separately verify production throttling. Never loosen production limits for a load run.

Run stages progressively. Stop if error rate, p95, memory use, database connections, or queue depth exceed the staging service's safe limits. Compare the post-change results with the same host/data shape and requests. The harness never makes booking, payment, inventory, privacy, notification, or other business writes.

### Local probe recorded 2026-10-26

The probe used Django's threaded development server on localhost, an isolated SQLite file, 50 synthetic catalog products, and 100 disposable staff accounts. Staging-only throttle rates were raised to avoid measuring the production abuse-control limit. This is a code-path smoke/load probe, not a production-capacity result.

| Concurrent users | Throughput | p50 | p95 | p99 | Errors |
|---:|---:|---:|---:|---:|---:|
| 5 | 38.70 req/s | 82 ms | 354 ms | 453 ms | 0 / 40 |
| 10 | 44.10 req/s | 117 ms | 623 ms | 771 ms | 0 / 80 |
| 25 | 52.85 req/s | 258 ms | 1,269 ms | 1,645 ms | 0 / 200 |
| 50 | 53.00 req/s | 412 ms | 1,979 ms | 4,845 ms | 0 / 400 |
| 100 | 55.21 req/s | 530 ms | 2,189 ms | 4,048 ms | 50 / 470 (10.64%; transport failures) |

The local 100-user run exceeded the p95 target and had transport failures; it is a failed stage. A first shared-account probe also produced 429 responses at the configured per-user throttle, so the recorded table uses unique disposable accounts. The local run cannot distinguish SQLite/threaded-development-server limits from backend or host capacity. No server CPU/memory or database connection telemetry was available. Repeat on the actual Gunicorn configuration and a disposable PostgreSQL-backed deployment before drawing a production conclusion.

## Remaining environment checks

- Confirm the backend host, instance CPU/RAM, autoscaling policy and deploy command; set WEB_CONCURRENCY and WEB_THREADS to fit measured memory and database limits.
- Confirm Supabase direct versus session/transaction pooler URL, connection caps and server-side cursor policy. Set DB_CONN_MAX_AGE_SECONDS=0 for transaction pooling.
- Apply index migrations first on a staging clone. Check migration duration, lock behavior, query plans and write latency before production rollout.
- Capture host CPU/memory, Gunicorn active workers/threads/queue, PostgreSQL active/waiting connections, slow queries, lock waits and pooler saturation during 5/10/25/50/100-user runs.
- Use PostgreSQL for concurrency/load conclusions. SQLite tests verify functional and query-count behavior but cannot demonstrate PostgreSQL throughput, row-lock correctness, or production capacity.
