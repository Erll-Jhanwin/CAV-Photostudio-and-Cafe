from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('pos', '0003_alter_payment_method_alter_payment_transaction_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='EndOfDayReport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('report_date', models.DateField()),
                ('opening_time', models.DateTimeField(blank=True, null=True)),
                ('closing_time', models.DateTimeField()),
                ('staff_name', models.CharField(blank=True, max_length=150)),
                ('total_transactions', models.PositiveIntegerField(default=0)),
                ('gross_sales', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('discounts', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('refunds', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('cash_sales', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('other_payment_sales', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('booking_income', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('cafe_pos_income', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('total_items_sold', models.PositiveIntegerField(default=0)),
                ('best_selling_items', models.JSONField(blank=True, default=list)),
                ('cancelled_or_voided_transactions', models.PositiveIntegerField(default=0)),
                ('expected_cash', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('actual_cash', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('cash_difference', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('printed_at', models.DateTimeField(blank=True, null=True)),
                ('print_status', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('closed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='closed_pos_reports', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-report_date', '-created_at'],
            },
        ),
    ]
