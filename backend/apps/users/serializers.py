import re

from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from users.models import Customer

User = get_user_model()
PROFILE_PICTURE_MAX_SIZE = 2 * 1024 * 1024
PROFILE_PICTURE_ALLOWED_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
PHONE_PATTERN = re.compile(r'^\+?[\d\s().-]{7,20}$')


def validate_phone_number_format(value):
    value = (value or '').strip()
    if value and (not PHONE_PATTERN.match(value) or len(re.sub(r'\D', '', value)) < 7):
        raise serializers.ValidationError('Enter a valid phone number.')
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
        if not value:
            return value
        if value.size > PROFILE_PICTURE_MAX_SIZE:
            raise serializers.ValidationError('Profile picture must be 2MB or smaller.')
        content_type = getattr(value, 'content_type', '')
        if content_type and content_type not in PROFILE_PICTURE_ALLOWED_TYPES:
            raise serializers.ValidationError('Profile picture must be a JPG, PNG, or WEBP image.')
        return value

    def validate_phone_number(self, value):
        return validate_phone_number_format(value)

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

        return instance

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    email = serializers.EmailField(required=True)

    class Meta:
        model = User
        fields = ['username', 'password', 'email', 'first_name', 'last_name', 'phone_number', 'address']

    def create(self, validated_data):
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
        # Create customer profile automatically
        Customer.objects.create(user=user)
        return user

    def validate_username(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Username is required.')
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('Username already exists.')
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if not value:
            raise serializers.ValidationError('Email is required.')
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email already exists.')
        return value

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
