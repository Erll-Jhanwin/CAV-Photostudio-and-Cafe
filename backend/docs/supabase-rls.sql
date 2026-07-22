-- Run this in the Supabase SQL editor after replacing cav_backend with the
-- restricted database role used only by Django. Do not expose this role or its
-- connection string to the web or Capacitor application.
--
-- The browser/mobile client must not access these application tables directly.
-- API authorization is performed by Django using short-lived JWTs and RBAC.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'users_customuser', 'users_customer', 'users_passwordresetotp',
        'booking_service', 'booking_package', 'booking_booking',
        'booking_bookingdatelock', 'booking_studiounavailabledate',
        'payment_payment', 'pos_order', 'inventory_product',
        'inventory_inventoryevent', 'audit_auditlog'
    ]
    LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_backend_only', table_name);
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR ALL TO cav_backend USING (true) WITH CHECK (true)',
                table_name || '_backend_only', table_name
            );
        END IF;
    END LOOP;
END $$;

-- Confirm policies before using production traffic:
-- SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public';
