from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0011_remove_staffaccess_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='profile_picture_google_sync_disabled',
            field=models.BooleanField(default=False),
        ),
    ]
