from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('audit', '0004_prevent_audit_log_delete')]

    operations = [
        migrations.AddField('auditlog', 'actor_name', models.CharField(blank=True, default='', max_length=255)),
        migrations.AddField('auditlog', 'actor_role', models.CharField(blank=True, default='', max_length=20)),
        migrations.AddField('auditlog', 'actor_user_id', models.PositiveBigIntegerField(blank=True, db_index=True, null=True)),
        migrations.AddField('auditlog', 'module', models.CharField(blank=True, db_index=True, default='', max_length=80)),
        migrations.AddField('auditlog', 'record_reference', models.CharField(blank=True, default='', max_length=160)),
    ]
