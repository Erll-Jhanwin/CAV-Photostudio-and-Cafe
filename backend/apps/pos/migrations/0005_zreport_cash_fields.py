from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0004_endofdayreport'),
    ]

    operations = [
        migrations.AddField(
            model_name='endofdayreport',
            name='opening_cash',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='endofdayreport',
            name='gcash_sales',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='endofdayreport',
            name='card_sales',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='endofdayreport',
            name='cash_in_out',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
    ]
