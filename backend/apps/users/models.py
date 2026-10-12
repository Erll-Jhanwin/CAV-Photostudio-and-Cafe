from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
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

    class Meta:
        verbose_name = 'user'
        verbose_name_plural = 'users'
        constraints = [
            models.UniqueConstraint(
                Lower('email'),
                condition=~Q(email=''),
                name='users_customuser_email_unique_nonblank',
            ),
            models.UniqueConstraint(
                Lower('phone_number'),
                condition=~Q(phone_number=''),
                name='users_customuser_phone_unique_nonblank',
            ),
            models.UniqueConstraint(
                Lower('username'),
                name='users_customuser_username_ci_unique',
            ),
        ]

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


class PrivacyConsent(models.Model):
    CONSENT_TYPES = (
        ('PRIVACY_NOTICE', 'Privacy notice'),
        ('SERVICE_PROCESSING', 'Service processing'),
        ('MARKETING', 'Marketing communications'),
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='privacy_consents')
    consent_type = models.CharField(max_length=40, choices=CONSENT_TYPES)
    policy_version = models.CharField(max_length=30)
    granted_at = models.DateTimeField(auto_now_add=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=40, default='web')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'consent_type', 'policy_version'], name='privacy_consent_version_unique'),
        ]
        ordering = ['-granted_at']


class PrivacyRequest(models.Model):
    REQUEST_TYPES = (
        ('ACCESS', 'Access'),
        ('CORRECTION', 'Correction'),
        ('DELETION', 'Deletion'),
        ('OBJECTION', 'Objection'),
        ('EXPORT', 'Data export'),
    )
    STATUS_CHOICES = (
        ('OPEN', 'Open'),
        ('IN_PROGRESS', 'In progress'),
        ('COMPLETED', 'Completed'),
        ('REJECTED', 'Rejected'),
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='privacy_requests')
    request_type = models.CharField(max_length=20, choices=REQUEST_TYPES)
    details = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='OPEN')
    response_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

class PasswordResetOTP(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='password_reset_otps')
    # Kept for compatibility with reset sessions created before the SMS flow.
    email = models.EmailField(blank=True, default='')
    phone_number = models.CharField(max_length=20, blank=True, default='')
    # OTP generation and verification are handled by iProgSMS.
    otp_hash = models.CharField(max_length=128, blank=True, default='')
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
            models.Index(fields=['phone_number', 'created_at'], name='users_protp_phone_created_idx'),
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
