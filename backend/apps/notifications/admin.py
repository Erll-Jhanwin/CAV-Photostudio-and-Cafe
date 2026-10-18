from django.contrib import admin

from .models import Notification, NotificationDelivery, PushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'booking', 'is_read', 'created_at')
    list_filter = ('is_read', 'notification_type')
    search_fields = ('user__username', 'user__email', 'title', 'message')


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'endpoint', 'is_active', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('user__username', 'user__email', 'endpoint')


@admin.register(NotificationDelivery)
class NotificationDeliveryAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'channel', 'status', 'provider', 'user', 'notification')
    list_filter = ('channel', 'status', 'provider')
    search_fields = ('user__username', 'user__email', 'provider_message_id', 'error_code')
    readonly_fields = (
        'notification', 'user', 'channel', 'status', 'provider',
        'provider_message_id', 'error_code', 'error_message', 'metadata',
        'attempt_count', 'created_at', 'updated_at', 'sent_at',
    )
