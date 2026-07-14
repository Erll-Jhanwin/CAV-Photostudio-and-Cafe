from rest_framework import serializers
from django.utils import timezone
from datetime import datetime
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
            'subtotal', 'discount_type', 'discount_value', 'discount_amount',
            'total', 'transaction_id', 'completed_at', 'payment_status',
            'order_type', 'created_at', 'items', 'payments'
        ]
        read_only_fields = [
            'subtotal', 'discount_type', 'discount_value', 'discount_amount',
            'total', 'transaction_id', 'completed_at', 'payment_status', 'created_at'
        ]


class EndOfDayReportSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.CharField(source='closed_by.username', read_only=True, default='')
    first_transaction_id = serializers.SerializerMethodField()
    last_transaction_id = serializers.SerializerMethodField()

    def get_transaction_ids(self, obj):
        cache_name = '_transaction_ids_cache'
        if not hasattr(obj, cache_name):
            tz = timezone.get_current_timezone()
            start = timezone.make_aware(datetime.combine(obj.report_date, datetime.min.time()), tz)
            end = timezone.make_aware(datetime.combine(obj.report_date, datetime.max.time()), tz)
            setattr(obj, cache_name, list(
                Order.objects
                .filter(payment_status='PAID', created_at__range=(start, end), transaction_id__isnull=False)
                .exclude(transaction_id='')
                .order_by('completed_at', 'id')
                .values_list('transaction_id', flat=True)
            ))
        return getattr(obj, cache_name)

    def get_first_transaction_id(self, obj):
        transaction_ids = self.get_transaction_ids(obj)
        return transaction_ids[0] if transaction_ids else ''

    def get_last_transaction_id(self, obj):
        transaction_ids = self.get_transaction_ids(obj)
        return transaction_ids[-1] if transaction_ids else ''

    class Meta:
        model = EndOfDayReport
        fields = [
            'id', 'report_date', 'opening_time', 'closing_time', 'closed_by',
            'closed_by_name', 'staff_name', 'total_transactions', 'gross_sales',
            'discounts', 'refunds', 'opening_cash', 'cash_sales',
            'gcash_sales', 'card_sales', 'other_payment_sales',
            'booking_income', 'cafe_pos_income', 'total_items_sold',
            'best_selling_items', 'cancelled_or_voided_transactions', 'cash_in_out',
            'first_transaction_id', 'last_transaction_id',
            'expected_cash', 'actual_cash', 'cash_difference', 'printed_at',
            'print_status', 'created_at'
        ]
        read_only_fields = fields
