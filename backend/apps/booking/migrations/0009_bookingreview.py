from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('booking', '0008_bookingdatelock'),
    ]

    operations = [
        migrations.CreateModel(
            name='BookingReview',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rating', models.PositiveSmallIntegerField()),
                ('feedback', models.TextField(blank=True)),
                ('suggestions', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('booking', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='review', to='booking.booking')),
                ('customer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='booking_reviews', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at', '-id'],
                'constraints': [
                    models.CheckConstraint(condition=models.Q(('rating__gte', 1), ('rating__lte', 5)), name='booking_review_rating_1_to_5'),
                    models.UniqueConstraint(fields=('booking', 'customer'), name='booking_review_booking_customer_unique'),
                ],
            },
        ),
    ]
