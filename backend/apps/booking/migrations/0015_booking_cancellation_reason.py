from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booking', '0014_booking_staff_schedule_idx'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='cancellation_reason',
            field=models.TextField(blank=True, default=''),
        ),
    ]
