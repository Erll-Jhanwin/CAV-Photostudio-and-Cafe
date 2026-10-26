import re

from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email as django_validate_email
from django.db import transaction
from users.models import Customer
from users.uploads import validate_profile_picture
from users.phone_numbers import normalize_philippine_mobile_number

User = get_user_model()
PHONE_PATTERN = re.compile(r'^\+?[\d\s().-]{7,20}$')


def validate_phone_number_format(value):
    value = (value or '').strip()
    if value and (not PHONE_PATTERN.match(value) or len(re.sub(r'\D', '', value)) < 7):
        raise serializers.ValidationError('Enter a valid phone number.')
    return value


def phone_number_key(value):
    normalized = normalize_philippine_mobile_number(value)
    return normalized or re.sub(r'\D', '', str(value or ''))


def is_phone_number_taken(value, instance=None):
    key = phone_number_key(value)
    if not key:
        return False
    queryset = User.objects.filter(phone_number__isnull=False).exclude(phone_number='')
    if instance:
        queryset = queryset.exclude(pk=instance.pk)
    return any(phone_number_key(candidate) == key for candidate in queryset.values_list('phone_number', flat=True))


def validate_unique_phone_number(value, instance=None):
    value = validate_phone_number_format(value)
    if value and is_phone_number_taken(value, instance):
        raise serializers.ValidationError('Phone number already exists.')
    return value


def normalize_email(value):
    return (value or '').strip().lower()


def validate_unique_username(value, instance=None):
    value = (value or '').strip()
    if not value:
        raise serializers.ValidationError('Username is required.')
    matches = User.objects.filter(username__iexact=value)
    if instance:
        matches = matches.exclude(pk=instance.pk)
    if matches.exists():
        raise serializers.ValidationError('Username already exists.')
    return value


def validate_unique_email(value, instance=None, required=False):
    value = normalize_email(value)
    if required and not value:
        raise serializers.ValidationError('Email is required.')
    if not value:
        return value
    try:
        django_validate_email(value)
    except DjangoValidationError:
        raise serializers.ValidationError('Enter a valid email address.')
    matches = User.objects.filter(email__iexact=value)
    if instance:
        matches = matches.exclude(pk=instance.pk)
    if matches.exists():
        raise serializers.ValidationError('Email already exists.')
    return value

class CustomerProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ['points', 'birthdate', 'loyalty_tier', 'notes']

class UserSerializer(serializers.ModelSerializer):
    customer_profile = CustomerProfileSerializer(read_only=True)
    profile_picture_url = serializers.SerializerMethodField()
    remove_profile_picture = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role',
            'phone_number', 'address', 'profile_picture', 'profile_picture_url',
            'remove_profile_picture', 'customer_profile', 'registration_method'
        ]
        read_only_fields = ['role', 'registration_method']

    def get_profile_picture_url(self, obj):
        if obj.profile_picture:
            request = self.context.get('request')
            url = obj.profile_picture.url
            return request.build_absolute_uri(url) if request else url
        return obj.profile_picture_external_url or ''

    def validate_profile_picture(self, value):
        return validate_profile_picture(value)

    def validate_phone_number(self, value):
        return validate_unique_phone_number(value, self.instance)

    def validate_username(self, value):
        return validate_unique_username(value, self.instance)

    def validate_email(self, value):
        return validate_unique_email(value, self.instance)

    def validate_first_name(self, value):
        return (value or '').strip()

    def validate_last_name(self, value):
        return (value or '').strip()

    def validate_address(self, value):
        return (value or '').strip()

    def update(self, instance, validated_data):
        remove_picture = validated_data.pop('remove_profile_picture', False)
        new_picture = validated_data.get('profile_picture')
        old_picture = instance.profile_picture if instance.profile_picture else None

        if remove_picture:
            validated_data['profile_picture'] = None
            validated_data['profile_picture_external_url'] = ''
        elif new_picture:
            validated_data['profile_picture_external_url'] = ''

        instance = super().update(instance, validated_data)

        if old_picture and (remove_picture or new_picture):
            old_picture.delete(save=False)

        if instance.role == 'CUSTOMER':
            Customer.objects.get_or_create(user=instance)

        return instance


class ProfileSerializer(UserSerializer):
    """Self-service profile updates, including a guarded password change."""

    current_password = serializers.CharField(write_only=True, trim_whitespace=False, required=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, required=False)

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ['current_password', 'new_password']

    def validate(self, attrs):
        current_password = attrs.get('current_password', '')
        new_password = attrs.get('new_password', '')

        if current_password and not new_password:
            raise serializers.ValidationError({
                'new_password': 'Enter a new password to complete the password change.'  # nosec B105
            })
        if not new_password:
            return attrs
        if self.instance.has_usable_password() and not current_password:
            raise serializers.ValidationError({
                'current_password': 'Enter your current password.'  # nosec B105
            })
        if self.instance.has_usable_password() and not self.instance.check_password(current_password):
            raise serializers.ValidationError({
                'current_password': 'Current password is incorrect.'  # nosec B105
            })
        validate_password(new_password, user=self.instance)
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop('current_password', None)
        new_password = validated_data.pop('new_password', '')
        instance = super().update(instance, validated_data)
        if new_password:
            instance.set_password(new_password)
            instance.save(update_fields=['password'])
        return instance


