from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework import views
from rest_framework.response import Response

from booking.models import Booking
from inventory.models import Product
from payment.models import Payment
from pos.models import Order
from users.permissions import IsStaffOrAdmin


def parse_date_param(value, field, fallback):
    if not value:
        return fallback, None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date(), None
    except ValueError:
        return fallback, {field: "Use YYYY-MM-DD format."}


def pct_change(current, previous):
    current = float(current or 0)
    previous = float(previous or 0)
    if previous == 0:
        return 100 if current > 0 else 0
    return round(((current - previous) / previous) * 100, 1)


def money(value):
    return round(float(value or 0), 2)


def bucket_key(dt, grain):
    local_date = timezone.localtime(dt).date()
    if grain == 'monthly':
        return local_date.replace(day=1).strftime('%Y-%m-%d')
    if grain == 'weekly':
        return (local_date - timedelta(days=local_date.weekday())).strftime('%Y-%m-%d')
    return local_date.strftime('%Y-%m-%d')


class DashboardAnalyticsView(views.APIView):
    permission_classes = [IsStaffOrAdmin]

    def get(self, request, *args, **kwargs):
        today = timezone.localdate()
        default_start = today - timedelta(days=30)
        start_date, start_error = parse_date_param(request.query_params.get('start'), 'start', default_start)
        end_date, end_error = parse_date_param(request.query_params.get('end'), 'end', today)
        if start_error:
            return Response(start_error, status=400)
        if end_error:
            return Response(end_error, status=400)
        if start_date > end_date:
            start_date, end_date = end_date, start_date
        if (end_date - start_date).days > 370:
            return Response({"detail": "Date range cannot exceed 370 days."}, status=400)

        grain = request.query_params.get('grain', 'daily')
        if grain not in {'daily', 'weekly', 'monthly'}:
            return Response({"grain": "Grain must be daily, weekly, or monthly."}, status=400)

        start_dt = timezone.make_aware(datetime.combine(start_date, datetime.min.time()))
        end_dt = timezone.make_aware(datetime.combine(end_date, datetime.max.time()))
        period_days = max((end_date - start_date).days + 1, 1)
        prev_start_dt = timezone.make_aware(datetime.combine(start_date - timedelta(days=period_days), datetime.min.time()))
        prev_end_dt = timezone.make_aware(datetime.combine(start_date - timedelta(days=1), datetime.max.time()))

        paid_orders = list(Order.objects.exclude(order_type='END_OF_DAY_REPORT').filter(payment_status='PAID', created_at__range=(start_dt, end_dt)).select_related('staff', 'booking'))
        prev_paid_orders = Order.objects.exclude(order_type='END_OF_DAY_REPORT').filter(payment_status='PAID', created_at__range=(prev_start_dt, prev_end_dt))
        approved_booking_payments = list(Payment.objects.filter(
            payment_type=Payment.BOOKING,
            status='APPROVED',
            paid_at__range=(start_dt, end_dt),
        ).select_related('booking', 'booking__package'))
        prev_approved_booking_payments = Payment.objects.filter(
            payment_type=Payment.BOOKING,
            status='APPROVED',
            paid_at__range=(prev_start_dt, prev_end_dt),
        )
        paid_pos_orders = [order for order in paid_orders if order.order_type == 'WALK_IN']
        paid_booking_orders = [order for order in paid_orders if order.order_type == 'BOOKING_LINKED']

        pos_rev = sum((order.total for order in paid_pos_orders), Decimal('0.00'))
        booking_order_rev = sum((order.total for order in paid_booking_orders), Decimal('0.00'))
        booking_payment_rev = sum((payment.amount for payment in approved_booking_payments), Decimal('0.00'))
        booking_rev = booking_order_rev + booking_payment_rev
        total_rev = pos_rev + booking_rev
        prev_total_rev = (
            sum(prev_paid_orders.values_list('total', flat=True), Decimal('0.00'))
            + sum(prev_approved_booking_payments.values_list('amount', flat=True), Decimal('0.00'))
        )
        total_tx = len(paid_pos_orders)
        total_items_sold = sum(sum(int(item.get('quantity') or 0) for item in order.line_items or []) for order in paid_pos_orders)
        avg_transaction = money(pos_rev) / total_tx if total_tx else 0

        bookings_in_range = Booking.objects.filter(created_at__range=(start_dt, end_dt)).distinct()
        booking_status_counts = {
            'pending': bookings_in_range.filter(status='PENDING').count(),
            'confirmed': bookings_in_range.filter(status__in=['CONFIRMED', 'CONFIRMED_DP']).count(),
            'confirmed_dp': bookings_in_range.filter(status='CONFIRMED_DP').count(),
            'completed': bookings_in_range.filter(status='COMPLETED').count(),
            'cancelled': bookings_in_range.filter(status='CANCELLED').count(),
        }

        buckets = {}
        for order in paid_orders:
            key = bucket_key(order.created_at, grain)
            buckets.setdefault(key, {'date': key, 'pos_revenue': 0, 'booking_revenue': 0, 'total_revenue': 0})
            if order.order_type == 'BOOKING_LINKED':
                buckets[key]['booking_revenue'] += money(order.total)
            else:
                buckets[key]['pos_revenue'] += money(order.total)
            buckets[key]['total_revenue'] = buckets[key]['pos_revenue'] + buckets[key]['booking_revenue']
        for payment in approved_booking_payments:
            key = bucket_key(payment.paid_at, grain)
            buckets.setdefault(key, {'date': key, 'pos_revenue': 0, 'booking_revenue': 0, 'total_revenue': 0})
            buckets[key]['booking_revenue'] += money(payment.amount)
            buckets[key]['total_revenue'] = buckets[key]['pos_revenue'] + buckets[key]['booking_revenue']

        inventory_status_counts = {'IN_STOCK': 0, 'LOW_STOCK': 0, 'NEAR_EXPIRY': 0, 'EXPIRED': 0, 'OVERSTOCKED': 0}
        inventory_alerts = []
        for ingredient in Product.objects.filter(item_type=Product.INGREDIENT):
            status_key = ingredient.inventory_status
            inventory_status_counts[status_key] = inventory_status_counts.get(status_key, 0) + 1
            if status_key != 'IN_STOCK':
                inventory_alerts.append({
                    'id': ingredient.id,
                    'name': ingredient.name,
                    'category': ingredient.category_name or 'N/A',
                    'supplier_name': (ingredient.supplier_details or {}).get('name', 'N/A'),
                    'stock_quantity': money(ingredient.stock_quantity),
                    'base_unit': ingredient.base_unit,
                    'minimum_stock_level': money(ingredient.minimum_stock_level),
                    'maximum_stock_level': money(ingredient.maximum_stock_level),
                    'expiration_date': ingredient.expiration_date.strftime('%Y-%m-%d') if ingredient.expiration_date else None,
                    'days_until_expiry': ingredient.days_until_expiry,
                    'inventory_status': status_key,
                    'inventory_status_label': ingredient.inventory_status_label,
                    'suggested_action': ingredient.suggested_action,
                })

        # The activity feed is intentionally independent of the reporting range.
        # A booking for a future session must appear as soon as it is created,
        # even when its scheduled date is outside the currently selected period.
        recent_bookings = Booking.objects.select_related('customer', 'package').order_by('-created_at', '-id')[:10]
        bookings_list = [{
            'id': b.id,
            'customer_name': b.customer.get_full_name() or b.customer.username,
            'customer_profile_picture_url': request.build_absolute_uri(b.customer.profile_picture.url) if b.customer.profile_picture else '',
            'package_name': b.package.name,
            'scheduled_date': b.scheduled_date.strftime('%Y-%m-%d'),
            'scheduled_time': b.scheduled_time.strftime('%H:%M'),
            'status': b.status,
            'amount': money(b.package.price),
            'created_at': timezone.localtime(b.created_at).strftime('%Y-%m-%d %H:%M')
        } for b in recent_bookings]

        pos_payments = Payment.objects.filter(payment_type=Payment.POS, order__in=[order.id for order in paid_pos_orders]).select_related('order')
        first_payment_by_order = {}
        for payment in pos_payments:
            first_payment_by_order.setdefault(payment.order_id, payment)
        orders_list = [{
            'id': order.id,
            'transaction_id': order.transaction_id or f'POS-{order.id}',
            'cashier': order.staff.username if order.staff else 'N/A',
            'date': timezone.localtime(order.created_at).strftime('%Y-%m-%d %H:%M'),
            'total': money(order.total),
            'payment_method': first_payment_by_order.get(order.id).method if first_payment_by_order.get(order.id) else 'N/A',
        } for order in sorted(paid_pos_orders, key=lambda row: row.created_at, reverse=True)[:10]]

        product_totals = defaultdict(lambda: {'quantity_sold': 0, 'revenue': Decimal('0.00')})
        for order in paid_pos_orders:
            for item in order.line_items or []:
                name = item.get('product_details', {}).get('name') or 'Item'
                product_totals[name]['quantity_sold'] += int(item.get('quantity') or 0)
                product_totals[name]['revenue'] += Decimal(str(item.get('subtotal') or '0'))
        top_products = sorted(product_totals.items(), key=lambda row: (-row[1]['quantity_sold'], -row[1]['revenue']))[:8]

        package_totals = defaultdict(lambda: {'total_bookings': 0, 'revenue': Decimal('0.00')})
        for booking in bookings_in_range.select_related('package'):
            package_totals[booking.package.name]['total_bookings'] += 1
            package_totals[booking.package.name]['revenue'] += booking.package.price
        top_packages = sorted(package_totals.items(), key=lambda row: (-row[1]['total_bookings'], -row[1]['revenue']))[:8]

        priority_order = {'EXPIRED': 0, 'NEAR_EXPIRY': 1, 'LOW_STOCK': 2, 'OVERSTOCKED': 3}
        inventory_alerts.sort(key=lambda row: priority_order.get(row['inventory_status'], 99))

        return Response({
            'metrics': {
                'total_revenue': money(total_rev),
                'total_revenue_change': pct_change(total_rev, prev_total_rev),
                'pos_revenue': money(pos_rev),
                'booking_revenue': money(booking_rev),
                'booking_payment_revenue': money(booking_payment_rev),
                'transaction_count': total_tx,
                'avg_transaction_value': money(avg_transaction),
                'total_items_sold': total_items_sold,
                'total_bookings': bookings_in_range.count(),
                'completed_bookings': booking_status_counts['completed'],
                **booking_status_counts,
            },
            'sales_history_chart': list(buckets.values()),
            'low_stock_alerts': [row for row in inventory_alerts if row['inventory_status'] == 'LOW_STOCK'],
            'inventory_status_counts': inventory_status_counts,
            'inventory_alerts': inventory_alerts[:8],
            'recent_bookings': bookings_list,
            'recent_pos_transactions': orders_list,
            'top_selling_products': [
                {'product': name, 'quantity_sold': values['quantity_sold'], 'revenue': money(values['revenue'])}
                for name, values in top_products
            ],
            'top_booked_packages': [
                {'package': name, 'total_bookings': values['total_bookings'], 'revenue': money(values['revenue'])}
                for name, values in top_packages
            ],
            'range': {'start': start_date.strftime('%Y-%m-%d'), 'end': end_date.strftime('%Y-%m-%d'), 'grain': grain}
        })
