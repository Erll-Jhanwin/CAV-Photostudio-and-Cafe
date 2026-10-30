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
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='bookings')
    package = models.ForeignKey(Package, on_delete=models.CASCADE, related_name='bookings')
    is_walk_in = models.BooleanField(default=False, db_index=True)
    contact_name = models.CharField(max_length=200, blank=True, default='')
    contact_email = models.EmailField(max_length=254, blank=True, default='')
    contact_phone = models.CharField(max_length=30, blank=True, default='')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_bookings')
    walk_in_idempotency_key = models.CharField(max_length=100, blank=True, null=True)
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
                fields=['walk_in_idempotency_key'],
                condition=models.Q(walk_in_idempotency_key__isnull=False) & ~models.Q(walk_in_idempotency_key=''),
                name='booking_walkin_idempotency_unique',
            ),
            models.UniqueConstraint(
                fields=['customer', 'idempotency_key'],
                condition=models.Q(idempotency_key__isnull=False) & ~models.Q(idempotency_key=''),
                name='booking_customer_idempotency_unique',
            ),
        ]
        indexes = [
            models.Index(fields=['created_at', 'status'], name='booking_created_status_idx'),
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
        customer_name = self.contact_name or (self.customer.username if self.customer_id else 'Walk-in')
        return f"Booking {self.id}: {customer_name} - {self.package.name} on {self.scheduled_date} at {self.scheduled_time}"


class BookingReview(models.Model):
    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name='review')
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='booking_reviews',
    )
    rating = models.PositiveSmallIntegerField()
    feedback = models.TextField(blank=True)
    suggestions = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(rating__gte=1, rating__lte=5),
                name='booking_review_rating_1_to_5',
            ),
            models.UniqueConstraint(
                fields=['booking', 'customer'],
                name='booking_review_booking_customer_unique',
            ),
        ]

    def __str__(self):
        reviewer = self.customer.username if self.customer_id else (self.booking.contact_name or 'walk-in customer')
        return f"Review for booking {self.booking_id} by {reviewer}"


class BookingDateLock(models.Model):
    scheduled_date = models.DateField(unique=True)

    def __str__(self):
        return f"Booking lock for {self.scheduled_date}"


class BookingEmail(models.Model):
    EVENT_SUBMITTED = 'submitted'
    EVENT_APPROVED = 'approved'
    EVENT_REMINDER = 'reminder_24h'
    EVENT_COMPLETED = 'completed'
    EVENT_CHOICES = (
        (EVENT_SUBMITTED, 'Booking submitted'),
        (EVENT_APPROVED, 'Booking approved'),
        (EVENT_REMINDER, '24-hour session reminder'),
        (EVENT_COMPLETED, 'Session completed'),
    )
    STATUS_QUEUED = 'queued'
    STATUS_SENT = 'sent'
    STATUS_FAILED = 'failed'
    STATUS_CANCELLED = 'cancelled'

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name='email_events')
    event_type = models.CharField(max_length=24, choices=EVENT_CHOICES)
    event_key = models.CharField(max_length=200, unique=True)
    recipient = models.EmailField(max_length=254)
    scheduled_for = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=16, default=STATUS_QUEUED)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True, default='')
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_for', 'id']
        indexes = [models.Index(fields=['status', 'scheduled_for'], name='booking_email_due_idx')]

    def __str__(self):
        return f'{self.event_type} email for booking #{self.booking_id} ({self.status})'


class StudioUnavailableDate(models.Model):
    date = models.DateField(unique=True)
    reason = models.CharField(max_length=220)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='studio_unavailable_dates',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['date']

    def __str__(self):
        return f"Studio unavailable on {self.date}: {self.reason}"
