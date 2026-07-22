# Security Operations

## Application controls

- Django REST Framework is the only supported data access path. It uses ORM queries, JWT authentication, server-side serializers, object-level booking checks, RBAC, scoped throttles, audit logging, and generic production errors.
- Browser and Capacitor clients must never receive `DATABASE_URL`, Supabase service keys, email credentials, OCR keys, or Django secrets.
- Uploads accept verified JPG, PNG, WEBP, or PDF receipts within the configured size limit. Stored filenames are random UUIDs; never trust a browser filename or content type alone.
- Keep `DJANGO_DEBUG=false` in deployed environments. Set a random `DJANGO_SECRET_KEY`, explicit `DJANGO_ALLOWED_HOSTS`, strict CORS origins, and secure cookie settings in Render.

## Supabase least privilege and RLS

Create a non-owner `cav_backend` PostgreSQL role with only the schema/table/sequence privileges Django needs. Use its connection string as `DATABASE_URL`. Do not use Supabase `anon`, `authenticated`, or `service_role` keys in the frontend.

Review and adapt [supabase-rls.sql](backend/docs/supabase-rls.sql) before applying it. The script enables RLS and grants only the backend role access to the listed application tables. Add every new sensitive table to the script and verify policies with `pg_policies` after migrations.

## Deploy checklist

1. Set production environment variables in Render; never commit real secrets. Rotate the exposed OCR key before redeploying.
2. Apply the RLS script with the actual backend database role and run migrations using that same role.
3. Keep the `render.yaml` security headers enabled. The Google CSP entries are required for Google Identity Services.
4. Review audit logs for account, booking, payment, inventory, POS, and system-reset actions. Export or retain them according to the business retention policy.
5. Run dependency checks regularly: `python -m pip install --upgrade -r backend/requirements.txt` in a staging environment and `npm audit --workspace frontend` before releases.
