from django.db import models
from django.contrib.auth.models import AbstractUser
from django.conf import settings
from django.utils import timezone
from users.uploads import profile_picture_upload_path

class CustomUser(AbstractUser):
    ROLE_CHOICES = (
        ('CUSTOMER', 'Customer'),
        ('STAFF', 'Staff'),
        ('ADMIN', 'Admin'),
    )
    class RegistrationMethod(models.TextChoices):
        FORM = 'FORM', 'Registration form'
        GOOGLE = 'GOOGLE', 'Google authentication'
        ADMIN = 'ADMIN', 'Created by admin'
        LEGACY = 'LEGACY', 'Existing account'

    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default='CUSTOMER')
    registration_method = models.CharField(
        max_length=10,
        choices=RegistrationMethod.choices,
        default=RegistrationMethod.LEGACY,
    )
    # Keep optional contact fields as empty strings instead of a mixture of
    # NULL and ''. This makes every client receive one predictable shape.
    phone_number = models.CharField(max_length=20, blank=True, default='')
    address = models.TextField(blank=True, default='')
    profile_picture = models.ImageField(upload_to=profile_picture_upload_path, blank=True, null=True)
    profile_picture_external_url = models.URLField(max_length=500, blank=True)

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

class Customer(models.Model):
    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE, related_name='customer_profile')
    points = models.IntegerField(default=0)
    birthdate = models.DateField(null=True, blank=True)
    loyalty_tier = models.CharField(max_length=20, default='Bronze')
    notes = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"Customer Profile: {self.user.username}"

class PasswordResetOTP(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='password_reset_otps')
    email = models.EmailField()
    otp_hash = models.CharField(max_length=128)
    reset_token_hash = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    request_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'used_at', 'expires_at']),
            models.Index(fields=['email', 'created_at']),
        ]
        ordering = ['-created_at']

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    @property
    def is_used(self):
        return self.used_at is not None

    @property
    def is_verified(self):
        return self.verified_at is not None
