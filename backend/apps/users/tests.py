from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.test import TestCase, override_settings

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from unittest.mock import Mock, patch

from users.models import Customer, PasswordResetOTP
from audit.models import AuditLog
from users.sms_delivery import send_password_reset_otp, verify_password_reset_otp


class IProgSMSServicesTests(TestCase):
    @override_settings(IPROG_SMS_API_TOKEN='test-token', IPROG_SMS_API_BASE_URL='https://sms.example.test')
    @patch('users.sms_delivery.requests.post')
    def test_provider_calls_use_the_documented_otp_endpoints(self, mocked_post):
        mocked_post.return_value = Mock(status_code=200, json=Mock(return_value={'status': 'success'}))

        send_password_reset_otp('639171234567')
        self.assertEqual(mocked_post.call_args.args[0], 'https://sms.example.test/api/v1/otp/send_otp')
        send_payload = mocked_post.call_args.kwargs['json']
        self.assertEqual(send_payload['api_token'], 'test-token')
        self.assertEqual(send_payload['phone_number'], '639171234567')
        self.assertEqual(send_payload['code_length'], 6)

        self.assertTrue(verify_password_reset_otp('639171234567', '123456'))
        self.assertEqual(mocked_post.call_args.args[0], 'https://sms.example.test/api/v1/otp/verify_otp')
        verify_payload = mocked_post.call_args.kwargs['json']
        self.assertEqual(verify_payload['api_token'], 'test-token')
        self.assertEqual(verify_payload['otp'], '123456')


class PasswordResetSMSTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username='reset-customer',
            email='reset-customer@example.com',
            password='Customer123!',
            phone_number='09171234567',
        )
        self.client = APIClient()

    @patch('users.views.send_password_reset_otp')
    def test_registered_user_receives_a_generic_sms_reset_response(self, mocked_send):
        response = self.client.post('/api/auth/forgot-password/', {
            'phone_number': '0917 123 4567',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertIn('If that mobile number is registered', response.data['detail'])
        mocked_send.assert_called_once_with('639171234567')
        reset = PasswordResetOTP.objects.get(user=self.user)
        self.assertEqual(reset.phone_number, '639171234567')
        self.assertEqual(reset.otp_hash, '')

    @patch('users.views.send_password_reset_otp')
    def test_unregistered_mobile_gets_the_same_response(self, mocked_send):
        response = self.client.post('/api/auth/forgot-password/', {
            'phone_number': '09179999999',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIn('If that mobile number is registered', response.data['detail'])
        mocked_send.assert_not_called()

    @patch('users.views.verify_password_reset_otp', return_value=True)
    @patch('users.views.send_password_reset_otp')
    def test_otp_verification_and_password_reset_are_one_time(self, mocked_send, mocked_verify):
        self.client.post('/api/auth/forgot-password/', {'phone_number': '09171234567'}, format='json')
        verify_response = self.client.post('/api/auth/forgot-password/verify/', {
            'phone_number': '+63 917 123 4567',
            'otp': '123456',
        }, format='json')
        self.assertEqual(verify_response.status_code, 200)
        reset_token = verify_response.data['reset_token']
        mocked_verify.assert_called_once_with('639171234567', '123456')

        confirm_response = self.client.post('/api/auth/forgot-password/confirm/', {
            'phone_number': '639171234567',
            'reset_token': reset_token,
            'new_password': 'NewSecurePass123!',
        }, format='json')
        self.assertEqual(confirm_response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('NewSecurePass123!'))
        reset = PasswordResetOTP.objects.get(user=self.user)
        self.assertTrue(reset.used_at)
        self.assertEqual(reset.reset_token_hash, '')

        cache.clear()
        reused_response = self.client.post('/api/auth/forgot-password/confirm/', {
            'phone_number': '639171234567',
            'reset_token': reset_token,
            'new_password': 'AnotherSecurePass123!',
        }, format='json')
        self.assertEqual(reused_response.status_code, 400)

    @patch('users.views.verify_password_reset_otp', return_value=False)
    @patch('users.views.send_password_reset_otp')
    def test_incorrect_otp_increments_attempts(self, mocked_send, mocked_verify):
        self.client.post('/api/auth/forgot-password/', {'phone_number': '09171234567'}, format='json')
        response = self.client.post('/api/auth/forgot-password/verify/', {
            'phone_number': '09171234567',
            'otp': '000000',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(PasswordResetOTP.objects.get(user=self.user).attempts, 1)


class AccountCrudTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username='accounts-admin',
            email='admin@example.com',
            password='AdminPass123!',
            role='ADMIN',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_admin_can_create_and_update_a_complete_customer_account(self):
        create_response = self.client.post('/api/auth/users/', {
            'username': 'complete-customer',
            'password': 'CustomerPass123!',
            'email': 'customer@example.com',
            'first_name': 'Complete',
            'last_name': 'Customer',
            'phone_number': '09171234567',
            'address': 'Cavite City',
            'role': 'CUSTOMER',
        }, format='json')

        self.assertEqual(create_response.status_code, 201)
        customer_id = create_response.data['id']
        self.assertEqual(create_response.data['registration_method'], 'ADMIN')
        self.assertEqual(Customer.objects.filter(user_id=customer_id).count(), 1)
        self.assertEqual(create_response.data['address'], 'Cavite City')
        self.assertTrue(AuditLog.objects.filter(
            user=self.admin,
            action='ADMIN_ACCOUNT_CREATE',
            metadata__target_user_id=customer_id,
            metadata__registration_method='ADMIN',
        ).exists())

        update_response = self.client.patch(f'/api/auth/users/{customer_id}/', {
            'first_name': 'Updated',
            'phone_number': '09179876543',
            'address': 'Imus, Cavite',
        }, format='json')

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data['first_name'], 'Updated')
        self.assertEqual(update_response.data['phone_number'], '09179876543')
        self.assertEqual(update_response.data['address'], 'Imus, Cavite')
        self.assertEqual(Customer.objects.filter(user_id=customer_id).count(), 1)
        self.assertTrue(AuditLog.objects.filter(
            user=self.admin,
            action='ADMIN_ACCOUNT_UPDATE',
            metadata__target_user_id=customer_id,
        ).exists())

    def test_registration_form_persists_its_registration_method(self):
        anonymous_client = APIClient()
        response = anonymous_client.post('/api/auth/register/', {
            'username': 'form-customer',
            'password': 'FormCustomer123!',
            'email': 'form-customer@example.com',
            'first_name': 'Form',
            'last_name': 'Customer',
            'phone_number': '09171234567',
            'address': 'Cavite City',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['user']['registration_method'], 'FORM')
        self.assertTrue(AuditLog.objects.filter(
            action='CUSTOMER_REGISTER',
            metadata__registration_method='FORM',
        ).exists())

    def test_customer_profile_update_keeps_one_customer_profile(self):
        customer = get_user_model().objects.create_user(
            username='profile-customer',
            email='profile@example.com',
            password='CustomerPass123!',
            first_name='Profile',
            last_name='Customer',
            phone_number='09171234567',
            address='Bacoor, Cavite',
            role='CUSTOMER',
        )
        Customer.objects.filter(user=customer).delete()

        self.client.force_authenticate(customer)
        response = self.client.patch('/api/auth/profile/', {
            'email': 'updated-profile@example.com',
            'first_name': 'Updated',
            'phone_number': '09179876543',
            'address': 'Dasmarinas, Cavite',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        customer.refresh_from_db()
        self.assertEqual(customer.email, 'updated-profile@example.com')
        self.assertEqual(customer.first_name, 'Updated')
        self.assertEqual(customer.address, 'Dasmarinas, Cavite')
        self.assertEqual(Customer.objects.filter(user=customer).count(), 1)

    def test_customer_can_update_all_registration_fields_and_password(self):
        customer = get_user_model().objects.create_user(
            username='editable-customer',
            email='editable@example.com',
            password='CustomerPass123!',
            first_name='Editable',
            last_name='Customer',
            phone_number='09171234567',
            address='Cavite City',
            role='CUSTOMER',
        )
        Customer.objects.get_or_create(user=customer)

        self.client.force_authenticate(customer)
        response = self.client.patch('/api/auth/profile/', {
            'username': 'updated-customer',
            'email': 'updated-customer@example.com',
            'first_name': 'Updated',
            'last_name': 'Profile',
            'phone_number': '09179876543',
            'address': 'Imus, Cavite',
            'current_password': 'CustomerPass123!',
            'new_password': 'UpdatedPass123!',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        customer.refresh_from_db()
        self.assertEqual(customer.username, 'updated-customer')
        self.assertEqual(customer.email, 'updated-customer@example.com')
        self.assertEqual(customer.first_name, 'Updated')
        self.assertEqual(customer.last_name, 'Profile')
        self.assertEqual(customer.phone_number, '09179876543')
        self.assertEqual(customer.address, 'Imus, Cavite')
        self.assertTrue(customer.check_password('UpdatedPass123!'))


class SecurityBoundaryTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='security-customer',
            email='security-customer@example.com',
            password='CustomerPass123!',
            role='CUSTOMER',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.customer)

    def test_customer_cannot_access_administrative_or_operational_data(self):
        for path in [
            '/api/auth/users/',
            '/api/inventory/ingredients/',
            '/api/pos/orders/',
            '/api/pos/end-of-day-summary/',
            '/api/dashboard/analytics/',
            '/api/forecasting/predictions/',
        ]:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)

    def test_customer_cannot_modify_chatbot_faqs(self):
        response = self.client.post('/api/chatbot/faqs/', {
            'question': 'Can I edit this?',
            'answer': 'No.',
        }, format='json')
        self.assertEqual(response.status_code, 403)

    def test_profile_rejects_non_image_uploads(self):
        response = self.client.patch('/api/auth/profile/', {
            'profile_picture': SimpleUploadedFile(
                'not-an-image.jpg', b'not an image', content_type='image/jpeg'
            ),
        }, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('profile_picture', response.data)
