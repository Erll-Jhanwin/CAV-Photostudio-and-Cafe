import calendar
from datetime import date
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from rest_framework import generics, permissions, status, filters, views
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from django.utils import timezone
from booking.models import Service, Package, Booking
from booking.serializers import ServiceSerializer, PackageSerializer, BookingSerializer, BookingPaymentSerializer
from booking.availability import ACTIVE_BOOKING_STATUSES, get_available_slots, is_slot_available, parse_date_value
from booking.payment_ocr import analyze_gcash_receipt
from payment.models import Payment
from audit.models import AuditLog

User = get_user_model()

IDEMPOTENCY_KEY_MAX_LENGTH = 100
OBSOLETE_SERVICE_NAMES = ['Self-Shoot Studio', 'Boutique Portrait']

def get_idempotency_key(request):
    value = request.headers.get('Idempotency-Key') or request.headers.get('X-Idempotency-Key') or request.data.get('idempotency_key')
    value = str(value or '').strip()
    if not value:
        return ''
    return value[:IDEMPOTENCY_KEY_MAX_LENGTH]

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
    serializer_class = ServiceSerializer
    permission_classes = [permissions.AllowAny]  # Allowed for landing page

    def get_queryset(self):
        package_queryset = Package.objects.exclude(service__name__in=OBSOLETE_SERVICE_NAMES).order_by('service_id', 'id').distinct()
        return Service.objects.exclude(name__in=OBSOLETE_SERVICE_NAMES).order_by('id').distinct().prefetch_related(
            Prefetch('packages', queryset=package_queryset)
        )

