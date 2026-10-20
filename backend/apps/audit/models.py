from django.db import models
from django.conf import settings


class AuditLogQuerySet(models.QuerySet):
    def delete(self):
        raise PermissionError('Audit logs are immutable and cannot be deleted.')

    def update(self, **kwargs):
        raise PermissionError('Audit logs are immutable and cannot be updated.')


class AuditLogManager(models.Manager.from_queryset(AuditLogQuerySet)):
    pass


class AuditLog(models.Model):
    objects = AuditLogManager()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    action = models.CharField(max_length=100)  # e.g. "INVENTORY_ADJUST", "BOOKING_UPDATE", "STAFF_CREATE"
    description = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    actor_name = models.CharField(max_length=255, blank=True, default='')
    actor_role = models.CharField(max_length=20, blank=True, default='', db_index=True)
    actor_user_id = models.PositiveBigIntegerField(null=True, blank=True, db_index=True)
    module = models.CharField(max_length=80, blank=True, default='', db_index=True)
    record_reference = models.CharField(max_length=160, blank=True, default='')
    ip_address = models.CharField(max_length=45, blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        user_str = self.user.username if self.user else "System"
        return f"{user_str} - {self.action} on {self.timestamp.date()}"

    def delete(self, *args, **kwargs):
        raise PermissionError('Audit logs are immutable and cannot be deleted.')

    def __setattr__(self, name, value):
        if name in {'user', 'action', 'description', 'metadata', 'ip_address', 'timestamp', 'actor_name', 'actor_role', 'actor_user_id', 'module', 'record_reference'} and getattr(self, '_state', None) is not None and self._state.adding is False and hasattr(self, 'id'):
            current = self.user_id if name == 'user' else getattr(self, name, None)
            incoming = getattr(value, 'pk', None) if name == 'user' else value
            if current != incoming:
                raise PermissionError('Audit logs are immutable and cannot be changed.')
        super().__setattr__(name, value)

    def save(self, *args, **kwargs):
        from .recorder import sanitize_metadata
        self.metadata = sanitize_metadata(self.metadata if isinstance(self.metadata, dict) else {})
        self.description = sanitize_metadata(str(self.description or ''))
        # Keep actor details as an event-time snapshot even if the account is later edited.
        if self.user_id:
            self.actor_user_id = self.actor_user_id or self.user_id
            if not self.actor_name:
                self.actor_name = self.user.get_full_name().strip() or self.user.username
            if not self.actor_role:
                self.actor_role = self.user.role
        if not self.module:
            prefix = self.action.upper().split('_', 1)[0]
            self.module = {
                'USER': 'auth', 'AUTH': 'auth', 'BOOKING': 'bookings', 'POS': 'pos',
                'PRODUCT': 'inventory', 'INVENTORY': 'inventory', 'INGREDIENT': 'inventory',
                'CATEGORY': 'inventory', 'SUPPLIER': 'inventory', 'PO': 'inventory',
                'STOCK': 'inventory', 'ADMIN': 'users', 'PRIVACY': 'privacy',
                'FAQ': 'chatbot', 'CLIENT': 'system', 'SYSTEM': 'system',
                'NOTIFICATION': 'notifications', 'PAYMENT': 'payments', 'GALLERY': 'gallery',
            }.get(prefix, prefix.lower()[:80])
        if not self.record_reference and isinstance(self.metadata, dict):
            for key in ('booking_id', 'payment_id', 'order_id', 'product_id', 'user_id', 'request_id', 'report_id', 'record_id'):
                value = self.metadata.get(key)
                if value is not None:
                    self.record_reference = str(value)[:160]
                    break
        super().save(*args, **kwargs)
        try:
            from .middleware import note_audit_event
            note_audit_event()
        except (ImportError, LookupError):
            pass
