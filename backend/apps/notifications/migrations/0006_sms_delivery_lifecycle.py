from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('notifications', '0005_pushsubscription_notificationdelivery')]

    operations = [
        migrations.AddField('notification', 'event_key', models.CharField(blank=True, max_length=180, null=True, unique=True)),
        migrations.AddField('notificationdelivery', 'delivered_at', models.DateTimeField(blank=True, null=True)),
        migrations.AddField('notificationdelivery', 'next_retry_at', models.DateTimeField(blank=True, db_index=True, null=True)),
        migrations.AddField('notificationdelivery', 'last_checked_at', models.DateTimeField(blank=True, null=True)),
        migrations.AlterField('notificationdelivery', 'status', models.CharField(default='queued', max_length=20, choices=[
            ('queued', 'Queued'), ('sent', 'Sent'), ('failed', 'Failed'), ('skipped', 'Skipped'),
            ('sending', 'Submission in progress'), ('accepted', 'Accepted by provider; delivery unconfirmed'),
            ('delivered', 'Provider reports delivered'), ('unknown', 'Submission outcome unknown; do not resend'),
        ])),
    ]
