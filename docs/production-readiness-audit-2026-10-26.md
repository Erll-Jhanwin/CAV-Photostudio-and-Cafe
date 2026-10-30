# Production Readiness Audit

**Audit date:** 2026-10-26  
**Status:** Not ready for production release. Code-level gaps addressed below; browser acceptance, live providers, persistent production storage/database, and clean dependency audits remain unverified or blocked.

## Checklist: requested audit gaps

| Audit gap | Implementation and verification evidence | Status / next verification |
|---|---|---|
| Production-like end-to-end browser acceptance for registration, login, roles, bookings, payments, notifications, and critical workflows | Backend API and workflow tests ran on isolated in-memory SQLite; frontend Jest suites passed before the final dependency updates. No browser was available in the computer-use surface, and the repo has no installed Playwright/Puppeteer browser runner. | **Blocked.** Run browser E2E against a disposable production-like environment and seeded test accounts once a browser runner and test deployment are available. Do not treat API/unit tests as E2E evidence. |
| Provider credentials, environment variables, connectivity, response accuracy, timeouts, fallbacks | Inspected settings and `.env.example` without printing credential values. Existing provider adapter tests exercise mocked success, rejection, malformed responses, timeouts, retries, and chatbot fallback. | **Partially verified.** No authorized sandbox credentials or external test destinations were provided. Verify actual provider account credentials, sender approval, configured timeouts, and responses in each provider sandbox. |
| Database schema, CRUD, data integrity, migrations, workers, schedules, retries, and failure logs | `makemigrations --check --dry-run` reported no model drift. All migrations, including gallery restore migration, applied on isolated in-memory SQLite. Full backend suite ran **143 tests, 2 skipped** (SQLite cannot verify row locks). Notification delivery and booking reminder command behavior/retry/dedup paths are covered by tests. Receipt cleanup failures now emit a path-free warning. | **Partially verified.** No production PostgreSQL connection was used. Run migration check and CRUD/concurrency tests against an isolated PostgreSQL clone. The repo Render blueprint provisions only the frontend; confirm backend worker and scheduler configuration on the actual host. |
| Real SMS, email, and device-notification delivery | Delivery lifecycle and provider response mapping are covered by mocked tests; no real message or push was sent. Current local development settings report SMS/email disabled. | **Blocked.** Verify on authorized test recipients/devices after confirming consent, sender configuration, and credentials. Record provider delivery IDs/status and confirm duplicate suppression. |
| Persistent gallery records and staff/admin workflows | Added the `GalleryImage` model, migration that restores archived metadata and seeds prior public gallery cards, image storage adapter, public/featured read API, staff/admin create/edit/delete API, Django admin registration, staff/admin gallery manager UI, and public landing-page integration. API/UI tests cover permissions, filtering, upload validation, update/delete, storage failure, and visibility. | **Implemented; external storage unverified.** Configure a public gallery bucket and server-only storage credentials, then verify real upload/read/delete persistence. |
| Security, privacy roles, deployment controls, privacy-case lifecycle | Added admin-only privacy queue/review endpoint and UI; customer details are bounded; completed/rejected cases require notes; terminal cases cannot reopen. Tests cover role denial and state transitions. Secret scan passes after fixing test-file detection so synthetic fixtures are not treated as committed secrets. Bandit passes on application/config code with known safe false positives annotated and test fixtures excluded. | **Partially verified.** Run the privacy workflow on production-like data and verify deletion/export actions with a designated privacy owner. Confirm deployed flags/headers and approved rate limits in host settings. |
| Frontend tests, UI interactions, loading, forms, responsive and accessibility | Frontend suite passed **8 suites / 26 tests** after the workspace dependency updates; the CustomerDashboard focused suite then passed **5/5** after adding calendar stale-request/unmount guards. The final optimized production build compiled, and `verify-web-build` passed. | **Partially verified.** CustomerDashboard tests still log React `act(...)` warnings because mocked availability promises resolve outside test `act` boundaries. A test-only attempt to flush those promises inside `act` timed out all five cases and was reverted; the original tests pass. Browser-based responsive/accessibility and actual browser-console checks remain blocked by the missing browser runner. |
| Secret scan, dependency audits, deployment/release pipeline | Secret scan passed. CI Node version was aligned to Node 22 from `.nvmrc` and the root package engine. Python requirements were patched; `pip-audit` now reports no known vulnerabilities. Compatible npm fixes and the Capacitor Android critical advisory were addressed. `verify-web-build` passed after a production build. | **Blocked by remaining npm advisories.** Workspace audit reports 58 findings (9 low, 31 moderate, 18 high, 0 critical). The remaining high findings are primarily in the pinned Create React App/Tailwind 3 build chain; npm's suggested full fix changes `react-scripts` to an invalid `0.0.0` version or upgrades Tailwind to v4, so that breaking change was not applied. CI's high-severity audit gate remains red until the build chain is migrated or safely patched. |
| Scope control | Changes are limited to the gallery persistence workflow, privacy review workflow, scanner false-positive handling, provider/error logging, and dependency security patches. Existing production data was not accessed or changed. | **Satisfied for this audit.** Production deployment and live integrations were not attempted. |

## Code changes

- **Persistent gallery:** added `GalleryImage`, the `0003_initial` restore/seed migration, Supabase-backed gallery storage, serializer validation, public and permission-gated CRUD endpoints, staff/admin management UI, public page integration, and storage setup notes.
- **Privacy cases:** added admin list/update API and dashboard queue with notes-required completion/rejection and terminal-state protection.
- **Security checks:** improved the secret scan's test fixture exclusions; added safe logging when payment-receipt cleanup fails; documented Bandit suppressions for known false-positive validation text, local printing, and the SMS timeout expression; excluded test fixtures from Bandit CI.
- **Booking UI stability:** month/day availability responses now carry request generations and check component mount state, so stale responses cannot overwrite a newer selection or update after navigation.

