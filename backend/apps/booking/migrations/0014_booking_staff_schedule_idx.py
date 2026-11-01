from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('booking', '0013_booking_customer_recent_idx'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='booking',
            index=models.Index(
                fields=['scheduled_date', 'scheduled_time', 'id'],
                name='booking_staff_schedule_idx',
            ),
        ),
    ]
