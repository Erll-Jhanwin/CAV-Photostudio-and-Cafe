from django.db import migrations, models, transaction
from django.utils import timezone


def transaction_id_for(sequence_date, number):
    return f"TXN-{sequence_date.strftime('%Y%m%d')}-{number:06d}"


def populate_existing_transaction_ids(apps, schema_editor):
    Order = apps.get_model('pos', 'Order')
    TransactionSequence = apps.get_model('pos', 'TransactionSequence')

    paid_orders = (
        Order.objects
        .filter(payment_status='PAID', transaction_id__isnull=True)
        .order_by('created_at', 'id')
    )
    next_numbers_by_date = {}

    with transaction.atomic():
        for order in paid_orders:
            completed_at = order.completed_at or order.created_at or timezone.now()
            local_completed_at = timezone.localtime(completed_at)
            sequence_date = local_completed_at.date()
            next_number = next_numbers_by_date.get(sequence_date, 1)
            order.transaction_id = transaction_id_for(sequence_date, next_number)
            order.completed_at = completed_at
            order.save(update_fields=['transaction_id', 'completed_at'])
            next_numbers_by_date[sequence_date] = next_number + 1

        for sequence_date, next_number in next_numbers_by_date.items():
            TransactionSequence.objects.update_or_create(
                sequence_date=sequence_date,
                defaults={'next_number': next_number},
            )


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0006_order_discount_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='TransactionSequence',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sequence_date', models.DateField(unique=True)),
                ('next_number', models.PositiveIntegerField(default=1)),
            ],
            options={
                'ordering': ['-sequence_date'],
            },
        ),
        migrations.AddField(
            model_name='order',
            name='transaction_id',
            field=models.CharField(blank=True, editable=False, max_length=24, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='order',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(populate_existing_transaction_ids, migrations.RunPython.noop),
    ]