## Files changed for this audit

- Backend gallery: `backend/apps/gallery/models.py`, `migrations/0003_initial.py`, `storage.py`, `serializers.py`, `views.py`, `admin.py`, `tests.py`.
- Privacy workflow and reliability/security checks: `backend/apps/users/views.py`, `tests.py`, `serializers.py`, `sms_delivery.py`; `backend/apps/booking/serializers.py`; `backend/apps/pos/receipt_printing.py`; `backend/config/settings.py`, `urls.py`; `backend/requirements.txt`, `backend/.env.example`.
- Frontend: `frontend/src/pages/admin/GalleryManager.jsx`, `GalleryManager.test.jsx`, `PrivacyRequestsManager.jsx`, `PrivacyRequestsManager.test.jsx`; `frontend/src/pages/AdminDashboard.jsx`, `StaffDashboard.jsx`, `LandingPage.jsx`, `CustomerDashboard.jsx`, `CustomerDashboard.test.jsx`; `frontend/package.json`, `frontend/package-lock.json`.
- Release/docs: root `package.json`, `package-lock.json`, `.github/workflows/quality.yml`, `scripts/secret_scan.py`, `docs/gallery-management.md`, this report.
- A pre-existing working-tree edit in `docs/payment-proof-storage.md` was left untouched. `PROJECT_PROGRESS_DASHBOARD.html` was already modified from the earlier progress-dashboard task and was not changed in this audit.
- **Dependency/runtime alignment:** updated CI Node to 22, patched the seven vulnerable pinned Python packages, and aligned Capacitor packages to 8.4.3 in both workspaces. Python dependency audit is clean; npm still reports 18 high findings in the legacy frontend toolchain.

## Commands and results collected

| Command/check | Result |
|---|---|
| `python manage.py test apps --settings=config.test_settings --noinput` | **Pass:** 143 tests; 2 skipped for SQLite row-lock limitations. |
| `python manage.py makemigrations --check --dry-run --settings=config.test_settings` | **Pass:** no model changes missing from migrations. |
| `python manage.py migrate --noinput --settings=config.test_settings` | **Pass:** complete migration chain applied on ephemeral in-memory SQLite. |
| Frontend `npm test -- --watchAll=false --runInBand --forceExit` | **Pass after dependency updates:** 8 suites, 26 tests. The changed CustomerDashboard behavior was then rechecked separately: 5/5 tests passed. |
| Frontend `npm run build` | **Pass after all source and dependency updates:** optimized production build compiled. |
| `node scripts/verify-web-build.mjs` (repo root) | **Pass after final production build:** expected build entry point found. |
| `python scripts/secret_scan.py` | **Pass:** no committed known credentials/provider tokens after test-fixture path fix. |
| Bandit | **Pass** on app/config scan excluding test fixtures; suppression warnings are non-failing and identify already-reviewed false-positive rules. |
| Django `check --deploy` | Local `.env` has development values and produces expected debug/insecure-cookie warnings. A release-mode check with dummy secure flags passed with no issues; this does not prove deployed host configuration. |
| `pip-audit -r requirements.txt` | **Pass:** no known vulnerabilities after upgrading the seven previously affected pinned packages. |
| `npm audit --workspace frontend --json` | **Fails high-severity gate:** 58 findings — 9 low, 31 moderate, 18 high, 0 critical. The Android critical finding is gone after pinning Capacitor packages to 8.4.3. The remaining highs are chiefly `react-scripts` transitive build tools. |
| `manage.py check --deploy` with release-only dummy environment | **Pass:** no issues when `DEBUG=False`, HTTPS redirect, secure cookies, and HSTS flags are enabled. A separate override with HSTS subdomain/preload disabled reports only those two optional HSTS recommendations. |
| `git diff --check` | **Pass:** no whitespace errors; Git only noted expected LF-to-CRLF working-copy conversions. |

## Remaining blockers and required evidence

1. Run E2E browser workflows in a disposable deployment for customer registration/login, customer/staff/admin permissions, booking creation, payment proof, notification lifecycle, and the new privacy/gallery screens.
2. Confirm backend PostgreSQL migrations and gallery CRUD against a non-production database and real persistent storage bucket. Required gallery settings are `GALLERY_STORAGE_BACKEND=supabase`, `SUPABASE_URL`, server-only `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_GALLERY_BUCKET`.
3. Verify provider credentials and send authorized test SMS/email/push notifications; inspect recipient, content, provider status, delivery, retry, and deduplication. Relevant settings include `IPROG_SMS_API_TOKEN`, SMTP `EMAIL_*` values, and `PUSH_VAPID_PUBLIC_KEY`/`PUSH_VAPID_PRIVATE_KEY`; keep delivery disabled until authorized test destinations are configured.
4. Confirm the deployed backend environment has production secret values, `DEBUG=False`, HTTPS redirect, HSTS/cookie flags, public/private storage bucket policies, and a scheduled worker for reminders/delivery processing. This repo's Render blueprint defines only the frontend service.
5. Plan a supported frontend build-toolchain migration (or thoroughly tested security overrides) to clear the remaining 18 high npm findings, then rerun the audit and release pipeline. Do not use `npm audit fix --force` with its proposed invalid CRA package version.
6. Run browser accessibility/responsive/console validation after a browser runner is available.

No production API, database, notification recipient, or deployment was used during this audit.
