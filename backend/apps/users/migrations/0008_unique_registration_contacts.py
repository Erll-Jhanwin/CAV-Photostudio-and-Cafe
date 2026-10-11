from django.db import migrations, models
from django.db.models import Q
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    dependencies = [
        ('users', '0007_passwordresetotp_phone_number'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='customuser',
            constraint=models.UniqueConstraint(
                Lower('email'),
                condition=~Q(email=''),
                name='users_customuser_email_unique_nonblank',
            ),
        ),
        migrations.AddConstraint(
            model_name='customuser',
            constraint=models.UniqueConstraint(
                Lower('phone_number'),
                condition=~Q(phone_number=''),
                name='users_customuser_phone_unique_nonblank',
            ),
        ),
        migrations.AddConstraint(
            model_name='customuser',
            constraint=models.UniqueConstraint(
                Lower('username'),
                name='users_customuser_username_ci_unique',
            ),
        ),
    ]
