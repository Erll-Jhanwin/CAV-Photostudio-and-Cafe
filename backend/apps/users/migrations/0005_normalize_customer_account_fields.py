from django.db import migrations, models


def normalize_customer_accounts(apps, schema_editor):
    User = apps.get_model('users', 'CustomUser')
    Customer = apps.get_model('users', 'Customer')

    User.objects.filter(phone_number__isnull=True).update(phone_number='')
    User.objects.filter(address__isnull=True).update(address='')

    for user_id in User.objects.filter(role='CUSTOMER').values_list('id', flat=True).iterator():
        Customer.objects.get_or_create(user_id=user_id)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0004_customuser_profile_picture_external_url'),
    ]

    operations = [
        migrations.RunPython(normalize_customer_accounts, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='customuser',
            name='phone_number',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='address',
            field=models.TextField(blank=True, default=''),
        ),
    ]
