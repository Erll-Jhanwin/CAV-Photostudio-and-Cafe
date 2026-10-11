from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'booking', 'is_read', 'created_at')
    list_filter = ('is_read', 'notification_type')
    search_fields = ('user__username', 'user__email', 'title', 'message')
