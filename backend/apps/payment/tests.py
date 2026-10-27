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
    SUPABASE_URL='https://demo-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY='test-only-server-secret',
    SUPABASE_PAYMENT_PROOFS_BUCKET='payment-proofs',
    EMAIL_DELIVERY_ENABLED=False,
    SMS_DELIVERY_ENABLED=False,
    PUSH_DELIVERY_ENABLED=False,
)
class BookingPaymentProofFlowTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='proof-customer', email='proof-customer@example.com', password='Customer123!',
        )
        self.admin = get_user_model().objects.create_user(
            username='proof-admin', email='proof-admin@example.com', password='Admin123!', role='ADMIN',
        )
        service = Service.objects.create(
            name='Proof Flow Service', description='Test', duration_minutes=60, base_price='1000.00',
        )
        self.package = Package.objects.create(
            service=service, name='Proof Flow Package', description='Test',
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
            idempotency_key=f'proof-booking-{suffix}',
        )

    def submit_payment(self, booking, suffix):
        return self.client.post('/api/bookings/payments/', {
            'booking': booking.pk,
            'reference_number': f'PROOF-REF-{suffix}',
            'amount': '500.00',
            'method': 'GCASH',
            'paid_at': timezone.now().isoformat(),
            # Deliberately mismatched name suffix: the stored suffix follows
            # verified image bytes, not a user-controlled filename.
            'receipt': receipt_image(f'customer-{suffix}.jpg'),
            'idempotency_key': f'proof-payment-{suffix}',
        }, format='multipart')

    @patch('payment.storage.requests.get')
    @patch('payment.storage.requests.post')
    def test_upload_private_review_approve_and_reject_update_existing_booking(self, storage_post, storage_get):
        storage_post.return_value = Mock(status_code=200)
        storage_get.return_value = Mock(status_code=200, content=b'PNG receipt bytes')

        approved_booking = self.create_booking(21, 'approved')
        submitted = self.submit_payment(approved_booking, 'APPROVED')
        self.assertEqual(submitted.status_code, 201, submitted.data)
        payment = Payment.objects.get(pk=submitted.data['id'])
        self.assertEqual(payment.status, 'PENDING_VERIFICATION')
        self.assertEqual(submitted.data['method'], 'GCASH')
        self.assertEqual(submitted.data['method_label'], 'GCash')
        self.assertEqual(submitted.data['booking_details']['id'], approved_booking.pk)
        self.assertEqual(submitted.data['booking_details']['package_name'], self.package.name)
        self.assertTrue(payment.receipt.name.startswith('booking_receipts/'))
        self.assertTrue(payment.receipt.name.endswith('.png'))
        self.assertNotIn('demo-project.supabase.co', submitted.data['receipt_url'])
        self.assertEqual(storage_post.call_count, 1)

        other_customer = get_user_model().objects.create_user(
            username='proof-other', email='proof-other@example.com', password='Customer123!',
        )
        self.client.force_authenticate(other_customer)
        self.assertEqual(self.client.get(submitted.data['receipt_url']).status_code, 404)

        self.client.force_authenticate(self.admin)
        receipt_response = self.client.get(submitted.data['receipt_url'])
        self.assertEqual(receipt_response.status_code, 200)
        self.assertEqual(b''.join(receipt_response.streaming_content), b'PNG receipt bytes')
        self.assertEqual(receipt_response['Cache-Control'], 'private, no-store')
        self.assertEqual(receipt_response['X-Content-Type-Options'], 'nosniff')

        approved = self.client.patch(
            f'/api/bookings/payments/{payment.pk}/verify/', {'status': 'APPROVED'}, format='json',
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        payment.refresh_from_db()
        approved_booking.refresh_from_db()
        self.assertEqual(payment.status, 'APPROVED')
        self.assertEqual(payment.verified_by_id, self.admin.pk)
        self.assertEqual(approved_booking.status, 'CONFIRMED_DP')

        rejected_booking = self.create_booking(22, 'rejected')
        self.client.force_authenticate(self.customer)
        rejected_submission = self.submit_payment(rejected_booking, 'REJECTED')
        self.assertEqual(rejected_submission.status_code, 201, rejected_submission.data)
        rejected_payment = Payment.objects.get(pk=rejected_submission.data['id'])
        self.client.force_authenticate(self.admin)
        rejected = self.client.patch(
            f'/api/bookings/payments/{rejected_payment.pk}/verify/', {'status': 'REJECTED'}, format='json',
        )
        self.assertEqual(rejected.status_code, 200, rejected.data)
        rejected_payment.refresh_from_db()
        rejected_booking.refresh_from_db()
        self.assertEqual(rejected_payment.status, 'REJECTED')
        self.assertEqual(rejected_booking.status, 'PENDING')

    @patch('payment.storage.requests.post')
    def test_storage_failure_does_not_create_payment_or_expose_provider_details(self, storage_post):
        storage_post.return_value = Mock(status_code=500, text='sensitive-provider-response')
        booking = self.create_booking(23, 'storage-failure')
        response = self.submit_payment(booking, 'FAILURE')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('sensitive-provider-response', str(response.data))
        self.assertFalse(Payment.objects.filter(booking=booking).exists())

    @patch('payment.storage.requests.get')
    @patch('payment.storage.requests.post')
    def test_receipt_endpoint_distinguishes_missing_object_from_storage_failure(self, storage_post, storage_get):
        storage_post.return_value = Mock(status_code=200)
        booking = self.create_booking(26, 'receipt-retrieval-errors')
        submitted = self.submit_payment(booking, 'RETRIEVAL')
        self.assertEqual(submitted.status_code, 201, submitted.data)

        storage_get.return_value = Mock(status_code=500)
        unavailable = self.client.get(submitted.data['receipt_url'])
        self.assertEqual(unavailable.status_code, 503)
        self.assertEqual(unavailable.data['detail'], 'Payment proof storage is temporarily unavailable.')

        storage_get.return_value = Mock(status_code=404)
        missing = self.client.get(submitted.data['receipt_url'])
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.data['detail'], 'Payment proof not found.')

    def test_declared_image_type_must_match_file_contents(self):
        booking = self.create_booking(24, 'invalid-type')
        response = self.client.post('/api/bookings/payments/', {
            'booking': booking.pk,
            'reference_number': 'PROOF-REF-MISMATCH',
            'amount': '500.00',
            'method': 'GCASH',
            'receipt': receipt_image(content_type='image/jpeg'),
        }, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('receipt', response.data)
        self.assertFalse(Payment.objects.filter(booking=booking).exists())

    def test_oversized_receipt_is_rejected_before_storage(self):
        booking = self.create_booking(25, 'oversized')
        oversized = SimpleUploadedFile(
            'large.png', b'\x89PNG\r\n\x1a\n' + b'0' * (5 * 1024 * 1024),
            content_type='image/png',
        )
        with patch('payment.storage.requests.post') as storage_post:
            response = self.client.post('/api/bookings/payments/', {
                'booking': booking.pk,
                'reference_number': 'PROOF-REF-TOO-LARGE',
                'amount': '500.00',
                'method': 'GCASH',
                'receipt': oversized,
            }, format='multipart')
        self.assertEqual(response.status_code, 400)
        storage_post.assert_not_called()
        self.assertFalse(Payment.objects.filter(booking=booking).exists())
