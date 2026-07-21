from rest_framework import serializers

from payment.models import Payment
from pos.models import Order


class OrderItemSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    product = serializers.IntegerField()
    product_details = serializers.JSONField(read_only=True)
    quantity = serializers.IntegerField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2)


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'amount', 'method', 'transaction_id', 'timestamp']


class OrderSerializer(serializers.ModelSerializer):
    items = serializers.JSONField(source='line_items', read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    staff_name = serializers.CharField(source='staff.username', read_only=True)
    booking_customer_name = serializers.CharField(source='booking.customer.username', read_only=True, default='')

    class Meta:
        model = Order
        fields = [
            'id', 'staff', 'staff_name', 'booking', 'booking_customer_name',
            'subtotal', 'discount_type', 'discount_value', 'discount_amount',
            'total', 'transaction_id', 'completed_at', 'payment_status',
            'order_type', 'created_at', 'items', 'payments'
        ]
        read_only_fields = [
            'subtotal', 'discount_type', 'discount_value', 'discount_amount',
            'total', 'transaction_id', 'completed_at', 'payment_status', 'created_at'
        ]


class EndOfDayReportSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    report_date = serializers.DateField()
    opening_time = serializers.DateTimeField(allow_null=True)
    closing_time = serializers.DateTimeField()
    closed_by = serializers.IntegerField(allow_null=True)
    closed_by_name = serializers.CharField(allow_blank=True)
    staff_name = serializers.CharField(allow_blank=True)
    total_transactions = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=12, decimal_places=2)
    discounts = serializers.DecimalField(max_digits=12, decimal_places=2)
    refunds = serializers.DecimalField(max_digits=12, decimal_places=2)
    opening_cash = serializers.DecimalField(max_digits=12, decimal_places=2)
    cash_sales = serializers.DecimalField(max_digits=12, decimal_places=2)
    gcash_sales = serializers.DecimalField(max_digits=12, decimal_places=2)
    card_sales = serializers.DecimalField(max_digits=12, decimal_places=2)
    other_payment_sales = serializers.DecimalField(max_digits=12, decimal_places=2)
    booking_income = serializers.DecimalField(max_digits=12, decimal_places=2)
    cafe_pos_income = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_items_sold = serializers.IntegerField()
    best_selling_items = serializers.JSONField()
    cancelled_or_voided_transactions = serializers.IntegerField()
    cash_in_out = serializers.DecimalField(max_digits=12, decimal_places=2)
    first_transaction_id = serializers.CharField(allow_blank=True)
    last_transaction_id = serializers.CharField(allow_blank=True)
    expected_cash = serializers.DecimalField(max_digits=12, decimal_places=2)
    actual_cash = serializers.DecimalField(max_digits=12, decimal_places=2)
    cash_difference = serializers.DecimalField(max_digits=12, decimal_places=2)
    printed_at = serializers.DateTimeField(allow_null=True)
    print_status = serializers.JSONField()
    created_at = serializers.DateTimeField()
