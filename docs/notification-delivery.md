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

## Deployment checklist

1. Add `pywebpush` (already pinned in `backend/requirements.txt`) and run the
   notification migration in the target environment:

   ```text
   python manage.py migrate notifications
   ```

2. Set the five `PUSH_*` variables in the backend environment. Never place the
   private key in frontend variables, source control, or `frontend/public`.
   Keep `PUSH_DELIVERY_ENABLED=false` until all three VAPID values are valid.

3. Serve the frontend from HTTPS. The service worker is published at
   `/push-sw.js`; reverse proxies must not rewrite or block that root-level
   file. `localhost` is also accepted by browsers for local development.

4. Sign in as a customer, open Notifications, choose **Enable push**, and
   grant the browser permission. The authenticated subscription is stored per
   user and per browser endpoint. Disabling push removes that endpoint from
   the backend and unsubscribes the browser.

5. Trigger a booking event (new request, staff confirmation/cancellation, or
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
