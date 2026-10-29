from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from payment.models import Payment


class WalkInBookingApiTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(username='walkin-staff', role='STAFF')
        self.customer = get_user_model().objects.create_user(username='walkin-customer', role='CUSTOMER')
        service = Service.objects.create(name='Walk-in Studio', duration_minutes=60, base_price='1000')
        self.package = Package.objects.create(service=service, name='Portrait', price='1000', inclusions='Portrait session')
        self.day = timezone.localdate() + timedelta(days=30)
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def payload(self, **changes):
        return {
            'package': self.package.pk,
            'scheduled_date': self.day.isoformat(),
            'scheduled_time': '09:00:00',
            'customer_name': 'Walk-in Guest',
            'customer_email': 'guest@example.test',
            'customer_phone': '09171234567',
            **changes,
        }

    def test_staff_creates_accountless_walk_in_with_cash_and_shared_booking_record(self):
        response = self.client.post('/api/bookings/walk-in/', self.payload(
            idempotency_key='walk-in-cash-001', payment_method='CASH', payment_amount='500.00',
        ), format='json')

        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertIsNone(booking.customer_id)
        self.assertTrue(booking.is_walk_in)
        self.assertEqual(booking.created_by_id, self.staff.id)
        self.assertEqual(response.data['customer_name'], 'Walk-in Guest')
        self.assertEqual(response.data['booking_type'], 'Walk-in')
        self.assertEqual(response.data['package_details']['price'], '1000.00')
        payment = Payment.objects.get(booking=booking)
        self.assertEqual(payment.status, 'PAID')
        self.assertEqual(payment.method, 'CASH')
        self.assertEqual(self.client.get('/api/bookings/').status_code, 200)

    def test_duplicate_request_is_idempotent_and_does_not_duplicate_payment(self):
        payload = self.payload(idempotency_key='walk-in-repeat-001', payment_method='CASH', payment_amount='500.00')
        first = self.client.post('/api/bookings/walk-in/', payload, format='json')
        second = self.client.post('/api/bookings/walk-in/', payload, format='json')

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(Booking.objects.filter(is_walk_in=True).count(), 1)
        self.assertEqual(Payment.objects.filter(booking_id=first.data['id']).count(), 1)

    def test_customer_cannot_create_walk_in(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post('/api/bookings/walk-in/', self.payload(), format='json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Booking.objects.exists())

    def test_conflicting_slot_and_invalid_payment_are_rejected(self):
        first = self.client.post('/api/bookings/walk-in/', self.payload(idempotency_key='walk-in-one'), format='json')
        self.assertEqual(first.status_code, 201, first.data)
        conflict = self.client.post('/api/bookings/walk-in/', self.payload(idempotency_key='walk-in-two'), format='json')
        self.assertEqual(conflict.status_code, 409)

        invalid = self.client.post('/api/bookings/walk-in/', self.payload(
            scheduled_time='10:00:00', idempotency_key='walk-in-invalid-pay', payment_method='GCASH',
            payment_amount='300.00', payment_reference='BAD',
        ), format='json')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Booking.objects.count(), 1)

    def test_booking_is_included_in_the_existing_availability_response(self):
        response = self.client.post('/api/bookings/walk-in/', self.payload(idempotency_key='walk-in-availability'), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        availability = self.client.get('/api/bookings/availability/', {'package': self.package.pk, 'date': self.day.isoformat()})
        self.assertFalse(next(slot for slot in availability.data['slots'] if slot['time'] == '09:00:00')['available'])
