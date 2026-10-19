# Notification delivery

The application keeps in-app notifications as the source record and records
one `NotificationDelivery` row for every attempted email, SMS, or push channel.
Delivery is best-effort: a provider outage is logged and does not roll back a
booking or payment workflow.

## Provider configuration

Enable only the channels that have been configured in the backend environment:

```text
EMAIL_DELIVERY_ENABLED=true
EMAIL_PROVIDER=resend
DEFAULT_FROM_EMAIL=CAV Photo Studio & Cafe <verified-sender@example.com>
RESEND_API_KEY=re_your_key
RESEND_API_URL=https://api.resend.com/emails

SMS_DELIVERY_ENABLED=true
IPROG_SMS_API_TOKEN=your_iprogsms_token
IPROG_SMS_API_BASE_URL=https://www.iprogsms.com
IPROG_SMS_API_TIMEOUT=15
SMS_MAX_ATTEMPTS=3
SMS_RETRY_DELAY_SECONDS=60
BOOKING_REMINDER_WINDOW_MINUTES=30

PUSH_DELIVERY_ENABLED=true
PUSH_VAPID_PUBLIC_KEY=your_public_key
PUSH_VAPID_PRIVATE_KEY=your_private_key
PUSH_VAPID_SUBJECT=mailto:ops@example.com
PUSH_DELIVERY_TTL_SECONDS=86400
```

Email can use SMTP instead of Resend by setting `EMAIL_PROVIDER=smtp` and the
standard Django `EMAIL_*` variables. The default console backend is treated as
non-delivery and produces a `skipped / console_backend` log entry.

Generate one VAPID key pair with the `pywebpush`/`py-vapid` tooling or another
trusted Web Push key generator. Keep the private key server-side; only the
public key is returned by `/api/notifications/push/config/`. Do not rotate the
pair casually: existing browser subscriptions are tied to the public key and
must be re-created after a rotation.

## API paths

- `GET /api/notifications/push/config/` returns the public Web Push key when
  push is enabled.
- Authenticated `POST /api/notifications/push/subscription/` upserts a browser
  subscription.
- Authenticated `DELETE /api/notifications/push/subscription/` removes one
  browser subscription.
- Admin-only `GET /api/notifications/deliveries/` lists recent delivery status
  records and supports `channel` and `status` filters.

The frontend asks for browser permission from the customer Notifications tab;
permission is never requested during login or page load.

Booking submission, payment submission/approval/rejection, actual booking status
changes, edits, and reminders create notifications for the booking customer's
registered phone number. Messages include the date, Manila time, package, booking
status, and payment status. Payment approval includes down-payment confirmation
in one message. Repeating an unchanged status does not create another event.

Events are saved in the same database transaction as the booking/payment change;
delivery runs only after commit. SMS failures cannot roll back the saved booking.
Event keys and locked delivery claims prevent repeated requests and concurrent
workers from sending the same event twice. Logs contain IDs, error classifications,
attempt counts and the recipient's last four digits, not tokens or full numbers.

Run `python manage.py process_notification_deliveries` every minute in the same
backend environment. It recovers undispatched keyed events, checks provider
status, and retries definite transient failures with bounded backoff on the same
delivery row. It does not broadcast historical unkeyed notifications. A connection
timeout, rate limit, or explicit failed/undelivered report can be retried; an
ambiguous timeout, malformed response, server failure, or interrupted submission
is `unknown` and requires operator reconciliation before any resend. Do not create
a fresh notification merely to retry an uncertain request. Configuration failures
and skipped deliveries are not automatically replayed after configuration changes.

SMS `accepted` means the provider queued the message; `sent` means the provider
reported sent/completed, not proven handset receipt. Only an explicit `delivered`
report sets `delivered_at`. The provider's HTTP 200 alone is never delivery proof.

The authorized October 18 test found a valid token and 279 credits, but iProgSMS
rejected the Smart/TNT recipient because an approved sender name is required.
This is recorded as `sender_name_required`; obtain approval in the provider
account before testing again. Do not work around this with an unapproved sender.

## Booking reminders

