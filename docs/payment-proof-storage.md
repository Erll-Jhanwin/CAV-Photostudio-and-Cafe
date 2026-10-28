# Private uploads and customer photo delivery

Booking payment proofs and delivered customer photos are stored in private Supabase Storage buckets. The Django API streams each file only after checking the signed-in user's role and, for customer requests, the booking owner. The frontend never receives a storage service key or a public object URL.

## Deployment setup

1. Configure the backend with `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`).
2. Set `SUPABASE_PAYMENT_PROOFS_BUCKET=payment-proofs` and `SUPABASE_CUSTOMER_PHOTOS_BUCKET=customer-photos`.
3. Run `backend/docs/supabase-payment-proof-storage.sql` in the Supabase SQL editor. It creates both private buckets and blocks direct access by anon/authenticated client roles.
4. Deploy the backend and apply Django migrations, including `gallery.0005_customerphoto` and `pos.0012_order_return_events_order_returned_amount`.

The payment proof endpoint is `GET /api/bookings/payments/<id>/receipt/`. Customers can retrieve proofs only for their own booking; staff and admins can retrieve proofs for verification. Photos are assigned to a booking by staff through `POST /api/gallery/customer-photos/`, and the customer can list and download only photos attached to their own bookings through `/api/gallery/customer-photos/`.

Use the admin or staff Customer Photos tab to deliver photos. Uploaded photo files are kept in the private customer photos bucket, so they remain available after backend redeploys. Requests that fail storage operations return an actionable API error and create an admin-visible audit record.
