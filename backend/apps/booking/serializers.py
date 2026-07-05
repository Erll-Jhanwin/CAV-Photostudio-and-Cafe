from rest_framework import serializers
from booking.models import Service, Package, Booking, BookingItem
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

class BookingSerializer(serializers.ModelSerializer):
    customer = UserSerializer(read_only=True)
    package_details = PackageSerializer(source='package', read_only=True)
    items = BookingItemSerializer(many=True, read_only=True)

    class Meta:
        model = Booking
        fields = [
            'id', 'customer', 'package', 'package_details', 'scheduled_date', 
            'scheduled_time', 'status', 'notes', 'created_at', 'items'
        ]
        read_only_fields = ['customer', 'status', 'created_at']

    def create(self, validated_data):
        # Obtain user from request context
        user = self.context['request'].user
        booking = Booking.objects.create(customer=user, **validated_data)
        return booking
