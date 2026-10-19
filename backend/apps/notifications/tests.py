from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from notifications.models import Notification, NotificationDelivery, PushSubscription
from notifications.services import dispatch_notification
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

    def test_booking_creation_creates_a_pushable_notification(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post('/api/bookings/', {
            'package': self.booking.package_id,
            'scheduled_date': (timezone.localdate() + timedelta(days=21)).isoformat(),
            'scheduled_time': '10:00',
            'first_name': 'Notification',
            'last_name': 'Customer',
            'email': self.customer.email,
            'phone_number': '09171234567',
            'address': 'CAV Studio',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get()
        self.assertEqual(notification.user_id, self.customer.id)
        self.assertEqual(notification.booking_id, response.data['id'])
        self.assertEqual(notification.notification_type, 'BOOKING_CREATED')
        self.assertIn('Payment status: Not submitted', notification.message)
        self.assertIn('Date:', notification.message)
        self.assertIn('Time:', notification.message)
        self.assertIn('Package: Notification Package', notification.message)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_creation_sends_sms_with_booking_details(self, mocked_post):
        mocked_post.return_value = Mock(
            status_code=200,
            json=Mock(return_value={'status': 200, 'message_id': 'sms_booking_created'}),
        )
        scheduled_date = timezone.localdate() + timedelta(days=21)
        self.client.force_authenticate(self.customer)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/bookings/', {
                'package': self.booking.package_id,
                'scheduled_date': scheduled_date.isoformat(),
                'scheduled_time': '10:00',
                'first_name': 'Notification',
                'last_name': 'Customer',
                'email': self.customer.email,
                'phone_number': '09171234567',
                'address': 'CAV Studio',
                'idempotency_key': 'notification-sms-booking-1',
            }, format='json')

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get(notification_type='BOOKING_CREATED')
        self.assertIn(f'Date: {scheduled_date.isoformat()}', notification.message)
        self.assertIn('Time: 10:00', notification.message)
        self.assertIn('Package: Notification Package', notification.message)
        self.assertIn('Payment status: Not submitted', notification.message)
        delivery = NotificationDelivery.objects.get(notification=notification, channel='sms')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_ACCEPTED)
        self.assertEqual(mocked_post.call_count, 1)
        self.assertEqual(mocked_post.call_args.kwargs['json']['phone_number'], '639171234567')
        self.assertIn('Payment status: Not submitted', mocked_post.call_args.kwargs['json']['message'])

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_creation_survives_sms_failure_and_logs_it(self, mocked_post):
        mocked_post.return_value = Mock(
            status_code=503,
            json=Mock(return_value={'status': 'error', 'message': 'Service unavailable'}),
        )
        scheduled_date = timezone.localdate() + timedelta(days=22)
        self.client.force_authenticate(self.customer)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/bookings/', {
                'package': self.booking.package_id,
                'scheduled_date': scheduled_date.isoformat(),
                'scheduled_time': '11:00',
                'first_name': 'Notification',
                'last_name': 'Customer',
                'email': self.customer.email,
                'phone_number': '09171234567',
                'address': 'CAV Studio',
                'idempotency_key': 'notification-sms-booking-failure-1',
            }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Booking.objects.filter(pk=response.data['id']).exists())
        notification = Notification.objects.get(notification_type='BOOKING_CREATED')
        delivery = NotificationDelivery.objects.get(notification=notification, channel='sms')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_UNKNOWN)
        self.assertEqual(delivery.error_code, 'provider_unavailable')
        self.assertIn('HTTP 503', delivery.error_message)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_failed_sms_is_not_retried_by_repeated_dispatch(self, mocked_post):
        mocked_post.return_value = Mock(
            status_code=503,
            json=Mock(return_value={'status': 'error'}),
        )
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        notification = self._notification(
            title='Booking request received',
            message='CAV booking #1 saved. Payment status: Not submitted.',
        )

        dispatch_notification(notification)
        dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='sms')
        self.assertEqual(mocked_post.call_count, 1)
        self.assertEqual(NotificationDelivery.objects.filter(notification=notification, channel='sms').count(), 1)
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_UNKNOWN)

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
        self.assertIn('has been verified', notification.message)
        self.assertIn('booking status is now confirmed', notification.message)

    def _notification(self, title='Booking update', message='Your booking was updated.'):
        return Notification.objects.create(
            user=self.customer,
            notification_type='TEST_NOTIFICATION',
            title=title,
            message=message,
        )

    def _set_booking_start(self, start):
        local_start = timezone.localtime(start)
        self.booking.scheduled_date = local_start.date()
        self.booking.scheduled_time = local_start.time().replace(second=0, microsecond=0)
        self.booking.save(update_fields=['scheduled_date', 'scheduled_time'])

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_reminder_command_sends_24_hour_sms_once(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 200, 'message_id': 'sms_reminder'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        reference_time = timezone.make_aware(
            datetime(2026, 10, 18, 8, 0),
            timezone.get_current_timezone(),
        )
        self.enterContext(patch('django.utils.timezone.now', return_value=reference_time))
        self._set_booking_start(reference_time + timedelta(hours=24))

        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                reference_time.isoformat(),
                '--window-minutes',
                '30',
            )
        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                reference_time.isoformat(),
                '--window-minutes',
                '30',
            )

        notification = Notification.objects.get()
        self.assertEqual(notification.notification_type, 'BOOKING_REMINDER_24H')
        self.assertIn('October 19, 2026 at 8:00 AM', notification.message)
        self.assertIn('arrive 15 minutes early', notification.message)
        self.assertIn('outfits or props', notification.message)
        delivery = NotificationDelivery.objects.get(
            notification=notification,
            channel=NotificationDelivery.CHANNEL_SMS,
        )
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_ACCEPTED)
        self.assertEqual(mocked_post.call_count, 1)
        self.assertEqual(mocked_post.call_args.kwargs['json']['phone_number'], '639171234567')

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_reminder_command_sends_2_hour_sms(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 'queued', 'message_id': 'sms_two_hour'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        reference_time = timezone.make_aware(
            datetime(2026, 10, 18, 8, 0),
            timezone.get_current_timezone(),
        )
        self.enterContext(patch('django.utils.timezone.now', return_value=reference_time))
        self._set_booking_start(reference_time + timedelta(hours=2))

        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                reference_time.isoformat(),
                '--window-minutes',
                '30',
            )

        notification = Notification.objects.get()
        self.assertEqual(notification.notification_type, 'BOOKING_REMINDER_2H')
        self.assertIn('(2-hour)', notification.message)
        self.assertEqual(mocked_post.call_count, 1)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_reminder_respects_cancellation_and_reschedule(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 200, 'message_id': 'sms_schedule'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        reference_time = timezone.make_aware(
            datetime(2026, 10, 18, 8, 0),
            timezone.get_current_timezone(),
        )
        self.enterContext(patch('django.utils.timezone.now', return_value=reference_time))
        self._set_booking_start(reference_time + timedelta(hours=24))
        self.booking.status = 'CANCELLED'
        self.booking.save(update_fields=['status'])

        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                reference_time.isoformat(),
                '--window-minutes',
                '30',
            )
        self.assertFalse(Notification.objects.exists())

        self.booking.status = 'PENDING'
        self.booking.scheduled_date = (reference_time + timedelta(hours=48)).date()
        self.booking.scheduled_time = (reference_time + timedelta(hours=48)).time()
        self.booking.save(update_fields=['status', 'scheduled_date', 'scheduled_time'])
        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                (reference_time + timedelta(hours=24)).isoformat(),
                '--window-minutes',
                '30',
            )

        self.assertEqual(Notification.objects.filter(notification_type='BOOKING_REMINDER_24H').count(), 1)
        self.assertEqual(mocked_post.call_count, 1)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_reminder_provider_failure_is_logged_without_duplicates(self, mocked_post):
        mocked_post.return_value = Mock(status_code=503, json=Mock(return_value={'status': 'error'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        reference_time = timezone.make_aware(
            datetime(2026, 10, 18, 8, 0),
            timezone.get_current_timezone(),
        )
        self.enterContext(patch('django.utils.timezone.now', return_value=reference_time))
        self._set_booking_start(reference_time + timedelta(hours=24))

        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                reference_time.isoformat(),
                '--window-minutes',
                '30',
            )
        with self.captureOnCommitCallbacks(execute=True):
            call_command(
                'send_booking_reminders',
                '--at',
                reference_time.isoformat(),
                '--window-minutes',
                '30',
            )

        notification = Notification.objects.get(notification_type='BOOKING_REMINDER_24H')
        delivery = NotificationDelivery.objects.get(
            notification=notification,
            channel=NotificationDelivery.CHANNEL_SMS,
        )
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_UNKNOWN)
        self.assertEqual(delivery.error_code, 'provider_unavailable')
        self.assertEqual(Notification.objects.filter(notification_type='BOOKING_REMINDER_24H').count(), 1)
        self.assertEqual(mocked_post.call_count, 1)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=False,
        PUSH_DELIVERY_ENABLED=False,
    )
    def test_disabled_channels_are_logged_without_provider_calls(self):
        notification = self._notification()

        dispatch_notification(notification)

        deliveries = NotificationDelivery.objects.filter(notification=notification).order_by('channel')
        self.assertEqual(deliveries.count(), 3)
        self.assertEqual(set(deliveries.values_list('status', flat=True)), {'skipped'})
        self.assertEqual(set(deliveries.values_list('error_code', flat=True)), {'disabled'})

    @override_settings(
        EMAIL_DELIVERY_ENABLED=True,
        EMAIL_PROVIDER='resend',
        RESEND_API_KEY='re_test_key',
        SMS_DELIVERY_ENABLED=False,
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.email_delivery.requests.post')
    def test_resend_email_delivery_is_logged(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'id': 'email_123'}))
        notification = self._notification()

        dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='email')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_SENT)
        self.assertEqual(delivery.provider_message_id, 'email_123')
        self.assertEqual(mocked_post.call_args.args[0], 'https://api.resend.com/emails')
        self.assertEqual(mocked_post.call_args.kwargs['json']['to'], [self.customer.email])

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_iprogsms_transactional_delivery_is_logged(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 200, 'message_id': 'sms_123'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        notification = self._notification(message='Your booking payment was approved.')

        dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='sms')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_ACCEPTED)
        self.assertEqual(delivery.provider_message_id, 'sms_123')
        self.assertEqual(mocked_post.call_args.args[0], 'https://sms.example.test/api/v1/sms_messages')
        self.assertEqual(mocked_post.call_args.kwargs['json']['phone_number'], '639171234567')

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_booking_sms_uses_the_booking_customer_and_requested_message(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 200, 'message_id': 'sms_booking'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        self.other_customer.phone_number = '09987654321'
        self.other_customer.save(update_fields=['phone_number'])
        notification = Notification.objects.create(
            user=self.other_customer,
            booking=self.booking,
            notification_type='BOOKING_CREATED',
            title='Booking request received',
            message='Your booking request #1 was submitted. Payment is awaiting verification. Please wait for confirmation.',
        )

        dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='sms')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_ACCEPTED)
        self.assertEqual(mocked_post.call_args.kwargs['json']['phone_number'], '639171234567')
        self.assertEqual(
            mocked_post.call_args.kwargs['json']['message'],
            notification.message,
        )

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_sent_sms_is_not_resent_when_notification_dispatch_repeats(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 'queued', 'message_id': 'sms_once'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        notification = self._notification(
            title='Booking request received',
            message='Your booking request was submitted. Payment is awaiting verification. Please wait for confirmation.',
        )

        dispatch_notification(notification)
        dispatch_notification(notification)

        deliveries = NotificationDelivery.objects.filter(
            notification=notification,
            channel=NotificationDelivery.CHANNEL_SMS,
        )
        self.assertEqual(mocked_post.call_count, 1)
        self.assertEqual(deliveries.count(), 1)
        self.assertEqual(deliveries.get().status, NotificationDelivery.STATUS_ACCEPTED)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=False,
        PUSH_DELIVERY_ENABLED=True,
        PUSH_VAPID_PUBLIC_KEY='public-key',
        PUSH_VAPID_PRIVATE_KEY='private-key',
        PUSH_VAPID_SUBJECT='mailto:ops@example.com',
    )
    def test_web_push_delivery_is_logged_and_expired_subscriptions_are_disabled(self):
        subscription = PushSubscription.objects.create(
            user=self.customer,
            endpoint='https://push.example.test/subscription/123',
            p256dh='public-client-key',
            auth='auth-secret',
        )
        notification = self._notification()
        mocked_webpush = Mock(return_value=Mock(headers={'location': 'push_123'}))
        fake_pywebpush = SimpleNamespace(webpush=mocked_webpush, WebPushException=Exception)

        with patch.dict('sys.modules', {'pywebpush': fake_pywebpush}):
            dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='push')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_SENT)
        self.assertEqual(delivery.provider_message_id, 'push_123')
        self.assertTrue(mocked_webpush.called)
        subscription.refresh_from_db()
        self.assertTrue(subscription.is_active)

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=False,
        PUSH_DELIVERY_ENABLED=True,
        PUSH_VAPID_PUBLIC_KEY='public-key',
        PUSH_VAPID_PRIVATE_KEY='private-key',
        PUSH_VAPID_SUBJECT='mailto:ops@example.com',
    )
    def test_expired_web_push_subscription_is_deactivated_and_logged(self):
        subscription = PushSubscription.objects.create(
            user=self.customer,
            endpoint='https://push.example.test/subscription/expired',
            p256dh='public-client-key',
            auth='auth-secret',
        )
        notification = self._notification()

        class FakeWebPushException(Exception):
            response = SimpleNamespace(status_code=410)

        fake_pywebpush = SimpleNamespace(
            webpush=Mock(side_effect=FakeWebPushException()),
            WebPushException=FakeWebPushException,
        )
        with patch.dict('sys.modules', {'pywebpush': fake_pywebpush}):
            dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='push')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_FAILED)
        self.assertEqual(delivery.error_code, 'subscription_expired')
        self.assertEqual(delivery.metadata['provider_status_code'], 410)
        subscription.refresh_from_db()
        self.assertFalse(subscription.is_active)

    @override_settings(PUSH_DELIVERY_ENABLED=True, PUSH_VAPID_PUBLIC_KEY='public-key')
    def test_push_subscription_endpoint_can_be_upserted_and_removed(self):
        self.client.force_authenticate(self.customer)
        payload = {
            'endpoint': 'https://push.example.test/subscription/123',
            'keys': {'p256dh': 'public-client-key', 'auth': 'auth-secret'},
            'user_agent': 'pytest',
        }

        response = self.client.post('/api/notifications/push/subscription/', payload, format='json')
        self.assertEqual(response.status_code, 201)
        response = self.client.post('/api/notifications/push/subscription/', payload, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PushSubscription.objects.filter(user=self.customer).count(), 1)

        response = self.client.delete(
            '/api/notifications/push/subscription/',
            {'endpoint': payload['endpoint']},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(PushSubscription.objects.filter(user=self.customer).exists())

    @override_settings(
        PUSH_DELIVERY_ENABLED=True,
        PUSH_VAPID_PUBLIC_KEY='public-key',
        PUSH_VAPID_PRIVATE_KEY='private-key',
        PUSH_VAPID_SUBJECT='mailto:ops@example.com',
    )
    def test_push_config_exposes_only_the_public_vapid_key(self):
        response = self.client.get('/api/notifications/push/config/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'enabled': True, 'public_key': 'public-key'})
        self.assertNotIn('private-key', response.content.decode())

    def test_push_subscription_endpoint_moves_with_the_authenticated_account(self):
        endpoint = 'https://push.example.test/subscription/account-switch'
        PushSubscription.objects.create(
            user=self.other_customer,
            endpoint=endpoint,
            p256dh='old-public-client-key',
            auth='old-auth-secret',
        )
        self.client.force_authenticate(self.customer)

        response = self.client.post('/api/notifications/push/subscription/', {
            'endpoint': endpoint,
            'keys': {'p256dh': 'new-public-client-key', 'auth': 'new-auth-secret'},
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertFalse(PushSubscription.objects.filter(user=self.other_customer, endpoint=endpoint).exists())
        subscription = PushSubscription.objects.get(user=self.customer, endpoint=endpoint)
        self.assertEqual(subscription.p256dh, 'new-public-client-key')

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_provider_failure_is_recorded_without_breaking_notification_creation(self, mocked_post):
        mocked_post.return_value = Mock(status_code=503, json=Mock(return_value={'status': 'error'}))
        self.customer.phone_number = '09171234567'
        self.customer.save(update_fields=['phone_number'])
        notification = self._notification()

        dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='sms')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_UNKNOWN)
        self.assertEqual(delivery.error_code, 'provider_unavailable')
        self.assertTrue(Notification.objects.filter(pk=notification.pk).exists())

    def test_push_subscription_rejects_non_https_endpoint(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post('/api/notifications/push/subscription/', {
            'endpoint': 'http://push.example.test/subscription/123',
            'keys': {'p256dh': 'public-client-key', 'auth': 'auth-secret'},
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('endpoint', response.data)

    def test_push_subscription_delete_rejects_non_https_endpoint(self):
        self.client.force_authenticate(self.customer)
        response = self.client.delete('/api/notifications/push/subscription/', {
            'endpoint': 'http://push.example.test/subscription/123',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('endpoint', response.data)

    @override_settings(
        PUSH_DELIVERY_ENABLED=True,
        PUSH_VAPID_PUBLIC_KEY='public-key',
        PUSH_VAPID_PRIVATE_KEY='private-key',
        PUSH_VAPID_SUBJECT='',
    )
    def test_push_delivery_skips_without_vapid_subject(self):
        notification = self._notification()
        PushSubscription.objects.create(
            user=self.customer,
            endpoint='https://push.example.test/subscription/missing-subject',
            p256dh='public-client-key',
            auth='auth-secret',
        )

        dispatch_notification(notification)

        delivery = NotificationDelivery.objects.get(notification=notification, channel='push')
        self.assertEqual(delivery.status, NotificationDelivery.STATUS_SKIPPED)
        self.assertEqual(delivery.error_code, 'missing_credentials')
