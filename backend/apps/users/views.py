import logging

from rest_framework import generics, permissions, status, views
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from users.serializers import (
    AccountSerializer,
    ProfileSerializer,
    UserSerializer,
    RegisterSerializer,
    RegistrationOTPVerifySerializer,
    is_phone_number_taken,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    PasswordResetConfirmSerializer,
)
from users.models import Customer, PasswordResetOTP, PrivacyConsent, PrivacyRequest
from users.permissions import IsAdmin
from users.sms_delivery import IProgSMSDeliveryError, send_password_reset_otp, verify_password_reset_otp
from users.phone_numbers import normalize_philippine_mobile_number
from audit.models import AuditLog
from booking.models import Booking
from inventory.models import InventoryEvent
from payment.models import Payment
from pos.models import Order
from notifications.models import Notification, NotificationDelivery, PushSubscription
import requests
import secrets

User = get_user_model()
logger = logging.getLogger(__name__)
PASSWORD_RESET_OTP_TTL_MINUTES = int(getattr(settings, 'PASSWORD_RESET_OTP_TTL_MINUTES', 10))
PASSWORD_RESET_OTP_MAX_ATTEMPTS = int(getattr(settings, 'PASSWORD_RESET_OTP_MAX_ATTEMPTS', 5))
PASSWORD_RESET_TOKEN_TTL_MINUTES = int(getattr(settings, 'PASSWORD_RESET_TOKEN_TTL_MINUTES', 10))
PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = int(getattr(settings, 'PASSWORD_RESET_RESEND_COOLDOWN_SECONDS', 60))
PASSWORD_RESET_MAX_REQUESTS_PER_HOUR = int(getattr(settings, 'PASSWORD_RESET_MAX_REQUESTS_PER_HOUR', 5))
SYSTEM_RESET_CONFIRMATION = 'RESET SYSTEM DATA'
SYSTEM_RESET_LOCK_KEY = 'system_data_reset_in_progress'
ADMIN_MFA_TTL_MINUTES = int(getattr(settings, 'ADMIN_MFA_TTL_MINUTES', 10))
ADMIN_MFA_MAX_ATTEMPTS = int(getattr(settings, 'ADMIN_MFA_MAX_ATTEMPTS', 5))


@ensure_csrf_cookie
def csrf_cookie_view(request):
    # Return the token as well as setting the cookie. A separately hosted SPA
    # cannot read document.cookie for the API origin, but it can safely echo
    # this token in the X-CSRFToken header on state-changing requests.
    return JsonResponse({'detail': 'CSRF cookie ready.', 'csrf_token': get_token(request)})


def set_auth_cookies(response, access, refresh=None, request=None):
    if request is not None:
        get_token(request)
    cookie_kwargs = {
        'httponly': True,
        'secure': settings.AUTH_COOKIE_SECURE,
        'samesite': settings.AUTH_COOKIE_SAMESITE,
        'domain': settings.AUTH_COOKIE_DOMAIN,
        'path': '/',
    }
    response.set_cookie(
        settings.AUTH_ACCESS_COOKIE_NAME,
        access,
        max_age=int(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds()),
        **cookie_kwargs,
    )
    if refresh:
        response.set_cookie(
            settings.AUTH_REFRESH_COOKIE_NAME,
            refresh,
            max_age=int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
            **cookie_kwargs,
        )
    return response


def remove_auth_cookies(response):
    response.delete_cookie(settings.AUTH_ACCESS_COOKIE_NAME, path='/', domain=settings.AUTH_COOKIE_DOMAIN, samesite=settings.AUTH_COOKIE_SAMESITE)
    response.delete_cookie(settings.AUTH_REFRESH_COOKIE_NAME, path='/', domain=settings.AUTH_COOKIE_DOMAIN, samesite=settings.AUTH_COOKIE_SAMESITE)
    return response


def get_admin_mfa_methods(user):
    if normalize_philippine_mobile_number(user.phone_number) and getattr(settings, 'IPROG_SMS_API_TOKEN', '').strip():
        return ['sms']
    return []


def create_admin_mfa_challenge(user, method='sms'):
    method = str(method or '').lower()
    phone_number = normalize_philippine_mobile_number(user.phone_number)
    if method == 'sms' and not phone_number:
        return None
    if method != 'sms':
        return None
    token = secrets.token_urlsafe(32)
    pending = {
        'user_id': user.pk,
        'method': method,
        'phone_number': phone_number,
        'attempts': 0,
        'expires_at': (timezone.now() + timezone.timedelta(minutes=ADMIN_MFA_TTL_MINUTES)).timestamp(),
    }
    send_password_reset_otp(phone_number, purpose='admin security verification')
    cache.set(f'admin_mfa:{token}', pending, timeout=ADMIN_MFA_TTL_MINUTES * 60)
    return token


