from rest_framework import serializers
from pos.models import Order, OrderItem, Payment

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
