from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0009_drop_legacy_items_column'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='idempotency_key',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.UniqueConstraint(
                condition=models.Q(idempotency_key__isnull=False) & ~models.Q(idempotency_key=''),
                fields=('staff', 'idempotency_key'),
                name='pos_order_staff_idempotency_unique',
            ),
        ),
    ]
