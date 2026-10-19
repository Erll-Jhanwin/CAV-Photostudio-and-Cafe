# System improvements and verification — October 19, 2026

## Implemented

- Registration OTP resend is available from the verification screen. Codes retain an expiry, attempt cap and send cooldown; contact and IP sends are rate limited. Provider errors remain visible as errors.
- Booking payments accept GCash, Maya and MariBank. The API advertises only methods with configured QR URLs, and the customer screen shows the matching QR and sends the selected method. No payment destination or QR image is fabricated.
- Payment proof files remain linked to their `Payment` and booking. The serializer no longer returns a storage path; proof downloads use an authenticated API endpoint restricted to the booking customer or staff/admin, with private/no-store headers. `MEDIA_ROOT` is configurable for a persistent volume.
- Dashboard data calls have 12-second timeouts and independent results, so a failing profile or service request does not discard successful bookings or leave the initial spinner stuck. Authentication profile checks are also bounded.
- Customer booking history has functional All, Pending, Verified, Completed and Canceled filters and live counts.
- Forecast reports now expose whether at least 30 days of actual observations exist; imputed missing dates are not counted as sales. The import process writes only forecasting-owned tables and retains prior snapshots.
- The notification implementation records push and SMS provider outcomes, targets the registered booking customer, handles provider errors, and includes reminder deduplication. Tests cover these flows, but mocked provider acceptance is not represented as handset delivery.

## Verification

- Backend: `python manage.py test apps --settings=config.test_settings` — 115 tests passed, 2 skipped because SQLite cannot exercise PostgreSQL row locks. Tests use an isolated in-memory SQLite database and disabled live delivery credentials.
- Django system check — clean.
- Migration drift check — no changes detected. Payment method choices are represented by migration `apps/payment/migrations/0004_alter_payment_method.py`.
- Frontend: 5 suites and 15 tests passed, including the customer status filter and payment-method submission. React test output still includes `act(...)` warnings from existing asynchronous availability requests.
- Frontend production build — compiled successfully (JS bundle 261.21 kB gzip).

## Data and live-service limits

- The bundled July 2025 sales CSV covers 31 calendar dates but has only 11 dates with recorded sales. It cannot satisfy 30 observed sales days. The forecast reports this deficit; adding synthetic rows would misrepresent actual sales. Supply a real, validated sales export to expand the forecast history. Existing snapshots are retained and unrelated tables are untouched.
- This checkout contains no real GCash, Maya or MariBank QR assets. Set `PAYMENT_QR_GCASH_URL`, `PAYMENT_QR_MAYA_URL` and/or `PAYMENT_QR_MARIBANK_URL` to the corresponding real, customer-accessible image URLs. All three methods are listed; those without QR configuration are marked unavailable, and payment submission is blocked until a QR-backed method is selected.
- Configure `MEDIA_ROOT` to a mounted persistent backend volume (the example uses `/var/data/media`). A container's ephemeral filesystem does not provide durable proof storage across restarts.
- Push requires `PUSH_DELIVERY_ENABLED`, valid `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` and `PUSH_VAPID_SUBJECT`, HTTPS, and a real browser subscription. No physical device delivery was asserted in tests.
- SMS/OTP requires `SMS_DELIVERY_ENABLED=true`, `IPROG_SMS_API_TOKEN`, a valid `IPROG_SMS_API_BASE_URL`, credits and an approved sender name/network. Prior provider checks were blocked by sender-name approval; a real SMS to a registered handset was not verified here. Run `process_notification_deliveries` and `send_booking_reminders` on a scheduler for queued updates and reminders.
- The backend deployment, migrations on the live database, persistent media volume, schedulers, configured payment QR images, VAPID keys, live SMS delivery, and a browser-to-production booking pass remain operator/deployment work. No production database or provider was changed by this audit.

See [notification delivery operations](notification-delivery.md) for provider status semantics and worker setup.
