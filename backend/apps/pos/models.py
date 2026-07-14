from django.db import models
from django.conf import settings
from inventory.models import Product
from booking.models import Booking

class Order(models.Model):
    STATUS_CHOICES = (
        ('PENDING', 'Pending'),
        ('PAID', 'Paid'),
        ('CANCELLED', 'Cancelled'),
    )
    ORDER_TYPES = (
        ('WALK_IN', 'Walk-in Café / Studio'),
        ('BOOKING_LINKED', 'Linked to Booking'),
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
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Order #{self.id} - Total: PHP {self.total} ({self.get_payment_status_display()})"


class TransactionSequence(models.Model):
    sequence_date = models.DateField(unique=True)
    next_number = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ['-sequence_date']

    def __str__(self):
        return f"Transaction sequence {self.sequence_date}: next {self.next_number}"

class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='order_items')
    quantity = models.IntegerField(default=1)
    price = models.DecimalField(max_digits=10, decimal_places=2)  # Snapshot of price at order time
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"Order #{self.order.id} Item: {self.product.name} x {self.quantity}"

class Payment(models.Model):
    METHOD_CHOICES = (
        ('CASH', 'Cash'),
        ('GCASH', 'GCash'),
    )
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    method = models.CharField(max_length=15, choices=METHOD_CHOICES, default='CASH')
    transaction_id = models.CharField(max_length=100, blank=True, null=True, help_text="Reference ID for GCash payments")
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Payment #{self.id} for Order #{self.order.id} via {self.get_method_display()} (PHP {self.amount})"


class EndOfDayReport(models.Model):
    report_date = models.DateField()
    opening_time = models.DateTimeField(null=True, blank=True)
    closing_time = models.DateTimeField()
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='closed_pos_reports')
    staff_name = models.CharField(max_length=150, blank=True)
    total_transactions = models.PositiveIntegerField(default=0)
    gross_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discounts = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    refunds = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    opening_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gcash_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    card_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_payment_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    booking_income = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cafe_pos_income = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_items_sold = models.PositiveIntegerField(default=0)
    best_selling_items = models.JSONField(default=list, blank=True)
    cancelled_or_voided_transactions = models.PositiveIntegerField(default=0)
    cash_in_out = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actual_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_difference = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    printed_at = models.DateTimeField(null=True, blank=True)
    print_status = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-report_date', '-created_at']

    def __str__(self):
        return f"End-of-Day Report {self.report_date} closed by {self.staff_name or self.closed_by_id}"
