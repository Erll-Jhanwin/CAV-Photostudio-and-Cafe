from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'action', 'user', 'ip_address')
    list_filter = ('action', 'timestamp')
    search_fields = ('action', 'description', 'user__username')
    readonly_fields = ('user', 'action', 'description', 'metadata', 'ip_address', 'timestamp')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
