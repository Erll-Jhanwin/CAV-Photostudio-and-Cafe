from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('forecasting', '0005_forecastrun')]

    operations = [
        migrations.AddField(
            model_name='saleshistoryimport',
            name='quality_report',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
