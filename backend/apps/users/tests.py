from django.core import mail
from django.test import TestCase, override_settings

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from users.models import PasswordResetOTP


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

# Create your tests here.
