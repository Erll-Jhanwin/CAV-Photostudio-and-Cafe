from django.db import migrations


def install_audit_log_delete_guard(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_audit_log_delete() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'Audit logs are immutable and cannot be deleted';
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_auditlog;
        CREATE TRIGGER audit_log_no_delete
        BEFORE DELETE ON audit_auditlog
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_delete();
        """
    )


def remove_audit_log_delete_guard(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(
        """
        DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_auditlog;
        DROP FUNCTION IF EXISTS prevent_audit_log_delete();
        """
    )


class Migration(migrations.Migration):
    dependencies = [('audit', '0003_auditlog_metadata')]

    operations = [migrations.RunPython(install_audit_log_delete_guard, remove_audit_log_delete_guard)]
