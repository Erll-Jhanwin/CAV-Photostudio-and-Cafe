from django.conf import settings
from django.db import migrations, models
from django.db.models.deletion import CASCADE


class Migration(migrations.Migration):
    dependencies = [
        ('users', '0008_unique_registration_contacts'),
    ]

    operations = [
        migrations.CreateModel(
            name='PrivacyConsent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('consent_type', models.CharField(choices=[('PRIVACY_NOTICE', 'Privacy notice'), ('SERVICE_PROCESSING', 'Service processing'), ('MARKETING', 'Marketing communications')], max_length=40)),
                ('policy_version', models.CharField(max_length=30)),
                ('granted_at', models.DateTimeField(auto_now_add=True)),
                ('withdrawn_at', models.DateTimeField(blank=True, null=True)),
                ('source', models.CharField(default='web', max_length=40)),
                ('user', models.ForeignKey(on_delete=CASCADE, related_name='privacy_consents', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-granted_at']},
        ),
        migrations.CreateModel(
            name='PrivacyRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('request_type', models.CharField(choices=[('ACCESS', 'Access'), ('CORRECTION', 'Correction'), ('DELETION', 'Deletion'), ('OBJECTION', 'Objection'), ('EXPORT', 'Data export')], max_length=20)),
                ('details', models.TextField(blank=True)),
                ('status', models.CharField(choices=[('OPEN', 'Open'), ('IN_PROGRESS', 'In progress'), ('COMPLETED', 'Completed'), ('REJECTED', 'Rejected')], default='OPEN', max_length=20)),
                ('response_notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=CASCADE, related_name='privacy_requests', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='privacyconsent',
            constraint=models.UniqueConstraint(fields=('user', 'consent_type', 'policy_version'), name='privacy_consent_version_unique'),
        ),
    ]
