from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from unittest.mock import Mock, patch

from users.models import Customer, PasswordResetOTP
from audit.models import AuditLog


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class PasswordResetEmailTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='reset-customer',
            email='reset-customer@example.com',
            password='Customer123!',
        )
        self.client = APIClient()

    def test_registered_user_receives_a_password_reset_otp_email(self):
        response = self.client.post('/api/auth/forgot-password/', {
            'email': self.user.email,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        self.assertIn('CAV password reset code', mail.outbox[0].subject)
        self.assertTrue(PasswordResetOTP.objects.filter(user=self.user, used_at__isnull=True).exists())

    @override_settings(
        EMAIL_PROVIDER='resend',
        RESEND_API_KEY='re_test_key',
        DEFAULT_FROM_EMAIL='CAV <onboarding@resend.dev>',
    )
    @patch('users.email_delivery.requests.post')
    def test_password_reset_can_use_resend_https_delivery(self, mocked_post):
        mocked_post.return_value = Mock(raise_for_status=Mock())

        response = self.client.post('/api/auth/forgot-password/', {
            'email': self.user.email,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked_post.call_count, 1)
        request_payload = mocked_post.call_args.kwargs['json']
        self.assertEqual(request_payload['to'], [self.user.email])
        self.assertIn('CAV password reset code', request_payload['subject'])


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
