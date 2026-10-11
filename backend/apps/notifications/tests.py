from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from notifications.models import Notification
from payment.models import Payment


class BookingNotificationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.customer = user_model.objects.create_user(
            username='notification-customer',
            email='notification-customer@example.com',
            password='Customer123!',
        )
        self.other_customer = user_model.objects.create_user(
            username='other-notification-customer',
            email='other-notification-customer@example.com',
            password='Customer123!',
        )
        self.staff = user_model.objects.create_user(
            username='notification-staff',
            email='notification-staff@example.com',
            password='Staff123!',
            role='STAFF',
        )
        service = Service.objects.create(
            name='Notification Studio',
            description='Studio sessions',
            duration_minutes=60,
            base_price='1000.00',
        )
        package = Package.objects.create(
            service=service,
            name='Notification Package',
            description='Studio shoot',
            price='1000.00',
            inclusions='Studio session',
        )
        self.booking = Booking.objects.create(
            customer=self.customer,
            package=package,
            scheduled_date=timezone.localdate() + timedelta(days=14),
            scheduled_time='09:00',
        )
        self.client = APIClient()

    def test_staff_confirmation_notifies_booking_owner_only(self):
        self.client.force_authenticate(self.staff)

        response = self.client.patch(
            f'/api/bookings/{self.booking.id}/',
            {'status': 'CONFIRMED'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        notification = Notification.objects.get()
        self.assertEqual(notification.user_id, self.customer.id)
        self.assertEqual(notification.booking_id, self.booking.id)
        self.assertEqual(notification.notification_type, 'BOOKING_CONFIRMED')

        self.client.force_authenticate(self.other_customer)
        self.assertEqual(self.client.get('/api/notifications/').data, [])

        self.client.force_authenticate(self.customer)
        response = self.client.get('/api/notifications/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['is_read'], False)

        response = self.client.patch(f'/api/notifications/{notification.id}/read/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['is_read'])

    def test_approved_payment_notifies_customer_and_confirms_down_payment(self):
        payment = Payment.objects.create(
            payment_type=Payment.BOOKING,
            booking=self.booking,
            amount='500.00',
            reference_number='NOTIFY-12345',
            status='PENDING_VERIFICATION',
        )
        self.client.force_authenticate(self.staff)

        response = self.client.patch(
            f'/api/bookings/payments/{payment.id}/verify/',
            {'status': 'APPROVED'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'CONFIRMED_DP')
        notification = Notification.objects.get()
        self.assertEqual(notification.user_id, self.customer.id)
        self.assertEqual(notification.notification_type, 'BOOKING_PAYMENT_APPROVED')
