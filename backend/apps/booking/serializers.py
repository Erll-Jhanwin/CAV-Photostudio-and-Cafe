from decimal import Decimal
from rest_framework import serializers
from booking.models import Service, Package, Booking, BookingItem, BookingPayment
from booking.availability import is_slot_available
from users.serializers import UserSerializer

class PackageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Package
        fields = ['id', 'service', 'name', 'description', 'price', 'inclusions']

class ServiceSerializer(serializers.ModelSerializer):
    packages = PackageSerializer(many=True, read_only=True)

    class Meta:
        model = Service
        fields = ['id', 'name', 'description', 'duration_minutes', 'base_price', 'image_url', 'packages']

class BookingItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingItem
        fields = ['id', 'name', 'price', 'quantity']

class BookingPaymentSerializer(serializers.ModelSerializer):
    booking_details = serializers.SerializerMethodField()
    receipt_url = serializers.SerializerMethodField()
    verified_by_details = UserSerializer(source='verified_by', read_only=True)
    required_down_payment = serializers.SerializerMethodField()

    class Meta:
        model = BookingPayment
        fields = [
            'id', 'booking', 'booking_details', 'reference_number', 'amount',
            'paid_at', 'receipt', 'receipt_url', 'status', 'verified_by',
            'verified_by_details', 'verified_at', 'admin_note',
            'required_down_payment', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'status', 'verified_by', 'verified_at', 'admin_note',
            'created_at', 'updated_at'
        ]

    def get_booking_details(self, obj):
        booking = obj.booking
        return {
            'id': booking.id,
            'status': booking.status,
            'scheduled_date': booking.scheduled_date,
            'scheduled_time': booking.scheduled_time,
            'customer_name': booking.customer.get_full_name() or booking.customer.username,
            'customer_email': booking.customer.email,
            'package_name': booking.package.name,
            'package_price': booking.package.price,
        }

    def get_receipt_url(self, obj):
        if not obj.receipt:
            return None
        request = self.context.get('request')
        url = obj.receipt.url
        return request.build_absolute_uri(url) if request else url

    def get_required_down_payment(self, obj):
        return obj.booking.package.price * Decimal('0.50')

    def validate(self, attrs):
        booking = attrs.get('booking') or getattr(self.instance, 'booking', None)
        amount = attrs.get('amount') or getattr(self.instance, 'amount', None)
        request = self.context.get('request')

        if request and booking and request.user.role not in ['STAFF', 'ADMIN'] and booking.customer_id != request.user.id:
            raise serializers.ValidationError({'booking': 'You can only submit payments for your own bookings.'})

        if booking and amount is not None:
            required_down_payment = booking.package.price * Decimal('0.50')
            if amount < required_down_payment:
                raise serializers.ValidationError({
                    'amount': f'Minimum down payment is PHP {required_down_payment}.'
                })

        return attrs

class BookingSerializer(serializers.ModelSerializer):
    customer = UserSerializer(read_only=True)
    package_details = PackageSerializer(source='package', read_only=True)
    items = BookingItemSerializer(many=True, read_only=True)
    payments = BookingPaymentSerializer(many=True, read_only=True)
    required_down_payment = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            'id', 'customer', 'package', 'package_details', 'scheduled_date', 
            'scheduled_time', 'status', 'notes', 'created_at', 'items',
            'payments', 'required_down_payment'
        ]
        read_only_fields = ['customer', 'status', 'created_at']

    def get_required_down_payment(self, obj):
        return obj.package.price * Decimal('0.50')

    def validate(self, attrs):
        schedule_changed = self.instance is None or any(
            field in attrs for field in ['package', 'scheduled_date', 'scheduled_time']
        )
        if not schedule_changed:
            return attrs

        package = attrs.get('package') or getattr(self.instance, 'package', None)
        scheduled_date = attrs.get('scheduled_date') or getattr(self.instance, 'scheduled_date', None)
        scheduled_time = attrs.get('scheduled_time') or getattr(self.instance, 'scheduled_time', None)

        if package and scheduled_date and scheduled_time:
            if not is_slot_available(package.id, scheduled_date, scheduled_time, getattr(self.instance, 'id', None)):
                raise serializers.ValidationError({
                    'scheduled_time': 'This schedule is no longer available. Please select another time slot.'
                })

        return attrs

    def create(self, validated_data):
        # Obtain user from request context
        user = self.context['request'].user
        booking = Booking.objects.create(customer=user, **validated_data)
        return booking
