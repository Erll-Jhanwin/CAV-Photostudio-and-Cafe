from rest_framework import serializers
from pos.models import Order, OrderItem, Payment, EndOfDayReport

class ProductOrderSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    image_url = serializers.CharField(allow_blank=True, allow_null=True)

class OrderItemSerializer(serializers.ModelSerializer):
    product_details = ProductOrderSummarySerializer(source='product', read_only=True)

    class Meta:
        model = OrderItem
        fields = ['id', 'product', 'product_details', 'quantity', 'price', 'subtotal']

class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'amount', 'method', 'transaction_id', 'timestamp']

class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    staff_name = serializers.CharField(source='staff.username', read_only=True)
    booking_customer_name = serializers.CharField(source='booking.customer.username', read_only=True, default='')

    class Meta:
        model = Order
        fields = [
            'id', 'staff', 'staff_name', 'booking', 'booking_customer_name', 
            'total', 'payment_status', 'order_type', 'created_at', 'items', 'payments'
        ]
        read_only_fields = ['total', 'payment_status', 'created_at']


class EndOfDayReportSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.CharField(source='closed_by.username', read_only=True, default='')

    class Meta:
        model = EndOfDayReport
        fields = [
            'id', 'report_date', 'opening_time', 'closing_time', 'closed_by',
            'closed_by_name', 'staff_name', 'total_transactions', 'gross_sales',
            'discounts', 'refunds', 'cash_sales', 'other_payment_sales',
            'booking_income', 'cafe_pos_income', 'total_items_sold',
            'best_selling_items', 'cancelled_or_voided_transactions',
            'expected_cash', 'actual_cash', 'cash_difference', 'printed_at',
            'print_status', 'created_at'
        ]
        read_only_fields = fields
