from django.conf import settings
from django.db import models


class Payment(models.Model):
    BOOKING = 'BOOKING'
    POS = 'POS'
    PAYMENT_TYPES = (
        (BOOKING, 'Booking'),
        (POS, 'POS'),
    )
    METHOD_CHOICES = (
        ('CASH', 'Cash'),
        ('GCASH', 'GCash'),
    )
    STATUS_CHOICES = (
        ('PENDING', 'Pending'),
        ('PENDING_VERIFICATION', 'Pending Verification'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('PAID', 'Paid'),
    )

    payment_type = models.CharField(max_length=16, choices=PAYMENT_TYPES)
    booking = models.ForeignKey('booking.Booking', on_delete=models.CASCADE, null=True, blank=True, related_name='payments')
    order = models.ForeignKey('pos.Order', on_delete=models.CASCADE, null=True, blank=True, related_name='payments')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    method = models.CharField(max_length=15, choices=METHOD_CHOICES, default='GCASH')
    reference_number = models.CharField(max_length=100, blank=True, null=True)
    transaction_id = models.CharField(max_length=100, blank=True, null=True)
    receipt = models.FileField(upload_to='booking_receipts/', blank=True, null=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default='PENDING')
    paid_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_payments'
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    admin_note = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(payment_type='BOOKING', booking_id__isnull=False, order_id__isnull=True)
                    | models.Q(payment_type='POS', order_id__isnull=False, booking_id__isnull=True)
                ),
                name='payment_has_one_parent',
            )
        ]

    @property
    def timestamp(self):
        return self.created_at

    def __str__(self):
        target = f"booking #{self.booking_id}" if self.booking_id else f"order #{self.order_id}"
        return f"{self.payment_type} payment for {target}"
