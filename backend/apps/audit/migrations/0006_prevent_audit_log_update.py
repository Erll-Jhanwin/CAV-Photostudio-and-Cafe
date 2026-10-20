from django.db import migrations


def install_audit_log_update_guard(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
        CREATE OR REPLACE FUNCTION prevent_audit_log_update() RETURNS trigger AS $$
        BEGIN
            IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
               AND NEW.action IS NOT DISTINCT FROM OLD.action
               AND NEW.description IS NOT DISTINCT FROM OLD.description
               AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
               AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
               AND NEW.timestamp IS NOT DISTINCT FROM OLD.timestamp
               AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name
               AND NEW.actor_role IS NOT DISTINCT FROM OLD.actor_role
               AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
               AND NEW.module IS NOT DISTINCT FROM OLD.module
               AND NEW.record_reference IS NOT DISTINCT FROM OLD.record_reference THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'Audit logs are immutable and cannot be updated';
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS audit_log_no_update ON audit_auditlog;
        CREATE TRIGGER audit_log_no_update
        BEFORE UPDATE ON audit_auditlog
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_update();
    """)


def remove_audit_log_update_guard(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
        DROP TRIGGER IF EXISTS audit_log_no_update ON audit_auditlog;
        DROP FUNCTION IF EXISTS prevent_audit_log_update();
    """)


class Migration(migrations.Migration):
    dependencies = [('audit', '0005_auditlog_actor_context')]
    operations = [migrations.RunPython(install_audit_log_update_guard, remove_audit_log_update_guard)]
