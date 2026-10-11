from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    booking_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Notification
        fields = [
            'id', 'booking_id', 'notification_type', 'title', 'message',
            'is_read', 'read_at', 'created_at',
        ]
        read_only_fields = fields
