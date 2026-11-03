from datetime import timedelta
from unittest.mock import Mock, patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.middleware.csrf import CsrfViewMiddleware
from django.test import RequestFactory, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from booking.availability import get_available_slots, is_slot_available
from booking.models import Booking, BookingConversation, BookingDateLock, BookingMessage, BookingReview, Package, Service, StudioUnavailableDate
from notifications.models import Notification, NotificationDelivery
from payment.models import Payment
from users.models import StaffAccessProfile


class BookingAvailabilityPolicyTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='slot-customer',
            email='slot-customer@example.com',
            password='Customer123!',
        )
        self.studio_service = Service.objects.create(
            name='Studio Session',
            description='Studio shoots',
            duration_minutes=60,
            base_price='1000.00',
        )
        self.studio_package = Package.objects.create(
            service=self.studio_service,
            name='Solo Package',
            description='Solo shoot',
            price='1000.00',
            inclusions='Studio session',
        )
        self.event_service = Service.objects.create(
            name='Photo Service Booking',
            description='Event coverage',
            duration_minutes=120,
            base_price='2500.00',
        )
        self.event_package = Package.objects.create(
            service=self.event_service,
            name='Standard Event Package',
            description='Event shoot',
            price='2500.00',
            inclusions='Event coverage',
        )
        self.future_day = timezone.localdate() + timedelta(days=14)

    def test_studio_session_has_nine_daily_slots(self):
        slots = get_available_slots(self.studio_package.id, self.future_day)

        self.assertEqual(len(slots), 9)
        self.assertEqual(slots[0]['time'], '09:00:00')
        self.assertEqual(slots[-1]['time'], '18:00:00')
        self.assertTrue(all(slot['available'] for slot in slots))

    def test_photo_service_event_has_morning_and_afternoon_slots_only(self):
        slots = get_available_slots(self.event_package.id, self.future_day)

        self.assertEqual([slot['label'] for slot in slots], ['Morning', 'Afternoon'])
        self.assertEqual([slot['time'] for slot in slots], ['09:00:00', '13:00:00'])

    def test_active_booking_disables_booked_slot(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.event_package,
            scheduled_date=self.future_day,
            scheduled_time='09:00',
            status='PENDING',
        )

        event_slots = get_available_slots(self.event_package.id, self.future_day)
        self.assertEqual(event_slots[0]['status'], 'BOOKED')
        self.assertFalse(event_slots[0]['available'])
        self.assertFalse(is_slot_available(self.event_package.id, self.future_day, '09:00'))

    def test_event_package_rejects_non_event_slot_time(self):
        self.assertFalse(is_slot_available(self.event_package.id, self.future_day, '10:00'))

    def test_event_booking_makes_all_studio_slots_unavailable_for_that_date(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.event_package,
            scheduled_date=self.future_day,
            scheduled_time='13:00',
            status='CONFIRMED',
        )

        studio_slots = get_available_slots(self.studio_package.id, self.future_day)

        self.assertEqual(len(studio_slots), 9)
        self.assertTrue(all(slot['status'] == 'STUDIO_UNAVAILABLE' for slot in studio_slots))
        self.assertTrue(all(slot['notice'] == 'Unavailable due to an event photoshoot.' for slot in studio_slots))
        self.assertFalse(any(slot['available'] for slot in studio_slots))

    def test_manual_studio_unavailable_date_blocks_studio_slots_with_reason(self):
        StudioUnavailableDate.objects.create(
            date=self.future_day,
            reason='Studio maintenance',
            created_by=self.customer,
        )

        studio_slots = get_available_slots(self.studio_package.id, self.future_day)
        event_slots = get_available_slots(self.event_package.id, self.future_day)

        self.assertTrue(all(slot['status'] == 'STUDIO_UNAVAILABLE' for slot in studio_slots))
        self.assertTrue(all(slot['notice'] == 'Studio maintenance' for slot in studio_slots))
        self.assertTrue(all(slot['available'] for slot in event_slots))

    def test_event_slots_are_unavailable_when_studio_session_already_exists_that_day(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.studio_package,
            scheduled_date=self.future_day,
            scheduled_time='18:00',
            status='CONFIRMED',
        )

        event_slots = get_available_slots(self.event_package.id, self.future_day)

        self.assertFalse(any(slot['available'] for slot in event_slots))
        self.assertTrue(all(slot['notice'] == 'Studio sessions already booked on this date.' for slot in event_slots))

    def test_monthly_availability_batches_database_reads(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.event_package,
            scheduled_date=self.future_day,
            scheduled_time='13:00',
            status='CONFIRMED',
        )
        client = APIClient()
        client.force_authenticate(self.customer)

        with CaptureQueriesContext(connection) as queries:
            response = client.get('/api/bookings/availability/', {
                'package': self.studio_package.id,
                'month': self.future_day.strftime('%Y-%m'),
            })

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(queries), 4, [query['sql'] for query in queries])
        day = next(item for item in response.data['dates'] if item['date'] == self.future_day.isoformat())
        self.assertEqual(day['status'], 'STUDIO_UNAVAILABLE')
        self.assertEqual(day['notice'], 'Unavailable due to an event photoshoot.')

    def test_daily_availability_reuses_package_and_booking_data(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.event_package,
            scheduled_date=self.future_day,
            scheduled_time='09:00',
            status='PENDING',
        )
        client = APIClient()
        client.force_authenticate(self.customer)

        with CaptureQueriesContext(connection) as queries:
            response = client.get('/api/bookings/availability/', {
                'package': self.event_package.id,
                'date': self.future_day.isoformat(),
            })

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(queries), 3, [query['sql'] for query in queries])
        self.assertEqual(response.data['slots'][0]['status'], 'BOOKED')


class BookingWriteSafetyTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='booking-write-customer',
            email='booking-write@example.com',
            password='Customer123!',
        )
        service = Service.objects.create(
            name='Booking Write Studio',
            description='Studio sessions',
            duration_minutes=60,
            base_price='1000.00',
        )
        self.package = Package.objects.create(
            service=service,
            name='Write Safety Package',
            description='Studio shoot',
            price='1000.00',
            inclusions='Studio session',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.customer)

    def test_capacitor_webview_origin_is_trusted_for_csrf_protected_writes(self):
        request = RequestFactory().post('/', HTTP_ORIGIN='capacitor://localhost')
        middleware = CsrfViewMiddleware(lambda value: None)
        self.assertIn('capacitor://localhost', settings.CSRF_TRUSTED_ORIGINS)
        self.assertTrue(middleware._origin_verified(request))

    def test_booking_creation_acquires_a_date_lock(self):
        scheduled_date = timezone.localdate() + timedelta(days=14)
        response = self.client.post('/api/bookings/', {
            'package': self.package.id,
            'scheduled_date': scheduled_date.isoformat(),
            'scheduled_time': '09:00',
            'first_name': 'Booking',
            'last_name': 'Customer',
            'email': self.customer.email,
            'phone_number': '09171234567',
            'address': 'Lipa City',
            'idempotency_key': 'booking-write-safety-1',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertTrue(BookingDateLock.objects.filter(scheduled_date=scheduled_date).exists())


class BookingEndToEndApiTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='booking-e2e-customer',
            email='booking-e2e@example.com',
            password='Customer123!',
        )
        service = Service.objects.create(
            name='Booking E2E Studio',
            description='Studio sessions',
            duration_minutes=60,
            base_price='1000.00',
        )
        self.package = Package.objects.create(
            service=service,
            name='Booking E2E Package',
            description='Studio shoot',
            price='1000.00',
            inclusions='Studio session',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.customer)

    def booking_payload(self, scheduled_date, scheduled_time='09:00', idempotency_key='booking-e2e-1'):
        return {
            'package': self.package.id,
            'scheduled_date': scheduled_date.isoformat(),
            'scheduled_time': scheduled_time,
            'first_name': 'E2E',
            'last_name': 'Customer',
            'email': self.customer.email,
            'phone_number': '09171234567',
            'address': 'Lipa City',
            'idempotency_key': idempotency_key,
        }

    @override_settings(
        EMAIL_DELIVERY_ENABLED=False,
        SMS_DELIVERY_ENABLED=True,
        IPROG_SMS_API_TOKEN='test-token',
        IPROG_SMS_API_BASE_URL='https://sms.example.test',
        PUSH_DELIVERY_ENABLED=False,
    )
    @patch('users.sms_delivery.requests.post')
    def test_available_slot_booking_payment_and_sms_are_one_workflow(self, mocked_post):
        mocked_post.return_value = Mock(
            status_code=200,
            json=Mock(return_value={'status': 200, 'message_id': 'sms-e2e-1'}),
        )
        scheduled_date = timezone.localdate() + timedelta(days=21)

        with self.captureOnCommitCallbacks(execute=True):
            booking_response = self.client.post(
                '/api/bookings/',
                self.booking_payload(scheduled_date),
                format='json',
            )

        self.assertEqual(booking_response.status_code, 201)
        self.assertEqual(booking_response.data['package_details']['service_name'], 'Booking E2E Studio')
        booking_id = booking_response.data['id']
        self.assertEqual(Booking.objects.filter(pk=booking_id).count(), 1)
        sms_delivery = NotificationDelivery.objects.get(channel='sms')
        self.assertEqual(sms_delivery.status, NotificationDelivery.STATUS_ACCEPTED)
        self.assertEqual(mocked_post.call_args.kwargs['json']['phone_number'], '639171234567')
        self.assertIn(scheduled_date.isoformat(), mocked_post.call_args.kwargs['json']['message'])
        self.assertIn('Time: 09:00', mocked_post.call_args.kwargs['json']['message'])
        self.assertIn('Package: Booking E2E Package', mocked_post.call_args.kwargs['json']['message'])
        self.assertIn('Payment status: Not submitted', mocked_post.call_args.kwargs['json']['message'])

        payment_response = self.client.post(
            '/api/bookings/payments/',
            {
                'booking': booking_id,
                'reference_number': 'E2E-REF-001',
                'method': 'MAYA',
                'amount': '500.00',
                'paid_at': '2026-10-18T08:00:00+08:00',
                'idempotency_key': 'payment-e2e-1',
            },
            format='json',
        )

        self.assertEqual(payment_response.status_code, 201)
        self.assertEqual(payment_response.data['method'], 'MAYA')
        self.assertEqual(Payment.objects.filter(booking_id=booking_id).count(), 1)
        payment = Payment.objects.get(booking_id=booking_id)
        self.assertEqual(payment.reference_number, 'E2E-REF-001')
        self.assertFalse(payment.receipt)
        other_customer = get_user_model().objects.create_user(
            username='booking-e2e-other', email='booking-e2e-other@example.com', password='Customer123!',
        )
        self.client.force_authenticate(other_customer)
        self.client.force_authenticate(self.customer)
        replay_response = self.client.post(
            '/api/bookings/payments/',
            {'booking': booking_id, 'idempotency_key': 'payment-e2e-1'},
            format='json',
        )
        self.assertEqual(replay_response.status_code, 200)
        self.assertEqual(Payment.objects.filter(booking_id=booking_id).count(), 1)
        self.assertEqual(mocked_post.call_count, 1)
        status_response = self.client.get('/api/bookings/payments/', {'booking': booking_id})
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(len(status_response.data), 1)
        self.assertEqual(status_response.data[0]['id'], payment.id)
        self.assertEqual(status_response.data[0]['status'], 'PENDING_VERIFICATION')
        paged_status_response = self.client.get('/api/bookings/payments/', {
            'booking': booking_id,
            'status': 'PENDING_VERIFICATION',
            'limit': 1,
            'offset': 0,
            'include_count': 'true',
        })
        self.assertEqual(paged_status_response.status_code, 200)
        self.assertEqual(paged_status_response.data['count'], 1)
        self.assertEqual(len(paged_status_response.data['results']), 1)
        self.client.force_authenticate(other_customer)
        hidden_status_response = self.client.get('/api/bookings/payments/', {'booking': booking_id})
        self.assertEqual(hidden_status_response.status_code, 200)
        self.assertEqual(hidden_status_response.data, [])

    @override_settings(PAYMENT_QR_GCASH_URL='/media/payments/gcash.png', PAYMENT_QR_MAYA_URL='', PAYMENT_QR_MARIBANK_URL='https://example.test/maribank.png')
    def test_payment_method_list_reports_configuration_for_each_supported_method(self):
        response = self.client.get('/api/bookings/payment-methods/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['code'] for item in response.data['methods']], ['GCASH', 'MAYA', 'MARIBANK'])
        self.assertEqual([item['configured'] for item in response.data['methods']], [True, False, True])

    @override_settings(
        DEBUG=False,
        PAYMENT_QR_GCASH_URL='http://localhost:3000/payment-qr/gcash.png',
        PAYMENT_QR_MAYA_URL='http://127.0.0.1:3000/payment-qr/maya.png',
        PAYMENT_QR_MARIBANK_URL='https://cdn.example.test/maribank.png',
    )
    def test_production_payment_methods_rewrite_loopback_qr_urls_to_frontend_assets(self):
        response = self.client.get('/api/bookings/payment-methods/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item['qr_url'] for item in response.data['methods']],
            ['/payment-qr/gcash.png', '/payment-qr/maya.png', 'https://cdn.example.test/maribank.png'],
        )

    def test_conflicting_active_slot_is_rejected_without_a_second_booking(self):
        scheduled_date = timezone.localdate() + timedelta(days=22)
        first_response = self.client.post(
            '/api/bookings/',
            self.booking_payload(scheduled_date, idempotency_key='booking-e2e-conflict-1'),
            format='json',
        )
        second_response = self.client.post(
            '/api/bookings/',
            self.booking_payload(scheduled_date, idempotency_key='booking-e2e-conflict-2'),
            format='json',
        )

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 400)
        self.assertIn('scheduled_time', second_response.data)
        self.assertEqual(Booking.objects.filter(scheduled_date=scheduled_date, scheduled_time='09:00').count(), 1)


class BookingReviewApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.customer = User.objects.create_user(
            username='review-customer',
            email='review-customer@example.com',
            password='Customer123!',
        )
        self.other_customer = User.objects.create_user(
            username='review-other-customer',
            email='review-other@example.com',
            password='Customer123!',
        )
        service = Service.objects.create(
            name='Review Studio',
            description='Studio sessions',
            duration_minutes=60,
            base_price='1500.00',
        )
        package = Package.objects.create(
            service=service,
            name='Review Package',
            description='Completed session',
            price='1500.00',
            inclusions='Studio session',
        )
        self.completed_booking = Booking.objects.create(
            customer=self.customer,
            package=package,
            scheduled_date=timezone.localdate() - timedelta(days=2),
            scheduled_time='10:00',
            status='COMPLETED',
        )
        self.pending_booking = Booking.objects.create(
            customer=self.customer,
            package=package,
            scheduled_date=timezone.localdate() + timedelta(days=2),
            scheduled_time='10:00',
            status='PENDING',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.customer)

    def review_payload(self, booking_id=None):
        return {
            'booking': booking_id or self.completed_booking.id,
            'rating': 5,
            'feedback': 'The session was excellent.',
            'suggestions': 'More themed backdrops would be nice.',
        }

    def test_customer_can_review_completed_booking_and_booking_list_returns_review(self):
        response = self.client.post('/api/bookings/reviews/', self.review_payload(), format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['booking'], self.completed_booking.id)
        self.assertEqual(response.data['customer'], self.customer.id)
        self.assertEqual(BookingReview.objects.get(booking=self.completed_booking).rating, 5)

        bookings_response = self.client.get('/api/bookings/')
        completed = next(row for row in bookings_response.data if row['id'] == self.completed_booking.id)
        self.assertEqual(completed['review']['feedback'], 'The session was excellent.')

    def test_review_requires_completed_booking_and_customer_ownership(self):
        pending_response = self.client.post('/api/bookings/reviews/', self.review_payload(self.pending_booking.id), format='json')
        self.assertEqual(pending_response.status_code, 400)

        other_booking = Booking.objects.create(
            customer=self.other_customer,
            package=self.completed_booking.package,
            scheduled_date=timezone.localdate() - timedelta(days=3),
            scheduled_time='11:00',
            status='COMPLETED',
        )
        ownership_response = self.client.post('/api/bookings/reviews/', self.review_payload(other_booking.id), format='json')
        self.assertEqual(ownership_response.status_code, 400)

    def test_duplicate_review_is_rejected(self):
        first_response = self.client.post('/api/bookings/reviews/', self.review_payload(), format='json')
        duplicate_response = self.client.post('/api/bookings/reviews/', self.review_payload(), format='json')

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(duplicate_response.status_code, 400)
        self.assertEqual(BookingReview.objects.filter(booking=self.completed_booking).count(), 1)


class BookingReminderAndConversationApiTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.customer = users.create_user(username='reminder-customer', email='reminder-customer@example.test', password='Customer123!')
        self.other_customer = users.create_user(username='other-booking-customer', email='other-booking@example.test', password='Customer123!')
        self.admin = users.create_user(username='booking-admin', email='booking-admin@example.test', password='Admin123!', role='ADMIN')
        self.staff = users.create_user(username='booking-staff', email='booking-staff@example.test', password='Staff123!', role='STAFF')
        StaffAccessProfile.objects.create(user=self.staff, on_duty=True)
        service = Service.objects.create(name='Studio Session', description='Studio photos', duration_minutes=60, base_price='1000.00')
        self.package = Package.objects.create(service=service, name='Portrait Package', description='Studio portrait', price='1000.00', inclusions='Studio session')
        self.booking = Booking.objects.create(
            customer=self.customer,
            package=self.package,
            scheduled_date=timezone.localdate(),
            scheduled_time='14:30',
            status='CONFIRMED',
        )
        self.customer_client = APIClient()
        self.customer_client.force_authenticate(self.customer)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(self.admin)
        self.staff_client = APIClient()
        self.staff_client.force_authenticate(self.staff)

    def test_reminder_preview_delivery_is_in_app_and_idempotent_for_admin_and_on_duty_staff(self):
        url = f'/api/bookings/{self.booking.id}/reminder/'
        preview = self.admin_client.get(url)
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(preview.data['eligible'])
        self.assertEqual(preview.data['session_time'], '2:30 PM')
        self.assertIn('Casanova', preview.data['default_location'])

        payload = {'message': 'We are excited to see you today.', 'location': preview.data['default_location']}
        first = self.staff_client.post(url, payload, format='json')
        second = self.admin_client.post(url, payload, format='json')

        self.assertEqual(first.status_code, 201)
        self.assertTrue(first.data['created'])
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.data['created'])
        self.assertEqual(Notification.objects.filter(booking=self.booking, notification_type='BOOKING_SESSION_REMINDER').count(), 1)
        reminder_notification = Notification.objects.get(booking=self.booking, notification_type='BOOKING_SESSION_REMINDER')
        self.assertFalse(NotificationDelivery.objects.filter(notification=reminder_notification).exists())
        self.assertIn('Session time: 2:30 PM (Asia/Manila)', first.data['message'])
        self.assertIn(f'Location: {payload["location"]}', first.data['message'])
        self.assertEqual(BookingMessage.objects.filter(booking=self.booking).count(), 1)
        self.assertIn('Session time: 2:30 PM', BookingMessage.objects.get(booking=self.booking).message)

        inbox = self.customer_client.get('/api/notifications/')
        self.assertEqual(inbox.status_code, 200)
        self.assertEqual(len([row for row in inbox.data if row['id'] == first.data['id']]), 1)
        self.assertEqual(inbox.data[0]['booking_id'], self.booking.id)

        conversation = self.customer_client.get(f'/api/bookings/{self.booking.id}/conversation/')
        self.assertEqual(conversation.data['messages'][0]['message'], first.data['message'])
        self.assertEqual(conversation.data['conversation']['concern'], 'BOOKING')
        customer_reply = self.customer_client.post(f'/api/bookings/{self.booking.id}/conversation/', {'message': 'I will be there.', 'concern': 'OTHER'}, format='json')
        self.assertEqual(customer_reply.status_code, 201)
        self.assertEqual(BookingConversation.objects.get(booking=self.booking).concern, 'OTHER')

    def test_reminder_is_restricted_to_confirmed_today_bookings_and_on_duty_staff(self):
        url = f'/api/bookings/{self.booking.id}/reminder/'
        customer_attempt = self.customer_client.post(url, {'message': 'Please arrive.', 'location': 'Studio'}, format='json')
        self.assertEqual(customer_attempt.status_code, 403)

        StaffAccessProfile.objects.filter(user=self.staff).update(on_duty=False)
        off_duty_attempt = self.staff_client.get(url)
        self.assertEqual(off_duty_attempt.status_code, 403)

        StaffAccessProfile.objects.filter(user=self.staff).update(on_duty=True)
        self.booking.status = 'PENDING'
        self.booking.save(update_fields=['status'])
        pending_preview = self.admin_client.get(url)
        self.assertEqual(pending_preview.status_code, 200)
        self.assertFalse(pending_preview.data['eligible'])
        pending_send = self.admin_client.post(url, {'message': 'Please arrive.', 'location': 'Studio'}, format='json')
        self.assertEqual(pending_send.status_code, 400)
        self.assertFalse(Notification.objects.filter(booking=self.booking, notification_type='BOOKING_SESSION_REMINDER').exists())

    def test_booking_conversation_supports_replies_and_enforces_customer_ownership(self):
        url = f'/api/bookings/{self.booking.id}/conversation/'
        self.assertEqual(self.customer_client.get(url).status_code, 200)
        first = self.customer_client.post(url, {'message': 'Where should we meet?', 'concern': 'PAYMENT'}, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data['author_id'], self.customer.id)
        self.assertEqual(BookingConversation.objects.get(booking=self.booking).concern, 'PAYMENT')

        staff_inbox = self.staff_client.get('/api/bookings/conversations/inbox/')
        self.assertEqual(staff_inbox.status_code, 200)
        self.assertEqual(staff_inbox.data['unread_count'], 1)
        self.assertEqual(staff_inbox.data['results'][0]['booking_id'], self.booking.id)

        reply = self.staff_client.post(url, {'message': 'We will meet at the studio entrance.'}, format='json')
        self.assertEqual(reply.status_code, 201)
        customer_alerts = self.customer_client.get('/api/notifications/')
        self.assertTrue(any(row['notification_type'] == 'BOOKING_MESSAGE' and row['booking_id'] == self.booking.id for row in customer_alerts.data))
        customer_message_alert = Notification.objects.get(booking=self.booking, notification_type='BOOKING_MESSAGE')
        self.assertFalse(NotificationDelivery.objects.filter(notification=customer_message_alert).exists())
        thread = self.customer_client.get(url)
        self.assertEqual([row['message'] for row in thread.data['messages']], [
            'Where should we meet?',
            'We will meet at the studio entrance.',
        ])
        self.admin_client.get(url)
        read_inbox = self.admin_client.get('/api/bookings/conversations/inbox/')
        self.assertEqual(read_inbox.data['unread_count'], 0)
        self.assertEqual(BookingMessage.objects.filter(booking=self.booking).count(), 2)

        other_customer_client = APIClient()
        other_customer_client.force_authenticate(self.other_customer)
        self.assertEqual(other_customer_client.get(url).status_code, 404)
        self.assertEqual(other_customer_client.post(url, {'message': 'Intruding message'}, format='json').status_code, 404)
        self.assertEqual(self.customer_client.get('/api/bookings/conversations/inbox/').status_code, 403)
        self.assertEqual(self.staff_client.get(url).status_code, 200)
        self.assertEqual(self.admin_client.get(url).status_code, 200)

        StaffAccessProfile.objects.filter(user=self.staff).update(on_duty=False)
        self.assertEqual(self.staff_client.get(url).status_code, 403)
        self.assertEqual(self.staff_client.get('/api/bookings/conversations/inbox/').status_code, 403)