def admin_mfa_is_valid(token, otp, user):
    pending = cache.get(f'admin_mfa:{token}')
    if (
        not pending
        or pending.get('user_id') != user.pk
        or pending.get('attempts', 0) >= ADMIN_MFA_MAX_ATTEMPTS
        or timezone.now().timestamp() >= pending.get('expires_at', 0)
    ):
        return False
    verified = verify_password_reset_otp(pending.get('phone_number', ''), otp)
    if not verified:
        pending['attempts'] = pending.get('attempts', 0) + 1
        remaining = max(1, int(pending['expires_at'] - timezone.now().timestamp()))
        cache.set(f'admin_mfa:{token}', pending, timeout=remaining)
        return False
    cache.delete(f'admin_mfa:{token}')
    return True


def begin_admin_mfa(request, user):
    methods = get_admin_mfa_methods(user)
    if not methods:
        return Response({'detail': 'Admin account needs a registered mobile number and configured SMS service for verification.'}, status=status.HTTP_400_BAD_REQUEST)
    method = str(request.data.get('mfa_method') or 'sms').lower()
    if method not in methods:
        return Response({'detail': 'Admin verification is available by SMS only.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        challenge = create_admin_mfa_challenge(user, method)
    except (IProgSMSDeliveryError, OSError):
        logger.exception('Admin MFA delivery failed.')
        return Response({'detail': 'Admin SMS verification could not be sent. Check the configured delivery service.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    if not challenge:
        return Response({'detail': 'The selected admin verification method is not configured.'}, status=status.HTTP_400_BAD_REQUEST)
    contact = normalize_philippine_mobile_number(user.phone_number)
    return Response({
        'mfa_required': True,
        'mfa_token': challenge,
        'mfa_method': method,
        'mfa_methods': methods,
        'contact_hint': mask_registration_contact(contact, 'phone'),
        'expires_in_minutes': ADMIN_MFA_TTL_MINUTES,
    }, status=status.HTTP_202_ACCEPTED)

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['role'] = user.role
        token['username'] = user.username
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data['role'] = self.user.role
        data['username'] = self.user.username
        data['email'] = self.user.email
        data['id'] = self.user.id
        data['profile_picture_url'] = UserSerializer(self.user, context=self.context).data.get('profile_picture_url', '')
        
        return data

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    authentication_classes = []
    throttle_scope = 'auth'

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            user = User.objects.filter(pk=response.data.get('id')).first()
            mfa_token = request.data.get('mfa_token')
            mfa_code = str(request.data.get('mfa_code') or '')
            if user and user.role == 'ADMIN' and not mfa_token:
                return begin_admin_mfa(request, user)
            if user and user.role == 'ADMIN':
                try:
                    valid_mfa = len(mfa_code) == 6 and admin_mfa_is_valid(mfa_token, mfa_code, user)
                except IProgSMSDeliveryError:
                    logger.exception('Admin SMS MFA verification failed.')
                    return Response({'detail': 'Admin SMS verification is temporarily unavailable. Please try again later.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
                if not valid_mfa:
                    return Response({'detail': 'Invalid or expired admin verification code.'}, status=status.HTTP_400_BAD_REQUEST)
            access = response.data.pop('access', None)
            refresh = response.data.pop('refresh', None)
            if access and refresh:
                set_auth_cookies(response, access, refresh, request)
                AuditLog.objects.create(
                    user=user,
                    action='USER_LOGIN',
                    description=f'User {user.username} logged in successfully.',
                    ip_address=get_client_ip(request),
                )
        return response


class CookieTokenRefreshView(TokenRefreshView):
    """Rotate the refresh cookie without returning JWTs to browser JavaScript."""

    def post(self, request, *args, **kwargs):
        refresh = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if not refresh:
            return Response({'detail': 'Refresh session not found.'}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = self.get_serializer(data={'refresh': refresh})
        serializer.is_valid(raise_exception=True)
        access = serializer.validated_data.pop('access', None)
        rotated_refresh = serializer.validated_data.pop('refresh', None)
        response = Response({}, status=status.HTTP_200_OK)
        if access:
            set_auth_cookies(response, access, rotated_refresh, request)
        return response


class LogoutView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        refresh = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                logger.info('Logout received an expired or already revoked refresh token.', exc_info=True)
        return remove_auth_cookies(Response({'detail': 'Signed out securely.'}, status=status.HTTP_200_OK))

class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth'

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not data.get('privacy_consent'):
            return Response({'privacy_consent': 'Accept the privacy notice before creating an account.'}, status=status.HTTP_400_BAD_REQUEST)
        phone_number = normalize_philippine_mobile_number(data.get('phone_number'))
        contact_type = 'phone'
        contact = phone_number
        registration_token = secrets.token_urlsafe(32)
        pending = {
            'username': data['username'],
            'email': data['email'],
            'first_name': data.get('first_name', ''),
            'last_name': data.get('last_name', ''),
            'phone_number': phone_number,
            'address': data.get('address', ''),
            'password_hash': make_password(data['password']),
            'contact_type': contact_type,
            'contact': contact,
            'attempts': 0,
            'expires_at': (timezone.now() + timezone.timedelta(minutes=PASSWORD_RESET_OTP_TTL_MINUTES)).timestamp(),
        }

        try:
            send_password_reset_otp(contact, purpose='registration')
        except (IProgSMSDeliveryError, OSError):
            logger.exception('Registration OTP delivery failed.')
            return Response(
                {'detail': 'We could not send the verification code. Please try again later.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        cache.set(
            f'registration_otp:{registration_token}',
            pending,
            timeout=PASSWORD_RESET_OTP_TTL_MINUTES * 60,
        )
        return Response({
            'message': 'Verification code sent. Verify it to finish creating your account.',
            'registration_token': registration_token,
            'contact_type': contact_type,
            'contact_hint': mask_registration_contact(contact, contact_type),
            'expires_in_minutes': PASSWORD_RESET_OTP_TTL_MINUTES,
        }, status=status.HTTP_200_OK)


class RegistrationOTPVerifyView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = RegistrationOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data['registration_token']
        otp = serializer.validated_data['otp']
        if not serializer.validated_data.get('privacy_consent'):
            return Response({'privacy_consent': 'Accept the privacy notice before creating an account.'}, status=status.HTTP_400_BAD_REQUEST)
        cache_key = f'registration_otp:{token}'
        pending = cache.get(cache_key)
        invalid_response = {'detail': 'Invalid or expired OTP. Registration was not completed.'}

        if (
            not pending
            or pending.get('attempts', 0) >= PASSWORD_RESET_OTP_MAX_ATTEMPTS
            or timezone.now().timestamp() >= pending.get('expires_at', 0)
        ):
            return Response(invalid_response, status=status.HTTP_400_BAD_REQUEST)

        if pending.get('contact_type') != 'phone':
            return Response(invalid_response, status=status.HTTP_400_BAD_REQUEST)
        try:
            verified = verify_password_reset_otp(pending['contact'], otp)
        except IProgSMSDeliveryError:
            logger.exception('Registration OTP verification failed at provider.')
            return Response(
                {'detail': 'OTP verification is temporarily unavailable. Please try again later.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not verified:
            pending['attempts'] = pending.get('attempts', 0) + 1
            remaining_seconds = max(1, int(pending['expires_at'] - timezone.now().timestamp()))
            cache.set(cache_key, pending, timeout=remaining_seconds)
            return Response(invalid_response, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                if User.objects.filter(username__iexact=pending['username']).exists():
                    return Response({'username': 'Username already exists.'}, status=status.HTTP_400_BAD_REQUEST)
                if User.objects.filter(email__iexact=pending['email']).exists():
                    return Response({'email': 'Email already exists.'}, status=status.HTTP_400_BAD_REQUEST)
                if is_phone_number_taken(pending.get('phone_number')):
                    return Response({'phone_number': 'Phone number already exists.'}, status=status.HTTP_400_BAD_REQUEST)
                registration_method = pending.get('registration_method', User.RegistrationMethod.FORM)
                user = User(
                    username=pending['username'],
                    password=pending['password_hash'],
                    email=pending['email'],
                    first_name=pending['first_name'],
                    last_name=pending['last_name'],
                    phone_number=normalize_philippine_mobile_number(pending['phone_number']) or pending['phone_number'],
                    address=pending['address'],
                    role='CUSTOMER',
                    registration_method=registration_method,
                )
                user.save()
                if registration_method == User.RegistrationMethod.GOOGLE:
                    user.set_unusable_password()
                    user.profile_picture_external_url = pending.get('profile_picture_external_url', '')
                    user.save(update_fields=['password', 'profile_picture_external_url'])
                Customer.objects.get_or_create(user=user)
                PrivacyConsent.objects.get_or_create(user=user, consent_type='PRIVACY_NOTICE', policy_version='2026-10-01', defaults={'source': 'registration'})
                PrivacyConsent.objects.get_or_create(user=user, consent_type='SERVICE_PROCESSING', policy_version='2026-10-01', defaults={'source': 'registration'})
                AuditLog.objects.create(
                    user=user,
                    action='CUSTOMER_REGISTER_GOOGLE' if registration_method == User.RegistrationMethod.GOOGLE else 'CUSTOMER_REGISTER',
                    description=f'New customer registered: {user.username}',
                    metadata={'registration_method': user.registration_method, 'target_user_id': user.id},
                    ip_address=get_client_ip(request),
                )
        except IntegrityError as exc:
            constraint = str(exc).lower()
            for field, label in (
                ('username', 'Username'),
                ('email', 'Email'),
                ('phone', 'Phone number'),
            ):
                if field in constraint:
                    return Response({f'{field}_number' if field == 'phone' else field: f'{label} already exists.'}, status=status.HTTP_400_BAD_REQUEST)
            return Response({'detail': 'An account with these details already exists.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Verified registration could not be completed.')
            return Response({'detail': 'Account creation failed. Please try registration again.'}, status=status.HTTP_400_BAD_REQUEST)

        cache.delete(cache_key)
        return Response(
            {'message': 'Registration successful. Please log in.', 'user': UserSerializer(user).data},
            status=status.HTTP_201_CREATED,
        )


def mask_registration_contact(contact, contact_type):
    if contact_type == 'phone':
        return f'••••••{contact[-4:]}'
    local, _, domain = contact.partition('@')
    return f'{local[:1]}•••@{domain}'

def build_auth_payload(user):
    refresh = RefreshToken.for_user(user)
    refresh['role'] = user.role
    refresh['username'] = user.username

    return {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
        'role': user.role,
        'username': user.username,
        'email': user.email,
        'id': user.id,
        'profile_picture_url': UserSerializer(user).data.get('profile_picture_url', ''),
    }

def unique_username_from_email(email):
    base = email.split('@')[0].strip().lower() or 'google-user'
    base = ''.join(ch if ch.isalnum() or ch in '._-' else '-' for ch in base)[:140]
    username = base
    suffix = 1
    while User.objects.filter(username=username).exists():
        suffix += 1
        username = f"{base}-{suffix}"
    return username

class GoogleAuthView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        credential = request.data.get('credential', '').strip()
        if not credential:
            return Response({"detail": "Google credential is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(credential) > 4096:
            return Response({"detail": "Google credential is too large."}, status=status.HTTP_400_BAD_REQUEST)

        if not settings.GOOGLE_CLIENT_ID:
            return Response({"detail": "Google authentication is not configured."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            verify_res = requests.get(
                'https://oauth2.googleapis.com/tokeninfo',
                params={'id_token': credential},
                timeout=10,
            )
        except requests.RequestException:
            return Response({"detail": "Could not verify Google credential."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if verify_res.status_code != 200:
            return Response({"detail": "Invalid Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        profile = verify_res.json()
        if profile.get('aud') != settings.GOOGLE_CLIENT_ID or profile.get('iss') not in {
            'accounts.google.com', 'https://accounts.google.com',
        }:
            return Response({"detail": "Invalid Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        email = profile.get('email', '').strip().lower()
        if not email or profile.get('email_verified') not in (True, 'true', 'True', '1'):
            return Response({"detail": "Google account email must be verified."}, status=status.HTTP_400_BAD_REQUEST)
        google_picture_url = (profile.get('picture') or '').strip()

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if not user:
            phone_number = normalize_philippine_mobile_number(request.data.get('phone_number'))
            if not phone_number:
                return Response(
                    {'phone_number': 'A valid Philippine mobile number is required for Google registration.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if is_phone_number_taken(phone_number):
                return Response({'phone_number': 'Phone number already exists.'}, status=status.HTTP_400_BAD_REQUEST)
            registration_token = secrets.token_urlsafe(32)
            pending = {
                'username': unique_username_from_email(email),
                'email': email,
                'first_name': profile.get('given_name', ''),
                'last_name': profile.get('family_name', ''),
                'phone_number': phone_number,
                'address': '',
                'password_hash': make_password(secrets.token_urlsafe(32)),
                'registration_method': User.RegistrationMethod.GOOGLE,
                'profile_picture_external_url': google_picture_url[:500],
                'contact_type': 'phone',
                'contact': phone_number,
                'attempts': 0,
                'expires_at': (timezone.now() + timezone.timedelta(minutes=PASSWORD_RESET_OTP_TTL_MINUTES)).timestamp(),
            }
            try:
                send_password_reset_otp(phone_number, purpose='registration')
            except (IProgSMSDeliveryError, OSError):
                logger.exception('Google registration OTP delivery failed.')
                return Response(
                    {'detail': 'We could not send the verification code. Please try again later.'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            cache.set(
                f'registration_otp:{registration_token}',
                pending,
                timeout=PASSWORD_RESET_OTP_TTL_MINUTES * 60,
            )
            return Response({
                'message': 'Verification code sent. Verify it to finish creating your account.',
                'pending_verification': True,
                'registration_token': registration_token,
                'contact_type': 'phone',
                'contact_hint': mask_registration_contact(phone_number, 'phone'),
                'expires_in_minutes': PASSWORD_RESET_OTP_TTL_MINUTES,
            }, status=status.HTTP_200_OK)

        if user.role == 'CUSTOMER':
            Customer.objects.get_or_create(user=user)

        if user.role == 'ADMIN':
            mfa_token = request.data.get('mfa_token')
            mfa_code = str(request.data.get('mfa_code') or '')
            if not mfa_token:
                return begin_admin_mfa(request, user)
            try:
                valid_mfa = len(mfa_code) == 6 and admin_mfa_is_valid(mfa_token, mfa_code, user)
            except IProgSMSDeliveryError:
                logger.exception('Admin SMS MFA verification failed.')
                return Response({'detail': 'Admin SMS verification is temporarily unavailable. Please try again later.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            if not valid_mfa:
                return Response({'detail': 'Invalid or expired admin verification code.'}, status=status.HTTP_400_BAD_REQUEST)

        if google_picture_url and not user.profile_picture and user.profile_picture_external_url != google_picture_url:
            user.profile_picture_external_url = google_picture_url[:500]
            user.save(update_fields=['profile_picture_external_url'])

        AuditLog.objects.create(
            user=user,
            action="USER_LOGIN_GOOGLE",
            description=f"User {user.username} logged in with Google."
        )

        payload = build_auth_payload(user)
        payload['created'] = created
        access = payload.pop('access', None)
        refresh = payload.pop('refresh', None)
        return set_auth_cookies(Response(payload, status=status.HTTP_200_OK), access, refresh, request)

class UserProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'sensitive'

    def get_object(self):
        user = self.request.user
        if user.role == 'CUSTOMER':
            Customer.objects.get_or_create(user=user)
        return user

    def perform_update(self, serializer):
        password_changed = bool(serializer.validated_data.get('new_password'))
        changed_fields = sorted(
            field for field in serializer.validated_data
            if field not in {'current_password', 'new_password', 'profile_picture', 'remove_profile_picture'}
        )
        user = serializer.save()
        if password_changed:
            for outstanding in OutstandingToken.objects.filter(user=user):
                BlacklistedToken.objects.get_or_create(token=outstanding)
        AuditLog.objects.create(
            user=user,
            action='USER_PASSWORD_CHANGE' if password_changed else 'USER_PROFILE_UPDATE',
            description=(
                'User changed their password.' if password_changed
                else f"User updated profile fields: {', '.join(changed_fields) or 'profile photo'}."
            ),
            ip_address=get_client_ip(self.request),
        )


class PrivacyConsentView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'sensitive'

    def get(self, request):
        return Response([
            {
                'id': item.id,
                'consent_type': item.consent_type,
                'policy_version': item.policy_version,
                'granted_at': item.granted_at,
                'withdrawn_at': item.withdrawn_at,
                'source': item.source,
            }
            for item in PrivacyConsent.objects.filter(user=request.user)
        ])

    def post(self, request):
        consent_type = str(request.data.get('consent_type') or '').strip().upper()
        version = str(request.data.get('policy_version') or '2026-10-01').strip()[:30]
        granted_value = request.data.get('granted', True)
        granted = granted_value if isinstance(granted_value, bool) else str(granted_value).strip().lower() not in {'false', '0', 'no', 'off'}
        valid_types = {value for value, _ in PrivacyConsent.CONSENT_TYPES}
        if consent_type not in valid_types:
            return Response({'consent_type': 'Unsupported consent type.'}, status=status.HTTP_400_BAD_REQUEST)
        consent, _ = PrivacyConsent.objects.get_or_create(
            user=request.user,
            consent_type=consent_type,
            policy_version=version,
            defaults={'source': 'web'},
        )
        consent.withdrawn_at = None if granted else timezone.now()
        consent.save(update_fields=['withdrawn_at'])
        AuditLog.objects.create(user=request.user, action='PRIVACY_CONSENT_UPDATED', description=f'{consent_type} consent updated.', metadata={'consent_type': consent_type, 'policy_version': version, 'granted': granted}, ip_address=get_client_ip(request))
        return Response({'detail': 'Consent preference saved.', 'granted': granted}, status=status.HTTP_200_OK)


class PrivacyRequestView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'sensitive'

    def get(self, request):
        return Response([
            {
                'id': item.id,
                'request_type': item.request_type,
                'details': item.details,
                'status': item.status,
                'response_notes': item.response_notes,
                'created_at': item.created_at,
                'updated_at': item.updated_at,
            }
            for item in PrivacyRequest.objects.filter(user=request.user)
        ])

    def post(self, request):
        request_type = str(request.data.get('request_type') or '').strip().upper()
        details = str(request.data.get('details') or '').strip()[:4000]
        valid_types = {value for value, _ in PrivacyRequest.REQUEST_TYPES}
        if request_type not in valid_types:
            return Response({'request_type': 'Unsupported privacy request type.'}, status=status.HTTP_400_BAD_REQUEST)
        item = PrivacyRequest.objects.create(user=request.user, request_type=request_type, details=details)
        AuditLog.objects.create(user=request.user, action='PRIVACY_REQUEST_CREATED', description=f'Privacy request created: {request_type}.', metadata={'request_id': item.id, 'request_type': request_type}, ip_address=get_client_ip(request))
        return Response({'id': item.id, 'request_type': item.request_type, 'status': item.status, 'created_at': item.created_at}, status=status.HTTP_201_CREATED)


class PrivacyExportView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'sensitive'

    def get(self, request):
        user = request.user
        bookings = Booking.objects.filter(customer=user).select_related('package', 'package__service')
        export = {
            'exported_at': timezone.now(),
            'user': UserSerializer(user, context={'request': request}).data,
            'bookings': [
                {
                    'id': booking.id,
                    'package': booking.package.name,
                    'service': booking.package.service.name,
                    'scheduled_date': booking.scheduled_date,
                    'scheduled_time': booking.scheduled_time,
                    'status': booking.status,
                    'notes': booking.notes,
                    'created_at': booking.created_at,
                }
                for booking in bookings
            ],
            'consents': list(PrivacyConsent.objects.filter(user=user).values('consent_type', 'policy_version', 'granted_at', 'withdrawn_at', 'source')),
            'privacy_requests': list(PrivacyRequest.objects.filter(user=user).values('request_type', 'details', 'status', 'response_notes', 'created_at', 'updated_at')),
        }
        AuditLog.objects.create(user=user, action='PRIVACY_EXPORT', description='User data export generated.', ip_address=get_client_ip(request))
        return Response(export)

class StaffListView(generics.ListCreateAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        return User.objects.all().order_by('role', 'username')

    def create(self, request, *args, **kwargs):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only Admins can create accounts."}, status=status.HTTP_403_FORBIDDEN)

        serializer = AccountSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        
        AuditLog.objects.create(
            user=request.user,
            action="ADMIN_ACCOUNT_CREATE",
            description=f"Created account {user.username} with role {user.role}.",
            metadata=account_audit_metadata(user),
            ip_address=get_client_ip(request),
        )
        
        return Response(AccountSerializer(user, context={'request': request}).data, status=status.HTTP_201_CREATED)

class StaffDetailView(views.APIView):
    permission_classes = [IsAdmin]

    def get_object(self, pk):
        try:
            return User.objects.get(pk=pk)
        except User.DoesNotExist:
            return None

    def patch(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only Admins can update staff accounts."}, status=status.HTTP_403_FORBIDDEN)

        user = self.get_object(pk)
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = AccountSerializer(user, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        changed_fields = account_changed_fields(user, serializer.validated_data)
        user = serializer.save()

        AuditLog.objects.create(
            user=request.user,
            action="ADMIN_ACCOUNT_UPDATE",
            description=f"Updated account {user.username} with role {user.role}.",
            metadata=account_audit_metadata(user, changed_fields=changed_fields),
            ip_address=get_client_ip(request),
        )

        return Response(AccountSerializer(user, context={'request': request}).data)

    def delete(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only Admins can delete staff accounts."}, status=status.HTTP_403_FORBIDDEN)

        user = self.get_object(pk)
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        if user.pk == request.user.pk:
            return Response({"detail": "You cannot delete your own account."}, status=status.HTTP_400_BAD_REQUEST)

        metadata = account_audit_metadata(user)
        username = user.username
        user.delete()

        AuditLog.objects.create(
            user=request.user,
            action="ADMIN_ACCOUNT_DELETE",
            description=f"Deleted account {username}.",
            metadata=metadata,
            ip_address=get_client_ip(request),
        )

        return Response(status=status.HTTP_204_NO_CONTENT)

def get_client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def account_audit_metadata(target, *, changed_fields=None):
    metadata = {
        'target_user_id': target.id,
        'target_username': target.username,
        'target_role': target.role,
        'registration_method': target.registration_method,
    }
    if changed_fields:
        metadata['changed_fields'] = sorted(changed_fields)
    return metadata


def account_changed_fields(user, validated_data):
    changed = []
    for field, value in validated_data.items():
        if field in {'remove_profile_picture', 'registration_method'}:
            continue
        if field == 'password':
            if value:
                changed.append('password')
        elif getattr(user, field, None) != value:
            changed.append(field)
    return changed

def generic_password_reset_response():
    return Response({
        "detail": "If that mobile number is registered, a one-time password has been sent."
    }, status=status.HTTP_200_OK)

def delete_queryset(label, queryset):
    count = queryset.count()
    queryset.delete()
    return label, count

class SystemDataResetView(views.APIView):
    permission_classes = [IsAdmin]
    throttle_scope = 'auth'

    def post(self, request):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can reset system data."}, status=status.HTTP_403_FORBIDDEN)

        admin_password = request.data.get('admin_password') or ''
        confirmation = (request.data.get('confirmation') or '').strip()

        if confirmation != SYSTEM_RESET_CONFIRMATION:
            return Response(
                {"confirmation": f'Type "{SYSTEM_RESET_CONFIRMATION}" to confirm.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not admin_password:
            return Response({"admin_password": "Admin password is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not cache.add(SYSTEM_RESET_LOCK_KEY, request.user.pk, timeout=300):
            return Response(
                {"detail": "A system reset is already in progress."},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            with transaction.atomic():
                admin_user = User.objects.select_for_update().get(pk=request.user.pk)
                if admin_user.role != 'ADMIN' or not admin_user.check_password(admin_password):
                    return Response({"detail": "Admin password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)

                deleted = dict([
                    delete_queryset('payments', Payment.objects.all()),
                    delete_queryset('pos_orders', Order.objects.all()),
                    delete_queryset('inventory_events', InventoryEvent.objects.all()),
                    delete_queryset('password_reset_otps', PasswordResetOTP.objects.all()),
                    delete_queryset('notification_deliveries', NotificationDelivery.objects.all()),
                    delete_queryset('push_subscriptions', PushSubscription.objects.all()),
                    delete_queryset('notifications', Notification.objects.all()),
                    delete_queryset('bookings', Booking.objects.all()),
                    delete_queryset('non_admin_users', User.objects.exclude(role='ADMIN')),
                ])

                deleted['audit_logs'] = 0
                AuditLog.objects.create(
                    user=admin_user,
                    action="SYSTEM_DATA_RESET",
                    description=(
                        f"Admin {admin_user.username} reset system data. "
                        f"Preserved services, packages, menu items, inventory catalog, FAQs, gallery, and admin accounts. "
                        f"Deleted counts: {deleted}"
                    ),
                    ip_address=get_client_ip(request),
                )

            return Response({
                "detail": "System data reset completed successfully.",
                "deleted": deleted,
                "preserved": [
                    "admin_accounts",
                    "services",
                    "packages",
                    "inventory_catalog",
                    "menu_products",
                    "ingredients",
                    "recipes",
                    "faqs",
                    "gallery",
                ],
            }, status=status.HTTP_200_OK)
        finally:
            cache.delete(SYSTEM_RESET_LOCK_KEY)

class ForgotPasswordView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data['phone_number']

        user = next(
            (
                candidate
                for candidate in User.objects.filter(is_active=True).exclude(phone_number='').only('id', 'email', 'username', 'phone_number')
                if normalize_philippine_mobile_number(candidate.phone_number) == phone_number
            ),
            None,
        )
        if not user:
            return generic_password_reset_response()

        now = timezone.now()
        recent_otp = PasswordResetOTP.objects.filter(
            phone_number=phone_number,
            created_at__gte=now - timezone.timedelta(seconds=PASSWORD_RESET_RESEND_COOLDOWN_SECONDS),
            used_at__isnull=True,
        ).first()
        if recent_otp:
            return generic_password_reset_response()

        recent_request_count = PasswordResetOTP.objects.filter(
            phone_number=phone_number,
            created_at__gte=now - timezone.timedelta(hours=1),
        ).count()
        if recent_request_count >= PASSWORD_RESET_MAX_REQUESTS_PER_HOUR:
            return generic_password_reset_response()

        expires_at = now + timezone.timedelta(minutes=PASSWORD_RESET_OTP_TTL_MINUTES)
        PasswordResetOTP.objects.filter(user=user, used_at__isnull=True).update(used_at=now)
        reset_otp = PasswordResetOTP.objects.create(
            user=user,
            email=user.email.lower(),
            phone_number=phone_number,
            expires_at=expires_at,
            request_ip=get_client_ip(request),
        )

        try:
            send_password_reset_otp(phone_number)
        except IProgSMSDeliveryError:
            logger.exception('Password reset SMS delivery failed for user_id=%s.', user.id)
            reset_otp.used_at = timezone.now()
            reset_otp.save(update_fields=['used_at'])
            return generic_password_reset_response()

        AuditLog.objects.create(
            user=user,
            action="PASSWORD_RESET_REQUEST",
            description=f"Password reset SMS OTP requested for user {user.username}.",
            ip_address=get_client_ip(request),
        )

        return Response({
            "detail": "If that mobile number is registered, a one-time password has been sent.",
        }, status=status.HTTP_200_OK)

class PasswordResetVerifyOTPView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data['phone_number']
        otp = serializer.validated_data['otp']

        with transaction.atomic():
            reset_otp = PasswordResetOTP.objects.select_for_update().filter(
                phone_number=phone_number,
                used_at__isnull=True,
                verified_at__isnull=True,
            ).select_related('user').order_by('-created_at').first()

            if (
                not reset_otp
                or reset_otp.is_expired
                or reset_otp.attempts >= PASSWORD_RESET_OTP_MAX_ATTEMPTS
                or not reset_otp.user.is_active
            ):
                return Response({"detail": "Invalid or expired OTP."}, status=status.HTTP_400_BAD_REQUEST)

            try:
                verified = verify_password_reset_otp(phone_number, otp)
            except IProgSMSDeliveryError:
                logger.exception('Password reset OTP verification failed at provider.')
                return Response(
                    {"detail": "OTP verification is temporarily unavailable. Please try again later."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )

            if not verified:
                reset_otp.attempts += 1
                reset_otp.save(update_fields=['attempts'])
                return Response({"detail": "Invalid or expired OTP."}, status=status.HTTP_400_BAD_REQUEST)

            reset_token = secrets.token_urlsafe(32)
            reset_otp.verified_at = timezone.now()
            reset_otp.reset_token_hash = make_password(reset_token)
            reset_otp.save(update_fields=['verified_at', 'reset_token_hash'])

        AuditLog.objects.create(
            user=reset_otp.user,
            action="PASSWORD_RESET_OTP_VERIFIED",
            description=f"Password reset OTP verified for user {reset_otp.user.username}.",
            ip_address=get_client_ip(request),
        )

        return Response({
            "detail": "OTP verified. You can now set a new password.",
            "reset_token": reset_token,
            "expires_in_minutes": PASSWORD_RESET_TOKEN_TTL_MINUTES,
        }, status=status.HTTP_200_OK)

class PasswordResetConfirmView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset'

    @transaction.atomic
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data['phone_number']
        reset_token = serializer.validated_data['reset_token']
        new_password = serializer.validated_data['new_password']

        reset_otp = PasswordResetOTP.objects.select_for_update().filter(
            phone_number=phone_number,
            used_at__isnull=True,
            verified_at__isnull=False,
        ).select_related('user').order_by('-verified_at').first()

        now = timezone.now()
        if (
            not reset_otp
            or reset_otp.is_expired
            or reset_otp.verified_at < now - timezone.timedelta(minutes=PASSWORD_RESET_TOKEN_TTL_MINUTES)
            or not check_password(reset_token, reset_otp.reset_token_hash)
            or not reset_otp.user.is_active
        ):
            return Response({"detail": "Invalid or expired reset session."}, status=status.HTTP_400_BAD_REQUEST)

        user = reset_otp.user
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response({"new_password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=['password'])
        reset_otp.used_at = now
        reset_otp.reset_token_hash = ''
        reset_otp.save(update_fields=['used_at', 'reset_token_hash'])
        PasswordResetOTP.objects.filter(user=user, used_at__isnull=True).exclude(pk=reset_otp.pk).update(used_at=now)

        AuditLog.objects.create(
            user=user,
            action="PASSWORD_RESET_COMPLETE",
            description=f"Password reset completed for user {user.username}.",
            ip_address=get_client_ip(request),
        )

        return Response({"detail": "Password updated successfully. You can now sign in."}, status=status.HTTP_200_OK)
