# Booking payment proof storage

Booking receipts use the existing `payment_payment.receipt` field. Django stores an opaque object path in that column and uploads the bytes to the private Supabase Storage bucket `payment-proofs`. No new application table is required. The object itself is outside the Render filesystem, so backend restarts and redeploys do not remove it.

## Configure Supabase

Run [`backend/docs/supabase-payment-proof-storage.sql`](../backend/docs/supabase-payment-proof-storage.sql) in the existing Supabase project's SQL editor. It creates or secures only the `payment-proofs` bucket, limits objects to 5 MB and the supported receipt formats, and blocks the `anon` and `authenticated` client roles from this bucket.

## Configure the Django backend

Set these variables on the backend process only:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | The Supabase Project URL, such as `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-only service role key from Supabase API settings |
| `SUPABASE_PAYMENT_PROOFS_BUCKET` | `payment-proofs` (optional; this is the default) |

For local work, put them in `backend/.env` (copy the names from `backend/.env.example`). In Render, add them to the existing Django backend web service's environment settings, then redeploy that service. Do not put the service role key in the static frontend environment or client bundle. The repository's `render.yaml` defines the frontend static site; the backend service is managed separately in Render.

## Access flow

The customer submits a JPG, PNG, or WEBP receipt (up to 5 MB) with the booking payment form. The backend validates the file's decoded image format and size, writes it to the private bucket, and stores the object path on the same payment record as the booking, reference, amount, method, and timestamp. The existing admin/staff verification view opens the receipt through Django's authenticated receipt endpoint. That endpoint permits only the booking owner or staff/admin, returns private/no-store headers, and never exposes a public Supabase URL. Approval and rejection continue through the existing endpoint and update the payment and booking statuses together.

The backend also retains PDF receipt compatibility for existing API clients; the customer booking form continues to accept images only. Supabase bucket configuration allows both.

## Deployment verification

After adding the variables and applying the bucket SQL, submit a test booking/payment from the deployed customer site. Confirm an object appears under `payment-proofs/booking_receipts/` in Supabase Storage, the payment API returns its Django `/api/bookings/payments/<id>/receipt/` URL, and the receipt opens only while authenticated as its customer or as staff/admin. Approve and reject test payments and confirm the existing payment and booking statuses. Repeat the receipt check after a Render redeploy; the object should remain in Supabase Storage.
