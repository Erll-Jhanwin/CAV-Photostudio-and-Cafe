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

Booking submission and approved booking-payment verification create customer
notifications that use the registered phone number on the booking's customer
account. When SMS delivery is enabled, iProgSMS sends the booking-submitted
message with the booking date, time, selected package, and payment status.
Already-attempted SMS deliveries are not sent again if the same notification is
dispatched again, including after a provider failure. The failed delivery and
provider-safe error details remain available in `NotificationDelivery` for
operator review; a retry must create an explicit new notification so a timeout
cannot accidentally duplicate a message.

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
notification message itself is the idempotency signature, and a sent SMS is
never sent again on repeated scheduler runs. Provider failures are captured in
`NotificationDelivery` with `failed` status and `provider_error`; they do not
roll back the booking. Use `--at 2026-10-18T08:00:00+08:00` for a deterministic
dry-run/test and add `--dry-run` to inspect due reminders without creating
notifications or contacting iProgSMS.

## Deployment checklist

1. Add `pywebpush` (already pinned in `backend/requirements.txt`) and run the
   notification migration in the target environment:

   ```text
   python manage.py migrate notifications
   ```

2. Set the five `PUSH_*` variables in the backend environment. Never place the
   private key in frontend variables, source control, or `frontend/public`.
   Keep `PUSH_DELIVERY_ENABLED=false` until all three VAPID values are valid.

3. Set `SMS_DELIVERY_ENABLED=true` alongside a valid iProgSMS token and
   sufficient credits before expecting booking SMS. Keep it false in local
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
