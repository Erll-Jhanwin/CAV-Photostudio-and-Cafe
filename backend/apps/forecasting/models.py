from django.db import models
from django.db.models import Q


class SalesHistoryImport(models.Model):
    """An immutable, validated snapshot of an uploaded sales export."""

    PENDING = 'PENDING'
    READY = 'READY'
    FAILED = 'FAILED'
    STATUS_CHOICES = (
        (PENDING, 'Pending'),
        (READY, 'Ready'),
        (FAILED, 'Failed'),
    )

    source_name = models.CharField(max_length=120, default='cafe_sparkling_drinks')
    source_filename = models.CharField(max_length=255)
    source_hash = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=PENDING)
    is_active = models.BooleanField(default=False)
    row_count = models.PositiveIntegerField(default=0)
    imported_row_count = models.PositiveIntegerField(default=0)
    skipped_row_count = models.PositiveIntegerField(default=0)
    history_start = models.DateField(null=True, blank=True)
    history_end = models.DateField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['source_name', 'is_active']),
            models.Index(fields=['status', 'created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['source_name'],
                condition=Q(is_active=True),
                name='forecasting_one_active_sales_import_per_source',
            ),
        ]


class SalesHistoryRecord(models.Model):
    """A normalized transaction row belonging to an imported snapshot."""

    import_batch = models.ForeignKey(
        SalesHistoryImport,
        on_delete=models.PROTECT,
        related_name='records',
    )
    source_row_number = models.PositiveIntegerField()
    transaction_number = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=40, blank=True)
    sold_at = models.DateTimeField()
    sale_date = models.DateField(db_index=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    items_description = models.TextField(blank=True)

    class Meta:
        ordering = ['sale_date', 'source_row_number']
        constraints = [
            models.UniqueConstraint(
                fields=['import_batch', 'source_row_number'],
                name='forecasting_unique_sales_source_row',
            ),
        ]
        indexes = [
            models.Index(fields=['import_batch', 'sale_date']),
            models.Index(fields=['transaction_number']),
        ]


class ForecastRun(models.Model):
    """Immutable output and evaluation metadata for one controlled retrain."""

    model_version = models.CharField(max_length=40, default='least-squares-linear-v1')
    generated_at = models.DateTimeField(auto_now_add=True, db_index=True)
    horizon_days = models.PositiveSmallIntegerField(default=7)
    training_start = models.DateField(null=True, blank=True)
    training_end = models.DateField(null=True, blank=True)
    test_start = models.DateField(null=True, blank=True)
    test_end = models.DateField(null=True, blank=True)
    data_status = models.CharField(max_length=32, default='insufficient_history')
    predictions = models.JSONField(default=dict, blank=True)
    evaluation = models.JSONField(default=dict, blank=True)
    recommendations = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['-generated_at']