class PackageListView(generics.ListAPIView):
    serializer_class = PackageSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        return Package.objects.exclude(service__name__in=OBSOLETE_SERVICE_NAMES).select_related('service').order_by('service_id', 'id').distinct()

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
            package_id = int(package_id)
        except (TypeError, ValueError):
            return Response({"package": "Package must be a valid ID."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            package = Package.objects.get(id=package_id)
        except Package.DoesNotExist:
            return Response({"package": "Package not found."}, status=status.HTTP_404_NOT_FOUND)

        if exclude_booking_id:
            try:
                exclude_booking_id = int(exclude_booking_id)
                booking = Booking.objects.get(id=exclude_booking_id)
            except (TypeError, ValueError):
                return Response({"exclude_booking": "Booking must be a valid ID."}, status=status.HTTP_400_BAD_REQUEST)
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
            if year < 1900 or year > 2100:
                raise ValueError
            _, days_in_month = calendar.monthrange(year, month_number)
        except (ValueError, calendar.IllegalMonthError):
            return Response({"month": "Use YYYY-MM."}, status=status.HTTP_400_BAD_REQUEST)

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
            queryset = Booking.objects.all().select_related('customer', 'package', 'package__service').prefetch_related('payments').distinct()
            date_param = self.request.query_params.get('date')
            status_param = self.request.query_params.get('status')
            if date_param:
                queryset = queryset.filter(scheduled_date=date_param)
            if status_param:
                queryset = queryset.filter(status=status_param)
            if self.request.query_params.get('active') == 'true':
                queryset = queryset.filter(status__in=['PENDING', 'CONFIRMED', 'CONFIRMED_DP'])
            return apply_limit(queryset.order_by('scheduled_date', 'scheduled_time', 'id'), self.request)
        # Customers only see their own bookings
        queryset = Booking.objects.filter(customer=user).select_related('customer', 'package', 'package__service').prefetch_related('payments').distinct().order_by('-scheduled_date', '-created_at', '-id')
        return apply_limit(queryset, self.request)

    def create(self, request, *args, **kwargs):
        # Allow client booking
        idempotency_key = get_idempotency_key(request)
        if idempotency_key:
            existing_booking = Booking.objects.filter(customer=request.user, idempotency_key=idempotency_key).select_related(
                'customer', 'package', 'package__service'
            ).prefetch_related('payments').first()
            if existing_booking:
                return Response(BookingSerializer(existing_booking, context={'request': request}).data, status=status.HTTP_200_OK)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items_data = request.data.get('items', [])
        if not isinstance(items_data, list):
            return Response({"items": "Items must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        normalized_items_by_name = {}
        for item in items_data:
            if not isinstance(item, dict):
                return Response({"items": "Each item must be an object."}, status=status.HTTP_400_BAD_REQUEST)
            name = str(item.get('name') or '').strip()
            if not name or len(name) > 100:
                return Response({"items": "Each item needs a name up to 100 characters."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                price = Decimal(str(item.get('price')))
                quantity = int(item.get('quantity', 1))
            except (TypeError, ValueError, InvalidOperation):
                return Response({"items": "Item price and quantity must be valid numbers."}, status=status.HTTP_400_BAD_REQUEST)
            if price < 0 or quantity < 1:
                return Response({"items": "Item price cannot be negative and quantity must be at least 1."}, status=status.HTTP_400_BAD_REQUEST)
            item_key = name.casefold()
            if item_key in normalized_items_by_name:
                normalized_items_by_name[item_key]['quantity'] += quantity
            else:
                normalized_items_by_name[item_key] = {"name": name, "price": price, "quantity": quantity}
        normalized_items = list(normalized_items_by_name.values())

        try:
            with transaction.atomic():
                list(Booking.objects.select_for_update().filter(
                    scheduled_date=serializer.validated_data['scheduled_date'],
                    status__in=ACTIVE_BOOKING_STATUSES
                ))
                if idempotency_key:
                    existing_booking = Booking.objects.filter(customer=request.user, idempotency_key=idempotency_key).select_related(
                        'customer', 'package', 'package__service'
                    ).prefetch_related('payments').first()
                    if existing_booking:
                        return Response(BookingSerializer(existing_booking, context={'request': request}).data, status=status.HTTP_200_OK)
                if not is_slot_available(
                    serializer.validated_data['package'].id,
                    serializer.validated_data['scheduled_date'],
                    serializer.validated_data['scheduled_time']
                ):
                    return Response(
                        {"scheduled_time": "This schedule was just booked. Please select another available time slot."},
                        status=status.HTTP_409_CONFLICT
                    )
                booking = serializer.save(
                    idempotency_key=idempotency_key or None,
                    items=[
                        {
                            "id": index + 1,
                            "name": item['name'],
                            "price": str(item['price']),
                            "quantity": item['quantity'],
                        }
                        for index, item in enumerate(normalized_items)
                    ]
                )
        except IntegrityError:
            if idempotency_key:
                existing_booking = Booking.objects.filter(customer=request.user, idempotency_key=idempotency_key).select_related(
                    'customer', 'package', 'package__service'
                ).prefetch_related('payments').first()
                if existing_booking:
                    return Response(BookingSerializer(existing_booking, context={'request': request}).data, status=status.HTTP_200_OK)
            return Response(
                {"scheduled_time": "This schedule was just booked. Please select another available time slot."},
                status=status.HTTP_409_CONFLICT
            )

        # Log Audit
        AuditLog.objects.create(
            user=request.user,
            action="BOOKING_CREATE",
            description=f"Created booking #{booking.id} for {booking.package.name}."
        )

        return Response(BookingSerializer(booking, context={'request': request}).data, status=status.HTTP_201_CREATED)

class BookingDetailUpdateView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BookingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Booking.objects.all().select_related('customer', 'package', 'package__service').prefetch_related('payments').distinct()
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
        valid_statuses = {choice[0] for choice in Booking.STATUS_CHOICES}
        if new_status and new_status not in valid_statuses:
            return Response({"status": "Invalid booking status."}, status=status.HTTP_400_BAD_REQUEST)
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
                'payments'
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
                history = list(updated_booking.change_history or [])
                history.insert(0, {
                    "id": len(history) + 1,
                    "changed_by": user.id,
                    "changed_by_name": user.get_full_name() or user.username,
                    "old_values": {key: value['from'] for key, value in changed_values.items()},
                    "new_values": {key: value['to'] for key, value in changed_values.items()},
                    "reason": request.data.get('change_reason', 'Customer updated booking details')[:220],
                    "created_at": timezone.now().isoformat(),
                })
                updated_booking.change_history = history
                updated_booking.save(update_fields=['change_history'])

                AuditLog.objects.create(
                    user=user,
                    action="BOOKING_UPDATE",
                    description=f"Updated booking #{updated_booking.id}: {', '.join(sorted(changed_values.keys()))}."
                )

        updated_booking = Booking.objects.select_related('customer', 'package', 'package__service').prefetch_related(
            'payments'
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
        queryset = Payment.objects.filter(payment_type=Payment.BOOKING).select_related(
            'booking',
            'booking__customer',
            'booking__package',
            'verified_by'
        ).distinct().order_by('-created_at', '-id')
        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        if user.role in ['STAFF', 'ADMIN']:
            return apply_limit(queryset, self.request, default=100)
        return apply_limit(queryset.filter(booking__customer=user), self.request, default=100)

    def create(self, request, *args, **kwargs):
        idempotency_key = get_idempotency_key(request)
        if idempotency_key:
            existing_payment = Payment.objects.filter(
                payment_type=Payment.BOOKING,
                idempotency_key=idempotency_key,
            ).select_related('booking', 'booking__customer', 'booking__package', 'verified_by').first()
            if existing_payment:
                return Response(self.get_serializer(existing_payment).data, status=status.HTTP_200_OK)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payment = serializer.save(
                payment_type=Payment.BOOKING,
                method='GCASH',
                status='PENDING_VERIFICATION',
                paid_at=serializer.validated_data.get('paid_at') or timezone.now(),
                idempotency_key=idempotency_key or None,
            )
        except IntegrityError:
            if idempotency_key:
                existing_payment = Payment.objects.filter(
                    payment_type=Payment.BOOKING,
                    idempotency_key=idempotency_key,
                ).select_related('booking', 'booking__customer', 'booking__package', 'verified_by').first()
                if existing_payment:
                    return Response(self.get_serializer(existing_payment).data, status=status.HTTP_200_OK)
            return Response(
                {"reference_number": "This GCash reference number has already been submitted."},
                status=status.HTTP_409_CONFLICT
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
        if len(reference_number) > 100:
            return Response({"reference_number": "Reference number is too long."}, status=status.HTTP_400_BAD_REQUEST)
        exists = Payment.objects.filter(payment_type=Payment.BOOKING, reference_number__iexact=reference_number).exists()
        return Response({
            "exists": exists,
            "reference_number": reference_number,
            "message": "This GCash reference number has already been submitted." if exists else ""
        })

class BookingPaymentOcrView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = 'ocr'

    def post(self, request):
        receipt = request.FILES.get('receipt')
        if not receipt:
            return Response({"receipt": "Upload a GCash screenshot."}, status=status.HTTP_400_BAD_REQUEST)
        if receipt.size > 5 * 1024 * 1024:
            return Response({"receipt": "Receipt file must be 5MB or smaller."}, status=status.HTTP_400_BAD_REQUEST)
        if getattr(receipt, 'content_type', '') not in {'image/jpeg', 'image/png', 'image/webp'}:
            return Response({"receipt": "OCR accepts JPG, PNG, or WEBP screenshots only."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = analyze_gcash_receipt(receipt)
        except Exception:
            return Response({"detail": "Could not read this receipt image."}, status=status.HTTP_400_BAD_REQUEST)
        result.pop('raw_text', None)
        reference_number = result.get('fields', {}).get('reference_number', {}).get('value')
        if reference_number:
            duplicate_exists = Payment.objects.filter(payment_type=Payment.BOOKING, reference_number__iexact=reference_number).exists()
            result['duplicate_reference'] = duplicate_exists
            if duplicate_exists:
                result.setdefault('warnings', []).append('This GCash reference number has already been submitted.')
        else:
            result['duplicate_reference'] = False
        return Response(result)

class BookingPaymentVerifyView(generics.UpdateAPIView):
    serializer_class = BookingPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Payment.objects.filter(payment_type=Payment.BOOKING).select_related('booking', 'booking__customer', 'booking__package', 'verified_by').distinct()

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
        payment.admin_note = str(request.data.get('admin_note', payment.admin_note or '') or '').strip()[:1000]
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

        AuditLog.objects.create(
            user=request.user,
            action=action,
            description=f"{new_status.title()} payment #{payment.id} for booking #{payment.booking.id}."
        )

        return Response(self.get_serializer(payment).data)
