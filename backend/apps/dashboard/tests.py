from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from payment.models import Payment
from pos.models import Order


class DashboardAnalyticsTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username='dashboard-admin',
            email='dashboard-admin@example.com',
            password='Admin123!',
            role='ADMIN',
        )
        self.staff = get_user_model().objects.create_user(
            username='dashboard-staff',
            email='dashboard-staff@example.com',
            password='Staff123!',
            role='STAFF',
        )
        self.customer = get_user_model().objects.create_user(
            username='dashboard-customer',
            email='dashboard-customer@example.com',
            password='Customer123!',
        )
        service = Service.objects.create(
            name='Dashboard Studio Session',
            description='Studio session',
            duration_minutes=60,
            base_price='1000.00',
        )
        self.package = Package.objects.create(
            service=service,
            name='Dashboard Package',
            description='Package used by dashboard tests',
            price='1000.00',
            inclusions='Studio session',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_analytics_access_matches_staff_and_admin_roles(self):
        for user, expected_status in [
            (self.admin, 200),
            (self.staff, 200),
            (self.customer, 403),
        ]:
            with self.subTest(role=user.role):
                self.client.force_authenticate(user)
                response = self.client.get('/api/dashboard/analytics/')
                self.assertEqual(response.status_code, expected_status)

    def test_recent_bookings_are_not_limited_by_the_reporting_range(self):
        booking = Booking.objects.create(
            customer=self.customer,
            package=self.package,
            scheduled_date=timezone.localdate() + timedelta(days=14),
            scheduled_time='09:00',
            status='PENDING',
        )
        past_day = timezone.localdate() - timedelta(days=7)

        response = self.client.get('/api/dashboard/analytics/', {
            'start': past_day.isoformat(),
            'end': (past_day + timedelta(days=1)).isoformat(),
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['metrics']['total_bookings'], 0)
        self.assertEqual([row['id'] for row in response.data['recent_bookings']], [booking.id])

    def test_recent_walk_in_bookings_without_customers_are_serialized_safely(self):
        named_walk_in = Booking.objects.create(
            customer=None,
            is_walk_in=True,
            contact_name='Walk-in Guest',
            package=self.package,
            scheduled_date=timezone.localdate() + timedelta(days=4),
            scheduled_time='11:00',
            status='PENDING',
        )
        unnamed_walk_in = Booking.objects.create(
            customer=None,
            is_walk_in=True,
            contact_name='',
            package=self.package,
            scheduled_date=timezone.localdate() + timedelta(days=5),
            scheduled_time='12:00',
            status='PENDING',
        )

        response = self.client.get('/api/dashboard/analytics/')

        self.assertEqual(response.status_code, 200)
        recent_bookings = {row['id']: row for row in response.data['recent_bookings']}
        self.assertEqual(recent_bookings[named_walk_in.id]['customer_name'], 'Walk-in Guest')
        self.assertEqual(recent_bookings[named_walk_in.id]['customer_profile_picture_url'], '')
        self.assertEqual(recent_bookings[unnamed_walk_in.id]['customer_name'], 'Walk-in customer')
        self.assertEqual(recent_bookings[unnamed_walk_in.id]['customer_profile_picture_url'], '')

    def test_approved_booking_payment_is_included_in_booking_income(self):
        booking = Booking.objects.create(
            customer=self.customer,
            package=self.package,
            scheduled_date=timezone.localdate() + timedelta(days=7),
            scheduled_time='10:00',
            status='CONFIRMED_DP',
        )
        Payment.objects.create(
            payment_type=Payment.BOOKING,
            booking=booking,
            amount='500.00',
            method='GCASH',
            status='APPROVED',
            paid_at=timezone.now(),
        )

        today = timezone.localdate().isoformat()
        response = self.client.get('/api/dashboard/analytics/', {'start': today, 'end': today})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['metrics']['booking_revenue'], 500.0)
        self.assertEqual(response.data['metrics']['booking_payment_revenue'], 500.0)
        self.assertEqual(response.data['metrics']['total_revenue'], 500.0)
        self.assertEqual(response.data['sales_history_chart'][0]['booking_revenue'], 500.0)

    def test_analytics_query_count_stays_bounded_as_sales_and_bookings_grow(self):
        today = timezone.localdate()

        def request_and_count_queries():
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get('/api/dashboard/analytics/', {
                    'start': today.isoformat(),
                    'end': (today + timedelta(days=30)).isoformat(),
                })
            self.assertEqual(response.status_code, 200)
            return len(queries)

        Order.objects.create(
            staff=self.admin,
            order_type='WALK_IN',
            payment_status='PAID',
            subtotal='10.00',
            total='10.00',
            line_items=[{'quantity': 1, 'subtotal': '10.00', 'product_details': {'name': 'Test item'}}],
        )
        Booking.objects.create(
            customer=self.customer,
            package=self.package,
            scheduled_date=today,
            scheduled_time='09:00',
            status='PENDING',
        )
        small_dataset_queries = request_and_count_queries()

        for index in range(20):
            Order.objects.create(
                staff=self.admin,
                order_type='WALK_IN',
                payment_status='PAID',
                subtotal='10.00',
                total='10.00',
                line_items=[{'quantity': 2, 'subtotal': '10.00', 'product_details': {'name': f'Test item {index}'}}],
            )
            Booking.objects.create(
                customer=self.customer,
                package=self.package,
                scheduled_date=today + timedelta(days=index + 1),
                scheduled_time=f'{index + 1:02}:00',
                status='PENDING',
            )

        large_dataset_queries = request_and_count_queries()
        self.assertEqual(large_dataset_queries, small_dataset_queries)
