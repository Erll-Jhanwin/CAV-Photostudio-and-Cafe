from urllib.parse import urlparse

from rest_framework import serializers

from .models import Notification, NotificationDelivery


class NotificationSerializer(serializers.ModelSerializer):
    booking_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Notification
        fields = [
            'id', 'booking_id', 'notification_type', 'title', 'message',
            'is_read', 'read_at', 'created_at',
        ]
        read_only_fields = fields


class PushSubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=2048)
    keys = serializers.DictField(child=serializers.CharField(), write_only=True)
    user_agent = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate_endpoint(self, value):
        parsed = urlparse(value)
        if parsed.scheme != 'https' or not parsed.netloc:
            raise serializers.ValidationError('Push endpoint must be a valid HTTPS URL.')
        return value

    def validate_keys(self, value):
        p256dh = str(value.get('p256dh') or '').strip()
        auth = str(value.get('auth') or '').strip()
        if not p256dh or not auth:
            raise serializers.ValidationError('Push subscription keys are required.')
        if len(p256dh) > 255 or len(auth) > 255:
            raise serializers.ValidationError('Push subscription keys are too long.')
        return {'p256dh': p256dh, 'auth': auth}


class PushSubscriptionDeleteSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=2048)

    def validate_endpoint(self, value):
        parsed = urlparse(value)
        if parsed.scheme != 'https' or not parsed.netloc:
            raise serializers.ValidationError('Push endpoint must be a valid HTTPS URL.')
        return value


class NotificationDeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationDelivery
        fields = [
            'id', 'notification', 'user', 'channel', 'status', 'provider',
            'provider_message_id', 'error_code', 'error_message', 'metadata',
            'attempt_count', 'created_at', 'updated_at', 'sent_at',
            'delivered_at', 'next_retry_at', 'last_checked_at',
        ]
        read_only_fields = fields
