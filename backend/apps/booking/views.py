from rest_framework import generics, permissions, status, filters
from rest_framework.response import Response
from django.utils import timezone
from booking.models import Service, Package, Booking, BookingItem
from booking.serializers import ServiceSerializer, PackageSerializer, BookingSerializer
from notifications.models import Notification
from audit.models import AuditLog

class ServiceListView(generics.ListAPIView):
    queryset = Service.objects.all().prefetch_related('packages')
    serializer_class = ServiceSerializer
    permission_classes = [permissions.AllowAny]  # Allowed for landing page

class PackageListView(generics.ListAPIView):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    permission_classes = [permissions.AllowAny]

class BookingListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [filters.SearchFilter]
    search_fields = ['customer__username', 'customer__email']

    def get_queryset(self):
        user = self.request.user
        if user.role in ['STAFF', 'ADMIN']:
            # Staff/Admin see all bookings, filterable by date
            queryset = Booking.objects.all().select_related('customer', 'package', 'package__service').prefetch_related('items')
            date_param = self.request.query_params.get('date')
            status_param = self.request.query_params.get('status')
            if date_param:
                queryset = queryset.filter(scheduled_date=date_param)
            if status_param:
                queryset = queryset.filter(status=status_param)
            return queryset.order_by('scheduled_date', 'scheduled_time')
        # Customers only see their own bookings
        return Booking.objects.filter(customer=user).select_related('customer', 'package', 'package__service').prefetch_related('items').order_by('-scheduled_date')

    def create(self, request, *args, **kwargs):
        # Allow client booking
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        booking = serializer.save()
        
        # Add custom items if supplied in request
        items_data = request.data.get('items', [])
        for item in items_data:
            BookingItem.objects.create(
                booking=booking,
                name=item.get('name'),
                price=item.get('price'),
                quantity=item.get('quantity', 1)
            )

        # Notify Customer
        Notification.objects.create(
            user=request.user,
            title="Booking Submitted",
            message=f"Your booking for {booking.package.name} on {booking.scheduled_date} at {booking.scheduled_time} is pending confirmation."
        )

        # Log Audit
        AuditLog.objects.create(
            user=request.user,
            action="BOOKING_CREATE",
            description=f"Created booking #{booking.id} for {booking.package.name}."
        )

        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)

class BookingDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BookingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Booking.objects.all().select_related('customer', 'package', 'package__service').prefetch_related('items')
        user = self.request.user
        if user.role in ['STAFF', 'ADMIN']:
            return queryset
        return queryset.filter(customer=user)

    def update(self, request, *args, **kwargs):
        booking = self.get_object()
        user = request.user
        
        # Check permissions: only Staff/Admin can edit status
        new_status = request.data.get('status')
        if new_status and booking.status != new_status:
            if user.role not in ['STAFF', 'ADMIN']:
                return Response({"detail": "Only staff members can update booking status."}, status=status.HTTP_403_FORBIDDEN)
            
            booking.status = new_status
            booking.save()
            
            # Send Notification to Customer
            Notification.objects.create(
                user=booking.customer,
                title=f"Booking Status Updated: {new_status}",
                message=f"Your booking for {booking.package.name} on {booking.scheduled_date} is now {new_status}."
            )
            
            # Log Audit
            AuditLog.objects.create(
                user=user,
                action="BOOKING_STATUS_CHANGE",
                description=f"Updated booking #{booking.id} status to {new_status}."
            )

        # Update other fields (notes, date, time) if allowed
        serializer = self.get_serializer(booking, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        if request.user.role != 'ADMIN':
            return Response({"detail": "Only admins can delete bookings."}, status=status.HTTP_403_FORBIDDEN)

        booking = self.get_object()
        booking_id = booking.id
        package_name = booking.package.name if booking.package else "Unknown package"
        customer = booking.customer
        scheduled_date = booking.scheduled_date

        booking.delete()

        Notification.objects.create(
            user=customer,
            title="Booking Deleted",
            message=f"Your booking for {package_name} on {scheduled_date} was deleted by an admin."
        )
        AuditLog.objects.create(
            user=request.user,
            action="BOOKING_DELETE",
            description=f"Deleted booking #{booking_id} for {package_name}."
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
