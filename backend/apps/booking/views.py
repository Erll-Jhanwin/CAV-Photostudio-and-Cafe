import calendar
from datetime import date

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import generics, permissions, status, filters, views
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from django.utils import timezone
from booking.models import Service, Package, Booking, BookingItem, BookingPayment, BookingChangeLog
from booking.serializers import ServiceSerializer, PackageSerializer, BookingSerializer, BookingPaymentSerializer
from booking.availability import ACTIVE_BOOKING_STATUSES, get_available_slots, is_slot_available, parse_date_value
from booking.payment_ocr import analyze_gcash_receipt
from notifications.models import Notification
from audit.models import AuditLog

User = get_user_model()

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
        exclude_booking_id = request.query_params.get('exclude_booking')

        if not package_id:
            return Response({"package": "Package is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            package = Package.objects.get(id=package_id)
        except Package.DoesNotExist:
            return Response({"package": "Package not found."}, status=status.HTTP_404_NOT_FOUND)

        if exclude_booking_id:
            try:
                booking = Booking.objects.get(id=exclude_booking_id)
            except Booking.DoesNotExist:
                return Response({"exclude_booking": "Booking not found."}, status=status.HTTP_404_NOT_FOUND)
            if request.user.role not in ['STAFF', 'ADMIN'] and booking.customer_id != request.user.id:
                return Response({"detail": "You cannot check availability for this booking."}, status=status.HTTP_403_FORBIDDEN)

        if day_param:
            try:
                day = parse_date_value(day_param)
            except ValueError:
                return Response({"date": "Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
            slots = get_available_slots(package.id, day, exclude_booking_id=exclude_booking_id)
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
            slots = get_available_slots(package.id, day, exclude_booking_id=exclude_booking_id)
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
        updated_booking = booking
        user = request.user
        is_staff_user = user.role in ['STAFF', 'ADMIN']
        editable_fields = {'package', 'scheduled_date', 'scheduled_time', 'notes'}
        customer_fields = {'first_name', 'last_name', 'email', 'phone_number', 'address'}
        requested_edit_fields = editable_fields.intersection(request.data.keys())
        requested_customer_fields = customer_fields.intersection(request.data.keys())
        
        # Check permissions: staff/admin can manage statuses; customers can only cancel their own pending booking.
        new_status = request.data.get('status')
        if not is_staff_user and new_status and (requested_edit_fields or requested_customer_fields):
            return Response({"detail": "Change booking status separately from booking edits."}, status=status.HTTP_400_BAD_REQUEST)

        if new_status and booking.status != new_status:
            customer_cancel = (
                not is_staff_user and
                booking.customer_id == user.id and
                new_status == 'CANCELLED' and
                booking.status == 'PENDING'
            )
            if not is_staff_user and not customer_cancel:
                return Response({"detail": "Only staff members can update booking status."}, status=status.HTTP_403_FORBIDDEN)
            
            booking.status = new_status
            booking.save(update_fields=['status'])
            
            # Send Notification to Customer
            Notification.objects.create(
                user=booking.customer,
                title="Booking Cancelled" if customer_cancel else f"Booking Status Updated: {new_status}",
                message=(
                    f"Your booking for {booking.package.name} on {booking.scheduled_date} was cancelled."
                    if customer_cancel
                    else f"Your booking for {booking.package.name} on {booking.scheduled_date} is now {new_status}."
                )
            )
            
            # Log Audit
            AuditLog.objects.create(
                user=user,
                action="BOOKING_CANCEL" if customer_cancel else "BOOKING_STATUS_CHANGE",
                description=(
                    f"Customer cancelled booking #{booking.id}."
                    if customer_cancel
                    else f"Updated booking #{booking.id} status to {new_status}."
                )
            )

        if not is_staff_user and (requested_edit_fields or requested_customer_fields):
            if booking.customer_id != user.id:
                return Response({"detail": "You can only edit your own bookings."}, status=status.HTTP_403_FORBIDDEN)
            if not booking.is_customer_editable:
                return Response(
                    {"detail": booking.customer_edit_lock_reason or "This booking can no longer be edited."},
                    status=status.HTTP_403_FORBIDDEN
                )
            if new_status and new_status != booking.status:
                return Response({"detail": "Booking status cannot be changed with booking edits."}, status=status.HTTP_400_BAD_REQUEST)

        old_values = {}
        for field in requested_edit_fields:
            value = getattr(booking, f"{field}_id", None) if field == 'package' else getattr(booking, field, None)
            old_values[field] = str(value) if value is not None else ''
        if requested_customer_fields:
            for field in requested_customer_fields:
                old_values[field] = getattr(booking.customer, field, '') or ''
        if 'total_price' in requested_edit_fields or 'package' in requested_edit_fields:
            old_values['total_price'] = str(booking.package.price)

        with transaction.atomic():
            if requested_edit_fields:
                list(Booking.objects.select_for_update().filter(
                    scheduled_date=request.data.get('scheduled_date', booking.scheduled_date),
                    status__in=ACTIVE_BOOKING_STATUSES
                ))

            serializer = self.get_serializer(booking, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            updated_booking = serializer.save()

            if requested_customer_fields:
                customer = updated_booking.customer
                for field in requested_customer_fields:
                    setattr(customer, field, request.data.get(field, getattr(customer, field)))
                customer.save(update_fields=list(requested_customer_fields))

            updated_booking = Booking.objects.select_related('customer', 'package', 'package__service').prefetch_related(
                'items', 'payments', 'change_history'
            ).get(pk=updated_booking.pk)

            new_values = {}
            for field in requested_edit_fields:
                value = getattr(updated_booking, f"{field}_id", None) if field == 'package' else getattr(updated_booking, field, None)
                new_values[field] = str(value) if value is not None else ''
            if requested_customer_fields:
                for field in requested_customer_fields:
                    new_values[field] = getattr(updated_booking.customer, field, '') or ''
            if 'package' in requested_edit_fields:
                new_values['total_price'] = str(updated_booking.package.price)

            changed_values = {
                key: {'from': old_values.get(key, ''), 'to': new_values.get(key, '')}
                for key in set(old_values) | set(new_values)
                if old_values.get(key, '') != new_values.get(key, '')
            }

            if changed_values:
                BookingChangeLog.objects.create(
                    booking=updated_booking,
                    changed_by=user,
                    old_values={key: value['from'] for key, value in changed_values.items()},
                    new_values={key: value['to'] for key, value in changed_values.items()},
                    reason=request.data.get('change_reason', 'Customer updated booking details')[:220],
                )

                AuditLog.objects.create(
                    user=user,
                    action="BOOKING_UPDATE",
                    description=f"Updated booking #{updated_booking.id}: {', '.join(sorted(changed_values.keys()))}."
                )

                staff_users = User.objects.filter(role__in=['STAFF', 'ADMIN'])
                notifications = [
                    Notification(
                        user=staff,
                        title="Booking Updated",
                        message=(
                            f"Booking #{updated_booking.id} for "
                            f"{updated_booking.customer.get_full_name() or updated_booking.customer.username} "
                            f"was updated. New schedule: {updated_booking.scheduled_date} at {updated_booking.scheduled_time}."
                        )
                    )
                    for staff in staff_users
                ]
                Notification.objects.bulk_create(notifications)

        updated_booking = Booking.objects.select_related('customer', 'package', 'package__service').prefetch_related(
            'items', 'payments', 'change_history'
        ).get(pk=updated_booking.pk)
        return Response(self.get_serializer(updated_booking).data)

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

class BookingPaymentReferenceCheckView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        reference_number = (request.query_params.get('reference_number') or '').strip()
        if not reference_number:
            return Response({"exists": False, "reference_number": ""})
        exists = BookingPayment.objects.filter(reference_number__iexact=reference_number).exists()
        return Response({
            "exists": exists,
            "reference_number": reference_number,
            "message": "This GCash reference number has already been submitted." if exists else ""
        })

class BookingPaymentOcrView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        receipt = request.FILES.get('receipt')
        if not receipt:
            return Response({"receipt": "Upload a GCash screenshot."}, status=status.HTTP_400_BAD_REQUEST)
        result = analyze_gcash_receipt(receipt)
        reference_number = result.get('fields', {}).get('reference_number', {}).get('value')
        if reference_number:
            duplicate_exists = BookingPayment.objects.filter(reference_number__iexact=reference_number).exists()
            result['duplicate_reference'] = duplicate_exists
            if duplicate_exists:
                result.setdefault('warnings', []).append('This GCash reference number has already been submitted.')
        else:
            result['duplicate_reference'] = False
        return Response(result)

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
