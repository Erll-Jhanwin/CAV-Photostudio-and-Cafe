from django.db import migrations, models


def copy_order_total_to_subtotal(apps, schema_editor):
    Order = apps.get_model('pos', 'Order')
    Order.objects.filter(subtotal=0).update(subtotal=models.F('total'))


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0005_zreport_cash_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='subtotal',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=10),
        ),
        migrations.AddField(
            model_name='order',
            name='discount_type',
            field=models.CharField(choices=[('FIXED', 'Fixed Amount'), ('PERCENT', 'Percentage')], default='FIXED', max_length=10),
        ),
        migrations.AddField(
            model_name='order',
            name='discount_value',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=10),
        ),
        migrations.AddField(
            model_name='order',
            name='discount_amount',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=10),
        ),
        migrations.RunPython(copy_order_total_to_subtotal, migrations.RunPython.noop),
    ]
