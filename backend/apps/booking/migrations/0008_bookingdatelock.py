from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booking', '0007_studiounavailabledate'),
    ]

    operations = [
        migrations.CreateModel(
            name='BookingDateLock',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scheduled_date', models.DateField(unique=True)),
            ],
        ),
    ]
