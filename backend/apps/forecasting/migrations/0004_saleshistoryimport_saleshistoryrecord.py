from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ('forecasting', '0003_alter_demandprediction_unique_together_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='SalesHistoryImport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source_name', models.CharField(default='cafe_sparkling_drinks', max_length=120)),
                ('source_filename', models.CharField(max_length=255)),
                ('source_hash', models.CharField(max_length=64, unique=True)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('READY', 'Ready'), ('FAILED', 'Failed')], default='PENDING', max_length=16)),
                ('is_active', models.BooleanField(default=False)),
                ('row_count', models.PositiveIntegerField(default=0)),
                ('imported_row_count', models.PositiveIntegerField(default=0)),
                ('skipped_row_count', models.PositiveIntegerField(default=0)),
                ('history_start', models.DateField(blank=True, null=True)),
                ('history_end', models.DateField(blank=True, null=True)),
                ('error_message', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={
                'indexes': [
                    models.Index(fields=['source_name', 'is_active'], name='forecasting_source__09352b_idx'),
                    models.Index(fields=['status', 'created_at'], name='forecasting_status_8f9ffb_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(condition=Q(('is_active', True)), fields=('source_name',), name='forecasting_one_active_sales_import_per_source'),
                ],
            },
        ),
        migrations.CreateModel(
            name='SalesHistoryRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source_row_number', models.PositiveIntegerField()),
                ('transaction_number', models.CharField(blank=True, max_length=120)),
                ('status', models.CharField(blank=True, max_length=40)),
                ('sold_at', models.DateTimeField()),
                ('sale_date', models.DateField(db_index=True)),
                ('quantity', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('total_amount', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('items_description', models.TextField(blank=True)),
                ('import_batch', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='records', to='forecasting.saleshistoryimport')),
            ],
            options={
                'ordering': ['sale_date', 'source_row_number'],
                'indexes': [
                    models.Index(fields=['import_batch', 'sale_date'], name='forecasting_import__219ce0_idx'),
                    models.Index(fields=['transaction_number'], name='forecasting_transac_dd6166_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(fields=('import_batch', 'source_row_number'), name='forecasting_unique_sales_source_row'),
                ],
            },
        ),
    ]
