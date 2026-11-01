from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0010_staffaccessprofile'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='staffaccessprofile',
            name='allowed_tabs',
        ),
        migrations.RemoveField(
            model_name='staffaccessprofile',
            name='allowed_actions',
        ),
    ]
