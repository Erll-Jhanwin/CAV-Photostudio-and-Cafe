from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from unittest.mock import patch

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
        self.assertEqual(booking.status, 'CONFIRMED_DP')
        self.assertEqual(response.data['customer_name'], 'Walk-in Guest')
        self.assertEqual(response.data['booking_type'], 'Walk-in')
        self.assertEqual(response.data['package_details']['price'], '1000.00')
        self.assertEqual(response.data['remaining_balance'], Decimal('500.00'))
        payment = Payment.objects.get(booking=booking)
        self.assertEqual(payment.status, 'APPROVED')
        self.assertEqual(payment.method, 'CASH')
        self.assertEqual(payment.amount, 500)
        self.assertEqual(payment.verified_by_id, self.staff.id)
        self.assertIsNotNone(payment.paid_at)
        self.assertIsNotNone(payment.verified_at)
        self.assertEqual(response.data['payments'][0]['status'], 'APPROVED')
        self.assertEqual(self.client.get('/api/bookings/').status_code, 200)

    def test_staff_received_non_cash_payment_is_verified_and_balance_is_updated(self):
        response = self.client.post('/api/bookings/walk-in/', self.payload(
            idempotency_key='walk-in-gcash-001', payment_method='GCASH', payment_amount='750.00',
            payment_reference='GCASH-REF-1001',
        ), format='json')

        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        payment = Payment.objects.get(booking=booking)
        self.assertEqual(booking.status, 'CONFIRMED_DP')
        self.assertEqual(response.data['remaining_balance'], Decimal('250.00'))
        self.assertEqual(payment.status, 'APPROVED')
        self.assertEqual(payment.reference_number, 'GCASH-REF-1001')
        self.assertEqual(payment.verified_by_id, self.staff.id)
        self.assertEqual(response.data['payments'][0]['reference_number'], 'GCASH-REF-1001')

    def test_walk_in_without_payment_remains_pending_and_full_payment_has_no_balance(self):
        unpaid = self.client.post('/api/bookings/walk-in/', self.payload(
            idempotency_key='walk-in-unpaid-001',
        ), format='json')
        self.assertEqual(unpaid.status_code, 201, unpaid.data)
        self.assertEqual(unpaid.data['status'], 'PENDING')
        self.assertEqual(unpaid.data['remaining_balance'], Decimal('1000.00'))
        self.assertEqual(unpaid.data['payments'], [])

        # Use a distinct package and slot so a complete receipt remains in its own booking transaction.
        package = Package.objects.create(service=self.package.service, name='Full Receipt Package', price='1000', inclusions='Session')
        fully_paid = self.client.post('/api/bookings/walk-in/', self.payload(
            package=package.pk, scheduled_time='10:00:00', idempotency_key='walk-in-full-001',
            payment_method='CASH', payment_amount='1000.00',
        ), format='json')
        self.assertEqual(fully_paid.status_code, 201, fully_paid.data)
        self.assertEqual(fully_paid.data['status'], 'CONFIRMED_DP')
        self.assertEqual(fully_paid.data['remaining_balance'], Decimal('0.00'))

    def test_duplicate_request_is_idempotent_and_does_not_duplicate_payment(self):
        payload = self.payload(idempotency_key='walk-in-repeat-001', payment_method='CASH', payment_amount='500.00')
        first = self.client.post('/api/bookings/walk-in/', payload, format='json')
        second = self.client.post('/api/bookings/walk-in/', payload, format='json')

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(Booking.objects.filter(is_walk_in=True).count(), 1)
        self.assertEqual(Payment.objects.filter(booking_id=first.data['id']).count(), 1)

    def test_payment_write_failure_rolls_back_the_booking(self):
        with patch('booking.views.Payment.objects.create', side_effect=IntegrityError('simulated payment write failure')):
            response = self.client.post('/api/bookings/walk-in/', self.payload(
                idempotency_key='walk-in-atomic-failure', payment_method='CASH', payment_amount='500.00',
            ), format='json')

        self.assertEqual(response.status_code, 409)
        self.assertFalse(Booking.objects.exists())
        self.assertFalse(Payment.objects.exists())

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
