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
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from users.serializers import (
    AccountSerializer,
    ProfileSerializer,
    UserSerializer,
    RegisterSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    PasswordResetConfirmSerializer,
)
from users.models import Customer, PasswordResetOTP
from users.permissions import IsAdmin
from users.email_delivery import send_password_reset_email
from audit.models import AuditLog
from booking.models import Booking
from inventory.models import InventoryEvent
from payment.models import Payment
from pos.models import Order
import requests
import secrets

User = get_user_model()
logger = logging.getLogger(__name__)
PASSWORD_RESET_OTP_TTL_MINUTES = int(getattr(settings, 'PASSWORD_RESET_OTP_TTL_MINUTES', 10))
PASSWORD_RESET_OTP_MAX_ATTEMPTS = int(getattr(settings, 'PASSWORD_RESET_OTP_MAX_ATTEMPTS', 5))
PASSWORD_RESET_TOKEN_TTL_MINUTES = int(getattr(settings, 'PASSWORD_RESET_TOKEN_TTL_MINUTES', 10))
SYSTEM_RESET_CONFIRMATION = 'RESET SYSTEM DATA'
SYSTEM_RESET_LOCK_KEY = 'system_data_reset_in_progress'

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
        
        # Log login audit
        AuditLog.objects.create(
            user=self.user,
            action="USER_LOGIN",
            description=f"User {self.user.username} logged in successfully."
        )
        return data

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_scope = 'auth'

class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth'

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        
        # Log audit
        AuditLog.objects.create(
            user=user,
            action="CUSTOMER_REGISTER",
            description=f"New customer registered: {user.username}",
            metadata={'registration_method': user.registration_method, 'target_user_id': user.id},
            ip_address=get_client_ip(request),
        )
        
        return Response(
            {"message": "Registration successful.", "user": UserSerializer(user).data},
            status=status.HTTP_201_CREATED
        )

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
            user = User.objects.create_user(
                username=unique_username_from_email(email),
                email=email,
                first_name=profile.get('given_name', ''),
                last_name=profile.get('family_name', ''),
                role='CUSTOMER',
                registration_method=User.RegistrationMethod.GOOGLE,
            )
            user.set_unusable_password()
            user.profile_picture_external_url = google_picture_url[:500]
            user.save()
            Customer.objects.get_or_create(user=user)
            created = True
            AuditLog.objects.create(
                user=user,
                action="CUSTOMER_REGISTER_GOOGLE",
                description=f"New customer registered with Google: {user.username}",
                metadata={'registration_method': user.registration_method, 'target_user_id': user.id},
                ip_address=get_client_ip(request),
            )

        if user.role == 'CUSTOMER':
            Customer.objects.get_or_create(user=user)

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
        return Response(payload, status=status.HTTP_200_OK)

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
        "detail": "If that email is registered, a one-time password has been sent."
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
                    delete_queryset('bookings', Booking.objects.all()),
                    delete_queryset('non_admin_users', User.objects.exclude(role='ADMIN')),
                ])

                deleted['audit_logs'] = AuditLog.objects.count()
                AuditLog.objects.all().delete()
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
        email = serializer.validated_data['email']

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user or not user.email:
            return generic_password_reset_response()

        now = timezone.now()
        recent_otp = PasswordResetOTP.objects.filter(
            user=user,
            created_at__gte=now - timezone.timedelta(minutes=1),
            used_at__isnull=True,
        ).first()
        if recent_otp:
            return generic_password_reset_response()

        otp = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = now + timezone.timedelta(minutes=PASSWORD_RESET_OTP_TTL_MINUTES)
        PasswordResetOTP.objects.filter(user=user, used_at__isnull=True).update(used_at=now)
        reset_otp = PasswordResetOTP.objects.create(
            user=user,
            email=user.email.lower(),
            otp_hash=make_password(otp),
            expires_at=expires_at,
            request_ip=get_client_ip(request),
        )

        try:
            send_password_reset_email(user.email, otp)
        except Exception:
            logger.exception('Password reset email delivery failed for user_id=%s.', user.id)
            reset_otp.used_at = timezone.now()
            reset_otp.save(update_fields=['used_at'])
            return Response(
                {"detail": "Password reset email could not be sent right now. Please try again later."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        AuditLog.objects.create(
            user=user,
            action="PASSWORD_RESET_REQUEST",
            description=f"Password reset OTP requested for user {user.username}."
        )

        return Response({
            "detail": "If that email is registered, a one-time password has been sent.",
            "expires_in_minutes": PASSWORD_RESET_OTP_TTL_MINUTES,
            "request_id": reset_otp.id,
        }, status=status.HTTP_200_OK)

class PasswordResetVerifyOTPView(views.APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        otp = serializer.validated_data['otp']

        reset_otp = PasswordResetOTP.objects.filter(
            email__iexact=email,
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

        if not check_password(otp, reset_otp.otp_hash):
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
            description=f"Password reset OTP verified for user {reset_otp.user.username}."
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
        email = serializer.validated_data['email']
        reset_token = serializer.validated_data['reset_token']
        new_password = serializer.validated_data['new_password']

        reset_otp = PasswordResetOTP.objects.select_for_update().filter(
            email__iexact=email,
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
        reset_otp.save(update_fields=['used_at'])
        PasswordResetOTP.objects.filter(user=user, used_at__isnull=True).exclude(pk=reset_otp.pk).update(used_at=now)

        AuditLog.objects.create(
            user=user,
            action="PASSWORD_RESET_COMPLETE",
            description=f"Password reset completed for user {user.username}."
        )

        return Response({"detail": "Password updated successfully. You can now sign in."}, status=status.HTTP_200_OK)
