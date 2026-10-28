from datetime import timedelta
from io import BytesIO
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from payment.models import Payment
from payment.storage import SupabasePaymentProofStorage, SupabaseStorageError


def receipt_image(name='proof.png', content_type='image/png'):
    stream = BytesIO()
    Image.new('RGB', (16, 16), 'white').save(stream, format='PNG')
    return SimpleUploadedFile(name, stream.getvalue(), content_type=content_type)


@override_settings(
    IS_TESTING=False,
    DEBUG=False,
    SUPABASE_URL='https://demo-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY='test-only-server-secret',
    SUPABASE_PAYMENT_PROOFS_BUCKET='payment-proofs',
)
class SupabasePaymentProofStorageTests(TestCase):
    def test_upload_and_download_use_private_supabase_object_api(self):
        storage = SupabasePaymentProofStorage()
        upload_response = Mock(status_code=200)
        download_response = Mock(status_code=200, content=b'private receipt bytes')
        with patch('payment.storage.requests.post', return_value=upload_response) as post, \
                patch('payment.storage.requests.get', return_value=download_response) as get:
            name = storage.save('booking_receipts/test-proof.png', receipt_image())
            with storage.open(name, 'rb') as stream:
                content = stream.read()

        self.assertEqual(name, 'booking_receipts/test-proof.png')
        self.assertEqual(content, b'private receipt bytes')
        post_args = post.call_args
        self.assertEqual(post_args.args[0], 'https://demo-project.supabase.co/storage/v1/object/payment-proofs/booking_receipts/test-proof.png')
        self.assertEqual(post_args.kwargs['headers']['Authorization'], 'Bearer test-only-server-secret')
        self.assertEqual(post_args.kwargs['headers']['x-upsert'], 'false')
        self.assertEqual(post_args.kwargs['data'][:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(get.call_args.args[0], post_args.args[0])
        self.assertNotIn('public', get.call_args.args[0])

    def test_storage_rejects_missing_credentials_and_unsafe_paths(self):
        storage = SupabasePaymentProofStorage()
        with override_settings(SUPABASE_SERVICE_ROLE_KEY=''):
            with self.assertRaises(SupabaseStorageError):
                storage.open('booking_receipts/proof.png')
        with self.assertRaises(SupabaseStorageError):
            storage._safe_name('../proof.png')
        with self.assertRaises(ValueError):
            storage.url('booking_receipts/proof.png')

    def test_current_supabase_secret_key_uses_apikey_without_bearer(self):
        headers = SupabasePaymentProofStorage._headers('sb_secret_test-only')
        self.assertEqual(headers['apikey'], 'sb_secret_test-only')
        self.assertNotIn('Authorization', headers)
        with override_settings(SUPABASE_SERVICE_ROLE_KEY='', SUPABASE_SECRET_KEY='sb_secret_test-only'):
            self.assertEqual(
                SupabasePaymentProofStorage()._config()[1],
                'sb_secret_test-only',
            )

    def test_debug_mode_uses_local_django_storage_without_supabase_credentials(self):
        storage = SupabasePaymentProofStorage()
        with override_settings(DEBUG=True, SUPABASE_URL='', SUPABASE_SERVICE_ROLE_KEY=''):
            name = storage.save('booking_receipts/local-proof.png', receipt_image())
            with storage.open(name, 'rb') as stored:
                self.assertTrue(stored.read().startswith(b'\x89PNG\r\n\x1a\n'))
            storage.delete(name)


@override_settings(
    IS_TESTING=False,
    DEBUG=False,
    SUPABASE_URL='',
    SUPABASE_SERVICE_ROLE_KEY='',
    EMAIL_DELIVERY_ENABLED=False,
    SMS_DELIVERY_ENABLED=False,
    PUSH_DELIVERY_ENABLED=False,
)
class BookingPaymentReferenceFlowTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='reference-customer', email='reference-customer@example.com', password='Customer123!',
        )
        self.admin = get_user_model().objects.create_user(
            username='reference-admin', email='reference-admin@example.com', password='Admin123!', role='ADMIN',
        )
        service = Service.objects.create(
            name='Reference Flow Service', description='Test', duration_minutes=60, base_price='1000.00',
        )
        self.package = Package.objects.create(
            service=service, name='Reference Flow Package', description='Test',
            price='1000.00', inclusions='Test session',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.customer)

    def create_booking(self, offset_days, suffix):
        return Booking.objects.create(
            customer=self.customer,
            package=self.package,
            scheduled_date=timezone.localdate() + timedelta(days=offset_days),
            scheduled_time='09:00',
            status='PENDING',
            idempotency_key=f'reference-booking-{suffix}',
        )

    def submit_payment(self, booking, suffix):
        return self.client.post('/api/bookings/payments/', {
            'booking': booking.pk,
            'reference_number': f'PAY-REF-{suffix}',
            'amount': '500.00',
            'method': 'GCASH',
            'paid_at': timezone.now().isoformat(),
            'idempotency_key': f'reference-payment-{suffix}',
        }, format='json')

    def test_reference_only_payment_saves_without_supabase_and_verifies_booking(self):
        booking = self.create_booking(21, 'approved')
        submitted = self.submit_payment(booking, 'APPROVED')
        self.assertEqual(submitted.status_code, 201, submitted.data)
        payment = Payment.objects.get(pk=submitted.data['id'])
        self.assertEqual(payment.reference_number, 'PAY-REF-APPROVED')
        self.assertEqual(str(payment.amount), '500.00')
        self.assertEqual(payment.method, 'GCASH')
        self.assertIsNone(payment.receipt.name if payment.receipt else None)
        self.assertIsNone(submitted.data['receipt_url'])

        self.client.force_authenticate(self.admin)
        approved = self.client.patch(
            f'/api/bookings/payments/{payment.pk}/verify/', {'status': 'APPROVED'}, format='json',
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        payment.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual(payment.status, 'APPROVED')
        self.assertEqual(payment.verified_by_id, self.admin.pk)
        self.assertEqual(booking.status, 'CONFIRMED_DP')

    def test_reference_and_amount_are_required_while_method_and_time_keep_legacy_defaults(self):
        booking = self.create_booking(22, 'required')
        payload = {
            'booking': booking.pk, 'reference_number': 'PAY-REF-REQUIRED',
            'amount': '500.00', 'method': 'GCASH', 'paid_at': timezone.now().isoformat(),
        }
        for field in ('reference_number', 'amount'):
            incomplete = dict(payload)
            incomplete.pop(field)
            response = self.client.post('/api/bookings/payments/', incomplete, format='json')
            self.assertEqual(response.status_code, 400, (field, response.data))
            self.assertIn(field, response.data)
        self.assertFalse(Payment.objects.filter(booking=booking).exists())

    @override_settings(IS_TESTING=True, DEBUG=True)
    def test_payment_proof_uploads_and_retrieval_are_private_to_the_booking_customer(self):
        booking = self.create_booking(26, 'with-proof')
        response = self.client.post('/api/bookings/payments/', {
            'booking': booking.pk,
            'reference_number': 'PAY-REF-WITH-PROOF',
            'amount': '500.00',
            'method': 'GCASH',
            'paid_at': timezone.now().isoformat(),
            'receipt': receipt_image(),
        }, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        payment = Payment.objects.get(pk=response.data['id'])
        self.assertTrue(payment.receipt.name)
        self.assertEqual(response.data['receipt_url'], f'http://testserver/api/bookings/payments/{payment.pk}/receipt/')
        own_download = self.client.get(f'/api/bookings/payments/{payment.pk}/receipt/')
        self.assertEqual(own_download.status_code, 200)
        self.assertTrue(own_download['Content-Type'].startswith('image/'))

        other_customer = get_user_model().objects.create_user(username='other-customer', role='CUSTOMER')
        self.client.force_authenticate(other_customer)
        denied = self.client.get(f'/api/bookings/payments/{payment.pk}/receipt/')
        self.assertEqual(denied.status_code, 404)

    def test_duplicate_booking_reference_is_rejected_case_insensitively(self):
        first_booking = self.create_booking(23, 'first')
        first = self.submit_payment(first_booking, 'DUPLICATE')
        self.assertEqual(first.status_code, 201, first.data)
        second_booking = self.create_booking(24, 'second')
        second = self.client.post('/api/bookings/payments/', {
            'booking': second_booking.pk,
            'reference_number': 'pay-ref-duplicate',
            'amount': '500.00',
            'method': 'GCASH',
            'paid_at': timezone.now().isoformat(),
        }, format='json')
        self.assertEqual(second.status_code, 400, second.data)
        self.assertFalse(Payment.objects.filter(booking=second_booking).exists())

    def test_idempotent_payment_retry_returns_existing_reference_record(self):
        booking = self.create_booking(25, 'retry')
        first = self.submit_payment(booking, 'RETRY')
        self.assertEqual(first.status_code, 201, first.data)
        replay = self.client.post('/api/bookings/payments/', {
            'booking': booking.pk,
            'idempotency_key': 'reference-payment-RETRY',
        }, format='json')
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data['id'], first.data['id'])
        self.assertEqual(Payment.objects.filter(booking=booking).count(), 1)
