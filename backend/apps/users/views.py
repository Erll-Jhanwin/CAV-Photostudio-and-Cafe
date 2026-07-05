from rest_framework import generics, permissions, status, views
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from users.serializers import UserSerializer, RegisterSerializer
from audit.models import AuditLog
import secrets
import string

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
