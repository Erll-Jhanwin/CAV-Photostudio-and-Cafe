# Gallery management

The public gallery is stored in the Django `gallery_galleryimage` table. Admins
and staff manage records from their dashboard's **Photo Gallery** tab. Uploads
must be real JPG, PNG, or WEBP images, no larger than 5 MB or 25 megapixels.
Uploads are renamed to UUID paths, and only featured records with an image source
appear publicly. Customers can list featured records but cannot create, edit, or
delete them.

## Storage setup

Local development uses Django file storage under `MEDIA_ROOT`. Production
defaults to `GALLERY_STORAGE_BACKEND=supabase`. In the Render **backend web
service** environment, set `SUPABASE_URL`, a server-only `SUPABASE_SECRET_KEY`
or legacy `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_GALLERY_BUCKET` to the
exact ID of the existing public bucket. Current `sb_secret_...` keys can be configured as
`SUPABASE_SECRET_KEY`; legacy service-role JWT keys remain supported through
`SUPABASE_SERVICE_ROLE_KEY`. Set `SUPABASE_GALLERY_BUCKET` to an existing
Supabase Storage bucket configured as public. Public access lets browsers read
image objects; uploads and deletes still use the backend credential. Do not add
anonymous insert, update, or delete policies to `storage.objects` and never
expose either key in frontend configuration.

Uploads retry transient Supabase errors against the same unique object path, so
a timeout after a successful object write does not leave the gallery save in an
ambiguous state. The catalog is queried through Django's database connection and role-checked
API. The browser never queries the Supabase database directly. Uploads use the
server key, which bypasses Storage RLS; public reads use the bucket's
public-object behavior. Keep catalog mutations behind staff/admin API
permissions.

`backend/.env.example` lists the gallery settings. The server key and bucket
visibility are deployment configuration and must be verified in the backend
host and Supabase project. This repository's Render blueprint does not provision
the backend or bucket. Keep `MEDIA_ROOT` on persistent storage when explicitly
choosing `GALLERY_STORAGE_BACKEND=local` in a deployed environment.

## Archived gallery records

Migration `0003_initial` restores metadata archived by the prior gallery-removal
migration. Restored records remain hidden until an image is available. Existing
static API entries are also copied into the table so current public endpoints
retain those records. The frontend continues to include its bundled curated
samples as a fallback if the API is unavailable.