class AccountSerializer(UserSerializer):
    """Admin account CRUD using the same core fields as customer registration."""

    password = serializers.CharField(write_only=True, trim_whitespace=False, required=False)
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES, required=False)

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ['password']
        read_only_fields = ['id', 'profile_picture_url', 'customer_profile']

    def validate(self, attrs):
        role = attrs.get('role', getattr(self.instance, 'role', 'STAFF'))
        errors = {}

        if not self.instance and not attrs.get('password'):
            errors['password'] = 'Password is required.'  # nosec B105

        if role == 'CUSTOMER':
            effective = lambda name: attrs.get(name, getattr(self.instance, name, ''))
            required_fields = {
                'first_name': 'First name is required for customer accounts.',
                'last_name': 'Last name is required for customer accounts.',
                'email': 'Email is required for customer accounts.',
                'phone_number': 'Phone number is required for customer accounts.',
                'address': 'Address is required for customer accounts.',
            }
            for field, message in required_fields.items():
                if not str(effective(field) or '').strip():
                    errors[field] = message

        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def validate_password(self, value):
        validate_password(value, user=self.instance)
        return value

    def create(self, validated_data):
        # This flag belongs to the self-service profile photo flow only.
        validated_data.pop('remove_profile_picture', None)
        password = validated_data.pop('password')
        role = validated_data.pop('role', 'STAFF')
        validated_data['registration_method'] = User.RegistrationMethod.ADMIN
        with transaction.atomic():
            user = User.objects.create_user(
                password=password,
                role=role,
                is_staff=role in ['STAFF', 'ADMIN'],
                **validated_data,
            )
            if role == 'CUSTOMER':
                Customer.objects.get_or_create(user=user)
        return user

    def update(self, instance, validated_data):
        validated_data.pop('remove_profile_picture', None)
        validated_data.pop('registration_method', None)
        password = validated_data.pop('password', '')
        role = validated_data.pop('role', instance.role)

        with transaction.atomic():
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.role = role
            instance.is_staff = role in ['STAFF', 'ADMIN']
            if password:
                instance.set_password(password)
            instance.save()
            if instance.role == 'CUSTOMER':
                Customer.objects.get_or_create(user=instance)
        return instance

class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, trim_whitespace=True)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    email = serializers.EmailField(required=True)
    first_name = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    last_name = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    phone_number = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)
    address = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    privacy_consent = serializers.BooleanField(write_only=True, required=False, default=False)

    def validate_username(self, value):
        return validate_unique_username(value)

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_email(self, value):
        return validate_unique_email(value, required=True)

    def validate_phone_number(self, value):
        normalized = normalize_philippine_mobile_number(value)
        if not normalized:
            raise serializers.ValidationError('Enter a valid Philippine mobile number.')
        if is_phone_number_taken(normalized):
            raise serializers.ValidationError('Phone number already exists.')
        return normalized

class PasswordResetRequestSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20, trim_whitespace=True)

    def validate_phone_number(self, value):
        normalized = normalize_philippine_mobile_number(value)
        if not normalized:
            raise serializers.ValidationError('Enter a valid Philippine mobile number.')
        return normalized


class RegistrationOTPVerifySerializer(serializers.Serializer):
    registration_token = serializers.CharField(min_length=32, max_length=128, trim_whitespace=True)
    otp = serializers.CharField(min_length=6, max_length=6, trim_whitespace=True)
    privacy_consent = serializers.BooleanField(required=False, default=False)

    def validate_otp(self, value):
        if not value.isdigit():
            raise serializers.ValidationError('OTP must contain 6 digits.')
        return value


class RegistrationOTPResendSerializer(serializers.Serializer):
    registration_token = serializers.CharField(min_length=32, max_length=128, trim_whitespace=True)


class AdminMFAResendSerializer(serializers.Serializer):
    mfa_token = serializers.CharField(min_length=32, max_length=128, trim_whitespace=True)

class PasswordResetVerifySerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20, trim_whitespace=True)
    otp = serializers.CharField(min_length=6, max_length=6, trim_whitespace=True)

    def validate_phone_number(self, value):
        normalized = normalize_philippine_mobile_number(value)
        if not normalized:
            raise serializers.ValidationError('Enter a valid Philippine mobile number.')
        return normalized

    def validate_otp(self, value):
        if not value.isdigit():
            raise serializers.ValidationError('OTP must contain 6 digits.')
        return value

class PasswordResetConfirmSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20, trim_whitespace=True)
    reset_token = serializers.CharField(min_length=32, max_length=128, trim_whitespace=True)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_phone_number(self, value):
        normalized = normalize_philippine_mobile_number(value)
        if not normalized:
            raise serializers.ValidationError('Enter a valid Philippine mobile number.')
        return normalized
