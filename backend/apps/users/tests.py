from django.core import mail
from django.test import TestCase, override_settings

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from unittest.mock import Mock, patch

from users.models import Customer, PasswordResetOTP


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
        self.assertEqual(Customer.objects.filter(user_id=customer_id).count(), 1)
        self.assertEqual(create_response.data['address'], 'Cavite City')

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
