from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('gallery', '0006_customerphoto_attachment_type_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='customerphoto',
            name='original_filename',
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
