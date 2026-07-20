from rest_framework import generics, permissions, status, views
from rest_framework.response import Response
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from users.serializers import (
    UserSerializer,
    RegisterSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    PasswordResetConfirmSerializer,
)
from users.models import Customer, PasswordResetOTP
from audit.models import AuditLog
from booking.models import Booking, BookingChangeLog, BookingItem, BookingPayment
from chatbot.models import ChatbotLog
from forecasting.models import DemandPrediction, SalesPrediction
from inventory.models import IngredientStockMovement, PurchaseOrder, PurchaseOrderItem, StockMovement
from notifications.models import Notification
from pos.models import EndOfDayReport, Order, OrderItem, Payment, TransactionSequence
from sales.models import DailySalesSummary
import requests
import secrets

User = get_user_model()
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
            description=f"New customer registered: {user.username}"
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
        if profile.get('aud') != settings.GOOGLE_CLIENT_ID:
            return Response({"detail": "Invalid Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        email = profile.get('email', '').strip().lower()
        if not email or profile.get('email_verified') not in (True, 'true', 'True', '1'):
            return Response({"detail": "Google account email must be verified."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if not user:
            user = User.objects.create_user(
                username=unique_username_from_email(email),
                email=email,
                first_name=profile.get('given_name', ''),
                last_name=profile.get('family_name', ''),
                role='CUSTOMER',
            )
            user.set_unusable_password()
            user.save()
            Customer.objects.get_or_create(user=user)
            created = True
            AuditLog.objects.create(
                user=user,
                action="CUSTOMER_REGISTER_GOOGLE",
                description=f"New customer registered with Google: {user.username}"
            )

        if user.role == 'CUSTOMER':
            Customer.objects.get_or_create(user=user)

        AuditLog.objects.create(
            user=user,
            action="USER_LOGIN_GOOGLE",
            description=f"User {user.username} logged in with Google."
        )

        payload = build_auth_payload(user)
        payload['created'] = created
        return Response(payload, status=status.HTTP_200_OK)

class UserProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

class StaffListView(generics.ListCreateAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Admin can view all users, staff can see staff/customers.
        user = self.request.user
        if user.role == 'ADMIN':
            return User.objects.all().order_by('role', 'username')
        if user.role == 'STAFF':
            return User.objects.filter(role__in=['STAFF', 'CUSTOMER']).order_by('role', 'username')
        return User.objects.filter(pk=user.pk)

    def create(self, request, *args, **kwargs):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only Admins can create staff accounts."}, status=status.HTTP_403_FORBIDDEN)
            
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''
        email = (request.data.get('email') or '').strip().lower()
        role = request.data.get('role', 'STAFF')
        
        if not username or not password:
            return Response({"detail": "Username and password are required."}, status=status.HTTP_400_BAD_REQUEST)
        if role not in ['STAFF', 'ADMIN', 'CUSTOMER']:
            return Response({"role": "Role must be STAFF, ADMIN, or CUSTOMER."}, status=status.HTTP_400_BAD_REQUEST)
            
        if User.objects.filter(username__iexact=username).exists():
            return Response({"detail": "Username already exists."}, status=status.HTTP_400_BAD_REQUEST)
        if email and User.objects.filter(email__iexact=email).exists():
            return Response({"email": "Email already exists."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(password)
        except DjangoValidationError as exc:
            return Response({"password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
            
        user = User.objects.create_user(
            username=username,
            password=password,
            email=email,
            role=role,
            is_staff=(role in ['STAFF', 'ADMIN'])
        )
        
        AuditLog.objects.create(
            user=request.user,
            action="STAFF_CREATE",
            description=f"Created user {user.username} with role {role}."
        )
        
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

class StaffDetailView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

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

        username = request.data.get('username', user.username).strip()
        email = (request.data.get('email', user.email or '') or '').strip().lower()
        role = request.data.get('role', user.role)
        password = request.data.get('password', '')

        if not username:
            return Response({"detail": "Username is required."}, status=status.HTTP_400_BAD_REQUEST)

        if role not in ['STAFF', 'ADMIN', 'CUSTOMER']:
            return Response({"role": "Role must be STAFF, ADMIN, or CUSTOMER."}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username__iexact=username).exclude(pk=user.pk).exists():
            return Response({"detail": "Username already exists."}, status=status.HTTP_400_BAD_REQUEST)
        if email and User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
            return Response({"email": "Email already exists."}, status=status.HTTP_400_BAD_REQUEST)
        if password:
            try:
                validate_password(password, user=user)
            except DjangoValidationError as exc:
                return Response({"password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        user.username = username
        user.email = email
        user.role = role
        user.is_staff = role in ['STAFF', 'ADMIN']
        if password:
            user.set_password(password)
        user.save()

        if role == 'CUSTOMER':
            Customer.objects.get_or_create(user=user)

        AuditLog.objects.create(
            user=request.user,
            action="STAFF_UPDATE",
            description=f"Updated user {user.username} with role {role}."
        )

        return Response(UserSerializer(user).data)

    def delete(self, request, pk):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only Admins can delete staff accounts."}, status=status.HTTP_403_FORBIDDEN)

        user = self.get_object(pk)
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        if user.pk == request.user.pk:
            return Response({"detail": "You cannot delete your own account."}, status=status.HTTP_400_BAD_REQUEST)

        username = user.username
        user.delete()

        AuditLog.objects.create(
            user=request.user,
            action="STAFF_DELETE",
            description=f"Deleted user {username}."
        )

        return Response(status=status.HTTP_204_NO_CONTENT)

def get_client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')

def generic_password_reset_response():
    return Response({
        "detail": "If that email is registered, a one-time password has been sent."
    }, status=status.HTTP_200_OK)

def delete_queryset(label, queryset):
    count = queryset.count()
    queryset.delete()
    return label, count

class SystemDataResetView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
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
                    delete_queryset('booking_payments', BookingPayment.objects.all()),
                    delete_queryset('booking_items', BookingItem.objects.all()),
                    delete_queryset('booking_change_logs', BookingChangeLog.objects.all()),
                    delete_queryset('pos_payments', Payment.objects.all()),
                    delete_queryset('pos_order_items', OrderItem.objects.all()),
                    delete_queryset('pos_orders', Order.objects.all()),
                    delete_queryset('end_of_day_reports', EndOfDayReport.objects.all()),
                    delete_queryset('transaction_sequences', TransactionSequence.objects.all()),
                    delete_queryset('purchase_order_items', PurchaseOrderItem.objects.all()),
                    delete_queryset('purchase_orders', PurchaseOrder.objects.all()),
                    delete_queryset('stock_movements', StockMovement.objects.all()),
                    delete_queryset('ingredient_stock_movements', IngredientStockMovement.objects.all()),
                    delete_queryset('demand_predictions', DemandPrediction.objects.all()),
                    delete_queryset('sales_predictions', SalesPrediction.objects.all()),
                    delete_queryset('daily_sales_summaries', DailySalesSummary.objects.all()),
                    delete_queryset('notifications', Notification.objects.all()),
                    delete_queryset('chatbot_logs', ChatbotLog.objects.all()),
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
            send_mail(
                subject='Your CAV password reset code',
                message=(
                    f'Your CAV password reset OTP is {otp}.\n\n'
                    f'This code expires in {PASSWORD_RESET_OTP_TTL_MINUTES} minutes. '
                    'If you did not request this, you can ignore this email.'
                ),
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
                recipient_list=[user.email],
                fail_silently=False,
            )
        except Exception:
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
