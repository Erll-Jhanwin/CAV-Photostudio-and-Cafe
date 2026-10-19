# Booking and SMS audit — October 18, 2026

## Outcome

Implemented local fixes for reproduced booking/PostgreSQL failures, lifecycle
notifications, safe retries, and frontend recovery. Production was not deployed
or migrated. Live handset delivery is NOT verified: the actual SMS provider
rejected the authorized test for a missing approved sender name.

## Root causes and fixes

1. **PostgreSQL SMS lock failure:** `SELECT FOR UPDATE` joined a nullable booking
   relationship and failed with SQLSTATE `0A000`. Reproduced using a read-only
   query on the configured database. Delivery now locks only the notification
   table; real PostgreSQL concurrent-worker tests verify one provider call.
2. **Error after a successful commit:** Django's robust callback error handler
   accessed `__qualname__` on a `functools.partial`. This could turn a notification
   failure into a booking HTTP 500 after the booking was already saved. Named,
   guarded callbacks now isolate delivery errors from the successful transaction.
3. **Eight-hour timestamp mismatch:** a custom database connection hook forced
   Asia/Manila while Django decoded timestamps as UTC. Measured a 28,800-second
   difference. Removed that override; database round-trip and retry deadlines now
   pass on PostgreSQL. Customer scheduling/display remains Manila-local.
4. **Incomplete lifecycle coverage:** payment pending/rejection, customer
   cancellation and chatbot mutations lacked consistent notifications. The
   existing event pipeline now handles actual supported changes, including
   PENDING, CONFIRMED, CONFIRMED_DP, COMPLETED and CANCELLED. Payment approval
   combines verification and confirmation in one SMS. Replayed unchanged writes
   do not emit duplicate events.
5. **State/race defects:** cancelled/completed bookings could be reopened by
   payment approval; rejected approvals could leave a down-payment-confirmed
   status. Added row locking and terminal-state checks, and recheck availability
   when reopening. Existing date locks and booking constraints still prevent
   competing reservations. Rescheduling/history and customer ownership are tested.
6. **Frontend retry defects:** availability refresh could clear the just-booked
   slot, and a reference precheck could block recovery after a lost payment
   response. Preserve the saved booking and original request keys during retries;
   booking history can resume payment without a second reservation. Explicit
   Manila conversion replaces browser-dependent payment timestamps. Calendar
   date keys no longer shift with browser timezone.
7. **Validation and logs:** reject malformed dates/times, oversized request keys,
   missing payment parent/reference, zero payment amounts, invalid registered
   phones and conflicting account contacts before inappropriate DB failures.
   Unexpected API logs retain safe exception class, SQLSTATE and stack locations,
   not raw SQL, request bodies, credentials or full phone numbers.
8. **Provider reliability:** persist a submission claim before HTTP, distinguish
   queued/accepted from delivered, reconcile status separately, and retry only
   definite transient failures with bounded backoff. Ambiguous submissions are
   never blindly resent. Old unkeyed notifications are not broadcast by the
   recovery worker. Failures in email/push do not prevent SMS attempts.
9. **Test isolation:** added settings that refuse non-local PostgreSQL test URLs,
   clear live delivery credentials and use in-memory receipt storage. Fixed OTP
   throttle cache leakage between tests and the documented OTP expiry parameter.

## Actual iProgSMS evidence

- Credentials check: HTTP 200, provider account found, 279 credits.
- Registered recipient: authorized account Xena001, number ending 4311;
  normalization uses the existing Philippine-mobile helper.
- Exact test content validation: passed.
- Send endpoint returned HTTP 200 **with provider status 500**, no message ID,
  and a rejection explaining that Smart/TNT cannot use the shared sender name.
  A controlled retry after checking recent activity returned the same rejection.
  Neither attempt was reported as accepted or delivered. No further sends made.
- The local booking API returned 201 despite the failure; request replay returned
  200 with the same booking and no additional notification attempt.
- This test used an isolated local booking/package clearly labeled TEST ONLY;
  no customer reservation, payment or schema was changed in production.

The integration follows the provider's [official API documentation](https://www.iprogsms.com/api/v1/documentation).
Obtain the required approval through the [iProgSMS sender-name account page](https://www.iprogsms.com/sender-names/new).
This requires provider/account-owner action, not a code workaround.

## Verification scope

- Full available backend suite exercised on isolated PostgreSQL 18, including
  real transaction commits, concurrent slot reservations, concurrent SMS workers,
  rollback isolation, safe retries, reminder deduplication/staleness, payment
  transitions, history, ownership/auth checks, and existing inventory/POS,
  dashboard, forecasting, chatbot and account tests.
- Rendered React workflow tests cover available-slot submission, a genuine 409
  conflict, lost payment response recovery with the same key, and payment resumed
  from history. API responses in these frontend tests are mocked; backend and live
  provider checks are separate, not a claimed full browser-to-handset success.
- Date/time tests, Django system checks, migration drift check, production frontend
  build, and whitespace/diff check were run. Final counts are in the handoff.
- A real browser pass could not run: no browser was exposed and opening the in-app
  browser returned `Browser is not available: iab`.
- Automated tests do not prove every possible application workflow is bug-free.
  External email, native push, printer hardware, deployment settings and actual
  SMS handset delivery were not verified in this audit.

## Required deployment/manual configuration

1. Deploy the changed backend and frontend; run `python manage.py migrate`.
   The only new schema changes are notification/delivery fields in migration 0006.
2. Set `SMS_DELIVERY_ENABLED=true` in the deployed backend when ready. It is absent
   in the inspected local environment, so SMS is disabled by default. The token
   exists and was validated; it was not printed, modified or committed.
3. Obtain an approved iProgSMS sender name for Smart/TNT, then authorize and repeat
   one controlled end-to-end test. Verify provider status and handset receipt.
4. Schedule `python manage.py process_notification_deliveries` every minute and
   `python manage.py send_booking_reminders` every 15 minutes with the same backend
   database/settings. The repository's Render blueprint only defines the frontend;
   these backend schedules are not provisioned there.
5. Review failed/skipped/unknown records in the admin-only delivery API. Do not
   bulk resend historical messages or uncertain attempts. Correct configuration
   does not automatically replay previous skipped/permanent failures.

No production deployment, production migrations, Git commit or push was performed.
See [notification operations](notification-delivery.md) for retry/status semantics.
