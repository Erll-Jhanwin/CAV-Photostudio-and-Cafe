# Private uploads and customer photo delivery

Booking payment proofs and delivered customer photos are stored in private Supabase Storage buckets. The Django API streams each file only after checking the signed-in user's role and, for customer requests, the booking owner. The frontend never receives a storage service key or a public object URL.

## Deployment setup

1. Configure the Render backend service with `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`). These values belong on the backend service, never the static frontend. `render.yaml` in this repository provisions only the frontend, so verify these settings on the existing backend service after each deployment.
2. In that Supabase project's **Storage** page, create a private bucket named `payment-proofs`. Set the file size limit to 5 MB and allow `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`. Create a second private bucket named `customer-photos` with a 5 MB limit and the image MIME types if customer photo delivery is used. Create buckets through the dashboard; Supabase manages `storage.buckets` and may reject direct SQL inserts under row-level security.
3. Run `backend/docs/supabase-payment-proof-storage.sql` in the Supabase SQL editor. It applies the policy that blocks direct access by anon/authenticated client roles; the Django backend uses its server-only key and enforces customer ownership and staff access.
4. Deploy the backend and apply Django migrations, including `gallery.0005_customerphoto` and `pos.0012_order_return_events_order_returned_amount`. The backend startup script runs migrations before Gunicorn starts.
5. Confirm the private `payment-proofs` bucket exists and the backend service has the correct project URL and server key. Upload a small proof through a customer booking, then retrieve it through the authenticated receipt endpoint. Supabase keeps the object outside Render's ephemeral filesystem, so it remains available after a Render restart or deploy.

Receipt uploads retry transient Supabase timeouts and server errors once using the same unique object path. If both attempts fail, the payment row is not created and its status is not advanced; the existing booking remains available for another payment submission. A replay after an ambiguous timeout is safe because the upload uses an upsert on that unique path.

The payment proof endpoint is `GET /api/bookings/payments/<id>/receipt/`. Customers can retrieve proofs only for their own booking; staff and admins can retrieve proofs for verification. Photos are assigned to a booking by staff through `POST /api/gallery/customer-photos/`, and the customer can list and download only photos attached to their own bookings through `/api/gallery/customer-photos/`.

Use the admin or staff Customer Photos tab to deliver photos. Uploaded photo files are kept in the private customer photos bucket, so they remain available after backend redeploys. Requests that fail storage operations return an actionable API error and create an admin-visible audit record.
