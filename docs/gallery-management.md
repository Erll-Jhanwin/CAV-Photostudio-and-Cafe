# Gallery management

The public gallery is stored in the Django `gallery_galleryimage` table. Admins
and staff manage records from their dashboard's **Photo Gallery** tab. Uploads
must be real JPG, PNG, or WEBP images, no larger than 5 MB or 25 megapixels.
Uploads are renamed to UUID paths, and only featured records with an image source
appear publicly. Customers can list featured records but cannot create, edit, or
delete them.

## Storage setup

Local development uses Django file storage under `MEDIA_ROOT`. Production
defaults to `GALLERY_STORAGE_BACKEND=supabase`, using the server-only
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values. Set
`SUPABASE_GALLERY_BUCKET` to a Supabase Storage bucket configured as public.
Public access is needed so gallery image URLs can be rendered on the landing
page; uploads and deletes still use the backend service-role credential. Never
put that credential in frontend configuration.

`backend/.env.example` lists the gallery settings. The service-role key and
bucket policy are deployment secrets/configuration and must be verified in the
hosting provider. This repository does not provision the bucket or backend
deployment. Keep `MEDIA_ROOT` on persistent storage when explicitly choosing
`GALLERY_STORAGE_BACKEND=local` in a deployed environment.

## Archived gallery records

Migration `0003_initial` restores metadata archived by the prior gallery-removal
migration. Restored records remain hidden until an image is available. Existing
static API entries are also copied into the table so current public endpoints
retain those records. The frontend continues to include its bundled curated
samples as a fallback if the API is unavailable.
