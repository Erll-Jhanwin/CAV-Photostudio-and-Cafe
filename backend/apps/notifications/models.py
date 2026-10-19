from django.conf import settings
from django.db import models


class Notification(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    booking = models.ForeignKey(
        'booking.Booking',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notifications',
    )
    notification_type = models.CharField(max_length=80)
    title = models.CharField(max_length=150)
    message = models.TextField()
    event_key = models.CharField(max_length=180, unique=True, null=True, blank=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['user', 'is_read', '-created_at'], name='notificatio_user_id_6d7b1e_idx'),
            models.Index(fields=['user', '-created_at'], name='notificatio_user_id_f6a2bc_idx'),
        ]

    def __str__(self):
        return f'{self.user.username}: {self.title}'


class PushSubscription(models.Model):
    """A browser's Web Push subscription for one authenticated user."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='push_subscriptions',
    )
    endpoint = models.URLField(max_length=2048)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'endpoint'],
                name='notifications_push_user_endpoint_unique',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'is_active'], name='notif_push_user_active_idx'),
        ]

    def __str__(self):
        return f'{self.user.username}: {self.endpoint[:70]}'


class NotificationDelivery(models.Model):
    CHANNEL_EMAIL = 'email'
    CHANNEL_SMS = 'sms'
    CHANNEL_PUSH = 'push'
    CHANNEL_CHOICES = (
        (CHANNEL_EMAIL, 'Email'),
        (CHANNEL_SMS, 'SMS'),
        (CHANNEL_PUSH, 'Push notification'),
    )

    STATUS_QUEUED = 'queued'
    STATUS_SENT = 'sent'
    STATUS_FAILED = 'failed'
    STATUS_SKIPPED = 'skipped'
    STATUS_SENDING = 'sending'
    STATUS_ACCEPTED = 'accepted'
    STATUS_DELIVERED = 'delivered'
    STATUS_UNKNOWN = 'unknown'
    STATUS_CHOICES = (
        (STATUS_QUEUED, 'Queued'),
        (STATUS_SENT, 'Sent'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_SKIPPED, 'Skipped'),
        (STATUS_SENDING, 'Submission in progress'),
        (STATUS_ACCEPTED, 'Accepted by provider; delivery unconfirmed'),
        (STATUS_DELIVERED, 'Provider reports delivered'),
        (STATUS_UNKNOWN, 'Submission outcome unknown; do not resend'),
    )

    notification = models.ForeignKey(
        Notification,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deliveries',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notification_deliveries',
    )
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED)
    provider = models.CharField(max_length=40, blank=True, default='')
    provider_message_id = models.CharField(max_length=255, blank=True, default='')
    error_code = models.CharField(max_length=80, blank=True, default='')
    error_message = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)
    attempt_count = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['channel', 'status', '-created_at'], name='notificatio_deliv_status_idx'),
            models.Index(fields=['user', '-created_at'], name='notificatio_deliv_user_idx'),
        ]

    def __str__(self):
        return f'{self.channel} {self.status} for user {self.user_id}'
