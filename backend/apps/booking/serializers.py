from decimal import Decimal
import re
from rest_framework import serializers
from booking.models import Service, Package, Booking, StudioUnavailableDate
from booking.availability import is_slot_available
from payment.models import Payment
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

class BookingItemSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(max_length=100)
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    quantity = serializers.IntegerField()

class BookingChangeLogSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    changed_by = serializers.IntegerField(required=False, allow_null=True)
    changed_by_name = serializers.CharField(required=False)
    old_values = serializers.JSONField()
    new_values = serializers.JSONField()
    reason = serializers.CharField(allow_blank=True)
    created_at = serializers.DateTimeField()

class BookingPaymentSerializer(serializers.ModelSerializer):
    booking_details = serializers.SerializerMethodField()
    receipt_url = serializers.SerializerMethodField()
    verified_by_details = UserSerializer(source='verified_by', read_only=True)
    required_down_payment = serializers.SerializerMethodField()
    idempotency_key = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Payment
        fields = [
            'id', 'booking', 'booking_details', 'reference_number', 'amount',
            'paid_at', 'receipt', 'receipt_url', 'status', 'verified_by',
            'verified_by_details', 'verified_at', 'admin_note',
            'required_down_payment', 'idempotency_key', 'created_at', 'updated_at'
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
            'customer_profile_picture_url': UserSerializer(booking.customer, context=self.context).data.get('profile_picture_url', ''),
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
        reference_number = attrs.get('reference_number') or getattr(self.instance, 'reference_number', '')
        request = self.context.get('request')

        if request and booking and request.user.role not in ['STAFF', 'ADMIN'] and booking.customer_id != request.user.id:
            raise serializers.ValidationError({'booking': 'You can only submit payments for your own bookings.'})

        if reference_number:
            normalized_reference = str(reference_number).strip()
            if not re.fullmatch(r'[A-Za-z0-9\- ]{6,100}', normalized_reference):
                raise serializers.ValidationError({
                    'reference_number': 'Reference number must be 6-100 letters, numbers, spaces, or hyphens.'
                })
            duplicate_qs = Payment.objects.filter(payment_type=Payment.BOOKING, reference_number__iexact=normalized_reference)
            if self.instance:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if duplicate_qs.exists():
                raise serializers.ValidationError({
                    'reference_number': 'This GCash reference number has already been submitted.'
                })
            attrs['reference_number'] = normalized_reference

        if booking and amount is not None:
            if amount <= 0:
                raise serializers.ValidationError({'amount': 'Amount must be greater than zero.'})
            required_down_payment = booking.package.price * Decimal('0.50')
            if amount < required_down_payment:
                raise serializers.ValidationError({
                    'amount': f'Minimum down payment is PHP {required_down_payment}.'
                })

        return attrs

    def validate_receipt(self, value):
        max_size = 5 * 1024 * 1024
        allowed_types = {'image/jpeg', 'image/png', 'image/webp', 'application/pdf'}
        if value.size > max_size:
            raise serializers.ValidationError('Receipt file must be 5MB or smaller.')
        content_type = getattr(value, 'content_type', '')
        if content_type and content_type not in allowed_types:
            raise serializers.ValidationError('Receipt must be a JPG, PNG, WEBP, or PDF file.')
        return value

class BookingSerializer(serializers.ModelSerializer):
    customer = UserSerializer(read_only=True)
    package_details = PackageSerializer(source='package', read_only=True)
    items = serializers.JSONField(read_only=True)
    payments = BookingPaymentSerializer(many=True, read_only=True)
    change_history = serializers.JSONField(read_only=True)
    required_down_payment = serializers.SerializerMethodField()
    can_edit = serializers.BooleanField(source='is_customer_editable', read_only=True)
    edit_locked_reason = serializers.CharField(source='customer_edit_lock_reason', read_only=True)
    edit_deadline = serializers.DateTimeField(read_only=True)
    first_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    last_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    phone_number = serializers.CharField(write_only=True, required=False, allow_blank=True)
    address = serializers.CharField(write_only=True, required=False, allow_blank=True)
    idempotency_key = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Booking
        fields = [
            'id', 'customer', 'package', 'package_details', 'scheduled_date', 
            'scheduled_time', 'status', 'notes', 'created_at', 'items',
            'payments', 'required_down_payment', 'change_history',
            'can_edit', 'edit_locked_reason', 'edit_deadline',
            'first_name', 'last_name', 'email', 'phone_number', 'address',
            'idempotency_key'
        ]
        read_only_fields = ['customer', 'status', 'created_at']

    def get_required_down_payment(self, obj):
        return obj.package.price * Decimal('0.50')

    def validate(self, attrs):
        if self.instance is None:
            missing = {}
            if not (attrs.get('first_name') or '').strip():
                missing['first_name'] = 'Full name is required.'
            if not (attrs.get('email') or '').strip():
                missing['email'] = 'Email address is required.'
            if not (attrs.get('phone_number') or '').strip():
                missing['phone_number'] = 'Contact number is required.'
            if missing:
                raise serializers.ValidationError(missing)

        phone_number = attrs.get('phone_number')
        if phone_number is not None:
            phone_digits = re.sub(r'\D', '', phone_number)
            if len(phone_digits) < 7:
                raise serializers.ValidationError({'phone_number': 'Enter a valid contact number.'})
            attrs['phone_number'] = phone_number.strip()

        for field in ['first_name', 'last_name', 'email', 'address', 'notes']:
            if field in attrs and isinstance(attrs[field], str):
                attrs[field] = attrs[field].strip()

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
        customer_data = {
            field: validated_data.pop(field)
            for field in ['first_name', 'last_name', 'email', 'phone_number', 'address']
            if field in validated_data
        }
        user = self.context['request'].user
        self._update_customer(user, customer_data)
        booking = Booking.objects.create(customer=user, **validated_data)
        return booking

    def update(self, instance, validated_data):
        validated_data.pop('idempotency_key', None)
        customer_data = {
            field: validated_data.pop(field)
            for field in ['first_name', 'last_name', 'email', 'phone_number', 'address']
            if field in validated_data
        }
        if customer_data:
            self._update_customer(instance.customer, customer_data)
        return super().update(instance, validated_data)

    def _update_customer(self, user, customer_data):
        if not customer_data:
            return
        for field, value in customer_data.items():
            setattr(user, field, value)
        user.save(update_fields=list(customer_data.keys()))


class StudioUnavailableDateSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = StudioUnavailableDate
        fields = ['id', 'date', 'reason', 'created_by', 'created_by_name', 'created_at', 'updated_at']
        read_only_fields = ['created_by', 'created_by_name', 'created_at', 'updated_at']

    def validate_reason(self, value):
        value = str(value or '').strip()
        if len(value) < 3:
            raise serializers.ValidationError('Reason must be at least 3 characters.')
        return value[:220]
