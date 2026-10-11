from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('users', '0006_customuser_registration_method'),
    ]

    operations = [
        migrations.AlterField(
            model_name='passwordresetotp',
            name='email',
            field=models.EmailField(blank=True, default='', max_length=254),
        ),
        migrations.AlterField(
            model_name='passwordresetotp',
            name='otp_hash',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='passwordresetotp',
            name='phone_number',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AddIndex(
            model_name='passwordresetotp',
            index=models.Index(fields=['phone_number', 'created_at'], name='users_protp_phone_created_idx'),
        ),
    ]
