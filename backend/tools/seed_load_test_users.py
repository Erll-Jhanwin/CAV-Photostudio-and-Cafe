"""Create distinct, synthetic, read-only load-test identities in an isolated DB."""

import json
import os
import sys
from datetime import time, timedelta
from pathlib import Path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.test_settings')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import django

django.setup()

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.db import connection, transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from booking.models import Booking, Package, Service
from notifications.models import Notification
from payment.models import Payment
from pos.models import Order
from users.models import StaffAccessProfile


if os.environ.get('DJANGO_SETTINGS_MODULE') != 'config.test_settings':
    raise SystemExit('Refusing to seed users unless config.test_settings is active.')
if connection.vendor != 'sqlite' or 'perf_load' not in str(connection.settings_dict['NAME']).lower():
    raise SystemExit('Refusing to seed users unless an isolated perf_load SQLite database is active.')

count = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'tmp/load-test-users.json')
role = (sys.argv[3] if len(sys.argv) > 3 else 'CUSTOMER').upper()
if role not in {'CUSTOMER', 'STAFF'}:
    raise SystemExit('Synthetic load-test role must be CUSTOMER or STAFF.')
fixture_rows = max(0, int(os.environ.get('LOAD_TEST_FIXTURE_ROWS', '0')))
User = get_user_model()
prefix = 'perfload'

if User.objects.filter(username__startswith=prefix).exists():
    raise SystemExit('Synthetic perfload users already exist in this database; use a fresh perf_load database.')

encoded_password = make_password('LoadOnly-NotARealCredential-2026')
with transaction.atomic():
    created = User.objects.bulk_create([
        User(
            username=f'{prefix}{index:04d}',
            email=f'{prefix}{index:04d}@example.invalid',
            password=encoded_password,
            role=role,
            is_active=True,
        )
        for index in range(count)
    ], batch_size=500)
    if role == 'STAFF':
        StaffAccessProfile.objects.bulk_create([
            StaffAccessProfile(user=user, on_duty=True) for user in created
        ], batch_size=500)

    Notification.objects.bulk_create([
        Notification(
            user=user,
            notification_type='LOAD_TEST',
            title='Synthetic load test',
            message='Synthetic data for isolated performance testing.',
            event_key=f'perfload-notification-{user.pk}',
        )
        for user in created
    ], batch_size=500)

    if fixture_rows:
        service = Service.objects.create(
            name='Synthetic Load Test Service',
            description='Isolated synthetic fixture.',
            duration_minutes=30,
            base_price='100.00',
        )
        package = Package.objects.create(
            service=service,
            name='Synthetic Load Test Package',
            description='Isolated synthetic fixture.',
            price='100.00',
            inclusions='Synthetic fixture',
        )
        now = timezone.now()
        bookings = Booking.objects.bulk_create([
            Booking(
                customer=created[index % len(created)],
                package=package,
                scheduled_date=(now.date() - timedelta(days=index % 365)),
                scheduled_time=time((index % 10) + 8),
                status='COMPLETED',
                contact_name=f'Synthetic customer {index % len(created)}',
            )
            for index in range(fixture_rows)
        ], batch_size=500)
        Payment.objects.bulk_create([
            Payment(
                payment_type=Payment.BOOKING,
                booking=booking,
                amount='100.00',
                method='CASH',
                reference_number=f'perfload-ref-{index:08d}',
                status='APPROVED',
                paid_at=now,
            )
            for index, booking in enumerate(bookings)
        ], batch_size=500)
        Order.objects.bulk_create([
            Order(
                staff=created[index % len(created)],
                customer_name=f'Synthetic customer {index % len(created)}',
                subtotal='120.00',
                total='120.00',
                payment_status='PAID',
                order_type='WALK_IN',
                line_items=[{
                    'quantity': 2,
                    'returned_quantity': 0,
                    'subtotal': '120.00',
                    'product_details': {'name': 'Synthetic beverage'},
                }],
            )
            for index in range(fixture_rows)
        ], batch_size=500)

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps([
    {'token': str(AccessToken.for_user(user)), 'role': role}
    for user in created
]), encoding='utf-8')
print(f'Created {len(created)} synthetic {role} users and {fixture_rows} booking/payment/order fixtures; wrote distinct access tokens to {output}.')
