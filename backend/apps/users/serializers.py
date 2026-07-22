import re

from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email as django_validate_email
from django.db import transaction
from users.models import Customer
from users.uploads import validate_profile_picture

User = get_user_model()
PHONE_PATTERN = re.compile(r'^\+?[\d\s().-]{7,20}$')


def validate_phone_number_format(value):
    value = (value or '').strip()
    if value and (not PHONE_PATTERN.match(value) or len(re.sub(r'\D', '', value)) < 7):
        raise serializers.ValidationError('Enter a valid phone number.')
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
            'remove_profile_picture', 'customer_profile'
        ]
        read_only_fields = ['role']

    def get_profile_picture_url(self, obj):
        if obj.profile_picture:
            request = self.context.get('request')
            url = obj.profile_picture.url
            return request.build_absolute_uri(url) if request else url
        return obj.profile_picture_external_url or ''

    def validate_profile_picture(self, value):
        return validate_profile_picture(value)

    def validate_phone_number(self, value):
        return validate_phone_number_format(value)

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
                'new_password': 'Enter a new password to complete the password change.'
            })
        if not new_password:
            return attrs
        if self.instance.has_usable_password() and not current_password:
            raise serializers.ValidationError({
                'current_password': 'Enter your current password.'
            })
        if self.instance.has_usable_password() and not self.instance.check_password(current_password):
            raise serializers.ValidationError({
                'current_password': 'Current password is incorrect.'
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
            errors['password'] = 'Password is required.'

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

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    email = serializers.EmailField(required=True)

    class Meta:
        model = User
        fields = ['username', 'password', 'email', 'first_name', 'last_name', 'phone_number', 'address']

    def create(self, validated_data):
        with transaction.atomic():
            user = User.objects.create_user(
                username=validated_data['username'],
                password=validated_data['password'],
                email=validated_data.get('email', ''),
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', ''),
                phone_number=validated_data.get('phone_number', ''),
                address=validated_data.get('address', ''),
                role='CUSTOMER'
            )
            Customer.objects.get_or_create(user=user)
        return user

    def validate_username(self, value):
        return validate_unique_username(value)

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_email(self, value):
        return validate_unique_email(value, required=True)

    def validate_phone_number(self, value):
        return validate_phone_number_format(value)

class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return (value or '').strip().lower()

class PasswordResetVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    otp = serializers.CharField(min_length=6, max_length=6, trim_whitespace=True)

    def validate_email(self, value):
        return (value or '').strip().lower()

    def validate_otp(self, value):
        if not value.isdigit():
            raise serializers.ValidationError('OTP must contain 6 digits.')
        return value

class PasswordResetConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField()
    reset_token = serializers.CharField(min_length=32, max_length=128, trim_whitespace=True)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        return (value or '').strip().lower()
