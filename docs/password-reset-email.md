# SMTP Email Configuration

All transactional email uses Django's built-in SMTP backend. Configure these
variables on the backend service; never put credentials in source control or
frontend variables:

```env
EMAIL_DELIVERY_ENABLED=true
EMAIL_HOST=smtp.your-provider.example
EMAIL_PORT=587
EMAIL_HOST_USER=your-smtp-username
EMAIL_HOST_PASSWORD=your-smtp-password
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
DEFAULT_FROM_EMAIL=CAV Photo Studio & Cafe <no-reply@your-verified-domain.com>
EMAIL_TIMEOUT=20
```

Use port 587 with `EMAIL_USE_TLS=true`, or port 465 with
`EMAIL_USE_SSL=true`. Do not enable TLS and SSL together. `EMAIL_BACKEND` is
fixed to Django's built-in SMTP backend in the application. The Gmail app
password may be entered with or without spaces.

For Render, SMTP ports 25, 465, and 587 are blocked on free web services; port
25 is blocked on all Render services. SMTP therefore requires a paid Render
service and an SMTP provider/port that Render permits. See [Render's current
free-service limits](https://render.com/docs/free).

Booking email delivery continues to run from the database-backed outbox. Keep
the existing `process_notification_deliveries` cron job running every minute
for booking email retries and scheduled session reminders. Configure
`BOOKING_FEEDBACK_URL` to the deployed frontend's `/booking-feedback` URL.
