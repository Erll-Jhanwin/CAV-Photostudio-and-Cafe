from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('audit', '0006_prevent_audit_log_update')]
    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='actor_role',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AlterField(
            model_name='auditlog',
            name='timestamp',
            field=models.DateTimeField(auto_now_add=True, db_index=True),
        ),
    ]
