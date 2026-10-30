import json

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from unittest.mock import Mock, patch

from users.models import Customer, PasswordResetOTP, PrivacyConsent, PrivacyRequest
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
        self.assertEqual(send_payload['expires_in_minutes'], 10)

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
        self.assertIn('If this mobile number matches an account', response.data['detail'])
        mocked_send.assert_called_once_with('639171234567')
        reset = PasswordResetOTP.objects.get(user=self.user)
        self.assertEqual(reset.phone_number, '639171234567')
        self.assertEqual(reset.otp_hash, '')
        self.assertEqual(response.data['resend_cooldown_seconds'], 60)

    @patch('users.views.send_password_reset_otp')
    def test_password_reset_resend_invalidates_the_previous_code_and_renews_expiry(self, mocked_send):
        first_response = self.client.post('/api/auth/forgot-password/', {'phone_number': '09171234567'}, format='json')
        self.assertEqual(first_response.status_code, 200)
        first_otp = PasswordResetOTP.objects.get(user=self.user)
        PasswordResetOTP.objects.filter(pk=first_otp.pk).update(
            created_at=timezone.now() - timezone.timedelta(seconds=61),
        )

        resend_response = self.client.post('/api/auth/forgot-password/', {'phone_number': '09171234567'}, format='json')

        self.assertEqual(resend_response.status_code, 200)
        self.assertEqual(resend_response.data['resend_cooldown_seconds'], 60)
        self.assertEqual(mocked_send.call_count, 2)
        first_otp.refresh_from_db()
        self.assertIsNotNone(first_otp.used_at)
        current = PasswordResetOTP.objects.filter(user=self.user, used_at__isnull=True).get()
        self.assertGreater(current.expires_at, first_otp.expires_at)
        self.assertEqual(current.attempts, 0)

    @patch('users.views.verify_password_reset_otp')
    @patch('users.views.send_password_reset_otp')
    def test_expired_password_reset_otp_is_rejected_before_provider_verification(self, mocked_send, mocked_verify):
        self.client.post('/api/auth/forgot-password/', {'phone_number': '09171234567'}, format='json')
        PasswordResetOTP.objects.filter(user=self.user).update(
            expires_at=timezone.now() - timezone.timedelta(seconds=1),
        )

        response = self.client.post('/api/auth/forgot-password/verify/', {
            'phone_number': '09171234567',
            'otp': '123456',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['detail'], 'Invalid or expired OTP.')
        mocked_verify.assert_not_called()

    @patch('users.views.send_password_reset_otp')
    def test_unregistered_mobile_gets_the_same_response(self, mocked_send):
        response = self.client.post('/api/auth/forgot-password/', {
            'phone_number': '09179999999',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIn('If this mobile number matches an account', response.data['detail'])
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
        # Throttle/cache state isn't rolled back by Django's database TestCase.
        cache.clear()
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
            'privacy_consent': True,
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

    @patch('users.views.verify_password_reset_otp', side_effect=[False, True])
    @patch('users.views.send_password_reset_otp')
    def test_registration_requires_verified_otp_before_creating_account(self, mocked_send, mocked_verify):
        anonymous_client = APIClient()
        response = anonymous_client.post('/api/auth/register/', {
            'username': 'form-customer',
            'password': 'FormCustomer123!',
            'email': 'form-customer@example.com',
            'first_name': 'Form',
            'last_name': 'Customer',
            'phone_number': '09171234567',
            'address': 'Cavite City',
            'privacy_consent': True,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(username='form-customer').exists())
        mocked_send.assert_called_once_with('639171234567', purpose='registration')

        invalid_response = anonymous_client.post('/api/auth/register/verify/', {
            'registration_token': response.data['registration_token'],
            'otp': '000000',
            'privacy_consent': True,
        }, format='json')
        self.assertEqual(invalid_response.status_code, 400)
        self.assertIn('Invalid or expired OTP', invalid_response.data['detail'])
        self.assertFalse(get_user_model().objects.filter(username='form-customer').exists())

        verify_response = anonymous_client.post('/api/auth/register/verify/', {
            'registration_token': response.data['registration_token'],
            'otp': '123456',
            'privacy_consent': True,
        }, format='json')

        self.assertEqual(verify_response.status_code, 201)
        self.assertEqual(verify_response.data['user']['registration_method'], 'FORM')
        self.assertEqual(mocked_verify.call_count, 2)
        mocked_verify.assert_called_with('639171234567', '123456')
        self.assertTrue(AuditLog.objects.filter(
            action='CUSTOMER_REGISTER',
            metadata__registration_method='FORM',
        ).exists())

    @patch('users.views.send_password_reset_otp')
    def test_registration_otp_resend_is_cooldown_limited_and_renews_expiry(self, mocked_send):
        client = APIClient()
        started = client.post('/api/auth/register/', {
            'username': 'resend-customer',
            'password': 'FormCustomer123!',
            'email': 'resend-customer@example.com',
            'phone_number': '09179998888',
            'privacy_consent': True,
        }, format='json')
        self.assertEqual(started.status_code, 200)
        token = started.data['registration_token']
        pending_key = f'registration_otp:{token}'

        early = client.post('/api/auth/register/resend/', {'registration_token': token}, format='json')
        self.assertEqual(early.status_code, 429)
        self.assertGreater(early.data['retry_after_seconds'], 0)
        self.assertEqual(mocked_send.call_count, 1)

        pending = cache.get(pending_key)
        old_expiry = pending['expires_at']
        pending['last_otp_sent_at'] -= 61
        pending['attempts'] = 5
        cache.set(pending_key, pending, timeout=600)
        with patch('users.views.reserve_otp_send', return_value=(True, 0)):
            resent = client.post('/api/auth/register/resend/', {'registration_token': token}, format='json')

        self.assertEqual(resent.status_code, 200)
        self.assertEqual(resent.data['expires_in_minutes'], 10)
        self.assertEqual(mocked_send.call_count, 2)
        mocked_send.assert_called_with('639179998888', purpose='registration')
        renewed = cache.get(pending_key)
        self.assertGreater(renewed['expires_at'], old_expiry)
        self.assertEqual(renewed['attempts'], 0)

    @patch('users.views.verify_password_reset_otp')
    @patch('users.views.send_password_reset_otp')
    def test_expired_registration_challenge_cannot_resend_or_create_an_account(self, mocked_send, mocked_verify):
        response = APIClient().post('/api/auth/register/', {
            'username': 'expired-registration',
            'password': 'FormCustomer123!',
            'email': 'expired-registration@example.com',
            'phone_number': '09179997777',
            'privacy_consent': True,
        }, format='json')
        token = response.data['registration_token']
        key = f'registration_otp:{token}'
        pending = cache.get(key)
        pending['expires_at'] = timezone.now().timestamp() - 1
        cache.set(key, pending, timeout=30)

        resend = APIClient().post('/api/auth/register/resend/', {'registration_token': token}, format='json')
        verify = APIClient().post('/api/auth/register/verify/', {
            'registration_token': token,
            'otp': '123456',
            'privacy_consent': True,
        }, format='json')

        self.assertEqual(resend.status_code, 400)
        self.assertEqual(verify.status_code, 400)
        self.assertFalse(get_user_model().objects.filter(username='expired-registration').exists())
        self.assertEqual(mocked_send.call_count, 1)
        mocked_verify.assert_not_called()

    @patch('users.views.send_password_reset_otp')
    def test_registration_rejects_duplicate_username_email_and_phone_before_otp(self, mocked_send):
        get_user_model().objects.create_user(
            username='phone-owner',
            email='phone-owner@example.com',
            password='PhoneOwner123!',
            phone_number='09171234567',
        )
        base = {
            'username': 'new-registration',
            'password': 'FormCustomer123!',
            'email': 'new-registration@example.com',
            'phone_number': '09179876543',
            'privacy_consent': True,
        }
        for field, value in {
            'username': 'accounts-admin',
            'email': 'admin@example.com',
            'phone_number': '+63 917 123 4567',
        }.items():
            payload = {**base, field: value}
            response = APIClient().post('/api/auth/register/', payload, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn(field, response.data)
        mocked_send.assert_not_called()

    @patch('users.views.send_password_reset_otp')
    def test_registration_requires_a_philippine_mobile_number_before_otp(self, mocked_send):
        response = APIClient().post('/api/auth/register/', {
            'username': 'missing-phone',
            'password': 'FormCustomer123!',
            'email': 'missing-phone@example.com',
            'privacy_consent': True,
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('phone_number', response.data)
        mocked_send.assert_not_called()
        self.assertFalse(get_user_model().objects.filter(username='missing-phone').exists())

    def test_login_uses_httponly_cookies_and_logout_revokes_refresh(self):
        admin = get_user_model().objects.create_user(
            username='cookie-customer',
            email='cookie-customer@example.com',
            password='CookieCustomer123!',
            role='CUSTOMER',
        )
        client = APIClient()
        login_response = client.post('/api/auth/login/', {'username': admin.username, 'password': 'CookieCustomer123!'}, format='json')
        self.assertEqual(login_response.status_code, 200)
        self.assertNotIn('access', login_response.data)
        self.assertNotIn('refresh', login_response.data)
        self.assertTrue(login_response.cookies['cav_access']['httponly'])
        self.assertTrue(login_response.cookies['cav_refresh']['httponly'])
        self.assertEqual(client.get('/api/auth/profile/').status_code, 200)
        refresh_value = client.cookies['cav_refresh'].value
        logout_response = client.post('/api/auth/logout/', format='json')
        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(client.post('/api/auth/token/refresh/', format='json').status_code, 401)
        self.assertEqual(client.cookies.get('cav_refresh').value, '')

    def test_cross_origin_csrf_bootstrap_returns_a_token_and_cors_headers(self):
        response = self.client.get(
            '/api/auth/csrf/',
            HTTP_ORIGIN='https://cav-photostudio-and-cafe-frontend.onrender.com',
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)['csrf_token'])
        self.assertTrue(response.cookies['csrftoken'].value)
        self.assertEqual(
            response.headers['Access-Control-Allow-Origin'],
            'https://cav-photostudio-and-cafe-frontend.onrender.com',
        )
        self.assertEqual(response.headers['Access-Control-Allow-Credentials'], 'true')

    @override_settings(IPROG_SMS_API_TOKEN='test-token')
    @patch('users.views.verify_password_reset_otp', side_effect=[False, True])
    @patch('users.views.send_password_reset_otp')
    def test_admin_login_requires_valid_sms_otp(self, mocked_send, mocked_verify):
        cache.clear()
        self.admin.phone_number = '09171234567'
        self.admin.save(update_fields=['phone_number'])
        client = APIClient()
        client.cookies['cav_access'] = str(RefreshToken.for_user(self.admin).access_token)

        challenge_response = client.post('/api/auth/login/', {
            'username': self.admin.username,
            'password': 'AdminPass123!',
        }, format='json')
        self.assertEqual(challenge_response.status_code, 202)
        self.assertEqual(challenge_response.data['mfa_method'], 'sms')
        self.assertEqual(challenge_response.data['mfa_methods'], ['sms'])
        self.assertEqual(challenge_response.data['resend_cooldown_seconds'], 60)
        mocked_send.assert_called_once_with('639171234567', purpose='admin security verification')

        token = challenge_response.data['mfa_token']
        pending_key = f'admin_mfa:{token}'
        early_resend = client.post('/api/auth/login/mfa/resend/', {'mfa_token': token}, format='json')
        self.assertEqual(early_resend.status_code, 429)
        self.assertGreater(early_resend.data['retry_after_seconds'], 0)
        self.assertEqual(mocked_send.call_count, 1)

        pending = cache.get(pending_key)
        original_expiry = pending['expires_at']
        pending['last_otp_sent_at'] -= 61
        pending['attempts'] = 5
        cache.set(pending_key, pending, timeout=600)
        with patch('users.views.reserve_otp_send', return_value=(True, 0)):
            resend = client.post('/api/auth/login/mfa/resend/', {'mfa_token': token}, format='json')
        self.assertEqual(resend.status_code, 200)
        self.assertEqual(resend.data['resend_cooldown_seconds'], 60)
        self.assertEqual(mocked_send.call_count, 2)
        renewed = cache.get(pending_key)
        self.assertGreater(renewed['expires_at'], original_expiry)
        self.assertEqual(renewed['attempts'], 0)
        mocked_send.assert_called_with('639171234567', purpose='admin security verification')

        invalid_response = client.post('/api/auth/login/', {
            'username': self.admin.username,
            'password': 'AdminPass123!',
            'mfa_token': token,
            'mfa_code': '000000',
        }, format='json')
        self.assertEqual(invalid_response.status_code, 400)
        self.assertNotIn('cav_access', invalid_response.cookies)

        login_response = client.post('/api/auth/login/', {
            'username': self.admin.username,
            'password': 'AdminPass123!',
            'mfa_token': token,
            'mfa_code': '123456',
        }, format='json')
        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(mocked_verify.call_args_list[0].args, ('639171234567', '000000'))
        self.assertEqual(mocked_verify.call_args_list[1].args, ('639171234567', '123456'))
        self.assertTrue(login_response.cookies['cav_access']['httponly'])

    @override_settings(IPROG_SMS_API_TOKEN='test-token')
    @patch('users.views.verify_password_reset_otp')
    @patch('users.views.send_password_reset_otp')
    def test_expired_admin_mfa_challenge_cannot_resend_or_complete_login(self, mocked_send, mocked_verify):
        cache.clear()
        self.admin.phone_number = '09171234567'
        self.admin.save(update_fields=['phone_number'])
        client = APIClient()
        challenge = client.post('/api/auth/login/', {
            'username': self.admin.username,
            'password': 'AdminPass123!',
        }, format='json')
        token = challenge.data['mfa_token']
        key = f'admin_mfa:{token}'
        pending = cache.get(key)
        pending['expires_at'] = timezone.now().timestamp() - 1
        cache.set(key, pending, timeout=30)

        resend = client.post('/api/auth/login/mfa/resend/', {'mfa_token': token}, format='json')
        verify = client.post('/api/auth/login/', {
            'username': self.admin.username,
            'password': 'AdminPass123!',
            'mfa_token': token,
            'mfa_code': '123456',
        }, format='json')

        self.assertEqual(resend.status_code, 400)
        self.assertEqual(verify.status_code, 400)
        self.assertEqual(mocked_send.call_count, 1)
        mocked_verify.assert_not_called()

    def test_privacy_consent_request_and_export_are_user_scoped(self):
        consent_response = self.client.post('/api/privacy/consents/', {
            'consent_type': 'MARKETING',
            'policy_version': '2026-10-01',
            'granted': True,
        }, format='json')
        self.assertEqual(consent_response.status_code, 200)
        request_response = self.client.post('/api/privacy/requests/', {
            'request_type': 'ACCESS',
            'details': 'Please provide my account data.',
        }, format='json')
        self.assertEqual(request_response.status_code, 201)
        export_response = self.client.get('/api/privacy/export/')
        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response.data['user']['username'], self.admin.username)
        self.assertTrue(export_response.data['consents'])

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


@override_settings(GOOGLE_CLIENT_ID='google-client-id')
class GoogleAuthFlowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.profile = {
            'aud': 'google-client-id', 'iss': 'https://accounts.google.com',
            'email': 'verified.google@example.com', 'email_verified': 'true',
            'given_name': 'Google', 'family_name': 'Customer',
            'picture': 'https://lh3.googleusercontent.com/profile-picture',
        }

    def post_google(self, mocked_get, payload=None, profile=None):
        mocked_get.return_value = Mock(status_code=200, json=Mock(return_value=profile or self.profile))
        body = {'credential': 'verified-google-id-token'}
        body.update(payload or {})
        return self.client.post('/api/auth/google/', body, format='json')

    @patch('users.views.requests.get')
    def test_google_signup_without_phone_creates_customer_and_authenticates(self, mocked_get):
        response = self.post_google(mocked_get, {'privacy_consent': True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['created'])
        user = get_user_model().objects.get(email=self.profile['email'])
        self.assertEqual((user.first_name, user.last_name), ('Google', 'Customer'))
        self.assertEqual(user.profile_picture_external_url, self.profile['picture'])
        self.assertEqual(user.phone_number, '')
        self.assertEqual(user.registration_method, 'GOOGLE')
        self.assertFalse(user.has_usable_password())
        self.assertEqual(Customer.objects.filter(user=user).count(), 1)
        self.assertEqual(PrivacyConsent.objects.filter(user=user, withdrawn_at__isnull=True).count(), 2)
        self.assertEqual(response.data['id'], user.id)
        self.assertIn(settings.AUTH_ACCESS_COOKIE_NAME, response.cookies)
        self.assertIn(settings.AUTH_REFRESH_COOKIE_NAME, response.cookies)
        self.assertTrue(AuditLog.objects.filter(user=user, action='CUSTOMER_REGISTER_GOOGLE').exists())
        self.assertTrue(AuditLog.objects.filter(user=user, action='USER_LOGIN_GOOGLE').exists())

    @patch('users.views.requests.get')
    def test_google_signup_requires_consent_and_repeat_signin_reuses_same_account(self, mocked_get):
        refused = self.post_google(mocked_get, {'privacy_consent': False})
        self.assertEqual(refused.status_code, 400)
        self.assertIn('privacy_consent', refused.data)
        self.assertFalse(get_user_model().objects.filter(email__iexact=self.profile['email']).exists())
        created = self.post_google(mocked_get, {'privacy_consent': True})
        signed_in = self.post_google(mocked_get)
        self.assertEqual(created.status_code, 200)
        self.assertTrue(created.data['created'])
        self.assertEqual(signed_in.status_code, 200)
        self.assertFalse(signed_in.data['created'])
        self.assertEqual(signed_in.data['id'], created.data['id'])
        self.assertEqual(get_user_model().objects.filter(email__iexact=self.profile['email']).count(), 1)
        self.assertEqual(Customer.objects.filter(user_id=created.data['id']).count(), 1)

    @patch('users.views.requests.get')
    def test_google_rejects_invalid_supplied_phone_but_normalizes_valid_optional_phone(self, mocked_get):
        invalid = self.post_google(mocked_get, {'privacy_consent': True, 'phone_number': '555-0100'})
        self.assertEqual(invalid.status_code, 400)
        self.assertIn('phone_number', invalid.data)
        self.assertFalse(get_user_model().objects.filter(email__iexact=self.profile['email']).exists())
        valid = self.post_google(mocked_get, {'privacy_consent': True, 'phone_number': '+63 917 123 4567'})
        self.assertEqual(valid.status_code, 200, valid.data)
        self.assertEqual(get_user_model().objects.get(pk=valid.data['id']).phone_number, '639171234567')

    @patch('users.views.requests.get')
    def test_verified_google_email_signs_into_existing_account_without_overwriting_profile(self, mocked_get):
        user = get_user_model().objects.create_user(
            username='existing-google-email', email='VERIFIED.GOOGLE@example.com',
            password='ExistingPass123!', first_name='Existing', last_name='Profile',
            profile_picture_external_url='https://example.test/custom-avatar.png', registration_method='FORM',
        )
        response = self.post_google(mocked_get)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['created'])
        self.assertEqual(response.data['id'], user.id)
        user.refresh_from_db()
        self.assertEqual((user.first_name, user.last_name), ('Existing', 'Profile'))
        self.assertEqual(user.profile_picture_external_url, 'https://example.test/custom-avatar.png')
        self.assertEqual(get_user_model().objects.filter(email__iexact=self.profile['email']).count(), 1)

    @patch('users.views.requests.get')
    def test_google_rejects_unverified_email(self, mocked_get):
        profile = {**self.profile, 'email_verified': 'false'}
        response = self.post_google(mocked_get, {'privacy_consent': True}, profile=profile)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['detail'], 'Google account email must be verified.')
        self.assertFalse(get_user_model().objects.filter(email__iexact=self.profile['email']).exists())


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
            '/api/inventory/product-sales/',
            '/api/inventory/product-sales/transactions/?product_id=1&type=sales',
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


class AdminPrivacyRequestWorkflowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.customer = User.objects.create_user('privacy-customer', password='Customer123!', role='CUSTOMER')
        self.staff = User.objects.create_user('privacy-staff', password='Staff123!', role='STAFF')
        self.admin = User.objects.create_user('privacy-admin', password='Admin123!', role='ADMIN')
        self.privacy_request = PrivacyRequest.objects.create(
            user=self.customer,
            request_type='ACCESS',
            details='Please provide a copy of my data.',
        )
        self.client = APIClient()

    def test_admin_can_review_and_complete_case_with_audited_response(self):
        self.client.force_authenticate(self.admin)
        listed = self.client.get('/api/privacy/requests/admin/?status=OPEN')
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data[0]['id'], self.privacy_request.id)
        self.assertEqual(listed.data[0]['customer_name'], self.customer.username)

        in_progress = self.client.patch(
            f'/api/privacy/requests/admin/{self.privacy_request.id}/',
            {'status': 'IN_PROGRESS', 'response_notes': 'Identity verified; collecting the requested export.'},
            format='json',
        )
        self.assertEqual(in_progress.status_code, 200, in_progress.data)

        completed = self.client.patch(
            f'/api/privacy/requests/admin/{self.privacy_request.id}/',
            {'status': 'COMPLETED', 'response_notes': 'Secure export delivered to the verified account.'},
            format='json',
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        self.privacy_request.refresh_from_db()
        self.assertEqual(self.privacy_request.status, 'COMPLETED')
        self.assertIn('Secure export delivered', self.privacy_request.response_notes)
        self.assertGreaterEqual(AuditLog.objects.filter(action='PRIVACY_REQUEST_REVIEWED').count(), 2)

        reopened = self.client.patch(
            f'/api/privacy/requests/admin/{self.privacy_request.id}/',
            {'status': 'OPEN'},
            format='json',
        )
        self.assertEqual(reopened.status_code, 409)

    def test_privacy_queue_and_mutations_are_admin_only(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get('/api/privacy/requests/admin/').status_code, 403)
        self.assertEqual(self.client.patch(
            f'/api/privacy/requests/admin/{self.privacy_request.id}/',
            {'status': 'IN_PROGRESS'}, format='json',
        ).status_code, 403)

    def test_terminal_status_requires_response_notes_and_request_size_is_validated(self):
        self.client.force_authenticate(self.admin)
        missing_notes = self.client.patch(
            f'/api/privacy/requests/admin/{self.privacy_request.id}/',
            {'status': 'COMPLETED'}, format='json',
        )
        self.assertEqual(missing_notes.status_code, 400)

        too_long = self.client.post('/api/privacy/requests/', {
            'request_type': 'ACCESS', 'details': 'x' * 4001,
        }, format='json')
        self.assertEqual(too_long.status_code, 400)
