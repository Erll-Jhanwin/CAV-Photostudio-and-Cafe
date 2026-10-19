from datetime import timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from notifications.models import Notification, NotificationDelivery as Delivery
from notifications.services import dispatch_notification
from payment.models import Payment


class WorkflowFixtures:
    def setUp(self):
        super().setUp()
        cache.clear()
        self.customer = get_user_model().objects.create_user(
            username='workflow-customer', email='workflow@example.test', password='Customer123!',
            phone_number='09171234567', first_name='Workflow',
        )
        self.staff = get_user_model().objects.create_user(username='workflow-staff', role='STAFF')
        service = Service.objects.create(name='Studio Session', duration_minutes=60, base_price='1000')
        self.package = Package.objects.create(service=service, name='Test Package', price='1000', inclusions='Session')
        self.day = timezone.localdate() + timedelta(days=20)
        self.client = APIClient()
        self.client.force_authenticate(self.customer)

    def payload(self, **changes):
        return {
            'package': self.package.pk, 'scheduled_date': self.day.isoformat(), 'scheduled_time': '09:00:00',
            'first_name': 'Workflow', 'email': self.customer.email, 'phone_number': self.customer.phone_number,
            'idempotency_key': 'workflow-booking', **changes,
        }

    def book(self, **changes):
        response = self.client.post('/api/bookings/', self.payload(**changes), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return Booking.objects.get(pk=response.data['id'])

    def pay(self, booking, **changes):
        response = self.client.post('/api/bookings/payments/', {
            'booking': booking.id, 'amount': '500', 'reference_number': 'REF-123456',
            'idempotency_key': 'workflow-payment', 'paid_at': '2026-10-18T01:00:00Z', **changes,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return Payment.objects.get(pk=response.data['id'])


@override_settings(EMAIL_DELIVERY_ENABLED=False, SMS_DELIVERY_ENABLED=False, PUSH_DELIVERY_ENABLED=False)
class BookingLifecycleTests(WorkflowFixtures, TestCase):
    def test_full_lifecycle_emits_once_and_history_remains_available(self):
        booking = self.book()
        payment = self.pay(booking)
        self.client.force_authenticate(self.staff)
        for state in ['REJECTED', 'APPROVED', 'APPROVED']:
            response = self.client.patch(f'/api/bookings/payments/{payment.id}/verify/', {'status': state}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'CONFIRMED_DP')
        for state in ['CONFIRMED', 'COMPLETED', 'COMPLETED']:
            response = self.client.patch(f'/api/bookings/{booking.id}/', {'status': state}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        types = list(Notification.objects.filter(booking=booking).values_list('notification_type', flat=True))
        self.assertCountEqual(types, ['BOOKING_CREATED', 'BOOKING_PAYMENT_PENDING_VERIFICATION',
                                      'BOOKING_PAYMENT_REJECTED', 'BOOKING_PAYMENT_APPROVED',
                                      'BOOKING_CONFIRMED', 'BOOKING_COMPLETED'])
        for notification in Notification.objects.filter(booking=booking):
            self.assertEqual(notification.user_id, self.customer.id)
            for detail in [self.day.isoformat(), '09:00', 'Test Package', 'Payment status:']:
                self.assertIn(detail, notification.message)
        self.client.force_authenticate(self.customer)
        history = self.client.get('/api/bookings/').data
        self.assertEqual(history[0]['status'], 'COMPLETED')
        self.assertEqual(history[0]['payments'][0]['status'], 'APPROVED')

    def test_customer_cancel_notifies_once_and_payment_cannot_reopen_it(self):
        booking = self.book()
        payment = self.pay(booking)
        for _ in range(2):
            response = self.client.patch(f'/api/bookings/{booking.id}/', {'status': 'CANCELLED'}, format='json')
            self.assertEqual(response.status_code, 200)
        self.assertEqual(Notification.objects.filter(notification_type='BOOKING_CANCELLED').count(), 1)
        self.client.force_authenticate(self.staff)
        response = self.client.patch(f'/api/bookings/payments/{payment.id}/verify/', {'status': 'APPROVED'}, format='json')
        self.assertEqual(response.status_code, 409)
        booking.refresh_from_db()
        payment.refresh_from_db()
        self.assertEqual(booking.status, 'CANCELLED')
        self.assertEqual(payment.status, 'PENDING_VERIFICATION')

    def test_rejecting_approved_payment_removes_down_payment_confirmation(self):
        booking = self.book()
        payment = self.pay(booking)
        self.client.force_authenticate(self.staff)
        for state in ['APPROVED', 'REJECTED']:
            self.assertEqual(self.client.patch(f'/api/bookings/payments/{payment.id}/verify/', {'status': state}, format='json').status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'PENDING')

    def test_reschedule_records_changes_and_replay_does_not_notify_again(self):
        booking = self.book()
        for _ in range(2):
            response = self.client.patch(f'/api/bookings/{booking.id}/', {'scheduled_time': '10:00:00', 'change_reason': None}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual(len(booking.change_history), 1)
        self.assertEqual(Notification.objects.filter(notification_type='BOOKING_UPDATED').count(), 1)
        self.assertIn('Time: 10:00', Notification.objects.get(notification_type='BOOKING_UPDATED').message)

    def test_reopening_cancelled_booking_rechecks_conflicts(self):
        booking = self.book()
        self.client.patch(f'/api/bookings/{booking.id}/', {'status': 'CANCELLED'}, format='json')
        replacement = self.book(idempotency_key='replacement')
        self.client.force_authenticate(self.staff)
        response = self.client.patch(f'/api/bookings/{booking.id}/', {'status': 'CONFIRMED'}, format='json')
        self.assertEqual(response.status_code, 400)
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'CANCELLED')
        self.assertTrue(Booking.objects.filter(pk=replacement.pk, status='PENDING').exists())

    def test_validation_errors_are_field_errors_without_partial_bookings(self):
        for changes, field in [({'scheduled_time': '09:00:30'}, 'scheduled_time'),
                               ({'scheduled_date': '2026-02-30'}, 'scheduled_date'),
                               ({'phone_number': '1234567'}, 'phone_number'),
                               ({'idempotency_key': 'x' * 101}, 'idempotency_key')]:
            response = self.client.post('/api/bookings/', self.payload(**changes), format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(field, response.data)
        self.assertFalse(Booking.objects.exists())

    def test_payment_missing_parent_or_zero_amount_is_rejected_before_database(self):
        booking = self.book()
        for data, field in [({'amount': '500', 'reference_number': 'REF-123456'}, 'booking'),
                            ({'booking': booking.id, 'amount': '0', 'reference_number': 'REF-123456'}, 'amount')]:
            response = self.client.post('/api/bookings/payments/', data, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(field, response.data)
        self.assertFalse(Payment.objects.exists())

    def test_duplicate_customer_contact_is_not_misreported_as_schedule_conflict(self):
        get_user_model().objects.create_user(username='contact-owner', email='taken@example.test', phone_number='09987654321')
        for fields, expected in [({'email': 'taken@example.test'}, 'email'), ({'phone_number': '+63 9987654321'}, 'phone_number')]:
            response = self.client.post('/api/bookings/', self.payload(**fields), format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn(expected, response.data)
        self.assertFalse(Booking.objects.exists())

    def test_chat_booking_replay_reschedule_and_cancel_use_same_notifications(self):
        from types import SimpleNamespace
        from chatbot.actions import execute_chat_action
        request = SimpleNamespace(user=self.customer)
        action = {'type': 'CREATE_BOOKING', 'confirm': True, 'package_id': self.package.id,
                  'scheduled_date': self.day.isoformat(), 'scheduled_time': '09:00', 'idempotency_key': 'chat-replay'}
        execute_chat_action(action, request)
        execute_chat_action(action, request)
        self.assertEqual(Booking.objects.count(), 1)
        booking = Booking.objects.get()
        execute_chat_action({'type': 'UPDATE_BOOKING', 'confirm': True, 'booking_id': booking.id,
                             'scheduled_time': '10:00'}, request)
        execute_chat_action({'type': 'CANCEL_BOOKING', 'confirm': True, 'booking_id': booking.id}, request)
        self.assertCountEqual(Notification.objects.values_list('notification_type', flat=True),
                              ['BOOKING_CREATED', 'BOOKING_UPDATED', 'BOOKING_CANCELLED'])
        booking.refresh_from_db()
        self.assertEqual(len(booking.change_history), 1)


@override_settings(EMAIL_DELIVERY_ENABLED=False, PUSH_DELIVERY_ENABLED=False, SMS_DELIVERY_ENABLED=True,
                   IPROG_SMS_API_TOKEN='test-token', IPROG_SMS_API_BASE_URL='https://sms.example.test')
class BookingCommitTests(WorkflowFixtures, TransactionTestCase):
    def test_timestamp_round_trip_preserves_the_instant(self):
        booking = self.book_with_disabled_sms()
        original = timezone.now() - timedelta(minutes=3)
        Booking.objects.filter(pk=booking.pk).update(created_at=original)
        booking.refresh_from_db()
        self.assertLess(abs((booking.created_at - original).total_seconds()), 0.01)

    @override_settings(SMS_DELIVERY_ENABLED=False)
    def book_with_disabled_sms(self):
        return self.book()

    @skipUnlessDBFeature('has_select_for_update')
    @override_settings(SMS_DELIVERY_ENABLED=False)
    def test_two_concurrent_customers_cannot_reserve_the_same_slot(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections
        barrier = Barrier(2)

        def reserve(key):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=self.customer.id))
                barrier.wait(timeout=10)
                return client.post('/api/bookings/', self.payload(idempotency_key=key), format='json').status_code
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(reserve, ['concurrent-1', 'concurrent-2']))
        self.assertIn(201, responses)
        self.assertEqual(sum(code in {400, 409} for code in responses), 1)
        self.assertEqual(Booking.objects.count(), 1)
        self.assertEqual(Notification.objects.count(), 1)

    def test_sms_sees_committed_booking_and_request_replay_sends_once(self):
        def send(*args, **kwargs):
            self.assertFalse(connection.in_atomic_block)
            self.assertEqual(Booking.objects.count(), 1)
            self.assertEqual(Delivery.objects.get(channel='sms').status, Delivery.STATUS_SENDING)
            return Mock(status_code=200, json=lambda: {'status': 200, 'message_id': 'real-commit-test'})
        with patch('users.sms_delivery.requests.post', side_effect=send) as provider:
            first = self.client.post('/api/bookings/', self.payload(), format='json')
            second = self.client.post('/api/bookings/', self.payload(), format='json')
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.data['id'], second.data['id'])
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(Delivery.objects.get(channel='sms').status, Delivery.STATUS_ACCEPTED)

    def test_callback_exception_does_not_turn_committed_booking_into_error(self):
        with patch('notifications.services.dispatch_notification', side_effect=RuntimeError('simulated worker failure')):
            booking = self.book()
        self.assertTrue(Booking.objects.filter(pk=booking.pk).exists())
        self.assertEqual(Notification.objects.count(), 1)

    def test_rollback_does_not_dispatch_or_leave_notification(self):
        from notifications.booking_events import notify_booking_created
        with patch('users.sms_delivery.requests.post') as provider:
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    booking = Booking.objects.create(customer=self.customer, package=self.package,
                                                     scheduled_date=self.day, scheduled_time=timezone.datetime.min.time())
                    notify_booking_created(booking)
                    raise RuntimeError('rollback')
        self.assertFalse(Booking.objects.exists())
        self.assertFalse(Notification.objects.exists())
        provider.assert_not_called()
