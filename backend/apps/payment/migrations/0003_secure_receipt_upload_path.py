import users.uploads
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payment', '0002_payment_uniqueness_idempotency'),
    ]

    operations = [
        migrations.AlterField(
            model_name='payment',
            name='receipt',
            field=models.FileField(blank=True, null=True, upload_to=users.uploads.receipt_upload_path),
        ),
    ]
