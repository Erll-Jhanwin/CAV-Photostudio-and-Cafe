from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('booking', '0015_booking_cancellation_reason'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BookingMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('message', models.TextField(max_length=4000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('author', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='booking_conversation_messages', to=settings.AUTH_USER_MODEL)),
                ('booking', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='conversation_messages', to='booking.booking')),
            ],
            options={
                'ordering': ['created_at', 'id'],
            },
        ),
        migrations.AddIndex(
            model_name='bookingmessage',
            index=models.Index(fields=['booking', 'created_at'], name='booking_message_thread_idx'),
        ),
    ]
