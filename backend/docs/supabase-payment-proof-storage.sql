-- Create payment-proofs and customer-photos as private buckets in the
-- Supabase Dashboard (Storage > New Bucket). This script intentionally avoids
-- direct writes to storage.buckets, which is managed by the Storage service.
-- Run in the Supabase SQL editor for the existing project after bucket setup.

-- Prevent anon/authenticated users from reaching this bucket even if another
-- permissive policy is later added for a different bucket. The Django backend
-- uses the server-only service role key and enforces booking ownership/RBAC.
drop policy if exists "payment_proofs_block_client_roles" on storage.objects;
create policy "payment_proofs_block_client_roles"
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id not in ('payment-proofs', 'customer-photos'))
with check (bucket_id not in ('payment-proofs', 'customer-photos'));
