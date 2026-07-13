import calendar
from datetime import date

from django.db import transaction
from rest_framework import generics, permissions, status, filters, views
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from django.utils import timezone
from booking.models import Service, Package, Booking, BookingItem, BookingPayment
from booking.serializers import ServiceSerializer, PackageSerializer, BookingSerializer, BookingPaymentSerializer
from booking.availability import ACTIVE_BOOKING_STATUSES, get_available_slots, is_slot_available, parse_date_value
from notifications.models import Notification
from audit.models import AuditLog

def apply_limit(queryset, request, default=None, maximum=200):
    raw_limit = request.query_params.get('limit')
    if raw_limit is None:
        return queryset[:default] if default else queryset
    try:
        limit = min(max(int(raw_limit), 1), maximum)
    except (TypeError, ValueError):
        return queryset[:default] if default else queryset
    return queryset[:limit]

class ServiceListView(generics.ListAPIView):
    queryset = Service.objects.all().prefetch_related('packages')
    serializer_class = ServiceSerializer
    permission_classes = [permissions.AllowAny]  # Allowed for landing page

class PackageListView(generics.ListAPIView):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    permission_classes = [permissions.AllowAny]

class BookingAvailabilityView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        package_id = request.query_params.get('package')
        month = request.query_params.get('month')
        day_param = request.query_params.get('date')

        if not package_id:
            return Response({"package": "Package is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            package = Package.objects.get(id=package_id)
        except Package.DoesNotExist:
            return Response({"package": "Package not found."}, status=status.HTTP_404_NOT_FOUND)

        if day_param:
            try:
                day = parse_date_value(day_param)
            except ValueError:
                return Response({"date": "Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
            slots = get_available_slots(package.id, day)
            return Response({
                "package": package.id,
                "date": day.isoformat(),
                "status": "AVAILABLE" if any(slot['available'] for slot in slots) else "FULLY_BOOKED",
                "slots": slots,
            })

        try:
            year, month_number = [int(part) for part in (month or timezone.localdate().strftime('%Y-%m')).split('-')]
        except ValueError:
            return Response({"month": "Use YYYY-MM."}, status=status.HTTP_400_BAD_REQUEST)

        _, days_in_month = calendar.monthrange(year, month_number)
        today = timezone.localdate()
        dates = []
        for day_number in range(1, days_in_month + 1):
            day = date(year, month_number, day_number)
            if day < today:
                dates.append({"date": day.isoformat(), "status": "UNAVAILABLE", "available_count": 0})
                continue
            slots = get_available_slots(package.id, day)
            available_count = sum(1 for slot in slots if slot['available'])
            dates.append({
                "date": day.isoformat(),
                "status": "AVAILABLE" if available_count else "FULLY_BOOKED",
                "available_count": available_count,
            })

        return Response({
            "package": package.id,
            "month": f"{year:04d}-{month_number:02d}",
            "dates": dates,
        })

class BookingListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [filters.SearchFilter]
    search_fields = ['customer__username', 'customer__email']

    def get_queryset(self):
        user = self.request.user
        if user.role in ['STAFF', 'ADMIN']:
            # Staff/Admin see all bookings, filterable by date
            queryset = Booking.objects.all().select_related('customer', 'package', 'package__service').prefetch_related('items', 'payments')
            date_param = self.request.query_params.get('date')
            status_param = self.request.query_params.get('status')
            if date_param:
                queryset = queryset.filter(scheduled_date=date_param)
            if status_param:
                queryset = queryset.filter(status=status_param)
            if self.request.query_params.get('active') == 'true':
                queryset = queryset.filter(status__in=['PENDING', 'CONFIRMED', 'CONFIRMED_DP'])
            return apply_limit(queryset.order_by('scheduled_date', 'scheduled_time'), self.request)
        # Customers only see their own bookings
        queryset = Booking.objects.filter(customer=user).select_related('customer', 'package', 'package__service').prefetch_related('items', 'payments').order_by('-scheduled_date')
        return apply_limit(queryset, self.request)

    def create(self, request, *args, **kwargs):
        # Allow client booking
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            list(Booking.objects.select_for_update().filter(
                scheduled_date=serializer.validated_data['scheduled_date'],
                status__in=ACTIVE_BOOKING_STATUSES
            ))
            if not is_slot_available(
                serializer.validated_data['package'].id,
                serializer.validated_data['scheduled_date'],
                serializer.validated_data['scheduled_time']
            ):
                return Response(
                    {"scheduled_time": "This schedule was just booked. Please select another available time slot."},
                    status=status.HTTP_409_CONFLICT
                )
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
        queryset = Booking.objects.all().select_related('customer', 'package', 'package__service').prefetch_related('items', 'payments')
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

class BookingPaymentListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [filters.SearchFilter]
    search_fields = ['reference_number', 'booking__customer__username', 'booking__customer__email']

    def get_queryset(self):
        user = self.request.user
        queryset = BookingPayment.objects.select_related(
            'booking',
            'booking__customer',
            'booking__package',
            'verified_by'
        )
        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        if user.role in ['STAFF', 'ADMIN']:
            return apply_limit(queryset, self.request, default=100)
        return apply_limit(queryset.filter(booking__customer=user), self.request, default=100)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = serializer.save(status='PENDING_VERIFICATION')

        Notification.objects.create(
            user=payment.booking.customer,
            title="GCash Payment Submitted",
            message=f"Your GCash payment for booking #{payment.booking.id} is pending staff verification."
        )

        AuditLog.objects.create(
            user=request.user,
            action="BOOKING_PAYMENT_SUBMIT",
            description=f"Submitted GCash payment reference {payment.reference_number} for booking #{payment.booking.id}."
        )

        return Response(self.get_serializer(payment).data, status=status.HTTP_201_CREATED)

class BookingPaymentVerifyView(generics.UpdateAPIView):
    serializer_class = BookingPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = BookingPayment.objects.select_related('booking', 'booking__customer', 'booking__package', 'verified_by')

    def update(self, request, *args, **kwargs):
        if request.user.role not in ['STAFF', 'ADMIN']:
            return Response({"detail": "Only staff or admins can verify booking payments."}, status=status.HTTP_403_FORBIDDEN)

        payment = self.get_object()
        new_status = request.data.get('status')
        if new_status not in ['APPROVED', 'REJECTED']:
            return Response({"status": "Use APPROVED or REJECTED."}, status=status.HTTP_400_BAD_REQUEST)

        payment.status = new_status
        payment.verified_by = request.user
        payment.verified_at = timezone.now()
        payment.admin_note = request.data.get('admin_note', payment.admin_note or '')
        payment.save()

        if new_status == 'APPROVED':
            payment.booking.status = 'CONFIRMED_DP'
            payment.booking.save(update_fields=['status'])
            title = "Down Payment Verified"
            message = f"Your booking #{payment.booking.id} is confirmed. Down payment has been received."
            action = "BOOKING_PAYMENT_APPROVE"
        else:
            title = "Down Payment Rejected"
            message = f"Your GCash payment for booking #{payment.booking.id} was rejected after verification."
            action = "BOOKING_PAYMENT_REJECT"

        Notification.objects.create(
            user=payment.booking.customer,
            title=title,
            message=message
        )

        AuditLog.objects.create(
            user=request.user,
            action=action,
            description=f"{new_status.title()} payment #{payment.id} for booking #{payment.booking.id}."
        )

        return Response(self.get_serializer(payment).data)
