from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('booking', '0012_alter_bookingreview_customer_bookingemail'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='booking',
            index=models.Index(
                fields=['customer', '-scheduled_date', '-created_at', '-id'],
                name='booking_customer_recent_idx',
            ),
        ),
    ]
