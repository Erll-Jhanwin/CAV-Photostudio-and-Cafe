-- Run in the Supabase SQL editor for the existing project.
-- Only configures the private payment-proof bucket; it does not alter app tables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Prevent anon/authenticated users from reaching this bucket even if another
-- permissive policy is later added for a different bucket. The Django backend
-- uses the server-only service role key and enforces booking ownership/RBAC.
drop policy if exists "payment_proofs_block_client_roles" on storage.objects;
create policy "payment_proofs_block_client_roles"
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'payment-proofs')
with check (bucket_id <> 'payment-proofs');
