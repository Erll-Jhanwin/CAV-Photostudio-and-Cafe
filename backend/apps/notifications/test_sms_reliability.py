from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from unittest.mock import Mock, patch

import requests
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone

from notifications.models import Notification, NotificationDelivery as Delivery
from notifications.services import dispatch_notification
from notifications.sms import send_sms_notification, reconcile_sms_delivery, process_sms_deliveries


@override_settings(SMS_DELIVERY_ENABLED=True, IPROG_SMS_API_TOKEN='private-test-token',
                   IPROG_SMS_API_BASE_URL='https://sms.example.test', EMAIL_DELIVERY_ENABLED=False,
                   PUSH_DELIVERY_ENABLED=False, SMS_MAX_ATTEMPTS=3, SMS_RETRY_DELAY_SECONDS=60)
class SMSReliabilityTests(TransactionTestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(username='sms-owner', phone_number='+63 917 123 4567')
        self.notification = Notification.objects.create(user=self.customer, notification_type='TEST', title='Test', message='Test event')
        self.accepted = Mock(status_code=200, json=lambda: {'status': 200, 'message_id': 'provider-123'})

    def test_acceptance_is_not_delivery_and_status_is_checked_separately(self):
        with patch('users.sms_delivery.requests.post', return_value=self.accepted) as post:
            delivery = send_sms_notification(self.notification)
            self.assertEqual(delivery.status, Delivery.STATUS_ACCEPTED)
            self.assertIsNone(delivery.delivered_at)
            for state, expected in [('pending', Delivery.STATUS_ACCEPTED), ('completed', Delivery.STATUS_SENT), ('delivered', Delivery.STATUS_DELIVERED)]:
                with patch('users.sms_delivery.requests.get', return_value=Mock(status_code=200, json=lambda: {'status': 200, 'message_status': state})):
                    delivery = reconcile_sms_delivery(delivery.id)
                self.assertEqual(delivery.status, expected)
            self.assertIsNotNone(delivery.delivered_at)
            send_sms_notification(self.notification, retry=True)
            post.assert_called_once()

    def test_read_timeout_is_unknown_and_never_automatically_retried(self):
        with patch('users.sms_delivery.requests.post', side_effect=requests.ReadTimeout('secret request url')) as post:
            delivery = send_sms_notification(self.notification)
            self.assertEqual(delivery.status, Delivery.STATUS_UNKNOWN)
            self.assertIsNone(delivery.next_retry_at)
            process_sms_deliveries()
            post.assert_called_once()
            self.assertNotIn('secret', delivery.error_message)

    def test_known_connect_failure_uses_bounded_backoff_on_same_delivery(self):
        with patch('users.sms_delivery.requests.post', side_effect=requests.ConnectTimeout()) as post:
            delivery = send_sms_notification(self.notification)
            self.assertEqual(delivery.status, Delivery.STATUS_FAILED)
            self.assertIsNotNone(delivery.next_retry_at)
            send_sms_notification(self.notification, retry=True)
            self.assertEqual(post.call_count, 1)
            for count in [2, 3]:
                Delivery.objects.filter(pk=delivery.id).update(next_retry_at=timezone.now() - timedelta(seconds=1))
                send_sms_notification(self.notification, retry=True)
                self.assertEqual(post.call_count, count)
            delivery.refresh_from_db()
            self.assertEqual(delivery.attempt_count, 3)
            self.assertIsNone(delivery.next_retry_at)
            self.assertEqual(Delivery.objects.filter(channel='sms').count(), 1)

    def test_provider_confirmed_failure_can_be_retried(self):
        with patch('users.sms_delivery.requests.post', return_value=self.accepted) as post:
            delivery = send_sms_notification(self.notification)
            with patch('users.sms_delivery.requests.get', return_value=Mock(status_code=200, json=lambda: {'status': 200, 'message_status': 'failed'})):
                delivery = reconcile_sms_delivery(delivery.id)
            self.assertIsNotNone(delivery.next_retry_at)
            Delivery.objects.filter(pk=delivery.id).update(next_retry_at=timezone.now() - timedelta(seconds=1))
            send_sms_notification(self.notification, retry=True)
            self.assertEqual(post.call_count, 2)

    def test_provider_rejection_does_not_log_echoed_secrets(self):
        response = Mock(status_code=200, json=lambda: {'status': 'error', 'message': 'Invalid token private-test-token for 639171234567'})
        with patch('users.sms_delivery.requests.post', return_value=response):
            with self.assertLogs('notifications.sms', level='WARNING') as logs:
                delivery = send_sms_notification(self.notification)
        self.assertEqual(delivery.error_code, 'invalid_credentials')
        recorded = str(logs.output) + delivery.error_message + str(delivery.metadata)
        self.assertNotIn('private-test-token', recorded)
        self.assertNotIn('639171234567', recorded)

    def test_actual_smart_tnt_rejection_identifies_required_sender_configuration(self):
        response = Mock(status_code=200, json=lambda: {
            'status': 500,
            'message': ['Smart/TNT networks do not accept shared sender names. Please get your own sender name approved.'],
        })
        with patch('users.sms_delivery.requests.post', return_value=response) as post:
            delivery = send_sms_notification(self.notification)
            process_sms_deliveries()
        post.assert_called_once()
        self.assertEqual(delivery.status, Delivery.STATUS_FAILED)
        self.assertEqual(delivery.error_code, 'sender_name_required')
        self.assertIsNone(delivery.next_retry_at)
        self.assertFalse(delivery.provider_message_id)
        self.assertIsNone(delivery.delivered_at)

    def test_unrecognized_response_is_unknown_not_a_safe_retry(self):
        with patch('users.sms_delivery.requests.post', return_value=Mock(status_code=200, json=lambda: {})) as post:
            delivery = send_sms_notification(self.notification)
            process_sms_deliveries()
        self.assertEqual(delivery.status, Delivery.STATUS_UNKNOWN)
        post.assert_called_once()

    def test_worker_recovers_new_events_without_broadcasting_legacy_notifications(self):
        current = Notification.objects.create(user=self.customer, notification_type='TEST', title='Current',
                                              message='Current event', event_key='test:current')
        with patch('users.sms_delivery.requests.post', return_value=self.accepted) as post, patch(
            'users.sms_delivery.requests.get', return_value=Mock(status_code=200, json=lambda: {'status': 200, 'message_status': 'pending'})
        ):
            process_sms_deliveries()
            process_sms_deliveries()
        post.assert_called_once()
        self.assertTrue(Delivery.objects.filter(notification=current, channel='sms').exists())
        self.assertFalse(Delivery.objects.filter(notification=self.notification, channel='sms').exists())

    def test_reminder_retry_is_suppressed_after_cancellation_or_reschedule(self):
        from booking.models import Booking, Service, Package
        from notifications.reminders import reminder_event_key
        service = Service.objects.create(name='Studio', duration_minutes=60, base_price='1000')
        package = Package.objects.create(service=service, name='Package', price='1000')
        booking = Booking.objects.create(customer=self.customer, package=package,
                                         scheduled_date=timezone.localdate() + timedelta(days=2), scheduled_time='09:00')
        booking.refresh_from_db()
        self.notification.booking = booking
        self.notification.notification_type = 'BOOKING_REMINDER_24H'
        self.notification.event_key = reminder_event_key(booking, self.notification.notification_type)
        self.notification.save()
        with patch('users.sms_delivery.requests.post', side_effect=requests.ConnectTimeout()) as post:
            delivery = send_sms_notification(self.notification)
            booking.scheduled_date += timedelta(days=1)
            booking.save()
            Delivery.objects.filter(pk=delivery.id).update(next_retry_at=timezone.now() - timedelta(seconds=1))
            send_sms_notification(self.notification, retry=True)
        post.assert_called_once()
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.STATUS_SKIPPED)
        self.assertEqual(delivery.error_code, 'obsolete_reminder')

    def test_crashed_submission_is_never_resent(self):
        delivery = Delivery.objects.create(notification=self.notification, user=self.customer, channel='sms', status='sending')
        Delivery.objects.filter(pk=delivery.id).update(updated_at=timezone.now() - timedelta(minutes=10))
        with patch('users.sms_delivery.requests.post') as post:
            process_sms_deliveries()
        post.assert_not_called()
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.STATUS_UNKNOWN)

    def test_email_exception_does_not_block_sms_or_push(self):
        with patch('notifications.services._send_email_notification', side_effect=RuntimeError('email failed')):
            with patch('users.sms_delivery.requests.post', return_value=self.accepted) as post:
                dispatch_notification(self.notification)
        post.assert_called_once()
        self.assertEqual(Delivery.objects.get(channel='sms').status, Delivery.STATUS_ACCEPTED)
        self.assertTrue(Delivery.objects.filter(channel='push').exists())

    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_workers_make_one_provider_request_on_postgresql(self):
        entered = Event()
        release = Event()

        def provider(*args, **kwargs):
            entered.set()
            if not release.wait(10):
                raise AssertionError('Concurrent worker did not finish')
            return self.accepted

        def worker():
            close_old_connections()
            try:
                return send_sms_notification(Notification.objects.get(pk=self.notification.id)).status
            finally:
                connection.close()

        with patch('users.sms_delivery.requests.post', side_effect=provider) as post:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(worker)
                try:
                    self.assertTrue(entered.wait(10))
                    second = pool.submit(worker)
                    self.assertEqual(second.result(timeout=10), Delivery.STATUS_SENDING)
                finally:
                    release.set()
                self.assertEqual(first.result(timeout=10), Delivery.STATUS_ACCEPTED)
            post.assert_called_once()
        self.assertEqual(Delivery.objects.filter(channel='sms').count(), 1)
