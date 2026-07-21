from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('pos', '0008_compact_pos_tables'),
    ]

    operations = [
        migrations.RunSQL(
            sql='ALTER TABLE pos_order DROP COLUMN IF EXISTS items',
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
