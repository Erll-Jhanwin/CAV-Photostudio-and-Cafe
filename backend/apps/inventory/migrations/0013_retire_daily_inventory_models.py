from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('inventory', '0012_dailyproductbalance_corrected_ending_quantity_and_more'),
    ]

    # Retire the reconciliation ORM state without dropping its tables. This
    # preserves any reports, counts, losses, and corrections already recorded.
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.DeleteModel(name='InventoryCorrection'),
                migrations.DeleteModel(name='ProductLossEvent'),
                migrations.DeleteModel(name='DailyProductBalance'),
                migrations.DeleteModel(name='BusinessDay'),
            ],
        ),
    ]
