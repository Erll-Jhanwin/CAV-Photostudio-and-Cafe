from rest_framework import generics, permissions, status, views
from rest_framework.response import Response
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from users.serializers import UserSerializer, RegisterSerializer
from users.models import Customer
from audit.models import AuditLog
import secrets
import string
import requests

User = get_user_model()

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

class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

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

def mask_client_id(client_id):
    if not client_id:
        return ''
    if len(client_id) <= 16:
        return client_id
    return f"{client_id[:12]}...{client_id[-28:]}"

class GoogleAuthView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        credential = request.data.get('credential', '').strip()
        if not credential:
            return Response({"detail": "Google credential is required."}, status=status.HTTP_400_BAD_REQUEST)

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
            return Response({
                "detail": "Google credential audience mismatch.",
                "expected": mask_client_id(settings.GOOGLE_CLIENT_ID),
                "received": mask_client_id(profile.get('aud', '')),
            }, status=status.HTTP_400_BAD_REQUEST)

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
            return User.objects.all().order_by('role')
        return User.objects.filter(role__in=['STAFF', 'CUSTOMER']).order_by('role')

    def create(self, request, *args, **kwargs):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only Admins can create staff accounts."}, status=status.HTTP_403_FORBIDDEN)
            
        username = request.data.get('username')
        password = request.data.get('password')
        email = request.data.get('email', '')
        role = request.data.get('role', 'STAFF') # STAFF or ADMIN or CUSTOMER
        
        if not username or not password:
            return Response({"detail": "Username and password are required."}, status=status.HTTP_400_BAD_REQUEST)
            
        if User.objects.filter(username=username).exists():
            return Response({"detail": "Username already exists."}, status=status.HTTP_400_BAD_REQUEST)
            
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

class ForgotPasswordView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = request.data.get('username', '').strip()
        if not username:
            return Response({"detail": "Username is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return Response({"detail": "If that username exists, a temporary password has been sent."}, status=status.HTTP_200_OK)

        # Generate a random temporary password
        alphabet = string.ascii_letters + string.digits
        temp_password = ''.join(secrets.choice(alphabet) for _ in range(12))

        user.set_password(temp_password)
        user.save()

        AuditLog.objects.create(
            user=user,
            action="PASSWORD_RESET",
            description=f"Password reset for user {user.username} via forgot-password flow."
        )

        return Response({
            "detail": "Temporary password generated. Please use it to log in and change your password.",
            "temp_password": temp_password,
            "username": user.username
        }, status=status.HTTP_200_OK)
