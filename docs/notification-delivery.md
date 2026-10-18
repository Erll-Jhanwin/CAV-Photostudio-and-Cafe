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

Generate a VAPID key pair with the `pywebpush`/`py-vapid` tooling or another
trusted Web Push key generator. Keep the private key server-side; only the
public key is returned by `/api/notifications/push/config/`.

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

## Verification

Provider calls are covered by mocked tests. A real end-to-end send requires
provider credentials, a verified email sender, iProgSMS credits/recipient, and
a browser subscription created over HTTPS. Missing credentials are recorded as
`skipped` rather than making a network request.
