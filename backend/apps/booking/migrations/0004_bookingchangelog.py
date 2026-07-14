# Generated for customer booking edit history.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booking', '0003_alter_booking_status_bookingpayment'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BookingChangeLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('old_values', models.JSONField(default=dict)),
                ('new_values', models.JSONField(default=dict)),
                ('reason', models.CharField(blank=True, max_length=220)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('booking', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='change_history', to='booking.booking')),
                ('changed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='booking_changes', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
