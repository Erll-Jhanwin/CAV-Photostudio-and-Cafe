# Website test report — 2026-10-29

## Executive summary

Tests ran against the current checkout (`0c20dea`) using the repository's isolated Django test settings and the local frontend toolchain. The Django suite passed 166 tests (2 skipped); the clean frontend rerun passed all 59 tests across 13 suites. The production frontend build and web-build verification passed. Django reported no system-check issues, no migration drift, and `pip check` found no broken requirements.

This is not a complete release certification. No browser surface was available, so live browser end-to-end, hands-on usability, accessibility, and responsive checks were not executed. No load test or dependency-vulnerability scan was run. The current automated tests also leave important sales/refund and reporting paths without direct test cases.

## Test environment and data safety

- Backend tests used `backend/config/test_settings.py`, which defaults to an in-memory SQLite database, disables external email/SMS/push delivery, uses in-memory file storage, and uses local-memory cache. The test database was destroyed by Django after the run.
- Frontend tests and build ran from the installed local `node_modules`.
- Existing `backend/db.sqlite3`, other repository data, and hosted services were not used or modified. No migration was applied to an application database.
- The UI automation inventory returned no running apps or browsers and reported that its native pipe was unavailable. There was no safe browser session in which to exercise the site.

## Executed checks

| Area | Command / method | Result |
|---|---|---|
| Backend functional and API integration suite | `backend/venv/Scripts/python.exe manage.py test apps --settings=config.test_settings --verbosity 1` | **PASS** — 166 tests, 2 skipped; isolated in-memory database; Django system check clean. Repeated at verbosity 2 with the same result. |
| Frontend component and workflow tests | In `frontend`: `$env:CI='true'; npm test -- --watchAll=false --runInBand` | **PASS on isolated rerun** — 13 suites, 59 tests. React emitted `act(...)` warnings in dashboard tests. |
| Frontend optimized production build | Root: `npm run build` | **PASS** — CRA compiled successfully. Main bundle gzip size reported as 271.87 kB. |
| Web artifact validation | Root: `npm run verify:web-build` | **PASS** — expected React build output validated. |
| Django configuration | `backend/venv/Scripts/python.exe manage.py check --settings=config.test_settings` | **PASS** — no issues. |
| Migration consistency | `backend/venv/Scripts/python.exe manage.py makemigrations --check --dry-run --settings=config.test_settings` | **PASS** — no model changes detected. This checks drift; it does not apply migrations. |
| Python dependencies | `backend/venv/Scripts/python.exe -m pip check` | **PASS** — no broken requirements found. |
| Django deployment check | `manage.py check --deploy --settings=config.test_settings` | **WARNINGS, test-config only** — reported disabled SSL redirect, test secret, and insecure test cookies. `test_settings.py` explicitly overrides these for local tests; this is not evidence of deployed configuration. |

The first frontend run overlapped the memory-intensive production build and ended with 5 timeouts in 3 suites. With the build finished and Jest rerun alone, all tests passed. Treat the initial timeouts as a resource-contention run, not as confirmed product failures.

## Coverage observed

- Frontend automated tests cover selected behaviors in Login, Customer Dashboard, Admin Dashboard, Staff payment-proof flow, authentication context, API client, payment proof preview, Admin gallery/privacy/audit screens, ingredient-status modal, date/time utilities, and push-notification utilities.
- Backend tests exercise selected API and workflow behavior across users/authentication, booking lifecycle and availability, POS/receipt output, inventory stock movements and catalog, payment proof, notifications, audit logs, gallery, forecasting, dashboard, and chatbot.
- Existing tests include several authorization-denial assertions and a booking availability query-count check. These are useful targeted regression checks, not a complete role/permission or capacity assessment.
- `sales/tests.py` and `reports/tests.py` contain no test cases. In particular, this run does not establish correctness for refund accounting, stock-affecting sales edge cases, all reports, or every API endpoint.
- The UI defines public pages plus customer, staff, and admin routes, but component test coverage is selective. Every page, form, role combination, error state, and permission boundary was not executed.

## Findings

| ID | Severity | Evidence and reproduction | Recommended fix |
|---|---|---|---|
| F-01 | Low — test hygiene | The successful clean Jest run still printed repeated React `act(...)` warnings from asynchronous `CustomerDashboard` updates (for example `frontend/src/pages/CustomerDashboard.jsx:873-877`, `:894`, and profile-update handlers around `:626-630`). Run `npm test -- --watchAll=false --runInBand` to reproduce. Tests pass, so this is not a confirmed user-visible functional defect. | Update dashboard tests to await/marshal async state changes using `act` and async Testing Library queries; reduce console noise so future warnings are visible. |
| F-02 | Medium — verification gap | `backend/apps/sales/tests.py` and `backend/apps/reports/tests.py` are placeholders with no tests. No sales/refund, report snapshot, export, or end-of-day report API behavior was verified by this run. | Add isolated API/database tests for complete/void/refund/partial-refund flows, inventory effects, report totals, date boundaries, permissions, and idempotency. |
| F-03 | Low — evidence gap | `docs/compliance/accessibility-test-plan.md` marks manual checks complete but also requires release evidence; no screenshots or tool reports were available in this checkout/session. Those claims were not independently verified here. | Attach current release evidence for keyboard order/focus, 200% zoom, 320px reflow, screen-reader announcements, reduced motion, and contrast; update statuses if the evidence is stale. |

No product behavior bug was reproduced by the checks that could be run. The first-run frontend timeout failures did not recur in the isolated rerun.

## Blocked or untested

- **Browser end-to-end:** blocked because no browser/app automation surface was available. No login sessions or live pages were exercised.
- **Usability and all-page workflows:** not executed interactively. Component tests cover selected Admin/Staff/Customer behavior only.
- **Accessibility:** no axe scan was executed; no keyboard-only, screen-reader, reduced-motion, zoom, contrast, or focus-management review was performed.
- **Responsive design:** no 320px, tablet, desktop viewport, orientation, or overflow checks were run.
- **Performance/capacity:** no live latency, concurrency, stress, or soak test was run. The booking query-count regression test is only a narrow automated check.
- **Security:** no penetration test, live role matrix, CSRF/session browser test, secret/configuration review, or software-composition vulnerability scan was executed. Targeted permission tests in the Django suite are not a full security audit. The deploy check ran under test overrides and cannot certify deployment security.
- **External integrations:** real email, SMS, push, payment/storage providers, and hosted database behavior were intentionally not contacted from this safe test run.
- **Migration execution/data upgrade:** migration drift was checked, but migrations were not applied to a persistent database. Data preservation across a real upgrade remains unverified.

## Recommended next verification pass

1. Provide a disposable staging environment, isolated database snapshot, and dedicated non-production accounts for each role.
2. Add/refine sales and reports API tests, then cover refunds, stock side effects, and failure/duplicate/idempotency cases with database assertions.
3. Enable an approved browser runner against staging to execute route, role, form, print/reprint, error, and mobile viewport workflows.
4. Run accessibility scans plus the documented manual checks and attach release evidence.
5. Run a bounded load test against staging and dependency/security scans against the lockfiles and deployment configuration.
6. Apply pending migrations to a disposable copy of production data and verify invariants before any production migration.
