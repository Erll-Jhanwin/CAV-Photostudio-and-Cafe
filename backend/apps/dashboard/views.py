from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from django.db.models import Count, F, Prefetch, Sum
from django.db.models.functions import Coalesce, TruncDate
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
        return None if current > 0 else 0
    return round(((current - previous) / previous) * 100, 1)


def money(value):
    return round(float(value or 0), 2)


def bucket_key(dt, grain):
    return bucket_key_for_date(timezone.localtime(dt).date(), grain)


def bucket_key_for_date(local_date, grain):
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

        paid_orders = Order.objects.exclude(order_type='END_OF_DAY_REPORT').filter(
            payment_status='PAID', created_at__range=(start_dt, end_dt)
        ).annotate(net_revenue=F('total') - F('returned_amount'))
        paid_order_totals = {
            row['order_type']: row
            for row in paid_orders.values('order_type').annotate(revenue=Sum('net_revenue'), count=Count('id'))
        }
        previous_order_revenue = Order.objects.exclude(order_type='END_OF_DAY_REPORT').filter(
            payment_status='PAID', created_at__range=(prev_start_dt, prev_end_dt)
        ).aggregate(revenue=Sum(F('total') - F('returned_amount')))['revenue'] or Decimal('0.00')
        booking_payments = Payment.objects.filter(
            payment_type=Payment.BOOKING,
            status__in=('APPROVED', 'PAID'),
        ).annotate(revenue_at=Coalesce('paid_at', 'created_at')).filter(
            revenue_at__range=(start_dt, end_dt),
        )
        booking_payment_revenue = booking_payments.aggregate(revenue=Sum('amount'))['revenue'] or Decimal('0.00')
        previous_booking_payment_revenue = Payment.objects.filter(
            payment_type=Payment.BOOKING,
            status__in=('APPROVED', 'PAID'),
        ).annotate(revenue_at=Coalesce('paid_at', 'created_at')).filter(
            revenue_at__range=(prev_start_dt, prev_end_dt),
        ).aggregate(revenue=Sum('amount'))['revenue'] or Decimal('0.00')

        pos_metrics = paid_order_totals.get('WALK_IN', {})
        booking_metrics = paid_order_totals.get('BOOKING_LINKED', {})
        pos_rev = pos_metrics.get('revenue') or Decimal('0.00')
        booking_order_rev = booking_metrics.get('revenue') or Decimal('0.00')
        booking_rev = booking_order_rev + booking_payment_revenue
        total_rev = pos_rev + booking_rev
        prev_total_rev = previous_order_revenue + previous_booking_payment_revenue
        total_tx = pos_metrics.get('count', 0)
        paid_pos_line_items = paid_orders.filter(order_type='WALK_IN').values_list('line_items', flat=True)
        total_items_sold = 0
        product_totals = defaultdict(lambda: {'quantity_sold': 0, 'revenue': Decimal('0.00')})
        for line_items in paid_pos_line_items:
            for item in line_items or []:
                quantity = max(int(item.get('quantity') or 0) - int(item.get('returned_quantity') or 0), 0)
                total_items_sold += quantity
                name = item.get('product_details', {}).get('name') or 'Item'
                product_totals[name]['quantity_sold'] += quantity
                line_subtotal = Decimal(str(item.get('net_subtotal') or item.get('subtotal') or '0'))
                product_totals[name]['revenue'] += line_subtotal * quantity / max(int(item.get('quantity') or 1), 1)
        avg_transaction = money(pos_rev) / total_tx if total_tx else 0

        bookings_in_range = Booking.objects.filter(created_at__range=(start_dt, end_dt))
        grouped_booking_statuses = {
            row['status']: row['count']
            for row in bookings_in_range.values('status').annotate(count=Count('id'))
        }
        booking_status_counts = {
            'pending': grouped_booking_statuses.get('PENDING', 0),
            'confirmed': grouped_booking_statuses.get('CONFIRMED', 0) + grouped_booking_statuses.get('CONFIRMED_DP', 0),
            'confirmed_dp': grouped_booking_statuses.get('CONFIRMED_DP', 0),
            'completed': grouped_booking_statuses.get('COMPLETED', 0),
            'cancelled': grouped_booking_statuses.get('CANCELLED', 0),
        }

        buckets = {}
        daily_order_revenue = paid_orders.annotate(
            local_date=TruncDate('created_at', tzinfo=timezone.get_current_timezone())
        ).values('local_date', 'order_type').annotate(revenue=Sum('net_revenue')).order_by('local_date', 'order_type')
        for row in daily_order_revenue:
            key = bucket_key_for_date(row['local_date'], grain)
            buckets.setdefault(key, {'date': key, 'pos_revenue': 0, 'booking_revenue': 0, 'total_revenue': 0})
            if row['order_type'] == 'BOOKING_LINKED':
                buckets[key]['booking_revenue'] += money(row['revenue'])
            else:
                buckets[key]['pos_revenue'] += money(row['revenue'])
            buckets[key]['total_revenue'] = buckets[key]['pos_revenue'] + buckets[key]['booking_revenue']
        daily_booking_revenue = booking_payments.annotate(
            local_date=TruncDate('revenue_at', tzinfo=timezone.get_current_timezone())
        ).values('local_date').annotate(revenue=Sum('amount')).order_by('local_date')
        for row in daily_booking_revenue:
            key = bucket_key_for_date(row['local_date'], grain)
            buckets.setdefault(key, {'date': key, 'pos_revenue': 0, 'booking_revenue': 0, 'total_revenue': 0})
            buckets[key]['booking_revenue'] += money(row['revenue'])
            buckets[key]['total_revenue'] = buckets[key]['pos_revenue'] + buckets[key]['booking_revenue']

        inventory_status_counts = {'IN_STOCK': 0, 'LOW_STOCK': 0, 'NEAR_EXPIRY': 0, 'EXPIRED': 0, 'OVERSTOCKED': 0}
        inventory_alerts = []
        for ingredient in Product.objects.filter(item_type=Product.INGREDIENT).only(
            'id', 'name', 'category_name', 'supplier_details', 'stock_quantity', 'stock_level',
            'item_type', 'minimum_stock_level', 'reorder_point', 'maximum_stock_level',
            'expiration_date', 'base_unit',
        ):
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
            'customer_name': b.contact_name or (b.customer.get_full_name() or b.customer.username if b.customer_id else 'Walk-in customer'),
            'customer_profile_picture_url': request.build_absolute_uri(b.customer.profile_picture.url) if b.customer_id and b.customer.profile_picture else '',
            'package_name': b.package.name,
            'scheduled_date': b.scheduled_date.strftime('%Y-%m-%d'),
            'scheduled_time': b.scheduled_time.strftime('%H:%M'),
            'status': b.status,
            'amount': money(b.package.price),
            'created_at': timezone.localtime(b.created_at).strftime('%Y-%m-%d %H:%M')
        } for b in recent_bookings]

        recent_paid_pos_orders = Order.objects.filter(
            order_type='WALK_IN', payment_status='PAID', created_at__range=(start_dt, end_dt)
        ).select_related('staff').prefetch_related(Prefetch(
            'payments',
            queryset=Payment.objects.filter(payment_type=Payment.POS).only(
                'id', 'order_id', 'method', 'created_at'
            ).order_by('-created_at', '-id'),
            to_attr='dashboard_payments',
        )).order_by('-created_at', '-id')[:10]
        orders_list = [{
            'id': order.id,
            'transaction_id': order.transaction_id or f'POS-{order.id}',
            'cashier': order.staff.username if order.staff else 'N/A',
            'date': timezone.localtime(order.created_at).strftime('%Y-%m-%d %H:%M'),
            'total': money(order.total - order.returned_amount),
            'payment_method': order.dashboard_payments[0].method if order.dashboard_payments else 'N/A',
        } for order in recent_paid_pos_orders]

        top_products = sorted(product_totals.items(), key=lambda row: (-row[1]['quantity_sold'], -row[1]['revenue']))[:8]

        top_packages = list(bookings_in_range.values('package__name').annotate(
            total_bookings=Count('id'), revenue=Sum('package__price')
        ).order_by('-total_bookings', '-revenue')[:8])

        priority_order = {'EXPIRED': 0, 'NEAR_EXPIRY': 1, 'LOW_STOCK': 2, 'OVERSTOCKED': 3}
        inventory_alerts.sort(key=lambda row: priority_order.get(row['inventory_status'], 99))

        return Response({
            'metrics': {
                'total_revenue': money(total_rev),
                'total_revenue_change': pct_change(total_rev, prev_total_rev),
                'previous_period_revenue': money(prev_total_rev),
                'pos_revenue': money(pos_rev),
                'booking_revenue': money(booking_rev),
                'booking_payment_revenue': money(booking_payment_revenue),
                'transaction_count': total_tx,
                'avg_transaction_value': money(avg_transaction),
                'total_items_sold': total_items_sold,
                'total_bookings': sum(grouped_booking_statuses.values()),
                'completed_bookings': booking_status_counts['completed'],
                **booking_status_counts,
            },
            'record_counts': {
                'paid_orders': sum(row['count'] for row in paid_order_totals.values()),
                'pos_transactions': total_tx,
                'booking_payments': booking_payments.count(),
                'bookings': sum(grouped_booking_statuses.values()),
            },
            'sales_history_chart': sorted(buckets.values(), key=lambda row: row['date'], reverse=True),
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
                {'package': row['package__name'], 'total_bookings': row['total_bookings'], 'revenue': money(row['revenue'])}
                for row in top_packages
            ],
            'range': {'start': start_date.strftime('%Y-%m-%d'), 'end': end_date.strftime('%Y-%m-%d'), 'grain': grain}
        })
