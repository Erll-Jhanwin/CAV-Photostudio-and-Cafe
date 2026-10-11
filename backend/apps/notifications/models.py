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