The backend includes the `send_booking_reminders` management command. It checks
the booking's current local date/time and sends two customer reminders through
the existing notification pipeline: approximately 24 hours before the session
and approximately 2 hours before the session. The default delivery window is
30 minutes, configured with `BOOKING_REMINDER_WINDOW_MINUTES`, so a scheduler
can run every 15 minutes without needing exact timing. Each message includes
the booking number, local date/time, a 15-minute early-arrival reminder, and
basic outfit/prop preparation guidance.

Run it from the backend directory:

```text
python manage.py send_booking_reminders
```

Configure the backend service to run this command every 15 minutes. For a
Windows deployment, use Task Scheduler with the program set to the backend
virtual-environment Python executable and the argument `manage.py send_booking_reminders`,
with the working directory set to `backend`. For a
Render deployment, add a Cron Job that uses the same backend environment and
runs `python manage.py send_booking_reminders` every 15 minutes. The cron job
must have the same database and `SMS_DELIVERY_*`/`IPROG_SMS_*` environment
variables as the web service.

The command only considers the existing active booking statuses
(`PENDING`, `CONFIRMED`, and `CONFIRMED_DP`), so cancelled or completed
bookings are ignored. It locks and re-checks each booking immediately before
creating a reminder. A rescheduled booking uses its new date/time and creates
a new reminder signature; a previously delivered SMS cannot be recalled. The
event key includes the booking, reminder type and current schedule. Repeated
scheduler runs do not resend it. Stale reminders are suppressed after cancellation
or rescheduling. Failures remain in `NotificationDelivery`; they do not roll back
the booking. Use `--at 2026-10-18T08:00:00+08:00 --dry-run` to inspect due
reminders without creating notifications or contacting iProgSMS.

## Deployment checklist

1. Add `pywebpush` (already pinned in `backend/requirements.txt`) and run the
   migrations, including `notifications.0006_sms_delivery_lifecycle`, in the target environment:

   ```text
   python manage.py migrate
   ```

2. Set the five `PUSH_*` variables in the backend environment. Never place the
   private key in frontend variables, source control, or `frontend/public`.
   Keep `PUSH_DELIVERY_ENABLED=false` until all three VAPID values are valid.

3. Set `SMS_DELIVERY_ENABLED=true` alongside a valid iProgSMS token and
   sufficient credits and an approved sender name for supported networks before expecting booking SMS. Keep it false in local
   development unless the configured recipient is an authorized test number.

4. Serve the frontend from HTTPS. The service worker is published at
   `/push-sw.js`; reverse proxies must not rewrite or block that root-level
   file. `localhost` is also accepted by browsers for local development.

5. Sign in as a customer, open Notifications, choose **Enable push**, and
   grant the browser permission. The authenticated subscription is stored per
   user and per browser endpoint. Disabling push removes that endpoint from
   the backend and unsubscribes the browser.

6. Trigger a booking event (new request, staff confirmation/cancellation, or
   booking-payment approval/rejection). Inspect the resulting
   `NotificationDelivery` rows or the admin delivery endpoint. `sent` means
   the Web Push provider accepted the request; it does not guarantee that a
   device displayed the notification.

The current implementation is browser Web Push (VAPID). The Capacitor Android
shell does not yet have an FCM registration/token flow; native Android push
requires a separate Firebase project, `google-services.json`, the Capacitor
Push Notifications plugin, and an FCM server credential before it can be
enabled safely. The web workflow remains unaffected by that optional native
setup.

## Verification

Provider calls are covered by mocked tests. A real end-to-end send requires
provider credentials, a verified email sender, iProgSMS credits/recipient, and
a browser subscription created over HTTPS. Missing credentials are recorded as
`skipped` rather than making a network request.

Keep Django database sessions in UTC with `USE_TZ=True`; display and scheduling
remain in Asia/Manila. Do not restore the old custom Asia/Manila database-session
override: it caused an eight-hour timestamp decoding error.

Run isolated tests with `python manage.py test apps --settings=config.test_settings`.
Use `TEST_DATABASE_URL` for an isolated localhost PostgreSQL database to exercise
real row locks; never point the test runner at the production database. See
[the audit report](system-audit-2026-10-18.md) for the verified scope and limits.
