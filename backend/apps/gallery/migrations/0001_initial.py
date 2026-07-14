# Generated for gallery landing page support.

from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='GalleryImage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=160)),
                ('category', models.CharField(choices=[('STUDIO', 'Studio'), ('CAFE', 'Café'), ('EVENTS', 'Events'), ('BEHIND_THE_SCENES', 'Behind the Scenes')], default='STUDIO', max_length=24)),
                ('image', models.FileField(upload_to='gallery/')),
                ('alt_text', models.CharField(blank=True, max_length=220)),
                ('caption', models.TextField(blank=True)),
                ('is_featured', models.BooleanField(default=True)),
                ('sort_order', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Gallery image',
                'verbose_name_plural': 'Gallery images',
                'ordering': ['sort_order', '-created_at'],
            },
        ),
    ]
