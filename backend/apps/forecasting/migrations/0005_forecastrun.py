from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('forecasting', '0004_saleshistoryimport_saleshistoryrecord')]
    operations = [
        migrations.CreateModel(
            name='ForecastRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('model_version', models.CharField(default='least-squares-linear-v1', max_length=40)),
                ('generated_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('horizon_days', models.PositiveSmallIntegerField(default=7)),
                ('training_start', models.DateField(blank=True, null=True)),
                ('training_end', models.DateField(blank=True, null=True)),
                ('test_start', models.DateField(blank=True, null=True)),
                ('test_end', models.DateField(blank=True, null=True)),
                ('data_status', models.CharField(default='insufficient_history', max_length=32)),
                ('predictions', models.JSONField(blank=True, default=dict)),
                ('evaluation', models.JSONField(blank=True, default=dict)),
                ('recommendations', models.JSONField(blank=True, default=list)),
            ],
            options={'ordering': ['-generated_at']},
        ),
    ]
