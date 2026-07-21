from django.db import models
from django.conf import settings
from django.db.models.functions import Lower
from django.utils import timezone
from datetime import datetime, timedelta


BOOKING_CUSTOMER_EDIT_WINDOW_HOURS = 24

class Service(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    duration_minutes = models.IntegerField(default=30)
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    image_url = models.CharField(max_length=500, blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower('name'),
                name='booking_service_name_ci_unique',
            ),
        ]

    def __str__(self):
        return self.name

class Package(models.Model):
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='packages')
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    inclusions = models.TextField(help_text="Comma-separated or newline-separated list of package inclusions")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                'service',
                Lower('name'),
                name='booking_package_service_name_ci_unique',
            ),
        ]

    def __str__(self):
        return f"{self.service.name} - {self.name} (PHP {self.price})"

class Booking(models.Model):
    STATUS_CHOICES = (
        ('PENDING', 'Pending'),
        ('CONFIRMED', 'Confirmed'),
        ('CONFIRMED_DP', 'Confirmed - Down Payment Received'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    )
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='bookings')
    package = models.ForeignKey(Package, on_delete=models.CASCADE, related_name='bookings')
    scheduled_date = models.DateField()
    scheduled_time = models.TimeField()
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='PENDING')
    notes = models.TextField(blank=True, null=True)
    items = models.JSONField(default=list, blank=True)
    change_history = models.JSONField(default=list, blank=True)
    idempotency_key = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['scheduled_date', 'scheduled_time'],
                condition=models.Q(status__in=['PENDING', 'CONFIRMED', 'CONFIRMED_DP']),
                name='booking_active_slot_unique',
            ),
            models.UniqueConstraint(
                fields=['customer', 'idempotency_key'],
                condition=models.Q(idempotency_key__isnull=False) & ~models.Q(idempotency_key=''),
                name='booking_customer_idempotency_unique',
            ),
        ]

    @property
    def starts_at(self):
        if not self.scheduled_date or not self.scheduled_time:
            return None
        return timezone.make_aware(
            datetime.combine(self.scheduled_date, self.scheduled_time),
            timezone.get_current_timezone()
        )

    @property
    def edit_deadline(self):
        starts_at = self.starts_at
        return starts_at - timedelta(hours=BOOKING_CUSTOMER_EDIT_WINDOW_HOURS) if starts_at else None

    @property
    def is_customer_editable(self):
        if self.status in ('COMPLETED', 'CANCELLED'):
            return False
        if self.status == 'PENDING':
            return True
        deadline = self.edit_deadline
        return bool(deadline and timezone.now() < deadline)

    @property
    def customer_edit_lock_reason(self):
        if self.status == 'COMPLETED':
            return 'Completed bookings cannot be edited.'
        if self.status == 'CANCELLED':
            return 'Cancelled bookings cannot be edited.'
        if self.status in ('CONFIRMED', 'CONFIRMED_DP') and not self.is_customer_editable:
            return f'Editing is locked within {BOOKING_CUSTOMER_EDIT_WINDOW_HOURS} hours of the scheduled session.'
        return ''

    def __str__(self):
        return f"Booking {self.id}: {self.customer.username} - {self.package.name} on {self.scheduled_date} at {self.scheduled_time}"
