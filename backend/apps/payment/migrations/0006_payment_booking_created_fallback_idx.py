from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('payment', '0005_payment_payment_type_status_date_idx'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(
                fields=['created_at'],
                condition=models.Q(
                    ('paid_at__isnull', True),
                    ('payment_type', 'BOOKING'),
                    ('status__in', ['APPROVED', 'PAID']),
                ),
                name='payment_book_created_null_idx',
            ),
        ),
    ]
