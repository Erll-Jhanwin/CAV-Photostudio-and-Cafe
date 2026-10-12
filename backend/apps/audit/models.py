from django.db import models
from django.conf import settings


class AuditLogQuerySet(models.QuerySet):
    def delete(self):
        raise PermissionError('Audit logs are immutable and cannot be deleted.')


class AuditLogManager(models.Manager.from_queryset(AuditLogQuerySet)):
    pass


class AuditLog(models.Model):
    objects = AuditLogManager()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    action = models.CharField(max_length=100)  # e.g. "INVENTORY_ADJUST", "BOOKING_UPDATE", "STAFF_CREATE"
    description = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.CharField(max_length=45, blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        user_str = self.user.username if self.user else "System"
        return f"{user_str} - {self.action} on {self.timestamp.date()}"

    def delete(self, *args, **kwargs):
        raise PermissionError('Audit logs are immutable and cannot be deleted.')
