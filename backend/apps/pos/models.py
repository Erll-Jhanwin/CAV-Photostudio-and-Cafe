from django.conf import settings
from django.db import models

from booking.models import Booking


class Order(models.Model):
    STATUS_CHOICES = (
        ('PENDING', 'Pending'),
        ('PAID', 'Paid'),
        ('CANCELLED', 'Cancelled'),
    )
    ORDER_TYPES = (
        ('WALK_IN', 'Walk-in Cafe / Studio'),
        ('BOOKING_LINKED', 'Linked to Booking'),
        ('END_OF_DAY_REPORT', 'End-of-day Report'),
    )

    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='processed_orders')
    booking = models.ForeignKey(Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name='orders')
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    discount_type = models.CharField(max_length=10, choices=(('FIXED', 'Fixed Amount'), ('PERCENT', 'Percentage')), default='FIXED')
    discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    transaction_id = models.CharField(max_length=24, unique=True, blank=True, null=True, editable=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    payment_status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='PENDING')
    order_type = models.CharField(max_length=20, choices=ORDER_TYPES, default='WALK_IN')
    line_items = models.JSONField(default=list, blank=True)
    report_data = models.JSONField(default=dict, blank=True)
    printed_at = models.DateTimeField(null=True, blank=True)
    print_status = models.JSONField(default=dict, blank=True)
    idempotency_key = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['staff', 'idempotency_key'],
                condition=models.Q(idempotency_key__isnull=False) & ~models.Q(idempotency_key=''),
                name='pos_order_staff_idempotency_unique',
            ),
        ]

    def __str__(self):
        return f"Order #{self.id} - Total: PHP {self.total} ({self.get_payment_status_display()})"
