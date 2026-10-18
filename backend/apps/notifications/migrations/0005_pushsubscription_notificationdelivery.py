from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('notifications', '0004_notification_booking_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='PushSubscription',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('endpoint', models.URLField(max_length=2048)),
                ('p256dh', models.CharField(max_length=255)),
                ('auth', models.CharField(max_length=255)),
                ('user_agent', models.TextField(blank=True, default='')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='push_subscriptions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at', '-id'],
            },
        ),
        migrations.CreateModel(
            name='NotificationDelivery',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel', models.CharField(choices=[('email', 'Email'), ('sms', 'SMS'), ('push', 'Push notification')], max_length=20)),
                ('status', models.CharField(choices=[('queued', 'Queued'), ('sent', 'Sent'), ('failed', 'Failed'), ('skipped', 'Skipped')], default='queued', max_length=20)),
                ('provider', models.CharField(blank=True, default='', max_length=40)),
                ('provider_message_id', models.CharField(blank=True, default='', max_length=255)),
                ('error_code', models.CharField(blank=True, default='', max_length=80)),
                ('error_message', models.TextField(blank=True, default='')),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('attempt_count', models.PositiveIntegerField(default=1)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('notification', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='deliveries', to='notifications.notification')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='notification_deliveries', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.AddConstraint(
            model_name='pushsubscription',
            constraint=models.UniqueConstraint(fields=('user', 'endpoint'), name='notifications_push_user_endpoint_unique'),
        ),
        migrations.AddIndex(
            model_name='pushsubscription',
            index=models.Index(fields=['user', 'is_active'], name='notif_push_user_active_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationdelivery',
            index=models.Index(fields=['channel', 'status', '-created_at'], name='notificatio_deliv_status_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationdelivery',
            index=models.Index(fields=['user', '-created_at'], name='notificatio_deliv_user_idx'),
        ),
    ]
