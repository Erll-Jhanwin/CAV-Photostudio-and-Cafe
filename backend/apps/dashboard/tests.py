from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from payment.models import Payment


class DashboardAnalyticsTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username='dashboard-admin',
            email='dashboard-admin@example.com',
            password='Admin123!',
            role='ADMIN',
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
