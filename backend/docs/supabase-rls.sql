-- Staging-first baseline for Django-only access to application tables.
-- Review the generated audit queries and test every role in staging before
-- applying this to production. Do not execute it from a browser client.
--
-- Preconditions:
--   * Create cav_backend as a non-owner, non-superuser, non-BYPASSRLS role.
--   * Use a separate owner/migration credential for schema migrations.
--   * Keep Supabase service-role credentials server-only; they are not the
--     PostgreSQL connection role configured for Django.
--
-- The API performs row ownership and role authorization. This policy lets
-- only cav_backend reach these tables; anon/authenticated clients receive no
-- schema/table privileges. It intentionally does not encode customer rules
-- in PostgreSQL because application access is mediated by Django.

DO $$
DECLARE
    backend_role oid;
    relation record;
BEGIN
    SELECT oid INTO backend_role
    FROM pg_roles
    WHERE rolname = 'cav_backend';

    IF backend_role IS NULL THEN
        RAISE EXCEPTION 'Create the restricted cav_backend role before applying this policy.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE oid = backend_role AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'cav_backend must not be superuser, BYPASSRLS, REPLICATION, CREATE ROLE, or CREATE DATABASE.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relowner = backend_role
    ) THEN
        RAISE EXCEPTION 'cav_backend owns public tables; transfer ownership to a separate migration role first.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_auth_members
        WHERE member = backend_role OR roleid = backend_role
    ) THEN
        RAISE EXCEPTION 'Review and remove cav_backend role memberships before applying least-privilege grants.';
    END IF;

    REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO cav_backend;

    FOR relation IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> 'spatial_ref_sys'
        ORDER BY c.relname
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
            relation.relname
        );
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO cav_backend',
            relation.relname
        );
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation.relname);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation.relname);
        EXECUTE format('DROP POLICY IF EXISTS cav_backend_full_access ON public.%I', relation.relname);
        EXECUTE format(
            'CREATE POLICY cav_backend_full_access ON public.%I FOR ALL TO cav_backend USING (true) WITH CHECK (true)',
            relation.relname
        );
    END LOOP;

    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO cav_backend;
END $$;

-- Review every public table, owner and RLS state. Any exposed table with
-- relrowsecurity=false, or no cav_backend_full_access policy, needs attention.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'cav_backend', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN ('cav_backend', 'anon', 'authenticated', 'service_role');

SELECT member_role.rolname AS member, granted_role.rolname AS inherited_role
FROM pg_auth_members m
JOIN pg_roles member_role ON member_role.oid = m.member
JOIN pg_roles granted_role ON granted_role.oid = m.roleid
WHERE member_role.rolname = 'cav_backend';

-- Storage buckets must be private. Confirm policies on objects and bucket ACLs.
SELECT id, name, public
FROM storage.buckets
WHERE name IN ('payment-proofs', 'customer-photos');

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
