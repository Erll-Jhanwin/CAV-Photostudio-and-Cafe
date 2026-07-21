from django.db import migrations


def drop_legacy_items_column(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('ALTER TABLE pos_order DROP COLUMN IF EXISTS items')


class Migration(migrations.Migration):
    dependencies = [
        ('pos', '0008_compact_pos_tables'),
    ]

    operations = [
        migrations.RunPython(drop_legacy_items_column, migrations.RunPython.noop),
    ]
